// Account registration / password rules. These mirror the backend rules
// (backend/src/validation.js) so field errors are identical on both sides.

export function isValidUsername(username: unknown): boolean {
  if (typeof username !== 'string') return false;
  if (username.length < 1 || username.length > 39) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(username);
}

export function validateEmail(email: unknown): boolean {
  const trimmed = typeof email === 'string' ? email.trim() : '';
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  const atCount = (trimmed.match(/@/g) || []).length;
  if (atCount !== 1) return false;
  const domain = trimmed.split('@').slice(1).join('@');
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  if (labels.some((label) => label.length === 0)) return false;
  return true;
}

export function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim() : '';
}

export function isValidPassword(password: unknown): boolean {
  if (typeof password !== 'string') return false;
  if (password.length < 12 || password.length > 128) return false;
  if (/\s/.test(password)) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  return true;
}

export interface FieldErrors {
  [field: string]: string;
}

export interface RegisterFormInput {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  terms: boolean;
}

export function validateRegisterForm(input: RegisterFormInput): FieldErrors {
  const errors: FieldErrors = {};
  if (!input.username) {
    errors.username = 'Username is required';
  } else if (!isValidUsername(input.username)) {
    errors.username = 'Username format is invalid';
  }
  if (!input.email) {
    errors.email = 'Email is required';
  } else if (!validateEmail(input.email)) {
    errors.email = 'Email format is invalid';
  }
  if (!input.password) {
    errors.password = 'Password is required';
  } else if (!isValidPassword(input.password)) {
    errors.password = 'Password requirements are not satisfied';
  }
  if (!input.confirmPassword) {
    errors.confirmPassword = 'Confirm password is required';
  } else if (input.confirmPassword !== input.password) {
    errors.confirmPassword = 'Passwords do not match';
  }
  if (!input.terms) {
    errors.terms = 'Agree to terms is required';
  }
  return errors;
}

export function validateResetForm(input: {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (!input.email) {
    errors.email = 'Email is required';
  }
  if (!input.code) {
    errors.code = 'Verification code is required';
  } else if (input.code !== '123456') {
    errors.code = 'Verification code is invalid';
  }
  if (!input.newPassword) {
    errors.newPassword = 'New password is required';
  } else if (!isValidPassword(input.newPassword)) {
    errors.newPassword = 'Password requirements are not satisfied';
  }
  if (!input.confirmPassword) {
    errors.confirmPassword = 'Confirm password is required';
  } else if (input.confirmPassword !== input.newPassword) {
    errors.confirmPassword = 'Passwords do not match';
  }
  return errors;
}

// Security-form rules for changing the current account password (REQ-1-3).
// Whether the current password is correct is only known server-side, so this
// validation covers required fields, compliance, and confirmation equality.
export function validateChangePasswordForm(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (!input.currentPassword) {
    errors.currentPassword = 'Current password is required';
  }
  if (!input.newPassword) {
    errors.newPassword = 'New password is required';
  } else if (!isValidPassword(input.newPassword)) {
    errors.newPassword = 'Password requirements are not satisfied';
  }
  if (!input.confirmPassword) {
    errors.confirmPassword = 'Confirm password is required';
  } else if (input.confirmPassword !== input.newPassword) {
    errors.confirmPassword = 'Password confirmation does not match';
  }
  return errors;
}
