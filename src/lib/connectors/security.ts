import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ENCRYPTION_PREFIX = "v1";

function encryptionKey(): Buffer {
  const raw = process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("Connector token encryption is not configured.");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64url");
  if (key.length !== 32) throw new Error("CONNECTOR_TOKEN_ENCRYPTION_KEY must encode 32 bytes.");
  return key;
}

export function randomOpaqueValue(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashOpaqueValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createCodeVerifier(): string {
  return randomOpaqueValue(32);
}

export function createCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function encryptSecret(value: string): string {
  if (!value) throw new Error("Cannot encrypt an empty connector secret.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENCRYPTION_PREFIX, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptSecret(value: string): string {
  const [version, ivEncoded, tagEncoded, ciphertextEncoded] = value.split(":");
  if (version !== ENCRYPTION_PREFIX || !ivEncoded || !tagEncoded || !ciphertextEncoded) throw new Error("Invalid connector secret.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivEncoded, "base64url"));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, "base64url")), decipher.final()]).toString("utf8");
}

export function safeCompare(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyHmacSha256(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !signature.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  return safeCompare(signature, expected);
}

export function appUrl(): string {
  const value = process.env.APP_URL;
  if (!value) throw new Error("APP_URL is not configured.");
  const parsed = new URL(value);
  if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("APP_URL must be an origin.");
  }
  return value.replace(/\/$/, "");
}

export function parseScopes(value: unknown, fallback: string[] = []): string[] {
  if (typeof value !== "string") return fallback;
  return [...new Set(value.split(/[ ,]+/).map((scope) => scope.trim()).filter(Boolean))];
}
