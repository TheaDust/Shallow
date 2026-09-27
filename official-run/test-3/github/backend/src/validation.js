// Pure validation rules shared by the API and reusable in tests.
// REQ-1-1-1: username = 1-39 lowercase ASCII letters, digits, or single hyphens,
// must not begin or end with a hyphen.
const USERNAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateUsername(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 39) return false;
  return USERNAME_RE.test(trimmed);
}

// REQ-1-1-1: after trimming leading/trailing whitespace the email must contain
// exactly one "@", be no longer than 254 characters, and have at least one dot
// and non-empty domain labels after the "@".
export function validateEmail(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length > 254) return false;
  const atIndex = trimmed.indexOf('@');
  if (atIndex < 0 || trimmed.indexOf('@', atIndex + 1) !== -1) return false;
  const domain = trimmed.slice(atIndex + 1);
  if (domain.indexOf('.') === -1) return false;
  const labels = domain.split('.');
  if (labels.some((label) => label.length === 0)) return false;
  return true;
}

// REQ-1-1-1: password must contain 12 to 128 characters, include at least one
// uppercase letter, one lowercase letter, one digit, and one non-alphanumeric
// special character, and contain no whitespace characters.
export function validatePassword(value) {
  if (typeof value !== 'string') return false;
  if (value.length < 12 || value.length > 128) return false;
  if (/\s/.test(value)) return false;
  if (!/[A-Z]/.test(value)) return false;
  if (!/[a-z]/.test(value)) return false;
  if (!/[0-9]/.test(value)) return false;
  if (!/[^A-Za-z0-9]/.test(value)) return false;
  return true;
}

// Fixed verification code used by the local recovery flow (REQ-1-1-3).
export const RECOVERY_CODE = '123456';
