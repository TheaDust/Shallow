/**
 * REQ-1-1-1: a successful registration enters the sign-in page, which starts
 * with the username of the account just created. The value only lives in
 * memory for this browser session — it is never a password and never part of
 * the URL — and it is dropped as soon as the visitor signs in.
 */
let registeredIdentifier: string | null = null;

export function rememberRegisteredIdentifier(value: string): void {
  const trimmed = value.trim();
  registeredIdentifier = trimmed.length > 0 ? trimmed : null;
}

export function peekRegisteredIdentifier(): string | null {
  return registeredIdentifier;
}

export function forgetRegisteredIdentifier(): void {
  registeredIdentifier = null;
}
