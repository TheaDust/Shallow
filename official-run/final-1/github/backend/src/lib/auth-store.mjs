import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { join } from "node:path";

import { MESSAGES, normalizeText, validatePasswordChange } from "./auth-rules.mjs";
import { createJsonStore } from "./json-store.mjs";
import { UNKNOWN_DEVICE } from "./session-device.mjs";

// The stored last-active value is refreshed at most once per interval, so
// ordinary reads stay read-only while the sessions page still reports an
// up-to-date "Last active" time.
const ACTIVE_TOUCH_INTERVAL_MS = 60_000;

// Predefined accounts every scenario can rely on. They are only written when the
// persistent store is empty; later user changes are kept on restart. An entry
// without an explicit password uses the shared seed password below.
const SEED_PASSWORD = "Valid-password-123!";
const EVO_PASSWORD = "Evo-Password-987!";
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
  // REQ-1-1 evolution: the account the duplicate-registration check collides
  // with, the signed-in identity used for the case-insensitive email lookup,
  // and the three accounts whose active browser sessions are managed in
  // account settings. They share the evolution seed password.
  { username: "evo-register-existing", email: "evo.register.existing@evolution.test", password: EVO_PASSWORD },
  { username: "evo-login-case", email: "evo.login.case@evolution.test", password: EVO_PASSWORD },
  { username: "evo-session-owner", email: "evo.session.owner@evolution.test", password: EVO_PASSWORD },
  { username: "evo-session-owner-s2", email: "evo.session.owner.s2@evolution.test", password: EVO_PASSWORD },
  { username: "evo-session-owner-s3", email: "evo.session.owner.s3@evolution.test", password: EVO_PASSWORD },
  // REQ-2-1-2 / REQ-2-4 evolution: the account that creates and owns the new
  // organization, and the Owner and ordinary Member of the audited organization
  // (their memberships and audit events live in org-seeds.mjs).
  { username: "evo-org-owner", email: "evo.org.owner@evolution.test", password: EVO_PASSWORD },
  { username: "evo-audit-owner", email: "evo.audit.owner@evolution.test", password: EVO_PASSWORD },
  { username: "evo-audit-viewer", email: "evo.audit.viewer@evolution.test", password: EVO_PASSWORD },
  // REQ-3-5 evolution: the repository Admin that archives and restores an
  // evolution repository, and the account that reads an archived one (its
  // repository grant lives in org-seeds.mjs).
  { username: "evo-archive-admin", email: "evo.archive.admin@evolution.test", password: EVO_PASSWORD },
  { username: "evo-archive-viewer", email: "evo.archive.viewer@evolution.test", password: EVO_PASSWORD },
  // REQ-4-5 evolution: the Owner account that publishes releases; its Write
  // grants on the release repositories live in org-seeds.mjs.
  { username: "evo-release-owner", email: "evo.release.owner@evolution.test", password: EVO_PASSWORD },
  // REQ-5-5 evolution: the two viewers of the public reaction issues. Reacting
  // only needs a session and read access to the public repository, so neither
  // account carries a repository grant.
  { username: "evo-reaction-author", email: "evo.reaction.author@evolution.test", password: EVO_PASSWORD },
  { username: "evo-reaction-user", email: "evo.reaction.user@evolution.test", password: EVO_PASSWORD },
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

// A browser session record keeps the secret cookie value (`id`) apart from the
// public handle (`publicId`) the settings page lists and revokes, so no session
// secret ever leaves the server. Records written before the evolution lack the
// handle and are ignored.
function isManageableSession(session) {
  return Boolean(session) && typeof session.publicId === "string" && session.publicId !== "";
}

function sessionView(session, currentSecret) {
  return {
    id: session.publicId,
    device: session.device ?? UNKNOWN_DEVICE,
    active: session.active === true,
    current: session.id === currentSecret,
    lastActive: session.lastActiveAt ?? session.createdAt ?? "",
    createdAt: session.createdAt ?? "",
  };
}

function seedState() {
  return {
    accounts: SEED_ACCOUNTS.map((spec) => ({
      id: seedAccountId(spec.username),
      username: spec.username,
      email: spec.email,
      emailVerified: true,
      available: true,
      credential: hashPassword(spec.password ?? SEED_PASSWORD),
      createdAt: new Date(0).toISOString(),
    })),
    sessions: {},
  };
}

export function createAuthStore(dataDir) {
  const store = createJsonStore(join(dataDir, "auth.json"), seedState());

  async function readState() {
    const state = await store.read();
    if (!Array.isArray(state.accounts)) state.accounts = [];
    if (!state.sessions || typeof state.sessions !== "object") state.sessions = {};
    return state;
  }

  /**
   * Resolves one session cookie into the signed-in user plus whether that
   * browser held a session that has since been revoked. A revoked browser is
   * sent back to the sign-in page instead of being treated as a visitor.
   */
  async function describeSession(sessionId) {
    if (!sessionId) return { user: null, revoked: false };
    const state = await readState();
    const session = state.sessions[sessionId];
    if (!isManageableSession(session)) return { user: null, revoked: false };
    if (session.active !== true) return { user: null, revoked: true };
    const account = state.accounts.find((entry) => entry.id === session.accountId);
    if (!account || account.available === false) return { user: null, revoked: false };
    const now = Date.now();
    const lastActive = Date.parse(session.lastActiveAt ?? session.createdAt ?? "") || 0;
    if (now - lastActive >= ACTIVE_TOUCH_INTERVAL_MS) {
      await store.update((draft) => {
        const target = draft.sessions?.[sessionId];
        if (target && target.active === true) target.lastActiveAt = new Date(now).toISOString();
      });
    }
    return { user: publicAccount(account), revoked: false };
  }

  return {
    dataDir,

    async getSessionAccount(sessionId) {
      const { user } = await describeSession(sessionId);
      return user;
    },

    describeSession,

    /** Every session of one account, newest first, including revoked rows. */
    async listSessions(accountId, currentSecret) {
      const state = await readState();
      return Object.values(state.sessions)
        .filter((session) => session.accountId === accountId && isManageableSession(session))
        .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))
        .map((session) => sessionView(session, currentSecret));
    },

    /** Marks one session of the account inactive; only its own rows are revocable. */
    async revokeSession(accountId, publicId) {
      let revoked = false;
      await store.update((draft) => {
        const target = Object.values(draft.sessions ?? {}).find(
          (session) => session.accountId === accountId && session.publicId === publicId,
        );
        if (!target) return;
        target.active = false;
        revoked = true;
      });
      return revoked;
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

    async createSession(accountId, { device = UNKNOWN_DEVICE } = {}) {
      const sessionId = randomUUID();
      const now = new Date().toISOString();
      await store.update((draft) => {
        if (!draft.sessions || typeof draft.sessions !== "object") draft.sessions = {};
        draft.sessions[sessionId] = {
          id: sessionId,
          publicId: randomUUID(),
          accountId,
          active: true,
          device,
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
