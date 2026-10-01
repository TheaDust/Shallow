import { ApiError, apiRequest } from "../../lib/api";

export interface RegistrationInput {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  agreeToTerms: boolean;
}

export interface RegistrationFieldErrors {
  username?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  terms?: string;
}

export interface RecoveryFieldErrors {
  email?: string;
  code?: string;
  password?: string;
  confirmPassword?: string;
}

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface PasswordChangeFieldErrors {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

export interface SubmitResult<E> {
  ok: boolean;
  errors: E;
  message?: string;
}

function failedRequest<E>(error: unknown, fallback: string): SubmitResult<E> {
  if (error instanceof ApiError) {
    const fields = (error.body as { fields?: E } | null)?.fields;
    if (error.status === 400 && fields) return { ok: false, errors: fields };
    return { ok: false, errors: {} as E, message: error.message };
  }
  return { ok: false, errors: {} as E, message: fallback };
}

export async function registerAccount(input: RegistrationInput): Promise<SubmitResult<RegistrationFieldErrors>> {
  try {
    await apiRequest("/api/accounts", { method: "POST", body: JSON.stringify(input) });
    return { ok: true, errors: {} };
  } catch (error) {
    return failedRequest<RegistrationFieldErrors>(
      error,
      "Unable to create the account right now. Please try again.",
    );
  }
}

export interface RecoveryRequestResult {
  ok: boolean;
  code?: string;
  message?: string;
}

export async function requestPasswordRecovery(email: string): Promise<RecoveryRequestResult> {
  try {
    const payload = await apiRequest<{ code?: string }>("/api/password-recovery/requests", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    return { ok: true, code: payload.code };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Unable to start password recovery.",
    };
  }
}

export interface RecoveryCompletionInput {
  email: string;
  code: string;
  password: string;
  confirmPassword: string;
}

/** Security-settings password change (REQ-1-3); requires the current session. */
export async function changeAccountPassword(
  input: PasswordChangeInput,
): Promise<SubmitResult<PasswordChangeFieldErrors>> {
  try {
    await apiRequest("/api/account/password", { method: "POST", body: JSON.stringify(input) });
    return { ok: true, errors: {} };
  } catch (error) {
    return failedRequest<PasswordChangeFieldErrors>(
      error,
      "Unable to update the password right now. Please try again.",
    );
  }
}

export async function completePasswordRecovery(
  input: RecoveryCompletionInput,
): Promise<SubmitResult<RecoveryFieldErrors>> {
  try {
    await apiRequest("/api/password-recovery/completions", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, errors: {} };
  } catch (error) {
    return failedRequest<RecoveryFieldErrors>(
      error,
      "Unable to reset the password right now. Please try again.",
    );
  }
}
