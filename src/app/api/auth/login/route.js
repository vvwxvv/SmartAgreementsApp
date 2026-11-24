import { MongoClient } from "mongodb";
import { requireAdmin } from "@/lib/requireAdmin";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { assertAuthConfig, authUnavailableResponse } from "../_authUtils";
import { enforce } from "@/app/api/_lib/authz";

const collectionName = "Users";

// NOTE: no env is read or validated at import time — a production build must not
// require auth secrets. Configuration is checked lazily, per request.
let cachedClient = null;

async function connectDB(cfg) {
  if (cachedClient) {
    return cachedClient.db(cfg.dbName);
  }
  try {
    const client = new MongoClient(cfg.uri);
    cachedClient = await client.connect();
    return cachedClient.db(cfg.dbName);
  } catch (error) {
    throw new Error(`MongoDB connection failed: ${error.message}`);
  }
}

export async function POST(req) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const denied = await enforce(req);   // public entry; methods other than POST are closed
  if (denied) return denied;
  let cfg;
  try {
    cfg = assertAuthConfig();
  } catch (e) {
    console.error("[auth/login] unavailable:", (e.missing || []).join(", "));
    return authUnavailableResponse();
  }

  let body;

  // Parse the request body
  try {
    body = await req.json();
  } catch (error) {
    return new Response(
      JSON.stringify({ message: "Invalid JSON" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const { email, password } = body || {};

  // Validate input
  if (!email || !password) {
    return new Response(
      JSON.stringify({ message: "All fields are required" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  try {
    const db = await connectDB(cfg);
    const collection = db.collection(collectionName);

    // Check if the user exists
    const user = await collection.findOne({ email });

    // If the user does not exist
    if (!user) {
      return new Response(
        JSON.stringify({ message: "Invalid email or password" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Compare the provided password with the hashed password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    // If the password is invalid
    if (!isPasswordValid) {
      return new Response(
        JSON.stringify({ message: "Invalid email or password" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Update the lastLoginAt field with the current timestamp (as a string)
    const currentTimestamp = new Date().toISOString();
    await collection.updateOne({ email }, { $set: { lastLoginAt: currentTimestamp } });

    // Generate a JWT token with 1-hour expiration
    const token = jwt.sign(
      {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
      },
      cfg.secret,
      { expiresIn: "1h" } // Token valid for 1 hour
    );

    // Set the token in a secure HTTP-only cookie
    const response = new Response(
      JSON.stringify({
        message: "Login successful",
        user: {
          id: user._id.toString(),
          username: user.username,
          email: user.email,
          role: user.role,
          createdAt: user.createdAt,
          lastLoginAt: currentTimestamp,
        },
        token, // Include the token in the response if needed
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );

    // Set secure cookie
    response.headers.append(
      "Set-Cookie",
      `authToken=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${60 * 60}` // Expires in 1 hour
    );

    return response;
  } catch (error) {
    console.log("Error during login:", error.message, error.stack);

    return new Response(
      JSON.stringify({ message: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// Handle unsupported methods like GET
export async function GET(req) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  return new Response(
    JSON.stringify({ message: "Method not allowed" }),
    {
      status: 405,
      headers: { "Content-Type": "application/json" },
    }
  );
}