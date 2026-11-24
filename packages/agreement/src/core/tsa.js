import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";

const run = promisify(execFile);

const TSA_URL = process.env.AGREEMENT_TSA_URL || "https://freetsa.org/tsr";

/**
 * RFC 3161 timestamp over a hex digest.
 *
 * This is the piece that makes "the record existed at this time" independent of
 * our own server clock: the token is signed by a third party and can be checked
 * later with openssl (or any RFC 3161 verifier).
 *
 * Best effort: if the TSA is unreachable the signature still stands, but the
 * certificate must say so instead of pretending.
 */
export async function timestampDigest(hexDigest) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agreement-tsa-"));
  const dataFile = path.join(dir, "digest.bin");
  const reqFile = path.join(dir, "req.tsq");
  const resFile = path.join(dir, "res.tsr");
  try {
    // Timestamp the digest bytes themselves (what we actually want attested).
    await fs.writeFile(dataFile, Buffer.from(hexDigest, "utf8"));
    await run("openssl", ["ts", "-query", "-data", dataFile, "-sha256", "-no_nonce", "-out", reqFile]);

    const req = await fs.readFile(reqFile);
    const res = await fetch(TSA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/timestamp-query" },
      body: req,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, error: `TSA ${res.status}` };

    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(resFile, buf);

    const { stdout } = await run("openssl", ["ts", "-reply", "-in", resFile, "-text"]);
    const m = /Time stamp:\s*(.+)/.exec(stdout);
    const granted = /Status:\s*Granted/.test(stdout);
    if (!granted) return { ok: false, error: "TSA refused" };

    return {
      ok: true,
      url: TSA_URL,
      time: m ? m[1].trim() : null,
      token: buf.toString("base64"),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
