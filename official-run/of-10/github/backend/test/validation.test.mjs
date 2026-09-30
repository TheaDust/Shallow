import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_MESSAGES,
  collectRegistrationErrors,
  isValidEmail,
  isValidPassword,
  isValidUsername,
  normalizeEmail,
} from "../src/domain/validation.mjs";

test("username accepts 1-39 lowercase alphanumeric characters with single hyphens", () => {
  assert.equal(isValidUsername("a"), true);
  assert.equal(isValidUsername("alice-dev"), true);
  assert.equal(isValidUsername("pw-user-1234"), true);
  assert.equal(isValidUsername("a".repeat(39)), true);
  assert.equal(isValidUsername("a".repeat(40)), false);
  assert.equal(isValidUsername(""), false);
  assert.equal(isValidUsername("-alice"), false);
  assert.equal(isValidUsername("alice-"), false);
  assert.equal(isValidUsername("alice--dev"), false);
  assert.equal(isValidUsername("Alice"), false);
  assert.equal(isValidUsername("alice_dev"), false);
  assert.equal(isValidUsername(" alice"), false);
  assert.equal(isValidUsername(undefined), false);
});

test("email requires exactly one @, at most 254 characters and non-empty dotted domain labels", () => {
  assert.equal(isValidEmail("alice.dev@example.test"), true);
  assert.equal(isValidEmail("  alice.dev@example.test  "), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("alice@@example.test"), false);
  assert.equal(isValidEmail("alice@example"), false);
  assert.equal(isValidEmail("alice@example."), false);
  assert.equal(isValidEmail("alice@.example"), false);
  assert.equal(isValidEmail("@example.test"), false);
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail(`${"a".repeat(250)}@example.test`), false);
  assert.equal(normalizeEmail("  bob@example.test "), "bob@example.test");
});

test("password requires 12-128 characters with all character classes and no whitespace", () => {
  assert.equal(isValidPassword("Valid-password-123!"), true);
  assert.equal(isValidPassword("a".repeat(12) + "A1!"), true);
  assert.equal(isValidPassword("short"), false);
  assert.equal(isValidPassword("valid-password-123!"), false);
  assert.equal(isValidPassword("VALID-PASSWORD-123!"), false);
  assert.equal(isValidPassword("ValidPassword1234"), false);
  assert.equal(isValidPassword("Valid-password 123!"), false);
  assert.equal(isValidPassword("A".repeat(126) + "a1"), false);
  assert.equal(isValidPassword("Aa1!" + "x".repeat(124)), true);
  assert.equal(isValidPassword("Aa1!" + "x".repeat(125)), false);
});

test("registration reports every violated rule in one submission", () => {
  const errors = collectRegistrationErrors({
    username: "-bad",
    email: "not-an-email",
    password: "short",
    confirmPassword: "different",
    termsAccepted: false,
  });
  assert.equal(errors.username, ACCOUNT_MESSAGES.usernameFormat);
  assert.equal(errors.email, ACCOUNT_MESSAGES.emailFormat);
  assert.equal(errors.password, ACCOUNT_MESSAGES.password);
  assert.equal(errors.confirmPassword, ACCOUNT_MESSAGES.confirmPassword);
  assert.equal(errors.terms, ACCOUNT_MESSAGES.terms);
});

test("missing values violate the same documented rules", () => {
  const errors = collectRegistrationErrors({});
  assert.equal(errors.username, ACCOUNT_MESSAGES.usernameFormat);
  assert.equal(errors.email, ACCOUNT_MESSAGES.emailFormat);
  assert.equal(errors.password, ACCOUNT_MESSAGES.password);
  assert.equal(errors.terms, ACCOUNT_MESSAGES.terms);
  assert.equal(errors.confirmPassword, undefined);
});

test("compliant registration input has no field errors", () => {
  assert.deepEqual(
    collectRegistrationErrors({
      username: "pw-user-1234",
      email: "pw-user-1234@example.test",
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      termsAccepted: true,
    }),
    {},
  );
});
