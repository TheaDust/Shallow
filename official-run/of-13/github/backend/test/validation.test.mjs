import assert from "node:assert/strict";
import test from "node:test";

import {
  isValidEmail,
  isValidPassword,
  isValidUsername,
  normalizeEmail,
} from "../src/lib/validation.mjs";

test("usernames follow the 1-39 lowercase/hyphen rule", () => {
  assert.equal(isValidUsername("alice-dev"), true);
  assert.equal(isValidUsername("a"), true);
  assert.equal(isValidUsername("9-team-2"), true);
  assert.equal(isValidUsername("a".repeat(39)), true);
  assert.equal(isValidUsername("a".repeat(40)), false);
  assert.equal(isValidUsername(""), false);
  assert.equal(isValidUsername("-lead"), false);
  assert.equal(isValidUsername("trail-"), false);
  assert.equal(isValidUsername("double--hyphen"), false);
  assert.equal(isValidUsername("Upper"), false);
  assert.equal(isValidUsername("with space"), false);
  assert.equal(isValidUsername("under_score"), false);
});

test("emails are trimmed and require one @ with dotted non-empty labels", () => {
  assert.equal(isValidEmail("  alice.dev@example.test  "), true);
  assert.equal(normalizeEmail("  alice.dev@example.test  "), "alice.dev@example.test");
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("a@b"), false);
  assert.equal(isValidEmail("a@@b.test"), false);
  assert.equal(isValidEmail("@example.test"), false);
  assert.equal(isValidEmail("user@.test"), false);
  assert.equal(isValidEmail("user@example."), false);
  assert.equal(isValidEmail("user@exa mple.test"), false);
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail(`${"a".repeat(250)}@example.test`), false);
});

test("passwords require 12-128 characters with mixed classes and no whitespace", () => {
  assert.equal(isValidPassword("Valid-password-123!"), true);
  assert.equal(isValidPassword("short"), false);
  assert.equal(isValidPassword("A".repeat(12)), false);
  assert.equal(isValidPassword("A".repeat(129)), false);
  assert.equal(isValidPassword("nouppercase123!"), false);
  assert.equal(isValidPassword("NOLOWERCASE123!"), false);
  assert.equal(isValidPassword("NoDigitsHere!!"), false);
  assert.equal(isValidPassword("NoSpecials1234"), false);
  assert.equal(isValidPassword("Has space 123!A"), false);
});
