// @effect-diagnostics nodeBuiltinImport:off -- Encode a tiny PNG without a renderer or an image dependency.
import * as NodeZlib from "node:zlib";

export function statusIconPng(color: string): Buffer {
  const size = 36;
  const pixels = Buffer.alloc(size * (1 + size * 4));
  const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - 18, y + 0.5 - 18);
      const opacity = Math.max(
        0,
        Math.min(1, Math.max(7.5 - distance, 2.5 - Math.abs(distance - 12))),
      );
      const offset = y * (1 + size * 4) + 1 + x * 4;
      pixels.set([rgb[0]!, rgb[1]!, rgb[2]!, Math.round(opacity * 255)], offset);
    }
  const chunk = (type: string, data: Buffer) => {
    const bytes = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, bytes, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", NodeZlib.deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
