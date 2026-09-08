import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const PREFIX = "enc:v1:";
const KEY_LENGTH = 32;

/**
 * Returns the server-side integration encryption key (base64, 32 bytes), or
 * `undefined` when INTEGRATION_ENCRYPTION_KEY is not configured (encryption
 * disabled → secrets stored plaintext, for backward compatibility).
 */
export function getEncryptionKey(): Buffer | undefined {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) return undefined;
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY must be a 32-byte base64 key (run `npm run generate:integration-key`).");
  }
  return key;
}

/** Encrypt a secret with AES-256-GCM. Returns plaintext unchanged when no key is set. */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/**
 * Decrypt a stored secret. Values without the `enc:v1:` prefix are treated as
 * legacy plaintext (backward-compatible migration).
 */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const key = getEncryptionKey();
  if (!key) throw new Error("encrypted secret found but INTEGRATION_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
