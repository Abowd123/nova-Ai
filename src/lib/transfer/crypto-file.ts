import { base64ToBytes, bytesToBase64 } from "@/lib/crypto/encoding";
import { TransferError } from "./errors";
import { compressionAvailable, gunzip, gzip } from "./compression";
import { ENCRYPTED_FORMAT, encryptedEnvelopeSchema, type EncryptedEnvelope } from "./format";

/** OWASP 2023 guidance for PBKDF2-HMAC-SHA256. */
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 8;

export interface CryptoDeps {
  subtle?: SubtleCrypto;
  random?: (bytes: Uint8Array) => Uint8Array;
  iterations?: number;
}

export async function deriveKey(password: string, salt: Uint8Array, iterations: number, subtle: SubtleCrypto): Promise<CryptoKey> {
  const material = await subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** gzip -> AES-GCM-256 with a PBKDF2-derived key. The header is bound as AAD. */
export async function encryptWithPassword(plaintext: string, password: string, deps: CryptoDeps = {}): Promise<EncryptedEnvelope> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new TransferError("password_required", "Password is too short");
  const subtle = deps.subtle ?? globalThis.crypto.subtle;
  const random = deps.random ?? ((b: Uint8Array) => globalThis.crypto.getRandomValues(b));
  const iterations = deps.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  const salt = random(new Uint8Array(16));
  const iv = random(new Uint8Array(12));
  const compression: "gzip" | "none" = compressionAvailable() ? "gzip" : "none";
  const raw = new TextEncoder().encode(plaintext);
  const body = compression === "gzip" ? await gzip(raw) : raw;
  const header = { format: ENCRYPTED_FORMAT as typeof ENCRYPTED_FORMAT, version: 1 as const, kdf: { name: "PBKDF2" as const, hash: "SHA-256" as const, iterations, salt: bytesToBase64(salt) }, cipher: { name: "AES-GCM" as const, iv: bytesToBase64(iv) }, compression };
  const key = await deriveKey(password, salt, iterations, subtle);
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: new TextEncoder().encode(JSON.stringify(header)) },
    key,
    body as BufferSource,
  );
  return { ...header, ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function decryptWithPassword(envelope: unknown, password: string, deps: CryptoDeps = {}): Promise<string> {
  const parsed = encryptedEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) throw new TransferError("unsupported_format", "Invalid encrypted file");
  if (!password) throw new TransferError("password_required", "Password required");
  const { ciphertext, ...header } = parsed.data;
  const subtle = deps.subtle ?? globalThis.crypto.subtle;
  const key = await deriveKey(password, base64ToBytes(header.kdf.salt), header.kdf.iterations, subtle);
  let plain: ArrayBuffer;
  try {
    plain = await subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(header.cipher.iv) as BufferSource,
        additionalData: new TextEncoder().encode(JSON.stringify({ format: header.format, version: header.version, kdf: header.kdf, cipher: header.cipher, compression: header.compression })),
      },
      key,
      base64ToBytes(ciphertext) as BufferSource,
    );
  } catch (error) {
    throw new TransferError("wrong_password", "Wrong password or corrupted file", [], { cause: error });
  }
  const bytes = header.compression === "gzip" ? await gunzip(new Uint8Array(plain)) : new Uint8Array(plain);
  return new TextDecoder().decode(bytes);
}

export function passwordStrength(password: string): 0 | 1 | 2 | 3 {
  if (password.length < MIN_PASSWORD_LENGTH) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length + (/[^\x00-\x7f]/.test(password) ? 1 : 0);
  if (password.length >= 16 && classes >= 2) return 3;
  if (password.length >= 12 || classes >= 3) return 2;
  return 1;
}
