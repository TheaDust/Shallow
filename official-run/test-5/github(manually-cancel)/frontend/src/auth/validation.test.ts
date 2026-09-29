import { describe, expect, it } from "vitest";

import {
  EMAIL_MESSAGES,
  PASSWORD_CONFIRMATION_MESSAGE,
  PASSWORD_MESSAGE,
  TERMS_MESSAGE,
  USERNAME_MESSAGES,
  validateEmail,
  validatePassword,
  validateRegistration,
  validateUsername,
} from "./validation";

describe("username rules (REQ-1-1-1)", () => {
  it("accepts 1-39 lowercase letters, digits and single hyphens", () => {
    expect(validateUsername("a")).toBeNull();
    expect(validateUsername("pw-user-123")).toBeNull();
    expect(validateUsername("a".repeat(39))).toBeNull();
  });

  it("rejects leading/trailing hyphens, doubled hyphens, uppercase and other characters", () => {
    for (const value of ["-lead", "trail-", "double--hyphen", "Upper", "under_score", "with space", "a".repeat(40), ""]) {
      expect(validateUsername(value)).toBe(USERNAME_MESSAGES.format);
    }
  });
});

describe("email rules (REQ-1-1-1)", () => {
  it("accepts a trimmed address with exactly one @ and non-empty domain labels", () => {
    expect(validateEmail("  alice.dev@example.test ")).toBeNull();
    expect(validateEmail("a@b.c")).toBeNull();
  });

  it("rejects addresses without a usable domain", () => {
    for (const value of ["not-an-email", "two@@example.test", "user@localhost", "user@.test", "user@example.", "user name@example.test", `${"a".repeat(250)}@example.test`, ""]) {
      expect(validateEmail(value)).toBe(EMAIL_MESSAGES.format);
    }
  });
});

describe("password rules (REQ-1-1-1)", () => {
  it("accepts 12-128 characters with every required class", () => {
    expect(validatePassword("Valid-password-123!")).toBeNull();
    expect(validatePassword("Aa1!" + "x".repeat(124))).toBeNull();
  });

  it("rejects short, single-class and whitespace passwords", () => {
    for (const value of ["short", "alllowercase1234!", "ALLUPPERCASE1234!", "NoDigitsHere!!", "NoSpecial12345", "With space 123!", "Aa1!" + "x".repeat(130)]) {
      expect(validatePassword(value)).toBe(PASSWORD_MESSAGE);
    }
  });
});

describe("registration validation (REQ-1-1-1)", () => {
  it("reports every invalid field of one submission together", () => {
    const errors = validateRegistration({
      username: "-invalid",
      email: "not-an-email",
      password: "short",
      confirmPassword: "different",
      agreeToTerms: false,
    });
    expect(errors).toEqual({
      username: USERNAME_MESSAGES.format,
      email: EMAIL_MESSAGES.format,
      password: PASSWORD_MESSAGE,
      terms: TERMS_MESSAGE,
    });
  });

  it("reports a confirmation mismatch only when the password itself is compliant", () => {
    expect(
      validateRegistration({
        username: "pw-user",
        email: "pw-user@example.test",
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-321!",
        agreeToTerms: true,
      }),
    ).toEqual({ confirmPassword: PASSWORD_CONFIRMATION_MESSAGE });
  });

  it("accepts a fully compliant submission", () => {
    expect(
      validateRegistration({
        username: "pw-user-1",
        email: "pw-user-1@example.test",
        password: "Valid-password-123!",
        confirmPassword: "Valid-password-123!",
        agreeToTerms: true,
      }),
    ).toEqual({});
  });
});
