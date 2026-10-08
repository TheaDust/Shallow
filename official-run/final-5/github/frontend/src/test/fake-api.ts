import type { AccountSession, FieldErrors, SessionUser } from "../lib/auth-api";
import { createFakeOrgBackend } from "./fake-org-api";
import { reply } from "./fake-response";

interface FakeAccount extends SessionUser {
  password: string;
}

interface FakeSession {
  id: string;
  accountId: string;
  active: boolean;
  deviceLabel: string;
  createdAt: string;
  lastActiveAt: string;
}

// Mirrors the REQ-1-1-1 evolution rule: single hyphens or single underscores,
// not at the edges and never repeated.
const USERNAME_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

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
  /** Pre-creates another active browser session of an account. */
  addSession(username: string, deviceLabel?: string): string | null;
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
    // Evolution seeds (REQ-1-1-1 / REQ-1-1-2 / REQ-1-4).
    {
      id: "account-evo-register-existing",
      username: "evo-register-existing",
      email: "evo.register.existing@evolution.test",
      password: "Evo-Password-987!",
    },
    {
      id: "account-evo-login-case",
      username: "evo-login-case",
      email: "evo.login.case@evolution.test",
      password: "Evo-Password-987!",
    },
    {
      id: "account-evo-session-owner",
      username: "evo-session-owner",
      email: "evo.session.owner@evolution.test",
      password: "Evo-Password-987!",
    },
    {
      id: "account-evo-session-owner-s2",
      username: "evo-session-owner-s2",
      email: "evo.session.owner.s2@evolution.test",
      password: "Evo-Password-987!",
    },
    {
      id: "account-evo-session-owner-s3",
      username: "evo-session-owner-s3",
      email: "evo.session.owner.s3@evolution.test",
      password: "Evo-Password-987!",
    },
    // REQ-2-1-2 evolution / REQ-2-4: the organization-creating account and the
    // Owner plus ordinary Member of the predefined `evo-audit-org`.
    {
      id: "account-evo-org-owner",
      username: "evo-org-owner",
      email: "evo.org.owner@evolution.test",
      password: "Evo-Password-987!",
    },
    {
      id: "account-evo-audit-owner",
      username: "evo-audit-owner",
      email: "evo.audit.owner@evolution.test",
      password: "Evo-Password-987!",
    },
    {
      id: "account-evo-audit-viewer",
      username: "evo-audit-viewer",
      email: "evo.audit.viewer@evolution.test",
      password: "Evo-Password-987!",
    },
    // REQ-3-5: the repository administrator and the Member of the archive
    // repositories (their memberships and grants live in fake-org-api.ts).
    {
      id: "account-evo-archive-admin",
      username: "evo-archive-admin",
      email: "evo.archive.admin@evolution.test",
      password: "Evo-Password-987!",
    },
    {
      id: "account-evo-archive-viewer",
      username: "evo-archive-viewer",
      email: "evo.archive.viewer@evolution.test",
      password: "Evo-Password-987!",
    },
    // REQ-4-5: the account that publishes the release repositories (its grants
    // live in fake-org-api.ts).
    {
      id: "account-evo-release-owner",
      username: "evo-release-owner",
      email: "evo.release.owner@evolution.test",
      password: "Evo-Password-987!",
    },
    // REQ-5-5: the two accounts of the reaction scenarios. The reaction
    // repository is public, so viewing the issue is the whole permission.
    {
      id: "account-evo-reaction-author",
      username: "evo-reaction-author",
      email: "evo.reaction.author@evolution.test",
      password: "Evo-Password-987!",
    },
    {
      id: "account-evo-reaction-user",
      username: "evo-reaction-user",
      email: "evo.reaction.user@evolution.test",
      password: "Evo-Password-987!",
    },
  ];

  let sessionSeq = 0;
  const sessions: FakeSession[] = [];
  let currentSessionId: string | null = null;
  // A second browser session created by a test, standing in for another device.
  const addSession = (username: string, deviceLabel = "Firefox on Linux"): string | null => {
    const account = accounts.find((entry) => entry.username === username);
    if (!account) return null;
    const id = `session-${++sessionSeq}`;
    const now = new Date().toISOString();
    sessions.push({ id, accountId: account.id, active: true, deviceLabel, createdAt: now, lastActiveAt: now });
    return id;
  };

  const currentAccount = (): FakeAccount | null => {
    const session = sessions.find((entry) => entry.id === currentSessionId);
    if (!session || !session.active) return null;
    return accounts.find((account) => account.id === session.accountId) ?? null;
  };

  const listSessions = (accountId: string): AccountSession[] =>
    sessions
      .filter((entry) => entry.accountId === accountId && entry.active)
      .sort((a, b) => {
        const aCurrent = a.id === currentSessionId;
        const bCurrent = b.id === currentSessionId;
        if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
        return a.createdAt < b.createdAt ? 1 : -1;
      })
      .map((entry) => ({
        id: entry.id,
        current: entry.id === currentSessionId,
        deviceLabel: entry.deviceLabel,
        lastActiveAt: entry.lastActiveAt,
      }));

  const orgBackend = createFakeOrgBackend({
    currentAccountId: () => currentAccount()?.id ?? null,
    currentUsername: () => currentAccount()?.username ?? null,
    listAccounts: () => accounts.map((account) => ({ username: account.username, email: account.email })),
  });

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (url === "/api/session" && method === "GET") {
      const account = currentAccount();
      return reply(200, { user: account ? publicUser(account) : null });
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
      const value = String(body.identifier ?? "").trim();
      // Username lookup stays exact; the email matches case-insensitively.
      const account = accounts.find(
        (entry) => entry.username === value || entry.email.toLowerCase() === value.toLowerCase(),
      );
      if (!account || account.password !== body.password) {
        return reply(401, { message: "Invalid credentials" });
      }
      const now = new Date().toISOString();
      const id = `session-${++sessionSeq}`;
      sessions.push({
        id,
        accountId: account.id,
        active: true,
        deviceLabel: "Chrome on Linux",
        createdAt: now,
        lastActiveAt: now,
      });
      currentSessionId = id;
      return reply(200, { user: publicUser(account) });
    }

    if (url === "/api/auth/sign-out" && method === "POST") {
      const session = sessions.find((entry) => entry.id === currentSessionId);
      if (session) session.active = false;
      currentSessionId = null;
      return reply(200, { ok: true });
    }

    if (url === "/api/account/sessions" && method === "GET") {
      const account = currentAccount();
      if (!account) return reply(401, { message: "Not signed in" });
      return reply(200, { sessions: listSessions(account.id) });
    }

    if (url.startsWith("/api/account/sessions/") && url.endsWith("/revoke") && method === "POST") {
      const account = currentAccount();
      if (!account) return reply(401, { message: "Not signed in" });
      const raw = url.slice("/api/account/sessions/".length, -"revoke".length);
      const id = decodeURIComponent(raw.endsWith("/") ? raw.slice(0, -1) : raw);
      const session = sessions.find((entry) => entry.id === id && entry.accountId === account.id);
      if (!session || !session.active) return reply(404, { error: "Not found" });
      if (session.id === currentSessionId) {
        return reply(400, { message: "The current session cannot be revoked" });
      }
      session.active = false;
      return reply(200, { ok: true, sessions: listSessions(account.id) });
    }

    if (url === "/api/account/password" && method === "POST") {
      const signedIn = currentAccount();
      if (!signedIn) return reply(401, { message: "Not signed in" });
      const currentPassword = String(body.currentPassword ?? "");
      const newPassword = String(body.newPassword ?? "");
      const confirmPassword = String(body.confirmPassword ?? "");
      if (!currentPassword) {
        return reply(400, {
          message: "Validation failed",
          fieldErrors: { currentPassword: "Current password is required" },
        });
      }
      if (currentPassword !== signedIn.password) {
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
      signedIn.password = newPassword;
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
    addSession,
    setSignedIn(username: string) {
      currentSessionId = addSession(username, "Safari on macOS");
    },
    signedInUsername() {
      return currentAccount()?.username ?? null;
    },
  };
}
