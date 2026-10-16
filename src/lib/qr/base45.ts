/**
 * Base45 (RFC 9285). Its alphabet is exactly the QR "alphanumeric" set, so a QR code can
 * use the compact alphanumeric mode (5.5 bits/char vs 8 for bytes).
 */
export const BASE45_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
const LOOKUP = new Map([...BASE45_CHARSET].map((char, index) => [char, index]));

export function encodeBase45(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      let n = (bytes[i]! << 8) + bytes[i + 1]!;
      const c = n % 45;
      n = (n - c) / 45;
      const d = n % 45;
      const e = (n - d) / 45;
      out += BASE45_CHARSET[c]! + BASE45_CHARSET[d]! + BASE45_CHARSET[e]!;
    } else {
      const n = bytes[i]!;
      const c = n % 45;
      out += BASE45_CHARSET[c]! + BASE45_CHARSET[(n - c) / 45]!;
    }
  }
  return out;
}

export function decodeBase45(text: string): Uint8Array {
  if (text.length % 3 === 1) throw new Error("Invalid Base45 length");
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 3) {
    const chunk = text.slice(i, i + 3);
    const values = [...chunk].map((char) => {
      const value = LOOKUP.get(char);
      if (value === undefined) throw new Error(`Invalid Base45 character "${char}"`);
      return value;
    });
    if (values.length === 3) {
      const n = values[0]! + values[1]! * 45 + values[2]! * 2025;
      if (n > 0xffff) throw new Error("Invalid Base45 triplet");
      out.push(n >> 8, n & 0xff);
    } else {
      const n = values[0]! + values[1]! * 45;
      if (n > 0xff) throw new Error("Invalid Base45 pair");
      out.push(n);
    }
  }
  return new Uint8Array(out);
}
