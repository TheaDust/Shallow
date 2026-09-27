import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUsername, validateEmail, validatePassword, RECOVERY_CODE } from '../src/validation.js';

test('username: accepts compliant values', () => {
  assert.equal(validateUsername('alice-dev'), true);
  assert.equal(validateUsername('a'), true);
  assert.equal(validateUsername('a'.repeat(39)), true);
  assert.equal(validateUsername('pw-user-1'), true);
  assert.equal(validateUsername('x-y-z'), true);
});

test('username: rejects invalid values', () => {
  assert.equal(validateUsername(''), false);
  assert.equal(validateUsername('-hyphen'), false);
  assert.equal(validateUsername('hyphen-'), false);
  assert.equal(validateUsername('double--hyphen'), false);
  assert.equal(validateUsername('Uppercase'), false);
  assert.equal(validateUsername('has space'), false);
  assert.equal(validateUsername('a'.repeat(40)), false);
  assert.equal(validateUsername('under_score'), false);
  assert.equal(validateUsername('alice.dev'), false);
  assert.equal(validateUsername(undefined), false);
});

test('email: accepts compliant values including @example.test', () => {
  assert.equal(validateEmail('alice.dev@example.test'), true);
  assert.equal(validateEmail('@example.test'), true);
  assert.equal(validateEmail('user@example.com'), true);
  assert.equal(validateEmail('  padded@example.test  '), true);
});

test('email: rejects invalid values', () => {
  assert.equal(validateEmail('not-an-email'), false);
  assert.equal(validateEmail(''), false);
  assert.equal(validateEmail('a@b'), false);
  assert.equal(validateEmail('a@b@c'), false);
  assert.equal(validateEmail('a@.example.test'), false);
  assert.equal(validateEmail('a@example..test'), false);
  assert.equal(validateEmail('a@example.'), false);
  assert.equal(validateEmail('a@example'), false);
  assert.equal(validateEmail(`x@${'a'.repeat(250)}.test`), false);
  assert.equal(validateEmail(undefined), false);
});

test('password: accepts compliant values', () => {
  assert.equal(validatePassword('Valid-password-123!'), true);
  assert.equal(validatePassword('Replacement-password-456!'), true);
  assert.equal(validatePassword('aB1!'.repeat(3)), true); // 12 chars
  assert.equal(validatePassword(`aB1!${'x'.repeat(124)}`), true); // 128 chars
});

test('password: rejects invalid values', () => {
  assert.equal(validatePassword('short'), false);
  assert.equal(validatePassword(''), false);
  assert.equal(validatePassword('alllowercase123!'), false);
  assert.equal(validatePassword('ALLUPPERCASE123!'), false);
  assert.equal(validatePassword('NoDigitsHere!'), false);
  assert.equal(validatePassword('NoSpecialChars123'), false);
  assert.equal(validatePassword('Has Space 123!'), false);
  assert.equal(validatePassword('Has\tTab123!'), false);
  assert.equal(validatePassword('aB1!'.repeat(33)), false); // 132 chars
  assert.equal(validatePassword(`aB1!${'x'.repeat(125)}`), false); // 129 chars
  assert.equal(validatePassword(undefined), false);
});

test('recovery code constant is the fixed value', () => {
  assert.equal(RECOVERY_CODE, '123456');
});
