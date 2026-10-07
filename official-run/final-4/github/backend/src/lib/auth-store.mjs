import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { join } from "node:path";

import { MESSAGES, normalizeText, validatePasswordChange } from "./auth-rules.mjs";
import { createJsonStore } from "./json-store.mjs";

// Predefined accounts every scenario can rely on. They are only written when the
// persistent store is empty; later user changes are kept on restart.
const SEED_PASSWORD = "Valid-password-123!";
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
  // REQ-1-1-1 / REQ-1-1-2 / REQ-1-4 evolution: the already-taken username, the
  // account whose email lookup is case-insensitive and the three accounts that
  // exercise the browser-session list. They use their own password.
  {
    username: "evo-register-existing",
    email: "evo.register.existing@evolution.test",
    password: "Evo-Password-987!",
  },
  { username: "evo-login-case", email: "evo.login.case@evolution.test", password: "Evo-Password-987!" },
  { username: "evo-session-owner", email: "evo.session.owner@evolution.test", password: "Evo-Password-987!" },
  {
    username: "evo-session-owner-s2",
    email: "evo.session.owner.s2@evolution.test",
    password: "Evo-Password-987!",
  },
  {
    username: "evo-session-owner-s3",
    email: "evo.session.owner.s3@evolution.test",
    password: "Evo-Password-987!",
  },
  // REQ-2-1-2 evolution / REQ-2-4: the account that creates organizations and
  // the Owner and ordinary Member of the audit-log organization (their
  // memberships live in org-seeds.mjs).
  {
    username: "evo-org-owner",
    email: "evo.org.owner@evolution.test",
    password: "Evo-Password-987!",
  },
  {
    username: "evo-audit-owner",
    email: "evo.audit.owner@evolution.test",
    password: "Evo-Password-987!",
  },
  {
    username: "evo-audit-viewer",
    email: "evo.audit.viewer@evolution.test",
    password: "Evo-Password-987!",
  },
  // REQ-3-1 evolution: the owner of the public evolution search repositories.
  // The search scenarios read them as anonymous visitors, so the account only
  // gives the repository a namespace.
  { username: "evo-search-owner", email: "evo.search.owner@evolution.test" },
  // REQ-3-5: the owner of the archive repositories, the repository Admin that
  // archives and restores them and the Member account that reads the archived
  // repository (their grants live in org-seeds.mjs).
  { username: "evo-archive-owner", email: "evo.archive.owner@evolution.test" },
  {
    username: "evo-archive-admin",
    email: "evo.archive.admin@evolution.test",
    password: "Evo-Password-987!",
  },
  {
    username: "evo-archive-viewer",
    email: "evo.archive.viewer@evolution.test",
    password: "Evo-Password-987!",
  },
  // REQ-4-3-1 evolution: the namespace of the public branch-switching fixtures,
  // which the evolution scenarios read without signing in.
  { username: "evo-branch-owner", email: "evo.branch.owner@evolution.test" },
  // REQ-4-5: the namespace of the three public release repositories. This
  // account publishes releases through the "New release" form, so it owns the
  // repositories (which is what grants it the write rule) and keeps the stated
  // password.
  {
    username: "evo-release-owner",
    email: "evo.release.owner@evolution.test",
    password: "Evo-Password-987!",
  },
  // REQ-5-5: the two reaction accounts. `evo-reaction-author` owns the public
  // reaction repository, `evo-reaction-user` adds and removes its own reaction
  // on the issues of that repository.
  {
    username: "evo-reaction-author",
    email: "evo.reaction.author@evolution.test",
    password: "Evo-Password-987!",
  },
  {
    username: "evo-reaction-user",
    email: "evo.reaction.user@evolution.test",
    password: "Evo-Password-987!",
  },
];

/** How often a session's last-active stamp is refreshed while it is in use. */
const SESSION_TOUCH_INTERVAL_MS = 10_000;

const UNKNOWN_DEVICE = "Unknown device";

/**
 * Human-readable device label of a session, derived from the User-Agent of the
 * browser that signed in. It is presentation only: it never carries a secret
 * and an unrecognized browser still gets a stable label.
 */
export function describeDevice(userAgent) {
  const ua = typeof userAgent === "string" ? userAgent : "";
  if (!ua) return UNKNOWN_DEVICE;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Unknown browser";
  const system = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux|X11/.test(ua)
            ? "Linux"
            : "Unknown OS";
  return `${browser} on ${system}`;
}

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

/** True when a stored session record still lacks the current fields. */
function needsSessionUpgrade(session) {
  return (
    typeof session.publicId !== "string" ||
    !session.publicId ||
    typeof session.device !== "string" ||
    !session.device ||
    typeof session.createdAt !== "string" ||
    typeof session.lastActiveAt !== "string"
  );
}

export function createAuthStore(dataDir) {
  const store = createJsonStore(join(dataDir, "auth.json"), seedState());
  let upgrade = null;

  /**
   * Idempotent seed upgrade. A store written by an earlier version keeps every
   * existing account and session; a preset account whose stable id is still
   * missing is appended, and a stored session gains its public identifier,
   * device label and activity stamps in place. Repeated startups change
   * nothing.
   */
  function ensureSeeded() {
    if (!upgrade) {
      upgrade = (async () => {
        const state = await store.read();
        const accounts = Array.isArray(state.accounts) ? state.accounts : [];
        const sessions = state.sessions && typeof state.sessions === "object" ? state.sessions : {};
        const missingAccounts = SEED_ACCOUNTS.filter(
          (spec) =>
            !accounts.some(
              (entry) => entry.id === seedAccountId(spec.username) || entry.username === spec.username,
            ),
        );
        const staleSessions = Object.values(sessions).some(needsSessionUpgrade);
        if (missingAccounts.length === 0 && !staleSessions) return;
        await store.update((draft) => {
          if (!Array.isArray(draft.accounts)) draft.accounts = [];
          if (!draft.sessions || typeof draft.sessions !== "object") draft.sessions = {};
          for (const spec of missingAccounts) {
            if (
              draft.accounts.some(
                (entry) => entry.id === seedAccountId(spec.username) || entry.username === spec.username,
              )
            ) {
              continue;
            }
            draft.accounts.push(seedAccount(spec));
          }
          for (const session of Object.values(draft.sessions)) {
            if (!session) continue;
            if (typeof session.createdAt !== "string") {
              session.createdAt = typeof session.lastActiveAt === "string" ? session.lastActiveAt : new Date().toISOString();
            }
            if (typeof session.lastActiveAt !== "string") session.lastActiveAt = session.createdAt;
            if (typeof session.device !== "string" || !session.device) session.device = UNKNOWN_DEVICE;
            if (typeof session.publicId !== "string" || !session.publicId) session.publicId = randomUUID();
          }
        });
      })();
    }
    return upgrade;
  }

  async function readState() {
    await ensureSeeded();
    const state = await store.read();
    if (!Array.isArray(state.accounts)) state.accounts = [];
    if (!state.sessions || typeof state.sessions !== "object") state.sessions = {};
    return state;
  }

  /** Refreshes the activity stamp of a session that is still in use. */
  async function touchSession(sessionId, session) {
    const now = Date.now();
    const previous = Date.parse(session.lastActiveAt ?? session.createdAt ?? "");
    if (Number.isFinite(previous) && now - previous < SESSION_TOUCH_INTERVAL_MS) return;
    await store.update((draft) => {
      const current = draft.sessions?.[sessionId];
      if (!current || current.active !== true) return;
      current.lastActiveAt = new Date(now).toISOString();
    });
  }

  return {
    dataDir,
    ensureSeeded,

    async getSessionAccount(sessionId) {
      if (!sessionId) return null;
      const state = await readState();
      const session = state.sessions[sessionId];
      if (!session || session.active !== true) return null;
      const account = state.accounts.find((entry) => entry.id === session.accountId);
      if (!account || account.available === false) return null;
      await touchSession(sessionId, session);
      return publicAccount(account);
    },

    /**
     * True when the cookie names a session record that exists but is no longer
     * active (revoked from another browser or ended elsewhere). Such a browser
     * once had a session and must return to the sign-in page, while a browser
     * without a session at all keeps the public visitor entry. Only the caller
     * already holds the cookie value, so nothing secret is revealed.
     */
    async isRevokedSession(sessionId) {
      if (!sessionId) return false;
      const state = await readState();
      const session = state.sessions[sessionId];
      return Boolean(session) && session.active !== true;
    },

    /**
     * The current browser session and the other active sessions of one account,
     * as the security page reads them. The secret session id never leaves the
     * server: a row is addressed by its own public identifier.
     */
    async listSessions(accountId, currentSessionId) {
      if (!accountId) return [];
      const state = await readState();
      return Object.values(state.sessions)
        .filter((session) => session?.accountId === accountId && session.active === true)
        .sort((left, right) => (right.lastActiveAt ?? "").localeCompare(left.lastActiveAt ?? ""))
        .map((session) => ({
          id: session.publicId,
          device: session.device ?? UNKNOWN_DEVICE,
          lastActiveAt: session.lastActiveAt ?? session.createdAt,
          createdAt: session.createdAt,
          current: session.id === currentSessionId,
        }))
        .sort((left, right) => Number(right.current) - Number(left.current));
    },

    /** Marks one of the account's other sessions inactive. */
    async revokeSession(accountId, publicId, currentSessionId) {
      let outcome = { ok: false, status: 404, message: MESSAGES.sessionNotFound };
      await ensureSeeded();
      await store.update((draft) => {
        const session = Object.values(draft.sessions ?? {}).find(
          (entry) => entry?.publicId === publicId && entry.accountId === accountId,
        );
        if (!session || session.active !== true) {
          outcome = { ok: false, status: 404, message: MESSAGES.sessionNotFound };
          return;
        }
        if (session.id === currentSessionId) {
          outcome = { ok: false, status: 400, message: MESSAGES.currentSessionNotRevocable };
          return;
        }
        session.active = false;
        outcome = { ok: true, status: 200, message: MESSAGES.sessionRevoked };
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
      await ensureSeeded();
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

    async createSession(accountId, options = {}) {
      const sessionId = randomUUID();
      const now = new Date().toISOString();
      await ensureSeeded();
      await store.update((draft) => {
        if (!draft.sessions || typeof draft.sessions !== "object") draft.sessions = {};
        draft.sessions[sessionId] = {
          id: sessionId,
          publicId: randomUUID(),
          accountId,
          active: true,
          device: describeDevice(options.userAgent),
          createdAt: now,
          lastActiveAt: now,
        };
      });
      return sessionId;
    },

    async invalidateSession(sessionId) {
      if (!sessionId) return;
      await ensureSeeded();
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
      await ensureSeeded();
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
