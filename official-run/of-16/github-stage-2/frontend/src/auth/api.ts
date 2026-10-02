import { ApiError, apiRequest } from "../lib/api";
import type {
  Account,
  FieldErrors,
  PasswordChangeInput,
  PasswordResetInput,
  RegisterInput,
} from "./types";

interface AccountResponse {
  account: Account | null;
}

export async function fetchSession(): Promise<Account | null> {
  const body = await apiRequest<AccountResponse>("/api/auth/session");
  return body.account;
}

export async function signIn(identifier: string, password: string): Promise<Account> {
  const body = await apiRequest<AccountResponse>("/api/auth/signin", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
  if (!body.account) throw new ApiError("Invalid credentials", 401, { error: "Invalid credentials" });
  return body.account;
}

export async function signOut(): Promise<void> {
  await apiRequest<{ ok: boolean }>("/api/auth/signout", { method: "POST", body: "{}" });
}

export async function registerAccount(input: RegisterInput): Promise<Account> {
  const body = await apiRequest<AccountResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!body.account) throw new ApiError("Registration failed", 400, {});
  return body.account;
}

export async function changePassword(input: PasswordChangeInput): Promise<string> {
  const body = await apiRequest<{ message: string }>("/api/auth/password", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.message;
}

export async function requestPasswordReset(email: string): Promise<string> {
  const body = await apiRequest<{ code: string }>("/api/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  return body.code;
}

export async function confirmPasswordReset(input: PasswordResetInput): Promise<string> {
  const body = await apiRequest<{ message: string }>("/api/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.message;
}

function bodyOf(error: unknown): Record<string, unknown> | null {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    return error.body as Record<string, unknown>;
  }
  return null;
}

/** Field-level messages returned by the API, if any. */
export function fieldErrorsOf(error: unknown): FieldErrors | null {
  const body = bodyOf(error);
  if (!body || typeof body.errors !== "object" || body.errors === null) return null;
  return body.errors as FieldErrors;
}

/** Non-field error message returned by the API, if any. */
export function errorMessageOf(error: unknown): string | null {
  const body = bodyOf(error);
  if (body && typeof body.error === "string") return body.error;
  return null;
}
