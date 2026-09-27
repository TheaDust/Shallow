import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  hashPassword,
  loadStore,
  resolveDataDir,
  saveStore,
  verifyPassword,
} from './store.js';
import {
  isValidPassword,
  isValidUsername,
  normalizeEmail,
  validateEmail,
} from './validation.js';

const BACKEND_ROOT = dirname(fileURLToPath(import.meta.url)) + '/..';
const FRONTEND_DIST = join(BACKEND_ROOT, '..', 'frontend', 'dist');

const SESSION_COOKIE = 'session_id';
const FIXED_RESET_CODE = '123456';

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

function sessionCookie(value) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function findAccountByIdentifier(store, identifier) {
  const normalized = normalizeEmail(identifier).toLowerCase();
  return store.accounts.find(
    (acc) =>
      acc.email.toLowerCase() === normalized || acc.username === identifier.trim()
  );
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

function handleRegister(store, body) {
  const fieldErrors = {};

  const username = typeof body.username === 'string' ? body.username : '';
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const confirmPassword =
    typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
  const terms = body.terms === true;

  if (!username) {
    fieldErrors.username = 'Username is required';
  } else if (!isValidUsername(username)) {
    fieldErrors.username = 'Username format is invalid';
  } else if (store.accounts.some((acc) => acc.username === username)) {
    fieldErrors.username = 'Username already exists';
  }

  if (!email) {
    fieldErrors.email = 'Email is required';
  } else if (!validateEmail(email)) {
    fieldErrors.email = 'Email format is invalid';
  } else if (
    store.accounts.some((acc) => acc.email.toLowerCase() === email.toLowerCase())
  ) {
    fieldErrors.email = 'Email already exists';
  }

  if (!password) {
    fieldErrors.password = 'Password is required';
  } else if (!isValidPassword(password)) {
    fieldErrors.password = 'Password requirements are not satisfied';
  }

  if (!confirmPassword) {
    fieldErrors.confirmPassword = 'Confirm password is required';
  } else if (password && confirmPassword !== password) {
    fieldErrors.confirmPassword = 'Passwords do not match';
  }

  if (!terms) {
    fieldErrors.terms = 'Agree to terms is required';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { status: 422, body: { error: 'Registration failed', fieldErrors } };
  }

  const { salt, hash } = hashPassword(password);
  store.accounts.push({
    id: `acc_${store.nextAccountId++}`,
    username,
    email,
    emailVerified: true,
    status: 'active',
    passwordSalt: salt,
    passwordHash: hash,
  });
  const dataDir = resolveDataDir();
  saveStore(store, dataDir);

  return {
    status: 201,
    body: { ok: true, account: { username, email, emailVerified: true } },
  };
}

function handleSignIn(store, body) {
  const identifier = typeof body.identifier === 'string' ? body.identifier : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const account = identifier
    ? findAccountByIdentifier(store, identifier)
    : undefined;
  const valid =
    account &&
    account.status === 'active' &&
    verifyPassword(password, account.passwordSalt, account.passwordHash);

  if (!valid) {
    return {
      status: 401,
      body: { error: 'Invalid credentials' },
      clearCookie: true,
    };
  }

  const session = {
    id: randomUUID(),
    accountId: account.id,
    active: true,
    createdAt: new Date().toISOString(),
  };
  store.sessions.push(session);
  saveStore(store, resolveDataDir());

  return {
    status: 200,
    body: {
      ok: true,
      user: { username: account.username, email: account.email },
    },
    setCookie: sessionCookie(session.id),
  };
}

function handleSignOut(store, req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];
  if (sessionId) {
    const idx = store.sessions.findIndex((s) => s.id === sessionId);
    if (idx !== -1) {
      store.sessions[idx].active = false;
      saveStore(store, resolveDataDir());
    }
  }
  return { status: 200, body: { ok: true }, clearCookie: true };
}

function handleMe(store, req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];
  const session = sessionId
    ? store.sessions.find((s) => s.id === sessionId && s.active)
    : undefined;
  if (!session) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }
  const account = store.accounts.find((a) => a.id === session.accountId);
  if (!account) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }
  return {
    status: 200,
    body: { user: { username: account.username, email: account.email } },
  };
}

// ---------------------------------------------------------------------------
// Repository handlers
// ---------------------------------------------------------------------------

function getSessionAccount(store, req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];
  const session = sessionId
    ? store.sessions.find((s) => s.id === sessionId && s.active)
    : undefined;
  if (!session) return null;
  return store.accounts.find((a) => a.id === session.accountId) || null;
}

// Access rule shared by search, lists, direct links and repository pages:
// public repositories are readable by everyone; private personal repositories
// are readable by their owner or an explicit collaborator grant.
function canViewRepository(account, repo) {
  if (!repo) return false;
  if (repo.visibility === 'public') return true;
  if (!account) return false;
  if (repo.owner === account.username) return true;
  return (repo.collaborators || []).some((c) => c.username === account.username);
}

function findRepository(store, owner, name) {
  return store.repositories.find((r) => r.owner === owner && r.name === name);
}

// The role list for issue operations is explicit: Triage/Maintain/Admin manage
// metadata (assignees, labels, milestones, status); the repository owner acts
// with Admin permission. Collaborator grants are the only other role source.
function getRepoRole(account, repo) {
  if (!account) return null;
  if (repo.owner === account.username) return 'admin';
  const grant = (repo.collaborators || []).find((c) => c.username === account.username);
  return grant ? grant.role : null;
}

function canManageIssueMetadata(account, repo) {
  const role = getRepoRole(account, repo);
  return role === 'admin' || role === 'maintain' || role === 'triage';
}

// Content editing (title/description) is allowed for Write, Maintain, and
// Admin only; Read and Triage may only view. The repository owner acts with
// Admin permission.
function canEditIssueContent(account, repo) {
  const role = getRepoRole(account, repo);
  return role === 'admin' || role === 'maintain' || role === 'write';
}

function repositoryPayload(repo) {
  return {
    owner: repo.owner,
    name: repo.name,
    visibility: repo.visibility,
    description: repo.description,
    defaultBranch: repo.defaultBranch,
    createdAt: repo.createdAt,
    updatedAt: repo.updatedAt,
    files: rootEntries(repo),
  };
}

function issueSummary(issue) {
  return {
    number: issue.number,
    title: issue.title,
    status: issue.status,
    author: issue.author,
    description: issue.description || '',
    labels: [...(issue.labels || [])],
    assignees: [...(issue.assignees || [])],
    milestone: issue.milestone || null,
    updatedAt: issue.updatedAt,
  };
}

function issueDetailPayload(issue, account, repo) {
  return {
    ...issueSummary(issue),
    createdAt: issue.createdAt,
    comments: (issue.comments || []).map((c) => ({
      id: c.id,
      author: c.author,
      body: c.body,
      createdAt: c.createdAt,
    })),
    activity: (issue.activity || [])
      .map((a) => ({
        id: a.id,
        type: a.type,
        author: a.author,
        createdAt: a.createdAt,
        label: a.label || null,
        commentId: a.commentId || null,
        milestone: a.milestone !== undefined ? a.milestone : null,
        value: a.value !== undefined ? a.value : null,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    permissions: {
      manageMetadata: canManageIssueMetadata(account, repo),
      canEditContent: canEditIssueContent(account, repo),
    },
  };
}

function findIssue(repo, number) {
  if (!Number.isInteger(number) || number <= 0) return null;
  return (repo.issues || []).find((i) => i.number === number) || null;
}

function rootEntries(repo) {
  const entries = new Map();
  for (const file of repo.files) {
    const [first, ...rest] = file.path.split('/');
    entries.set(first, {
      name: first,
      path: first,
      type: rest.length === 0 ? 'file' : 'directory',
    });
  }
  return [...entries.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function entriesUnder(repo, dirPath) {
  const prefix = dirPath ? `${dirPath}/` : '';
  const entries = new Map();
  for (const file of repo.files) {
    if (file.path === dirPath || !file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    const [first] = rest.split('/');
    const path = `${dirPath ? `${dirPath}/` : ''}${first}`;
    if (!entries.has(path)) {
      entries.set(path, {
        name: first,
        path,
        type: rest.includes('/') ? 'directory' : 'file',
      });
    }
  }
  return [...entries.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function handleSearch(store, req, url) {
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const account = getSessionAccount(store, req);
  const results = q
    ? store.repositories
        .filter((repo) => canViewRepository(account, repo))
        .filter((repo) => repo.name.toLowerCase().includes(q))
        .map((repo) => ({
          owner: repo.owner,
          name: repo.name,
          description: repo.description,
          visibility: repo.visibility,
          updatedAt: repo.updatedAt,
        }))
    : [];
  return { status: 200, body: { results } };
}

function handleRepositoryDetail(store, req, segments) {
  const owner = segments[3];
  const name = segments[4];
  const repo = findRepository(store, owner, name);
  const account = getSessionAccount(store, req);
  if (!canViewRepository(account, repo)) {
    return { status: 404, body: { error: 'Not found' } };
  }
  return {
    status: 200,
    body: { repository: repositoryPayload(repo) },
  };
}

function handleIssueList(store, req, segments) {
  const owner = segments[3];
  const name = segments[4];
  const repo = findRepository(store, owner, name);
  const account = getSessionAccount(store, req);
  if (!canViewRepository(account, repo)) {
    return { status: 404, body: { error: 'Not found' } };
  }
  return {
    status: 200,
    body: {
      repository: repositoryPayload(repo),
      issues: (repo.issues || []).map(issueSummary),
      labels: repo.labels || [],
      milestones: repo.milestones || [],
    },
  };
}

function handleIssueDetail(store, req, segments) {
  const owner = segments[3];
  const name = segments[4];
  const repo = findRepository(store, owner, name);
  const account = getSessionAccount(store, req);
  if (!canViewRepository(account, repo)) {
    return { status: 404, body: { error: 'Not found' } };
  }
  const issue = findIssue(repo, Number(segments[6]));
  if (!issue) {
    return { status: 404, body: { error: 'Not found' } };
  }
  return {
    status: 200,
    body: {
      repository: repositoryPayload(repo),
      issue: issueDetailPayload(issue, account, repo),
      labels: repo.labels || [],
      milestones: repo.milestones || [],
    },
  };
}

// Updates only the title and/or description of the target issue (REQ-5-2-2).
// Validation is atomic: if any provided field is invalid the whole request is
// rejected with the original values retained; successful saves append an
// activity record storing the editor, edit time, and new value.
function handleUpdateIssueContent(store, req, body, segments) {
  const owner = segments[3];
  const name = segments[4];
  const repo = findRepository(store, owner, name);
  const account = getSessionAccount(store, req);
  if (!canViewRepository(account, repo)) {
    return { status: 404, body: { error: 'Not found' } };
  }
  if (!canEditIssueContent(account, repo)) {
    return { status: 403, body: { error: 'Forbidden' } };
  }
  const issue = findIssue(repo, Number(segments[6]));
  if (!issue) {
    return { status: 404, body: { error: 'Not found' } };
  }

  const fieldErrors = {};
  let title = null;
  let description = null;
  if (body.title !== undefined) {
    title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      fieldErrors.title = 'Title is required';
    } else if (title.length > 256) {
      fieldErrors.title = 'Title is too long';
    }
  }
  if (body.description !== undefined) {
    description = typeof body.description === 'string' ? body.description : '';
    if (description.length > 65536) {
      fieldErrors.description = 'Description is too long';
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { status: 422, body: { error: 'Issue update failed', fieldErrors } };
  }
  if (title === null && description === null) {
    return { status: 422, body: { error: 'Nothing to update', fieldErrors: {} } };
  }

  const now = new Date().toISOString();
  if (title !== null) {
    issue.title = title;
    issue.activity.push({
      id: randomUUID(),
      type: 'title_edited',
      author: account.username,
      createdAt: now,
      value: title,
    });
  }
  if (description !== null) {
    issue.description = description;
    issue.activity.push({
      id: randomUUID(),
      type: 'description_edited',
      author: account.username,
      createdAt: now,
      value: description,
    });
  }
  issue.updatedAt = now;
  saveStore(store, resolveDataDir());

  return {
    status: 200,
    body: { issue: issueDetailPayload(issue, account, repo) },
  };
}

// Sets or removes the milestone association on the target issue (REQ-5-3-3).
// Only Triage/Maintain/Admin may submit; the milestone must already exist in
// the current repository, so names from other repositories are rejected.
function handleUpdateIssueMilestone(store, req, body, segments) {
  const owner = segments[3];
  const name = segments[4];
  const repo = findRepository(store, owner, name);
  const account = getSessionAccount(store, req);
  if (!canViewRepository(account, repo)) {
    return { status: 404, body: { error: 'Not found' } };
  }
  if (!canManageIssueMetadata(account, repo)) {
    return { status: 403, body: { error: 'Forbidden' } };
  }
  const issue = findIssue(repo, Number(segments[6]));
  if (!issue) {
    return { status: 404, body: { error: 'Not found' } };
  }

  const requested =
    body.milestone === null
      ? null
      : typeof body.milestone === 'string'
        ? body.milestone.trim()
        : undefined;
  if (requested === undefined || requested === '') {
    return {
      status: 422,
      body: {
        error: 'Invalid milestone',
        fieldErrors: { milestone: 'Milestone does not exist in this repository' },
      },
    };
  }
  if (requested !== null && !(repo.milestones || []).some((m) => m.name === requested)) {
    return {
      status: 422,
      body: {
        error: 'Invalid milestone',
        fieldErrors: { milestone: 'Milestone does not exist in this repository' },
      },
    };
  }
  if (issue.milestone === requested) {
    return {
      status: 200,
      body: { issue: issueDetailPayload(issue, account, repo) },
    };
  }

  const now = new Date().toISOString();
  issue.milestone = requested;
  issue.activity.push({
    id: randomUUID(),
    type: 'milestone_changed',
    author: account.username,
    createdAt: now,
    milestone: requested,
  });
  issue.updatedAt = now;
  saveStore(store, resolveDataDir());

  return {
    status: 200,
    body: { issue: issueDetailPayload(issue, account, repo) },
  };
}

// Closes or reopens an issue (REQ-5-4). Only Triage/Maintain/Admin may submit;
// the status transition appends a closed/reopened activity and never touches
// the title, description, comments, labels, assignees, or milestone.
function handleUpdateIssueStatus(store, req, body, segments) {
  const owner = segments[3];
  const name = segments[4];
  const repo = findRepository(store, owner, name);
  const account = getSessionAccount(store, req);
  if (!canViewRepository(account, repo)) {
    return { status: 404, body: { error: 'Not found' } };
  }
  if (!canManageIssueMetadata(account, repo)) {
    return { status: 403, body: { error: 'Forbidden' } };
  }
  const issue = findIssue(repo, Number(segments[6]));
  if (!issue) {
    return { status: 404, body: { error: 'Not found' } };
  }

  const status = body.status;
  if (status !== 'open' && status !== 'closed') {
    return { status: 422, body: { error: 'Invalid status' } };
  }
  if (issue.status === status) {
    return {
      status: 200,
      body: { issue: issueDetailPayload(issue, account, repo) },
    };
  }

  const now = new Date().toISOString();
  issue.status = status;
  issue.activity.push({
    id: randomUUID(),
    type: status === 'closed' ? 'closed' : 'reopened',
    author: account.username,
    createdAt: now,
  });
  issue.updatedAt = now;
  saveStore(store, resolveDataDir());

  return {
    status: 200,
    body: { issue: issueDetailPayload(issue, account, repo) },
  };
}

// Applies or removes labels on an issue. Only Triage/Maintain/Admin may submit;
// every label must already exist in the current repository, so names from other
// repositories or invented names are rejected without changing any data.
function handleUpdateIssueLabels(store, req, body, segments) {
  const owner = segments[3];
  const name = segments[4];
  const repo = findRepository(store, owner, name);
  const account = getSessionAccount(store, req);
  if (!canViewRepository(account, repo)) {
    return { status: 404, body: { error: 'Not found' } };
  }
  if (!canManageIssueMetadata(account, repo)) {
    return { status: 403, body: { error: 'Forbidden' } };
  }
  const issue = findIssue(repo, Number(segments[6]));
  if (!issue) {
    return { status: 404, body: { error: 'Not found' } };
  }
  const requested = Array.isArray(body.labels)
    ? body.labels.map((l) => (typeof l === 'string' ? l.trim() : '')).filter(Boolean)
    : [];
  const unique = [...new Set(requested)];
  const repoLabelNames = (repo.labels || []).map((l) => l.name);
  if (unique.some((l) => !repoLabelNames.includes(l))) {
    return {
      status: 422,
      body: { error: 'Invalid labels', fieldErrors: { labels: 'Label does not exist in this repository' } },
    };
  }

  const current = issue.labels || [];
  const added = unique.filter((l) => !current.includes(l));
  const removed = current.filter((l) => !unique.includes(l));
  if (added.length === 0 && removed.length === 0) {
    return { status: 200, body: { issue: issueDetailPayload(issue, account, repo) } };
  }

  const now = new Date().toISOString();
  issue.labels = unique;
  for (const label of added) {
    issue.activity.push({
      id: randomUUID(),
      type: 'label_added',
      author: account.username,
      createdAt: now,
      label,
    });
  }
  for (const label of removed) {
    issue.activity.push({
      id: randomUUID(),
      type: 'label_removed',
      author: account.username,
      createdAt: now,
      label,
    });
  }
  issue.updatedAt = now;
  saveStore(store, resolveDataDir());

  return {
    status: 200,
    body: { issue: issueDetailPayload(issue, account, repo) },
  };
}

function handleFileContent(store, req, url, segments) {
  const owner = segments[3];
  const name = segments[4];
  const repo = findRepository(store, owner, name);
  const account = getSessionAccount(store, req);
  if (!canViewRepository(account, repo)) {
    return { status: 404, body: { error: 'Not found' } };
  }
  const path = url.searchParams.get('path') || '';
  const file = repo.files.find((f) => f.path === path);
  if (!file) {
    return { status: 404, body: { error: 'Not found' } };
  }
  return {
    status: 200,
    body: {
      file: {
        owner: repo.owner,
        name: repo.name,
        branch: repo.defaultBranch,
        path: file.path,
        fileName: file.path.split('/').pop(),
        content: file.content,
      },
    },
  };
}

function handleDirectoryEntries(store, req, url, segments) {
  const owner = segments[3];
  const name = segments[4];
  const repo = findRepository(store, owner, name);
  const account = getSessionAccount(store, req);
  if (!canViewRepository(account, repo)) {
    return { status: 404, body: { error: 'Not found' } };
  }
  const path = url.searchParams.get('path') || '';
  return { status: 200, body: { entries: entriesUnder(repo, path) } };
}

function handleChangePassword(store, req, body) {
  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];
  const session = sessionId
    ? store.sessions.find((s) => s.id === sessionId && s.active)
    : undefined;
  const account = session
    ? store.accounts.find((a) => a.id === session.accountId)
    : undefined;
  if (!account) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  const fieldErrors = {};
  const currentPassword =
    typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  const confirmPassword =
    typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

  if (!currentPassword) {
    fieldErrors.currentPassword = 'Current password is required';
  } else if (!verifyPassword(currentPassword, account.passwordSalt, account.passwordHash)) {
    fieldErrors.currentPassword = 'Current password is incorrect';
  }

  if (!newPassword) {
    fieldErrors.newPassword = 'New password is required';
  } else if (!isValidPassword(newPassword)) {
    fieldErrors.newPassword = 'Password requirements are not satisfied';
  }

  if (!confirmPassword) {
    fieldErrors.confirmPassword = 'Confirm password is required';
  } else if (newPassword && confirmPassword !== newPassword) {
    fieldErrors.confirmPassword = 'Password confirmation does not match';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: 422,
      body: { error: 'Password change failed', fieldErrors },
    };
  }

  // Atomically replace only this account's credential record.
  const { salt, hash } = hashPassword(newPassword);
  account.passwordSalt = salt;
  account.passwordHash = hash;
  saveStore(store, resolveDataDir());

  return { status: 200, body: { ok: true, message: 'Password updated' } };
}

function handleForgotPassword() {
  // Always answer the same way so the page cannot disclose whether the
  // address belongs to a registered account. The fixed verification code
  // is displayed by the frontend for local demonstration only.
  return { status: 200, body: { ok: true } };
}

function handleResetPassword(store, body) {
  const fieldErrors = {};
  const email = normalizeEmail(body.email);
  const code = typeof body.code === 'string' ? body.code : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  const confirmPassword =
    typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

  const account = store.accounts.find(
    (acc) => acc.email.toLowerCase() === email.toLowerCase()
  );

  if (!email) {
    fieldErrors.email = 'Email is required';
  } else if (!account) {
    fieldErrors.email = 'Email is not registered';
  }

  if (!code) {
    fieldErrors.code = 'Verification code is required';
  } else if (code !== FIXED_RESET_CODE) {
    fieldErrors.code = 'Verification code is invalid';
  }

  if (!newPassword) {
    fieldErrors.newPassword = 'New password is required';
  } else if (!isValidPassword(newPassword)) {
    fieldErrors.newPassword = 'Password requirements are not satisfied';
  }

  if (!confirmPassword) {
    fieldErrors.confirmPassword = 'Confirm password is required';
  } else if (newPassword && confirmPassword !== newPassword) {
    fieldErrors.confirmPassword = 'Passwords do not match';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { status: 422, body: { error: 'Password reset failed', fieldErrors } };
  }

  const { salt, hash } = hashPassword(newPassword);
  account.passwordSalt = salt;
  account.passwordHash = hash;
  saveStore(store, resolveDataDir());

  return { status: 200, body: { ok: true, message: 'Password updated' } };
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  let filePath = normalize(join(FRONTEND_DIST, requested));
  if (!filePath.startsWith(normalize(FRONTEND_DIST))) {
    json(res, 404, { error: 'Not found' });
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    json(res, 404, { error: 'Not found' });
    return;
  }
  const content = readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': content.length,
  });
  res.end(content);
}

// ---------------------------------------------------------------------------
// Handler / server
// ---------------------------------------------------------------------------

export function createHandler() {
  let store = null;
  return function handler(req, res) {
    if (!store) {
      try {
        store = loadStore(resolveDataDir());
      } catch (err) {
        json(res, 500, { error: 'Storage unavailable' });
        return;
      }
    }

    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (req.method === 'GET' && (pathname === '/health' || pathname === '/api/health')) {
      json(res, 200, { status: 'ok' });
      return;
    }

    if (pathname.startsWith('/api/')) {
      if (req.method === 'GET' && pathname === '/api/search') {
        json(res, 200, handleSearch(store, req, url).body);
        return;
      }
      if (req.method === 'GET' && pathname.startsWith('/api/repositories/')) {
        const segments = pathname.split('/');
        if (segments.length === 5) {
          const result = handleRepositoryDetail(store, req, segments);
          json(res, result.status, result.body);
          return;
        }
        if (segments.length === 6 && segments[5] === 'file') {
          const result = handleFileContent(store, req, url, segments);
          json(res, result.status, result.body);
          return;
        }
        if (segments.length === 6 && segments[5] === 'tree') {
          const result = handleDirectoryEntries(store, req, url, segments);
          json(res, result.status, result.body);
          return;
        }
        if (segments.length === 6 && segments[5] === 'issues') {
          const result = handleIssueList(store, req, segments);
          json(res, result.status, result.body);
          return;
        }
        if (segments.length === 7 && segments[5] === 'issues') {
          const result = handleIssueDetail(store, req, segments);
          json(res, result.status, result.body);
          return;
        }
        json(res, 404, { error: 'Not found' });
        return;
      }
      if (req.method === 'PUT' && pathname.startsWith('/api/repositories/')) {
        const segments = pathname.split('/');
        if (segments.length === 8 && segments[5] === 'issues' && segments[7] === 'labels') {
          readBody(req)
            .then((body) => {
              const result = handleUpdateIssueLabels(store, req, body, segments);
              json(res, result.status, result.body);
            })
            .catch(() => json(res, 400, { error: 'Invalid request' }));
          return;
        }
        if (segments.length === 8 && segments[5] === 'issues' && segments[7] === 'milestone') {
          readBody(req)
            .then((body) => {
              const result = handleUpdateIssueMilestone(store, req, body, segments);
              json(res, result.status, result.body);
            })
            .catch(() => json(res, 400, { error: 'Invalid request' }));
          return;
        }
        json(res, 404, { error: 'Not found' });
        return;
      }
      if (req.method === 'PATCH' && pathname.startsWith('/api/repositories/')) {
        const segments = pathname.split('/');
        if (segments.length === 7 && segments[5] === 'issues') {
          readBody(req)
            .then((body) => {
              const result = handleUpdateIssueContent(store, req, body, segments);
              json(res, result.status, result.body);
            })
            .catch(() => json(res, 400, { error: 'Invalid request' }));
          return;
        }
        json(res, 404, { error: 'Not found' });
        return;
      }
      if (req.method === 'POST' && pathname.startsWith('/api/repositories/')) {
        const segments = pathname.split('/');
        if (segments.length === 8 && segments[5] === 'issues' && segments[7] === 'status') {
          readBody(req)
            .then((body) => {
              const result = handleUpdateIssueStatus(store, req, body, segments);
              json(res, result.status, result.body);
            })
            .catch(() => json(res, 400, { error: 'Invalid request' }));
          return;
        }
        json(res, 404, { error: 'Not found' });
        return;
      }
      if (req.method === 'POST' && pathname === '/api/register') {
        readBody(req)
          .then((body) => {
            const result = handleRegister(store, body);
            json(res, result.status, result.body);
          })
          .catch(() => json(res, 400, { error: 'Invalid request' }));
        return;
      }
      if (req.method === 'POST' && pathname === '/api/signin') {
        readBody(req)
          .then((body) => {
            const result = handleSignIn(store, body);
            if (result.setCookie) res.setHeader('Set-Cookie', result.setCookie);
            if (result.clearCookie) res.setHeader('Set-Cookie', clearSessionCookie());
            json(res, result.status, result.body);
          })
          .catch(() => json(res, 400, { error: 'Invalid request' }));
        return;
      }
      if (req.method === 'POST' && pathname === '/api/signout') {
        const result = handleSignOut(store, req);
        res.setHeader('Set-Cookie', clearSessionCookie());
        json(res, result.status, result.body);
        return;
      }
      if (req.method === 'GET' && pathname === '/api/me') {
        const result = handleMe(store, req);
        json(res, result.status, result.body);
        return;
      }
      if (req.method === 'POST' && pathname === '/api/change-password') {
        readBody(req)
          .then((body) => {
            const result = handleChangePassword(store, req, body);
            json(res, result.status, result.body);
          })
          .catch(() => json(res, 400, { error: 'Invalid request' }));
        return;
      }
      if (req.method === 'POST' && pathname === '/api/forgot-password') {
        readBody(req)
          .then(() => {
            const result = handleForgotPassword();
            json(res, result.status, result.body);
          })
          .catch(() => json(res, 400, { error: 'Invalid request' }));
        return;
      }
      if (req.method === 'POST' && pathname === '/api/reset-password') {
        readBody(req)
          .then((body) => {
            const result = handleResetPassword(store, body);
            json(res, result.status, result.body);
          })
          .catch(() => json(res, 400, { error: 'Invalid request' }));
        return;
      }
      json(res, 404, { error: 'Not found' });
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res, pathname);
      return;
    }

    json(res, 404, { error: 'Not found' });
  };
}

function listenOn(handler, port) {
  const server = createServer(handler);
  server.listen(port, '0.0.0.0', () => {
    console.log(`listening on ${port}`);
  });
  server.on('error', (err) => {
    console.error(`failed to listen on ${port}:`, err.message);
    process.exit(1);
  });
  return server;
}

function main() {
  const port = Number(process.env.PORT || 3000);
  const handler = createHandler();
  listenOn(handler, port);
  if (process.env.ARC_EXTRA_PORTS !== '0') {
    // Official acceptance probes target the fixed extra port 3301.
    listenOn(handler, 3301);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
