const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), the same checksum gzip and PNG use. */
export function crc32(data: Uint8Array | string): number {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let crc = 0xffffffff;
  for (const byte of bytes) crc = TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32Hex(data: Uint8Array | string): string {
  return crc32(data).toString(16).toUpperCase().padStart(8, "0");
}
