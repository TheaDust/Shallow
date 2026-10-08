import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { join } from "node:path";

import { MESSAGES, normalizeText, validatePasswordChange } from "./auth-rules.mjs";
import { createJsonStore } from "./json-store.mjs";

// Predefined accounts every scenario can rely on. Missing entries are added by
// stable id on every start (see `createAuthStore`); existing records and user
// changes are never overwritten.
const SEED_PASSWORD = "Valid-password-123!";
// Evolution seeds (REQ-1-1-1 / REQ-1-1-2 / REQ-1-4) carry their own password.
const EVOLUTION_PASSWORD = "Evo-Password-987!";
const SEED_ACCOUNTS = [
  { username: "alice-dev", email: "alice.dev@example.test" },
  { username: "recovery-visibility", email: "recovery-visibility@example.test" },
  { username: "recovery-invalid-code", email: "recovery-invalid-code@example.test" },
  { username: "recovery-success", email: "recovery-success@example.test" },
  { username: "password-change-success", email: "password-change-success@example.test" },
  { username: "password-change-invalid", email: "password-change-invalid@example.test" },
  { username: "password-change-required", email: "password-change-required@example.test" },
  // Accounts the organization scenarios rely on. Their memberships, teams and
  // repository grants live in organization.json (see org-store.mjs).
  { username: "org-owner", email: "org-owner@example.test" },
  { username: "team-maintainer", email: "team-maintainer@example.test" },
  { username: "bob-reviewer", email: "bob-reviewer@example.test" },
  { username: "new-member", email: "new-member@example.test" },
  { username: "existing-member", email: "existing-member@example.test" },
  { username: "org-member", email: "org-member@example.test" },
  { username: "protected-member", email: "protected-member@example.test" },
  { username: "repo-admin", email: "repo-admin@example.test" },
  // REQ-3-4: repository administrator and a non-admin collaborator of the
  // same private repository (their grants live in org-store.mjs).
  { username: "visibility-admin", email: "visibility-admin@example.test" },
  { username: "collaborator", email: "collaborator@example.test" },
  // REQ-3-2: owner of the personal namespace used for repository creation and
  // the account allowed to fork a readable source into its own namespace.
  { username: "repo-owner", email: "repo-owner@example.test" },
  { username: "fork-user", email: "fork-user@example.test" },
  // REQ-4-3 / REQ-4-4: the branch Write contributor, the file Write
  // contributor, the repository administrator and the readable non-Admin
  // viewer (their grants live in org-store.mjs).
  { username: "branch-contributor", email: "branch-contributor@example.test" },
  { username: "file-contributor", email: "file-contributor@example.test" },
  { username: "default-branch-admin", email: "default-branch-admin@example.test" },
  { username: "default-branch-viewer", email: "default-branch-viewer@example.test" },
  // REQ-5: the issue author and commenter (their Write grants on `acme-docs`
  // live in org-store.mjs).
  { username: "issue-author", email: "issue-author@example.test" },
  { username: "issue-commenter", email: "issue-commenter@example.test" },
  // REQ-5-2-2 / REQ-5-3: the editor used for both content and metadata
  // operations holds Maintain on `acme-docs` (grant in org-seeds.mjs).
  { username: "issue-editor", email: "issue-editor@example.test" },
  // REQ-5-4: the account that may only read `acme-docs` issues (its Read grant
  // lives in org-seeds.mjs), so the status transitions stay unavailable.
  { username: "issue-viewer", email: "issue-viewer@example.test" },
  // REQ-6: the PR contributor (Write on `acme-docs`), the repository Admin of
  // `branch-protection-demo` and the readable non-Admin viewer of the same
  // repository (their grants live in org-seeds.mjs).
  { username: "pr-contributor", email: "pr-contributor@example.test" },
  { username: "protection-admin", email: "protection-admin@example.test" },
  { username: "protection-viewer", email: "protection-viewer@example.test" },
  // REQ-6-2-4 / REQ-6-3-3 / REQ-6-3-4: the author of the seeded draft pull
  // request and the non-author reviewer (grants live in org-seeds.mjs).
  { username: "draft-author", email: "draft-author@example.test" },
  { username: "pr-reviewer", email: "pr-reviewer@example.test" },
  // REQ-6-4 / REQ-6-5 / REQ-6-6: the pull-request author, the Maintain account
  // that merges, and the Read-only viewer (grants live in org-seeds.mjs).
  { username: "pr-author", email: "pr-author@example.test" },
  { username: "pr-maintainer", email: "pr-maintainer@example.test" },
  { username: "pr-viewer", email: "pr-viewer@example.test" },
  // REQ-1-1-1: the verified, available account a duplicate registration must
  // collide with. REQ-1-1-2: the account whose email signs in case-insensitively.
  { username: "evo-register-existing", email: "evo.register.existing@evolution.test", password: EVOLUTION_PASSWORD },
  { username: "evo-login-case", email: "evo.login.case@evolution.test", password: EVOLUTION_PASSWORD },
  // REQ-1-4: the accounts used to observe and revoke active browser sessions.
  { username: "evo-session-owner", email: "evo.session.owner@evolution.test", password: EVOLUTION_PASSWORD },
  { username: "evo-session-owner-s2", email: "evo.session.owner.s2@evolution.test", password: EVOLUTION_PASSWORD },
  { username: "evo-session-owner-s3", email: "evo.session.owner.s3@evolution.test", password: EVOLUTION_PASSWORD },
  // REQ-2-1-2 evolution: the verified account that creates organizations (and
  // owns the predefined `evo-lab-02`). REQ-2-4: the Owner and the ordinary
  // Member of the predefined `evo-audit-org` (memberships live in org-seeds.mjs).
  { username: "evo-org-owner", email: "evo.org.owner@evolution.test", password: EVOLUTION_PASSWORD },
  { username: "evo-audit-owner", email: "evo.audit.owner@evolution.test", password: EVOLUTION_PASSWORD },
  { username: "evo-audit-viewer", email: "evo.audit.viewer@evolution.test", password: EVOLUTION_PASSWORD },
  // REQ-3-5: the repository administrator that archives and restores the
  // archive repositories and the ordinary Member that reads the archived one
  // (their memberships and grants live in org-seeds.mjs).
  { username: "evo-archive-admin", email: "evo.archive.admin@evolution.test", password: EVOLUTION_PASSWORD },
  { username: "evo-archive-viewer", email: "evo.archive.viewer@evolution.test", password: EVOLUTION_PASSWORD },
  // REQ-4-5: the account that publishes the release repositories (its Write
  // grants live in org-seeds.mjs).
  { username: "evo-release-owner", email: "evo.release.owner@evolution.test", password: EVOLUTION_PASSWORD },
  // REQ-5-5: the two accounts of the reaction scenarios. They need no grant
  // because the reaction repository is public, so viewing the issue is enough
  // to reach the `Add reaction` control.
  { username: "evo-reaction-author", email: "evo.reaction.author@evolution.test", password: EVOLUTION_PASSWORD },
  { username: "evo-reaction-user", email: "evo.reaction.user@evolution.test", password: EVOLUTION_PASSWORD },
];

/** Deterministic id of a seeded account, shared with the organization seeds. */
export function seedAccountId(username) {
  return `account-${username}`;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: scryptSync(password, salt, 64).toString("hex") };
}

function matchesPassword(password, credential) {
  if (!credential?.salt || !credential?.hash) return false;
  const derived = scryptSync(password, credential.salt, 64);
  const expected = Buffer.from(credential.hash, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function publicAccount(account) {
  if (!account) return null;
  return { id: account.id, username: account.username, email: account.email };
}

/** One seeded account record; `spec.password` falls back to the shared seed password. */
function seedAccount(spec) {
  return {
    id: seedAccountId(spec.username),
    username: spec.username,
    email: spec.email,
    emailVerified: true,
    available: true,
    credential: hashPassword(spec.password ?? SEED_PASSWORD),
    createdAt: new Date(0).toISOString(),
  };
}

function seedState() {
  return {
    accounts: SEED_ACCOUNTS.map(seedAccount),
    sessions: {},
  };
}

/**
 * Idempotent upgrade: adds every seed missing by stable id and leaves existing
 * records (including user-registered accounts and changed passwords) untouched.
 * An organization or repository seed that references `seedAccountId(username)`
 * therefore keeps resolving after the upgrade.
 */
function mergeSeedAccounts(draft) {
  if (!Array.isArray(draft.accounts)) draft.accounts = [];
  if (!draft.sessions || typeof draft.sessions !== "object") draft.sessions = {};
  for (const spec of SEED_ACCOUNTS) {
    const id = seedAccountId(spec.username);
    if (draft.accounts.some((entry) => entry.id === id)) continue;
    draft.accounts.push(seedAccount(spec));
  }
  return draft;
}

/**
 * Human-readable label for a browser session. It is derived from the request's
 * User-Agent header at sign-in time and never contains a credential.
 */
export function describeDevice(userAgent) {
  const value = typeof userAgent === "string" ? userAgent : "";
  const browser = /Edg\//.test(value)
    ? "Edge"
    : /OPR\//.test(value)
      ? "Opera"
      : /Chrome\//.test(value)
        ? "Chrome"
        : /Firefox\//.test(value)
          ? "Firefox"
          : /Safari\//.test(value)
            ? "Safari"
            : "Browser";
  const platform = /Windows/.test(value)
    ? "Windows"
    : /Android/.test(value)
      ? "Android"
      : /iPhone|iPad|iPod/.test(value)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(value)
          ? "macOS"
          : /Linux/.test(value)
            ? "Linux"
            : "Unknown OS";
  return `${browser} on ${platform}`;
}

export function createAuthStore(dataDir) {
  const store = createJsonStore(join(dataDir, "auth.json"), seedState());

  // Runs once per store instance: the empty-directory case writes the full seed,
  // an existing file only receives the seeds it is still missing.
  const ready = Promise.resolve(store.update(mergeSeedAccounts)).catch(() => undefined);

  async function readState() {
    await ready;
    const state = await store.read();
    if (!Array.isArray(state.accounts)) state.accounts = [];
    if (!state.sessions || typeof state.sessions !== "object") state.sessions = {};
    return state;
  }

  return {
    dataDir,

    async getSessionAccount(sessionId) {
      if (!sessionId) return null;
      const state = await readState();
      const session = state.sessions[sessionId];
      if (!session || session.active !== true) return null;
      const account = state.accounts.find((entry) => entry.id === session.accountId);
      if (!account || account.available === false) return null;
      return publicAccount(account);
    },

    async conflictFor({ username, email }) {
      const state = await readState();
      return {
        usernameExists: state.accounts.some((entry) => entry.username === username),
        emailExists: state.accounts.some((entry) => entry.email.toLowerCase() === email.toLowerCase()),
      };
    },

    async findAccountByIdentifier(identifier) {
      const value = normalizeText(identifier);
      if (!value) return null;
      const lowered = value.toLowerCase();
      const state = await readState();
      const account = state.accounts.find(
        (entry) => entry.username === value || entry.email.toLowerCase() === lowered,
      );
      return publicAccount(account);
    },

    async findAccountsByIds(ids) {
      const wanted = new Set(ids);
      const state = await readState();
      return state.accounts.filter((entry) => wanted.has(entry.id)).map(publicAccount);
    },

    async register({ username, email, password }) {
      let created = null;
      await store.update((draft) => {
        if (!Array.isArray(draft.accounts)) draft.accounts = [];
        if (draft.accounts.some((entry) => entry.username === username)) return;
        const account = {
          id: `account-${randomUUID()}`,
          username,
          email,
          emailVerified: true,
          available: true,
          credential: hashPassword(password),
          createdAt: new Date().toISOString(),
        };
        draft.accounts.push(account);
        created = publicAccount(account);
      });
      return created;
    },

    async authenticate(identifier, password) {
      const state = await readState();
      const value = normalizeText(identifier);
      if (!value) return null;
      const lowered = value.toLowerCase();
      const account = state.accounts.find(
        (entry) => entry.username === value || entry.email.toLowerCase() === lowered,
      );
      if (!account || account.available === false) return null;
      if (!matchesPassword(password, account.credential)) return null;
      return publicAccount(account);
    },

    async createSession(accountId, deviceLabel) {
      const sessionId = randomUUID();
      const now = new Date().toISOString();
      await store.update((draft) => {
        if (!draft.sessions || typeof draft.sessions !== "object") draft.sessions = {};
        draft.sessions[sessionId] = {
          id: sessionId,
          accountId,
          active: true,
          deviceLabel: deviceLabel || "Unknown device",
          createdAt: now,
          lastActiveAt: now,
        };
      });
      return sessionId;
    },

    async invalidateSession(sessionId) {
      if (!sessionId) return;
      await store.update((draft) => {
        const session = draft.sessions?.[sessionId];
        if (session) session.active = false;
      });
    },

    /**
     * Active sessions of one account, the caller's own session first. Only the
     * non-secret metadata a browser may show is returned; the session id doubles
     * as the opaque identifier the revoke route addresses.
     */
    async listSessions(accountId, currentSessionId) {
      await store.update((draft) => {
        const session = draft.sessions?.[currentSessionId];
        if (session && session.active === true) session.lastActiveAt = new Date().toISOString();
      });
      const state = await readState();
      return Object.values(state.sessions)
        .filter((session) => session.accountId === accountId && session.active === true)
        .sort((a, b) => {
          const aCurrent = a.id === currentSessionId;
          const bCurrent = b.id === currentSessionId;
          if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
          return a.createdAt < b.createdAt ? 1 : -1;
        })
        .map((session) => ({
          id: session.id,
          current: session.id === currentSessionId,
          deviceLabel: session.deviceLabel || "Unknown device",
          lastActiveAt: session.lastActiveAt || session.createdAt,
        }));
    },

    /**
     * Marks one of the account's other sessions inactive. "current" refuses to
     * revoke the browser that is making the request, "not-found" keeps unknown,
     * already-inactive and foreign-account sessions indistinguishable.
     */
    async revokeSession(accountId, sessionId, currentSessionId) {
      if (!sessionId) return "not-found";
      if (sessionId === currentSessionId) return "current";
      let outcome = "not-found";
      await store.update((draft) => {
        const session = draft.sessions?.[sessionId];
        if (!session || session.accountId !== accountId || session.active !== true) {
          outcome = "not-found";
          return;
        }
        session.active = false;
        outcome = "revoked";
      });
      return outcome;
    },

    /**
     * Applies a new credential to the signed-in account only. The verification
     * of the current password happens against the stored scrypt hash here, so
     * the caller cannot bypass it by trusting client-supplied state.
     */
    async changePassword(accountId, input) {
      const state = await readState();
      const account = state.accounts.find((entry) => entry.id === accountId);
      if (!account || account.available === false) {
        return { ok: false, unauthenticated: true, fieldErrors: {} };
      }

      const matches = matchesPassword(input?.currentPassword, account.credential);
      const { fieldErrors } = validatePasswordChange(input, matches);
      if (Object.keys(fieldErrors).length > 0) {
        return { ok: false, unauthenticated: false, fieldErrors };
      }

      const newPassword = input.newPassword;
      await store.update((draft) => {
        const target = draft.accounts?.find((entry) => entry.id === accountId);
        if (target) target.credential = hashPassword(newPassword);
      });
      return { ok: true, message: MESSAGES.passwordUpdated, fieldErrors: {} };
    },

    async resetPassword(email, newPassword) {
      let updated = false;
      await store.update((draft) => {
        const account = draft.accounts?.find(
          (entry) => entry.email.toLowerCase() === email.toLowerCase(),
        );
        if (!account) return;
        account.credential = hashPassword(newPassword);
        for (const session of Object.values(draft.sessions ?? {})) {
          if (session.accountId === account.id) session.active = false;
        }
        updated = true;
      });
      return updated;
    },
  };
}
