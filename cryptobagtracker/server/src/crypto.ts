// AES-256-GCM encryption for stored exchange API credentials.
//
// The key comes from the EXCHANGE_ENC_KEY environment variable: either
// 64 hex characters, base64 decoding to exactly 32 bytes, or a plain
// passphrase of at least 20 characters (hashed to 32 bytes with SHA-256).
// Secrets are stored as `iv:tag:ciphertext` (each part base64) so a
// database leak alone never exposes a usable exchange key.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function loadKey(): Buffer {
  const raw = process.env.EXCHANGE_ENC_KEY?.trim();
  if (!raw) {
    throw new Error("EXCHANGE_ENC_KEY is not set, so exchange credentials can't be encrypted or read. Set it to 64 hex characters, base64 decoding to 32 bytes, or a passphrase of at least 20 characters.");
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Not valid base64 — fall through to the passphrase path.
  }
  // Passphrase path added Oct 30, 2026 because hand-formatting a hex key
  // kept failing; no stored ciphertexts existed at the time, so no
  // compatibility concern.
  if (raw.length >= 20) {
    return createHash("sha256").update(raw, "utf8").digest();
  }
  throw new Error("EXCHANGE_ENC_KEY is invalid — it must be 64 hex characters or a passphrase of at least 20 characters.");
}

export function encryptSecret(plain: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(enc: string): string {
  const key = loadKey();
  const parts = enc.split(":");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error("A stored exchange credential is malformed and can't be decrypted.");
  }
  const [ivPart, tagPart, dataPart] = parts as [string, string, string];
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(dataPart, "base64")), decipher.final()]);
  return plain.toString("utf8");
}
