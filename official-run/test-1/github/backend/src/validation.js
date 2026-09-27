// Account registration / password rules shared by the backend.
// The frontend mirrors these rules (frontend/src/validation.ts) so that
// invalid submissions can be reported immediately beside each field.

// 1 to 39 lowercase ASCII letters, digits, or single hyphens; must not
// begin or end with a hyphen; no consecutive hyphens.
export function isValidUsername(username) {
  if (typeof username !== 'string') return false;
  if (username.length < 1 || username.length > 39) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(username);
}

// After trimming leading/trailing whitespace: exactly one `@`, no longer
// than 254 characters, and at least one dot with non-empty domain labels
// after the `@` (the local part is not otherwise restricted).
export function validateEmail(email) {
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

export function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim() : '';
}

// 12 to 128 characters, at least one uppercase letter, one lowercase
// letter, one digit, and one non-alphanumeric special character, and no
// whitespace characters.
export function isValidPassword(password) {
  if (typeof password !== 'string') return false;
  if (password.length < 12 || password.length > 128) return false;
  if (/\s/.test(password)) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  return true;
}
