import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(account, password) {
  if (!account || !account.salt || !account.passwordHash) return false;
  const candidate = crypto.scryptSync(String(password), account.salt, 64).toString('hex');
  const expected = Buffer.from(account.passwordHash, 'hex');
  const actual = Buffer.from(candidate, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Persistent JSON store. All domain collections live in a single db.json inside
// the data directory (SHALLOW_DATA_DIR, or a local default). Writes are atomic
// (tmp file + rename). Seeds are provisioned only when the store is empty.
export function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'db.json');

  const empty = () => ({ version: 1, accounts: {}, sessions: {} });

  let data;
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      data = empty();
    }
  } else {
    data = empty();
  }

  function persist() {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  function saveAccount(account) {
    data.accounts[account.id] = account;
    persist();
    return account;
  }

  function saveSession(session) {
    data.sessions[session.id] = session;
    persist();
    return session;
  }

  return {
    isSeeded: () => Object.keys(data.accounts).length > 0,

    // ---- accounts ----
    findAccountById(id) {
      return data.accounts[id] || null;
    },
    findAccountByUsername(username) {
      for (const a of Object.values(data.accounts)) {
        if (a.username === username) return a;
      }
      return null;
    },
    findAccountByEmail(email) {
      const normalized = String(email).trim().toLowerCase();
      for (const a of Object.values(data.accounts)) {
        if (a.email === normalized) return a;
      }
      return null;
    },
    findAccountByIdentifier(identifier) {
      const value = String(identifier).trim();
      return this.findAccountByUsername(value) || this.findAccountByEmail(value);
    },
    createAccount({ username, email, password }) {
      const { salt, hash } = hashPassword(password);
      const account = {
        id: crypto.randomUUID(),
        username,
        email: String(email).trim().toLowerCase(),
        emailVerified: true,
        status: 'active',
        salt,
        passwordHash: hash,
        createdAt: new Date().toISOString(),
      };
      return saveAccount(account);
    },
    updateAccountPassword(accountId, password) {
      const account = data.accounts[accountId];
      if (!account) return null;
      const { salt, hash } = hashPassword(password);
      account.salt = salt;
      account.passwordHash = hash;
      persist();
      // Password change invalidates the account's existing sessions (REQ-1).
      let changed = false;
      for (const s of Object.values(data.sessions)) {
        if (s.accountId === accountId && s.active) {
          s.active = false;
          changed = true;
        }
      }
      if (changed) persist();
      return account;
    },

    // ---- sessions ----
    createSession(accountId) {
      const session = {
        id: crypto.randomUUID(),
        accountId,
        active: true,
        createdAt: new Date().toISOString(),
      };
      return saveSession(session);
    },
    findSessionById(id) {
      return data.sessions[id] || null;
    },
    invalidateSession(id) {
      const session = data.sessions[id];
      if (session && session.active) {
        session.active = false;
        persist();
      }
      return session;
    },
  };
}
