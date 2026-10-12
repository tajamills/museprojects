// AES-256-GCM encryption for stored exchange API credentials.
//
// The key comes from the EXCHANGE_ENC_KEY environment variable and must
// decode to exactly 32 bytes — either 64 hex characters or base64. Secrets
// are stored as `iv:tag:ciphertext` (each part base64) so a database leak
// alone never exposes a usable exchange key.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function loadKey(): Buffer {
  const raw = process.env.EXCHANGE_ENC_KEY?.trim();
  if (!raw) {
    throw new Error("EXCHANGE_ENC_KEY is not set, so exchange credentials can't be encrypted or read. Set it to 64 hex characters (or base64) decoding to 32 bytes.");
  }
  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    try {
      key = Buffer.from(raw, "base64");
    } catch {
      key = null;
    }
  }
  if (!key || key.length !== 32) {
    throw new Error("EXCHANGE_ENC_KEY is invalid — it must be 64 hex characters or base64 decoding to exactly 32 bytes.");
  }
  return key;
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
