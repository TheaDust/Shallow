import { validateUsername, validateEmail, validatePassword, RECOVERY_CODE } from './validation.js';
import { verifyPassword } from './store.js';

// REQ-1-1-1: Register. All invalid fields are reported together; on success the
// account is stored with verified-email status and can sign in immediately.
export function register(store, input) {
  const username = typeof input.username === 'string' ? input.username : '';
  const email = typeof input.email === 'string' ? input.email : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const confirmPassword = typeof input.confirmPassword === 'string' ? input.confirmPassword : '';
  const agreeToTerms = input.agreeToTerms === true;

  const fieldErrors = {};

  if (!validateUsername(username)) {
    fieldErrors.username = 'Username format is invalid';
  } else if (store.findAccountByUsername(username)) {
    fieldErrors.username = 'Username already exists';
  }

  if (!validateEmail(email)) {
    fieldErrors.email = 'Email format is invalid';
  } else if (store.findAccountByEmail(email)) {
    fieldErrors.email = 'Email already exists';
  }

  if (!validatePassword(password)) {
    fieldErrors.password = 'Password requirements are not satisfied';
  }

  if (password !== confirmPassword) {
    fieldErrors.confirmPassword = 'Password confirmation does not match';
  }

  if (!agreeToTerms) {
    fieldErrors.agreeToTerms = 'Agree to terms is required';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  const account = store.createAccount({ username, email, password });
  return { ok: true, account };
}

// REQ-1-1-2: Sign in. Unknown identifier, wrong password, and unavailable
// account all produce the exact same generic message and no session.
export function signIn(store, input) {
  const identifier = typeof input.identifier === 'string' ? input.identifier : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const account = store.findAccountByIdentifier(identifier);

  if (!account || account.status !== 'active' || !verifyPassword(account, password)) {
    return { ok: false, message: 'Invalid credentials' };
  }

  const session = store.createSession(account.id);
  return {
    ok: true,
    session,
    user: { id: account.id, username: account.username, email: account.email },
  };
}

// REQ-1-2: Sign out. Only the current session is invalidated.
export function signOut(store, sessionId) {
  store.invalidateSession(sessionId);
  return { ok: true };
}

// REQ-1-1-3: recovery request. Both registered and unknown emails enter the
// same next step and display the same fixed code; existence is never disclosed.
export function recoverRequest(_store, _input) {
  return { ok: true, code: RECOVERY_CODE };
}

// REQ-1-3: Change account password. Requires the authenticated account; the
// current password must be correct, the new password compliant with the
// REQ-1-1-1 rules, and the confirmation character-for-character identical.
// On success the account's password is updated and its sessions are
// invalidated (REQ-1), so the new credential applies to later sign-ins.
export function changePassword(store, accountId, input) {
  const currentPassword = typeof input.currentPassword === 'string' ? input.currentPassword : '';
  const newPassword = typeof input.newPassword === 'string' ? input.newPassword : '';
  const confirmPassword = typeof input.confirmPassword === 'string' ? input.confirmPassword : '';

  const account = store.findAccountById(accountId);
  if (!account) return { ok: false, message: 'Not signed in' };

  const fieldErrors = {};
  if (currentPassword === '') {
    fieldErrors.currentPassword = 'Current password is required';
  } else if (!verifyPassword(account, currentPassword)) {
    fieldErrors.currentPassword = 'Current password is incorrect';
  }
  if (!validatePassword(newPassword)) {
    fieldErrors.newPassword = 'Password requirements are not satisfied';
  }
  if (newPassword !== confirmPassword) {
    fieldErrors.confirmPassword = 'Password confirmation does not match';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  store.updateAccountPassword(account.id, newPassword);
  return { ok: true };
}

// REQ-1-1-3: recovery reset. Only the correct fixed code together with a
// compliant matching password updates the account matching the email.
export function recoverReset(store, input) {
  const email = typeof input.email === 'string' ? input.email : '';
  const code = typeof input.code === 'string' ? input.code : '';
  const newPassword = typeof input.newPassword === 'string' ? input.newPassword : '';
  const confirmPassword = typeof input.confirmPassword === 'string' ? input.confirmPassword : '';

  const fieldErrors = {};
  const account = store.findAccountByEmail(email);
  if (!account) {
    fieldErrors.email = 'Email is not registered';
  }
  if (code !== RECOVERY_CODE) {
    fieldErrors.code = 'Verification code is invalid';
  }
  if (!validatePassword(newPassword)) {
    fieldErrors.newPassword = 'Password requirements are not satisfied';
  }
  if (newPassword !== confirmPassword) {
    fieldErrors.confirmPassword = 'Password confirmation does not match';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  store.updateAccountPassword(account.id, newPassword);
  return { ok: true };
}
