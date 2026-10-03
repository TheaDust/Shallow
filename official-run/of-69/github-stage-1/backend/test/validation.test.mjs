import assert from "node:assert/strict";
import test from "node:test";

import { validateEmail, validatePassword, validateUsername } from "../src/lib/validation.mjs";

test("username format follows the 1-39 lowercase ASCII hyphen rule", () => {
  assert.equal(validateUsername("nora-demo"), true);
  assert.equal(validateUsername("a"), true);
  assert.equal(validateUsername("a1-b2"), true);
  assert.equal(validateUsername("x".repeat(39)), true);
  assert.equal(validateUsername(""), false);
  assert.equal(validateUsername("-invalid-demo"), false);
  assert.equal(validateUsername("invalid-demo-"), false);
  assert.equal(validateUsername("double--hyphen"), false);
  assert.equal(validateUsername("Uppercase"), false);
  assert.equal(validateUsername("x".repeat(40)), false);
  assert.equal(validateUsername("under_score"), false);
});

test("email format trims, requires one @, a dot and non-empty domain labels", () => {
  assert.equal(validateEmail("nora.demo@example.test"), true);
  assert.equal(validateEmail("  nora.demo@example.test  "), true);
  assert.equal(validateEmail("not-an-email"), false);
  assert.equal(validateEmail("two@@example.test"), false);
  assert.equal(validateEmail("a@nodot"), false);
  assert.equal(validateEmail("a@.test"), false);
  assert.equal(validateEmail("a@example."), false);
  assert.equal(validateEmail("@example.test"), false);
  assert.equal(validateEmail(`${"a".repeat(250)}@example.test`), false);
});

test("password format requires length, mixed classes and no whitespace", () => {
  assert.equal(validatePassword("Valid-password-123!"), true);
  assert.equal(validatePassword("Replacement-password-456!"), true);
  assert.equal(validatePassword("short"), false);
  assert.equal(validatePassword("alllowercase123!"), false);
  assert.equal(validatePassword("ALLUPPERCASE123!"), false);
  assert.equal(validatePassword("NoDigits-here!!"), false);
  assert.equal(validatePassword("NoSpecial12345"), false);
  assert.equal(validatePassword("Has space-1234!A"), false);
  assert.equal(validatePassword(`${"Aa1!".repeat(32)}a`), false);
  assert.equal(validatePassword("Aa1!"), false);
});
