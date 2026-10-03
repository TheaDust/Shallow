import { ApiError, apiRequest } from "../lib/api";

export interface Account {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
}

export interface FieldErrors {
  username?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  terms?: string;
  code?: string;
  currentPassword?: string;
  newPassword?: string;
  organizationName?: string;
  displayName?: string;
  teamName?: string;
  parentTeam?: string;
  owner?: string;
  visibility?: string;
  role?: string;
  name?: string;
  path?: string;
  message?: string;
  branch?: string;
}

export interface SessionResponse {
  account: Account | null;
}

export interface RegisterResponse {
  account: Account;
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  agreeToTerms: boolean;
}

export interface RecoveryResponse {
  email: string;
  verificationCode: string;
}

export interface ResetPasswordInput {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ResetPasswordResponse {
  message: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ChangePasswordResponse {
  message: string;
}

export function fetchSession(): Promise<SessionResponse> {
  return apiRequest<SessionResponse>("/api/session");
}

export function signInRequest(identifier: string, password: string): Promise<SessionResponse> {
  return apiRequest<SessionResponse>("/api/session", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
}

export function signOutRequest(): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>("/api/session", { method: "DELETE" });
}

export function registerAccount(input: RegisterInput): Promise<RegisterResponse> {
  return apiRequest<RegisterResponse>("/api/accounts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function requestPasswordRecovery(email: string): Promise<RecoveryResponse> {
  return apiRequest<RecoveryResponse>("/api/password/forgot", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(input: ResetPasswordInput): Promise<ResetPasswordResponse> {
  return apiRequest<ResetPasswordResponse>("/api/password/reset", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function changePassword(input: ChangePasswordInput): Promise<ChangePasswordResponse> {
  return apiRequest<ChangePasswordResponse>("/api/password/change", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Reads the per-field messages the backend reports for a rejected submission. */
export function fieldErrorsOf(error: unknown): FieldErrors {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    const fields = (error.body as { fields?: FieldErrors }).fields;
    if (fields && typeof fields === "object") return fields;
  }
  return {};
}

export function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;
}
