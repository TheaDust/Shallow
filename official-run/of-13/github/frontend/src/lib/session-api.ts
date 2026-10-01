import { ApiError, apiRequest } from "./api";

export interface Account {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
}

export type FieldErrors = Record<string, string>;

export interface RegistrationInput {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  agreeToTerms: boolean;
}

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface PasswordResetInput {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}

export async function fetchCurrentAccount(): Promise<Account | null> {
  const payload = await apiRequest<{ account: Account | null }>("/api/session");
  return payload.account;
}

export async function signInRequest(identifier: string, password: string): Promise<Account> {
  const payload = await apiRequest<{ account: Account }>("/api/session", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
  return payload.account;
}

export async function signOutRequest(): Promise<void> {
  await apiRequest<{ ok: boolean }>("/api/session", { method: "DELETE" });
}

export async function registerAccount(input: RegistrationInput): Promise<Account> {
  const payload = await apiRequest<{ account: Account }>("/api/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return payload.account;
}

export async function changePasswordRequest(input: PasswordChangeInput): Promise<string> {
  const payload = await apiRequest<{ message: string }>("/api/password", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return payload.message;
}

export async function resetPasswordRequest(input: PasswordResetInput): Promise<string> {
  const payload = await apiRequest<{ message: string }>("/api/password-reset", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return payload.message;
}

function bodyOf(error: unknown): Record<string, unknown> | null {
  if (error instanceof ApiError && error.body && typeof error.body === "object") {
    return error.body as Record<string, unknown>;
  }
  return null;
}

export function fieldErrorsOf(error: unknown): FieldErrors {
  const fieldErrors = bodyOf(error)?.fieldErrors;
  if (!fieldErrors || typeof fieldErrors !== "object") return {};
  const result: FieldErrors = {};
  for (const [field, message] of Object.entries(fieldErrors as Record<string, unknown>)) {
    if (typeof message === "string") result[field] = message;
  }
  return result;
}

export function messageOf(error: unknown, fallback: string): string {
  const message = bodyOf(error)?.error;
  if (typeof message === "string" && message.length > 0) return message;
  return fallback;
}
