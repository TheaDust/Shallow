import assert from "node:assert/strict";
import test from "node:test";

import {
  isValidEmail,
  isValidUsername,
  normalizeEmail,
  passwordMeetsRequirements,
} from "../src/lib/validation.mjs";

test("username accepts lowercase letters, digits and single hyphens", () => {
  assert.equal(isValidUsername("alice"), true);
  assert.equal(isValidUsername("alice-dev"), true);
  assert.equal(isValidUsername("pw-user-abc123"), true);
  assert.equal(isValidUsername("a"), true);
  assert.equal(isValidUsername("a".repeat(39)), true);
});

test("username rejects invalid shapes", () => {
  assert.equal(isValidUsername(""), false);
  assert.equal(isValidUsername("-alice"), false);
  assert.equal(isValidUsername("alice-"), false);
  assert.equal(isValidUsername("alice--dev"), false);
  assert.equal(isValidUsername("Alice"), false);
  assert.equal(isValidUsername("alice_dev"), false);
  assert.equal(isValidUsername("alice.dev"), false);
  assert.equal(isValidUsername("alice dev"), false);
  assert.equal(isValidUsername("a".repeat(40)), false);
});

test("email validation", () => {
  assert.equal(isValidEmail("alice.dev@example.test"), true);
  assert.equal(isValidEmail("pw-user-abc@example.test"), true);
  assert.equal(isValidEmail("  alice.dev@example.test  "), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("a@b"), false);
  assert.equal(isValidEmail("a@b."), false);
  assert.equal(isValidEmail("a@.com"), false);
  assert.equal(isValidEmail("a@b..com"), false);
  assert.equal(isValidEmail("a@@b.com"), false);
  assert.equal(isValidEmail("@b.com"), false);
  assert.equal(isValidEmail("a@b.com".replace("a", "a".repeat(254))), false);
});

test("normalizeEmail trims surrounding whitespace", () => {
  assert.equal(normalizeEmail("  alice@example.test  "), "alice@example.test");
  assert.equal(normalizeEmail(undefined), "");
});

test("password requirements", () => {
  assert.equal(passwordMeetsRequirements("Valid-password-123!"), true);
  assert.equal(passwordMeetsRequirements("Replacement-password-456!"), true);
  assert.equal(passwordMeetsRequirements("short"), false);
  assert.equal(passwordMeetsRequirements("password12345"), false);
  assert.equal(passwordMeetsRequirements("PASSWORD12345!"), false);
  assert.equal(passwordMeetsRequirements("Passwordabcd!"), false);
  assert.equal(passwordMeetsRequirements("Password12345"), false);
  assert.equal(passwordMeetsRequirements("Password 123!"), false);
  assert.equal(passwordMeetsRequirements("Pass-12".padEnd(11, "a")), false);
  assert.equal(passwordMeetsRequirements(`A1!${"a".repeat(126)}`), false);
});
