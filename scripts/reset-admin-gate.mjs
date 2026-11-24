#!/usr/bin/env node
// Clears the admin pattern gate so the next visit shows the setup screen.
// Run on the machine that holds the database.
import { MongoClient } from "mongodb";
import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const client = new MongoClient(process.env.MONGODB_URL || "mongodb://127.0.0.1:27017/agreement_dev");
await client.connect();
const db = client.db(process.env.MONGODB_DB || "agreement_dev");
const r = await db.collection("AdminGate").deleteOne({ _id: "gate" });
console.log(r.deletedCount ? "admin gate cleared" : "admin gate was not set");
await client.close();
