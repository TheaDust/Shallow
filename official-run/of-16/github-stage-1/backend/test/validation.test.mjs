import assert from "node:assert/strict";
import test from "node:test";

import {
  isCompliantPassword,
  isValidEmail,
  isValidTeamName,
  isValidUsername,
  validatePasswordChange,
  validatePasswordReset,
  validateRegistration,
  validateTeamFields,
} from "../src/domain/validation.mjs";

test("username rules accept 1-39 lowercase letters, digits and single hyphens", () => {
  assert.equal(isValidUsername("a"), true);
  assert.equal(isValidUsername("alice-dev"), true);
  assert.equal(isValidUsername("a1-b2-c3"), true);
  assert.equal(isValidUsername("a".repeat(39)), true);
  assert.equal(isValidUsername("1nora-demo9"), true);

  assert.equal(isValidUsername("a".repeat(40)), false);
  assert.equal(isValidUsername(""), false);
  assert.equal(isValidUsername("-invalid-demo"), false);
  assert.equal(isValidUsername("invalid-demo-"), false);
  assert.equal(isValidUsername("double--hyphen"), false);
  assert.equal(isValidUsername("UpperCase"), false);
  assert.equal(isValidUsername("under_score"), false);
  assert.equal(isValidUsername("with space"), false);
  assert.equal(isValidUsername("dotted.name"), false);
});

test("email rules use at most one @, a dot and non-empty domain labels", () => {
  assert.equal(isValidEmail("nora.demo@example.test"), true);
  assert.equal(isValidEmail("  alice.dev@example.test  "), true);
  assert.equal(isValidEmail("a@b.c"), true);
  assert.equal(isValidEmail(`${"a".repeat(240)}@example.test`), true);

  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("a@@b.test"), false);
  assert.equal(isValidEmail("@example.test"), false);
  assert.equal(isValidEmail("local@nodot"), false);
  assert.equal(isValidEmail("local@.test"), false);
  assert.equal(isValidEmail("local@example..test"), false);
  assert.equal(isValidEmail("local@example.test."), false);
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail(`${"a".repeat(250)}@example.test`), false);
});

test("password rules require 12-128 characters with all character classes", () => {
  assert.equal(isCompliantPassword("Valid-password-123!"), true);
  assert.equal(isCompliantPassword("Replacement-password-456!"), true);
  assert.equal(isCompliantPassword("short"), false);
  assert.equal(isCompliantPassword("alllowercase-123!"), false);
  assert.equal(isCompliantPassword("ALLUPPERCASE-123!"), false);
  assert.equal(isCompliantPassword("NoDigitsHere!!"), false);
  assert.equal(isCompliantPassword("NoSpecials12345"), false);
  assert.equal(isCompliantPassword("Has space 123!"), false);
  assert.equal(isCompliantPassword("A1!".repeat(42)), false);
});

test("registration validation reports every failing field together", () => {
  const { errors } = validateRegistration({
    username: "-invalid-demo",
    email: "not-an-email",
    password: "short",
    confirmPassword: "different",
    agreeToTerms: false,
  });

  assert.equal(errors.username, "Username format is invalid");
  assert.equal(errors.email, "Email format is invalid");
  assert.equal(errors.password, "Password requirements are not satisfied");
  assert.equal(errors.agreeToTerms, "Agree to terms is required");
});

test("registration validation accepts a complete compliant submission", () => {
  const { errors, values } = validateRegistration({
    username: "nora-demo",
    email: " nora.demo@example.test ",
    password: "Valid-password-123!",
    confirmPassword: "Valid-password-123!",
    agreeToTerms: true,
  });

  assert.deepEqual(errors, {});
  assert.equal(values.email, "nora.demo@example.test");
});

test("registration validation flags a mismatching confirmation of a valid password", () => {
  const { errors } = validateRegistration({
    username: "nora-demo",
    email: "nora.demo@example.test",
    password: "Valid-password-123!",
    confirmPassword: "different",
    agreeToTerms: true,
  });

  assert.deepEqual(errors, { confirmPassword: "Password confirmation does not match" });
});

test("team name rules accept 1-50 lowercase letters, digits and inner hyphens", () => {
  assert.equal(isValidTeamName("a"), true);
  assert.equal(isValidTeamName("mobile-team"), true);
  // Only a leading or trailing hyphen is forbidden; inner hyphens may repeat.
  assert.equal(isValidTeamName("mobile--team"), true);
  assert.equal(isValidTeamName("a1-b2-c3"), true);
  assert.equal(isValidTeamName("a".repeat(50)), true);

  assert.equal(isValidTeamName("a".repeat(51)), false);
  assert.equal(isValidTeamName(""), false);
  assert.equal(isValidTeamName("-invalid-team"), false);
  assert.equal(isValidTeamName("invalid-team-"), false);
  assert.equal(isValidTeamName("Mobile-Team"), false);
  assert.equal(isValidTeamName("mobile_team"), false);
  assert.equal(isValidTeamName("mobile team"), false);
  assert.equal(isValidTeamName("möbile-team"), false);
});

test("team field validation trims the name and reports the exact message", () => {
  assert.deepEqual(validateTeamFields({ name: "  mobile-team  " }).errors, {});
  assert.equal(validateTeamFields({ name: "  mobile-team  " }).values.name, "mobile-team");
  assert.deepEqual(validateTeamFields({ name: "-invalid-team" }).errors, { name: "Team name is invalid" });
});

test("password reset validation requires the fixed code and a compliant password", () => {
  const wrongCode = validatePasswordReset({
    email: "recovery-success@example.test",
    code: "000000",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-456!",
  });
  assert.deepEqual(wrongCode.errors, { code: "Verification code is invalid" });

  const valid = validatePasswordReset({
    email: "recovery-success@example.test",
    code: "123456",
    newPassword: "Replacement-password-456!",
    confirmPassword: "Replacement-password-456!",
  });
  assert.deepEqual(valid.errors, {});
});

test("password change validation covers the candidate password and its confirmation", () => {
  const accepted = validatePasswordChange({
    currentPassword: "Valid-password-123!",
    newPassword: "New-password-456!",
    confirmPassword: "New-password-456!",
  });
  assert.deepEqual(accepted.errors, {});
  assert.equal(accepted.values.currentPassword, "Valid-password-123!");

  const nonCompliant = validatePasswordChange({
    currentPassword: "Valid-password-123!",
    newPassword: "short",
    confirmPassword: "short",
  });
  assert.deepEqual(nonCompliant.errors, { newPassword: "Password requirements are not satisfied" });

  const mismatched = validatePasswordChange({
    currentPassword: "Valid-password-123!",
    newPassword: "New-password-456!",
    confirmPassword: "does-not-match",
  });
  assert.deepEqual(mismatched.errors, { confirmPassword: "Password confirmation does not match" });
});
