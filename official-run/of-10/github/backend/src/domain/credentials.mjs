import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 32;
export const CREDENTIAL_ALGORITHM = "scrypt";

/** Stores only a salted derivation; plain passwords never reach the state file. */
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return {
    algorithm: CREDENTIAL_ALGORITHM,
    salt,
    hash: scryptSync(password, salt, KEY_LENGTH).toString("hex"),
  };
}

export function verifyPassword(password, credential) {
  if (typeof password !== "string" || !credential?.salt || !credential?.hash) return false;
  if (credential.algorithm && credential.algorithm !== CREDENTIAL_ALGORITHM) return false;
  const expected = Buffer.from(credential.hash, "hex");
  const candidate = scryptSync(password, credential.salt, KEY_LENGTH);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
