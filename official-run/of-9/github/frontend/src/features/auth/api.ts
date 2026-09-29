import { apiRequest, ApiError } from "../../lib/api";

export interface AccountInfo {
  username: string;
  email: string;
}

export interface SessionResponse {
  authenticated: boolean;
  account?: AccountInfo;
}

export type FieldErrors = Record<string, string>;

export async function fetchSession(): Promise<SessionResponse> {
  return apiRequest<SessionResponse>("/api/session");
}

export interface SignInInput {
  identifier: string;
  password: string;
}

export type SignInResult =
  | { ok: true; account: AccountInfo }
  | { ok: false; message: string };

export async function signIn(input: SignInInput): Promise<SignInResult> {
  try {
    const body = await apiRequest<{ account: AccountInfo }>("/api/signin", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, account: body.account };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      const body = error.body as { error?: unknown };
      return { ok: false, message: typeof body?.error === "string" ? body.error : "Invalid credentials" };
    }
    throw error;
  }
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  agreeToTerms: boolean;
}

export type RegisterResult = { ok: true } | { ok: false; errors: FieldErrors };

export async function registerAccount(input: RegisterInput): Promise<RegisterResult> {
  try {
    await apiRequest<{ ok: true }>("/api/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      const body = error.body as { errors?: FieldErrors };
      return { ok: false, errors: body?.errors ?? {} };
    }
    throw error;
  }
}

export async function signOut(): Promise<void> {
  await apiRequest<{ ok: true }>("/api/signout", { method: "POST" });
}

export async function requestPasswordReset(email: string): Promise<void> {
  await apiRequest<{ ok: true }>("/api/recovery/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export interface ResetPasswordInput {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}

export type ResetPasswordResult = { ok: true } | { ok: false; errors: FieldErrors };

export async function resetPassword(input: ResetPasswordInput): Promise<ResetPasswordResult> {
  try {
    await apiRequest<{ ok: true }>("/api/recovery/reset", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      const body = error.body as { errors?: FieldErrors };
      return { ok: false, errors: body?.errors ?? {} };
    }
    throw error;
  }
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export type ChangePasswordResult = { ok: true } | { ok: false; errors: FieldErrors };

export async function changePassword(input: ChangePasswordInput): Promise<ChangePasswordResult> {
  try {
    await apiRequest<{ ok: true }>("/api/password/change", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      const body = error.body as { errors?: FieldErrors };
      return { ok: false, errors: body?.errors ?? {} };
    }
    throw error;
  }
}
