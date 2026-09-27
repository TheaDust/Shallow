import { describe, expect, it } from 'vitest';
import {
  isValidPassword,
  isValidUsername,
  normalizeEmail,
  validateChangePasswordForm,
  validateEmail,
} from './validation';

describe('username rules', () => {
  it('accepts compliant usernames', () => {
    expect(isValidUsername('alice-dev')).toBe(true);
    expect(isValidUsername('pw-user-1')).toBe(true);
    expect(isValidUsername('a')).toBe(true);
    expect(isValidUsername('abc123')).toBe(true);
    expect(isValidUsername('a-b-c')).toBe(true);
    expect(isValidUsername('x'.repeat(39))).toBe(true);
  });

  it('rejects noncompliant usernames', () => {
    expect(isValidUsername('')).toBe(false);
    expect(isValidUsername('-abc')).toBe(false);
    expect(isValidUsername('abc-')).toBe(false);
    expect(isValidUsername('abc--def')).toBe(false);
    expect(isValidUsername('ABC')).toBe(false);
    expect(isValidUsername('a b')).toBe(false);
    expect(isValidUsername('x'.repeat(40))).toBe(false);
  });
});

describe('email rules', () => {
  it('accepts compliant emails', () => {
    expect(validateEmail('alice.dev@example.test')).toBe(true);
    expect(validateEmail('pw-user-1@example.test')).toBe(true);
    expect(validateEmail(' a@b.com ')).toBe(true);
    expect(validateEmail('@example.test')).toBe(true);
  });

  it('rejects noncompliant emails', () => {
    expect(validateEmail('')).toBe(false);
    expect(validateEmail('not-an-email')).toBe(false);
    expect(validateEmail('a@b')).toBe(false);
    expect(validateEmail('a@b.')).toBe(false);
    expect(validateEmail('a@.b')).toBe(false);
    expect(validateEmail('@example.test')).toBe(true);
    expect(validateEmail('a@@b.com')).toBe(false);
    expect(validateEmail('a@b..com')).toBe(false);
  });

  it('normalizes whitespace', () => {
    expect(normalizeEmail('  a@b.com  ')).toBe('a@b.com');
  });
});

describe('change-password form rules (REQ-1-3)', () => {
  it('requires the current password with the exact message', () => {
    const errors = validateChangePasswordForm({
      currentPassword: '',
      newPassword: 'New-password-456!',
      confirmPassword: 'New-password-456!',
    });
    expect(errors.currentPassword).toBe('Current password is required');
  });

  it('rejects a noncompliant new password', () => {
    const errors = validateChangePasswordForm({
      currentPassword: 'Valid-password-123!',
      newPassword: 'short',
      confirmPassword: 'short',
    });
    expect(errors.newPassword).toBe('Password requirements are not satisfied');
  });

  it('rejects a mismatched confirmation with the exact message', () => {
    const errors = validateChangePasswordForm({
      currentPassword: 'Valid-password-123!',
      newPassword: 'New-password-456!',
      confirmPassword: 'does-not-match',
    });
    expect(errors.confirmPassword).toBe('Password confirmation does not match');
  });

  it('requires every field', () => {
    const errors = validateChangePasswordForm({
      currentPassword: 'Valid-password-123!',
      newPassword: '',
      confirmPassword: '',
    });
    expect(errors.newPassword).toBe('New password is required');
    expect(errors.confirmPassword).toBe('Confirm password is required');
  });

  it('accepts a compliant identical confirmation', () => {
    const errors = validateChangePasswordForm({
      currentPassword: 'Valid-password-123!',
      newPassword: 'New-password-456!',
      confirmPassword: 'New-password-456!',
    });
    expect(errors).toEqual({});
  });
});

describe('password rules', () => {
  it('accepts compliant passwords', () => {
    expect(isValidPassword('Valid-password-123!')).toBe(true);
    expect(isValidPassword('Replacement-password-456!')).toBe(true);
    expect(isValidPassword('aB1!cdefghij')).toBe(true);
  });

  it('rejects noncompliant passwords', () => {
    expect(isValidPassword('short')).toBe(false);
    expect(isValidPassword('alllowercase123')).toBe(false);
    expect(isValidPassword('NOUPPERCASE123!')).toBe(false);
    expect(isValidPassword('NoDigits!!')).toBe(false);
    expect(isValidPassword('NoSpecial123')).toBe(false);
    expect(isValidPassword('Has Space123!')).toBe(false);
    expect(isValidPassword('Ab1!'.padEnd(129, 'x'))).toBe(false);
  });
});
