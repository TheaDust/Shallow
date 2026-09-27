import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidPassword,
  isValidUsername,
  normalizeEmail,
  validateEmail,
} from '../src/validation.js';

test('username rules', () => {
  assert.equal(isValidUsername('alice-dev'), true);
  assert.equal(isValidUsername('pw-user-1'), true);
  assert.equal(isValidUsername('a'), true);
  assert.equal(isValidUsername('abc123'), true);
  assert.equal(isValidUsername('a-b-c'), true);
  assert.equal(isValidUsername('a1-b2-c3'), true);
  assert.equal(isValidUsername('x'.repeat(39)), true);

  assert.equal(isValidUsername(''), false);
  assert.equal(isValidUsername('-abc'), false);
  assert.equal(isValidUsername('abc-'), false);
  assert.equal(isValidUsername('abc--def'), false);
  assert.equal(isValidUsername('ABC'), false);
  assert.equal(isValidUsername('Abc'), false);
  assert.equal(isValidUsername('a b'), false);
  assert.equal(isValidUsername('a_b'), false);
  assert.equal(isValidUsername('x'.repeat(40)), false);
  assert.equal(isValidUsername('abc@def'), false);
  assert.equal(isValidUsername(null), false);
  assert.equal(isValidUsername(undefined), false);
});

test('email rules', () => {
  assert.equal(validateEmail('alice.dev@example.test'), true);
  assert.equal(validateEmail('pw-user-1@example.test'), true);
  assert.equal(validateEmail(' a@b.com '), true);
  assert.equal(validateEmail('a@b.co.uk'), true);

  assert.equal(validateEmail(''), false);
  assert.equal(validateEmail('not-an-email'), false);
  assert.equal(validateEmail('a@b'), false);
  assert.equal(validateEmail('a@b.'), false);
  assert.equal(validateEmail('a@.b'), false);
  assert.equal(validateEmail('@example.test'), true);
  assert.equal(validateEmail('a@@b.com'), false);
  assert.equal(validateEmail('a@b..com'), false);
  assert.equal(validateEmail('a'.repeat(250) + '@b.com'), false);
  assert.equal(validateEmail(null), false);
});

test('email normalization trims whitespace', () => {
  assert.equal(normalizeEmail('  alice.dev@example.test  '), 'alice.dev@example.test');
  assert.equal(normalizeEmail(undefined), '');
});

test('password rules', () => {
  assert.equal(isValidPassword('Valid-password-123!'), true);
  assert.equal(isValidPassword('Replacement-password-456!'), true);
  assert.equal(isValidPassword('aB1!cdefghij'), true);

  assert.equal(isValidPassword('short'), false);
  assert.equal(isValidPassword('alllowercase123'), false);
  assert.equal(isValidPassword('NOUPPERCASE123!'), false);
  assert.equal(isValidPassword('NoDigits!!'), false);
  assert.equal(isValidPassword('NoSpecial123'), false);
  assert.equal(isValidPassword('Has Space123!'), false);
  assert.equal(isValidPassword('aB1!cdefghij'.length > 12 ? 'aB1!cdefghij' : 'aB1!cdefghij'), true);
  assert.equal(isValidPassword('Ab1!'.padEnd(13, 'x')), true);
  assert.equal(isValidPassword(''), false);
  assert.equal(isValidPassword('Ab1!'.padEnd(129, 'x')), false);
  assert.equal(isValidPassword(null), false);
});
