// Shared input validators for account registration, sign-in and password recovery.

export function isValidUsername(username) {
  return (
    typeof username === "string" &&
    username.length >= 1 &&
    username.length <= 39 &&
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(username)
  );
}

export function normalizeEmail(email) {
  return typeof email === "string" ? email.trim() : "";
}

export function isValidEmail(email) {
  const value = normalizeEmail(email);
  if (value.length === 0 || value.length > 254) return false;
  const atIndex = value.indexOf("@");
  if (atIndex <= 0 || atIndex !== value.lastIndexOf("@")) return false;
  const local = value.slice(0, atIndex);
  const domain = value.slice(atIndex + 1);
  if (!local || !domain) return false;
  if (!domain.includes(".")) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => label.length > 0);
}

export function passwordMeetsRequirements(password) {
  return (
    typeof password === "string" &&
    password.length >= 12 &&
    password.length <= 128 &&
    !/\s/.test(password) &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}
