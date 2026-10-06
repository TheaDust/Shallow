import assert from "node:assert/strict";
import test from "node:test";

import {
  MESSAGES,
  validateEmail,
  validatePassword,
  validatePasswordReset,
  validateRegistration,
  validateUsername,
} from "../src/lib/auth-rules.mjs";

test("username rule accepts lowercase letters, digits and single separators", () => {
  for (const value of [
    "a",
    "nora-demo",
    "abc123",
    "a1-b2-c3",
    "evo_user_01",
    "user_name",
    "a_1-b_2",
    "x".repeat(39),
  ]) {
    assert.equal(validateUsername(value), true, value);
  }
});

test("username rule rejects edge separators, repeated separators and other characters", () => {
  for (const value of [
    "",
    "-invalid-demo",
    "invalid-demo-",
    "_invalid-demo",
    "invalid-demo_",
    "a--b",
    "a__b",
    "a-_b",
    "a_-b",
    "EvoUpper01",
    "under score",
    "a b",
    "x".repeat(40),
  ]) {
    assert.equal(validateUsername(value), false, value);
  }
});

test("email rule requires one @, a domain dot and non-empty labels", () => {
  assert.equal(validateEmail("  nora.demo@example.test  "), true);
  for (const value of ["not-an-email", "a@b", "a@b.", "a@.c", "a@@b.c", "@example.test", "name@example"] ) {
    assert.equal(validateEmail(value), false, value);
  }
});

test("password rule enforces length, cases, digit, special character and no whitespace", () => {
  assert.equal(validatePassword("Valid-password-123!"), true);
  for (const value of ["short", "alllowercase123!", "ALLUPPERCASE123!", "NoSpecial123456", "Has Space 123!", "NoDigits-abcde!"]) {
    assert.equal(validatePassword(value), false, value);
  }
});

test("registration validation reports every invalid field in one pass", () => {
  const result = validateRegistration({
    username: "-invalid-demo",
    email: "not-an-email",
    password: "short",
    confirmPassword: "different",
    agreeToTerms: false,
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.fieldErrors, {
    username: MESSAGES.usernameFormat,
    email: MESSAGES.emailFormat,
    password: MESSAGES.password,
    confirmPassword: MESSAGES.confirmMismatch,
    terms: MESSAGES.terms,
  });
});

test("registration validation reports username and email conflicts", () => {
  const result = validateRegistration(
    {
      username: "alice-dev",
      email: "alice.dev@example.test",
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      agreeToTerms: true,
    },
    { usernameExists: () => true, emailExists: () => true },
  );
  assert.equal(result.fieldErrors.username, MESSAGES.usernameExists);
  assert.equal(result.fieldErrors.email, MESSAGES.emailExists);
});

test("password reset validation rejects a wrong code without touching passwords", () => {
  const wrong = validatePasswordReset({
    email: "recovery-invalid-code@example.test",
    code: "000000",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-456!",
  });
  assert.equal(wrong.fieldErrors.code, MESSAGES.invalidCode);
  assert.equal(wrong.valid, false);

  const correct = validatePasswordReset({
    email: "recovery-success@example.test",
    code: "123456",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-456!",
  });
  assert.equal(correct.valid, true);
});
