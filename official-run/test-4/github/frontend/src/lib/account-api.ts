import { ApiError, apiRequest } from "./api";

export interface Account {
  username: string;
  email: string;
}

export interface RegistrationInput {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  agreeToTerms: boolean;
}

export interface FieldErrors {
  username?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  terms?: string;
  code?: string;
  currentPassword?: string;
}

export interface SignInInput {
  identifier: string;
  password: string;
}

export interface CurrentSession {
  account: Account;
}

export interface RecoveryRequestResult {
  token: string;
  code: string;
}

export async function registerAccount(input: RegistrationInput): Promise<{ ok: true } | { ok: false; errors: FieldErrors }> {
  try {
    const body = await apiRequest<{ ok: true }>("/api/accounts/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return body;
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && isFieldErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export async function signIn(input: SignInInput): Promise<{ ok: true; account: Account } | { ok: false; message: string }> {
  try {
    const body = await apiRequest<{ account: Account }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, account: body.account };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && isErrorMessage(error.body)) {
      return { ok: false, message: error.body.error };
    }
    throw error;
  }
}

export async function fetchCurrentSession(): Promise<Account | null> {
  try {
    const body = await apiRequest<CurrentSession>("/api/sessions/current");
    return body.account;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function signOut(): Promise<void> {
  await apiRequest<{ ok: true }>("/api/sessions/current", { method: "DELETE" });
}

export async function requestRecovery(email: string): Promise<RecoveryRequestResult> {
  return apiRequest<RecoveryRequestResult>("/api/recovery/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export interface RecoveryResetInput {
  token: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}

export async function resetPassword(input: RecoveryResetInput): Promise<{ ok: true } | { ok: false; errors: FieldErrors }> {
  try {
    const body = await apiRequest<{ ok: true }>("/api/recovery/reset", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return body;
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && isFieldErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export async function changePassword(input: PasswordChangeInput): Promise<{ ok: true } | { ok: false; errors: FieldErrors }> {
  try {
    const body = await apiRequest<{ ok: true }>("/api/accounts/password", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return body;
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && isFieldErrors(error.body)) {
      return { ok: false, errors: error.body.errors };
    }
    throw error;
  }
}

function isFieldErrors(value: unknown): value is { errors: FieldErrors } {
  return typeof value === "object" && value !== null && "errors" in value;
}

function isErrorMessage(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value;
}
