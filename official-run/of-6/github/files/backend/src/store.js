'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { hashPassword, newSalt, verifyPassword } = require('./password');
const { diffContent } = require('./diff');

const SEED_ACCOUNTS = [
  { username: 'alice-dev', email: 'alice.dev@example.test', password: 'Valid-password-123!' },
  { username: 'bob-reviewer', email: 'bob.reviewer@example.test', password: 'Valid-password-123!' },
  // REQ-2-2-3: a registered account that is NOT a member of acme-demo; the
  // Owner adds it directly on the People page (by username or verified email).
  { username: 'carol-dev', email: 'carol.dev@example.test', password: 'Valid-password-123!' },
  // REQ-5-3-1: the assignable member of acme-docs. The repository contains
  // one eligible member (an account with at least Triage permission) that is
  // not initially assigned to the seeded issue `Improve onboarding`; the
  // seeded triage grant is provisioned idempotently by
  // ensureAcmeDocsAssigneeSeed. carol-dev remains the account outside the
  // repository collaborator scope (Read-only via the public repository), so
  // non-assignable accounts never appear in the assignee search results.
  { username: 'dana-triage', email: 'dana.triage@example.test', password: 'Valid-password-123!' },
];

const ROLE_RANK = { read: 1, triage: 2, write: 3, maintain: 4, admin: 5 };

/**
 * REQ-4-2-3: file-extension to language mapping used by the language filter
 * of the repository code-search page. Unknown extensions map to "Text".
 */
const LANGUAGE_BY_EXTENSION = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.md': 'Markdown',
  '.markdown': 'Markdown',
  '.json': 'JSON',
  '.css': 'CSS',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.go': 'Go',
  '.java': 'Java',
  '.rs': 'Rust',
  '.c': 'C',
  '.h': 'C',
  '.cpp': 'C++',
  '.hpp': 'C++',
  '.sh': 'Shell',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.xml': 'XML',
  '.sql': 'SQL',
  '.txt': 'Text',
};

/**
 * REQ-4-1: expected content of the nested text file seeded on the default
 * branch of acme-docs. The "Document search flow" commit adds this file so a
 * file page can display the saved text as a complete value.
 */
const SEED_SEARCH_TS_CONTENT = [
  '// Search flow',
  '//',
  '// This file documents the search flow used by the Acme platform.',
  'export const searchFlow = true;',
  '',
].join('\n');

/**
 * REQ-4-3-1: the target branch feature-search carries a file main-only.md
 * that is absent from main, so switching branches on the Code page shows a
 * link with the exact target-only file name. The content is a readable text
 * value (like the other seeded files).
 */
const SEED_MAIN_ONLY_CONTENT =
  '# main-only\n\nThis file only exists on the feature-search branch.\n';

/**
 * REQ-4-2-2: the "Document search flow" commit modifies the seeded README
 * (adds a Search flow section on top of the REQ-3-3 content) so the commit
 * contains both a modified file and an added file (src/search.ts), and its
 * diff versus the Initial commit shows added and modified files. The original
 * REQ-3-3 substrings ("acme-docs", "Documentation for the Acme platform")
 * are preserved so earlier overview/file tests keep passing.
 */
const SEED_README_MAIN_CONTENT =
  '# acme-docs\n\nDocumentation for the Acme platform.\n\n## Search flow\n';

/**
 * REQ-4-2-3: the seeded private organization repository acme-internal carries
 * the same searchable term as the public repository, but no visitor or
 * unauthorized account may view it, so repository code search must never leak
 * its content across repositories. The content also mentions the Acme
 * platform so any plausible unique code term of the search scenario appears
 * in exactly one unauthorized repository.
 */
const SEED_INTERNAL_README_CONTENT =
  '# acme-internal\n\nInternal engineering notes and plans.\n\nSearch flow experiments for the Acme platform.\n';

/**
 * REQ-4-2-1: seed commit timestamps are placed in the past so the commit
 * history and file pages show relative timestamps containing "ago".
 */
function daysAgo(isoNow, days) {
  return new Date(
    new Date(isoNow).getTime() - days * 24 * 60 * 60 * 1000
  ).toISOString();
}

/**
 * REQ-2-1 seed organization: display name "Acme Demo", identifier
 * "acme-demo" (REQ-1 username format). Alice is the Owner, bob-reviewer is a
 * plain Member; the organization owns the public repository acme-docs and a
 * distinct private repository (acme-internal) that visitors cannot access.
 *
 * REQ-2-2 seed teams (hierarchy is used for display/management only and
 * creates no implicit membership): frontend-team already has a parent team
 * (platform-team) and a descendant (frontend-core-team) so the cyclic-hierarchy
 * scenario can select a descendant by name; design-team is an unrelated team
 * that serves as the candidate parent in the membership scenario. bob-reviewer
 * is an organization member who has not joined any team. carol-dev is a
 * registered account that is not a member of the organization (REQ-2-2-3).
 */
/**
 * REQ-5-1-1: labels and the milestone are pre-existing repository-level
 * classification records; the open issue carries the bug + documentation
 * labels and the Q3 launch milestone, the closed issue carries the same bug
 * label (the scenario filters both issues by it). The closed issue's body
 * contains the same distinctive word that the open issue's title carries, so
 * switching the state filter while keeping the keyword and label filters
 * shows exactly the matching closed issue (state and keyword filters
 * combine). The closed issue title itself is the required seed
 * `Legacy welcome text`.
 */
const SEED_ISSUE_LABELS = ['bug', 'documentation'];
const SEED_ISSUE_MILESTONE = 'Q3 launch';
/** REQ-5-1-2: the seeded open issue's saved description, verbatim. */
const SEED_OPEN_ISSUE_BODY = 'Describe the onboarding improvement.';
/** REQ-5-1-1: the previous seed body; stores seeded before REQ-5-1-2 are
 * migrated to the required verbatim description only when the body still
 * equals this legacy seed value (user edits are preserved). */
const SEED_OPEN_ISSUE_BODY_LEGACY =
  'The onboarding flow is hard to follow for new contributors.\n' +
  'Improve the setup instructions and the first-run experience.';
/** REQ-5-1-2: the seeded discussion of the open issue. The assignee and the
 * comment author are alice-dev (the author; an organization Owner acting
 * with Admin permission on acme-docs, i.e. Write or higher). */
const SEED_OPEN_ISSUE_ASSIGNEE = 'alice-dev';
const SEED_OPEN_ISSUE_COMMENT_BODY =
  'Good idea — I will prepare the improved onboarding checklist.';
const SEED_CLOSED_ISSUE_BODY =
  'The README still shows the legacy welcome text from the initial onboarding' +
  ' template.\nReplace it with the current platform description.';
/** REQ-5-2-2: the invalid-edit seed — a separate issue whose original title
 * is `Original issue title`. The title-edit validation scenario replaces its
 * title with blank input; the original title must be retained after reload. */
const SEED_INVALID_EDIT_ISSUE_TITLE = 'Original issue title';
/** REQ-5-3-3: the milestone of acme-docs that the seeded issue `Improve
 * onboarding` is not associated with — the picker offers it alongside the
 * already-seeded `Q3 launch` milestone. Idempotent gap-fill: provisioned
 * only when missing; existing milestones (including user changes) are never
 * touched. */
const SEED_EXTRA_MILESTONE = 'v1.0';
/** REQ-5-3-3: the milestone of the private repository acme-internal — the
 * “another repository contains a milestone that must not be selectable”
 * state. The acme-docs milestone picker must never offer or associate it
 * (milestones are repository-scoped records). Idempotent gap-fill. */
const SEED_INTERNAL_MILESTONE = 'v2.0';

/**
 * REQ-6-1/REQ-6-2-1: seeded pull requests of the public repository
 * acme-docs. `Improve onboarding` is the Open PR targeting the protected
 * `main` branch from `feature-search` (its Checks area shows the `test`
 * check initially pending on its current compare commit); `Fix search` is
 * the Closed PR of the list/filter scenario. Both are authored by
 * alice-dev so filtering by the author reveals them. The descriptions are
 * saved verbatim so the Conversation view can display them.
 */
const SEED_PR_IMPROVE_ONBOARDING_TITLE = 'Improve onboarding';
const SEED_PR_IMPROVE_ONBOARDING_BODY =
  'Improve the onboarding experience for new contributors.';
const SEED_PR_FIX_SEARCH_TITLE = 'Fix search';
const SEED_PR_FIX_SEARCH_BODY =
  'Fix the search flow on the feature-search branch.';

/**
 * REQ-6-3-1: the single seeded discussion comment of the Open seed pull
 * request (`Improve onboarding`). It is ordinary PR discussion data — the
 * scenario requires the Open PR's Conversation to display a discussion
 * comment; the author is the PR's own author (alice-dev) and the body is
 * stored verbatim.
 */
const SEED_PR_IMPROVE_ONBOARDING_COMMENT_BODY =
  'Looking good — the onboarding improvements are clear and easy to follow.';

/**
 * REQ-6-3-1: the seeded release branch points at one commit ahead of main
 * (`Add onboarding guide` adds onboarding-guide.md) so the seeded Open PR
 * `Improve onboarding` (main ← release) has at least one comparable commit
 * and a changed file for its Commits and Files changed views.
 */
const SEED_RELEASE_COMMIT_MESSAGE = 'Add onboarding guide';
const SEED_ONBOARDING_GUIDE_CONTENT =
  '# Onboarding guide\n\nSteps for new contributors to get started with the project.\n';

/**
 * REQ-6-3-2: the release seed also modifies src/search.ts (one line changed
 * relative to SEED_SEARCH_TS_CONTENT) so the seeded Open pull request
 * `Improve onboarding` (main ← release) has a comparison that contains the
 * known changed-file path `src/search.ts` verbatim with exactly one added
 * file (onboarding-guide.md) and one modified file (src/search.ts); the
 * unchanged README.md is not part of the diff.
 */
const SEED_RELEASE_SEARCH_TS_CONTENT = [
  '// Search flow',
  '//',
  '// This file documents the search flow used by the Acme platform.',
  'export const searchFlow = true; // updated for the onboarding release',
  '',
].join('\n');

/**
 * REQ-6-2-4: the dedicated ready-for-review seed PR of acme-docs — a Draft
 * owned by alice-dev on main ← draft-feature. It is separate from draft
 * creation (the creation scenarios use other pairs), belongs to the supplied
 * author, initially has no submitted reviews, and displays its title, source
 * branch, and target branch verbatim on its detail page. The description is
 * saved verbatim so the Conversation view can display it.
 */
const SEED_PR_DRAFT_TITLE = 'Draft onboarding update';
const SEED_PR_DRAFT_BODY =
  'Draft of the onboarding flow improvements.';
const SEED_PR_DRAFT_BRANCH = 'draft-feature';

/**
 * REQ-6-3-3: the dedicated pending-comment seed PR of acme-docs — an Open
 * PR separate from `Improve onboarding` (the single-comment scenario) for
 * the pending-review-comment scenario. Its compare branch `pending-review`
 * points at one commit ahead of main that adds a commentable file, so the
 * Files changed view of this PR always has changed lines. The seed also
 * grants the reviewer bob-reviewer Write on acme-docs (a non-author
 * Write reviewer).
 */
const SEED_PR_PENDING_TITLE = 'Pending review scenario';
const SEED_PR_PENDING_BODY =
  'Separate open pull request for the pending review comment scenario.';
const SEED_PR_PENDING_BRANCH = 'pending-review';
const SEED_PR_PENDING_COMMIT_MESSAGE = 'Add pending review notes';
const SEED_PR_PENDING_FILE = 'pending-review.md';
const SEED_PR_PENDING_CONTENT =
  '# Pending review\n\nScenario fixture with a commentable added line.\n';

const SEED_ORGANIZATION = {
  name: 'acme-demo',
  displayName: 'Acme Demo',
  publicRepositories: ['acme-docs'],
  privateRepositories: ['acme-internal'],
  // REQ-2-2-4: bob-reviewer also owns an accessible personal repository; the
  // removal scenario asserts the account and its personal repository survive
  // being removed from the organization.
  personalRepositories: [
    {
      owner: 'bob-reviewer',
      name: 'bob-notes',
      description: 'Personal notes and drafts',
      visibility: 'private',
    },
    // REQ-3-1/REQ-3-3/REQ-3-4 shared seed: a private personal repository of
    // alice-dev that visitors cannot view or find through search.
    {
      owner: 'alice-dev',
      name: 'secret-research',
      description: 'Confidential research project data',
      visibility: 'private',
    },
    // REQ-3-2-2: the fork-conflict seed. The name "acme-docs-fork" already
    // exists in alice-dev's personal namespace, so forking the public
    // acme-docs repository into that namespace under this name is rejected
    // with a name conflict and no fork is created.
    {
      owner: 'alice-dev',
      name: 'acme-docs-fork',
      description: '',
      visibility: 'private',
    },
  ],
  teams: [
    { name: 'platform-team', description: 'Platform engineering team', parentTeamName: null },
    { name: 'frontend-team', description: 'Frontend engineering team', parentTeamName: 'platform-team' },
    { name: 'frontend-core-team', description: 'Frontend core team', parentTeamName: 'frontend-team' },
    { name: 'design-team', description: 'Design and UX team', parentTeamName: null },
  ],
};

/**
 * JSON-file backed store for accounts and sessions. Persists everything under
 * SHALLOW_DATA_DIR (or a default directory next to the backend) so that
 * restart keeps user modifications. The seed account is provisioned only when
 * the data store is empty.
 */
function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const filePath = path.join(dataDir, 'data.json');

  let state = loadState();

  function emptyState() {
    return {
      accounts: [],
      sessions: [],
      organizations: [],
      organizationMembers: [],
      repositories: [],
      teams: [],
      teamMembers: [],
      repoAccess: [],
      branches: [],
      commits: [],
      commitFiles: [],
      // REQ-4-4: explicit protected-branch records (empty by default; the
      // branch-protection management feature is out of scope for this packet)
      // so a protected branch rejects web file-editor submissions with the
      // reason displayed and never changes the file, branch head, or history.
      protectedBranches: [],
      // REQ-5-1-1/REQ-5-1-2: issue tracking within a repository. Labels and
      // milestones are pre-existing repository-level records; issues reference
      // their author, state, milestone, and label rows. REQ-5-1-2 adds the
      // issue's discussion records: assignees, comments, and an append-only
      // activity timeline (creation, comments, and later edits/assignment/
      // labels/milestone/status events in chronological order).
      labels: [],
      milestones: [],
      issues: [],
      issueLabels: [],
      issueAssignees: [],
      issueComments: [],
      issueActivity: [],
      // REQ-5-2-3: reactions attached to an issue or to one of its comments.
      // Each record is the "subject-target-reaction type" association: the
      // reacting account (subject), the target (an issue or a comment), and
      // the reaction type; for the same user, target, and reaction only one
      // association is stored (selecting it a second time removes it).
      issueReactions: [],
      // REQ-6-1: pull requests are persistent merge proposals bound to the
      // repository. A PR stores a repository-scoped number, title,
      // description, author, status (only Draft/Open/Closed/Merged), the
      // base/compare branch names, the creation-time base and compare
      // commits, and the timestamps. The append-only activity timeline and
      // the review decisions (bound to the compare commit they were made
      // on) support the merge-eligibility rule. Check runs attach to the
      // current compare commit of the PR.
      pullRequests: [],
      pullRequestActivity: [],
      // REQ-6-3-1: the ordinary (non-inline) discussion comments of pull
      // requests — each stores the target PR, author, body, and time; the
      // Conversation view reads them as part of the timeline.
      pullRequestComments: [],
      // REQ-6-3-3: inline review comments anchored to a file path, the
      // compare commit they were created on, and a diff line position. Each
      // record also stores the author, body, and publication state (a
      // pending comment is a Start-a-review draft that is not public until
      // the review is submitted).
      pullRequestInlineComments: [],
      // REQ-6-4: a pending-review request relationship between a pull
      // request and a candidate reviewer account (a “reviewer request”, not
      // the same as a submitted review decision). Each record stores the
      // target PR, the reviewer account, the operator who created (or
      // re-created) the request, and the time. Removing a request only
      // deletes this relationship — reviews, comments, and activity records
      // already submitted by that user are never touched.
      pullRequestReviewers: [],
      reviews: [],
      checkRuns: [],
      // REQ-6-1: persistent branch protection rules — a merge restriction
      // bound to one exact branch name with two independently selectable
      // requirements (require approval / require status check test).
      branchProtectionRules: [],
    };
  }

  function loadState() {
    if (fs.existsSync(filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (parsed && Array.isArray(parsed.accounts) && Array.isArray(parsed.sessions)) {
          return {
            ...emptyState(),
            ...parsed,
          };
        }
      } catch (err) {
        // Corrupt store: fall through to a fresh state instead of crashing.
      }
    }
    return emptyState();
  }

  function persist() {
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
  }

  if (state.accounts.length === 0) {
    seed();
  } else if (state.organizations.length === 0) {
    // A store written by an older version may already contain accounts but
    // no organization seed; provision the REQ-2-1 records in that case too.
    seedOrganizationData();
  }
  backfillSeedGaps();

  /**
   * REQ-3-3: the seeded public repository must contain at least one file so a
   * visitor opening its overview sees the file list and can open a file page.
   * Provisions the default branch (main), an initial commit by the seed
   * author, and a README.md file in one pass; a repository that already has a
   * main branch is left untouched (idempotent gap-fill).
   */
  function ensureSeedRepositoryContent(repository, authorId, now) {
    if (!repository || !authorId) {
      return false;
    }
    const existingBranch = state.branches.find(
      (b) => b.repositoryId === repository.id && b.name === 'main'
    );
    if (existingBranch) {
      return false;
    }
    const commit = {
      id: crypto.randomUUID(),
      repositoryId: repository.id,
      message: 'Initial commit',
      authorId,
      parentCommitIds: [],
      createdAt: now,
    };
    const branch = {
      id: crypto.randomUUID(),
      repositoryId: repository.id,
      name: 'main',
      headCommitId: commit.id,
      createdAt: now,
    };
    const file = {
      id: crypto.randomUUID(),
      commitId: commit.id,
      path: 'README.md',
      content: `# ${repository.name}\n\n${repository.description || ''}\n`,
    };
    state.branches.push(branch);
    state.commits.push(commit);
    state.commitFiles.push(file);
    return true;
  }

  function seed() {
    const accountIds = {};
    for (const seedAccount of SEED_ACCOUNTS) {
      const salt = newSalt();
      const account = {
        id: crypto.randomUUID(),
        username: seedAccount.username,
        email: seedAccount.email,
        emailVerified: true,
        available: true,
        passwordSalt: salt,
        passwordHash: hashPassword(seedAccount.password, salt),
        createdAt: new Date().toISOString(),
      };
      state.accounts.push(account);
      accountIds[account.username] = account.id;
    }
    seedOrganizationData(accountIds);
  }

  function seedOrganizationData(accountIdsArg) {
    const accountIds = accountIdsArg || {};
    for (const seedAccount of SEED_ACCOUNTS) {
      if (!accountIds[seedAccount.username]) {
        const existing = state.accounts.find((a) => a.username === seedAccount.username);
        if (existing) {
          accountIds[seedAccount.username] = existing.id;
        } else {
          const salt = newSalt();
          const account = {
            id: crypto.randomUUID(),
            username: seedAccount.username,
            email: seedAccount.email,
            emailVerified: true,
            available: true,
            passwordSalt: salt,
            passwordHash: hashPassword(seedAccount.password, salt),
            createdAt: new Date().toISOString(),
          };
          state.accounts.push(account);
          accountIds[seedAccount.username] = account.id;
        }
      }
    }
    const now = new Date().toISOString();
    const organization = {
      id: crypto.randomUUID(),
      name: SEED_ORGANIZATION.name,
      displayName: SEED_ORGANIZATION.displayName,
      createdAt: now,
    };
    state.organizations.push(organization);
    state.organizationMembers.push(
      {
        organizationId: organization.id,
        accountId: accountIds['alice-dev'],
        role: 'owner',
        createdAt: now,
      },
      {
        organizationId: organization.id,
        accountId: accountIds['bob-reviewer'],
        role: 'member',
        createdAt: now,
      }
    );
    let acmeDocsRepository = null;
    let secretResearchRepository = null;
    for (const repoName of SEED_ORGANIZATION.publicRepositories) {
      const repository = {
        id: crypto.randomUUID(),
        ownerType: 'organization',
        ownerId: organization.id,
        name: repoName,
        description: 'Documentation for the Acme platform',
        visibility: 'public',
        defaultBranch: 'main',
        creatorId: accountIds['alice-dev'],
        createdAt: now,
        updatedAt: now,
      };
      state.repositories.push(repository);
      if (repoName === 'acme-docs') {
        acmeDocsRepository = repository;
      }
    }
    let acmeInternalRepository = null;
    for (const repoName of SEED_ORGANIZATION.privateRepositories) {
      const repository = {
        id: crypto.randomUUID(),
        ownerType: 'organization',
        ownerId: organization.id,
        name: repoName,
        description: 'Internal engineering notes and plans',
        visibility: 'private',
        defaultBranch: 'main',
        creatorId: accountIds['alice-dev'],
        createdAt: now,
        updatedAt: now,
      };
      state.repositories.push(repository);
      if (repoName === 'acme-internal') {
        acmeInternalRepository = repository;
      }
    }
    for (const personal of SEED_ORGANIZATION.personalRepositories) {
      const ownerId = accountIds[personal.owner];
      if (!ownerId) {
        continue;
      }
      const repository = {
        id: crypto.randomUUID(),
        ownerType: 'user',
        ownerId,
        name: personal.name,
        description: personal.description,
        visibility: personal.visibility,
        defaultBranch: 'main',
        creatorId: ownerId,
        createdAt: now,
        updatedAt: now,
      };
      state.repositories.push(repository);
      if (personal.name === 'secret-research') {
        secretResearchRepository = repository;
      }
    }
    // REQ-3-3: the seeded public repository acme-docs carries a default branch
    // and at least one file (README.md) so the overview shows the file list.
    if (acmeDocsRepository) {
      ensureSeedRepositoryContent(acmeDocsRepository, accountIds['alice-dev'], now);
    }
    // REQ-3-4: the seeded private repository secret-research contains
    // public-ready content (a README file plus its description) so an Admin
    // can change its visibility to Public and the visitor immediately sees
    // the same content afterwards.
    if (secretResearchRepository) {
      ensureSeedRepositoryContent(secretResearchRepository, accountIds['alice-dev'], now);
    }
    // REQ-4-2-3: the private repository acme-internal contains the searchable
    // term but remains unauthorized for visitors; its content is only read by
    // authorized accounts (or by code search within the repository itself).
    if (acmeInternalRepository) {
      ensureAcmeInternalSearchSeed(acmeInternalRepository, accountIds['alice-dev'], now);
    }
    const seededTeams = [];
    for (const seedTeam of SEED_ORGANIZATION.teams) {
      const parent = seedTeam.parentTeamName
        ? seededTeams.find((t) => t.name === seedTeam.parentTeamName)
        : null;
      const team = {
        id: crypto.randomUUID(),
        organizationId: organization.id,
        name: seedTeam.name,
        description: seedTeam.description,
        parentTeamId: parent ? parent.id : null,
        creatorId: accountIds['alice-dev'],
        createdAt: now,
      };
      state.teams.push(team);
      seededTeams.push(team);
    }
    persist();
  }

  /**
   * REQ-4-2-3: the seeded private repository acme-internal carries a default
   * branch whose README contains the searchable term. Idempotent gap-fill: a
   * repository that already has a main branch is left untouched (user
   * modifications preserved).
   */
  function ensureAcmeInternalSearchSeed(repository, authorId, now) {
    if (!repository || !authorId) {
      return false;
    }
    const existingBranch = state.branches.find(
      (b) => b.repositoryId === repository.id && b.name === 'main'
    );
    if (existingBranch) {
      return false;
    }
    const commit = {
      id: crypto.randomUUID(),
      repositoryId: repository.id,
      message: 'Initial commit',
      authorId,
      parentCommitIds: [],
      createdAt: now,
    };
    const branch = {
      id: crypto.randomUUID(),
      repositoryId: repository.id,
      name: 'main',
      headCommitId: commit.id,
      createdAt: now,
    };
    const file = {
      id: crypto.randomUUID(),
      commitId: commit.id,
      path: 'README.md',
      content: SEED_INTERNAL_README_CONTENT,
    };
    state.branches.push(branch);
    state.commits.push(commit);
    state.commitFiles.push(file);
    return true;
  }

  /**
   * REQ-4-1: the seeded public repository acme-docs must let visitors browse
   * a nested directory (src/) and a text file inside it (src/search.ts) on
   * the default branch, and must offer a second branch (feature-search) that
   * does not contain that file. Idempotent gap-fill: when the main branch
   * still points at the seed "Initial commit", a "Document search flow"
   * commit (author alice-dev) is appended with the full snapshot plus
   * src/search.ts; a missing feature-search branch is created pointing at the
   * initial commit. User-created commits and an existing feature-search
   * branch are never modified.
   */
  function ensureAcmeDocsCodeSeed(repository, authorId, now) {
    if (!repository || !authorId) {
      return false;
    }
    const main = state.branches.find(
      (b) => b.repositoryId === repository.id && b.name === 'main'
    );
    if (!main) {
      return ensureSeedRepositoryContent(repository, authorId, now);
    }
    let changed = false;
    const head = main.headCommitId
      ? state.commits.find((c) => c.id === main.headCommitId)
      : null;
    const hasSearchFlowCommit = state.commits.some(
      (c) => c.repositoryId === repository.id && c.message === 'Document search flow'
    );
    if (head && head.message === 'Initial commit' && !hasSearchFlowCommit) {
      // REQ-4-2-1: the seed history uses staggered past timestamps (the seed
      // initial commit is re-timed here once; it is the seed's own record and
      // user-created commits are never touched) so every seed commit shows a
      // relative timestamp containing "ago".
      head.createdAt = daysAgo(now, 5);
      const headFiles = state.commitFiles.filter((f) => f.commitId === head.id);
      const commit = {
        id: crypto.randomUUID(),
        repositoryId: repository.id,
        message: 'Document search flow',
        authorId,
        parentCommitIds: [head.id],
        createdAt: daysAgo(now, 2),
      };
      state.commits.push(commit);
      for (const file of headFiles) {
        // REQ-4-2-2: the README is modified by this commit (its content stays
        // part of the snapshot but differs from the Initial commit's README).
        state.commitFiles.push({
          id: crypto.randomUUID(),
          commitId: commit.id,
          path: file.path,
          content:
            file.path === 'README.md' ? SEED_README_MAIN_CONTENT : file.content,
        });
      }
      state.commitFiles.push({
        id: crypto.randomUUID(),
        commitId: commit.id,
        path: 'src/search.ts',
        content: SEED_SEARCH_TS_CONTENT,
      });
      main.headCommitId = commit.id;
      changed = true;
    }
    const featureBranch = state.branches.find(
      (b) => b.repositoryId === repository.id && b.name === 'feature-search'
    );
    if (!featureBranch) {
      const initialCommit = state.commits.find(
        (c) => c.repositoryId === repository.id && c.message === 'Initial commit'
      );
      if (initialCommit) {
        state.branches.push({
          id: crypto.randomUUID(),
          repositoryId: repository.id,
          name: 'feature-search',
          headCommitId: initialCommit.id,
          createdAt: now,
        });
        changed = true;
      }
    }
    // REQ-4-3-1: the target branch feature-search contains main-only.md which
    // is absent from main. When the branch still points at the seed "Initial
    // commit" (the unextended seed state), a new commit adds main-only.md on
    // top of the shared initial commit so main's snapshot and history are
    // never altered; the commit is only provisioned once (a later head is
    // left untouched, preserving user commits on the branch).
    const feature = state.branches.find(
      (b) => b.repositoryId === repository.id && b.name === 'feature-search'
    );
    if (feature && feature.headCommitId) {
      const featureHead = state.commits.find((c) => c.id === feature.headCommitId);
      const hasMainOnlyCommit = state.commits.some(
        (c) =>
          c.repositoryId === repository.id && c.message === 'Add main-only.md'
      );
      if (featureHead && featureHead.message === 'Initial commit' && !hasMainOnlyCommit) {
        const headFiles = state.commitFiles.filter(
          (f) => f.commitId === featureHead.id
        );
        const commit = {
          id: crypto.randomUUID(),
          repositoryId: repository.id,
          message: 'Add main-only.md',
          authorId,
          parentCommitIds: [featureHead.id],
          createdAt: daysAgo(now, 1),
        };
        state.commits.push(commit);
        for (const file of headFiles) {
          state.commitFiles.push({
            id: crypto.randomUUID(),
            commitId: commit.id,
            path: file.path,
            content: file.content,
          });
        }
        state.commitFiles.push({
          id: crypto.randomUUID(),
          commitId: commit.id,
          path: 'main-only.md',
          content: SEED_MAIN_ONLY_CONTENT,
        });
        feature.headCommitId = commit.id;
        changed = true;
      }
    }
    return changed;
  }

  /**
   * REQ-4-3-3: the seeded repository acme-docs must already have a release
   * branch (scenario 1 changes the default branch from main to release). A
   * branch is a named reference to a commit, so the seed points release at a
   * seed commit on top of the main head; the default-branch change never
   * rewrites either branch's history.
   *
   * REQ-6-3-1: the release commit (`Add onboarding guide`, adding
   * onboarding-guide.md) keeps release exactly one commit ahead of main, so
   * the seeded Open pull request `Improve onboarding` (main ← release) has
   * at least one comparable commit and a changed file for its Commits and
   * Files changed views. REQ-6-3-2: the same seed commit also modifies
   * src/search.ts (SEED_RELEASE_SEARCH_TS_CONTENT) so the Open PR's
   * comparison contains the known changed-file path `src/search.ts` with
   * exactly one added file and one modified file. Idempotent: a release
   * branch that already exists (including one created by a user) is left
   * untouched.
   */
  function ensureReleaseBranchSeed(repository, now) {
    if (!repository) {
      return false;
    }
    const main = state.branches.find(
      (b) => b.repositoryId === repository.id && b.name === 'main'
    );
    if (!main || !main.headCommitId) {
      return false;
    }
    const existing = state.branches.find(
      (b) => b.repositoryId === repository.id && b.name === 'release'
    );
    if (existing) {
      return false;
    }
    const alice = state.accounts.find((a) => a.username === 'alice-dev');
    const headFiles = state.commitFiles.filter(
      (f) => f.commitId === main.headCommitId
    );
    const commit = {
      id: crypto.randomUUID(),
      repositoryId: repository.id,
      message: SEED_RELEASE_COMMIT_MESSAGE,
      authorId: alice ? alice.id : null,
      parentCommitIds: [main.headCommitId],
      createdAt: daysAgo(now, 1),
    };
    state.commits.push(commit);
    for (const file of headFiles) {
      state.commitFiles.push({
        id: crypto.randomUUID(),
        commitId: commit.id,
        path: file.path,
        // REQ-6-3-2: the seeded release snapshot modifies src/search.ts so
        // the Open PR's Files changed diff shows it as a changed file.
        content:
          file.path === 'src/search.ts'
            ? SEED_RELEASE_SEARCH_TS_CONTENT
            : file.content,
      });
    }
    state.commitFiles.push({
      id: crypto.randomUUID(),
      commitId: commit.id,
      path: 'onboarding-guide.md',
      content: SEED_ONBOARDING_GUIDE_CONTENT,
    });
    state.branches.push({
      id: crypto.randomUUID(),
      repositoryId: repository.id,
      name: 'release',
      headCommitId: commit.id,
      createdAt: now,
    });
    return true;
  }

  /**
   * REQ-5-1-2: provisions the discussion records of the seeded open issue
   * (one assignee, one comment, and the append-only activity timeline with
   * the creation and comment events in chronological order). Records are
   * only added when the issue has none, so the seed is idempotent and
   * user-created assignees/comments are preserved. Returns true when any
   * record was added.
   */
  function ensureOpenIssueDiscussionSeed(issue, authorId, now) {
    if (!issue || !authorId) {
      return false;
    }
    let changed = false;
    const alice = state.accounts.find((a) => a.id === authorId);
    if (alice && !state.issueAssignees.some((a) => a.issueId === issue.id)) {
      state.issueAssignees.push({
        id: crypto.randomUUID(),
        issueId: issue.id,
        accountId: alice.id,
        createdAt: issue.createdAt,
      });
      changed = true;
    }
    let comment = null;
    const existingComments = state.issueComments.filter((c) => c.issueId === issue.id);
    if (existingComments.length === 0 && alice) {
      comment = {
        id: crypto.randomUUID(),
        issueId: issue.id,
        authorId: alice.id,
        body: SEED_OPEN_ISSUE_COMMENT_BODY,
        createdAt: issue.updatedAt,
      };
      state.issueComments.push(comment);
      changed = true;
    } else {
      comment = existingComments[0] || null;
    }
    if (!state.issueActivity.some((e) => e.issueId === issue.id)) {
      state.issueActivity.push(
        {
          id: crypto.randomUUID(),
          issueId: issue.id,
          type: 'created',
          actorId: authorId,
          createdAt: issue.createdAt,
        },
        {
          id: crypto.randomUUID(),
          issueId: issue.id,
          type: 'commented',
          actorId: authorId,
          createdAt: comment ? comment.createdAt : issue.updatedAt,
          body: comment ? comment.body : null,
          // REQ-5-2-3: the commented event carries the stored comment id so
          // the detail page can attach the comment's reactions to the entry.
          commentId: comment ? comment.id : null,
        }
      );
      changed = true;
    }
    return changed;
  }

  /**
   * REQ-5-1-2: idempotent gap-fill of the seeded open issue's verbatim
   * description and discussion records for stores that were seeded by
   * REQ-5-1-1 (or partially by an earlier version). The body is migrated
   * only when it still equals the legacy seed value; user edits and any
   * existing assignees/comments/activity are preserved.
   */
  function ensureAcmeDocsIssueDetailSeed(repository, authorId, now) {
    if (!repository || !authorId) {
      return false;
    }
    const openIssue = state.issues.find(
      (i) => i.repositoryId === repository.id && i.number === 1
    );
    if (!openIssue) {
      return false;
    }
    let changed = false;
    if (openIssue.body === SEED_OPEN_ISSUE_BODY_LEGACY) {
      openIssue.body = SEED_OPEN_ISSUE_BODY;
      changed = true;
    }
    if (ensureOpenIssueDiscussionSeed(openIssue, authorId, now)) {
      changed = true;
    }
    return changed;
  }

  /**
   * REQ-5-1-1: the seeded public repository acme-docs must already contain
   * the `bug` and `documentation` labels, the `Q3 launch` milestone, the open
   * issue `Improve onboarding` (labels bug + documentation, milestone Q3
   * launch) and the closed issue `Legacy welcome text` (label bug). Labels
   * and the milestone are provisioned when missing (they are pre-existing
   * classification records); the two seed issues are only provisioned when
   * the repository has no issues at all, so user-created issues and their
   * labels/milestones are never touched. REQ-5-1-2 adds the open issue's
   * verbatim description and discussion records (assignee, comment, activity
   * timeline); stores that already contain the REQ-5-1-1 issues are
   * gap-filled idempotently. Idempotent gap-fill, run from backfillSeedGaps
   * on every store load.
   */
  function ensureAcmeDocsIssuesSeed(repository, authorId, now) {
    if (!repository || !authorId) {
      return false;
    }
    let changed = false;
    for (const labelName of SEED_ISSUE_LABELS) {
      const existing = state.labels.find(
        (l) => l.repositoryId === repository.id && l.name === labelName
      );
      if (!existing) {
        state.labels.push({
          id: crypto.randomUUID(),
          repositoryId: repository.id,
          name: labelName,
          color: labelName === 'bug' ? '#b60205' : '#0969da',
          createdAt: now,
        });
        changed = true;
      }
    }
    let milestone = state.milestones.find(
      (m) => m.repositoryId === repository.id && m.title === SEED_ISSUE_MILESTONE
    );
    if (!milestone) {
      milestone = {
        id: crypto.randomUUID(),
        repositoryId: repository.id,
        title: SEED_ISSUE_MILESTONE,
        description: 'Goal classification item for the third-quarter launch',
        state: 'open',
        createdAt: now,
      };
      state.milestones.push(milestone);
      changed = true;
    }
    const existingIssues = state.issues.filter(
      (i) => i.repositoryId === repository.id
    );
    if (existingIssues.length > 0) {
      // REQ-5-1-2: older stores already contain the seed issues; still fill
      // in the verbatim description and the discussion records.
      return ensureAcmeDocsIssueDetailSeed(repository, authorId, now) || changed;
    }
    const bugLabel = state.labels.find(
      (l) => l.repositoryId === repository.id && l.name === 'bug'
    );
    const documentationLabel = state.labels.find(
      (l) => l.repositoryId === repository.id && l.name === 'documentation'
    );
    const openIssue = {
      id: crypto.randomUUID(),
      repositoryId: repository.id,
      number: 1,
      title: 'Improve onboarding',
      body: SEED_OPEN_ISSUE_BODY,
      state: 'open',
      authorId,
      milestoneId: milestone.id,
      createdAt: daysAgo(now, 5),
      updatedAt: daysAgo(now, 2),
      closedAt: null,
    };
    const closedIssue = {
      id: crypto.randomUUID(),
      repositoryId: repository.id,
      number: 2,
      title: 'Legacy welcome text',
      body: SEED_CLOSED_ISSUE_BODY,
      state: 'closed',
      authorId,
      milestoneId: null,
      createdAt: daysAgo(now, 7),
      updatedAt: daysAgo(now, 1),
      closedAt: daysAgo(now, 1),
    };
    state.issues.push(openIssue, closedIssue);
    if (bugLabel) {
      state.issueLabels.push(
        { issueId: openIssue.id, labelId: bugLabel.id },
        { issueId: closedIssue.id, labelId: bugLabel.id }
      );
    }
    if (documentationLabel) {
      state.issueLabels.push({ issueId: openIssue.id, labelId: documentationLabel.id });
    }
    ensureOpenIssueDiscussionSeed(openIssue, authorId, now);
    return true;
  }

  /**
   * REQ-5-2-2: the invalid-edit seed of the public repository acme-docs — a
   * separate issue whose original title is `Original issue title` (its title-edit
   * validation scenario replaces it with blank input, and the original title
   * must survive the rejected save and reload). Idempotent gap-fill: only
   * provisioned when no issue with this title exists in the repository, so
   * user-created issues and user-edited titles are never touched. The issue
   * takes the next incrementing repository-scoped number and carries a single
   * `created` activity event like every other persisted issue.
   */
  function ensureAcmeDocsInvalidEditIssueSeed(repository, authorId, now) {
    if (!repository || !authorId) {
      return false;
    }
    const existing = state.issues.find(
      (i) =>
        i.repositoryId === repository.id &&
        i.title === SEED_INVALID_EDIT_ISSUE_TITLE
    );
    if (existing) {
      return false;
    }
    const numbers = state.issues
      .filter((i) => i.repositoryId === repository.id)
      .map((i) => i.number);
    const number = numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
    const issue = {
      id: crypto.randomUUID(),
      repositoryId: repository.id,
      number,
      title: SEED_INVALID_EDIT_ISSUE_TITLE,
      body: '',
      state: 'open',
      authorId,
      milestoneId: null,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    };
    state.issues.push(issue);
    state.issueActivity.push({
      id: crypto.randomUUID(),
      issueId: issue.id,
      type: 'created',
      actorId: authorId,
      createdAt: now,
      body: null,
    });
    return true;
  }

  /**
   * REQ-5-3-1: provisions the assignable member of the seeded public
   * repository acme-docs: the registered account dana-triage holds a Triage
   * grant (granted by the organization Owner alice-dev), so the issue
   * assignee search lists her as an eligible member who is not initially
   * assigned to the seeded issue `Improve onboarding`. carol-dev (a
   * registered account outside the repository collaborator scope) has no
   * grant and stays Read-only via the public repository, so she never appears
   * in the assignee results. Idempotent gap-fill: the grant is provisioned
   * only when no direct user grant exists for the pair; existing grants
   * (including later user changes) are never overwritten.
   */
  /**
   * REQ-5-3-2: the private organization repository acme-internal carries
   * pre-existing labels whose names match acme-docs' labels (`bug`,
   * `documentation`) plus one label that exists only there (`urgent`), so the
   * label selector of acme-docs must never offer, create, or associate them
   * (labels are repository-scoped records; the scenario's “another repository
   * contains an external label with the same name” state). Idempotent
   * gap-fill: labels are provisioned only when missing; existing labels
   * (including later user changes) are never touched.
   */
  function ensureAcmeInternalExternalLabelSeed(repository) {
    if (!repository) {
      return false;
    }
    let changed = false;
    for (const labelName of ['bug', 'documentation', 'urgent']) {
      const existing = state.labels.find(
        (l) => l.repositoryId === repository.id && l.name === labelName
      );
      if (!existing) {
        state.labels.push({
          id: crypto.randomUUID(),
          repositoryId: repository.id,
          name: labelName,
          color: labelName === 'bug' ? '#b60205' : '#0969da',
          createdAt: new Date().toISOString(),
        });
        changed = true;
      }
    }
    return changed;
  }

  /**
   * REQ-5-3-3: the seeded public repository acme-docs must already contain
   * the milestone `v1.0` in addition to the REQ-5-1-1 `Q3 launch` milestone,
   * so the milestone picker offers a selectable milestone that the seeded
   * issue `Improve onboarding` is not yet associated with. Idempotent
   * gap-fill: provisioned only when missing; existing milestones (including
   * user changes) are never touched.
   */
  function ensureAcmeDocsMilestoneSeed(repository, now) {
    if (!repository) {
      return false;
    }
    const existing = state.milestones.find(
      (m) => m.repositoryId === repository.id && m.title === SEED_EXTRA_MILESTONE
    );
    if (existing) {
      return false;
    }
    state.milestones.push({
      id: crypto.randomUUID(),
      repositoryId: repository.id,
      title: SEED_EXTRA_MILESTONE,
      description: 'Goal classification item for the first release',
      state: 'open',
      createdAt: now,
    });
    return true;
  }

  /**
   * REQ-5-3-3: the private organization repository acme-internal carries a
   * milestone (`v2.0`) that exists only there, so the milestone picker of
   * acme-docs must never offer or associate it (milestones are
   * repository-scoped records; the scenario's “another repository contains a
   * milestone that must not be selectable” state). Idempotent gap-fill:
   * provisioned only when missing; existing milestones are never touched.
   */
  function ensureAcmeInternalExternalMilestoneSeed(repository) {
    if (!repository) {
      return false;
    }
    const existing = state.milestones.find(
      (m) =>
        m.repositoryId === repository.id && m.title === SEED_INTERNAL_MILESTONE
    );
    if (existing) {
      return false;
    }
    state.milestones.push({
      id: crypto.randomUUID(),
      repositoryId: repository.id,
      title: SEED_INTERNAL_MILESTONE,
      description: 'Goal classification item of the internal repository',
      state: 'open',
      createdAt: new Date().toISOString(),
    });
    return true;
  }

  function ensureAcmeDocsAssigneeSeed(repository) {
    if (!repository) {
      return false;
    }
    const dana = state.accounts.find((a) => a.username === 'dana-triage');
    const alice = state.accounts.find((a) => a.username === 'alice-dev');
    if (!dana || !alice) {
      return false;
    }
    const existing = state.repoAccess.find(
      (g) =>
        g.repositoryId === repository.id &&
        g.subjectType === 'user' &&
        g.subjectId === dana.id
    );
    if (existing) {
      return false;
    }
    state.repoAccess.push({
      id: crypto.randomUUID(),
      repositoryId: repository.id,
      subjectType: 'user',
      subjectId: dana.id,
      role: 'triage',
      grantorId: alice.id,
      createdAt: new Date().toISOString(),
    });
    return true;
  }

  /**
   * REQ-6-1/REQ-6-2-1: provisions the seeded pull requests of acme-docs
   * (`Improve onboarding` and `Fix search`). `Improve onboarding` is the
   * Open PR targeting `main` (from the seeded `release` branch); `Fix search`
   * is the Closed PR used by the list/filter scenario. Each stores its
   * repository-scoped number, title, description, author, status, the
   * creation-time base/compare commits, a `created` activity record, and a
   * pending `test` check run for its current compare commit.
   *
   * REQ-6-2-3: the creation scenario needs a main ← feature-search pair with
   * no existing Open/Draft PR so the signed-in contributor can create a new
   * PR from that comparison; the Open seed therefore targets `main` from the
   * existing `release` branch (REQ-4-3-3 seed), leaving feature-search
   * available for creation (the Closed `Fix search` PR on that pair does not
   * block creation). Idempotent gap-fill: only provisioned when the
   * repository has no pull requests at all (user-created PRs and their state
   * are never touched). Runs after the code seed so both branches exist.
   */
  function ensureAcmeDocsPullRequestsSeed(repository, authorId, now) {
    if (!repository || !authorId) {
      return false;
    }
    const existing = state.pullRequests.some(
      (p) => p.repositoryId === repository.id
    );
    if (existing) {
      return false;
    }
    const main = state.branches.find(
      (b) => b.repositoryId === repository.id && b.name === 'main'
    );
    const feature = state.branches.find(
      (b) => b.repositoryId === repository.id && b.name === 'feature-search'
    );
    const release = state.branches.find(
      (b) => b.repositoryId === repository.id && b.name === 'release'
    );
    if (
      !main ||
      !main.headCommitId ||
      !feature ||
      !feature.headCommitId ||
      !release ||
      !release.headCommitId
    ) {
      return false;
    }
    const baseCommitId = main.headCommitId;
    const seedPRs = [
      {
        number: 1,
        title: SEED_PR_IMPROVE_ONBOARDING_TITLE,
        body: SEED_PR_IMPROVE_ONBOARDING_BODY,
        status: 'open',
        // REQ-6-2-3: the Open PR must not occupy the main ← feature-search
        // pair (the creation scenario needs that pair free of Open/Draft PRs);
        // `release` is the seeded branch one commit ahead of main (its
        // head is stored as the creation-time compare commit).
        compareBranch: 'release',
        compareCommitId: release.headCommitId,
      },
      {
        number: 2,
        title: SEED_PR_FIX_SEARCH_TITLE,
        body: SEED_PR_FIX_SEARCH_BODY,
        status: 'closed',
        compareBranch: 'feature-search',
        compareCommitId: feature.headCommitId,
      },
    ];
    const createdAt = daysAgo(now, 1);
    for (const seed of seedPRs) {
      const pullRequest = {
        id: crypto.randomUUID(),
        repositoryId: repository.id,
        number: seed.number,
        title: seed.title,
        description: seed.body,
        authorId,
        status: seed.status,
        baseBranch: 'main',
        compareBranch: seed.compareBranch,
        baseCommitId,
        compareCommitId: seed.compareCommitId,
        createdAt,
        updatedAt: createdAt,
      };
      state.pullRequests.push(pullRequest);
      state.pullRequestActivity.push({
        id: crypto.randomUUID(),
        pullRequestId: pullRequest.id,
        type: 'created',
        actorId: authorId,
        createdAt,
        body: null,
      });
      state.checkRuns.push({
        id: crypto.randomUUID(),
        repositoryId: repository.id,
        pullRequestId: pullRequest.id,
        commitId: seed.compareCommitId,
        checkName: 'test',
        status: 'pending',
        setterId: null,
        updatedAt: null,
      });
    }
    return true;
  }

  /**
   * REQ-6-3-1: provisions the single seeded discussion comment of the Open
   * seed pull request `Improve onboarding` (author alice-dev, verbatim body)
   * idempotently — the comment is added only when the PR exists and has no
   * comments yet, so user-created comments (from later packets) are never
   * duplicated or replaced. Returns true when a comment was added.
   */
  function ensureAcmeDocsPullCommentSeed(repository) {
    if (!repository) {
      return false;
    }
    const alice = state.accounts.find((a) => a.username === 'alice-dev');
    const pullRequest = state.pullRequests.find(
      (p) =>
        p.repositoryId === repository.id &&
        p.title === SEED_PR_IMPROVE_ONBOARDING_TITLE
    );
    if (!pullRequest || !alice) {
      return false;
    }
    if (
      state.pullRequestComments.some(
        (c) => c.pullRequestId === pullRequest.id
      )
    ) {
      return false;
    }
    state.pullRequestComments.push({
      id: crypto.randomUUID(),
      pullRequestId: pullRequest.id,
      authorId: alice.id,
      body: SEED_PR_IMPROVE_ONBOARDING_COMMENT_BODY,
      createdAt: pullRequest.updatedAt,
    });
    return true;
  }

  /**
   * REQ-6-2-1: stores seeded before this packet provisioned both acme-docs
   * pull requests as Open; the list/filter scenario needs one Open and one
   * Closed PR created by the same author (alice-dev). Only a `Fix search`
   * PR that still matches the pristine seed state (status open, seed
   * description, main←feature-search, author alice-dev) is transitioned to
   * Closed; user-modified records and their activity are preserved.
   */
  function ensureAcmeDocsFixSearchClosedSeed(repository) {
    const alice = state.accounts.find((a) => a.username === 'alice-dev');
    if (!repository || !alice) {
      return false;
    }
    const pullRequest = state.pullRequests.find(
      (p) =>
        p.repositoryId === repository.id &&
        p.title === SEED_PR_FIX_SEARCH_TITLE
    );
    if (!pullRequest || pullRequest.status !== 'open') {
      return false;
    }
    if (
      pullRequest.authorId !== alice.id ||
      pullRequest.description !== SEED_PR_FIX_SEARCH_BODY ||
      pullRequest.baseBranch !== 'main' ||
      pullRequest.compareBranch !== 'feature-search'
    ) {
      return false;
    }
    pullRequest.status = 'closed';
    return true;
  }

  /**
   * REQ-6-2-4: provisions the dedicated ready-for-review seed PR of
   * acme-docs — the Draft `Draft onboarding update` on main ← draft-feature,
   * authored by alice-dev, with no submitted reviews. The source branch
   * `draft-feature` is a stored branch pointing at the feature-search head
   * (a commit ahead of main), so the draft PR displays a real comparison.
   * Idempotent gap-fill: the branch is created only when missing and the PR
   * only when neither a PR with this exact title nor a PR on the
   * main ← draft-feature pair exists, so user-created records and their
   * state (including the Ready for review transition) are never touched.
   */
  function ensureAcmeDocsDraftSeed(repository, authorId, now) {
    if (!repository || !authorId) {
      return false;
    }
    let changed = false;
    const draftBranch = state.branches.find(
      (b) => b.repositoryId === repository.id && b.name === SEED_PR_DRAFT_BRANCH
    );
    if (!draftBranch) {
      const feature = state.branches.find(
        (b) => b.repositoryId === repository.id && b.name === 'feature-search'
      );
      const main = state.branches.find(
        (b) => b.repositoryId === repository.id && b.name === 'main'
      );
      const head =
        (feature && feature.headCommitId) ||
        (main && main.headCommitId) ||
        null;
      if (!head) {
        return false;
      }
      state.branches.push({
        id: crypto.randomUUID(),
        repositoryId: repository.id,
        name: SEED_PR_DRAFT_BRANCH,
        headCommitId: head,
        createdAt: now,
      });
      changed = true;
    }
    const mainBranch = state.branches.find(
      (b) => b.repositoryId === repository.id && b.name === 'main'
    );
    const draft = state.branches.find(
      (b) => b.repositoryId === repository.id && b.name === SEED_PR_DRAFT_BRANCH
    );
    if (!mainBranch || !mainBranch.headCommitId || !draft || !draft.headCommitId) {
      return changed;
    }
    const pairOccupied = state.pullRequests.some(
      (p) =>
        p.repositoryId === repository.id &&
        p.baseBranch === 'main' &&
        p.compareBranch === SEED_PR_DRAFT_BRANCH
    );
    const titleUsed = state.pullRequests.some(
      (p) => p.repositoryId === repository.id && p.title === SEED_PR_DRAFT_TITLE
    );
    if (pairOccupied || titleUsed) {
      return changed;
    }
    const numbers = state.pullRequests
      .filter((p) => p.repositoryId === repository.id)
      .map((p) => p.number);
    const number = numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
    const createdAt = daysAgo(now, 1);
    const pullRequest = {
      id: crypto.randomUUID(),
      repositoryId: repository.id,
      number,
      title: SEED_PR_DRAFT_TITLE,
      description: SEED_PR_DRAFT_BODY,
      authorId,
      status: 'draft',
      baseBranch: 'main',
      compareBranch: SEED_PR_DRAFT_BRANCH,
      baseCommitId: mainBranch.headCommitId,
      compareCommitId: draft.headCommitId,
      createdAt,
      updatedAt: createdAt,
    };
    state.pullRequests.push(pullRequest);
    state.pullRequestActivity.push({
      id: crypto.randomUUID(),
      pullRequestId: pullRequest.id,
      type: 'created',
      actorId: authorId,
      createdAt,
      body: null,
    });
    return true;
  }

  /**
   * REQ-6-3-3: provisions the dedicated review-comment seeds of acme-docs —
   * the non-author Write reviewer (bob-reviewer receives a direct Write
   * grant from the organization Owner) and the separate Open PR `Pending
   * review scenario` (main ← pending-review, author alice-dev) whose Files
   * changed view carries commentable changed lines for the pending-comment
   * scenario. The compare branch `pending-review` points at one seed commit
   * ahead of main that adds pending-review.md. Idempotent gap-fill: an
   * existing bob grant is never overwritten, the branch is created only when
   * missing, and the PR only when neither its exact title nor its
   * main ← pending-review pair exists, so user-created records and their
   * state are never touched.
   */
  function ensureAcmeDocsReviewSeed(repository, authorId, now) {
    if (!repository || !authorId) {
      return false;
    }
    let changed = false;
    // The compare branch: one commit ahead of main adding the seed file.
    const pendingBranch = state.branches.find(
      (b) => b.repositoryId === repository.id && b.name === SEED_PR_PENDING_BRANCH
    );
    const main = state.branches.find(
      (b) => b.repositoryId === repository.id && b.name === 'main'
    );
    if (!pendingBranch) {
      if (!main || !main.headCommitId) {
        return changed;
      }
      const headFiles = state.commitFiles.filter(
        (f) => f.commitId === main.headCommitId
      );
      const commit = {
        id: crypto.randomUUID(),
        repositoryId: repository.id,
        message: SEED_PR_PENDING_COMMIT_MESSAGE,
        authorId,
        parentCommitIds: [main.headCommitId],
        createdAt: daysAgo(now, 1),
      };
      state.commits.push(commit);
      for (const file of headFiles) {
        state.commitFiles.push({
          id: crypto.randomUUID(),
          commitId: commit.id,
          path: file.path,
          content: file.content,
        });
      }
      state.commitFiles.push({
        id: crypto.randomUUID(),
        commitId: commit.id,
        path: SEED_PR_PENDING_FILE,
        content: SEED_PR_PENDING_CONTENT,
      });
      state.branches.push({
        id: crypto.randomUUID(),
        repositoryId: repository.id,
        name: SEED_PR_PENDING_BRANCH,
        headCommitId: commit.id,
        createdAt: now,
      });
      changed = true;
    }
    const pending = state.branches.find(
      (b) => b.repositoryId === repository.id && b.name === SEED_PR_PENDING_BRANCH
    );
    if (!main || !main.headCommitId || !pending || !pending.headCommitId) {
      return changed;
    }
    const pairOccupied = state.pullRequests.some(
      (p) =>
        p.repositoryId === repository.id &&
        p.baseBranch === 'main' &&
        p.compareBranch === SEED_PR_PENDING_BRANCH
    );
    const titleUsed = state.pullRequests.some(
      (p) => p.repositoryId === repository.id && p.title === SEED_PR_PENDING_TITLE
    );
    if (!pairOccupied && !titleUsed) {
      const numbers = state.pullRequests
        .filter((p) => p.repositoryId === repository.id)
        .map((p) => p.number);
      const number = numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
      const createdAt = daysAgo(now, 1);
      const pullRequest = {
        id: crypto.randomUUID(),
        repositoryId: repository.id,
        number,
        title: SEED_PR_PENDING_TITLE,
        description: SEED_PR_PENDING_BODY,
        authorId,
        status: 'open',
        baseBranch: 'main',
        compareBranch: SEED_PR_PENDING_BRANCH,
        baseCommitId: main.headCommitId,
        compareCommitId: pending.headCommitId,
        createdAt,
        updatedAt: createdAt,
      };
      state.pullRequests.push(pullRequest);
      state.pullRequestActivity.push({
        id: crypto.randomUUID(),
        pullRequestId: pullRequest.id,
        type: 'created',
        actorId: authorId,
        createdAt,
        body: null,
      });
      state.checkRuns.push({
        id: crypto.randomUUID(),
        repositoryId: repository.id,
        pullRequestId: pullRequest.id,
        commitId: pending.headCommitId,
        checkName: 'test',
        status: 'pending',
        setterId: null,
        updatedAt: null,
      });
      changed = true;
    }
    // REQ-6-3-3: seed data supplies a non-author Write reviewer —
    // bob-reviewer gets a direct Write grant on acme-docs. The grant is
    // added only while this pass is provisioning the review-comment records
    // (it is never re-added on later reloads, so a member removal or a
    // Manage-access revocation of the grant persists; an existing grant is
    // never overwritten).
    if (changed) {
      const alice = state.accounts.find((a) => a.id === authorId);
      const bob = state.accounts.find((a) => a.username === 'bob-reviewer');
      if (alice && bob) {
        const existingGrant = state.repoAccess.find(
          (g) =>
            g.repositoryId === repository.id &&
            g.subjectType === 'user' &&
            g.subjectId === bob.id
        );
        if (!existingGrant) {
          state.repoAccess.push({
            id: crypto.randomUUID(),
            repositoryId: repository.id,
            subjectType: 'user',
            subjectId: bob.id,
            role: 'write',
            grantorId: alice.id,
            createdAt: now,
          });
        }
      }
    }
    return changed;
  }

  function backfillSeedGaps() {
    const organization = state.organizations.find(
      (o) => o.name === SEED_ORGANIZATION.name
    );
    if (!organization) {
      return;
    }
    let changed = false;
    for (const personal of SEED_ORGANIZATION.personalRepositories) {
      const owner = state.accounts.find((a) => a.username === personal.owner);
      if (!owner) {
        continue;
      }
      const exists = state.repositories.some(
        (r) =>
          r.ownerType === 'user' &&
          r.ownerId === owner.id &&
          r.name === personal.name
      );
      if (exists) {
        continue;
      }
      const now = new Date().toISOString();
      state.repositories.push({
        id: crypto.randomUUID(),
        ownerType: 'user',
        ownerId: owner.id,
        name: personal.name,
        description: personal.description,
        visibility: personal.visibility,
        defaultBranch: 'main',
        creatorId: owner.id,
        createdAt: now,
        updatedAt: now,
      });
      changed = true;
    }
    // REQ-3-2-1: older stores lack creatorId on seeded repositories. The
    // creator of a personal repository is its owner; organization
    // repositories were created by the organization's seed Owner.
    const alice = state.accounts.find((a) => a.username === 'alice-dev');
    for (const repository of state.repositories) {
      if (repository.creatorId) {
        continue;
      }
      if (repository.ownerType === 'user') {
        repository.creatorId = repository.ownerId;
      } else if (alice) {
        repository.creatorId = alice.id;
      }
      changed = true;
    }
    // REQ-3-3: older stores may lack the seeded main branch / README of the
    // public repository acme-docs; provision them idempotently (no-op when a
    // main branch already exists, preserving user modifications).
    const acmeDocs = state.repositories.find(
      (r) =>
        r.ownerType === 'organization' &&
        r.ownerId === organization.id &&
        r.name === 'acme-docs'
    );
    if (
      acmeDocs &&
      ensureSeedRepositoryContent(acmeDocs, alice ? alice.id : null, new Date().toISOString())
    ) {
      changed = true;
    }
    // REQ-4-1: append the "Document search flow" commit and the
    // feature-search branch to the seeded public repository (idempotent).
    if (
      acmeDocs &&
      ensureAcmeDocsCodeSeed(acmeDocs, alice ? alice.id : null, new Date().toISOString())
    ) {
      changed = true;
    }
    // REQ-4-3-3: provision the seeded release branch of acme-docs (idempotent
    // gap-fill; runs after the code seed so release points at the same head
    // as the fully seeded main branch).
    if (
      acmeDocs &&
      ensureReleaseBranchSeed(acmeDocs, new Date().toISOString())
    ) {
      changed = true;
    }
    // REQ-3-4: older stores may lack the seeded content of the private
    // repository secret-research; provision it idempotently (no-op when a main
    // branch already exists).
    const secretResearch = state.repositories.find(
      (r) =>
        r.ownerType === 'user' &&
        alice &&
        r.ownerId === alice.id &&
        r.name === 'secret-research'
    );
    if (
      secretResearch &&
      ensureSeedRepositoryContent(secretResearch, alice ? alice.id : null, new Date().toISOString())
    ) {
      changed = true;
    }
    // REQ-4-2-3: older stores may lack the seeded content of the private
    // repository acme-internal; provision it idempotently (no-op when a main
    // branch already exists).
    const acmeInternal = state.repositories.find(
      (r) =>
        r.ownerType === 'organization' &&
        r.ownerId === organization.id &&
        r.name === 'acme-internal'
    );
    if (
      acmeInternal &&
      ensureAcmeInternalSearchSeed(acmeInternal, alice ? alice.id : null, new Date().toISOString())
    ) {
      changed = true;
    }
    // REQ-5-3-2: older stores may lack the external same-name labels of the
    // private repository acme-internal; provision them idempotently so the
    // label selector of acme-docs can be verified to never offer or
    // associate labels from another repository.
    if (acmeInternal && ensureAcmeInternalExternalLabelSeed(acmeInternal)) {
      changed = true;
    }
    // REQ-5-3-3: older stores may lack the external milestone of the private
    // repository acme-internal; provision it idempotently so the milestone
    // selector of acme-docs can be verified to never offer or associate a
    // milestone from another repository.
    if (acmeInternal && ensureAcmeInternalExternalMilestoneSeed(acmeInternal)) {
      changed = true;
    }
    // REQ-5-1-1: older stores may lack the seeded issue records of the public
    // repository acme-docs (labels, milestone, open and closed issues);
    // provision them idempotently (no-op when issues already exist).
    if (
      acmeDocs &&
      ensureAcmeDocsIssuesSeed(acmeDocs, alice ? alice.id : null, new Date().toISOString())
    ) {
      changed = true;
    }
    // REQ-5-3-3: older stores may lack the selectable `v1.0` milestone of
    // acme-docs (the milestone picker offers it alongside `Q3 launch`);
    // provision it idempotently after the issue seed so both milestones
    // exist even when issues were already seeded.
    if (acmeDocs && ensureAcmeDocsMilestoneSeed(acmeDocs, new Date().toISOString())) {
      changed = true;
    }
    // REQ-5-2-2: provision the separate invalid-edit seed issue (`Original
    // issue title`) idempotently; runs after the issue seed so it always takes
    // the next repository-scoped number.
    if (
      acmeDocs &&
      ensureAcmeDocsInvalidEditIssueSeed(acmeDocs, alice ? alice.id : null, new Date().toISOString())
    ) {
      changed = true;
    }
    // REQ-5-3-1: provision the seeded assignable member of acme-docs
    // (dana-triage with a Triage grant, granted by the organization Owner)
    // idempotently; the account exists and is not initially assigned to the
    // seeded issue `Improve onboarding`, and the grant is never overwritten.
    if (acmeDocs && ensureAcmeDocsAssigneeSeed(acmeDocs)) {
      changed = true;
    }
    // REQ-6-1/REQ-6-2-1: provision the seeded pull requests of acme-docs
    // (`Improve onboarding` Open and `Fix search` Closed, both by alice-dev)
    // idempotently; each targets main from feature-search with its `test`
    // check initially pending.
    if (
      acmeDocs &&
      ensureAcmeDocsPullRequestsSeed(
        acmeDocs,
        alice ? alice.id : null,
        new Date().toISOString()
      )
    ) {
      changed = true;
    }
    // REQ-6-2-1: stores seeded before this packet provisioned both acme-docs
    // pull requests as Open; the list/filter scenario needs one Open and one
    // Closed PR by the same author. Flip the pristine `Fix search` seed to
    // Closed (user-modified records are never touched).
    if (acmeDocs && ensureAcmeDocsFixSearchClosedSeed(acmeDocs)) {
      changed = true;
    }
    // REQ-6-3-1: provision the single seeded discussion comment of the Open
    // seed PR (`Improve onboarding`) idempotently; user-created comments are
    // never duplicated. Runs after the PR seed for fresh and older stores.
    if (acmeDocs && ensureAcmeDocsPullCommentSeed(acmeDocs)) {
      changed = true;
    }
    // REQ-6-2-4: provision the dedicated ready-for-review seed PR of
    // acme-docs (`Draft onboarding update`, Draft, main ← draft-feature,
    // author alice-dev, no submitted reviews) idempotently; runs after the
    // PR seed so it takes the next repository-scoped number.
    if (
      acmeDocs &&
      ensureAcmeDocsDraftSeed(
        acmeDocs,
        alice ? alice.id : null,
        new Date().toISOString()
      )
    ) {
      changed = true;
    }
    // REQ-6-3-3: provision the dedicated review-comment seeds of acme-docs
    // (the non-author Write reviewer bob-reviewer and the separate Open PR
    // `Pending review scenario` on main ← pending-review with commentable
    // changed lines) idempotently; runs after the PR/draft seeds so the
    // pending PR takes the next repository-scoped number.
    if (
      acmeDocs &&
      ensureAcmeDocsReviewSeed(
        acmeDocs,
        alice ? alice.id : null,
        new Date().toISOString()
      )
    ) {
      changed = true;
    }
    // REQ-5-2-3: older stores may carry `commented` activity records that
    // predate the commentId link (REQ-5-1-2 era). Link each such record to
    // the stored comment with the same issue and creation time so the detail
    // page can attach that comment's reactions; records already linked (and
    // comments created by later features, which always store the link) are
    // left untouched.
    for (const event of state.issueActivity) {
      if (event.type === 'commented' && !event.commentId) {
        const match = state.issueComments.find(
          (c) => c.issueId === event.issueId && c.createdAt === event.createdAt
        );
        if (match) {
          event.commentId = match.id;
          changed = true;
        }
      }
    }
    if (changed) {
      persist();
    }
  }

  return {
    getAccounts() {
      return state.accounts;
    },
    findAccountByUsername(username) {
      return state.accounts.find((a) => a.username === username) || null;
    },
    findAccountByEmail(email) {
      const normalized = String(email).trim().toLowerCase();
      return state.accounts.find((a) => a.email === normalized) || null;
    },
    /**
     * REQ-2-2-3: resolves the People add-member identifier, which may be a
     * username or the verified email of an existing account. Email matches
     * are case-insensitive and only count when the account's email is
     * verified.
     */
    findAccountByIdentity(identifier) {
      const raw = String(identifier).trim();
      if (raw === '') {
        return null;
      }
      return (
        state.accounts.find((a) => a.username === raw) ||
        state.accounts.find(
          (a) => a.emailVerified === true && a.email === raw.toLowerCase()
        ) ||
        null
      );
    },
    findAccountById(accountId) {
      return state.accounts.find((a) => a.id === accountId) || null;
    },
    createAccount({ username, email, password }) {
      const salt = newSalt();
      const account = {
        id: crypto.randomUUID(),
        username,
        email: String(email).trim().toLowerCase(),
        emailVerified: true,
        available: true,
        passwordSalt: salt,
        passwordHash: hashPassword(password, salt),
        createdAt: new Date().toISOString(),
      };
      state.accounts.push(account);
      persist();
      return account;
    },
    setAccountAvailable(accountId, available) {
      const account = this.findAccountById(accountId);
      if (!account) {
        return false;
      }
      account.available = available === true;
      persist();
      return true;
    },
    updatePassword(accountId, newPassword) {
      const account = this.findAccountById(accountId);
      if (!account) {
        return false;
      }
      const salt = newSalt();
      account.passwordSalt = salt;
      account.passwordHash = hashPassword(newPassword, salt);
      persist();
      return true;
    },
    verifyCredentials(account, password) {
      return verifyPassword(password, account.passwordSalt, account.passwordHash);
    },
    createSession(accountId) {
      const session = {
        id: crypto.randomUUID(),
        accountId,
        active: true,
        createdAt: new Date().toISOString(),
      };
      state.sessions.push(session);
      persist();
      return session;
    },
    getActiveSession(sessionId) {
      const session = state.sessions.find((s) => s.id === sessionId && s.active);
      if (!session) {
        return null;
      }
      const account = this.findAccountById(session.accountId);
      if (!account || account.available !== true) {
        return null;
      }
      return { session, account };
    },
    invalidateSession(sessionId) {
      const session = state.sessions.find((s) => s.id === sessionId);
      if (session) {
        session.active = false;
        persist();
      }
    },
    findOrganizationByName(name) {
      return state.organizations.find((o) => o.name === name) || null;
    },
    findOrganizationById(organizationId) {
      return state.organizations.find((o) => o.id === organizationId) || null;
    },
    getOrganizationMembers(organizationId) {
      return state.organizationMembers.filter((m) => m.organizationId === organizationId);
    },
    getOrganizationTeams(organizationId) {
      return state.teams.filter((t) => t.organizationId === organizationId);
    },
    findTeamById(teamId) {
      return state.teams.find((t) => t.id === teamId) || null;
    },
    findTeamByOrganizationAndName(organizationId, name) {
      return (
        state.teams.find(
          (t) => t.organizationId === organizationId && t.name === name
        ) || null
      );
    },
    /**
     * REQ-2-2: team membership is an independent persisted relationship;
     * team hierarchy never implicitly adds members. Direct members only.
     */
    getTeamDirectMembers(teamId) {
      return state.teamMembers
        .filter((m) => m.teamId === teamId)
        .map((m) => this.findAccountById(m.accountId))
        .filter(Boolean);
    },
    /**
     * Ancestor team names (oldest first, excluding the team itself) used to
     * render the team tree "organization name / parent team / team name".
     */
    getTeamAncestorNames(teamId) {
      const names = [];
      let current = this.findTeamById(teamId);
      const seen = new Set();
      while (current && current.parentTeamId) {
        if (seen.has(current.parentTeamId)) {
          break;
        }
        seen.add(current.parentTeamId);
        const parent = this.findTeamById(current.parentTeamId);
        if (!parent) {
          break;
        }
        names.unshift(parent.name);
        current = parent;
      }
      return names;
    },
    /**
     * True when assigning parentTeamId to teamId would create a direct or
     * indirect cycle (walking up from the prospective parent reaches the team
     * itself). A null parent never creates a cycle.
     */
    wouldCreateTeamCycle(teamId, parentTeamId) {
      if (!parentTeamId) {
        return false;
      }
      let current = this.findTeamById(parentTeamId);
      const seen = new Set();
      while (current) {
        if (current.id === teamId) {
          return true;
        }
        if (seen.has(current.id)) {
          return false;
        }
        seen.add(current.id);
        current = current.parentTeamId ? this.findTeamById(current.parentTeamId) : null;
      }
      return false;
    },
    /**
     * REQ-2-2-1: stores the team identifier, owning organization, name,
     * optional description, optional parent team, creator, and timestamp in
     * one atomic write; a failed write rolls the in-memory state back so no
     * team is generated.
     */
    createTeam({ organizationId, name, description, parentTeamId, creatorId }) {
      const now = new Date().toISOString();
      const team = {
        id: crypto.randomUUID(),
        organizationId,
        name,
        description: description || '',
        parentTeamId: parentTeamId || null,
        creatorId,
        createdAt: now,
      };
      state.teams.push(team);
      try {
        persist();
      } catch (err) {
        state.teams = state.teams.filter((t) => t.id !== team.id);
        throw err;
      }
      return team;
    },
    updateTeamParent(teamId, parentTeamId) {
      const team = this.findTeamById(teamId);
      if (!team) {
        return null;
      }
      team.parentTeamId = parentTeamId || null;
      persist();
      return team;
    },
    isOrganizationMember(organizationId, accountId) {
      return state.organizationMembers.some(
        (m) => m.organizationId === organizationId && m.accountId === accountId
      );
    },
    /**
     * REQ-2-2-3: atomically stores the "organization-account-role" membership
     * relationship in one write; a failed write rolls the in-memory state back
     * so no membership is created. Callers validate uniqueness beforehand.
     */
    addOrganizationMember(organizationId, accountId, role) {
      const membership = {
        organizationId,
        accountId,
        role,
        createdAt: new Date().toISOString(),
      };
      state.organizationMembers.push(membership);
      try {
        persist();
      } catch (err) {
        state.organizationMembers = state.organizationMembers.filter(
          (m) => m !== membership
        );
        throw err;
      }
      return membership;
    },
    isTeamMember(teamId, accountId) {
      return state.teamMembers.some(
        (m) => m.teamId === teamId && m.accountId === accountId
      );
    },
    /**
     * REQ-2-2-4: stores a repository-role grant (a direct user grant or a
     * team grant) in one atomic write. Grants are the authorization
     * primitives used by the repository permission rules; member removal
     * deletes direct user grants on the organization's repositories but never
     * deletes team grants.
     */
    addRepoAccess({ repositoryId, subjectType, subjectId, role, grantorId }) {
      const grant = {
        id: crypto.randomUUID(),
        repositoryId,
        subjectType,
        subjectId,
        role,
        grantorId,
        createdAt: new Date().toISOString(),
      };
      state.repoAccess.push(grant);
      try {
        persist();
      } catch (err) {
        state.repoAccess = state.repoAccess.filter((g) => g.id !== grant.id);
        throw err;
      }
      return grant;
    },
    /**
     * REQ-2-2-4: atomically removes an account from an organization. The
     * removal deletes the account's organization-membership relationship, all
     * of the account's team memberships in this organization, and all direct
     * (user-subject) grants on this organization's repositories in one write;
     * teams, team grants, the account itself, its personal repositories, and
     * its relationships with other organizations are untouched. The last
     * Owner cannot be removed: the operation is rejected and every
     * relationship stays unchanged. A failed write rolls all deletions back.
     */
    removeOrganizationMember(organizationId, accountId) {
      const membership = state.organizationMembers.find(
        (m) => m.organizationId === organizationId && m.accountId === accountId
      );
      if (!membership) {
        return { removed: false, reason: 'not-member' };
      }
      const ownerCount = state.organizationMembers.filter(
        (m) => m.organizationId === organizationId && m.role === 'owner'
      ).length;
      if (membership.role === 'owner' && ownerCount <= 1) {
        return { removed: false, reason: 'last-owner' };
      }
      const orgRepositoryIds = new Set(
        state.repositories
          .filter(
            (r) => r.ownerType === 'organization' && r.ownerId === organizationId
          )
          .map((r) => r.id)
      );
      const prevOrganizationMembers = state.organizationMembers;
      const prevTeamMembers = state.teamMembers;
      const prevRepoAccess = state.repoAccess;
      state.organizationMembers = state.organizationMembers.filter(
        (m) => !(m.organizationId === organizationId && m.accountId === accountId)
      );
      state.teamMembers = state.teamMembers.filter(
        (m) => !(m.organizationId === organizationId && m.accountId === accountId)
      );
      state.repoAccess = state.repoAccess.filter(
        (g) =>
          !(
            g.subjectType === 'user' &&
            g.subjectId === accountId &&
            orgRepositoryIds.has(g.repositoryId)
          )
      );
      try {
        persist();
      } catch (err) {
        state.organizationMembers = prevOrganizationMembers;
        state.teamMembers = prevTeamMembers;
        state.repoAccess = prevRepoAccess;
        throw err;
      }
      return { removed: true };
    },
    /**
     * REQ-2-2-2: records a team-membership relationship in one atomic write;
     * adding an account that is already a direct member is an idempotent no-op
     * (the member list shows the username exactly once). A failed write rolls
     * the in-memory state back so nothing is stored.
     */
    addTeamMember(teamId, organizationId, accountId) {
      const existing = state.teamMembers.find(
        (m) => m.teamId === teamId && m.accountId === accountId
      );
      if (existing) {
        return existing;
      }
      const membership = {
        teamId,
        organizationId,
        accountId,
        createdAt: new Date().toISOString(),
      };
      state.teamMembers.push(membership);
      try {
        persist();
      } catch (err) {
        state.teamMembers = state.teamMembers.filter((m) => m !== membership);
        throw err;
      }
      return membership;
    },
    removeTeamMember(teamId, accountId) {
      const before = state.teamMembers.length;
      state.teamMembers = state.teamMembers.filter(
        (m) => !(m.teamId === teamId && m.accountId === accountId)
      );
      if (state.teamMembers.length === before) {
        return false;
      }
      persist();
      return true;
    },
    getOrganizationRepositories(organizationId) {
      return state.repositories.filter(
        (r) => r.ownerType === 'organization' && r.ownerId === organizationId
      );
    },
    isOrganizationOwner(organizationId, accountId) {
      return state.organizationMembers.some(
        (m) =>
          m.organizationId === organizationId &&
          m.accountId === accountId &&
          m.role === 'owner'
      );
    },
    findRepositoryByOwnerAndName(ownerName, repoName) {
      const organization = state.organizations.find((o) => o.name === ownerName);
      if (organization) {
        return (
          state.repositories.find(
            (r) =>
              r.ownerType === 'organization' &&
              r.ownerId === organization.id &&
              r.name === repoName
          ) || null
        );
      }
      const account = state.accounts.find((a) => a.username === ownerName);
      if (account) {
        return (
          state.repositories.find(
            (r) => r.ownerType === 'user' && r.ownerId === account.id && r.name === repoName
          ) || null
        );
      }
      return null;
    },
    findRepositoryById(repositoryId) {
      return state.repositories.find((r) => r.id === repositoryId) || null;
    },
    /**
     * REQ-5-1-1: the labels of a repository (pre-existing colored
     * classification records), sorted by name so the label filter is
     * deterministic across reloads.
     */
    getRepositoryLabels(repositoryId) {
      return state.labels
        .filter((l) => l.repositoryId === repositoryId)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    findLabelByRepositoryAndName(repositoryId, name) {
      return (
        state.labels.find(
          (l) => l.repositoryId === repositoryId && l.name === name
        ) || null
      );
    },
    /**
     * REQ-5-1-1: the names of the labels attached to an issue, sorted by
     * name (used by list rows and the detail page).
     */
    getIssueLabelNames(issueId) {
      return state.issueLabels
        .filter((il) => il.issueId === issueId)
        .map((il) => {
          const label = state.labels.find((l) => l.id === il.labelId);
          return label ? label.name : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    },
    /**
     * REQ-5-1-1: all issues of a repository, ascending by their persisted
     * unique issue number (the list is deterministic across reloads).
     */
    getRepositoryIssues(repositoryId) {
      return state.issues
        .filter((i) => i.repositoryId === repositoryId)
        .sort((a, b) => a.number - b.number);
    },
    findIssueByNumber(repositoryId, number) {
      return (
        state.issues.find(
          (i) => i.repositoryId === repositoryId && i.number === Number(number)
        ) || null
      );
    },
    findMilestoneById(milestoneId) {
      return state.milestones.find((m) => m.id === milestoneId) || null;
    },
    /**
     * REQ-5-3-3: the milestones of a repository (pre-existing goal-
     * classification records), sorted by title so the picker options are
     * deterministic across reloads. Milestones are repository-scoped: only
     * the current repository's milestones are returned — a milestone stored
     * for any other repository never appears.
     */
    getRepositoryMilestones(repositoryId) {
      return state.milestones
        .filter((m) => m.repositoryId === repositoryId)
        .sort((a, b) => a.title.localeCompare(b.title));
    },
    /**
     * REQ-5-3-3: resolves a milestone by its exact title within the current
     * repository only, or null when it does not exist there. The server uses
     * this to reject titles that exist only in another repository.
     */
    findMilestoneByRepositoryAndTitle(repositoryId, title) {
      return (
        state.milestones.find(
          (m) => m.repositoryId === repositoryId && m.title === title
        ) || null
      );
    },
    /**
     * REQ-5-3-3: associates an issue with one milestone of its repository.
     * The issue-milestone association (at most one milestone per work item),
     * the operator, and the time are stored; the append-only activity
     * timeline records the `milestoned` event (the body carries the milestone
     * title) and updatedAt advances to the operation time, all in one atomic
     * write. Setting the already-associated milestone is a no-op (no new
     * activity). A failed write rolls the in-memory records back so no
     * partial association persists.
     */
    setIssueMilestone(issueId, milestoneId, actorId) {
      const issue = state.issues.find((i) => i.id === issueId);
      if (!issue) {
        return null;
      }
      if (issue.milestoneId === milestoneId) {
        return issue;
      }
      const now = new Date().toISOString();
      const actor = state.accounts.find((a) => a.id === actorId);
      const milestone = state.milestones.find((m) => m.id === milestoneId);
      const activity = {
        id: crypto.randomUUID(),
        issueId,
        type: 'milestoned',
        actorId,
        createdAt: now,
        body: milestone ? milestone.title : null,
      };
      const previousUpdatedAt = issue.updatedAt;
      const previousMilestoneId = issue.milestoneId;
      issue.milestoneId = milestoneId;
      state.issueActivity.push(activity);
      issue.updatedAt = now;
      try {
        persist();
      } catch (err) {
        issue.milestoneId = previousMilestoneId;
        state.issueActivity = state.issueActivity.filter(
          (a) => a.id !== activity.id
        );
        issue.updatedAt = previousUpdatedAt;
        throw err;
      }
      return issue;
    },
    /**
     * REQ-5-3-3: removes the issue-milestone association (the picker's
     * “None” selection). Only the association is deleted — the milestone
     * record stays in the repository — and the append-only activity timeline
     * records the `demilestoned` event (the body carries the removed
     * milestone title) with updatedAt advancing in the same atomic write.
     * Clearing an issue that has no milestone is a no-op (no new activity).
     * A failed write rolls the in-memory records back so no partial
     * unassociation persists.
     */
    clearIssueMilestone(issueId, actorId) {
      const issue = state.issues.find((i) => i.id === issueId);
      if (!issue) {
        return null;
      }
      if (!issue.milestoneId) {
        return issue;
      }
      const now = new Date().toISOString();
      const actor = state.accounts.find((a) => a.id === actorId);
      const milestone = state.milestones.find((m) => m.id === issue.milestoneId);
      const activity = {
        id: crypto.randomUUID(),
        issueId,
        type: 'demilestoned',
        actorId,
        createdAt: now,
        body: milestone ? milestone.title : null,
      };
      const previousUpdatedAt = issue.updatedAt;
      const previousMilestoneId = issue.milestoneId;
      issue.milestoneId = null;
      state.issueActivity.push(activity);
      issue.updatedAt = now;
      try {
        persist();
      } catch (err) {
        issue.milestoneId = previousMilestoneId;
        state.issueActivity = state.issueActivity.filter(
          (a) => a.id !== activity.id
        );
        issue.updatedAt = previousUpdatedAt;
        throw err;
      }
      return issue;
    },
    /**
     * REQ-5-4: changes the Open/Closed status of one persisted issue and
     * appends a `closed`/`reopened` activity record in one atomic write. The
     * system stores the new status together with the operator (the activity
     * actor) and the time (the activity createdAt and the issue's updatedAt;
     * closing also records closedAt). The status transition never touches the
     * title, description, comments, labels, assignees, or milestone. Closing
     * an already-closed issue or reopening an already-open issue is a no-op
     * (no duplicate activity). A failed write rolls the in-memory records
     * back so no partial transition persists.
     */
    setIssueState(issueId, newState, actorId) {
      const issue = state.issues.find((i) => i.id === issueId);
      if (!issue) {
        return null;
      }
      if (issue.state === newState) {
        return issue;
      }
      const now = new Date().toISOString();
      const activity = {
        id: crypto.randomUUID(),
        issueId,
        type: newState === 'closed' ? 'closed' : 'reopened',
        actorId,
        createdAt: now,
        body: null,
      };
      const previous = {
        state: issue.state,
        updatedAt: issue.updatedAt,
        closedAt: issue.closedAt,
      };
      issue.state = newState;
      issue.updatedAt = now;
      issue.closedAt = newState === 'closed' ? now : null;
      state.issueActivity.push(activity);
      try {
        persist();
      } catch (err) {
        issue.state = previous.state;
        issue.updatedAt = previous.updatedAt;
        issue.closedAt = previous.closedAt;
        state.issueActivity = state.issueActivity.filter(
          (a) => a.id !== activity.id
        );
        throw err;
      }
      return issue;
    },
    /**
     * REQ-5-2-1: creates a new open issue in a repository and appends its
     * creation activity in one atomic write. The new issue carries the next
     * incrementing number that is unique within the repository, the trimmed
     * title/description, the author, creation and update times, and the Open
     * status; the append-only activity timeline gains a single `created`
     * event by the same author at the same time. A failed write rolls the
     * in-memory records back (no number is allocated) and re-throws, so no
     * partial data ever persists.
     */
    createIssue(repositoryId, { title, body }, authorId) {
      const now = new Date().toISOString();
      const numbers = state.issues
        .filter((i) => i.repositoryId === repositoryId)
        .map((i) => i.number);
      const number = numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
      const issue = {
        id: crypto.randomUUID(),
        repositoryId,
        number,
        title: String(title).trim(),
        body: String(body == null ? '' : body).trim(),
        state: 'open',
        authorId,
        milestoneId: null,
        createdAt: now,
        updatedAt: now,
        closedAt: null,
      };
      const activity = {
        id: crypto.randomUUID(),
        issueId: issue.id,
        type: 'created',
        actorId: authorId,
        createdAt: now,
        body: null,
      };
      state.issues.push(issue);
      state.issueActivity.push(activity);
      try {
        persist();
      } catch (err) {
        state.issues = state.issues.filter((i) => i.id !== issue.id);
        state.issueActivity = state.issueActivity.filter(
          (a) => a.id !== activity.id
        );
        throw err;
      }
      return issue;
    },
    /**
     * REQ-5-2-2: updates the title and/or description of one persisted issue
     * and appends an `edited` activity record in one atomic write. Only the
     * provided fields change — saving the title and saving the description are
     * separate actions — and the update stores the editor, the edit time, and
     * the new value (the issue record keeps the new value; the timeline event
     * keeps the editor, the edit time, and the new value of the edited field).
     * updatedAt advances to the edit time. A failed write rolls the in-memory
     * records back so the original value of the corresponding field is
     * retained and no partial edit persists.
     */
    updateIssue(repositoryId, issueId, { title, body }, editorId) {
      const issue = state.issues.find(
        (i) => i.repositoryId === repositoryId && i.id === issueId
      );
      if (!issue) {
        return null;
      }
      const now = new Date().toISOString();
      const previous = {
        title: issue.title,
        body: issue.body,
        updatedAt: issue.updatedAt,
      };
      let editedField = null;
      if (title !== undefined) {
        issue.title = String(title).trim();
        editedField = 'title';
      }
      if (body !== undefined) {
        issue.body = String(body == null ? '' : body).trim();
        editedField = 'body';
      }
      issue.updatedAt = now;
      const activity = {
        id: crypto.randomUUID(),
        issueId: issue.id,
        type: 'edited',
        actorId: editorId,
        createdAt: now,
        body: editedField === 'title' ? issue.title : issue.body,
      };
      state.issueActivity.push(activity);
      try {
        persist();
      } catch (err) {
        issue.title = previous.title;
        issue.body = previous.body;
        issue.updatedAt = previous.updatedAt;
        state.issueActivity = state.issueActivity.filter(
          (a) => a.id !== activity.id
        );
        throw err;
      }
      return issue;
    },
    /**
     * REQ-5-1-2: the usernames of the participants assigned to an issue
     * (read view of the right-side Assignees metadata), ordered by the time
     * they were assigned (stable across reloads).
     */
    getIssueAssignees(issueId) {
      return state.issueAssignees
        .filter((a) => a.issueId === issueId)
        .sort((a, b) => {
          if (a.createdAt !== b.createdAt) {
            return a.createdAt < b.createdAt ? -1 : 1;
          }
          return a.id < b.id ? -1 : 1;
        })
        .map((a) => {
          const account = state.accounts.find((acc) => acc.id === a.accountId);
          return account ? account.username : null;
        })
        .filter(Boolean);
    },
    /**
     * REQ-5-3-1: the usernames of the accounts that may be assigned to an
     * issue of the repository — every account whose effective repository role
     * is at least Triage (the explicit module rule; Write and Read accounts
     * and unprivileged visitors are NOT assignable). Sorted by username so
     * the selector options are stable across reloads. The list is the
     * server-side authorization source: non-assignable users never appear in
     * the search results.
     */
    getAssignableMemberUsernames(repositoryId) {
      return state.accounts
        .filter((account) => {
          const role = this.effectiveRepositoryRole(repositoryId, account.id);
          return role !== null && ROLE_RANK[role] >= ROLE_RANK.triage;
        })
        .map((account) => account.username)
        .sort((a, b) => a.localeCompare(b));
    },
    /**
     * REQ-5-3-1: assigns one assignable member account to an issue. The
     * issue-account relationship, the operator, and the time are stored; the
     * append-only activity timeline records the `assigned` event (the body
     * carries the assigned username) and updatedAt advances to the operation
     * time, all in one atomic write. Assigning an account that is already
     * assigned is a no-op (no duplicate relationship and no new activity). A
     * failed write rolls the in-memory records back so no partial assignment
     * persists.
     */
    setIssueAssignee(issueId, accountId, actorId) {
      const issue = state.issues.find((i) => i.id === issueId);
      if (!issue) {
        return null;
      }
      const existing = state.issueAssignees.some(
        (a) => a.issueId === issueId && a.accountId === accountId
      );
      if (existing) {
        return issue;
      }
      const now = new Date().toISOString();
      const actor = state.accounts.find((a) => a.id === actorId);
      const assignee = state.accounts.find((a) => a.id === accountId);
      const relationship = {
        id: crypto.randomUUID(),
        issueId,
        accountId,
        createdAt: now,
      };
      const activity = {
        id: crypto.randomUUID(),
        issueId,
        type: 'assigned',
        actorId,
        createdAt: now,
        body: assignee ? assignee.username : null,
      };
      const previousUpdatedAt = issue.updatedAt;
      state.issueAssignees.push(relationship);
      state.issueActivity.push(activity);
      issue.updatedAt = now;
      try {
        persist();
      } catch (err) {
        state.issueAssignees = state.issueAssignees.filter(
          (a) => a.id !== relationship.id
        );
        state.issueActivity = state.issueActivity.filter(
          (a) => a.id !== activity.id
        );
        issue.updatedAt = previousUpdatedAt;
        throw err;
      }
      return issue;
    },
    /**
     * REQ-5-3-1: removes the issue-account assignment relationship. Only the
     * relationship is deleted — the member account and the repository grant
     * stay untouched — and the append-only activity timeline records the
     * `unassigned` event (body carries the username) with updatedAt advancing
     * in the same atomic write. Unassigning an account that is not assigned
     * is a no-op (no new activity). A failed write rolls the in-memory
     * records back so no partial unassignment persists.
     */
    removeIssueAssignee(issueId, accountId, actorId) {
      const issue = state.issues.find((i) => i.id === issueId);
      if (!issue) {
        return null;
      }
      const existing = state.issueAssignees.find(
        (a) => a.issueId === issueId && a.accountId === accountId
      );
      if (!existing) {
        return issue;
      }
      const now = new Date().toISOString();
      const actor = state.accounts.find((a) => a.id === actorId);
      const assignee = state.accounts.find((a) => a.id === accountId);
      const activity = {
        id: crypto.randomUUID(),
        issueId,
        type: 'unassigned',
        actorId,
        createdAt: now,
        body: assignee ? assignee.username : null,
      };
      const previousUpdatedAt = issue.updatedAt;
      const previousAssignees = state.issueAssignees;
      state.issueAssignees = state.issueAssignees.filter((a) => a !== existing);
      state.issueActivity.push(activity);
      issue.updatedAt = now;
      try {
        persist();
      } catch (err) {
        state.issueAssignees = previousAssignees;
        state.issueActivity = state.issueActivity.filter(
          (a) => a.id !== activity.id
        );
        issue.updatedAt = previousUpdatedAt;
        throw err;
      }
      return issue;
    },
    /**
     * REQ-5-3-2: the stored label identifiers attached to an issue (internal
     * helper so the apply/remove operations can detect the existing
     * relationship idempotently).
     */
    getIssueLabelIds(issueId) {
      return state.issueLabels
        .filter((il) => il.issueId === issueId)
        .map((il) => il.labelId);
    },
    /**
     * REQ-5-3-2: applies one existing repository label to an issue. The
     * issue-label relationship, the operator, and the time are stored; the
     * append-only activity timeline records the `labeled` event (the body
     * carries the label name) and updatedAt advances to the operation time,
     * all in one atomic write. Applying a label that is already applied is a
     * no-op (no duplicate relationship and no new activity). A failed write
     * rolls the in-memory records back so no partial association persists.
     */
    setIssueLabel(issueId, labelId, actorId) {
      const issue = state.issues.find((i) => i.id === issueId);
      if (!issue) {
        return null;
      }
      const existing = state.issueLabels.some(
        (il) => il.issueId === issueId && il.labelId === labelId
      );
      if (existing) {
        return issue;
      }
      const now = new Date().toISOString();
      const actor = state.accounts.find((a) => a.id === actorId);
      const label = state.labels.find((l) => l.id === labelId);
      const relationship = {
        id: crypto.randomUUID(),
        issueId,
        labelId,
        createdAt: now,
      };
      const activity = {
        id: crypto.randomUUID(),
        issueId,
        type: 'labeled',
        actorId,
        createdAt: now,
        body: label ? label.name : null,
      };
      const previousUpdatedAt = issue.updatedAt;
      state.issueLabels.push(relationship);
      state.issueActivity.push(activity);
      issue.updatedAt = now;
      try {
        persist();
      } catch (err) {
        state.issueLabels = state.issueLabels.filter(
          (il) => il.id !== relationship.id
        );
        state.issueActivity = state.issueActivity.filter(
          (a) => a.id !== activity.id
        );
        issue.updatedAt = previousUpdatedAt;
        throw err;
      }
      return issue;
    },
    /**
     * REQ-5-3-2: removes the issue-label association. Only the relationship is
     * deleted — the label record stays in the repository — and the append-only
     * activity timeline records the `unlabeled` event (body carries the label
     * name) with updatedAt advancing in the same atomic write. Removing a
     * label that is not applied is a no-op (no new activity). A failed write
     * rolls the in-memory records back so no partial unassociation persists.
     */
    removeIssueLabel(issueId, labelId, actorId) {
      const issue = state.issues.find((i) => i.id === issueId);
      if (!issue) {
        return null;
      }
      const existing = state.issueLabels.find(
        (il) => il.issueId === issueId && il.labelId === labelId
      );
      if (!existing) {
        return issue;
      }
      const now = new Date().toISOString();
      const actor = state.accounts.find((a) => a.id === actorId);
      const label = state.labels.find((l) => l.id === labelId);
      const activity = {
        id: crypto.randomUUID(),
        issueId,
        type: 'unlabeled',
        actorId,
        createdAt: now,
        body: label ? label.name : null,
      };
      const previousUpdatedAt = issue.updatedAt;
      const previousIssueLabels = state.issueLabels;
      state.issueLabels = state.issueLabels.filter((il) => il !== existing);
      state.issueActivity.push(activity);
      issue.updatedAt = now;
      try {
        persist();
      } catch (err) {
        state.issueLabels = previousIssueLabels;
        state.issueActivity = state.issueActivity.filter(
          (a) => a.id !== activity.id
        );
        issue.updatedAt = previousUpdatedAt;
        throw err;
      }
      return issue;
    },
    /**
     * REQ-5-1-2: the saved comments of an issue (author, body, time), in
     * chronological order. Comments are part of the discussion timeline.
     */
    getIssueComments(issueId) {
      return state.issueComments
        .filter((c) => c.issueId === issueId)
        .sort((a, b) => {
          if (a.createdAt !== b.createdAt) {
            return a.createdAt < b.createdAt ? -1 : 1;
          }
          return a.id < b.id ? -1 : 1;
        })
        .map((c) => {
          const author = state.accounts.find((acc) => acc.id === c.authorId);
          return {
            id: c.id,
            author: author ? author.username : null,
            body: c.body,
            createdAt: c.createdAt,
          };
        });
    },
    /**
     * REQ-5-2-3: resolves one stored comment by its identifier (for reaction
     * targets), or null when it does not exist.
     */
    findIssueCommentById(commentId) {
      return state.issueComments.find((c) => c.id === commentId) || null;
    },
    /**
     * REQ-5-2-3: stores one comment (identifier, issue identifier, author,
     * body, creation time) together with its `commented` activity record and
     * the issue's updated timestamp in one atomic write. The comment body is
     * trimmed before storage; the activity record links the comment id so the
     * detail page can attach reactions. A failed write rolls the in-memory
     * records back so no partial comment or timeline record ever persists.
     */
    addIssueComment(issueId, body, authorId) {
      const now = new Date().toISOString();
      const comment = {
        id: crypto.randomUUID(),
        issueId,
        authorId,
        body: String(body).trim(),
        createdAt: now,
      };
      const activity = {
        id: crypto.randomUUID(),
        issueId,
        type: 'commented',
        actorId: authorId,
        createdAt: now,
        body: comment.body,
        commentId: comment.id,
      };
      const issue = state.issues.find((i) => i.id === issueId);
      const previousUpdatedAt = issue ? issue.updatedAt : null;
      state.issueComments.push(comment);
      state.issueActivity.push(activity);
      if (issue) {
        issue.updatedAt = now;
      }
      try {
        persist();
      } catch (err) {
        state.issueComments = state.issueComments.filter(
          (c) => c.id !== comment.id
        );
        state.issueActivity = state.issueActivity.filter(
          (a) => a.id !== activity.id
        );
        if (issue) {
          issue.updatedAt = previousUpdatedAt;
        }
        throw err;
      }
      return comment;
    },
    /**
     * REQ-5-2-3: adds or removes one "subject-target-reaction type"
     * association in a single atomic write. For the same user (subject),
     * target, and reaction only one association is stored; selecting the same
     * reaction a second time removes it. A failed write rolls the in-memory
     * reactions back so no partial reaction persists.
     */
    toggleIssueReaction(issueId, targetType, targetId, accountId, reaction) {
      const existing = state.issueReactions.find(
        (r) =>
          r.issueId === issueId &&
          r.targetType === targetType &&
          r.targetId === targetId &&
          r.accountId === accountId &&
          r.reaction === reaction
      );
      if (existing) {
        const previousReactions = state.issueReactions;
        state.issueReactions = state.issueReactions.filter(
          (r) => r !== existing
        );
        try {
          persist();
        } catch (err) {
          state.issueReactions = previousReactions;
          throw err;
        }
        return { added: false };
      }
      const reactionRecord = {
        id: crypto.randomUUID(),
        issueId,
        targetType,
        targetId,
        accountId,
        reaction,
        createdAt: new Date().toISOString(),
      };
      const previousReactions = state.issueReactions;
      state.issueReactions.push(reactionRecord);
      try {
        persist();
      } catch (err) {
        state.issueReactions = previousReactions;
        throw err;
      }
      return { added: true };
    },
    /**
     * REQ-5-2-3: the reaction groups of one target (the issue itself or one
     * of its comments), grouped by reaction type with the number of accounts
     * that reacted and whether the given account is among them. Sorted by
     * reaction so the display is deterministic across reloads.
     */
    getIssueReactionGroups(issueId, targetType, targetId, accountId) {
      const groups = new Map();
      for (const record of state.issueReactions) {
        if (
          record.issueId !== issueId ||
          record.targetType !== targetType ||
          record.targetId !== targetId
        ) {
          continue;
        }
        let group = groups.get(record.reaction);
        if (!group) {
          group = { reaction: record.reaction, count: 0, reactedByMe: false };
          groups.set(record.reaction, group);
        }
        group.count += 1;
        if (accountId && record.accountId === accountId) {
          group.reactedByMe = true;
        }
      }
      return [...groups.values()].sort((a, b) =>
        a.reaction.localeCompare(b.reaction)
      );
    },
    /**
     * REQ-5-1-2: the append-only activity timeline of an issue in
     * chronological order. Records creation, comments, and (in later
     * features) edits, assignment, labels, milestone, and status changes.
     */
    getIssueActivity(issueId) {
      return state.issueActivity
        .filter((e) => e.issueId === issueId)
        .sort((a, b) => {
          if (a.createdAt !== b.createdAt) {
            return a.createdAt < b.createdAt ? -1 : 1;
          }
          return a.id < b.id ? -1 : 1;
        })
        .map((e) => {
          const actor = state.accounts.find((acc) => acc.id === e.actorId);
          return {
            type: e.type,
            actor: actor ? actor.username : null,
            createdAt: e.createdAt,
            body: e.body || null,
            // REQ-5-2-3: commented events link their stored comment so the
            // detail page can attach the comment's reactions to the entry.
            commentId: e.commentId || null,
          };
        });
    },
    /**
     * REQ-2-3: the single stored direct-role grant for a (repository,
     * subject) pair, or null when none exists.
     */
    findRepoAccessGrant(repositoryId, subjectType, subjectId) {
      return (
        state.repoAccess.find(
          (g) =>
            g.repositoryId === repositoryId &&
            g.subjectType === subjectType &&
            g.subjectId === subjectId
        ) || null
      );
    },
    /**
     * REQ-2-3: resolves the stored authorization grants for a repository to
     * visible subject names (member username or team name). Grants whose
     * subject no longer exists are filtered out. Order is stable so the
     * Manage access list is deterministic across reloads.
     */
    getRepoAccessGrants(repositoryId) {
      return state.repoAccess
        .filter((g) => g.repositoryId === repositoryId)
        .map((g) => {
          let subjectName = null;
          if (g.subjectType === 'user') {
            const account = this.findAccountById(g.subjectId);
            subjectName = account ? account.username : null;
          } else if (g.subjectType === 'team') {
            const team = this.findTeamById(g.subjectId);
            subjectName = team ? team.name : null;
          }
          if (subjectName === null) {
            return null;
          }
          const grantor = this.findAccountById(g.grantorId);
          return {
            id: g.id,
            subjectType: g.subjectType,
            subjectName,
            role: g.role,
            grantedBy: grantor ? grantor.username : null,
            updatedAt: g.createdAt,
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          if (a.subjectType !== b.subjectType) {
            return a.subjectType === 'team' ? 1 : -1;
          }
          return a.subjectName.localeCompare(b.subjectName);
        });
    },
    /**
     * REQ-2-3: stores exactly one direct role grant per (repository, subject).
     * Saving the same role again updates the existing record instead of
     * creating a second one; changing the role replaces the original role
     * (together with the grantor and timestamp). One atomic write; a failed
     * write rolls the in-memory state back.
     */
    setRepoAccess({ repositoryId, subjectType, subjectId, role, grantorId }) {
      const existing = state.repoAccess.find(
        (g) =>
          g.repositoryId === repositoryId &&
          g.subjectType === subjectType &&
          g.subjectId === subjectId
      );
      const now = new Date().toISOString();
      if (existing) {
        existing.role = role;
        existing.grantorId = grantorId;
        existing.createdAt = now;
        persist();
        return existing;
      }
      const grant = {
        id: crypto.randomUUID(),
        repositoryId,
        subjectType,
        subjectId,
        role,
        grantorId,
        createdAt: now,
      };
      state.repoAccess.push(grant);
      try {
        persist();
      } catch (err) {
        state.repoAccess = state.repoAccess.filter((g) => g.id !== grant.id);
        throw err;
      }
      return grant;
    },
    getDirectGrant(repositoryId, accountId) {
      return (
        state.repoAccess.find(
          (g) =>
            g.repositoryId === repositoryId &&
            g.subjectType === 'user' &&
            g.subjectId === accountId
        ) || null
      );
    },
    getTeamGrants(repositoryId, accountId) {
      // Only teams the account is a direct member of convey repository access;
      // team hierarchy does not propagate membership or authorization.
      const memberships = state.teamMembers.filter(
        (m) => m.accountId === accountId
      );
      const teamIds = new Set(memberships.map((m) => m.teamId));
      return state.repoAccess.filter(
        (g) =>
          g.repositoryId === repositoryId &&
          g.subjectType === 'team' &&
          teamIds.has(g.subjectId)
      );
    },
    /**
     * Effective repository role for an account, or null when the account has
     * no access. The role is the highest among Admin from Owner status and
     * all still-valid direct grants and team grants (REQ-2-3 ROOT rule);
     * public repositories additionally yield at least Read for everyone. For
     * private organization repositories the only paths are organization Owner
     * status, a direct role grant, or direct membership in a team that holds
     * a role grant on that repository.
     */
    effectiveRepositoryRole(repositoryId, accountId) {
      const repository = state.repositories.find((r) => r.id === repositoryId);
      if (!repository) {
        return null;
      }
      let best = null;
      if (repository.ownerType === 'user') {
        if (repository.ownerId === accountId) {
          best = 'admin';
        }
        const direct = this.getDirectGrant(repositoryId, accountId);
        if (direct && (!best || ROLE_RANK[direct.role] > ROLE_RANK[best])) {
          best = direct.role;
        }
      } else {
        if (this.isOrganizationOwner(repository.ownerId, accountId)) {
          best = 'admin';
        }
        const direct = this.getDirectGrant(repositoryId, accountId);
        if (direct && (!best || ROLE_RANK[direct.role] > ROLE_RANK[best])) {
          best = direct.role;
        }
        for (const grant of this.getTeamGrants(repositoryId, accountId)) {
          if (!best || ROLE_RANK[grant.role] > ROLE_RANK[best]) {
            best = grant.role;
          }
        }
      }
      if (best === null && repository.visibility === 'public') {
        return 'read';
      }
      return best;
    },
    getRepositoriesVisibleTo(organizationId, accountId) {
      return this.getOrganizationRepositories(organizationId).filter((repository) => {
        if (repository.visibility === 'public') {
          return true;
        }
        return accountId !== null && this.effectiveRepositoryRole(repository.id, accountId) !== null;
      });
    },
    /**
     * REQ-3-2-1: personal (user-owned) repositories of a username that are
     * visible to the given account (public to everyone; private only to the
     * owner or authorized subjects, following the same access rule as lists
     * and direct links).
     */
    getUserRepositoriesVisibleTo(username, accountId) {
      const account = this.findAccountByUsername(username);
      if (!account) {
        return [];
      }
      return state.repositories.filter((repository) => {
        if (repository.ownerType !== 'user' || repository.ownerId !== account.id) {
          return false;
        }
        if (repository.visibility === 'public') {
          return true;
        }
        return accountId !== null && this.effectiveRepositoryRole(repository.id, accountId) !== null;
      });
    },
    /**
     * REQ-3-2-1: stores a repository together with its creator and, when
     * initialization is requested, the initial branch, README file, and
     * initial commit in one atomic write. If the write fails, all in-memory
     * records are rolled back so no partially created repository survives.
     */
    createRepository({ ownerType, ownerId, name, description, visibility, creatorId, initialize }) {
      const now = new Date().toISOString();
      const repository = {
        id: crypto.randomUUID(),
        ownerType,
        ownerId,
        name,
        description: description || '',
        visibility,
        defaultBranch: 'main',
        creatorId,
        createdAt: now,
        updatedAt: now,
      };
      const prevRepositories = state.repositories;
      const prevBranches = state.branches;
      const prevCommits = state.commits;
      const prevCommitFiles = state.commitFiles;
      state.repositories.push(repository);
      if (initialize) {
        const commit = {
          id: crypto.randomUUID(),
          repositoryId: repository.id,
          message: 'Initial commit',
          authorId: creatorId,
          parentCommitIds: [],
          createdAt: now,
        };
        const branch = {
          id: crypto.randomUUID(),
          repositoryId: repository.id,
          name: 'main',
          headCommitId: commit.id,
          createdAt: now,
        };
        const file = {
          id: crypto.randomUUID(),
          commitId: commit.id,
          path: 'README.md',
          content: `# ${name}\n`,
        };
        state.branches.push(branch);
        state.commits.push(commit);
        state.commitFiles.push(file);
      }
      try {
        persist();
      } catch (err) {
        state.repositories = prevRepositories;
        state.branches = prevBranches;
        state.commits = prevCommits;
        state.commitFiles = prevCommitFiles;
        throw err;
      }
      return repository;
    },
    /**
     * REQ-3-2-2: creates an independent fork of a readable source repository
     * in a target personal or organization namespace. The fork stores its own
     * owner, visibility, default branch, and the source-repository identifier
     * (the recorded source-repository link), and copies the accessible
     * default-branch history (branch, commits, and files) with fresh record
     * ids and remapped parent links, so later commits on the fork never write
     * back to the source repository. Commit authors are preserved. One atomic
     * write; if it fails, every in-memory record is rolled back so no fork is
     * created.
     */
    createFork({ sourceRepositoryId, ownerType, ownerId, name, description, visibility, creatorId }) {
      const source = this.findRepositoryById(sourceRepositoryId);
      if (!source) {
        return null;
      }
      const now = new Date().toISOString();
      const repository = {
        id: crypto.randomUUID(),
        ownerType,
        ownerId,
        name,
        description: description || '',
        visibility,
        defaultBranch: source.defaultBranch,
        sourceRepositoryId: source.id,
        creatorId,
        createdAt: now,
        updatedAt: now,
      };
      const prevRepositories = state.repositories;
      const prevBranches = state.branches;
      const prevCommits = state.commits;
      const prevCommitFiles = state.commitFiles;
      state.repositories.push(repository);

      const sourceBranch = this.findBranchByRepositoryAndName(source.id, source.defaultBranch);
      const history = this.getCommitHistory(source.id, source.defaultBranch);
      if (sourceBranch && history.length > 0) {
        const idMap = new Map(history.map((commit) => [commit.id, crypto.randomUUID()]));
        const sourceFilesByCommit = new Map();
        for (const commit of history) {
          sourceFilesByCommit.set(
            commit.id,
            state.commitFiles.filter((f) => f.commitId === commit.id)
          );
        }
        for (const commit of history) {
          const newCommitId = idMap.get(commit.id);
          state.commits.push({
            id: newCommitId,
            repositoryId: repository.id,
            message: commit.message,
            authorId: commit.authorId,
            parentCommitIds: (commit.parentCommitIds || [])
              .map((parentId) => idMap.get(parentId))
              .filter(Boolean),
            createdAt: commit.createdAt,
          });
          for (const file of sourceFilesByCommit.get(commit.id) || []) {
            state.commitFiles.push({
              id: crypto.randomUUID(),
              commitId: newCommitId,
              path: file.path,
              content: file.content,
            });
          }
        }
        state.branches.push({
          id: crypto.randomUUID(),
          repositoryId: repository.id,
          name: source.defaultBranch,
          headCommitId: idMap.get(sourceBranch.headCommitId),
          createdAt: now,
        });
      }
      try {
        persist();
      } catch (err) {
        state.repositories = prevRepositories;
        state.branches = prevBranches;
        state.commits = prevCommits;
        state.commitFiles = prevCommitFiles;
        throw err;
      }
      return repository;
    },
    findBranchByRepositoryAndName(repositoryId, name) {
      return (
        state.branches.find(
          (b) => b.repositoryId === repositoryId && b.name === name
        ) || null
      );
    },
    /**
     * REQ-4-3-1: every branch stored for a repository (name and the commit it
     * currently points to). Used by the Code page branch selector.
     */
    getBranches(repositoryId) {
      return state.branches.filter((b) => b.repositoryId === repositoryId);
    },
    /**
     * REQ-4-3-2: stores a new branch reference pointing at an existing
     * commit (the base commit). The branch carries its unique name, the
     * repository, the pointed-to commit, the creating account, and the
     * creation time. Duplicate names are rejected (returns null) and the
     * write is one atomic persist; no branch or history is rewritten. The
     * caller is responsible for role and name validation.
     */
    createBranch(repositoryId, name, baseCommitId, creatorId) {
      if (this.findBranchByRepositoryAndName(repositoryId, name)) {
        return null;
      }
      const branch = {
        id: crypto.randomUUID(),
        repositoryId,
        name,
        headCommitId: baseCommitId,
        creatorId,
        createdAt: new Date().toISOString(),
      };
      const prevBranches = state.branches;
      state.branches.push(branch);
      try {
        persist();
      } catch (err) {
        state.branches = prevBranches;
        throw err;
      }
      return branch;
    },
    /**
     * REQ-4-2-1: resolves a stored commit by its identifier, or null when it
     * does not exist. Callers additionally check the commit belongs to the
     * requested repository.
     */
    findCommitById(commitId) {
      return state.commits.find((c) => c.id === commitId) || null;
    },
    /**
     * REQ-3-4: applies a new visibility to a repository and refreshes its
     * updated timestamp in one atomic write. The new visibility is enforced
     * immediately by every read path (overview, search, lists, direct links)
     * because they all consult the persisted repository record.
     */
    updateRepositoryVisibility(repositoryId, visibility) {
      const repository = this.findRepositoryById(repositoryId);
      if (!repository) {
        return null;
      }
      repository.visibility = visibility === 'public' ? 'public' : 'private';
      repository.updatedAt = new Date().toISOString();
      persist();
      return repository;
    },
    /**
     * REQ-4-3-3: changes the default branch of a repository. The new default
     * branch is stored together with the operating account and the change
     * time in one atomic write; branches, commits, and file content are never
     * deleted or rewritten (a branch is only a named reference, so switching
     * the default just changes which reference the repository reads by
     * default). The caller validates the operator role and that the target is
     * an existing branch of the repository.
     */
    updateRepositoryDefaultBranch(repositoryId, branchName, operatorId) {
      const repository = this.findRepositoryById(repositoryId);
      if (!repository) {
        return null;
      }
      const now = new Date().toISOString();
      repository.defaultBranch = branchName;
      repository.defaultBranchOperatorId = operatorId;
      repository.defaultBranchChangedAt = now;
      repository.updatedAt = now;
      persist();
      return repository;
    },
    /**
     * REQ-4-4: whether a branch is protected against web file-editor
     * submissions. A branch is protected when a REQ-6-1 branch protection
     * rule exists for its exact name (or a legacy REQ-4-4 protected-branch
     * record does), so a protected branch rejects a commit and the page
     * shows the reason without changing the file, branch head, or commit
     * history.
     */
    isBranchProtected(repositoryId, branchName) {
      return (
        state.branchProtectionRules.some(
          (r) => r.repositoryId === repositoryId && r.branchName === branchName
        ) ||
        state.protectedBranches.some(
          (p) => p.repositoryId === repositoryId && p.name === branchName
        )
      );
    },
    /**
     * REQ-6-1: the persisted branch protection rules of a repository,
     * sorted by the exact branch name so the settings page is deterministic
     * across reloads. Each rule stores the branch name and the two
     * independently selectable requirement toggles.
     */
    getBranchProtectionRules(repositoryId) {
      return state.branchProtectionRules
        .filter((r) => r.repositoryId === repositoryId)
        .sort((a, b) => a.branchName.localeCompare(b.branchName));
    },
    /**
     * REQ-6-1: resolves a branch protection rule by its exact branch name
     * within a repository, or null when none exists. At most one rule per
     * exact branch name.
     */
    findBranchProtectionRule(repositoryId, branchName) {
      return (
        state.branchProtectionRules.find(
          (r) => r.repositoryId === repositoryId && r.branchName === branchName
        ) || null
      );
    },
    /**
     * REQ-6-1: stores a new branch protection rule (exact branch name +
     * requirement toggles + creator and time) in one atomic write. Returns
     * the rule, or null when a rule already exists for that exact branch
     * name (the caller switches to the save-changes path). A failed write
     * rolls the in-memory record back so no partial rule persists.
     */
    createBranchProtectionRule({
      repositoryId,
      branchName,
      requireApproval,
      requireStatusCheck,
      creatorId,
    }) {
      if (this.findBranchProtectionRule(repositoryId, branchName)) {
        return null;
      }
      const now = new Date().toISOString();
      const rule = {
        id: crypto.randomUUID(),
        repositoryId,
        branchName,
        requireApproval: requireApproval === true,
        requireStatusCheck: requireStatusCheck === true,
        creatorId,
        createdAt: now,
        updatedAt: now,
      };
      const prevRules = state.branchProtectionRules;
      state.branchProtectionRules.push(rule);
      try {
        persist();
      } catch (err) {
        state.branchProtectionRules = prevRules;
        throw err;
      }
      return rule;
    },
    /**
     * REQ-6-1: updates the requirement toggles of an existing branch
     * protection rule in one atomic write (the “Save changes” action of an
     * existing rule). Returns the updated rule, or null when no rule exists
     * for the exact branch name. A failed write rolls the in-memory record
     * back so the previous toggles stay in place.
     */
    updateBranchProtectionRule(
      repositoryId,
      branchName,
      { requireApproval, requireStatusCheck }
    ) {
      const rule = this.findBranchProtectionRule(repositoryId, branchName);
      if (!rule) {
        return null;
      }
      const previous = { ...rule };
      rule.requireApproval = requireApproval === true;
      rule.requireStatusCheck = requireStatusCheck === true;
      rule.updatedAt = new Date().toISOString();
      try {
        persist();
      } catch (err) {
        rule.requireApproval = previous.requireApproval;
        rule.requireStatusCheck = previous.requireStatusCheck;
        rule.updatedAt = previous.updatedAt;
        throw err;
      }
      return rule;
    },
    /**
     * REQ-6-1: every pull request of a repository, ascending by the
     * persisted repository-scoped number (deterministic across reloads).
     */
    getRepositoryPullRequests(repositoryId) {
      return state.pullRequests
        .filter((p) => p.repositoryId === repositoryId)
        .sort((a, b) => a.number - b.number);
    },
    /**
     * REQ-6-1: resolves a pull request by its repository-scoped number, or
     * null when it does not exist.
     */
    findPullRequestByNumber(repositoryId, number) {
      return (
        state.pullRequests.find(
          (p) => p.repositoryId === repositoryId && p.number === Number(number)
        ) || null
      );
    },
    /**
     * REQ-6-2-3: resolves an existing Draft or Open pull request of the same
     * source/target branch pair in a repository, or null when none exists.
     * Only Draft and Open block creation — a Closed or Merged PR with the
     * same pair does not.
     */
    findOpenOrDraftPullRequestByPair(repositoryId, baseBranch, compareBranch) {
      return (
        state.pullRequests.find(
          (p) =>
            p.repositoryId === repositoryId &&
            p.baseBranch === baseBranch &&
            p.compareBranch === compareBranch &&
            (p.status === 'draft' || p.status === 'open')
        ) || null
      );
    },
    /**
     * REQ-6-2-3: creates a new Open pull request and appends its creation
     * activity in one atomic write. The PR carries the next incrementing
     * repository-scoped number, the source/target branch names, the current
     * compare commit (the compare branch head) and the current base commit
     * (the base branch head) at creation time, the trimmed title and
     * description, the author, and the timestamps. The append-only activity
     * timeline gains a single `created` event by the same author at the same
     * time. A failed write rolls the in-memory records back (no number is
     * allocated) and re-throws, so no partial data ever persists. The caller
     * validates the role, the branches, the differences, the duplicate-pair
     * rule, and the title/description fields beforehand.
     */
    createPullRequest(repositoryId, { title, description, baseBranch, compareBranch, baseCommitId, compareCommitId }, authorId, status = 'open') {
      const now = new Date().toISOString();
      const numbers = state.pullRequests
        .filter((p) => p.repositoryId === repositoryId)
        .map((p) => p.number);
      const number = numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
      const pullRequest = {
        id: crypto.randomUUID(),
        repositoryId,
        number,
        title: String(title).trim(),
        description: String(description == null ? '' : description).trim(),
        authorId,
        // REQ-6-2-4: a draft creation stores status 'draft'; normal creation
        // stores 'open'. Only these two are produced here (Closed/Merged
        // come from state transitions).
        status: status === 'draft' ? 'draft' : 'open',
        baseBranch,
        compareBranch,
        baseCommitId,
        compareCommitId,
        createdAt: now,
        updatedAt: now,
      };
      const activity = {
        id: crypto.randomUUID(),
        pullRequestId: pullRequest.id,
        type: 'created',
        actorId: authorId,
        createdAt: now,
        body: null,
      };
      state.pullRequests.push(pullRequest);
      state.pullRequestActivity.push(activity);
      try {
        persist();
      } catch (err) {
        state.pullRequests = state.pullRequests.filter(
          (p) => p.id !== pullRequest.id
        );
        state.pullRequestActivity = state.pullRequestActivity.filter(
          (a) => a.id !== activity.id
        );
        throw err;
      }
      return pullRequest;
    },
    /**
     * REQ-6-2-4: transitions a Draft pull request to Open (Ready for
     * review) and appends a `ready_for_review` activity in one atomic
     * write. The transition never changes the PR's branches, commits, title,
     * description, or number. Returns null when the PR is not a Draft
     * (the caller rejects it); a failed write rolls every in-memory record
     * back and re-throws.
     */
    markPullRequestReadyForReview(pullRequest, actorId) {
      if (!pullRequest || pullRequest.status !== 'draft') {
        return null;
      }
      const now = new Date().toISOString();
      const previous = {
        status: pullRequest.status,
        updatedAt: pullRequest.updatedAt,
      };
      const activity = {
        id: crypto.randomUUID(),
        pullRequestId: pullRequest.id,
        type: 'ready_for_review',
        actorId,
        createdAt: now,
        body: null,
      };
      pullRequest.status = 'open';
      pullRequest.updatedAt = now;
      state.pullRequestActivity.push(activity);
      try {
        persist();
      } catch (err) {
        pullRequest.status = previous.status;
        pullRequest.updatedAt = previous.updatedAt;
        // Remove the pushed activity record regardless of whether the array
        // reference was replaced, so the rollback never leaves a partial
        // ready-for-review event behind.
        state.pullRequestActivity = state.pullRequestActivity.filter(
          (a) => a.id !== activity.id
        );
        throw err;
      }
      return pullRequest;
    },
    /**
     * REQ-6-6: closes or reopens one unmerged pull request and appends a
     * `closed`/`reopened` activity record in one atomic write. The system
     * stores the new status together with the operator (the activity actor)
     * and the time (the activity createdAt and the PR's updatedAt). The
     * transition never touches the PR's branches, commits, title,
     * description, discussion comments, reviews, diff, or number — closing
     * or reopening must not update any branch. An already-closed PR being
     * closed again or an already-open PR being opened again is a no-op (no
     * duplicate activity). `newStatus` is only 'open' or 'closed'; the only
     * valid transitions are Open/Draft -> Closed (close) and Closed -> Open
     * (reopen), so requesting an invalid transition returns null (the
     * caller rejects it). A failed write rolls every in-memory record back
     * and re-throws.
     */
    setPullRequestStatus(pullRequest, newStatus, actorId) {
      if (!pullRequest) {
        return null;
      }
      if (pullRequest.status === newStatus) {
        return pullRequest;
      }
      const closeable = pullRequest.status === 'open' || pullRequest.status === 'draft';
      const reopenable = pullRequest.status === 'closed';
      if (!(newStatus === 'closed' && closeable) && !(newStatus === 'open' && reopenable)) {
        return null;
      }
      const now = new Date().toISOString();
      const previous = {
        status: pullRequest.status,
        updatedAt: pullRequest.updatedAt,
      };
      const activity = {
        id: crypto.randomUUID(),
        pullRequestId: pullRequest.id,
        type: newStatus === 'closed' ? 'closed' : 'reopened',
        actorId,
        createdAt: now,
        body: null,
      };
      pullRequest.status = newStatus;
      pullRequest.updatedAt = now;
      state.pullRequestActivity.push(activity);
      try {
        persist();
      } catch (err) {
        pullRequest.status = previous.status;
        pullRequest.updatedAt = previous.updatedAt;
        state.pullRequestActivity = state.pullRequestActivity.filter(
          (a) => a.id !== activity.id
        );
        throw err;
      }
      return pullRequest;
    },
    /**
     * REQ-6-1: the append-only activity timeline of a pull request in
     * chronological order (creation and later events).
     */
    getPullRequestActivity(pullRequestId) {
      return state.pullRequestActivity
        .filter((e) => e.pullRequestId === pullRequestId)
        .sort((a, b) => {
          if (a.createdAt !== b.createdAt) {
            return a.createdAt < b.createdAt ? -1 : 1;
          }
          return a.id < b.id ? -1 : 1;
        })
        .map((e) => {
          const actor = state.accounts.find((acc) => acc.id === e.actorId);
          return {
            type: e.type,
            actor: actor ? actor.username : null,
            createdAt: e.createdAt,
            body: e.body || null,
          };
        });
    },
    /**
     * REQ-6-3-1: the ordinary (non-inline) discussion comments of a pull
     * request in chronological order (each stores the target PR, author,
     * body, and time). The Conversation view reads them as part of the
     * timeline; this getter is read-only.
     */
    getPullRequestComments(pullRequestId) {
      return state.pullRequestComments
        .filter((c) => c.pullRequestId === pullRequestId)
        .sort((a, b) => {
          if (a.createdAt !== b.createdAt) {
            return a.createdAt < b.createdAt ? -1 : 1;
          }
          return a.id < b.id ? -1 : 1;
        })
        .map((c) => {
          const author = state.accounts.find((acc) => acc.id === c.authorId);
          return {
            id: c.id,
            author: author ? author.username : null,
            body: c.body,
            createdAt: c.createdAt,
          };
        });
    },
    /**
     * REQ-6-3-1: every review decision of a pull request in chronological
     * order (each stores the reviewer, the compare commit it was made on,
     * the decision/status, the explanation, and the time). Review summaries
     * stay in the Conversation timeline even when the compare commit moves
     * (stale decisions are preserved in the timeline and only stop counting
     * for the merge eligibility). This getter is read-only.
     */
    getPullRequestReviewSummaries(pullRequest) {
      return state.reviews
        .filter((r) => r.pullRequestId === pullRequest.id)
        .sort((a, b) => {
          if (a.createdAt !== b.createdAt) {
            return a.createdAt < b.createdAt ? -1 : 1;
          }
          return a.id < b.id ? -1 : 1;
        })
        .map((r) => {
          const reviewer = state.accounts.find(
            (acc) => acc.id === r.reviewerId
          );
          return {
            id: r.id,
            reviewer: reviewer ? reviewer.username : null,
            decision: r.decision,
            explanation: r.explanation || '',
            commitId: r.commitId,
            createdAt: r.createdAt,
          };
        });
    },
    /**
     * REQ-6-3-3: the inline review comments of a pull request for the
     * detail view, in chronological order. A comment is anchored to a file
     * path, the compare commit it was created on, and a diff line position.
     * Published comments are visible to every viewer; pending drafts are
     * visible only to their author (they are not public until the review is
     * submitted). A comment whose compare commit differs from the PR's
     * current compare commit is marked outdated — published comments are
     * retained but flagged, while drafts are never published automatically.
     * Read-only.
     */
    getPullRequestInlineComments(pullRequestId, accountId, currentCompareCommitId) {
      return state.pullRequestInlineComments
        .filter((c) => c.pullRequestId === pullRequestId)
        .sort((a, b) => {
          if (a.createdAt !== b.createdAt) {
            return a.createdAt < b.createdAt ? -1 : 1;
          }
          return a.id < b.id ? -1 : 1;
        })
        .filter((c) => !c.pending || (accountId != null && c.authorId === accountId))
        .map((c) => {
          const author = state.accounts.find((acc) => acc.id === c.authorId);
          return {
            id: c.id,
            filePath: c.filePath,
            line: c.line,
            body: c.body,
            author: author ? author.username : null,
            commitId: c.commitId,
            createdAt: c.createdAt,
            pending: c.pending === true,
            outdated:
              currentCompareCommitId != null &&
              c.commitId !== currentCompareCommitId,
          };
        });
    },
    /**
     * REQ-6-3-3: stores one inline review comment of a pull request in one
     * atomic write — the target PR, the file path, the compare commit it was
     * made on, the diff line position, the author, the body, and the
     * publication state (`pending === true` keeps the comment as a
     * Start-a-review draft that is not public until the review is
     * submitted). A failed write rolls the in-memory record back and
     * re-throws, so a failed submission never displays as published.
     */
    addPullRequestInlineComment(pullRequestId, authorId, commitId, filePath, line, body, pending) {
      const comment = {
        id: crypto.randomUUID(),
        pullRequestId,
        authorId,
        commitId,
        filePath,
        line,
        body: String(body).trim(),
        pending: pending === true,
        createdAt: new Date().toISOString(),
      };
      const prevComments = state.pullRequestInlineComments;
      state.pullRequestInlineComments.push(comment);
      try {
        persist();
      } catch (err) {
        state.pullRequestInlineComments = prevComments;
        throw err;
      }
      return comment;
    },
    /**
     * REQ-6-3-4: stores one review decision of a pull request in one atomic
     * write — the target PR, the reviewer, the compare commit the review was
     * made on, the decision (Comment, Approve, or Request changes), the
     * optional explanation (the review Summary), and the time. A new decision
     * by the same reviewer on the same current compare commit replaces that
     * reviewer's effective decision (the merge-eligibility and review-status
     * readers only count the reviewer's latest decision on the current commit)
     * while the old record is preserved in the timeline. Submitting a review
     * also publishes the reviewer's pending Start-a-review inline comments on
     * this PR (they are drafts that are not public until the review is
     * submitted). A failed write rolls every in-memory change back and
     * re-throws, so a failed submission is never displayed as published.
     */
    submitPullRequestReview(
      pullRequestId,
      reviewerId,
      commitId,
      decision,
      explanation
    ) {
      const review = {
        id: crypto.randomUUID(),
        pullRequestId,
        reviewerId,
        decision,
        commitId,
        explanation:
          typeof explanation === 'string' ? String(explanation).trim() : '',
        createdAt: new Date().toISOString(),
      };
      const prevReviews = state.reviews;
      const prevComments = state.pullRequestInlineComments;
      state.reviews.push(review);
      // REQ-6-3-3/REQ-6-3-4: the reviewer's Start-a-review drafts are not
      // public until the review is submitted — submitting publishes them.
      state.pullRequestInlineComments = state.pullRequestInlineComments.map(
        (comment) =>
          comment.pullRequestId === pullRequestId &&
          comment.authorId === reviewerId &&
          comment.pending === true
            ? { ...comment, pending: false }
            : comment
      );
      try {
        persist();
      } catch (err) {
        state.reviews = prevReviews;
        state.pullRequestInlineComments = prevComments;
        throw err;
      }
      return review;
    },
    /**
     * REQ-6-4: the requested reviewers of a pull request — the usernames of
     * every pending-review request relationship, sorted by username so the
     * reviewer area is deterministic across reloads. A reviewer request is a
     * separate relationship from a submitted review decision: requesting a
     * reviewer never submits a review or generates an approval or comment.
     */
    getPullRequestReviewerUsernames(pullRequestId) {
      return state.pullRequestReviewers
        .filter((r) => r.pullRequestId === pullRequestId)
        .map((r) => {
          const account = state.accounts.find((a) => a.id === r.reviewerId);
          return account ? account.username : null;
        })
        .filter(Boolean)
        .sort();
    },
    /**
     * REQ-6-4: the eligible reviewer candidates of a repository for one pull
     * request — every account whose effective repository role is Write,
     * Maintain, or Admin and who is not the PR author, sorted by username.
     * The PR author can never request themselves; Read and Triage accounts
     * (and accounts outside the repository scope) are never candidates. The
     * caller additionally checks who may manage requests (the author of an
     * Open or Draft PR, Maintain, Admin, or the organization Owner).
     */
    getEligibleReviewerUsernames(repositoryId, pullRequest) {
      const candidates = [];
      for (const account of state.accounts) {
        if (!pullRequest || account.id === pullRequest.authorId) {
          continue;
        }
        const role = this.effectiveRepositoryRole(repositoryId, account.id);
        if (role === 'write' || role === 'maintain' || role === 'admin') {
          candidates.push(account.username);
        }
      }
      return candidates.sort();
    },
    /**
     * REQ-6-4: creates (or re-creates) a pending-review request relationship
     * between a pull request and one eligible reviewer in one atomic write,
     * storing the operator and the time. Re-requesting the same reviewer is
     * idempotent: the existing relationship is updated with the new operator
     * and time instead of storing a duplicate. A failed write rolls the
     * in-memory records back and re-throws, so a rejected request never
     * leaves a partial relationship behind. The caller validates the
     * permission and the candidate's eligibility beforehand.
     */
    requestPullRequestReviewer(pullRequestId, reviewerId, requestedById) {
      const existing = state.pullRequestReviewers.find(
        (r) => r.pullRequestId === pullRequestId && r.reviewerId === reviewerId
      );
      const now = new Date().toISOString();
      if (existing) {
        const previous = { ...existing };
        existing.requestedById = requestedById;
        existing.createdAt = now;
        try {
          persist();
        } catch (err) {
          existing.requestedById = previous.requestedById;
          existing.createdAt = previous.createdAt;
          throw err;
        }
        return existing;
      }
      const request = {
        id: crypto.randomUUID(),
        pullRequestId,
        reviewerId,
        requestedById,
        createdAt: now,
      };
      const prevRequests = state.pullRequestReviewers;
      state.pullRequestReviewers.push(request);
      try {
        persist();
      } catch (err) {
        state.pullRequestReviewers = prevRequests;
        throw err;
      }
      return request;
    },
    /**
     * REQ-6-4: deletes one pending-review request relationship of a pull
     * request in one atomic write. Removing a request only deletes the
     * relationship — reviews, comments, and activity records already
     * submitted by that reviewer are preserved and the reviewer's effective
     * review decision is unchanged. Removing a reviewer who has no request
     * is an idempotent no-op. A failed write rolls the in-memory records
     * back and re-throws.
     */
    removePullRequestReviewer(pullRequestId, reviewerId) {
      const prevRequests = state.pullRequestReviewers;
      state.pullRequestReviewers = state.pullRequestReviewers.filter(
        (r) => !(r.pullRequestId === pullRequestId && r.reviewerId === reviewerId)
      );
      try {
        persist();
      } catch (err) {
        state.pullRequestReviewers = prevRequests;
        throw err;
      }
      return true;
    },
    /**
     * REQ-6-2-1: the review status of a pull request for its current
     * compare commit — `approved`, `changes_requested`, or `review_required`
     * (no valid decision, or only Comment decisions which never satisfy a
     * review). For a given reviewer on the same current compare commit only
     * the reviewer's latest decision counts, mirroring the merge-eligibility
     * rule; reviews bound to an older compare commit are stale and do not
     * count. Used by the list's review-status filter.
     */
    getPullRequestReviewStatus(pullRequest) {
      const currentCompareCommitId =
        this.getPullRequestCurrentCompareCommit(pullRequest);
      const validReviews = currentCompareCommitId
        ? state.reviews.filter(
            (r) =>
              r.pullRequestId === pullRequest.id &&
              r.commitId === currentCompareCommitId
          )
        : [];
      const latestByReviewer = new Map();
      for (const review of validReviews) {
        if (
          review.decision !== 'comment' &&
          review.decision !== 'approve' &&
          review.decision !== 'request_changes'
        ) {
          continue;
        }
        const previous = latestByReviewer.get(review.reviewerId);
        if (!previous || review.createdAt >= previous.createdAt) {
          latestByReviewer.set(review.reviewerId, review);
        }
      }
      const decisions = [...latestByReviewer.values()];
      if (decisions.some((d) => d.decision === 'request_changes')) {
        return 'changes_requested';
      }
      if (decisions.some((d) => d.decision === 'approve')) {
        return 'approved';
      }
      return 'review_required';
    },
    /**
     * REQ-6-1: the PR's current compare commit — the head of the compare
     * branch at read time (a PR is a persistent proposal; the current
     * compare revision is derived from the stored compare branch, not a
     * separate user setting). Null when the compare branch is missing.
     */
    getPullRequestCurrentCompareCommit(pullRequest) {
      const branch = this.findBranchByRepositoryAndName(
        pullRequest.repositoryId,
        pullRequest.compareBranch
      );
      return branch && branch.headCommitId ? branch.headCommitId : null;
    },
    /**
     * REQ-6-1: the stored check run of one check name on a commit of a
     * repository (checks attach to the commit), or null when none exists.
     */
    findCheckRun(repositoryId, commitId, checkName) {
      return (
        state.checkRuns.find(
          (r) =>
            r.repositoryId === repositoryId &&
            r.commitId === commitId &&
            r.checkName === checkName
        ) || null
      );
    },
    /**
     * REQ-6-1: ensures a check run exists for the PR's current compare
     * commit — when the compare branch gains a new commit, the new compare
     * commit starts with a pending `test` run (persisted atomically).
     * Returns the run.
     */
    ensurePullCheckRun(repositoryId, pullRequestId, commitId) {
      const existing = this.findCheckRun(repositoryId, commitId, 'test');
      if (existing) {
        return existing;
      }
      const run = {
        id: crypto.randomUUID(),
        repositoryId,
        pullRequestId,
        commitId,
        checkName: 'test',
        status: 'pending',
        setterId: null,
        updatedAt: null,
      };
      const prevRuns = state.checkRuns;
      state.checkRuns.push(run);
      try {
        persist();
      } catch (err) {
        state.checkRuns = prevRuns;
        throw err;
      }
      return run;
    },
    /**
     * REQ-6-1: stores the `test` status (pending, success, or failure)
     * together with the setter account and the update time on the PR's
     * current compare commit in one atomic write. Only a repository Admin
     * may update the status from the Checks area (the caller enforces the
     * role). The result stays attached to that commit, so success on an old
     * commit can never be used after the compare branch gains a new commit.
     */
    setPullCheckStatus(repositoryId, pullRequestId, commitId, status, setterId) {
      const run = this.findCheckRun(repositoryId, commitId, 'test');
      const now = new Date().toISOString();
      if (run) {
        const previous = { ...run };
        run.status = status;
        run.setterId = setterId;
        run.updatedAt = now;
        try {
          persist();
        } catch (err) {
          run.status = previous.status;
          run.setterId = previous.setterId;
          run.updatedAt = previous.updatedAt;
          throw err;
        }
        return run;
      }
      return this.ensurePullCheckRun(repositoryId, pullRequestId, commitId);
    },
    /**
     * REQ-6-1: the commits on the compare branch relative to the base
     * branch (the PR's Commits view) — every commit reachable from the
     * compare branch head that is not reachable from the base branch head,
     * newest first.
     */
    getPullRequestCommits(pullRequest) {
      return this.getCommitsBetweenBranches(
        pullRequest.repositoryId,
        pullRequest.baseBranch,
        pullRequest.compareBranch
      );
    },
    /**
     * REQ-6-2-2: the comparable commits between two branches of a repository
     * for the PR comparison page — every commit reachable from the compare
     * branch head that is not reachable from the base branch head, newest
     * first. Both branches are read by name; the comparison itself never
     * saves a PR, commit, or branch change.
     */
    getCommitsBetweenBranches(repositoryId, baseBranch, compareBranch) {
      const compareHistory = this.getCommitHistory(repositoryId, compareBranch);
      const baseHistory = this.getCommitHistory(repositoryId, baseBranch);
      const baseIds = new Set(baseHistory.map((c) => c.id));
      return compareHistory.filter((c) => !baseIds.has(c.id));
    },
    /**
     * REQ-6-1/REQ-6-5: the common ancestor of two commits of a repository
     * that is closest to both tips (the 3-way merge base used to detect
     * merge conflicts and to build the merged snapshot of a merge commit).
     * Walks the parent chains of both commits, keeps the common ancestors
     * that are not ancestors of any other common ancestor, and prefers the
     * most recent one. Returns null when there is no common ancestor (or a
     * commit is missing).
     */
    getMergeBase(repositoryId, commitAId, commitBId) {
      const ancestorsOf = (commitId) => {
        const result = new Set();
        const stack = [commitId];
        while (stack.length > 0) {
          const id = stack.pop();
          if (result.has(id)) {
            continue;
          }
          result.add(id);
          const commit = this.findCommitById(id);
          if (commit && commit.parentCommitIds) {
            for (const parent of commit.parentCommitIds) {
              stack.push(parent);
            }
          }
        }
        return result;
      };
      if (!commitAId || !commitBId) {
        return null;
      }
      const a = ancestorsOf(commitAId);
      const b = ancestorsOf(commitBId);
      const common = [...a].filter((id) => b.has(id));
      if (common.length === 0) {
        return null;
      }
      const ancestorSets = new Map();
      for (const id of common) {
        ancestorSets.set(id, ancestorsOf(id));
      }
      // A common ancestor that is an ancestor of another common ancestor is
      // farther from the tips and can never be the merge base; the
      // remaining candidates are the closest common ancestors.
      const candidates = common.filter(
        (id) => !common.some((other) => other !== id && ancestorSets.get(other).has(id))
      );
      if (candidates.length === 0) {
        return common[0];
      }
      candidates.sort((x, y) => {
        const cx = this.findCommitById(x);
        const cy = this.findCommitById(y);
        return String(cy ? cy.createdAt : '').localeCompare(String(cx ? cx.createdAt : ''));
      });
      return candidates[0];
    },
    /**
     * REQ-6-5: performs a three-way content merge of the target branch head
     * and the current compare commit over their merge base and returns the
     * merged snapshot, or { ok: false } when the two sides change the same
     * file differently (a merge conflict — the PR cannot be merged). For
     * each file path, the merged content is: the compare content when only
     * the compare side changed it (or both sides agree), the target content
     * when only the target side changed it, and no file when both sides
     * deleted it; any other combination (both sides changed it differently,
     * or one side deleted while the other modified) is a conflict.
     */
    computeMergeContent(repositoryId, baseCommitId, targetCommitId, compareCommitId) {
      const snapshot = (commitId) => {
        const map = new Map();
        if (commitId) {
          for (const file of state.commitFiles.filter((f) => f.commitId === commitId)) {
            map.set(file.path, file.content);
          }
        }
        return map;
      };
      const baseFiles = snapshot(baseCommitId);
      const targetFiles = snapshot(targetCommitId);
      const compareFiles = snapshot(compareCommitId);
      const allPaths = new Set([
        ...baseFiles.keys(),
        ...targetFiles.keys(),
        ...compareFiles.keys(),
      ]);
      const merged = [];
      for (const path of [...allPaths].sort((a, b) => a.localeCompare(b))) {
        const baseContent = baseFiles.has(path) ? baseFiles.get(path) : null;
        const targetContent = targetFiles.has(path) ? targetFiles.get(path) : null;
        const compareContent = compareFiles.has(path) ? compareFiles.get(path) : null;
        let resultContent;
        if (targetContent === compareContent) {
          resultContent = targetContent;
        } else if (targetContent === baseContent) {
          resultContent = compareContent;
        } else if (compareContent === baseContent) {
          resultContent = targetContent;
        } else {
          // Both sides changed the same file differently (or one side
          // deleted while the other modified it) — a merge conflict.
          return { ok: false };
        }
        if (resultContent !== null) {
          merged.push({ path, content: resultContent });
        }
      }
      return { ok: true, files: merged };
    },
    /**
     * REQ-6-1/REQ-6-5: computes the merge eligibility of a pull request
     * against its base branch. A PR is mergeable only while it is Open, has
     * no valid Request changes decision, has no merge conflicts between the
     * target branch head and the current compare commit, satisfies the
     * branch protection rule's approval requirement (at least 1 valid
     * Approve from someone other than the PR author — displayed verbatim as
     * `Review required by branch protection` when unmet), and — when the
     * rule requires it — has `test` equal to success on the current compare
     * commit. An unprotected target has no additional approval-count or
     * check-success requirement, but merging still requires no conflicts
     * and no valid Request changes review. For a given reviewer on the same
     * current compare commit only the reviewer's latest decision among
     * Comment, Approve, and Request changes counts; when the compare branch
     * gains a new commit all earlier decisions become stale (they are bound
     * to the old compare commit) and no longer count. Alongside the blocked
     * reasons the function returns the per-condition satisfaction list that
     * the merge confirmation area displays (satisfied and unsatisfied
     * conditions).
     */
    computePullRequestMergeEligibility(pullRequest) {
      const repository = this.findRepositoryById(pullRequest.repositoryId);
      const currentCompareCommitId =
        this.getPullRequestCurrentCompareCommit(pullRequest);
      const targetBranch =
        repository && pullRequest.baseBranch
          ? this.findBranchByRepositoryAndName(repository.id, pullRequest.baseBranch)
          : null;
      const blockedReasons = [];
      const conditions = [];
      if (pullRequest.status !== 'open') {
        blockedReasons.push('Pull request is not open.');
      }
      // REQ-6-5: merging requires no merge conflicts between the target
      // branch head and the current compare commit. A three-way merge over
      // the common ancestor detects conflicts; when a branch is missing the
      // PR cannot be merged.
      let conflict = true;
      if (
        targetBranch &&
        targetBranch.headCommitId &&
        currentCompareCommitId
      ) {
        const mergeBaseId = this.getMergeBase(
          repository.id,
          targetBranch.headCommitId,
          currentCompareCommitId
        );
        const mergeResult = this.computeMergeContent(
          repository.id,
          mergeBaseId,
          targetBranch.headCommitId,
          currentCompareCommitId
        );
        conflict = !mergeResult.ok;
      }
      if (conflict) {
        blockedReasons.push('This branch has conflicts that must be resolved.');
        conditions.push({ label: 'No merge conflicts', satisfied: false });
      } else {
        conditions.push({ label: 'No merge conflicts', satisfied: true });
      }
      const validReviews = currentCompareCommitId
        ? state.reviews.filter(
            (r) =>
              r.pullRequestId === pullRequest.id &&
              r.commitId === currentCompareCommitId
          )
        : [];
      const latestByReviewer = new Map();
      for (const review of validReviews) {
        if (
          review.decision !== 'comment' &&
          review.decision !== 'approve' &&
          review.decision !== 'request_changes'
        ) {
          continue;
        }
        const previous = latestByReviewer.get(review.reviewerId);
        if (!previous || review.createdAt >= previous.createdAt) {
          latestByReviewer.set(review.reviewerId, review);
        }
      }
      const decisions = [...latestByReviewer.values()];
      const hasRequestChanges = decisions.some(
        (d) => d.decision === 'request_changes'
      );
      if (hasRequestChanges) {
        blockedReasons.push('Requested changes must be resolved.');
        conditions.push({ label: 'Requested changes are resolved', satisfied: false });
      } else {
        conditions.push({ label: 'Requested changes are resolved', satisfied: true });
      }
      const rule =
        repository && pullRequest.baseBranch
          ? this.findBranchProtectionRule(repository.id, pullRequest.baseBranch)
          : null;
      if (rule && rule.requireApproval) {
        const hasNonAuthorApproval = decisions.some(
          (d) => d.decision === 'approve' && d.reviewerId !== pullRequest.authorId
        );
        if (!hasNonAuthorApproval) {
          // REQ-6-5: a missing required approval displays this exact text.
          blockedReasons.push('Review required by branch protection');
          conditions.push({
            label: 'At least 1 valid non-author approval',
            satisfied: false,
          });
        } else {
          conditions.push({
            label: 'At least 1 valid non-author approval',
            satisfied: true,
          });
        }
      }
      if (rule && rule.requireStatusCheck) {
        const run =
          currentCompareCommitId !== null
            ? this.findCheckRun(repository.id, currentCompareCommitId, 'test')
            : null;
        const checkSatisfied = !!run && run.status === 'success';
        if (!checkSatisfied) {
          blockedReasons.push('Required status check "test" is not successful.');
          conditions.push({
            label: 'Required status check "test" is successful',
            satisfied: false,
          });
        } else {
          conditions.push({
            label: 'Required status check "test" is successful',
            satisfied: true,
          });
        }
      }
      return {
        mergeable: pullRequest.status === 'open' && blockedReasons.length === 0,
        blockedReasons,
        conditions,
      };
    },
    /**
     * REQ-6-5: merges an eligible pull request into its base branch using
     * the sole supported “Create a merge commit” method. Before applying
     * anything the system rereads the target branch head, the current
     * compare commit, the merge-conflict state, and the protection rules:
     * the PR must be Open, there must be no valid Request changes decision,
     * an unprotected target has no approval-count or check-success
     * requirement (but still needs no conflicts and no valid Request
     * changes), and a protected target enforces each enabled rule
     * requirement independently (1 valid non-author Approve for the current
     * compare commit when approval is required — its exact unmet text is
     * `Review required by branch protection` — and `test` success when the
     * status check is required). Any unmet condition returns { ok: false,
     * reasons } and changes neither the target branch nor the PR. When every
     * condition holds, the method atomically creates a merge commit whose
     * parents are the target-branch head at merge time and the current
     * compare commit, writes the three-way merged snapshot, moves the
     * target-branch head to the merge commit, sets the PR to Merged, and
     * stores the merger, time, and resulting commit identifier (plus a
     * `merged` activity record). A failed write rolls every in-memory record
     * back and re-throws, leaving the branch and the PR unchanged. Merged is
     * terminal: a later merge attempt is rejected.
     */
    mergePullRequest(pullRequest, actorId) {
      const repository = this.findRepositoryById(pullRequest.repositoryId);
      const targetBranch =
        repository && pullRequest.baseBranch
          ? this.findBranchByRepositoryAndName(repository.id, pullRequest.baseBranch)
          : null;
      const compareBranch =
        repository && pullRequest.compareBranch
          ? this.findBranchByRepositoryAndName(repository.id, pullRequest.compareBranch)
          : null;
      const currentCompareCommitId =
        compareBranch && compareBranch.headCommitId
          ? compareBranch.headCommitId
          : null;
      const reasons = [];
      if (pullRequest.status !== 'open') {
        reasons.push('Pull request is not open.');
      }
      let mergedFiles = null;
      if (
        targetBranch &&
        targetBranch.headCommitId &&
        currentCompareCommitId
      ) {
        const mergeBaseId = this.getMergeBase(
          repository.id,
          targetBranch.headCommitId,
          currentCompareCommitId
        );
        const mergeResult = this.computeMergeContent(
          repository.id,
          mergeBaseId,
          targetBranch.headCommitId,
          currentCompareCommitId
        );
        if (!mergeResult.ok) {
          reasons.push('This branch has conflicts that must be resolved.');
        } else {
          mergedFiles = mergeResult.files;
        }
      } else {
        reasons.push('This branch has conflicts that must be resolved.');
      }
      const validReviews = currentCompareCommitId
        ? state.reviews.filter(
            (r) =>
              r.pullRequestId === pullRequest.id &&
              r.commitId === currentCompareCommitId
          )
        : [];
      const latestByReviewer = new Map();
      for (const review of validReviews) {
        if (
          review.decision !== 'comment' &&
          review.decision !== 'approve' &&
          review.decision !== 'request_changes'
        ) {
          continue;
        }
        const previous = latestByReviewer.get(review.reviewerId);
        if (!previous || review.createdAt >= previous.createdAt) {
          latestByReviewer.set(review.reviewerId, review);
        }
      }
      const decisions = [...latestByReviewer.values()];
      if (decisions.some((d) => d.decision === 'request_changes')) {
        reasons.push('Requested changes must be resolved.');
      }
      const rule =
        repository && pullRequest.baseBranch
          ? this.findBranchProtectionRule(repository.id, pullRequest.baseBranch)
          : null;
      if (rule && rule.requireApproval) {
        const hasNonAuthorApproval = decisions.some(
          (d) => d.decision === 'approve' && d.reviewerId !== pullRequest.authorId
        );
        if (!hasNonAuthorApproval) {
          reasons.push('Review required by branch protection');
        }
      }
      if (rule && rule.requireStatusCheck) {
        const run =
          currentCompareCommitId !== null
            ? this.findCheckRun(repository.id, currentCompareCommitId, 'test')
            : null;
        if (!run || run.status !== 'success') {
          reasons.push('Required status check "test" is not successful.');
        }
      }
      if (reasons.length > 0 || mergedFiles === null) {
        return { ok: false, reasons };
      }
      const now = new Date().toISOString();
      const mergeCommit = {
        id: crypto.randomUUID(),
        repositoryId: repository.id,
        message: `Merge pull request #${pullRequest.number} from ${pullRequest.compareBranch}`,
        authorId: actorId,
        parentCommitIds: [targetBranch.headCommitId, currentCompareCommitId],
        createdAt: now,
      };
      const mergeFiles = mergedFiles.map((file) => ({
        id: crypto.randomUUID(),
        commitId: mergeCommit.id,
        path: file.path,
        content: file.content,
      }));
      const prevCommits = state.commits;
      const prevCommitFiles = state.commitFiles;
      const prevActivity = state.pullRequestActivity;
      const prevHeadCommitId = targetBranch.headCommitId;
      const prevPullState = { ...pullRequest };
      const prevRepository = repository ? { ...repository } : null;
      state.commits.push(mergeCommit);
      state.commitFiles.push(...mergeFiles);
      state.pullRequestActivity.push({
        id: crypto.randomUUID(),
        pullRequestId: pullRequest.id,
        type: 'merged',
        actorId,
        createdAt: now,
        body: mergeCommit.id,
      });
      targetBranch.headCommitId = mergeCommit.id;
      pullRequest.status = 'merged';
      pullRequest.updatedAt = now;
      pullRequest.mergedById = actorId;
      pullRequest.mergedAt = now;
      pullRequest.mergeCommitId = mergeCommit.id;
      if (repository) {
        repository.updatedAt = now;
      }
      try {
        persist();
      } catch (err) {
        state.commits = prevCommits;
        state.commitFiles = prevCommitFiles;
        state.pullRequestActivity = prevActivity;
        targetBranch.headCommitId = prevHeadCommitId;
        pullRequest.status = prevPullState.status;
        pullRequest.updatedAt = prevPullState.updatedAt;
        pullRequest.mergedById = prevPullState.mergedById;
        pullRequest.mergedAt = prevPullState.mergedAt;
        pullRequest.mergeCommitId = prevPullState.mergeCommitId;
        if (repository && prevRepository) {
          repository.updatedAt = prevRepository.updatedAt;
        }
        throw err;
      }
      return {
        ok: true,
        pullRequest: this.findPullRequestByNumber(repository.id, pullRequest.number),
        mergeCommitId: mergeCommit.id,
      };
    },

    /**
     * REQ-4-4: marks a branch of a repository as protected (or not) in one
     * atomic write. Used by the protected-branch rejection path of the web
     * file editor; the management UI is out of scope for this packet.
     */
    setBranchProtected(repositoryId, branchName, isProtected) {
      const prevProtectedBranches = state.protectedBranches;
      if (isProtected) {
        if (!this.isBranchProtected(repositoryId, branchName)) {
          state.protectedBranches.push({
            repositoryId,
            name: branchName,
            createdAt: new Date().toISOString(),
          });
        }
      } else {
        state.protectedBranches = state.protectedBranches.filter(
          (p) => !(p.repositoryId === repositoryId && p.name === branchName)
        );
      }
      try {
        persist();
      } catch (err) {
        state.protectedBranches = prevProtectedBranches;
        throw err;
      }
      return true;
    },
    /**
     * REQ-4-4: creates a commit that writes one file at a path on a branch
     * and moves the branch head to the new commit in a single atomic write.
     * The commit records the parent (the previous branch head), author,
     * message, and time, and stores the full new snapshot (the previous
     * snapshot plus the written file), so historical content is never
     * rewritten. Returns the created commit, or null when the branch does
     * not exist (the caller validates the path, message, role, and branch
     * protection beforehand); a failed write rolls every in-memory record
     * back and re-throws.
     */
    createFileCommit(repositoryId, branchName, path, content, message, authorId) {
      const branch = this.findBranchByRepositoryAndName(repositoryId, branchName);
      if (!branch || !branch.headCommitId) {
        return null;
      }
      const now = new Date().toISOString();
      const commit = {
        id: crypto.randomUUID(),
        repositoryId,
        message,
        authorId,
        parentCommitIds: [branch.headCommitId],
        createdAt: now,
      };
      const prevCommits = state.commits;
      const prevCommitFiles = state.commitFiles;
      const prevHeadCommitId = branch.headCommitId;
      state.commits.push(commit);
      for (const file of state.commitFiles.filter(
        (f) => f.commitId === prevHeadCommitId
      )) {
        state.commitFiles.push({
          id: crypto.randomUUID(),
          commitId: commit.id,
          path: file.path,
          content: file.content,
        });
      }
      state.commitFiles.push({
        id: crypto.randomUUID(),
        commitId: commit.id,
        path,
        content,
      });
      branch.headCommitId = commit.id;
      const repository = this.findRepositoryById(repositoryId);
      if (repository) {
        repository.updatedAt = now;
      }
      try {
        persist();
      } catch (err) {
        state.commits = prevCommits;
        state.commitFiles = prevCommitFiles;
        branch.headCommitId = prevHeadCommitId;
        throw err;
      }
      return commit;
    },
    getFilesAtCommit(commitId) {
      return state.commitFiles.filter((f) => f.commitId === commitId);
    },
    /**
     * REQ-4-2-2: the line-by-line diff between two commits of a repository
     * (baseCommitId may be null for an empty base, e.g. the root commit's
     * parent). Only files whose content differs between the two snapshots are
     * returned (unchanged files never appear); each changed file carries its
     * compare-side content, the exact numbers of added and deleted lines, and
     * the ordered diff lines. Totals aggregate the per-file numbers. Files
     * are sorted by path so the list is deterministic across reloads.
     */
    getCommitDiff(repositoryId, baseCommitId, compareCommitId) {
      const baseFiles = baseCommitId
        ? state.commitFiles.filter((f) => f.commitId === baseCommitId)
        : [];
      const compareFiles = state.commitFiles.filter(
        (f) => f.commitId === compareCommitId
      );
      const byPath = new Map();
      for (const file of compareFiles) {
        byPath.set(file.path, { compare: file });
      }
      for (const file of baseFiles) {
        const entry = byPath.get(file.path);
        if (!entry) {
          byPath.set(file.path, { base: file });
        } else {
          entry.base = file;
        }
      }
      const files = [];
      let additions = 0;
      let deletions = 0;
      for (const [path, entry] of byPath) {
        const baseContent = entry.base ? entry.base.content : null;
        const compareContent = entry.compare ? entry.compare.content : null;
        if (baseContent === compareContent) {
          continue;
        }
        const { lines, additions: add, deletions: del } = diffContent(
          baseContent,
          compareContent
        );
        files.push({
          path,
          content: compareContent,
          additions: add,
          deletions: del,
          lines,
        });
        additions += add;
        deletions += del;
      }
      files.sort((a, b) => a.path.localeCompare(b.path));
      return { files, additions, deletions };
    },
    /**
     * Files reachable at the head of a branch, or { branch: null, files: [] }
     * when the branch (or an initial commit) does not exist yet.
     */
    getFilesForBranch(repositoryId, branchName) {
      const branch = this.findBranchByRepositoryAndName(repositoryId, branchName);
      if (!branch || !branch.headCommitId) {
        return { branch: null, files: [] };
      }
      return { branch, files: this.getFilesAtCommit(branch.headCommitId) };
    },
    getRepositoryFile(repositoryId, branchName, path) {
      const { branch, files } = this.getFilesForBranch(repositoryId, branchName);
      if (!branch) {
        return null;
      }
      return files.find((f) => f.path === path) || null;
    },
    /**
     * REQ-4-2-3: the language of a file path derived from its extension.
     * Unknown extensions map to "Text" so every file belongs to a language
     * option on the code-search page.
     */
    languageOfPath(filePath) {
      const ext = path.extname(String(filePath)).toLowerCase();
      return LANGUAGE_BY_EXTENSION[ext] || 'Text';
    },
    /**
     * REQ-4-2-3: the distinct languages of the files at the head of a branch
     * (sorted), used to populate the language filter of the code-search page.
     */
    languagesForBranch(repositoryId, branchName) {
      const { branch, files } = this.getFilesForBranch(repositoryId, branchName);
      if (!branch) {
        return [];
      }
      const languages = new Set(files.map((f) => this.languageOfPath(f.path)));
      return [...languages].sort();
    },
    /**
     * REQ-4-2-3: repository-scoped code search over the head snapshot of one
     * branch (the default branch is used by the code-search page). The
     * trimmed query must occur in the file content (case-insensitive); an
     * optional path prefix restricts results to files under that directory
     * and an optional language restricts results by file extension. Each hit
     * carries the exact file name (the result link's accessible name), the
     * full path, the 1-based line number of the first matching line, that
     * line as the snippet, and the branch name for context. Results are
     * sorted by path so the page is deterministic across reloads. The search
     * is read-only: it never creates commits or modifies files.
     */
    searchCode(repositoryId, branchName, query, pathFilter, language) {
      const q = String(query || '').trim();
      if (q === '') {
        return { branch: null, results: [] };
      }
      const { branch, files } = this.getFilesForBranch(repositoryId, branchName);
      if (!branch) {
        return { branch: null, results: [] };
      }
      const pf = String(pathFilter || '').trim().replace(/\/+$/, '');
      const lowerQ = q.toLowerCase();
      const results = [];
      for (const file of files) {
        if (pf !== '' && file.path !== pf && !file.path.startsWith(`${pf}/`)) {
          continue;
        }
        if (language && this.languageOfPath(file.path) !== language) {
          continue;
        }
        const lines = String(file.content || '').split('\n');
        let matchLine = -1;
        for (let i = 0; i < lines.length; i += 1) {
          if (lines[i].toLowerCase().includes(lowerQ)) {
            matchLine = i;
            break;
          }
        }
        if (matchLine === -1) {
          continue;
        }
        const name = file.path.split('/').pop();
        results.push({
          path: file.path,
          name,
          line: matchLine + 1,
          snippet: lines[matchLine],
          branch: branch.name,
        });
      }
      results.sort((a, b) => a.path.localeCompare(b.path));
      return { branch, results };
    },
    /**
     * REQ-4-1: files and directories directly inside dirPath at the head of a
     * branch (dirPath '' is the branch root). Each entry carries its exact
     * name (the last path segment) and type ('directory' | 'file') so pages
     * can render links whose accessible names are the entry names, together
     * with the full path for the href. Directories sort before files, each
     * group by name, so the listing is deterministic across reloads.
     */
    getDirectoryEntries(repositoryId, branchName, dirPath) {
      const { branch, files } = this.getFilesForBranch(repositoryId, branchName);
      if (!branch) {
        return { branch: null, entries: [] };
      }
      const prefix = dirPath === '' ? '' : `${dirPath}/`;
      const entries = new Map();
      for (const file of files) {
        if (dirPath !== '' && !file.path.startsWith(prefix)) {
          continue;
        }
        const remainder = dirPath === '' ? file.path : file.path.slice(prefix.length);
        const slash = remainder.indexOf('/');
        const name = slash === -1 ? remainder : remainder.slice(0, slash);
        if (!entries.has(name)) {
          entries.set(name, {
            name,
            type: slash === -1 ? 'file' : 'directory',
            path: dirPath === '' ? name : `${dirPath}/${name}`,
          });
        }
      }
      const list = [...entries.values()].sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      return { branch, entries: list };
    },
    /**
     * REQ-4-1: the most recent commit (newest first in the branch history)
     * whose snapshot contains the given file path, or null when the file is
     * not present in the branch. The file page displays this commit.
     */
    getMostRecentFileCommit(repositoryId, branchName, path) {
      const history = this.getCommitHistory(repositoryId, branchName);
      for (const commit of history) {
        if (state.commitFiles.some((f) => f.commitId === commit.id && f.path === path)) {
          return commit;
        }
      }
      return null;
    },
    /**
     * Commit history of a branch, newest first, walking parent links from the
     * branch head (single-parent walk; the initial commit has no parents).
     */
    getCommitHistory(repositoryId, branchName) {
      const branch = this.findBranchByRepositoryAndName(repositoryId, branchName);
      if (!branch || !branch.headCommitId) {
        return [];
      }
      const commits = [];
      const seen = new Set();
      let currentId = branch.headCommitId;
      while (currentId && !seen.has(currentId)) {
        seen.add(currentId);
        const commit = state.commits.find((c) => c.id === currentId);
        if (!commit) {
          break;
        }
        commits.push(commit);
        currentId =
          commit.parentCommitIds && commit.parentCommitIds.length > 0
            ? commit.parentCommitIds[0]
            : null;
      }
      return commits;
    },
    /**
     * REQ-3-1: global repository search. Returns every repository the account
     * is authorized to view whose name (or full "owner/name" address) contains
     * the trimmed, case-insensitive query. Visitors pass accountId=null and
     * only see public repositories; signed-in accounts see exactly the same
     * set that their repository lists and direct links would expose. An empty
     * query yields no results. Results are sorted by name then owner so the
     * page is deterministic across reloads.
     */
    searchRepositories(query, accountId) {
      const q = String(query || '').trim().toLowerCase();
      if (q === '') {
        return [];
      }
      const results = [];
      for (const repository of state.repositories) {
        if (this.effectiveRepositoryRole(repository.id, accountId) === null) {
          continue;
        }
        const owner =
          repository.ownerType === 'organization'
            ? (this.findOrganizationById(repository.ownerId) || {}).name
            : (this.findAccountById(repository.ownerId) || {}).username;
        if (!owner) {
          continue;
        }
        const name = repository.name.toLowerCase();
        const full = `${owner}/${repository.name}`.toLowerCase();
        if (!name.includes(q) && !full.includes(q)) {
          continue;
        }
        results.push({ ...repository, owner });
      }
      results.sort((a, b) => {
        if (a.name !== b.name) {
          return a.name.localeCompare(b.name);
        }
        return a.owner.localeCompare(b.owner);
      });
      return results;
    },
    getOrganizationsForAccount(accountId) {
      return state.organizationMembers
        .filter((m) => m.accountId === accountId)
        .map((m) => this.findOrganizationById(m.organizationId))
        .filter(Boolean);
    },
    getAccountRoleInOrganization(organizationId, accountId) {
      const membership = state.organizationMembers.find(
        (m) => m.organizationId === organizationId && m.accountId === accountId
      );
      return membership ? membership.role : null;
    },
    /**
     * REQ-2-1-2: creates an organization and records the creating account as
     * its initial owner (an owner is also a member). The display name is
     * trimmed before storage. All records are persisted in one atomic write;
     * if the write fails, the in-memory state is rolled back and the error is
     * re-thrown so no organization is created.
     */
    createOrganization({ name, displayName, creatorId }) {
      const now = new Date().toISOString();
      const organization = {
        id: crypto.randomUUID(),
        name,
        displayName: String(displayName).trim(),
        createdAt: now,
      };
      const membership = {
        organizationId: organization.id,
        accountId: creatorId,
        role: 'owner',
        createdAt: now,
      };
      state.organizations.push(organization);
      state.organizationMembers.push(membership);
      try {
        persist();
      } catch (err) {
        state.organizations = state.organizations.filter(
          (o) => o.id !== organization.id
        );
        state.organizationMembers = state.organizationMembers.filter(
          (m) => m.organizationId !== organization.id
        );
        throw err;
      }
      return organization;
    },
  };
}

module.exports = { createStore };
