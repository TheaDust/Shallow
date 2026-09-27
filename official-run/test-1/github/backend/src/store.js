import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_ROOT = dirname(fileURLToPath(import.meta.url)) + '/..';

export function defaultDataDir() {
  return join(BACKEND_ROOT, 'data');
}

export function resolveDataDir() {
  return process.env.SHALLOW_DATA_DIR || defaultDataDir();
}

const SEED_ACCOUNTS = [
  {
    username: 'alice-dev',
    email: 'alice.dev@example.test',
    password: 'Valid-password-123!',
  },
  {
    username: 'bob-reviewer',
    email: 'bob.reviewer@example.test',
    password: 'Valid-password-123!',
  },
  {
    username: 'cara-writer',
    email: 'cara.writer@example.test',
    password: 'Valid-password-123!',
  },
];

// Seed content helpers -------------------------------------------------------

function makeIssue(repoKey, number, fields) {
  return {
    id: `issue_${repoKey}_${number}`,
    number,
    status: 'open',
    description: '',
    labels: [],
    assignees: [],
    milestone: null,
    comments: [],
    activity: [],
    ...fields,
  };
}

function seedAcmeDocsIssues() {
  const created = [
    makeIssue('acme', 1, {
      title: 'Improve onboarding',
      status: 'open',
      author: 'alice-dev',
      description: 'Describe the onboarding improvement.',
      labels: ['bug'],
      assignees: ['alice-dev'],
      milestone: 'Q3 launch',
      createdAt: '2026-02-01T09:00:00.000Z',
      updatedAt: '2026-02-02T10:00:00.000Z',
      comments: [
        {
          id: 'comment_acme_1_1',
          author: 'cara-writer',
          body: 'I can help draft the new onboarding guide.',
          createdAt: '2026-02-02T10:00:00.000Z',
        },
      ],
      activity: [
        {
          id: 'act_acme_1_1',
          type: 'created',
          author: 'alice-dev',
          createdAt: '2026-02-01T09:00:00.000Z',
        },
        {
          id: 'act_acme_1_2',
          type: 'comment',
          author: 'cara-writer',
          commentId: 'comment_acme_1_1',
          createdAt: '2026-02-02T10:00:00.000Z',
        },
      ],
    }),
    makeIssue('acme', 2, {
      title: 'Legacy welcome text',
      status: 'closed',
      author: 'alice-dev',
      // Contains the open issue's unique keyword so Closed + keyword + label
      // filters still match this row (keyword matches title or body).
      description: 'The legacy welcome text is outdated and should be replaced with an onboarding-focused welcome.',
      labels: ['bug'],
      createdAt: '2026-02-03T08:00:00.000Z',
      updatedAt: '2026-02-04T09:30:00.000Z',
      activity: [
        {
          id: 'act_acme_2_1',
          type: 'created',
          author: 'alice-dev',
          createdAt: '2026-02-03T08:00:00.000Z',
        },
        {
          id: 'act_acme_2_2',
          type: 'status_changed',
          author: 'alice-dev',
          createdAt: '2026-02-04T09:30:00.000Z',
        },
      ],
    }),
    // Isolated label-mutation target: an existing label (bug/documentation) is
    // not yet applied, so the REQ-5-3-2 scenario can apply and remove it.
    makeIssue('acme', 3, {
      title: 'Update contribution guidelines',
      status: 'open',
      author: 'alice-dev',
      description: 'The contribution guidelines need a refresh.',
      createdAt: '2026-02-05T11:00:00.000Z',
      updatedAt: '2026-02-05T11:00:00.000Z',
      activity: [
        {
          id: 'act_acme_3_1',
          type: 'created',
          author: 'alice-dev',
          createdAt: '2026-02-05T11:00:00.000Z',
        },
      ],
    }),
    // Invalid-edit target: replacing its title with whitespace must show
    // "Title is required" and keep the original title (REQ-5-2-2).
    makeIssue('acme', 4, {
      title: 'Original issue title',
      status: 'open',
      author: 'alice-dev',
      description: 'An issue used to verify that invalid title edits are rejected.',
      createdAt: '2026-02-06T08:00:00.000Z',
      updatedAt: '2026-02-06T08:00:00.000Z',
      activity: [
        {
          id: 'act_acme_4_1',
          type: 'created',
          author: 'alice-dev',
          createdAt: '2026-02-06T08:00:00.000Z',
        },
      ],
    }),
  ];
  return created;
}

const SEED_REPOSITORIES = [
  {
    owner: 'alice-dev',
    name: 'acme-docs',
    visibility: 'public',
    description: 'Acme documentation and guides',
    defaultBranch: 'main',
    createdAt: '2026-01-10T09:00:00.000Z',
    updatedAt: '2026-01-15T10:30:00.000Z',
    files: [
      { path: 'README.md', content: '# Acme Docs\n\nWelcome to the Acme documentation repository.\n' },
      { path: 'docs/guide.md', content: '# Guide\n\nHow to use the Acme platform.\n' },
    ],
    labels: [
      { name: 'bug', color: 'd73a4a' },
      { name: 'documentation', color: '0075ca' },
    ],
    milestones: [
      { name: 'Q3 launch' },
      { name: 'v1.0' },
    ],
    collaborators: [
      { username: 'bob-reviewer', role: 'read' },
      { username: 'cara-writer', role: 'write' },
    ],
    issues: seedAcmeDocsIssues(),
  },
  {
    owner: 'alice-dev',
    name: 'secret-research',
    visibility: 'private',
    description: 'Private research notes',
    defaultBranch: 'main',
    createdAt: '2026-01-12T08:00:00.000Z',
    updatedAt: '2026-01-14T12:00:00.000Z',
    files: [{ path: 'notes.md', content: '# Research Notes\n\nConfidential research material.\n' }],
    // The external label shares a name with acme-docs' bug label so the label
    // selector must never leak or associate labels across repositories.
    labels: [{ name: 'bug', color: 'd73a4a' }],
    milestones: [{ name: 'Q4 planning' }],
    collaborators: [],
    issues: [
      makeIssue('secret', 1, {
        title: 'Private planning',
        status: 'open',
        author: 'alice-dev',
        description: 'Confidential internal planning notes.',
        labels: ['bug'],
        createdAt: '2026-02-06T08:00:00.000Z',
        updatedAt: '2026-02-06T08:00:00.000Z',
        activity: [
          {
            id: 'act_secret_1_1',
            type: 'created',
            author: 'alice-dev',
            createdAt: '2026-02-06T08:00:00.000Z',
          },
        ],
      }),
    ],
  },
];

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash: derived };
}

export function verifyPassword(password, salt, hash) {
  if (typeof password !== 'string') return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function createEmptyStore() {
  return {
    accounts: [],
    sessions: [],
    repositories: [],
    nextAccountId: 1,
    nextRepositoryId: 1,
  };
}

function seedRepositories(store) {
  for (const seed of SEED_REPOSITORIES) {
    store.repositories.push({
      id: `repo_${store.nextRepositoryId++}`,
      owner: seed.owner,
      name: seed.name,
      visibility: seed.visibility,
      description: seed.description,
      defaultBranch: seed.defaultBranch,
      createdAt: seed.createdAt,
      updatedAt: seed.updatedAt,
      files: seed.files.map((f) => ({ path: f.path, content: f.content })),
      labels: (seed.labels || []).map((l) => ({ name: l.name, color: l.color })),
      milestones: (seed.milestones || []).map((m) => ({ name: m.name })),
      collaborators: (seed.collaborators || []).map((c) => ({
        username: c.username,
        role: c.role,
      })),
      issues: (seed.issues || []).map((issue) => ({
        ...issue,
        labels: [...(issue.labels || [])],
        assignees: [...(issue.assignees || [])],
        comments: (issue.comments || []).map((c) => ({ ...c })),
        activity: (issue.activity || []).map((a) => ({ ...a })),
      })),
    });
  }
}

// Upgrades older stores (created before issue tracking existed) by filling the
// missing seed fields on the predefined repositories without overwriting any
// user modifications to fields that already exist.
function backfillSeedContent(store) {
  for (const seed of SEED_REPOSITORIES) {
    const repo = store.repositories.find((r) => r.owner === seed.owner && r.name === seed.name);
    if (!repo) continue;
    if (repo.labels === undefined) {
      repo.labels = (seed.labels || []).map((l) => ({ name: l.name, color: l.color }));
    }
    if (repo.milestones === undefined) {
      repo.milestones = (seed.milestones || []).map((m) => ({ name: m.name }));
    }
    if (repo.collaborators === undefined) {
      repo.collaborators = (seed.collaborators || []).map((c) => ({
        username: c.username,
        role: c.role,
      }));
    }
    if (repo.issues === undefined) {
      repo.issues = (seed.issues || []).map((issue) => ({
        ...issue,
        labels: [...(issue.labels || [])],
        assignees: [...(issue.assignees || [])],
        comments: (issue.comments || []).map((c) => ({ ...c })),
        activity: (issue.activity || []).map((a) => ({ ...a })),
      }));
    }
  }
}

// Appends seed entities added by later work packages (new milestones and new
// issues) to older persisted stores. Only missing entities are added; existing
// user modifications are never overwritten.
function backfillSeedEntities(store) {
  for (const seed of SEED_REPOSITORIES) {
    const repo = store.repositories.find((r) => r.owner === seed.owner && r.name === seed.name);
    if (!repo) continue;
    for (const milestone of seed.milestones || []) {
      if (!(repo.milestones || []).some((m) => m.name === milestone.name)) {
        if (!repo.milestones) repo.milestones = [];
        repo.milestones.push({ name: milestone.name });
      }
    }
    for (const seedIssue of seed.issues || []) {
      if ((repo.issues || []).some((i) => i.number === seedIssue.number)) continue;
      if (!repo.issues) repo.issues = [];
      repo.issues.push({
        ...seedIssue,
        labels: [...(seedIssue.labels || [])],
        assignees: [...(seedIssue.assignees || [])],
        comments: (seedIssue.comments || []).map((c) => ({ ...c })),
        activity: (seedIssue.activity || []).map((a) => ({ ...a })),
      });
    }
  }
}

// Loads the persisted store, seeding the predefined accounts and repositories
// when the store does not exist yet. User modifications are never overwritten;
// an older store that predates repositories is backfilled with the seed repos.
export function loadStore(dataDir) {
  const file = join(dataDir, 'store.json');
  if (existsSync(file)) {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed.accounts || !parsed.sessions) return createEmptyStore();
    if (!Array.isArray(parsed.repositories)) {
      parsed.repositories = [];
      parsed.nextRepositoryId = parsed.nextRepositoryId || 1;
    }
    if (parsed.repositories.length === 0) {
      seedRepositories(parsed);
      saveStore(parsed, dataDir);
    } else {
      backfillSeedContent(parsed);
      backfillSeedEntities(parsed);
      const dirty =
        parsed.repositories.some(
          (r) => r.labels === undefined || r.milestones === undefined || r.issues === undefined
        ) ||
        parsed.repositories.some((r) =>
          (SEED_REPOSITORIES.find((s) => s.owner === r.owner && s.name === r.name)?.milestones || []).some(
            (m) => !(r.milestones || []).some((x) => x.name === m.name)
          )
        ) ||
        parsed.repositories.some((r) =>
          (SEED_REPOSITORIES.find((s) => s.owner === r.owner && s.name === r.name)?.issues || []).some(
            (si) => !(r.issues || []).some((i) => i.number === si.number)
          )
        );
      if (dirty) saveStore(parsed, dataDir);
    }
    return parsed;
  }
  const store = createEmptyStore();
  for (const seed of SEED_ACCOUNTS) {
    const { salt, hash } = hashPassword(seed.password);
    store.accounts.push({
      id: `acc_${store.nextAccountId++}`,
      username: seed.username,
      email: seed.email,
      emailVerified: true,
      status: 'active',
      passwordSalt: salt,
      passwordHash: hash,
    });
  }
  seedRepositories(store);
  saveStore(store, dataDir);
  return store;
}

export function saveStore(store, dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'store.json');
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, file);
}
