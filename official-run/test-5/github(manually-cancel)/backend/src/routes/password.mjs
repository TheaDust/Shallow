import {
  CURRENT_PASSWORD_MESSAGES,
  PASSWORD_CONFIRMATION_MESSAGE,
  RECOVERY_CODE,
  UNKNOWN_EMAIL_MESSAGE,
  VERIFICATION_CODE_MESSAGE,
  findAccountByEmail,
  hashPassword,
  normalizeEmail,
  validatePassword,
  verifyPassword,
} from "../domain/accounts.mjs";
import { getCurrentAccount } from "../lib/auth-context.mjs";
import { sendJson } from "../lib/http.mjs";

/**
 * REQ-1-3 (change account password) and REQ-1-1-3 (recover account access):
 * every credential change is validated, authorized and applied on the server.
 */

function readString(value) {
  return typeof value === "string" ? value : "";
}

/**
 * REQ-1-3: changes the password of the signed-in account only. Requires an
 * active session, the correct current password, and a compliant, confirmed new
 * password. The stored record is re-checked inside the atomic update so a
 * concurrent change cannot be overwritten by a stale request.
 */
export async function handlePasswordChange({ request, response, stores, body }) {
  const current = await getCurrentAccount(stores, request);
  if (!current) {
    sendJson(response, 401, { error: "Authentication required" });
    return;
  }

  const currentPassword = readString(body.currentPassword);
  const newPassword = readString(body.newPassword);
  const confirmPassword = readString(body.confirmPassword);

  const errors = {};
  if (!currentPassword) {
    errors.currentPassword = CURRENT_PASSWORD_MESSAGES.required;
  } else if (!verifyPassword(currentPassword, current.account.passwordHash)) {
    errors.currentPassword = CURRENT_PASSWORD_MESSAGES.incorrect;
  }
  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    errors.newPassword = passwordError;
  } else if (newPassword !== confirmPassword) {
    errors.confirmPassword = PASSWORD_CONFIRMATION_MESSAGE;
  }
  if (Object.keys(errors).length > 0) {
    sendJson(response, 400, { error: "Password update failed", errors });
    return;
  }

  let outcome = null;
  await stores.accounts.update((state) => {
    // Compare-and-set: the current password must still match the stored record.
    const account = state.accounts.find((candidate) => candidate.id === current.account.id);
    if (!account || !verifyPassword(currentPassword, account.passwordHash)) {
      outcome = {
        ok: false,
        errors: { currentPassword: CURRENT_PASSWORD_MESSAGES.incorrect },
      };
      return;
    }
    account.passwordHash = hashPassword(newPassword);
    account.passwordUpdatedAt = new Date().toISOString();
    outcome = { ok: true };
  });

  if (!outcome.ok) {
    sendJson(response, 400, { error: "Password update failed", errors: outcome.errors });
    return;
  }
  sendJson(response, 200, { ok: true });
}

/**
 * REQ-1-1-3: applies a recovery request. The local product sends no email, so a
 * request only carries the email, the fixed code and the new credentials. An
 * unknown email is reported beside the Email field, and no stored record is
 * touched unless email, code, password rules and confirmation all hold.
 */
export async function handlePasswordReset({ response, stores, body }) {
  const email = normalizeEmail(readString(body.email));
  const code = readString(body.code);
  const newPassword = readString(body.newPassword);
  const confirmPassword = readString(body.confirmPassword);

  const errors = {};
  const passwordError = validatePassword(newPassword);
  if (code !== RECOVERY_CODE) errors.code = VERIFICATION_CODE_MESSAGE;
  if (passwordError) {
    errors.newPassword = passwordError;
  } else if (newPassword !== confirmPassword) {
    errors.confirmPassword = PASSWORD_CONFIRMATION_MESSAGE;
  }
  const { accounts } = await stores.accounts.read();
  if (!findAccountByEmail(accounts, email)) errors.email = UNKNOWN_EMAIL_MESSAGE;

  if (Object.keys(errors).length > 0) {
    sendJson(response, 400, { error: "Password reset failed", errors });
    return;
  }

  let applied = false;
  await stores.accounts.update((state) => {
    const account = findAccountByEmail(state.accounts, email);
    if (!account) return;
    account.passwordHash = hashPassword(newPassword);
    account.passwordUpdatedAt = new Date().toISOString();
    applied = true;
  });

  if (!applied) {
    sendJson(response, 400, {
      error: "Password reset failed",
      errors: { email: UNKNOWN_EMAIL_MESSAGE },
    });
    return;
  }
  sendJson(response, 200, { ok: true });
}
