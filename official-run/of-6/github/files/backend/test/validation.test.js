'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  usernameFormatValid,
  emailFormatValid,
  passwordRequirementsSatisfied,
  teamNameFormatValid,
  validateRegistration,
  validateRecoveryReset,
  validateTeamCreation,
} = require('../src/validation');

test('username format accepts valid usernames', () => {
  for (const valid of ['a', 'alice', 'alice-dev', 'a1b2c3', 'pw-user-abc123', 'x'.repeat(39)]) {
    assert.equal(usernameFormatValid(valid), true, `expected valid: ${valid}`);
  }
});

test('username format rejects invalid usernames', () => {
  const invalid = [
    '',
    '-alice',
    'alice-',
    'alice--dev',
    'Alice',
    'alice_dev',
    'alice dev',
    'alice!',
    'x'.repeat(40),
  ];
  for (const bad of invalid) {
    assert.equal(usernameFormatValid(bad), false, `expected invalid: ${bad}`);
  }
});

test('email format accepts valid emails', () => {
  const valid = [
    'alice.dev@example.test',
    'pw-user-abc@example.test',
    'a@b.c',
    'user+tag@domain.example',
    '  alice.dev@example.test  ',
  ];
  for (const good of valid) {
    assert.equal(emailFormatValid(good), true, `expected valid: ${good}`);
  }
});

test('email format rejects invalid emails', () => {
  const invalid = [
    '',
    'not-an-email',
    'a@b',
    'a@b.',
    'a@.b',
    'a@@b.c',
    'a@b..c',
    'a@b c',
    'x'.repeat(255),
  ];
  for (const bad of invalid) {
    assert.equal(emailFormatValid(bad), false, `expected invalid: ${bad}`);
  }
});

test('password requirements accept compliant passwords', () => {
  for (const good of [
    'Valid-password-123!',
    'Replacement-password-456!',
    'Required-password-789!',
    'New-password-456!',
    'Ab1!'.padEnd(12, 'x'),
  ]) {
    assert.equal(passwordRequirementsSatisfied(good), true, `expected valid: ${good}`);
  }
});

test('password requirements reject noncompliant passwords', () => {
  const invalid = [
    '',
    'short',
    'lowercaseonly123!',
    'UPPERCASEONLY123!',
    'NoSpecial12345',
    'NoDigitsHere!!',
    'Has space1!',
    'Has\ttab1!',
    'x'.repeat(129),
  ];
  for (const bad of invalid) {
    assert.equal(passwordRequirementsSatisfied(bad), false, `expected invalid: ${bad}`);
  }
});

test('registration validation reports every violated field together', () => {
  const errors = validateRegistration(
    {
      username: '-bad-user',
      email: 'not-an-email',
      password: 'short',
      confirmPassword: 'different',
      agreeToTerms: false,
    },
    () => false,
    () => false
  );
  assert.deepEqual(Object.keys(errors).sort(), [
    'agreeToTerms',
    'confirmPassword',
    'email',
    'password',
    'username',
  ]);
  assert.equal(errors.username, 'Username format is invalid');
  assert.equal(errors.email, 'Email format is invalid');
  assert.equal(errors.password, 'Password requirements are not satisfied');
  assert.equal(errors.agreeToTerms, 'Agree to terms is required');
});

test('registration validation reports duplicate username while keeping email valid', () => {
  const errors = validateRegistration(
    {
      username: 'alice-dev',
      email: 'new.user@example.test',
      password: 'Valid-password-123!',
      confirmPassword: 'Valid-password-123!',
      agreeToTerms: true,
    },
    () => true,
    () => false
  );
  assert.equal(errors.username, 'Username already exists');
  assert.equal(errors.email, undefined);
});

test('registration validation reports duplicate email', () => {
  const errors = validateRegistration(
    {
      username: 'brand-new',
      email: 'alice.dev@example.test',
      password: 'Valid-password-123!',
      confirmPassword: 'Valid-password-123!',
      agreeToTerms: true,
    },
    () => false,
    () => true
  );
  assert.equal(errors.email, 'Email already exists');
  assert.equal(errors.username, undefined);
});

test('registration validation requires every field and the terms', () => {
  const errors = validateRegistration(
    {
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
      agreeToTerms: false,
    },
    () => false,
    () => false
  );
  assert.equal(errors.username, 'Username is required');
  assert.equal(errors.email, 'Email is required');
  assert.equal(errors.password, 'Password is required');
  assert.equal(errors.confirmPassword, 'Confirm password is required');
  assert.equal(errors.agreeToTerms, 'Agree to terms is required');
});

test('registration validation accepts a fully compliant payload', () => {
  const errors = validateRegistration(
    {
      username: 'pw-user-abc',
      email: 'pw-user-abc@example.test',
      password: 'Valid-password-123!',
      confirmPassword: 'Valid-password-123!',
      agreeToTerms: true,
    },
    () => false,
    () => false
  );
  assert.deepEqual(errors, {});
});

test('recovery reset validation reports every violated field together', () => {
  const errors = validateRecoveryReset(
    {
      email: 'unknown@example.test',
      code: '000000',
      newPassword: 'short',
      confirmPassword: 'different',
    },
    () => false
  );
  assert.equal(errors.email, 'Email is not registered');
  assert.equal(errors.verificationCode, 'Verification code is invalid');
  assert.equal(errors.newPassword, 'Password requirements are not satisfied');
  assert.equal(errors.confirmPassword, 'Password confirmation does not match');
});

test('recovery reset validation accepts a fully compliant payload', () => {
  const errors = validateRecoveryReset(
    {
      email: 'alice.dev@example.test',
      code: '123456',
      newPassword: 'Replacement-password-456!',
      confirmPassword: 'Replacement-password-456!',
    },
    () => true
  );
  assert.deepEqual(errors, {});
});

test('recovery reset validation distinguishes empty required fields', () => {
  const errors = validateRecoveryReset(
    {
      email: '',
      code: '',
      newPassword: '',
      confirmPassword: '',
    },
    () => true
  );
  assert.equal(errors.email, 'Email is required');
  assert.equal(errors.verificationCode, 'Verification code is required');
  assert.equal(errors.newPassword, 'New password is required');
  assert.equal(errors.confirmPassword, 'Confirm password is required');
});

test('recovery reset validation rejects a malformed email and a malformed code', () => {
  const errors = validateRecoveryReset(
    {
      email: 'not-an-email',
      code: '1234567',
      newPassword: 'Replacement-password-456!',
      confirmPassword: 'Replacement-password-456!',
    },
    () => true
  );
  assert.equal(errors.email, 'Email format is invalid');
  assert.equal(errors.verificationCode, 'Verification code is invalid');
});

test('team name format accepts valid team names (1-50, lowercase ASCII, digits, hyphens)', () => {
  for (const valid of [
    'a',
    'mobile-team',
    'frontend-team',
    'a--b',
    'a-b-c-9',
    'x'.repeat(50),
  ]) {
    assert.equal(teamNameFormatValid(valid), true, `expected valid: ${valid}`);
  }
});

test('team name format rejects invalid team names', () => {
  for (const invalid of [
    '',
    'x'.repeat(51),
    'MobileTeam',
    'mobile_team',
    'mobile team',
    '-mobile',
    'mobile-',
    '-mobile-',
    null,
    undefined,
    123,
  ]) {
    assert.equal(teamNameFormatValid(invalid), false, `expected invalid: ${JSON.stringify(invalid)}`);
  }
});

test('team creation validation reports name and parent errors together', () => {
  const errors = validateTeamCreation(
    { name: '', parentTeamName: 'other-team' },
    {
      isTeamNameTaken: () => false,
      isParentInOrganization: () => false,
    }
  );
  assert.equal(errors.name, 'Team name is required');
  assert.equal(errors.parentTeam, 'Parent team is not in this organization');
});

test('team creation validation distinguishes malformed, duplicate and cyclic cases', () => {
  const malformed = validateTeamCreation(
    { name: '-bad' },
    { isTeamNameTaken: () => false, isParentInOrganization: () => true }
  );
  assert.equal(malformed.name, 'Team name format is invalid');

  const duplicate = validateTeamCreation(
    { name: 'frontend-team' },
    { isTeamNameTaken: () => true, isParentInOrganization: () => true }
  );
  assert.equal(duplicate.name, 'Team name already exists');

  const cycle = validateTeamCreation(
    { name: 'new-team', parentTeamName: 'new-team' },
    {
      isTeamNameTaken: () => false,
      isParentInOrganization: () => true,
      isParentCycle: () => true,
    }
  );
  assert.equal(cycle.parentTeam, 'Cyclic team hierarchy is not allowed');
});

test('team creation validation accepts a compliant payload without description or parent', () => {
  const errors = validateTeamCreation(
    { name: 'mobile-team' },
    { isTeamNameTaken: () => false, isParentInOrganization: () => false }
  );
  assert.deepEqual(errors, {});
});
