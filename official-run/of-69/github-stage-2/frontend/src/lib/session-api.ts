import { apiRequest } from "./api";

export interface Account {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  status: string;
}

export interface RegistrationInput {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  agreeToTerms: boolean;
}

export interface ResetPasswordInput {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export async function fetchSession(): Promise<Account | null> {
  const body = await apiRequest<{ account: Account | null }>("/api/session");
  return body.account;
}

export async function registerAccount(input: RegistrationInput): Promise<Account> {
  const body = await apiRequest<{ account: Account }>("/api/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.account;
}

export async function signIn(identifier: string, password: string): Promise<Account> {
  const body = await apiRequest<{ account: Account }>("/api/signin", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
  return body.account;
}

export async function signOut(): Promise<void> {
  await apiRequest<void>("/api/signout", { method: "POST" });
}

export async function startRecovery(email: string): Promise<string> {
  const body = await apiRequest<{ code: string }>("/api/recovery/start", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  return body.code;
}

export async function resetPassword(input: ResetPasswordInput): Promise<string> {
  const body = await apiRequest<{ message: string }>("/api/recovery/reset", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.message;
}

/**
 * Changes the password of the currently signed-in account. Resolves with the
 * visible confirmation message; callers read field errors from ApiError.body.
 */
export async function changePassword(input: ChangePasswordInput): Promise<string> {
  const body = await apiRequest<{ message: string }>("/api/account/password", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.message;
}
