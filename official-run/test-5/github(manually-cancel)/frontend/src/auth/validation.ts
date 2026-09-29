/**
 * Client mirror of the account rules (REQ-1-1-1). The backend re-validates every
 * request; these helpers only provide immediate field feedback in the browser.
 */
export const USERNAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const USERNAME_MAX_LENGTH = 39;
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const USERNAME_MESSAGES = {
  format: "Username format is invalid",
  taken: "Username already exists",
} as const;
export const EMAIL_MESSAGES = {
  format: "Email format is invalid",
  taken: "Email already exists",
} as const;
export const PASSWORD_MESSAGE = "Password requirements are not satisfied";
export const PASSWORD_CONFIRMATION_MESSAGE = "Password confirmation does not match";
export const TERMS_MESSAGE = "Agree to terms is required";

/** REQ-1-3 / REQ-1-1-3 credential-change messages (the server repeats these checks). */
export const CURRENT_PASSWORD_REQUIRED_MESSAGE = "Current password is required";
export const CURRENT_PASSWORD_INCORRECT_MESSAGE = "Current password is incorrect";
/** The fixed local verification code shown by the recovery flow. */
export const RECOVERY_CODE = "123456";
export const VERIFICATION_CODE_MESSAGE = "Verification code is invalid";
export const UNKNOWN_EMAIL_MESSAGE = "Email is not registered";

export interface RegistrationValues {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  agreeToTerms: boolean;
}

export interface RegistrationErrors {
  username?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  terms?: string;
}

/** REQ-1-3: field errors of the “Password and authentication” form. */
export interface PasswordChangeErrors {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

/** REQ-1-1-3: field errors of the password-reset step. */
export interface PasswordResetErrors {
  email?: string;
  code?: string;
  newPassword?: string;
  confirmPassword?: string;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validateUsername(value: string): string | null {
  if (value.length < 1 || value.length > USERNAME_MAX_LENGTH) return USERNAME_MESSAGES.format;
  if (!USERNAME_PATTERN.test(value)) return USERNAME_MESSAGES.format;
  return null;
}

export function validateEmail(value: string): string | null {
  const email = normalizeEmail(value);
  if (!email || email.length > EMAIL_MAX_LENGTH) return EMAIL_MESSAGES.format;
  if (/\s/.test(email)) return EMAIL_MESSAGES.format;
  const parts = email.split("@");
  if (parts.length !== 2) return EMAIL_MESSAGES.format;
  const [local, domain] = parts;
  if (!local) return EMAIL_MESSAGES.format;
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => label.length === 0)) return EMAIL_MESSAGES.format;
  return null;
}

export function validatePassword(value: string): string | null {
  const compliant =
    value.length >= PASSWORD_MIN_LENGTH &&
    value.length <= PASSWORD_MAX_LENGTH &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value) &&
    !/\s/.test(value);
  return compliant ? null : PASSWORD_MESSAGE;
}

export function validateRegistration(values: RegistrationValues): RegistrationErrors {
  const errors: RegistrationErrors = {};
  const usernameError = validateUsername(values.username);
  if (usernameError) errors.username = usernameError;
  const emailError = validateEmail(values.email);
  if (emailError) errors.email = emailError;
  const passwordError = validatePassword(values.password);
  if (passwordError) errors.password = passwordError;
  if (!passwordError && values.confirmPassword !== values.password) {
    errors.confirmPassword = PASSWORD_CONFIRMATION_MESSAGE;
  }
  if (!values.agreeToTerms) errors.terms = TERMS_MESSAGE;
  return errors;
}

export function hasErrors(errors: RegistrationErrors): boolean {
  return Object.keys(errors).length > 0;
}
