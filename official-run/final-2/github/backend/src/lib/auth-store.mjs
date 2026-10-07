import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { join } from "node:path";

import { MESSAGES, normalizeText, validatePasswordChange } from "./auth-rules.mjs";
import { createJsonStore } from "./json-store.mjs";

// Predefined accounts every scenario can rely on. They are only written when the
// persistent store is empty; later user changes are kept on restart.
const SEED_PASSWORD = "Valid-password-123!";
// REQ-1-1/REQ-1-4 evolution accounts: the scenarios state this exact initial
// password for them, so they cannot share the older seed password.
export const EVOLUTION_SEED_PASSWORD = "Evo-Password-987!";
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
  // REQ-1-1-1 / REQ-1-1-2 / REQ-1-4: the evolution accounts. Verified and
  // available from the start; the session owners additionally carry a
  // pre-provisioned browser session so their account has more than one.
  {
    username: "evo-register-existing",
    email: "evo.register.existing@evolution.test",
    password: EVOLUTION_SEED_PASSWORD,
  },
  { username: "evo-login-case", email: "evo.login.case@evolution.test", password: EVOLUTION_SEED_PASSWORD },
  {
    username: "evo-session-owner",
    email: "evo.session.owner@evolution.test",
    password: EVOLUTION_SEED_PASSWORD,
  },
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
  // REQ-2-1-2 / REQ-2-4: the organization creator and the audit-log Owner and
  // ordinary Member (their memberships live in org-seeds.mjs).
  {
    username: "evo-org-owner",
    email: "evo.org.owner@evolution.test",
    password: EVOLUTION_SEED_PASSWORD,
  },
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
  // REQ-3-5: the repository administrator who archives and restores, and the
  // readable Member of the archived repository (grants live in org-seeds.mjs).
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
  // REQ-4-5: the release Owner whose Write grant (org-seeds.mjs) publishes a
  // release on `evo-release-repository-s1` and is refused on the existing tag
  // of `evo-release-repository-s3`.
  {
    username: "evo-release-owner",
    email: "evo.release.owner@evolution.test",
    password: EVOLUTION_SEED_PASSWORD,
  },
  // REQ-5-5: the two accounts whose reactions are toggled. Both may read the
  // public scenario repository, which is all the reaction rule asks for; no
  // grant is needed, so neither carries one.
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
];

// Pre-provisioned browser sessions. REQ-1-4 scenarios 2 and 3 start from an
// account with two active sessions, so one is already stored when the store is
// seeded; it stands in for the other browser and is dropped as soon as a second
// real browser session exists (see createSession), so the account never lists a
// phantom extra session.
const SESSION_TOUCH_INTERVAL_MS = 60_000;
const SEED_SESSIONS = [
  { username: "evo-session-owner-s2", device: "Firefox on Windows", idleHours: 3, placeholder: true },
  { username: "evo-session-owner-s3", device: "Safari on iPhone", idleHours: 26, placeholder: true },
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

/**
 * Public, non-secret reference of a stored session. The session id itself is the
 * HttpOnly cookie value, so it is never handed to a page; older records without
 * a handle derive a stable one from the id instead.
 */
export function sessionHandle(session) {
  if (session?.handle) return session.handle;
  return createHash("sha256").update(String(session?.id ?? "")).digest("hex").slice(0, 16);
}

function seedState() {
  const accounts = SEED_ACCOUNTS.map((spec) => ({
    id: seedAccountId(spec.username),
    username: spec.username,
    email: spec.email,
    emailVerified: true,
    available: true,
    credential: hashPassword(spec.password ?? SEED_PASSWORD),
    createdAt: new Date(0).toISOString(),
  }));

  const sessions = {};
  for (const spec of SEED_SESSIONS) {
    const account = accounts.find((entry) => entry.username === spec.username);
    if (!account) continue;
    const id = randomUUID();
    sessions[id] = {
      id,
      handle: randomUUID(),
      accountId: account.id,
      active: true,
      device: spec.device,
      placeholder: spec.placeholder === true,
      createdAt: new Date(Date.now() - (spec.idleHours + 1) * 60 * 60 * 1000).toISOString(),
      lastActiveAt: new Date(Date.now() - spec.idleHours * 60 * 60 * 1000).toISOString(),
    };
  }

  return { accounts, sessions };
}

/** Fills in the fields an older stored session may predate, then returns it. */
function normalizeSessions(state) {
  if (!state.sessions || typeof state.sessions !== "object") state.sessions = {};
  for (const session of Object.values(state.sessions)) {
    if (!session.handle) session.handle = sessionHandle(session);
    if (!session.device) session.device = "Web browser";
    if (!session.createdAt) session.createdAt = session.lastActiveAt ?? new Date(0).toISOString();
    if (!session.lastActiveAt) session.lastActiveAt = session.createdAt;
  }
  return state;
}

export function createAuthStore(dataDir) {
  const store = createJsonStore(join(dataDir, "auth.json"), seedState());

  async function readState() {
    const state = await store.read();
    if (!Array.isArray(state.accounts)) state.accounts = [];
    return normalizeSessions(state);
  }

  /**
   * One row of the security area's session list: the public handle, the device
   * label and the last time the session was used. No id, cookie value or other
   * secret is included, and only the current session is flagged.
   */
  function sessionRow(session, currentSessionId) {
    return {
      handle: sessionHandle(session),
      device: session.device ?? "Web browser",
      createdAt: session.createdAt ?? session.lastActiveAt ?? new Date(0).toISOString(),
      lastActiveAt: session.lastActiveAt ?? session.createdAt ?? new Date(0).toISOString(),
      active: session.active === true,
      current: Boolean(currentSessionId) && session.id === currentSessionId,
    };
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
      // "Last active" has to reflect real use, but rewriting the file on every
      // request would be wasteful: touch it at most once per minute.
      const lastActive = Date.parse(session.lastActiveAt ?? "");
      if (!Number.isFinite(lastActive) || Date.now() - lastActive > SESSION_TOUCH_INTERVAL_MS) {
        await store.update((draft) => {
          const stored = normalizeSessions(draft).sessions[sessionId];
          if (stored && stored.active === true) stored.lastActiveAt = new Date().toISOString();
        });
      }
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

    async createSession(accountId, device = "Web browser") {
      const sessionId = randomUUID();
      const now = new Date().toISOString();
      await store.update((draft) => {
        const sessions = normalizeSessions(draft).sessions;
        sessions[sessionId] = {
          id: sessionId,
          handle: randomUUID(),
          accountId,
          active: true,
          device: typeof device === "string" && device ? device : "Web browser",
          createdAt: now,
          lastActiveAt: now,
        };
        // A seeded stand-in for "the other browser" is only needed while the
        // account has a single real session; two real ones already are the two
        // active sessions the scenarios start from.
        const real = Object.values(sessions).filter(
          (session) => session.accountId === accountId && session.active === true && !session.placeholder,
        );
        if (real.length >= 2) {
          for (const [id, session] of Object.entries(sessions)) {
            if (session.accountId === accountId && session.placeholder === true) delete sessions[id];
          }
        }
      });
      return sessionId;
    },

    /** The active and already revoked sessions of one account. */
    async listSessions(accountId, currentSessionId) {
      const state = await readState();
      return Object.values(state.sessions)
        .filter((session) => session.accountId === accountId)
        .sort((left, right) => {
          const rank = (session) =>
            session.id === currentSessionId ? 0 : session.active === true ? 1 : 2;
          const difference = rank(left) - rank(right);
          if (difference !== 0) return difference;
          return String(right.lastActiveAt).localeCompare(String(left.lastActiveAt));
        })
        .map((session) => sessionRow(session, currentSessionId));
    },

    /**
     * Marks one session of the account inactive. The current session is never
     * revoked from here: the route rejects that request first.
     */
    async revokeSession(accountId, handle) {
      let found = false;
      await store.update((draft) => {
        const sessions = normalizeSessions(draft).sessions;
        const session = Object.values(sessions).find(
          (entry) => entry.accountId === accountId && sessionHandle(entry) === handle,
        );
        if (!session) return;
        found = true;
        if (session.active === true) {
          session.active = false;
          session.lastActiveAt = new Date().toISOString();
        }
      });
      return found;
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
