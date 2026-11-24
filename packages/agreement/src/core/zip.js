/**
 * Minimal ZIP writer (deflate, UTF-8 names, no zip64).
 *
 * Why not a dependency: an evidence package is a handful of small files, and
 * this keeps the portable core free of third-party code. Anything larger than
 * 4 GB or more than 65535 entries is out of scope and rejected.
 */
import zlib from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const d = new Date(date);
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const day = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date: day };
}

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n >>> 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

/**
 * @param {{name: string, data: Buffer|string, date?: Date}[]} entries
 * @returns {Buffer}
 */
export function createZip(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error("createZip: at least one entry is required");
  if (entries.length > 0xffff) throw new Error("createZip: too many entries");

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(String(entry.name || ""), "utf8");
    if (!name.length) throw new Error("createZip: empty name");
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ""), "utf8");
    const data = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const { time, date } = dosDateTime(entry.date || new Date());

    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(time), u16(date),
      u32(crc), u32(data.length), u32(raw.length), u16(name.length), u16(0),
      name, data,
    ]);
    locals.push(local);

    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(time), u16(date),
      u32(crc), u32(data.length), u32(raw.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]));

    offset += local.length;
    if (offset > 0xffffffff) throw new Error("createZip: archive too large");
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralDir.length), u32(offset), u16(0),
  ]);

  return Buffer.concat([...locals, centralDir, eocd]);
}
