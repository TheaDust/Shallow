// Organization, team, repository-access domain: organizations, memberships,
// teams, direct team memberships, repositories and direct role grants.

import { diffLines } from "../lib/diff.mjs";

export const ROLE_OPTIONS = ["read", "triage", "write", "maintain", "admin"];
export const ROLE_LABELS = {
  read: "Read",
  triage: "Triage",
  write: "Write",
  maintain: "Maintain",
  admin: "Admin",
};

const ROLE_RANK = { read: 1, triage: 2, write: 3, maintain: 4, admin: 5 };

const REPO_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function isValidRepositoryName(name) {
  return (
    typeof name === "string" &&
    name.length >= 1 &&
    name.length <= 100 &&
    REPO_NAME_PATTERN.test(name)
  );
}

export function isValidOrganizationName(name) {
  return (
    typeof name === "string" &&
    name.length >= 1 &&
    name.length <= 39 &&
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)
  );
}

export function isValidTeamName(name) {
  return (
    typeof name === "string" &&
    name.length >= 1 &&
    name.length <= 50 &&
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)
  );
}

function normalizeDisplayName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function serializeTeam(state, team) {
  const parent = team.parentId ? state.teams[team.parentId] : null;
  return {
    id: team.id,
    orgId: team.orgId,
    name: team.name,
    description: team.description ?? "",
    parentId: team.parentId ?? null,
    parentName: parent ? parent.name : null,
    createdBy: team.createdBy,
    createdAt: team.createdAt,
  };
}

// Effective repository role of an account: Admin from organization Owner status,
// plus all still-valid direct grants and direct team grants (highest wins).
export function effectiveRole(state, repo, accountId) {
  if (!accountId) return null;
  if (repo.ownerType === "user") {
    // The owner of a personal repository is its Admin; a seeded direct member
    // grant can give a collaborator the granted role on that repository.
    if (repo.ownerId === accountId) return "admin";
    const direct = state.grants?.[`${repo.id}:member:${accountId}`];
    return direct && ROLE_RANK[direct.role] ? direct.role : null;
  }
  if (repo.ownerType !== "organization") return null;
  let rank = 0;
  const membership = state.memberships?.[`${repo.ownerId}:${accountId}`];
  if (membership?.role === "owner") rank = Math.max(rank, ROLE_RANK.admin);
  const direct = state.grants?.[`${repo.id}:member:${accountId}`];
  if (direct) rank = Math.max(rank, ROLE_RANK[direct.role] ?? 0);
  for (const membershipRecord of Object.values(state.teamMembers ?? {})) {
    if (membershipRecord.accountId !== accountId || membershipRecord.orgId !== repo.ownerId) {
      continue;
    }
    const teamGrant = state.grants?.[`${repo.id}:team:${membershipRecord.teamId}`];
    if (teamGrant) rank = Math.max(rank, ROLE_RANK[teamGrant.role] ?? 0);
  }
  return rank ? ROLE_OPTIONS.find((role) => ROLE_RANK[role] === rank) : null;
}

function isOrganizationOwner(state, orgId, accountId) {
  return state.memberships?.[`${orgId}:${accountId}`]?.role === "owner";
}

// Reconstruct the file snapshot (path -> content) at a commit by walking the
// parent chain and applying each change record's old/new content. Snapshots
// are derived, never stored separately.
export function snapshotAt(git, commitId, cache = new Map()) {
  if (cache.has(commitId)) return cache.get(commitId);
  const commit = git?.commits?.[commitId];
  if (!commit) return null;
  const parent = commit.parentId ? snapshotAt(git, commit.parentId, cache) : {};
  const snapshot = { ...(parent ?? {}) };
  for (const change of commit.changes ?? []) {
    if (change.newContent === null || change.newContent === undefined) {
      delete snapshot[change.path];
    } else {
      snapshot[change.path] = change.newContent;
    }
  }
  cache.set(commitId, snapshot);
  return snapshot;
}

function countCommitsOnBranch(git, branch) {
  if (!git?.branches?.[branch]) return 0;
  let count = 0;
  let current = git.branches[branch];
  while (current && git.commits?.[current]) {
    count += 1;
    current = git.commits[current].parentId;
  }
  return count;
}

function shortId(id) {
  return typeof id === "string" && id.length > 7 ? id.slice(0, 7) : id;
}

// Resolve a revision reference (branch name or commit id) to a commit id in a
// repository's git records.
export function resolveRevision(git, reference) {
  if (!reference) return null;
  if (git?.commits?.[reference]) return reference;
  if (git?.branches?.[reference]) return git.branches[reference];
  return null;
}

function serializeCommitRecord(commit) {
  if (!commit) return null;
  return {
    id: commit.id,
    shortId: shortId(commit.id),
    message: commit.message,
    author: commit.author,
    createdAt: commit.createdAt,
    parentId: commit.parentId ?? null,
    changes: (commit.changes ?? []).map((change) => ({
      path: change.path,
      additions: change.additions,
      deletions: change.deletions,
    })),
  };
}

// Walk the parent chain from a start commit, newest first, optionally filtered
// to commits that changed a given path.
function commitHistory(git, startCommitId, path) {
  const commits = [];
  let current = startCommitId;
  while (current && git.commits?.[current]) {
    const commit = git.commits[current];
    if (!path || (commit.changes ?? []).some((change) => change.path === path)) {
      commits.push(serializeCommitRecord(commit));
    }
    current = commit.parentId;
  }
  return commits;
}

// Line diff between the snapshots of two commits. Only paths whose content
// differs appear; each entry carries the annotated lines and counts.
export function snapshotDiff(baseSnapshot, compareSnapshot) {
  const paths = new Set([
    ...Object.keys(baseSnapshot ?? {}),
    ...Object.keys(compareSnapshot ?? {}),
  ]);
  const files = [];
  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const path of [...paths].sort()) {
    const oldContent = baseSnapshot?.[path] ?? "";
    const newContent = compareSnapshot?.[path] ?? "";
    if (oldContent === newContent) continue;
    const result = diffLines(oldContent, newContent);
    files.push({ path, additions: result.additions, deletions: result.deletions, lines: result.lines });
    totalAdditions += result.additions;
    totalDeletions += result.deletions;
  }
  return { files, totalAdditions, totalDeletions };
}

// Effective roles that may create commits on a repository.
function canWriteGit(state, repo, accountId) {
  if (!accountId) return false;
  const role = effectiveRole(state, repo, accountId);
  return role === "write" || role === "maintain" || role === "admin";
}

// Branch-name rule: 1-255 chars, ASCII letters/digits and `- _ . /`, must not
// end with `/` or `.` and must not contain consecutive `..` or `//`.
function isValidBranchName(branchName) {
  if (typeof branchName !== "string") return false;
  if (branchName.length < 1 || branchName.length > 255) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(branchName)) return false;
  if (branchName.endsWith("/") || branchName.endsWith(".")) return false;
  if (branchName.includes("..") || branchName.includes("//")) return false;
  return true;
}

// Build the per-branch file records (path -> { content, commitId }) for the
// snapshot of a commit, used when a branch is created from a commit id.
function snapshotRecordsForCommit(git, commitId) {
  const snapshot = snapshotAt(git, commitId) ?? {};
  const history = [];
  let current = commitId;
  while (current && git.commits?.[current]) {
    history.push(current);
    current = git.commits[current].parentId;
  }
  const records = {};
  for (const path of Object.keys(snapshot)) {
    const touchedBy = history.find((cid) =>
      (git.commits[cid].changes ?? []).some((change) => change.path === path),
    );
    records[path] = { content: snapshot[path], commitId: touchedBy ?? history[0] ?? null };
  }
  return records;
}


export function repositoryAccessible(state, repo, accountId) {
  return repo.visibility === "public" || Boolean(effectiveRole(state, repo, accountId));
}

// Serialize a repository for API responses, including the default-branch root
// file list and the source repository link for forks.
function serializeRepository(state, repo) {
  const source = repo.forkSourceId ? state.repositories?.[repo.forkSourceId] : null;
  const git = state.git?.[repo.id];
  const snapshot = git?.files?.[repo.defaultBranch] ?? {};
  const names = new Set();
  for (const key of Object.keys(snapshot)) {
    const first = key.split("/")[0];
    if (first) names.add(first);
  }
  const files = [...names]
    .sort()
    .map((name) => ({ name, path: name, type: snapshot[name] !== undefined ? "file" : "dir" }));
  return {
    owner: repo.ownerId,
    name: repo.name,
    description: repo.description ?? "",
    visibility: repo.visibility,
    defaultBranch: repo.defaultBranch,
    updatedAt: repo.updatedAt,
    files,
    forkSource: source ? { owner: source.ownerId, name: source.name } : null,
  };
}

// Look up an existing account by username or verified email (case-insensitive).
function findAccountByIdentifier(state, identifier) {
  if (!identifier) return null;
  const byUsername = state.accounts?.[identifier];
  if (byUsername) return byUsername;
  return Object.values(state.accounts ?? {}).find(
    (account) =>
      account.emailVerified === true &&
      account.email.toLowerCase() === identifier.toLowerCase(),
  );
}

function wouldCreateCycle(state, teamId, newParentId) {
  let current = newParentId;
  while (current) {
    if (current === teamId) return true;
    const parent = state.teams?.[current];
    if (!parent) return false;
    current = parent.parentId ?? null;
  }
  return false;
}

export function createOrganizationsDomain(store) {
  async function seedIfEmpty() {
    await store.update(async (state) => {
      if (state.organizations && Object.keys(state.organizations).length > 0) return;
      state.organizations = state.organizations ?? {};
      state.memberships = state.memberships ?? {};
      state.teams = state.teams ?? {};
      state.teamMembers = state.teamMembers ?? {};
      state.repositories = state.repositories ?? {};
      state.grants = state.grants ?? {};
      state.git = state.git ?? {};

      const now = new Date().toISOString();
      const orgId = "acme-demo";
      state.organizations[orgId] = { id: orgId, displayName: "Acme Demo", createdAt: now };

      state.memberships[`${orgId}:alice-dev`] = {
        orgId,
        accountId: "alice-dev",
        role: "owner",
        createdAt: now,
      };
      state.memberships[`${orgId}:bob-reviewer`] = {
        orgId,
        accountId: "bob-reviewer",
        role: "member",
        createdAt: now,
      };

      const orgRepos = [
        { name: "acme-docs", description: "Acme documentation", visibility: "public" },
        { name: "acme-private", description: "Internal Acme repository", visibility: "private" },
        { name: "acme-internal", description: "Engineering notes and specs", visibility: "private" },
      ];
      for (const repo of orgRepos) {
        const id = `${orgId}:${repo.name}`;
        state.repositories[id] = {
          id,
          ownerType: "organization",
          ownerId: orgId,
          name: repo.name,
          description: repo.description,
          visibility: repo.visibility,
          defaultBranch: "main",
          createdAt: now,
          updatedAt: now,
        };
      }

      // REQ-3 seeds: the public repository and the private repository used by
      // the visibility-change scenario are personal repositories owned by the
      // seeded account alice-dev.
      const personalRepos = [
        { name: "acme-docs", description: "Acme documentation", visibility: "public" },
        { name: "secret-research", description: "Research notes and experiments", visibility: "private" },
      ];
      for (const repo of personalRepos) {
        const id = `alice-dev:${repo.name}`;
        state.repositories[id] = {
          id,
          ownerType: "user",
          ownerId: "alice-dev",
          name: repo.name,
          description: repo.description,
          visibility: repo.visibility,
          defaultBranch: "main",
          createdAt: now,
          updatedAt: now,
        };
      }

      // Distinct non-Admin collaborator on the private personal repository used
      // by the visibility-change scenario (a direct Read grant).
      const personalResearchId = "alice-dev:secret-research";
      const researchGrantKey = `${personalResearchId}:member:bob-reviewer`;
      state.grants[researchGrantKey] = {
        id: researchGrantKey,
        orgId: null,
        repoId: personalResearchId,
        subjectType: "member",
        subjectId: "bob-reviewer",
        role: "read",
        grantedBy: "alice-dev",
        createdAt: now,
      };

      // REQ-6 collaboration seeds: bob-reviewer is a distinct non-author
      // collaborator with Write on both public `acme-docs` repositories, so the
      // pull-request scenarios can request him as a reviewer (REQ-6-4) while he
      // stays outside the Maintain/Admin/owner roles for close/reopen and
      // branch-protection checks (REQ-6-6, REQ-6-1).
      for (const docsRepoId of [`${orgId}:acme-docs`, "alice-dev:acme-docs"]) {
        const docsGrantKey = `${docsRepoId}:member:bob-reviewer`;
        state.grants[docsGrantKey] = {
          id: docsGrantKey,
          orgId: docsRepoId.startsWith(orgId) ? orgId : null,
          repoId: docsRepoId,
          subjectType: "member",
          subjectId: "bob-reviewer",
          role: "write",
          grantedBy: "alice-dev",
          createdAt: now,
        };
      }

      // Fork conflict seed: an existing repository in the personal namespace of
      // the signed-in user (alice-dev).
      const forkConflictId = "alice-dev:acme-docs-fork";
      state.repositories[forkConflictId] = {
        id: forkConflictId,
        ownerType: "user",
        ownerId: "alice-dev",
        name: "acme-docs-fork",
        description: "Fork of acme-docs",
        visibility: "private",
        defaultBranch: "main",
        createdAt: now,
        updatedAt: now,
      };

      // Default-branch file snapshots, branches and commits used by repository
      // overview, code browsing, history, diff, code-search and file-edit
      // scenarios. The public `acme-docs` exists both as the organization
      // repository (REQ-2-1-1) and as alice-dev's personal repository (REQ-3
      // seeds); each repository keeps its own independent git records. Each
      // change record carries the previous and new content so snapshots and
      // line diffs can be reconstructed for every revision. `docs/guide.md`
      // is intentionally not pre-seeded: REQ-4-4 creates it through the web
      // editor; the nested directory + text file used for read-only browsing
      // is `src/search.ts`.
      const docsContent = "# Acme Documentation\n\nThis repository documents the search flow.\n";
      const docsOldContent = "# Acme Documentation\n\nThis repository documents the product.\n";
      const searchContent =
        "export function search(query: string): string[] {\n  return [];\n}\n";
      // The compare branch modifies the seeded changed-file path for the PR
      // comparison flow (REQ-6-2-2: `src/search.ts`) while keeping `main`
      // unchanged, so the comparison shows exactly one added file
      // (`main-only.md`) and one modified file (`src/search.ts`).
      const updatedSearchContent =
        "export function search(query: string): string[] {\n  return query ? [\"result\"] : [];\n}\n";
      const mainOnlyContent = "This file only exists on the feature-search branch.\n";
      // The release branch drives the seeded Open PR diff (REQ-6-3-2): the
      // same known path `src/search.ts` modified plus one added file, so the
      // public PR shows the verbatim path and aggregate line statistics
      // (3 additions, 1 deletions).
      const releaseSearchContent =
        "export function search(query: string): string[] {\n  return query ? [\"release result\"] : [];\n}\n";
      const releaseNotesContent = "## Release notes\nUpcoming release improvements.\n";
      // Extra seeded branches behind the Draft PR (REQ-6-2-4 `draft-feature`)
      // and the separate Open PR for the pending-comment scenario (REQ-6-3-3).
      const draftOnboardingContent = "Draft onboarding notes.\n";
      const paginationContent = "export function paginate(page: number): number[] {\n  return [];\n}\n";
      // Branches for the REQ-6-5 merge scenarios: `merge-ready` carries the
      // eligible PR's changes (a new file only, so the three-way merge with
      // `main` is clean) and `merge-blocked` carries the blocked PR's changes.
      const mergeReadyContent = "## Onboarding final\nFinal onboarding improvements.\n";
      const mergeBlockedContent = "## Blocked change\nThis change still needs a review.\n";
      const t1 = new Date(Date.now() - 3 * 86400000).toISOString();
      const t2 = new Date(Date.now() - 2 * 86400000).toISOString();
      const t3 = new Date(Date.now() - 86400000).toISOString();
      const t4 = new Date(Date.now() - 12 * 3600000).toISOString();
      const t5 = new Date(Date.now() - 6 * 3600000).toISOString();
      const t6 = new Date(Date.now() - 3 * 3600000).toISOString();
      const t7 = new Date(Date.now() - 2 * 3600000).toISOString();
      const t8 = new Date(Date.now() - 3600000).toISOString();
      const acmeDocsGit = {
        branches: {
          main: "c2",
          "feature-search": "c3",
          release: "c4",
          "draft-feature": "c5",
          "search-pagination": "c6",
          "merge-ready": "c7",
          "merge-blocked": "c8",
        },
        commits: {
          c1: {
            id: "c1",
            message: "Initial commit",
            author: "alice-dev",
            createdAt: t1,
            parentId: null,
            changes: [
              {
                path: "README.md",
                additions: 3,
                deletions: 0,
                oldContent: null,
                newContent: docsOldContent,
              },
            ],
          },
          c2: {
            id: "c2",
            message: "Document search flow",
            author: "alice-dev",
            createdAt: t2,
            parentId: "c1",
            changes: [
              {
                path: "README.md",
                additions: 1,
                deletions: 1,
                oldContent: docsOldContent,
                newContent: docsContent,
              },
              {
                path: "src/search.ts",
                additions: 3,
                deletions: 0,
                oldContent: null,
                newContent: searchContent,
              },
            ],
          },
          c3: {
            id: "c3",
            message: "Add main-only file",
            author: "alice-dev",
            createdAt: t3,
            parentId: "c2",
            changes: [
              {
                path: "main-only.md",
                additions: 1,
                deletions: 0,
                oldContent: null,
                newContent: mainOnlyContent,
              },
              {
                path: "src/search.ts",
                additions: 1,
                deletions: 1,
                oldContent: searchContent,
                newContent: updatedSearchContent,
              },
            ],
          },
          c4: {
            id: "c4",
            message: "Prepare release",
            author: "alice-dev",
            createdAt: t4,
            parentId: "c2",
            changes: [
              {
                path: "src/search.ts",
                additions: 1,
                deletions: 1,
                oldContent: searchContent,
                newContent: releaseSearchContent,
              },
              {
                path: "release-notes.md",
                additions: 2,
                deletions: 0,
                oldContent: null,
                newContent: releaseNotesContent,
              },
            ],
          },
          c5: {
            id: "c5",
            message: "Draft onboarding changes",
            author: "alice-dev",
            createdAt: t5,
            parentId: "c2",
            changes: [
              {
                path: "onboarding-draft.md",
                additions: 1,
                deletions: 0,
                oldContent: null,
                newContent: draftOnboardingContent,
              },
            ],
          },
          c6: {
            id: "c6",
            message: "Add search pagination",
            author: "carol-dev",
            createdAt: t6,
            parentId: "c2",
            changes: [
              {
                path: "pagination.ts",
                additions: 2,
                deletions: 0,
                oldContent: null,
                newContent: paginationContent,
              },
            ],
          },
          c7: {
            id: "c7",
            message: "Finalize onboarding changes",
            author: "alice-dev",
            createdAt: t7,
            parentId: "c2",
            changes: [
              {
                path: "onboarding-final.md",
                additions: 1,
                deletions: 0,
                oldContent: null,
                newContent: mergeReadyContent,
              },
            ],
          },
          c8: {
            id: "c8",
            message: "Add blocked change",
            author: "alice-dev",
            createdAt: t8,
            parentId: "c2",
            changes: [
              {
                path: "blocked-change.md",
                additions: 1,
                deletions: 0,
                oldContent: null,
                newContent: mergeBlockedContent,
              },
            ],
          },
        },
        files: {
          main: {
            "README.md": { content: docsContent, commitId: "c2" },
            "src/search.ts": { content: searchContent, commitId: "c2" },
          },
          "feature-search": {
            "README.md": { content: docsContent, commitId: "c2" },
            "src/search.ts": { content: updatedSearchContent, commitId: "c3" },
            "main-only.md": { content: mainOnlyContent, commitId: "c3" },
          },
          release: {
            "README.md": { content: docsContent, commitId: "c2" },
            "src/search.ts": { content: releaseSearchContent, commitId: "c4" },
            "release-notes.md": { content: releaseNotesContent, commitId: "c4" },
          },
          "draft-feature": {
            "README.md": { content: docsContent, commitId: "c2" },
            "src/search.ts": { content: searchContent, commitId: "c2" },
            "onboarding-draft.md": { content: draftOnboardingContent, commitId: "c5" },
          },
          "search-pagination": {
            "README.md": { content: docsContent, commitId: "c2" },
            "src/search.ts": { content: searchContent, commitId: "c2" },
            "pagination.ts": { content: paginationContent, commitId: "c6" },
          },
          "merge-ready": {
            "README.md": { content: docsContent, commitId: "c2" },
            "src/search.ts": { content: searchContent, commitId: "c2" },
            "onboarding-final.md": { content: mergeReadyContent, commitId: "c7" },
          },
          "merge-blocked": {
            "README.md": { content: docsContent, commitId: "c2" },
            "src/search.ts": { content: searchContent, commitId: "c2" },
            "blocked-change.md": { content: mergeBlockedContent, commitId: "c8" },
          },
        },
        // REQ-6-5 seed: `main` is protected from the start (Require 1
        // approval + Require status check test) so the eligible merge PR has
        // its stated preconditions and the blocked PR shows the unmet approval
        // condition with “Review required by branch protection”.
        protectedBranches: {
          main: {
            branch: "main",
            requireApproval: true,
            requireCheck: true,
            createdBy: "alice-dev",
            createdAt: t2,
            updatedAt: t2,
          },
        },
      };
      state.git[`${orgId}:acme-docs`] = structuredClone(acmeDocsGit);
      state.git["alice-dev:acme-docs"] = structuredClone(acmeDocsGit);
      state.git[personalResearchId] = {
        branches: { main: "r1" },
        commits: {
          r1: {
            id: "r1",
            message: "Initial commit",
            author: "alice-dev",
            createdAt: t1,
            parentId: null,
            changes: [
              { path: "README.md", additions: 1, deletions: 0 },
              { path: "docs/notes.md", additions: 1, deletions: 0 },
            ],
          },
        },
        files: {
          main: {
            "README.md": {
              content: "# Research\n\nPrivate research notes ready to share.\n",
              commitId: "r1",
            },
            "docs/notes.md": { content: "Notes and experiments.\n", commitId: "r1" },
          },
        },
      };
      state.git[forkConflictId] = {
        branches: { main: "f1" },
        commits: {
          f1: {
            id: "f1",
            message: "Initial commit",
            author: "alice-dev",
            createdAt: t1,
            parentId: null,
            changes: [{ path: "README.md", additions: 1, deletions: 0 }],
          },
        },
        files: { main: { "README.md": { content: "# acme-docs-fork\n\nFork of acme-docs.\n", commitId: "f1" } } },
      };

      const teamSeeds = [
        { name: "platform-team", parentId: null },
        { name: "frontend-team", parentId: `${orgId}:platform-team` },
        { name: "frontend-child", parentId: `${orgId}:frontend-team` },
        { name: "backend-team", parentId: null },
      ];
      for (const seed of teamSeeds) {
        const id = `${orgId}:${seed.name}`;
        state.teams[id] = {
          id,
          orgId,
          name: seed.name,
          description: "",
          parentId: seed.parentId,
          createdBy: "alice-dev",
          createdAt: now,
        };
      }

      const grantRepo = state.repositories[`${orgId}:acme-internal`];
      const grantTeam = state.teams[`${orgId}:frontend-team`];
      const grantKey = `${grantRepo.id}:team:${grantTeam.id}`;
      state.grants[grantKey] = {
        id: grantKey,
        orgId,
        repoId: grantRepo.id,
        subjectType: "team",
        subjectId: grantTeam.id,
        role: "write",
        grantedBy: "alice-dev",
        createdAt: now,
      };

      // Personal repository of the seeded member bob-reviewer, used by the
      // remove-member scenario (must survive the member's removal).
      const personalId = "bob-reviewer:bob-notes";
      state.repositories[personalId] = {
        id: personalId,
        ownerType: "user",
        ownerId: "bob-reviewer",
        name: "bob-notes",
        description: "Bob's personal notes",
        visibility: "private",
        defaultBranch: "main",
        createdAt: now,
        updatedAt: now,
      };
    });
  }

  async function listOrganizations(accountId) {
    if (!accountId) return [];
    const state = await store.read();
    return Object.values(state.memberships ?? {})
      .filter((membership) => membership.accountId === accountId)
      .map((membership) => {
        const organization = state.organizations[membership.orgId];
        return organization
          ? {
              id: organization.id,
              displayName: organization.displayName,
              createdAt: organization.createdAt,
              role: membership.role,
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async function getOrganization(orgId, accountId) {
    const state = await store.read();
    const organization = state.organizations[orgId];
    if (!organization) return null;
    const membership = accountId ? state.memberships?.[`${orgId}:${accountId}`] : null;
    return {
      id: organization.id,
      displayName: organization.displayName,
      createdAt: organization.createdAt,
      myRole: membership?.role ?? null,
    };
  }

  async function createOrganization(accountId, input = {}) {
    const name = typeof input.name === "string" ? input.name : "";
    const displayName = normalizeDisplayName(input.displayName);
    let result;
    await store.update(async (state) => {
      const errors = {};
      if (!name || !isValidOrganizationName(name)) {
        errors.name = "Organization name format is invalid";
      }
      if (!displayName) errors.displayName = "Display name is required";
      else if (displayName.length > 100) {
        errors.displayName = "Display name must be at most 100 characters";
      }
      if (!errors.name && state.organizations?.[name]) {
        errors.name = "Organization name already exists";
      }
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const now = new Date().toISOString();
      state.organizations = state.organizations ?? {};
      state.memberships = state.memberships ?? {};
      state.organizations[name] = { id: name, displayName, createdAt: now };
      state.memberships[`${name}:${accountId}`] = {
        orgId: name,
        accountId,
        role: "owner",
        createdAt: now,
      };
      result = {
        ok: true,
        organization: { id: name, displayName, createdAt: now, role: "owner" },
      };
    });
    return result;
  }

  async function listVisibleRepositories(orgId, accountId) {
    const state = await store.read();
    return Object.values(state.repositories ?? {})
      .filter(
        (repo) =>
          repo.ownerType === "organization" &&
          repo.ownerId === orgId &&
          (repo.visibility === "public" || effectiveRole(state, repo, accountId)),
      )
      .map((repo) => ({
        owner: repo.ownerId,
        name: repo.name,
        description: repo.description ?? "",
        visibility: repo.visibility,
        updatedAt: repo.updatedAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function listPeople(orgId) {
    const state = await store.read();
    return Object.values(state.memberships ?? {})
      .filter((membership) => membership.orgId === orgId)
      .map((membership) => ({ username: membership.accountId, role: membership.role }))
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  // Directly add an existing account (by username or verified email) as an
  // organization member or owner. Atomic: on success the membership is stored;
  // on any validation or persistence failure nothing changes.
  async function addMember(accountId, orgId, input = {}) {
    const identifier = typeof input.username === "string" ? input.username.trim() : "";
    const role = input.role;
    let result;
    await store.update(async (state) => {
      if (!state.organizations?.[orgId]) {
        result = { ok: false, notFound: true };
        return;
      }
      const errors = {};
      let targetAccount = null;
      if (!identifier) {
        errors.username = "Username or email is required";
      } else {
        targetAccount = findAccountByIdentifier(state, identifier);
        if (!targetAccount) errors.username = "Account not found";
      }
      if (targetAccount && state.memberships?.[`${orgId}:${targetAccount.username}`]) {
        errors.username = "Account is already a member";
      }
      if (role !== "member" && role !== "owner") {
        errors.role = "Role is invalid";
      }
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const now = new Date().toISOString();
      state.memberships = state.memberships ?? {};
      state.memberships[`${orgId}:${targetAccount.username}`] = {
        orgId,
        accountId: targetAccount.username,
        role,
        createdAt: now,
      };
      result = { ok: true, member: { username: targetAccount.username, role } };
    });
    return result;
  }

  // Remove a member atomically: deletes the organization membership, the
  // account's team memberships in the organization and all direct grants to the
  // account on the organization's repositories. Teams, team grants, the
  // account itself, personal repositories and other-organization relationships
  // are untouched. The last Owner cannot be removed.
  async function removeMember(accountId, orgId, username) {
    let result;
    await store.update(async (state) => {
      if (!state.organizations?.[orgId]) {
        result = { ok: false, notFound: true };
        return;
      }
      const membership = state.memberships?.[`${orgId}:${username}`];
      if (!membership) {
        result = { ok: false, notFound: true };
        return;
      }
      const ownerCount = Object.values(state.memberships ?? {}).filter(
        (record) => record.orgId === orgId && record.role === "owner",
      ).length;
      if (membership.role === "owner" && ownerCount <= 1) {
        result = {
          ok: false,
          errors: { username: "The organization must have at least one Owner" },
        };
        return;
      }
      delete state.memberships[`${orgId}:${username}`];
      for (const [key, record] of Object.entries(state.teamMembers ?? {})) {
        if (record.orgId === orgId && record.accountId === username) {
          delete state.teamMembers[key];
        }
      }
      for (const [key, grant] of Object.entries(state.grants ?? {})) {
        if (
          grant.orgId === orgId &&
          grant.subjectType === "member" &&
          grant.subjectId === username
        ) {
          delete state.grants[key];
        }
      }
      result = { ok: true };
    });
    return result;
  }

  async function listTeams(orgId) {
    const state = await store.read();
    return Object.values(state.teams ?? {})
      .filter((team) => team.orgId === orgId)
      .map((team) => serializeTeam(state, team))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function getTeam(orgId, teamName, accountId) {
    const state = await store.read();
    const team = state.teams?.[`${orgId}:${teamName}`];
    if (!team) return null;
    const organization = state.organizations[orgId];
    if (!organization) return null;
    const membership = accountId ? state.memberships?.[`${orgId}:${accountId}`] : null;
    return {
      team: serializeTeam(state, team),
      organization: { id: organization.id, displayName: organization.displayName },
      myRole: membership?.role ?? null,
    };
  }

  async function createTeam(accountId, orgId, input = {}) {
    const name = typeof input.name === "string" ? input.name : "";
    const description = typeof input.description === "string" ? input.description.trim() : "";
    const parentId =
      input.parentId === undefined || input.parentId === null || input.parentId === ""
        ? null
        : input.parentId;
    let result;
    await store.update(async (state) => {
      if (!state.organizations?.[orgId]) {
        result = { ok: false, notFound: true };
        return;
      }
      const errors = {};
      if (!name) errors.name = "Team name is required";
      else if (!isValidTeamName(name)) errors.name = "Team name format is invalid";
      const teamId = `${orgId}:${name}`;
      if (!errors.name && state.teams?.[teamId]) errors.name = "Team name already exists";
      if (parentId) {
        const parent = state.teams?.[parentId];
        if (!parent || parent.orgId !== orgId) {
          errors.parentId = "Parent team does not belong to this organization";
        }
      }
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const now = new Date().toISOString();
      state.teams = state.teams ?? {};
      state.teams[teamId] = {
        id: teamId,
        orgId,
        name,
        description,
        parentId,
        createdBy: accountId,
        createdAt: now,
      };
      result = { ok: true, team: serializeTeam(state, state.teams[teamId]) };
    });
    return result;
  }

  async function listTeamMembers(orgId, teamName) {
    const state = await store.read();
    const teamId = `${orgId}:${teamName}`;
    return Object.values(state.teamMembers ?? {})
      .filter((record) => record.teamId === teamId)
      .map((record) => record.accountId)
      .sort((a, b) => a.localeCompare(b));
  }

  async function addTeamMember(accountId, orgId, teamName, username = "") {
    let result;
    await store.update(async (state) => {
      if (!state.organizations?.[orgId] || !state.teams?.[`${orgId}:${teamName}`]) {
        result = { ok: false, notFound: true };
        return;
      }
      const errors = {};
      const account = state.accounts?.[username];
      if (!username) errors.username = "Username is required";
      else if (!account) errors.username = "Account not found";
      else if (!state.memberships?.[`${orgId}:${username}`]) {
        errors.username = "Account is not a member of the organization";
      }
      const teamId = `${orgId}:${teamName}`;
      if (!errors.username && state.teamMembers?.[`${teamId}:${username}`]) {
        errors.username = "Account is already a member of the team";
      }
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const now = new Date().toISOString();
      state.teamMembers = state.teamMembers ?? {};
      state.teamMembers[`${teamId}:${username}`] = {
        teamId,
        orgId,
        accountId: username,
        createdAt: now,
      };
      result = { ok: true, member: { username } };
    });
    return result;
  }

  async function removeTeamMember(accountId, orgId, teamName, username) {
    await store.update((state) => {
      const teamId = `${orgId}:${teamName}`;
      delete state.teamMembers?.[`${teamId}:${username}`];
    });
    return { ok: true };
  }

  async function setTeamParent(accountId, orgId, teamName, parentId) {
    const parent =
      parentId === undefined || parentId === null || parentId === "" ? null : parentId;
    let result;
    await store.update(async (state) => {
      const team = state.teams?.[`${orgId}:${teamName}`];
      if (!team) {
        result = { ok: false, notFound: true };
        return;
      }
      if (parent) {
        const parentTeam = state.teams?.[parent];
        if (!parentTeam || parentTeam.orgId !== orgId) {
          result = {
            ok: false,
            errors: { parentId: "Parent team does not belong to this organization" },
          };
          return;
        }
        if (wouldCreateCycle(state, team.id, parent)) {
          result = { ok: false, errors: { parentId: "Cyclic team hierarchy is not allowed" } };
          return;
        }
      }
      team.parentId = parent;
      result = { ok: true, team: serializeTeam(state, team) };
    });
    return result;
  }

  async function getRepository(owner, name, accountId) {
    const state = await store.read();
    const repo = state.repositories?.[`${owner}:${name}`];
    if (!repo) return null;
    if (!repositoryAccessible(state, repo, accountId)) {
      return { denied: true };
    }
    return {
      repository: serializeRepository(state, repo),
      myRole: effectiveRole(state, repo, accountId),
    };
  }

  // Repositories visible to the current user whose names contain the query
  // (case-insensitive). Private repositories follow the same access rules as
  // direct links and repository lists.
  async function searchRepositories(query, accountId) {
    const state = await store.read();
    const q = typeof query === "string" ? query.trim().toLowerCase() : "";
    if (!q) return [];
    return Object.values(state.repositories ?? {})
      .filter(
        (repo) =>
          repo.name.toLowerCase().includes(q) && repositoryAccessible(state, repo, accountId),
      )
      .map((repo) => ({
        owner: repo.ownerId,
        name: repo.name,
        description: repo.description ?? "",
        visibility: repo.visibility,
        defaultBranch: repo.defaultBranch,
        updatedAt: repo.updatedAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.owner.localeCompare(b.owner));
  }

  // Repositories belonging to the signed-in user: personal repositories plus
  // repositories of organizations the account belongs to that the account can
  // view.
  async function listMyRepositories(accountId) {
    if (!accountId) return [];
    const state = await store.read();
    const orgIds = new Set(
      Object.values(state.memberships ?? {})
        .filter((membership) => membership.accountId === accountId)
        .map((membership) => membership.orgId),
    );
    return Object.values(state.repositories ?? {})
      .filter((repo) => {
        // Personal repositories are listed when the account owns them or has a
        // role on them through a direct grant; organization repositories use
        // the same access rule as search and direct links.
        if (repo.ownerType === "user") {
          return repositoryAccessible(state, repo, accountId);
        }
        return orgIds.has(repo.ownerId) && repositoryAccessible(state, repo, accountId);
      })
      .map((repo) => ({
        owner: repo.ownerId,
        name: repo.name,
        description: repo.description ?? "",
        visibility: repo.visibility,
        updatedAt: repo.updatedAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.owner.localeCompare(b.owner));
  }

  // Read a directory or file at a path on a branch of a repository the user
  // can view. Directories are path hierarchies only; files store content and
  // the commit that last touched them.
  async function getRepositoryContents(owner, name, options = {}, accountId) {
    const state = await store.read();
    const repo = state.repositories?.[`${owner}:${name}`];
    if (!repo) return { notFound: true };
    if (!repositoryAccessible(state, repo, accountId)) return { denied: true };
    const git = state.git?.[repo.id];
    const branch = options.branch || repo.defaultBranch;
    if (!git?.branches?.[branch]) return { notFound: true };
    const snapshot = git.files?.[branch] ?? {};
    const path = (typeof options.path === "string" ? options.path : "").replace(/^\/+|\/+$/g, "");

    const entryType = (fullPath) =>
      snapshot[fullPath] !== undefined ? "file" : "dir";
    const listEntries = (prefix) => {
      const names = new Set();
      for (const key of Object.keys(snapshot)) {
        if (!key.startsWith(prefix)) continue;
        const remainder = key.slice(prefix.length);
        const first = remainder.split("/")[0];
        if (first) names.add(first);
      }
      return [...names]
        .sort()
        .map((entryName) => ({
          name: entryName,
          path: `${prefix}${entryName}`,
          type: entryType(`${prefix}${entryName}`),
        }));
    };

    if (!path) {
      return {
        ok: true,
        repository: { owner, name },
        branch,
        path: "/",
        type: "dir",
        entries: listEntries(""),
        myRole: effectiveRole(state, repo, accountId),
        commitCount: countCommitsOnBranch(git, branch),
      };
    }
    const file = snapshot[path];
    if (file !== undefined) {
      const commit = git.commits?.[file.commitId];
      return {
        ok: true,
        repository: { owner, name },
        branch,
        path,
        type: "file",
        name: path.split("/").pop(),
        content: file.content,
        commit: commit
          ? { id: commit.id, message: commit.message, author: commit.author, createdAt: commit.createdAt }
          : null,
        myRole: effectiveRole(state, repo, accountId),
        commitCount: countCommitsOnBranch(git, branch),
      };
    }
    const entries = listEntries(`${path}/`);
    if (entries.length === 0) return { notFound: true };
    return {
      ok: true,
      repository: { owner, name },
      branch,
      path,
      type: "dir",
      entries,
      myRole: effectiveRole(state, repo, accountId),
      commitCount: countCommitsOnBranch(git, branch),
    };
  }

  // Create a repository in a namespace where the user may create repositories:
  // personal namespace (self) or an organization where the user is an Owner.
  // Validates owner, name uniqueness/format, visibility and initialization, and
  // stores the repository identifier, owner, visibility, default branch and
  // creator atomically. When initialization is selected the initial branch,
  // README file and initial commit are created in the same atomic update, so a
  // failure leaves no partially created repository.
  async function createRepository(accountId, input = {}) {
    const owner = typeof input.owner === "string" ? input.owner.trim() : "";
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const description = typeof input.description === "string" ? input.description.trim() : "";
    const visibility = input.visibility;
    const initialize = input.initialize === true;
    let result;
    await store.update(async (state) => {
      if (!accountId) {
        result = { ok: false, forbidden: true };
        return;
      }
      const errors = {};
      let ownerPermitted = false;
      if (!owner) {
        errors.owner = "Owner is required";
      } else if (owner === accountId) {
        ownerPermitted = true;
      } else if (state.organizations?.[owner]) {
        ownerPermitted = isOrganizationOwner(state, owner, accountId);
      }
      if (owner && !ownerPermitted) {
        result = { ok: false, forbidden: true };
        return;
      }
      if (!name) errors.name = "Repository name is required";
      else if (!isValidRepositoryName(name)) errors.name = "Repository name format is invalid";
      if (!errors.name && state.repositories?.[`${owner}:${name}`]) {
        errors.name = "Repository name already exists";
      }
      if (visibility !== "public" && visibility !== "private") {
        errors.visibility = "Visibility is invalid";
      }
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const now = new Date().toISOString();
      const repoId = `${owner}:${name}`;
      state.repositories = state.repositories ?? {};
      state.repositories[repoId] = {
        id: repoId,
        ownerType: state.organizations?.[owner] ? "organization" : "user",
        ownerId: owner,
        name,
        description,
        visibility,
        defaultBranch: "main",
        createdBy: accountId,
        createdAt: now,
        updatedAt: now,
      };
      if (initialize) {
        state.git = state.git ?? {};
        const commitId = `${repoId}:initial`;
        state.git[repoId] = {
          branches: { main: commitId },
          commits: {
            [commitId]: {
              id: commitId,
              message: "Initial commit",
              author: accountId,
              createdAt: now,
              parentId: null,
              changes: [{ path: "README.md", additions: 1, deletions: 0 }],
            },
          },
          files: {
            main: {
              "README.md": { content: `# ${name}\n`, commitId },
            },
          },
        };
      }
      result = {
        ok: true,
        repository: {
          owner,
          name,
          description,
          visibility,
          defaultBranch: "main",
          updatedAt: now,
        },
      };
    });
    return result;
  }

  // Create an independent fork of a readable source repository in a namespace
  // where the user may create repositories. Copies the accessible history and
  // files; the fork never writes back to the source.
  async function createFork(accountId, sourceOwner, sourceName, input = {}) {
    const targetOwner = typeof input.targetOwner === "string" ? input.targetOwner.trim() : "";
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const visibility = input.visibility;
    let result;
    await store.update(async (state) => {
      const source = state.repositories?.[`${sourceOwner}:${sourceName}`];
      if (!source) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!accountId || !repositoryAccessible(state, source, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      const errors = {};
      let targetPermitted = false;
      if (!targetOwner) {
        errors.targetOwner = "Owner is required";
      } else if (targetOwner === accountId) {
        targetPermitted = true;
      } else if (state.organizations?.[targetOwner] && isOrganizationOwner(state, targetOwner, accountId)) {
        targetPermitted = true;
      }
      if (targetOwner && !targetPermitted) {
        result = { ok: false, forbidden: true };
        return;
      }
      if (!name) errors.name = "Repository name is required";
      else if (!isValidRepositoryName(name)) errors.name = "Repository name format is invalid";
      if (!errors.name && state.repositories?.[`${targetOwner}:${name}`]) {
        errors.name = "Repository name already exists";
      }
      if (visibility !== "public" && visibility !== "private") {
        errors.visibility = "Visibility is invalid";
      } else if (source.visibility === "private" && visibility !== "private") {
        errors.visibility = "A private repository can only be forked as Private";
      }
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const now = new Date().toISOString();
      const repoId = `${targetOwner}:${name}`;
      state.repositories[repoId] = {
        id: repoId,
        ownerType: state.organizations?.[targetOwner] ? "organization" : "user",
        ownerId: targetOwner,
        name,
        description: source.description ?? "",
        visibility,
        defaultBranch: source.defaultBranch,
        forkSourceId: source.id,
        createdAt: now,
        updatedAt: now,
      };
      const sourceGit = state.git?.[source.id];
      if (sourceGit) {
        state.git = state.git ?? {};
        state.git[repoId] = structuredClone(sourceGit);
      }
      result = {
        ok: true,
        repository: {
          owner: targetOwner,
          name,
          description: source.description ?? "",
          visibility,
          defaultBranch: source.defaultBranch,
          updatedAt: now,
        },
      };
    });
    return result;
  }

  async function setRepositoryVisibility(accountId, owner, name, visibility) {
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!canManageAccess(state, repo, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      if (visibility !== "public" && visibility !== "private") {
        result = { ok: false, errors: { visibility: "Visibility is invalid" } };
        return;
      }
      repo.visibility = visibility;
      repo.updatedAt = new Date().toISOString();
      result = {
        ok: true,
        repository: serializeRepository(state, repo),
        myRole: effectiveRole(state, repo, accountId),
      };
    });
    return result;
  }

  function canManageAccess(state, repo, accountId) {
    if (!accountId) return false;
    if (repo.ownerType === "organization" && isOrganizationOwner(state, repo.ownerId, accountId)) {
      return true;
    }
    return effectiveRole(state, repo, accountId) === "admin";
  }

  async function getAccessData(accountId, owner, name) {
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!canManageAccess(state, repo, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      const grants = Object.values(state.grants ?? {})
        .filter((grant) => grant.repoId === repo.id)
        .map((grant) => ({
          subjectType: grant.subjectType,
          subjectId: grant.subjectId,
          subjectName:
            grant.subjectType === "team"
              ? state.teams?.[grant.subjectId]?.name ?? grant.subjectId
              : grant.subjectId,
          role: grant.role,
          grantedBy: grant.grantedBy,
          createdAt: grant.createdAt,
        }))
        .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
      const members = Object.values(state.memberships ?? {})
        .filter((membership) => membership.orgId === repo.ownerId)
        .map((membership) => ({ username: membership.accountId }))
        .sort((a, b) => a.username.localeCompare(b.username));
      const teams = Object.values(state.teams ?? {})
        .filter((team) => team.orgId === repo.ownerId)
        .map((team) => ({ id: team.id, name: team.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      result = { ok: true, grants, members, teams };
    });
    return result;
  }

  async function setGrant(accountId, owner, name, input = {}) {
    const subjectType = input.subjectType;
    const subjectId = typeof input.subjectId === "string" ? input.subjectId : "";
    const role = input.role;
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      if (repo.ownerType !== "organization") {
        result = {
          ok: false,
          errors: { subjectId: "Repository access can only be managed for organization repositories" },
        };
        return;
      }
      if (!canManageAccess(state, repo, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      const errors = {};
      if (subjectType === "member") {
        if (!state.memberships?.[`${repo.ownerId}:${subjectId}`]) {
          errors.subjectId = "Account is not a member of the organization";
        }
      } else if (subjectType === "team") {
        const team = state.teams?.[subjectId];
        if (!team || team.orgId !== repo.ownerId) {
          errors.subjectId = "Team does not belong to this organization";
        }
      } else {
        errors.subjectId = "Unsupported subject";
      }
      if (!ROLE_RANK[role]) errors.role = "Role is invalid";
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const key = `${repo.id}:${subjectType}:${subjectId}`;
      state.grants = state.grants ?? {};
      state.grants[key] = {
        id: key,
        orgId: repo.ownerId,
        repoId: repo.id,
        subjectType,
        subjectId,
        role,
        grantedBy: accountId,
        createdAt: state.grants[key]?.createdAt ?? new Date().toISOString(),
      };
      result = {
        ok: true,
        grant: {
          subjectType,
          subjectId,
          subjectName:
            subjectType === "team" ? state.teams[subjectId].name : subjectId,
          role,
          grantedBy: accountId,
          createdAt: state.grants[key].createdAt,
        },
      };
    });
    return result;
  }

  // Branch names of a repository the user can view, used by the commit
  // history and comparison pages.
  async function listBranches(owner, name, accountId) {
    const state = await store.read();
    const repo = state.repositories?.[`${owner}:${name}`];
    if (!repo) return { notFound: true };
    if (!repositoryAccessible(state, repo, accountId)) return { denied: true };
    const git = state.git?.[repo.id];
    return {
      ok: true,
      defaultBranch: repo.defaultBranch,
      branches: Object.keys(git?.branches ?? {}).sort(),
    };
  }

  // Commit history for a branch (newest first), optionally restricted to
  // commits that changed a file path.
  async function getRepositoryCommits(owner, name, options = {}, accountId) {
    const state = await store.read();
    const repo = state.repositories?.[`${owner}:${name}`];
    if (!repo) return { notFound: true };
    if (!repositoryAccessible(state, repo, accountId)) return { denied: true };
    const git = state.git?.[repo.id];
    const branch = options.branch || repo.defaultBranch;
    if (!git?.branches?.[branch]) return { notFound: true };
    const path = typeof options.path === "string" ? options.path : "";
    return {
      ok: true,
      repository: { owner, name },
      branch,
      path,
      commits: commitHistory(git, git.branches[branch], path || undefined),
    };
  }

  // Diff of one commit against its parent: base is the parent revision and
  // compare is the commit itself.
  async function getCommitDiff(owner, name, commitId, options = {}, accountId) {
    const state = await store.read();
    const repo = state.repositories?.[`${owner}:${name}`];
    if (!repo) return { notFound: true };
    if (!repositoryAccessible(state, repo, accountId)) return { denied: true };
    const git = state.git?.[repo.id];
    const commit = git?.commits?.[commitId];
    if (!commit) return { notFound: true };
    const parentId = commit.parentId ?? null;
    const baseSnapshot = parentId ? snapshotAt(git, parentId) : {};
    const compareSnapshot = snapshotAt(git, commitId);
    const diff = snapshotDiff(baseSnapshot, compareSnapshot);
    const pathFilter = typeof options.path === "string" && options.path ? options.path : null;
    return {
      ok: true,
      repository: { owner, name },
      base: parentId ? shortId(parentId) : "(none)",
      compare: shortId(commitId),
      commit: serializeCommitRecord(commit),
      parent: parentId ? serializeCommitRecord(git.commits[parentId]) : null,
      files: pathFilter ? diff.files.filter((file) => file.path === pathFilter) : diff.files,
      totalAdditions: pathFilter
        ? diff.files.filter((file) => file.path === pathFilter).reduce((sum, file) => sum + file.additions, 0)
        : diff.totalAdditions,
      totalDeletions: pathFilter
        ? diff.files.filter((file) => file.path === pathFilter).reduce((sum, file) => sum + file.deletions, 0)
        : diff.totalDeletions,
    };
  }

  // Line-by-line diff between two readable revisions (branch names or commit
  // ids). Read-only; never creates or changes commits.
  async function getCompareDiff(owner, name, baseRef, compareRef, options = {}, accountId) {
    const state = await store.read();
    const repo = state.repositories?.[`${owner}:${name}`];
    if (!repo) return { notFound: true };
    if (!repositoryAccessible(state, repo, accountId)) return { denied: true };
    const git = state.git?.[repo.id];
    const baseCommitId = resolveRevision(git, baseRef);
    const compareCommitId = resolveRevision(git, compareRef);
    if (!baseCommitId || !compareCommitId) return { notFound: true };
    const diff = snapshotDiff(snapshotAt(git, baseCommitId), snapshotAt(git, compareCommitId));
    const pathFilter = typeof options.path === "string" && options.path ? options.path : null;
    return {
      ok: true,
      repository: { owner, name },
      base: shortId(baseCommitId),
      compare: shortId(compareCommitId),
      files: pathFilter ? diff.files.filter((file) => file.path === pathFilter) : diff.files,
      totalAdditions: pathFilter
        ? diff.files.filter((file) => file.path === pathFilter).reduce((sum, file) => sum + file.additions, 0)
        : diff.totalAdditions,
      totalDeletions: pathFilter
        ? diff.files.filter((file) => file.path === pathFilter).reduce((sum, file) => sum + file.deletions, 0)
        : diff.totalDeletions,
    };
  }

  // Search readable file content of the current repository (default branch
  // snapshot). Returns matching files with the first matching line snippet;
  // never leaks results across repositories and never writes code.
  async function searchRepositoryCode(owner, name, query, options = {}, accountId) {
    const state = await store.read();
    const repo = state.repositories?.[`${owner}:${name}`];
    if (!repo) return { notFound: true };
    if (!repositoryAccessible(state, repo, accountId)) return { denied: true };
    const git = state.git?.[repo.id];
    const branch = options.branch || repo.defaultBranch;
    const snapshot = git?.files?.[branch] ?? {};
    const q = typeof query === "string" ? query.trim() : "";
    const pathFilter = typeof options.path === "string" ? options.path.trim() : "";
    if (!q) return { ok: true, repository: { owner, name }, branch, results: [] };
    const lower = q.toLowerCase();
    const results = [];
    for (const path of Object.keys(snapshot).sort()) {
      if (pathFilter && !path.startsWith(pathFilter)) continue;
      const content = snapshot[path]?.content ?? "";
      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].toLowerCase().includes(lower)) {
          results.push({
            path,
            branch,
            line: index + 1,
            snippet: lines[index],
          });
          break;
        }
      }
    }
    return { ok: true, repository: { owner, name }, branch, results };
  }

  // Create one commit on a branch of a writable repository, atomically storing
  // the path/content change, commit message, author, parent commit and target
  // branch and moving the branch head. Only Write, Maintain, Admin or
  // organization Owner may submit; any validation or permission failure leaves
  // the file, branch head and commit history unchanged.
  async function createRepositoryCommit(accountId, owner, name, input = {}) {
    const branch = typeof input.branch === "string" && input.branch ? input.branch : undefined;
    const path = typeof input.path === "string" ? input.path : "";
    const content = typeof input.content === "string" ? input.content : null;
    const message = typeof input.message === "string" ? input.message : "";
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!canWriteGit(state, repo, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      const git = state.git?.[repo.id];
      const targetBranch = branch || repo.defaultBranch;
      const errors = {};
      if (!git?.branches?.[targetBranch]) {
        errors.branch = "Branch not found";
      }
      if (git?.protectedBranches?.[targetBranch]) {
        errors.branch = "This branch is protected";
      }
      if (!path || path.startsWith("/") || path.split("/").includes("..")) {
        errors.path = "Invalid file path";
      } else {
        const snapshot = git?.files?.[targetBranch] ?? {};
        const conflicts = snapshot[path] !== undefined;
        const dirConflicts = Object.keys(snapshot).some((key) => key.startsWith(`${path}/`));
        if (conflicts || dirConflicts) {
          errors.path = "A file or directory already exists at this path";
        }
      }
      const trimmedMessage = message.trim();
      if (!trimmedMessage) errors.message = "Commit message is required";
      else if (trimmedMessage.length > 72) errors.message = "Commit message must be at most 72 characters";
      if (content === null) errors.content = "File contents are required";
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const parentId = git.branches[targetBranch];
      const now = new Date().toISOString();
      const commitId = `c${Object.keys(git.commits ?? {}).length + 1}`;
      const oldContent = git.files?.[targetBranch]?.[path]?.content ?? null;
      const diff = diffLines(oldContent ?? "", content);
      const change = {
        path,
        additions: diff.additions,
        deletions: diff.deletions,
        oldContent,
        newContent: content,
      };
      git.commits = git.commits ?? {};
      git.commits[commitId] = {
        id: commitId,
        message: trimmedMessage,
        author: accountId,
        createdAt: now,
        parentId,
        changes: [change],
      };
      git.branches[targetBranch] = commitId;
      git.files = git.files ?? {};
      git.files[targetBranch] = git.files[targetBranch] ?? {};
      git.files[targetBranch][path] = { content, commitId };
      result = { ok: true, commit: serializeCommitRecord(git.commits[commitId]) };
    });
    return result;
  }

  // Create a new named branch reference at the head of a specified base branch
  // or commit, atomically storing the name, base commit, creator and time and
  // copying the base file snapshot so the new branch is immediately browsable.
  // Only Write, Maintain, Admin or organization Owner may create branches;
  // invalid or duplicate names are rejected without touching any existing
  // branch, commit or file record.
  async function createBranch(accountId, owner, name, input = {}) {
    const branchName = typeof input.name === "string" ? input.name.trim() : "";
    const base = typeof input.base === "string" && input.base.trim() ? input.base.trim() : undefined;
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      if (!canWriteGit(state, repo, accountId)) {
        result = { ok: false, forbidden: true };
        return;
      }
      const git = state.git?.[repo.id];
      if (!git) {
        result = { ok: false, notFound: true };
        return;
      }
      const errors = {};
      if (!isValidBranchName(branchName)) {
        errors.name = "Invalid branch";
      } else if (git.branches?.[branchName]) {
        errors.name = "Branch already exists";
      }
      const baseRef = base || repo.defaultBranch;
      const baseCommitId = resolveRevision(git, baseRef);
      if (!baseCommitId) errors.base = "Base branch not found";
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const now = new Date().toISOString();
      git.branches[branchName] = baseCommitId;
      const baseRecords = git.files?.[baseRef] ?? snapshotRecordsForCommit(git, baseCommitId);
      git.files = git.files ?? {};
      git.files[branchName] = structuredClone(baseRecords);
      result = {
        ok: true,
        branch: { name: branchName, commitId: baseCommitId, createdBy: accountId, createdAt: now },
      };
    });
    return result;
  }

  // Change the repository default branch. Only repository Admin or
  // organization Owner may change it; the new value must name an existing
  // branch. The operator and time are stored together with the change, and
  // existing branches, commits and branch references are left untouched.
  async function setDefaultBranch(accountId, owner, name, branchName) {
    const target = typeof branchName === "string" ? branchName.trim() : "";
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      if (effectiveRole(state, repo, accountId) !== "admin") {
        result = { ok: false, forbidden: true };
        return;
      }
      const git = state.git?.[repo.id];
      if (!git?.branches?.[target]) {
        result = { ok: false, errors: { branch: "Branch not found" } };
        return;
      }
      const now = new Date().toISOString();
      repo.defaultBranch = target;
      repo.defaultBranchChangedBy = accountId;
      repo.defaultBranchChangedAt = now;
      result = { ok: true, repository: serializeRepository(state, repo) };
    });
    return result;
  }

  return {
    seedIfEmpty,
    listOrganizations,
    getOrganization,
    createOrganization,
    listVisibleRepositories,
    listPeople,
    addMember,
    removeMember,
    listTeams,
    getTeam,
    createTeam,
    listTeamMembers,
    addTeamMember,
    removeTeamMember,
    setTeamParent,
    getRepository,
    createRepository,
    searchRepositories,
    listMyRepositories,
    getRepositoryContents,
    createFork,
    setRepositoryVisibility,
    getAccessData,
    setGrant,
    listBranches,
    createBranch,
    setDefaultBranch,
    getRepositoryCommits,
    getCommitDiff,
    getCompareDiff,
    searchRepositoryCode,
    createRepositoryCommit,
  };
}
