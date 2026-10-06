import type { FieldErrors, SessionUser } from "../lib/auth-api";
import { createFakeOrgBackend } from "./fake-org-api";
import { reply } from "./fake-response";

interface FakeAccount extends SessionUser {
  password: string;
}

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
  sessions: FakeSessionRecord[];
  setSignedIn(username: string): void;
  signedInUsername(): string | null;
  /** Opens one more browser session for the account and makes it the current one. */
  openSession(username: string, device?: string): string;
  /** Brings a previously opened browser session (or none) back to the foreground. */
  useSession(secret: string | null): void;
}

/** One browser session of the fake account store; `secret` is the cookie value. */
export interface FakeSessionRecord {
  id: string;
  secret: string;
  accountId: string;
  device: string;
  active: boolean;
  createdAt: string;
  lastActiveAt: string;
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
    // REQ-3-5: the repository Admin of the archive scenarios and the account
    // that keeps reading the archived repository.
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
    // REQ-4-5: the release Owner account (its Write grants on the release
    // repositories live in the fake organization seeds).
    {
      id: "account-evo-release-owner",
      username: "evo-release-owner",
      email: "evo.release.owner@evolution.test",
      password: "Evo-Password-987!",
    },
    // REQ-5-5: the two viewers of the public reaction issues; reacting only
    // needs a session and read access, so neither carries a repository grant.
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
  const sessions: FakeSessionRecord[] = [];
  let currentSecret: string | null = null;
  let sessionCounter = 0;

  function openSession(username: string, device = "Chrome on Linux"): string {
    const account = accounts.find((entry) => entry.username === username);
    if (!account) throw new Error(`Unknown fake account ${username}`);
    sessionCounter += 1;
    const createdAt = new Date(Date.now() + sessionCounter).toISOString();
    const record: FakeSessionRecord = {
      id: `session-${sessionCounter}`,
      secret: `secret-${sessionCounter}`,
      accountId: account.id,
      device,
      active: true,
      createdAt,
      lastActiveAt: createdAt,
    };
    sessions.push(record);
    currentSecret = record.secret;
    return record.secret;
  }

  function currentSession(): FakeSessionRecord | null {
    return sessions.find((entry) => entry.secret === currentSecret) ?? null;
  }

  function sessionOwner(): FakeAccount | null {
    const session = currentSession();
    if (!session || !session.active) return null;
    return accounts.find((entry) => entry.id === session.accountId) ?? null;
  }

  const orgBackend = createFakeOrgBackend({
    currentAccountId: () => sessionOwner()?.id ?? null,
    currentUsername: () => sessionOwner()?.username ?? null,
    listAccounts: () => accounts.map((account) => ({ username: account.username, email: account.email })),
  });

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (url === "/api/session" && method === "GET") {
      const session = currentSession();
      if (!session) return reply(200, { user: null, revoked: false });
      if (!session.active) return reply(200, { user: null, revoked: true });
      const account = accounts.find((entry) => entry.id === session.accountId) ?? null;
      return reply(200, { user: account ? publicUser(account) : null, revoked: false });
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
      const identifier = String(body.identifier ?? "").trim();
      const account = accounts.find(
        (entry) =>
          entry.username === identifier ||
          entry.email.toLowerCase() === identifier.toLowerCase(),
      );
      if (!account || account.password !== body.password) {
        return reply(401, { message: "Invalid credentials" });
      }
      openSession(account.username);
      return reply(200, { user: publicUser(account) });
    }

    if (url === "/api/auth/sign-out" && method === "POST") {
      const session = currentSession();
      if (session) session.active = false;
      currentSecret = null;
      return reply(200, { ok: true });
    }

    if (url === "/api/account/sessions" && method === "GET") {
      const account = sessionOwner();
      if (!account) return reply(401, { message: "Not signed in" });
      return reply(200, {
        sessions: sessions
          .filter((entry) => entry.accountId === account.id)
          .map((entry) => ({
            id: entry.id,
            device: entry.device,
            active: entry.active,
            current: entry.secret === currentSecret,
            lastActive: entry.lastActiveAt,
            createdAt: entry.createdAt,
          })),
      });
    }

    const revokeMatch = method === "POST" && /^\/api\/account\/sessions\/([^/]+)\/revoke$/.exec(url);
    if (revokeMatch) {
      const account = sessionOwner();
      if (!account) return reply(401, { message: "Not signed in" });
      const target = sessions.find(
        (entry) => entry.accountId === account.id && entry.id === decodeURIComponent(revokeMatch[1]),
      );
      if (!target) return reply(404, { error: "Not found" });
      target.active = false;
      return reply(200, { message: "Session revoked" });
    }

    if (url === "/api/account/password" && method === "POST") {
      const current = sessionOwner();
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
    sessions,
    setSignedIn(username: string) {
      // An unknown username models a fresh visitor session with no login state.
      const account = accounts.find((entry) => entry.username === username);
      if (!account) {
        currentSecret = null;
        return;
      }
      openSession(username);
    },
    signedInUsername() {
      return sessionOwner()?.username ?? null;
    },
    openSession,
    useSession(secret: string | null) {
      currentSecret = secret;
    },
  };
}
