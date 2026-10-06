import type { FieldErrors, SessionUser } from "../lib/auth-api";
import { createFakeOrgBackend } from "./fake-org-api";
import { reply } from "./fake-response";

interface FakeAccount extends SessionUser {
  password: string;
}

const USERNAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isValidUsername(value: string): boolean {
  return value.length >= 1 && value.length <= 39 && USERNAME_PATTERN.test(value);
}

function isValidEmail(raw: string): boolean {
  const value = raw.trim();
  if (!value || value.length > 254 || /\s/.test(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => label.length > 0);
}

function isValidPassword(value: string): boolean {
  return (
    value.length >= 12 &&
    value.length <= 128 &&
    !/\s/.test(value) &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

function publicUser(account: FakeAccount): SessionUser {
  return { id: account.id, username: account.username, email: account.email };
}

export interface FakeApi {
  fetch: typeof fetch;
  accounts: FakeAccount[];
  setSignedIn(username: string): void;
  signedInUsername(): string | null;
}

/** Minimal in-memory stand-in for the auth API used by frontend flow tests. */
export function createFakeApi(): FakeApi {
  const accounts: FakeAccount[] = [
    { id: "account-alice", username: "alice-dev", email: "alice.dev@example.test", password: "Valid-password-123!" },
    {
      id: "account-recovery-success",
      username: "recovery-success",
      email: "recovery-success@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-recovery-invalid",
      username: "recovery-invalid-code",
      email: "recovery-invalid-code@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-password-success",
      username: "password-change-success",
      email: "password-change-success@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-password-invalid",
      username: "password-change-invalid",
      email: "password-change-invalid@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-password-required",
      username: "password-change-required",
      email: "password-change-required@example.test",
      password: "Valid-password-123!",
    },
    { id: "account-org-owner", username: "org-owner", email: "org-owner@example.test", password: "Valid-password-123!" },
    {
      id: "account-team-maintainer",
      username: "team-maintainer",
      email: "team-maintainer@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-bob-reviewer",
      username: "bob-reviewer",
      email: "bob-reviewer@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-existing-member",
      username: "existing-member",
      email: "existing-member@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-new-member",
      username: "new-member",
      email: "new-member@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-org-member",
      username: "org-member",
      email: "org-member@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-protected-member",
      username: "protected-member",
      email: "protected-member@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-repo-admin",
      username: "repo-admin",
      email: "repo-admin@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-visibility-admin",
      username: "visibility-admin",
      email: "visibility-admin@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-collaborator",
      username: "collaborator",
      email: "collaborator@example.test",
      password: "Valid-password-123!",
    },
    { id: "account-repo-owner", username: "repo-owner", email: "repo-owner@example.test", password: "Valid-password-123!" },
    { id: "account-fork-user", username: "fork-user", email: "fork-user@example.test", password: "Valid-password-123!" },
    {
      id: "account-branch-contributor",
      username: "branch-contributor",
      email: "branch-contributor@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-file-contributor",
      username: "file-contributor",
      email: "file-contributor@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-default-branch-admin",
      username: "default-branch-admin",
      email: "default-branch-admin@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-default-branch-viewer",
      username: "default-branch-viewer",
      email: "default-branch-viewer@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-issue-author",
      username: "issue-author",
      email: "issue-author@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-issue-commenter",
      username: "issue-commenter",
      email: "issue-commenter@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-issue-editor",
      username: "issue-editor",
      email: "issue-editor@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-issue-viewer",
      username: "issue-viewer",
      email: "issue-viewer@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-pr-contributor",
      username: "pr-contributor",
      email: "pr-contributor@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-protection-admin",
      username: "protection-admin",
      email: "protection-admin@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-protection-viewer",
      username: "protection-viewer",
      email: "protection-viewer@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-draft-author",
      username: "draft-author",
      email: "draft-author@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-pr-reviewer",
      username: "pr-reviewer",
      email: "pr-reviewer@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-pr-author",
      username: "pr-author",
      email: "pr-author@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-pr-maintainer",
      username: "pr-maintainer",
      email: "pr-maintainer@example.test",
      password: "Valid-password-123!",
    },
    {
      id: "account-pr-viewer",
      username: "pr-viewer",
      email: "pr-viewer@example.test",
      password: "Valid-password-123!",
    },
  ];
  let current: FakeAccount | null = null;
  const orgBackend = createFakeOrgBackend({
    currentAccountId: () => current?.id ?? null,
    currentUsername: () => current?.username ?? null,
    listAccounts: () => accounts.map((account) => ({ username: account.username, email: account.email })),
  });

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (url === "/api/session" && method === "GET") {
      return reply(200, { user: current ? publicUser(current) : null });
    }

    if (url === "/api/auth/register" && method === "POST") {
      const fieldErrors: FieldErrors = {};
      const username = String(body.username ?? "");
      const email = String(body.email ?? "").trim();
      const password = String(body.password ?? "");
      if (!isValidUsername(username)) fieldErrors.username = "Username format is invalid";
      else if (accounts.some((account) => account.username === username)) {
        fieldErrors.username = "Username already exists";
      }
      if (!isValidEmail(email)) fieldErrors.email = "Email format is invalid";
      else if (accounts.some((account) => account.email.toLowerCase() === email.toLowerCase())) {
        fieldErrors.email = "Email already exists";
      }
      if (!isValidPassword(password)) fieldErrors.password = "Password requirements are not satisfied";
      if (String(body.confirmPassword ?? "") !== password) {
        fieldErrors.confirmPassword = "Password confirmation does not match";
      }
      if (body.agreeToTerms !== true) fieldErrors.terms = "Agree to terms is required";
      if (Object.keys(fieldErrors).length > 0) {
        return reply(400, { message: "Validation failed", fieldErrors });
      }
      const account: FakeAccount = {
        id: `account-${accounts.length + 1}`,
        username,
        email,
        password,
      };
      accounts.push(account);
      return reply(201, { user: publicUser(account) });
    }

    if (url === "/api/auth/sign-in" && method === "POST") {
      const identifier = String(body.identifier ?? "").toLowerCase();
      const account = accounts.find(
        (entry) => entry.username === identifier || entry.email.toLowerCase() === identifier,
      );
      if (!account || account.password !== body.password) {
        return reply(401, { message: "Invalid credentials" });
      }
      current = account;
      return reply(200, { user: publicUser(account) });
    }

    if (url === "/api/auth/sign-out" && method === "POST") {
      current = null;
      return reply(200, { ok: true });
    }

    if (url === "/api/account/password" && method === "POST") {
      if (!current) return reply(401, { message: "Not signed in" });
      const currentPassword = String(body.currentPassword ?? "");
      const newPassword = String(body.newPassword ?? "");
      const confirmPassword = String(body.confirmPassword ?? "");
      if (!currentPassword) {
        return reply(400, {
          message: "Validation failed",
          fieldErrors: { currentPassword: "Current password is required" },
        });
      }
      if (currentPassword !== current.password) {
        return reply(400, {
          message: "Validation failed",
          fieldErrors: { currentPassword: "Current password is incorrect" },
        });
      }
      const fieldErrors: FieldErrors = {};
      if (!isValidPassword(newPassword)) fieldErrors.newPassword = "Password requirements are not satisfied";
      if (confirmPassword !== newPassword) fieldErrors.confirmPassword = "Password confirmation does not match";
      if (Object.keys(fieldErrors).length > 0) {
        return reply(400, { message: "Validation failed", fieldErrors });
      }
      current.password = newPassword;
      return reply(200, { message: "Password updated" });
    }

    if (url === "/api/auth/password-reset/request" && method === "POST") {
      return reply(200, { ok: true, code: "123456" });
    }

    if (url === "/api/auth/password-reset" && method === "POST") {
      if (body.code !== "123456") {
        return reply(400, {
          message: "Verification code is invalid",
          fieldErrors: { code: "Verification code is invalid" },
        });
      }
      if (!isValidPassword(String(body.newPassword ?? ""))) {
        return reply(400, {
          message: "Validation failed",
          fieldErrors: { newPassword: "Password requirements are not satisfied" },
        });
      }
      if (body.confirmPassword !== body.newPassword) {
        return reply(400, {
          message: "Validation failed",
          fieldErrors: { confirmPassword: "Password confirmation does not match" },
        });
      }
      const account = accounts.find(
        (entry) => entry.email.toLowerCase() === String(body.email ?? "").toLowerCase(),
      );
      if (account) account.password = body.newPassword;
      return reply(200, { message: "Password updated" });
    }

    if (url.startsWith("/api/organizations") || url.startsWith("/api/repositories")) {
      return orgBackend.handle(url, method, body);
    }

    return reply(404, { error: "Not found" });
  };

  return {
    fetch: handler as unknown as typeof fetch,
    accounts,
    setSignedIn(username: string) {
      current = accounts.find((account) => account.username === username) ?? null;
    },
    signedInUsername() {
      return current?.username ?? null;
    },
  };
}
