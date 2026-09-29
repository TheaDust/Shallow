import { ApiError, apiRequest } from "../lib/api";
import type {
  PasswordChangeErrors,
  PasswordResetErrors,
  RegistrationErrors,
  RegistrationValues,
} from "../auth/validation";

export interface SessionAccount {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  status: string;
}

export interface SessionInfo {
  id: string;
  active: boolean;
}

export interface SessionResponse {
  account: SessionAccount | null;
  session: SessionInfo | null;
}

export const SIGN_IN_FAILURE_MESSAGE = "Invalid credentials";

export function loadSession(): Promise<SessionResponse> {
  return apiRequest<SessionResponse>("/api/auth/session");
}

export interface PasswordChangeValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface PasswordResetValues {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * POSTs a credential form and turns a `400 { errors }` response into field
 * errors. Field-error keys follow the server payloads of the auth routes.
 */
async function postCredentialForm<TErrors>(
  path: string,
  body: unknown,
): Promise<{ ok: true } | { ok: false; errors: TErrors }> {
  try {
    await apiRequest(path, { method: "POST", body: JSON.stringify(body) });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const payload = error.body as { errors?: TErrors } | null;
      if (error.status === 400 && payload && typeof payload === "object" && payload.errors) {
        return { ok: false, errors: payload.errors };
      }
    }
    throw error;
  }
}

/** REQ-1-3: change the password of the signed-in account. */
export function updatePassword(
  values: PasswordChangeValues,
): Promise<{ ok: true } | { ok: false; errors: PasswordChangeErrors }> {
  return postCredentialForm<PasswordChangeErrors>("/api/auth/password", values);
}

/** REQ-1-1-3: recover access with the fixed local verification code. */
export function resetPassword(
  values: PasswordResetValues,
): Promise<{ ok: true } | { ok: false; errors: PasswordResetErrors }> {
  return postCredentialForm<PasswordResetErrors>("/api/auth/password-reset", values);
}

/** REQ-1-1-1: create an account through the public registration form. */
export async function registerAccount(
  values: RegistrationValues,
): Promise<{ ok: true; account: SessionAccount } | { ok: false; errors: RegistrationErrors }> {
  try {
    const body = await apiRequest<{ account: SessionAccount }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(values),
    });
    return { ok: true, account: body.account };
  } catch (error) {
    if (error instanceof ApiError) {
      const payload = error.body as { errors?: RegistrationErrors } | null;
      if (error.status === 400 && payload && typeof payload === "object" && payload.errors) {
        return { ok: false, errors: payload.errors };
      }
    }
    throw error;
  }
}

export async function signIn(
  identifier: string,
  password: string,
): Promise<{ ok: true; account: SessionAccount } | { ok: false; error: string }> {
  try {
    const body = await apiRequest<{ account: SessionAccount }>("/api/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
    });
    return { ok: true, account: body.account };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 400) {
        return { ok: false, error: SIGN_IN_FAILURE_MESSAGE };
      }
    }
    throw error;
  }
}

export function signOut(): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>("/api/auth/sign-out", { method: "POST" });
}
