import { ApiError, apiRequest } from "./api";

export interface SessionUser {
  id: string;
  username: string;
  email: string;
}

export interface FieldErrors {
  username?: string;
  email?: string;
  password?: string;
  currentPassword?: string;
  confirmPassword?: string;
  newPassword?: string;
  terms?: string;
  code?: string;
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  agreeToTerms: boolean;
}

export type RegisterResult = { ok: true } | { ok: false; fieldErrors: FieldErrors };

export type SignInResult = { ok: true; user: SessionUser } | { ok: false; message: string };

export interface PasswordResetInput {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}

export type PasswordResetResult =
  | { ok: true; message: string }
  | { ok: false; fieldErrors: FieldErrors };

export interface SessionSummary {
  /** Public row identifier; the browser never receives the secret session id. */
  id: string;
  device: string;
  lastActiveAt: string;
  createdAt: string;
  current: boolean;
}

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export type PasswordChangeResult =
  | { ok: true; message: string }
  | { ok: false; fieldErrors: FieldErrors };

function fieldErrorsFrom(error: unknown): FieldErrors {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    const body = error.body as { fieldErrors?: FieldErrors };
    return body.fieldErrors ?? {};
  }
  return {};
}

/**
 * The login state of this browser. `revoked` is true when the browser still
 * holds a session the server no longer accepts (its session was ended from
 * another browser), which REQ-1-4 answers with the sign-in page.
 */
export interface SessionState {
  user: SessionUser | null;
  revoked: boolean;
}

export async function fetchSession(): Promise<SessionState> {
  const data = await apiRequest<{ user: SessionUser | null; revoked?: boolean }>("/api/session");
  return { user: data.user ?? null, revoked: data.user ? false : data.revoked === true };
}

export async function registerAccount(input: RegisterInput): Promise<RegisterResult> {
  try {
    await apiRequest("/api/auth/register", { method: "POST", body: JSON.stringify(input) });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error) };
    }
    throw error;
  }
}

export async function signIn(identifier: string, password: string): Promise<SignInResult> {
  try {
    const data = await apiRequest<{ user: SessionUser }>("/api/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
    });
    return { ok: true, user: data.user };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      const body = error.body as { message?: string } | null;
      return { ok: false, message: body?.message ?? "Invalid credentials" };
    }
    throw error;
  }
}

/** Ends the current browser session on the server; the cookie is cleared with it. */
export async function signOut(): Promise<void> {
  await apiRequest("/api/auth/sign-out", { method: "POST", body: JSON.stringify({}) });
}

export async function requestPasswordReset(email: string): Promise<{ code: string }> {
  return apiRequest<{ code: string }>("/api/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function changePassword(input: PasswordChangeInput): Promise<PasswordChangeResult> {
  try {
    const data = await apiRequest<{ message: string }>("/api/account/password", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, message: data.message };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error) };
    }
    throw error;
  }
}

/** The current browser session plus the other active sessions of the account. */
export async function fetchActiveSessions(): Promise<SessionSummary[]> {
  const data = await apiRequest<{ sessions: SessionSummary[] }>("/api/account/sessions");
  return data.sessions ?? [];
}

/** Ends one other browser session of the account. */
export async function revokeSession(sessionId: string): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/api/account/sessions/${encodeURIComponent(sessionId)}/revoke`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export async function resetPassword(input: PasswordResetInput): Promise<PasswordResetResult> {
  try {
    const data = await apiRequest<{ message: string }>("/api/auth/password-reset", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, message: data.message };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, fieldErrors: fieldErrorsFrom(error) };
    }
    throw error;
  }
}
