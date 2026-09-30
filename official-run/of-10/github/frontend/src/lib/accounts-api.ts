import { ApiError, apiRequest } from "./api";

export interface AccountSummary {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
}

export type RegistrationField = "username" | "email" | "password" | "confirmPassword" | "terms";

export type FieldErrors = Partial<Record<RegistrationField, string>>;

export interface RegistrationInput {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  termsAccepted: boolean;
}

export type RegistrationResult =
  | { ok: true; account: AccountSummary }
  | { ok: false; message: string; fields: FieldErrors };

export type SignInResult =
  | { ok: true; account: AccountSummary }
  | { ok: false; message: string };

const REGISTRATION_FIELDS: readonly RegistrationField[] = [
  "username",
  "email",
  "password",
  "confirmPassword",
  "terms",
];

function readFieldErrors<K extends string>(body: unknown, fields: readonly K[]): Partial<Record<K, string>> {
  const errors: Partial<Record<K, string>> = {};
  if (typeof body !== "object" || body === null || !("fields" in body)) return errors;
  const raw = (body as { fields?: unknown }).fields;
  if (typeof raw !== "object" || raw === null) return errors;
  for (const field of fields) {
    const message = (raw as Record<string, unknown>)[field];
    if (typeof message === "string" && message) errors[field] = message;
  }
  return errors;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}

export async function fetchCurrentAccount(): Promise<AccountSummary | null> {
  const body = await apiRequest<{ account: AccountSummary | null }>("/api/session");
  return body.account ?? null;
}

export async function registerAccount(input: RegistrationInput): Promise<RegistrationResult> {
  try {
    const body = await apiRequest<{ account: AccountSummary }>("/api/accounts", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, account: body.account };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        message: error.status === 400 ? "Registration failed" : "Registration is unavailable right now.",
        fields: readFieldErrors(error.body, REGISTRATION_FIELDS),
      };
    }
    return { ok: false, message: "Registration is unavailable right now.", fields: {} };
  }
}

export async function signInAccount(identifier: string, password: string): Promise<SignInResult> {
  try {
    const body = await apiRequest<{ account: AccountSummary }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
    });
    return { ok: true, account: body.account };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "Sign in is unavailable right now." };
  }
}

export async function signOutAccount(): Promise<void> {
  await apiRequest<{ ok: boolean }>("/api/sessions/current", { method: "DELETE" });
}

export type RecoveryField = "verificationCode" | "newPassword" | "confirmPassword";

export type RecoveryFieldErrors = Partial<Record<RecoveryField, string>>;

export interface PasswordResetInput {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}

export type PasswordResetResult =
  | { ok: true }
  | { ok: false; message: string; fields: RecoveryFieldErrors };

export type PasswordChangeField = "currentPassword" | "newPassword" | "confirmPassword";

export type PasswordChangeFieldErrors = Partial<Record<PasswordChangeField, string>>;

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export type PasswordChangeResult =
  | { ok: true }
  | { ok: false; message: string; fields: PasswordChangeFieldErrors };

const RECOVERY_FIELDS: readonly RecoveryField[] = ["verificationCode", "newPassword", "confirmPassword"];
const PASSWORD_CHANGE_FIELDS: readonly PasswordChangeField[] = [
  "currentPassword",
  "newPassword",
  "confirmPassword",
];

/** The local recovery flow never sends email; the fixed code comes from the server. */
export async function requestPasswordReset(email: string): Promise<string> {
  const body = await apiRequest<{ code: string }>("/api/password-recovery/requests", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  return body.code;
}

export async function submitPasswordReset(input: PasswordResetInput): Promise<PasswordResetResult> {
  try {
    await apiRequest<{ ok: boolean }>("/api/password-recovery", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        message: errorMessage(error, "Password reset failed"),
        fields: readFieldErrors(error.body, RECOVERY_FIELDS),
      };
    }
    return { ok: false, message: "Password reset is unavailable right now.", fields: {} };
  }
}

export async function changePassword(input: PasswordChangeInput): Promise<PasswordChangeResult> {
  try {
    await apiRequest<{ ok: boolean }>("/api/account/password", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        message: errorMessage(error, "Password update failed"),
        fields: readFieldErrors(error.body, PASSWORD_CHANGE_FIELDS),
      };
    }
    return { ok: false, message: "Password update is unavailable right now.", fields: {} };
  }
}
