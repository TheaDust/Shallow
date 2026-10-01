import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Credentials are only ever stored as a salted scrypt digest; no page, log or
// API response may echo a plaintext password.
const KEY_LENGTH = 32;

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== "string" || typeof password !== "string") return false;
  const [scheme, salt, expected] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const derived = scryptSync(password, salt, KEY_LENGTH);
  const expectedBuffer = Buffer.from(expected, "hex");
  if (expectedBuffer.length !== derived.length) return false;
  return timingSafeEqual(derived, expectedBuffer);
}
