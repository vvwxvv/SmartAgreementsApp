/** Signature image validation (server-side, pure).
 *  PNG only (the pad always produces PNG). We parse IHDR for pixel dimensions,
 *  inflate the IDAT stream, undo the scanline filters, and count real ink:
 *  a canvas of transparent or white pixels is rejected even if it compresses
 *  to a few hundred bytes. */
import zlib from "node:zlib";

export const MAX_SIGNATURE_BYTES = 300 * 1024;
// A real signature drawn on a phone or a laptop can be quite flat: 60x24 is
// already 1,440 strokes-ish of evidence. The floor only rejects noise, not
// handwriting (a user test produced a perfectly good 609x68 signature).
export const MIN_WIDTH = 60;
export const MAX_WIDTH = 2000;
export const MIN_HEIGHT = 24;
export const MAX_HEIGHT = 1000;

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

function readPng(bytes) {
  if (bytes.length < 33) return { ok: false, reason: "decode" };
  for (let i = 0; i < 8; i += 1) if (bytes[i] !== PNG_SIG[i]) return { ok: false, reason: "magic" };
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(off);
    const type = bytes.toString("ascii", off + 4, off + 8);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length) return { ok: false, reason: "decode" };
    if (type === "IHDR") {
      ihdr = {
        width: bytes.readUInt32BE(dataStart),
        height: bytes.readUInt32BE(dataStart + 4),
        bitDepth: bytes[dataStart + 8],
        colorType: bytes[dataStart + 9],
        interlace: bytes[dataStart + 12],
      };
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    off = dataEnd + 4;
  }
  if (!ihdr) return { ok: false, reason: "decode" };
  if (!CHANNELS[ihdr.colorType] || ihdr.bitDepth !== 8 || ihdr.interlace !== 0) {
    return { ok: false, reason: "unsupported" };
  }
  return { ok: true, ihdr, idat: Buffer.concat(idat) };
}

function countInk(raw, ihdr) {
  const ch = CHANNELS[ihdr.colorType];
  const stride = ihdr.width * ch;
  if (raw.length !== (stride + 1) * ihdr.height) return null;
  let prev = Buffer.alloc(stride);
  let ink = 0;
  let pos = 0;
  for (let y = 0; y < ihdr.height; y += 1) {
    const ft = raw[pos]; pos += 1;
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const out = Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= ch ? out[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + b) & 255;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 255;
      } else if (ft !== 0) return null;
      out[i] = v;
    }
    for (let x = 0; x < ihdr.width; x += 1) {
      const o = x * ch;
      let visible;
      if (ch === 4) visible = out[o + 3] > 10 && (out[o] < 250 || out[o + 1] < 250 || out[o + 2] < 250);
      else if (ch === 3) visible = out[o] < 250 || out[o + 1] < 250 || out[o + 2] < 250;
      else if (ch === 2) visible = out[o + 1] > 10 && out[o] < 250;
      else visible = out[o] < 250;
      if (visible) ink += 1;
    }
    prev = out;
  }
  return ink;
}

export function validateSignatureImage(image) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(image || ""));
  if (!m) return { ok: false, reason: "format" };
  let bytes;
  try { bytes = Buffer.from(m[1], "base64"); } catch { return { ok: false, reason: "base64" }; }
  if (bytes.length > MAX_SIGNATURE_BYTES) return { ok: false, reason: "too-large" };
  const head = readPng(bytes);
  if (!head.ok) return head;
  const { width, height } = head.ihdr;
  if (width < MIN_WIDTH || width > MAX_WIDTH || height < MIN_HEIGHT || height > MAX_HEIGHT) {
    return { ok: false, reason: "dimensions" };
  }
  const expected = (width * CHANNELS[head.ihdr.colorType] + 1) * height;
  let raw;
  try {
    // Cap the output: a small IDAT can decompress to gigabytes.
    raw = zlib.inflateSync(head.idat, { maxOutputLength: expected });
  } catch {
    return { ok: false, reason: "decode" };
  }
  const ink = countInk(raw, head.ihdr);
  if (ink === null) return { ok: false, reason: "decode" };
  const floor = Math.max(40, Math.ceil(width * height * 0.001));
  if (ink < floor) return { ok: false, reason: "blank" };
  return { ok: true, bytes, mime: "png", width, height, ink };
}
