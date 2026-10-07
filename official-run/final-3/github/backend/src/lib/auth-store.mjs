import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { join } from "node:path";

import { MESSAGES, normalizeText, validatePasswordChange } from "./auth-rules.mjs";
import { createJsonStore } from "./json-store.mjs";

// Predefined accounts every scenario can rely on. A missing account is added on
// every start (see `upgradeState`), so an existing store still receives the
// current seeds while stored records and later user changes are kept.
const SEED_PASSWORD = "Valid-password-123!";
// Password of the accounts introduced with the evolution scenarios; a seed may
// override the shared password.
const EVOLUTION_SEED_PASSWORD = "Evo-Password-987!";
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
  // REQ-1-1-1 / REQ-1-1-2 (evolution): the account that already owns the
  // username used by the duplicate-registration path, the account whose email
  // is looked up case-insensitively, and the three session owners. They carry
  // their own seeded password instead of the shared one.
  {
    username: "evo-register-existing",
    email: "evo.register.existing@evolution.test",
    password: EVOLUTION_SEED_PASSWORD,
  },
  { username: "evo-login-case", email: "evo.login.case@evolution.test", password: EVOLUTION_SEED_PASSWORD },
  // REQ-2-1-2 / REQ-2-4 (evolution): the account that creates an organization
  // with an uppercase identifier, the Owner of the audit-log organization and
  // its ordinary Member (their memberships live in org-seeds.mjs).
  { username: "evo-org-owner", email: "evo.org.owner@evolution.test", password: EVOLUTION_SEED_PASSWORD },
  {
    username: "evo-audit-owner",
    email: "evo.audit.owner@evolution.test",
    password: EVOLUTION_SEED_PASSWORD,
  },
  {
    username: "evo-audit-viewer",
    email: "evo.audit.viewer@evolution.test",
    password: EVOLUTION_SEED_PASSWORD,
  },
  // REQ-3-1 / REQ-3-5 (evolution): the personal namespaces of the searchable
  // evolution repositories and of the archivable ones. `evo-archive-admin` owns
  // the archivable repositories, so it holds the repository-administrator
  // permission; `evo-archive-viewer` is an ordinary account with no grant and
  // `evo-search-owner` only owns the searchable seeds.
  {
    username: "evo-search-owner",
    email: "evo.search.owner@evolution.test",
    password: EVOLUTION_SEED_PASSWORD,
  },
  {
    username: "evo-archive-admin",
    email: "evo.archive.admin@evolution.test",
    password: EVOLUTION_SEED_PASSWORD,
  },
  {
    username: "evo-archive-viewer",
    email: "evo.archive.viewer@evolution.test",
    password: EVOLUTION_SEED_PASSWORD,
  },
  // REQ-4-3-1 / REQ-4-5 (evolution): the personal namespaces of the
  // branch-switch repositories and of the release repositories. `evo-release-owner`
  // owns the release repositories (its write permission) and is the account the
  // release scenarios sign in with.
  {
    username: "evo-branch-switch-owner",
    email: "evo.branch.switch.owner@evolution.test",
    password: EVOLUTION_SEED_PASSWORD,
  },
  {
    username: "evo-release-owner",
    email: "evo.release.owner@evolution.test",
    password: EVOLUTION_SEED_PASSWORD,
  },
  // REQ-5-5 (evolution): the account that authors and reacts to the reaction
  // issues and owns their public repository, plus the second account that adds
  // and removes only its own reaction (no grant is needed: the repository is
  // public, and any signed-in viewer may react).
  {
    username: "evo-reaction-author",
    email: "evo.reaction.author@evolution.test",
    password: EVOLUTION_SEED_PASSWORD,
  },
  {
    username: "evo-reaction-user",
    email: "evo.reaction.user@evolution.test",
    password: EVOLUTION_SEED_PASSWORD,
  },
  { username: "evo-session-owner", email: "evo.session.owner@evolution.test", password: EVOLUTION_SEED_PASSWORD },
  {
    username: "evo-session-owner-s2",
    email: "evo.session.owner.s2@evolution.test",
    password: EVOLUTION_SEED_PASSWORD,
  },
  {
    username: "evo-session-owner-s3",
    email: "evo.session.owner.s3@evolution.test",
    password: EVOLUTION_SEED_PASSWORD,
  },
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

function seedAccountRecord(spec) {
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
  return { accounts: SEED_ACCOUNTS.map(seedAccountRecord), sessions: {} };
}

/**
 * Idempotent upgrade: adds every predefined account the state does not hold
 * yet, matching the stable account id (and never an existing username). It runs
 * for an existing file too, so a store written by an earlier version still
 * receives the current seeds; stored records and user changes stay untouched,
 * and repeating the upgrade never duplicates a record.
 */
function upgradeState(state) {
  if (!Array.isArray(state.accounts)) state.accounts = [];
  if (!state.sessions || typeof state.sessions !== "object") state.sessions = {};
  const ids = new Set(state.accounts.map((entry) => entry.id));
  const usernames = new Set(state.accounts.map((entry) => entry.username));
  for (const spec of SEED_ACCOUNTS) {
    const id = seedAccountId(spec.username);
    if (ids.has(id) || usernames.has(spec.username)) continue;
    state.accounts.push(seedAccountRecord(spec));
    ids.add(id);
    usernames.add(spec.username);
  }
  return state;
}

const DEFAULT_DEVICE_LABEL = "Unknown device";

/**
 * Human-readable device label of a browser session, derived from the request
 * user agent. Only the browser and the platform are kept: the value is shown in
 * the session list and must never carry a session secret.
 */
export function describeDevice(userAgent) {
  const value = typeof userAgent === "string" ? userAgent : "";
  if (!value.trim()) return DEFAULT_DEVICE_LABEL;
  const browsers = [
    [/Edg\//, "Edge"],
    [/OPR\//, "Opera"],
    [/Firefox\//, "Firefox"],
    [/Chrome\//, "Chrome"],
    [/Safari\//, "Safari"],
  ];
  const platforms = [
    [/Windows/, "Windows"],
    [/iPhone|iPad/, "iOS"],
    [/Android/, "Android"],
    [/Mac OS X|Macintosh/, "macOS"],
    [/Linux/, "Linux"],
  ];
  const browser = browsers.find(([pattern]) => pattern.test(value))?.[1] ?? "Browser";
  const platform = platforms.find(([pattern]) => pattern.test(value))?.[1];
  return platform ? `${browser} on ${platform}` : `${browser} on an unknown platform`;
}

// The last-active timestamp is refreshed at most once per interval, so a burst
// of requests from one browser cannot turn into a write per request.
const ACTIVITY_INTERVAL_MS = 1000;

export function createAuthStore(dataDir) {
  const store = createJsonStore(join(dataDir, "auth.json"), seedState());
  const lastActivity = new Map();

  // The upgrade runs once per store instance and before every read, so the
  // seeds are complete even when the file already existed.
  const upgraded = store.update(upgradeState).catch(() => undefined);

  async function readState() {
    await upgraded;
    const state = await store.read();
    if (!Array.isArray(state.accounts)) state.accounts = [];
    if (!state.sessions || typeof state.sessions !== "object") state.sessions = {};
    return state;
  }

  function sessionRows(state, currentSessionId) {
    const current = state.sessions[currentSessionId];
    if (!current || current.active !== true) return null;
    return Object.values(state.sessions)
      .filter((session) => session.accountId === current.accountId)
      .filter((session) => session.active === true || Boolean(session.revokedAt))
      .sort((left, right) => {
        if (left.id === currentSessionId) return -1;
        if (right.id === currentSessionId) return 1;
        return String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""));
      })
      .map((session) => ({
        key: session.key ?? session.id,
        device: session.deviceLabel ?? DEFAULT_DEVICE_LABEL,
        lastActiveAt: session.lastActiveAt ?? session.createdAt ?? new Date(0).toISOString(),
        current: session.id === currentSessionId,
        revoked: session.active !== true,
      }));
  }

  function markActivity(sessionId) {
    const now = Date.now();
    if (now - (lastActivity.get(sessionId) ?? 0) < ACTIVITY_INTERVAL_MS) return;
    lastActivity.set(sessionId, now);
    void store
      .update((draft) => {
        const session = draft.sessions?.[sessionId];
        if (session) session.lastActiveAt = new Date().toISOString();
      })
      .catch(() => undefined);
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
      markActivity(sessionId);
      return publicAccount(account);
    },

    /**
     * True when the presented session id names a record that was revoked from
     * another browser. A revoked browser still carries its now-inactive cookie,
     * so the server can tell it apart from a visitor that never signed in and
     * the frontend sends it back to the sign-in page instead of the home page.
     */
    async isSessionRevoked(sessionId) {
      if (!sessionId) return false;
      const state = await readState();
      const session = state.sessions[sessionId];
      return Boolean(session && session.active !== true && session.revokedAt);
    },

    /** Active sessions of the signed-in account, without any session secret. */
    async listSessions(sessionId) {
      if (!sessionId) return null;
      const state = await readState();
      return sessionRows(state, sessionId);
    },

    /**
     * Marks one other session of the signed-in account inactive. The current
     * session can never revoke itself, and the account is taken from the stored
     * session record rather than from the request body.
     */
    async revokeSession(sessionId, key) {
      let outcome = { ok: false, reason: "not-found" };
      await store.update((draft) => {
        if (!draft.sessions || typeof draft.sessions !== "object") draft.sessions = {};
        const current = draft.sessions[sessionId];
        if (!current || current.active !== true) {
          outcome = { ok: false, reason: "unauthenticated" };
          return;
        }
        const target = Object.values(draft.sessions).find(
          (session) => session.accountId === current.accountId && (session.key === key || session.id === key),
        );
        if (!target) {
          outcome = { ok: false, reason: "not-found" };
          return;
        }
        if (target.id === sessionId) {
          outcome = { ok: false, reason: "current" };
          return;
        }
        target.active = false;
        target.revokedAt = new Date().toISOString();
        outcome = { ok: true };
      });
      return outcome;
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

    async createSession(accountId, userAgent) {
      const sessionId = randomUUID();
      const now = new Date().toISOString();
      await store.update((draft) => {
        if (!draft.sessions || typeof draft.sessions !== "object") draft.sessions = {};
        draft.sessions[sessionId] = {
          id: sessionId,
          // A session the page may address for revocation. It is deliberately
          // not the cookie value, which stays the only secret of the session.
          key: `session-${randomUUID()}`,
          accountId,
          active: true,
          deviceLabel: describeDevice(userAgent),
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
