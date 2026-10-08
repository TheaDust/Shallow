import { reply } from "./fake-response";
import { isValidBranchName } from "../lib/branch-name";
import {
  createFakeCodeApi,
  type FakeBranch,
  type FakeCommit,
  type FakeRepository,
  type FakeViewer,
} from "./fake-code-api";
import {
  ACEME_DOCS_EXTRA_BRANCHES,
  ACEME_DOCS_HISTORY,
  ACEME_DOCS_ISSUE_LABELS,
  ACEME_DOCS_ISSUES,
  ACEME_DOCS_MILESTONES,
  ACEME_DOCS_PROTECTION_RULES,
  BRANCH_PROTECTION_BRANCHES,
  BRANCH_SWITCH_BRANCHES,
  DEFAULT_BRANCH_BRANCHES,
  EVO_RELEASES,
  EVO_REACTION_ISSUES,
  EVO_REACTION_README,
  EVO_REACTION_REPOSITORY_ID,
  EVO_REACTION_SEED_REACTION,
  PULL_REQUEST_REVIEW_SEEDS,
  PULL_REQUEST_SEEDS,
  SEED_FILES,
  diffSnapshots,
  evoBranchSwitchBranches,
  evoReleaseBranches,
  singleHistory,
  type FakeBranchSeed,
  type FakeFile,
  type FakeHistoryEntry,
  type FakeIssueSeed,
} from "./fake-org-seed";

interface FakeOrganization {
  id: string;
  displayName: string;
}

interface FakeMembership {
  organizationId: string;
  username: string;
  role: "Owner" | "Member";
}

interface FakeTeam {
  organizationId: string;
  name: string;
  parentName: string | null;
}

interface FakeTeamMember {
  organizationId: string;
  teamName: string;
  username: string;
}

interface FakeGrant {
  id: string;
  repositoryId: string;
  subjectType: "account" | "team";
  subjectId: string;
  role: string;
}

interface FakeIssue {
  id: string;
  repositoryId: string;
  number: number;
  title: string;
  description: string;
  status: "open" | "closed";
  authorName: string;
  labelIds: string[];
  assigneeIds: string[];
  milestoneId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FakeIssueComment {
  id: string;
  issueId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

interface FakeIssueEvent {
  id: string;
  issueId: string;
  type: string;
  actorName: string;
  detail?: string;
  createdAt: string;
}

/** One account's reaction of one name on one issue (REQ-5-5). */
interface FakeIssueReaction {
  id: string;
  issueId: string;
  type: string;
  accountId: string;
  accountName: string;
  createdAt: string;
}

/** The reaction names the issue detail offers, mirroring issue-rules.mjs. */
const ISSUE_REACTION_TYPES = ["+1"];

interface FakeIssueLabel {
  id: string;
  repositoryId: string;
  name: string;
  color: string;
}

interface FakeRelease {
  id: string;
  repositoryId: string;
  tag: string;
  title: string;
  description: string;
  branch: string;
  author: string;
  createdAt: string;
}

interface FakePullRequestCheck {
  name: string;
  status: "pending" | "success" | "failure";
  setter: string | null;
  commitId: string | null;
}

interface FakePullRequest {
  id: string;
  repositoryId: string;
  number: number;
  title: string;
  description: string;
  status: "draft" | "open" | "closed" | "merged";
  authorName: string;
  sourceBranch: string;
  targetBranch: string;
  baseCommitId: string | null;
  creationCompareCommitId: string | null;
  createdAt: string;
  updatedAt: string;
  checks: FakePullRequestCheck[];
  requestedReviewers: string[];
  mergedByName?: string | null;
  mergedAt?: string | null;
  mergedCommitId?: string | null;
}

interface FakePullRequestEvent {
  id: string;
  pullRequestId: string;
  type: string;
  actorName: string;
  detail: string;
  createdAt: string;
}

interface FakeReviewComment {
  id: string;
  pullRequestId: string;
  authorName: string;
  body: string;
  filePath: string;
  lineIndex: number | null;
  state: "published" | "pending";
  commitId: string | null;
  createdAt: string;
}

interface FakeReviewDecision {
  id: string;
  pullRequestId: string;
  reviewerName: string;
  decision: "approved" | "changes-requested";
  summary: string;
  commitId: string | null;
  createdAt: string;
}

interface FakeBranchProtectionRule {
  id: string;
  repositoryId: string;
  branchName: string;
  requireApprovals: boolean;
  requireStatusCheck: boolean;
}

const ORGANIZATION_NAME_PATTERN = /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/;
const TEAM_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const ACCESS_ROLES = ["Read", "Triage", "Write", "Maintain", "Admin"];
const MEMBERSHIP_ROLES = ["Member", "Owner"];

const ACCESS_DENIED = "Access denied";

const README_PATTERN = /^readme(?:\.[a-z0-9]+)?$/i;

export interface FakeOrgBackend {
  canHandle(path: string): boolean;
  handle(path: string, method: string, body: Record<string, unknown>): Response;
}

/**
 * In-memory organization backend mirroring the server rules: the same exact
 * messages, the same permission model (public read, Owner, direct grant, team
 * grant), the same repository creation/fork rules and the same persistence
 * within one test.
 */
export function createFakeOrgBackend({
  currentAccountId,
  currentUsername,
  listAccounts,
}: {
  currentAccountId(): string | null;
  currentUsername(): string | null;
  listAccounts(): Array<{ username: string; email: string }>;
}): FakeOrgBackend {
  const organizations: FakeOrganization[] = [
    { id: "acme-demo", displayName: "Acme Demo" },
    // REQ-2-1-2 evolution: the identifier a `EVO-LAB-02` submission collides
    // with, and the REQ-2-4 audit-log organization (named by identifier).
    { id: "evo-lab-02", displayName: "Evo Lab Two" },
    { id: "evo-audit-org", displayName: "evo-audit-org" },
  ];
  const memberships: FakeMembership[] = [
    { organizationId: "acme-demo", username: "org-owner", role: "Owner" },
    { organizationId: "acme-demo", username: "team-maintainer", role: "Owner" },
    { organizationId: "acme-demo", username: "bob-reviewer", role: "Member" },
    { organizationId: "acme-demo", username: "existing-member", role: "Member" },
    { organizationId: "acme-demo", username: "org-member", role: "Member" },
    { organizationId: "acme-demo", username: "protected-member", role: "Member" },
    { organizationId: "evo-lab-02", username: "evo-org-owner", role: "Owner" },
    { organizationId: "evo-audit-org", username: "evo-audit-owner", role: "Owner" },
    { organizationId: "evo-audit-org", username: "evo-audit-viewer", role: "Member" },
  ];
  const teams: FakeTeam[] = [
    { organizationId: "acme-demo", name: "platform-team", parentName: null },
    { organizationId: "acme-demo", name: "frontend-team", parentName: "platform-team" },
    { organizationId: "acme-demo", name: "frontend-child", parentName: "frontend-team" },
    { organizationId: "acme-demo", name: "access-role-team", parentName: null },
  ];
  const teamMembers: FakeTeamMember[] = [];
  const branches: FakeBranch[] = [];
  const commits: FakeCommit[] = [];
  const repositories: FakeRepository[] = [];

  /** Seeds a repository together with its default branch and commit history. */
  const seedRepository = (
    spec: Omit<FakeRepository, "defaultBranch">,
    history: FakeHistoryEntry[],
  ): FakeRepository => {
    const repository: FakeRepository = {
      ...spec,
      defaultBranch: "main",
      forkOfRepositoryId: spec.forkOfRepositoryId ?? null,
    };
    repositories.push(repository);
    history.forEach((entry, index) => {
      commits.push({
        id: `commit-${repository.id}-${index + 1}`,
        repositoryId: repository.id,
        branch: "main",
        message: entry.message,
        authorName: entry.author,
        createdAt: entry.createdAt,
        parentCommitId: index === 0 ? null : `commit-${repository.id}-${index}`,
        files: entry.files.map((file) => ({ ...file })),
      });
    });
    branches.push({
      id: `branch-${repository.id}-main`,
      repositoryId: repository.id,
      name: "main",
      headCommitId: `commit-${repository.id}-${history.length}`,
      createdAt: history[0].createdAt,
    });
    return repository;
  };

  /** Seeds one repository with several named branches of its own chains. */
  const seedBranchSet = (
    spec: Omit<FakeRepository, "defaultBranch"> & { defaultBranch?: string },
    seeds: FakeBranchSeed[],
  ): FakeRepository => {
    const repository: FakeRepository = {
      ...spec,
      defaultBranch: spec.defaultBranch ?? "main",
      forkOfRepositoryId: spec.forkOfRepositoryId ?? null,
    };
    repositories.push(repository);
    for (const seed of seeds) {
      const ids: string[] = [];
      seed.commits.forEach((entry, index) => {
        const baseSeed = entry.base ? seeds.find((candidate) => candidate.name === entry.base) : null;
        const parentCommitId =
          index > 0
            ? ids[index - 1]
            : entry.base && baseSeed
              ? `commit-${repository.id}-${entry.base}-${baseSeed.commits.length}`
              : null;
        const id = `commit-${repository.id}-${seed.name}-${index + 1}`;
        ids.push(id);
        commits.push({
          id,
          repositoryId: repository.id,
          branch: seed.name,
          message: entry.message,
          authorName: entry.author,
          createdAt: entry.createdAt,
          parentCommitId,
          files: entry.files.map((file) => ({ ...file })),
        });
      });
      branches.push({
        id: `branch-${repository.id}-${seed.name}`,
        repositoryId: repository.id,
        name: seed.name,
        headCommitId: ids[ids.length - 1] ?? null,
        createdAt: seed.commits[0].createdAt,
      });
    }
    return repository;
  };

  seedRepository(
    {
      id: "repo-acme-docs",
      ownerType: "organization",
      ownerId: "acme-demo",
      ownerDisplayName: "Acme Demo",
      name: "acme-docs",
      description: "Documentation for the Acme Demo organization.",
      visibility: "public",
      forkOfRepositoryId: null,
      updatedAt: "2024-05-01T10:00:00.000Z",
    },
    ACEME_DOCS_HISTORY,
  );
  seedRepository(
    {
      id: "repo-secret-research",
      ownerType: "organization",
      ownerId: "acme-demo",
      ownerDisplayName: "Acme Demo",
      name: "secret-research",
      description: "Internal research notes.",
      visibility: "private",
      forkOfRepositoryId: null,
      updatedAt: "2024-06-15T09:30:00.000Z",
    },
    singleHistory(SEED_FILES.secretResearch, "org-owner", "2024-06-15T09:30:00.000Z"),
  );
  seedRepository(
    {
      id: "repo-visibility-demo",
      ownerType: "organization",
      ownerId: "acme-demo",
      ownerDisplayName: "Acme Demo",
      name: "visibility-demo",
      description: "Demonstrates repository visibility and permission checks.",
      visibility: "private",
      forkOfRepositoryId: null,
      updatedAt: "2024-07-10T12:00:00.000Z",
    },
    singleHistory(SEED_FILES.visibilityDemo, "visibility-admin", "2024-07-10T12:00:00.000Z"),
  );
  seedRepository(
    {
      id: "repo-repo-owner-acme-docs",
      ownerType: "account",
      ownerId: "account-repo-owner",
      ownerDisplayName: "repo-owner",
      name: "acme-docs",
      description: "Existing personal repository used for duplicate-name validation.",
      visibility: "private",
      forkOfRepositoryId: null,
      updatedAt: "2024-08-01T08:00:00.000Z",
    },
    singleHistory(SEED_FILES.personalAcmeDocs, "repo-owner", "2024-08-01T08:00:00.000Z"),
  );
  seedRepository(
    {
      id: "repo-fork-user-acme-docs-fork",
      ownerType: "account",
      ownerId: "account-fork-user",
      ownerDisplayName: "fork-user",
      name: "acme-docs-fork",
      description: "A fork of acme-docs.",
      visibility: "private",
      forkOfRepositoryId: "repo-acme-docs",
      updatedAt: "2024-08-02T08:00:00.000Z",
    },
    ACEME_DOCS_HISTORY,
  );
  // REQ-4-3-1 / REQ-4-3-2: two branches with a target-only file.
  seedBranchSet(
    {
      id: "repo-branch-switch-demo",
      ownerType: "organization",
      ownerId: "acme-demo",
      ownerDisplayName: "Acme Demo",
      name: "branch-switch-demo",
      description: "Demonstrates listing and switching repository branches.",
      visibility: "public",
      forkOfRepositoryId: null,
      updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    },
    BRANCH_SWITCH_BRANCHES,
  );
  // REQ-4-3-3: the default branch an administrator moves to `release`.
  seedBranchSet(
    {
      id: "repo-default-branch-demo",
      ownerType: "organization",
      ownerId: "acme-demo",
      ownerDisplayName: "Acme Demo",
      name: "default-branch-demo",
      description: "Demonstrates changing the repository default branch.",
      visibility: "public",
      forkOfRepositoryId: null,
      updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    DEFAULT_BRANCH_BRANCHES,
  );
  // REQ-4-4: the repository the Write contributor adds files to.
  seedRepository(
    {
      id: "repo-file-management-demo",
      ownerType: "organization",
      ownerId: "acme-demo",
      ownerDisplayName: "Acme Demo",
      name: "file-management-demo",
      description: "Demonstrates adding a file through the web editor.",
      visibility: "public",
      forkOfRepositoryId: null,
      updatedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    },
    singleHistory(
      [
        {
          path: "README.md",
          content: "# file-management-demo\n\nDemonstrates adding a file through the web editor.\n",
        },
      ],
      "org-owner",
      new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    ),
  );
  // REQ-6-1: the public repository whose `main` branch is protected and whose
  // Open pull request carries the `test` status check.
  seedBranchSet(
    {
      id: "repo-branch-protection-demo",
      ownerType: "organization",
      ownerId: "acme-demo",
      ownerDisplayName: "Acme Demo",
      name: "branch-protection-demo",
      description: "Demonstrates branch protection rules and pull request checks.",
      visibility: "public",
      forkOfRepositoryId: null,
      updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    },
    BRANCH_PROTECTION_BRANCHES,
  );
  // REQ-3-1 evolution: the two public repositories the global repository
  // search locates by name and by persisted description, plus the REQ-3-5
  // archive repositories (the active one and the two that start out archived).
  // Their stored status is what the overview marker and the write rules read,
  // exactly like the server seeds.
  seedRepository(
    {
      id: "repo-evo-search-catalog-s1",
      ownerType: "account",
      ownerId: "account-evo-search-owner",
      ownerDisplayName: "evo-search-owner",
      name: "evo-search-catalog-s1",
      description: "Repository catalog fixture for the evolution search scenarios.",
      visibility: "public",
      forkOfRepositoryId: null,
      updatedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    },
    singleHistory(
      SEED_FILES.evoSearchCatalog,
      "evo-search-owner",
      new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    ),
  );
  seedRepository(
    {
      id: "repo-evo-search-notebook-s2",
      ownerType: "account",
      ownerId: "account-evo-search-owner",
      ownerDisplayName: "evo-search-owner",
      name: "evo-search-notebook-s2",
      description: "Notebook notes for the evolution-notebook track.",
      visibility: "public",
      forkOfRepositoryId: null,
      updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    singleHistory(
      SEED_FILES.evoSearchNotebook,
      "evo-search-owner",
      new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    ),
  );
  seedRepository(
    {
      id: "repo-evo-archive-repository-s1",
      ownerType: "account",
      ownerId: "account-evo-archive-owner",
      ownerDisplayName: "evo-archive-owner",
      name: "evo-archive-repository-s1",
      description: "Active repository of the archive scenarios.",
      visibility: "public",
      forkOfRepositoryId: null,
      archived: false,
      updatedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    },
    singleHistory(
      SEED_FILES.evoArchiveActive,
      "evo-archive-owner",
      new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    ),
  );
  seedRepository(
    {
      id: "repo-evo-archive-repository-s2",
      ownerType: "account",
      ownerId: "account-evo-archive-owner",
      ownerDisplayName: "evo-archive-owner",
      name: "evo-archive-repository-s2",
      description: "Archived repository of the archive scenarios.",
      visibility: "public",
      forkOfRepositoryId: null,
      archived: true,
      updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    },
    singleHistory(
      SEED_FILES.evoArchiveS2,
      "evo-archive-owner",
      new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    ),
  );
  seedRepository(
    {
      id: "repo-evo-archive-repository-s3",
      ownerType: "account",
      ownerId: "account-evo-archive-owner",
      ownerDisplayName: "evo-archive-owner",
      name: "evo-archive-repository-s3",
      description: "Archived repository of the archive scenarios.",
      visibility: "public",
      forkOfRepositoryId: null,
      archived: true,
      updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    singleHistory(
      SEED_FILES.evoArchiveS3,
      "evo-archive-owner",
      new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    ),
  );
  // REQ-4-3-1 evolution: the three public branch-switching fixtures whose
  // active branch is `evo-main-sN` and whose `evo-feature-sN` reference carries
  // the target-only file the scenarios expect.
  seedBranchSet(
    {
      id: "repo-evo-branch-switch-s1",
      ownerType: "account",
      ownerId: "account-evo-branch-owner",
      ownerDisplayName: "evo-branch-owner",
      name: "evo-branch-switch-s1",
      description: "Branch switching fixture of the evolution scenarios.",
      visibility: "public",
      defaultBranch: "evo-main-s1",
      forkOfRepositoryId: null,
      updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    evoBranchSwitchBranches(1, "evo-target-s1.md"),
  );
  seedBranchSet(
    {
      id: "repo-evo-branch-switch-s2",
      ownerType: "account",
      ownerId: "account-evo-branch-owner",
      ownerDisplayName: "evo-branch-owner",
      name: "evo-branch-switch-s2",
      description: "Branch switching fixture of the evolution scenarios.",
      visibility: "public",
      defaultBranch: "evo-main-s2",
      forkOfRepositoryId: null,
      updatedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    },
    evoBranchSwitchBranches(2),
  );
  seedBranchSet(
    {
      id: "repo-evo-branch-switch-s3",
      ownerType: "account",
      ownerId: "account-evo-branch-owner",
      ownerDisplayName: "evo-branch-owner",
      name: "evo-branch-switch-s3",
      description: "Branch switching fixture of the evolution scenarios.",
      visibility: "public",
      defaultBranch: "evo-main-s3",
      forkOfRepositoryId: null,
      updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    },
    evoBranchSwitchBranches(3, "evo-target-s3.md"),
  );
  // REQ-4-5: the three public release fixtures, owned by the account that may
  // publish a release.
  for (const index of [1, 2, 3]) {
    seedBranchSet(
      {
        id: `repo-evo-release-repository-s${index}`,
        ownerType: "account",
        ownerId: "account-evo-release-owner",
        ownerDisplayName: "evo-release-owner",
        name: `evo-release-repository-s${index}`,
        description: "Release fixture of the evolution scenarios.",
        visibility: "public",
        defaultBranch: `evo-main-s${index}`,
        forkOfRepositoryId: null,
        updatedAt: new Date(Date.now() - (7 - index) * 24 * 60 * 60 * 1000).toISOString(),
      },
      evoReleaseBranches(index),
    );
  }

  /**
   * Seeds the public reaction repository of the evolution scenarios together
   * with its README (REQ-5-5).
   */
  seedRepository(
    {
      id: EVO_REACTION_REPOSITORY_ID,
      ownerType: "account",
      ownerId: "account-evo-reaction-author",
      ownerDisplayName: "evo-reaction-author",
      name: EVO_REACTION_REPOSITORY_ID.replace(/^repo-/, ""),
      description: "Reaction fixture of the evolution scenarios.",
      visibility: "public",
      forkOfRepositoryId: null,
      updatedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    },
    singleHistory(
      EVO_REACTION_README,
      "evo-reaction-author",
      new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    ),
  );

  // The releases the server already published (REQ-4-5).
  const releases: FakeRelease[] = EVO_RELEASES.map((seed, index) => ({
    id: `release-${index + 1}`,
    repositoryId: seed.repositoryId,
    tag: seed.tag,
    title: seed.title,
    description: seed.description,
    branch: seed.branch,
    author: seed.author,
    createdAt: seed.createdAt,
  }));
  // REQ-6: the pull-request source branches of `acme-docs`, on top of its
  // stored `main` head, so the comparison reads the same revisions.
  for (const spec of ACEME_DOCS_EXTRA_BRANCHES) {
    const id = `commit-repo-acme-docs-${spec.name}-1`;
    commits.push({
      id,
      repositoryId: "repo-acme-docs",
      branch: spec.name,
      message: spec.message,
      authorName: spec.author,
      createdAt: spec.createdAt,
      parentCommitId: spec.parentCommitId,
      files: spec.files.map((file) => ({ ...file })),
    });
    branches.push({
      id: `branch-repo-acme-docs-${spec.name}`,
      repositoryId: "repo-acme-docs",
      name: spec.name,
      headCommitId: id,
      createdAt: spec.createdAt,
    });
  }
  // REQ-2-4: the persisted organization actions of `evo-audit-org`.
  interface FakeAuditEvent {
    id: string;
    organizationId: string;
    actorName: string;
    action: string;
    target: string;
    createdAt: string;
  }

  const AUDIT_ACTIONS = {
    organizationCreated: "Organization created",
    memberAdded: "Member added",
    memberRemoved: "Member removed",
    teamCreated: "Team created",
    repositoryCreated: "Repository created",
  };

  const auditEvents: FakeAuditEvent[] = [
    {
      id: "audit-evo-audit-org-created",
      organizationId: "evo-audit-org",
      actorName: "evo-audit-owner",
      action: AUDIT_ACTIONS.organizationCreated,
      target: "evo-audit-org",
      createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "audit-evo-audit-org-member-added",
      organizationId: "evo-audit-org",
      actorName: "evo-audit-owner",
      action: AUDIT_ACTIONS.memberAdded,
      target: "evo-audit-viewer",
      createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "audit-evo-audit-org-repository-created",
      organizationId: "evo-audit-org",
      actorName: "evo-audit-owner",
      action: AUDIT_ACTIONS.repositoryCreated,
      target: "evo-audit-repo",
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  const recordAuditEvent = ({
    organizationId,
    actorName,
    action,
    target,
  }: {
    organizationId: string;
    actorName: string;
    action: string;
    target: string;
  }) => {
    auditEvents.push({
      id: `audit-${auditEvents.length + 1}`,
      organizationId,
      actorName,
      action,
      target,
      createdAt: new Date().toISOString(),
    });
  };

  // REQ-2-4: the private repository the seeded "Repository created" event
  // refers to; it keeps the audit organization out of the public list.
  seedRepository(
    {
      id: "repo-evo-audit-repo",
      ownerType: "organization",
      ownerId: "evo-audit-org",
      ownerDisplayName: "evo-audit-org",
      name: "evo-audit-repo",
      description: "Repository recorded by the organization audit log.",
      visibility: "private",
      forkOfRepositoryId: null,
      updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    },
    singleHistory(
      [{ path: "README.md", content: "# evo-audit-repo\n" }],
      "evo-audit-owner",
      new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    ),
  );

  const grants: FakeGrant[] = [
    { id: "grant-access-role-team", repositoryId: "repo-acme-docs", subjectType: "team", subjectId: "access-role-team", role: "Write" },
    { id: "grant-repo-admin", repositoryId: "repo-acme-docs", subjectType: "account", subjectId: "repo-admin", role: "Admin" },
    { id: "grant-visibility-admin", repositoryId: "repo-visibility-demo", subjectType: "account", subjectId: "visibility-admin", role: "Admin" },
    { id: "grant-visibility-collaborator", repositoryId: "repo-visibility-demo", subjectType: "account", subjectId: "collaborator", role: "Read" },
    // REQ-4-3-2 / REQ-4-4 / REQ-4-3-3: the write permissions of the branch,
    // file and default-branch scenarios; the viewer holds no grant at all.
    { id: "grant-branch-contributor", repositoryId: "repo-branch-switch-demo", subjectType: "account", subjectId: "branch-contributor", role: "Write" },
    { id: "grant-file-contributor", repositoryId: "repo-file-management-demo", subjectType: "account", subjectId: "file-contributor", role: "Write" },
    { id: "grant-default-branch-admin", repositoryId: "repo-default-branch-demo", subjectType: "account", subjectId: "default-branch-admin", role: "Admin" },
    // REQ-5-2: the issue author and commenter hold Write on `acme-docs`.
    { id: "grant-issue-author", repositoryId: "repo-acme-docs", subjectType: "account", subjectId: "issue-author", role: "Write" },
    { id: "grant-issue-commenter", repositoryId: "repo-acme-docs", subjectType: "account", subjectId: "issue-commenter", role: "Write" },
    // REQ-5-2-2 / REQ-5-3: the editor holds Maintain, which covers both the
    // content edits and the metadata operations of `acme-docs`.
    { id: "grant-issue-editor", repositoryId: "repo-acme-docs", subjectType: "account", subjectId: "issue-editor", role: "Maintain" },
    // REQ-5-4: the viewer holds only Read, so no status transition is offered.
    { id: "grant-issue-viewer", repositoryId: "repo-acme-docs", subjectType: "account", subjectId: "issue-viewer", role: "Read" },
    // REQ-6: the PR contributor writes on `acme-docs`; the protection Admin
    // administers `branch-protection-demo`; `protection-viewer` holds nothing.
    { id: "grant-pr-contributor", repositoryId: "repo-acme-docs", subjectType: "account", subjectId: "pr-contributor", role: "Write" },
    { id: "grant-draft-author", repositoryId: "repo-acme-docs", subjectType: "account", subjectId: "draft-author", role: "Write" },
    { id: "grant-pr-reviewer", repositoryId: "repo-acme-docs", subjectType: "account", subjectId: "pr-reviewer", role: "Write" },
    // REQ-6-3-4 / REQ-6-4 / REQ-6-5 / REQ-6-6: the reviewer whose approval is
    // seeded, the pull-request author, the Maintain merger and the Read-only
    // viewer of `acme-docs`.
    { id: "grant-bob-reviewer", repositoryId: "repo-acme-docs", subjectType: "account", subjectId: "bob-reviewer", role: "Write" },
    { id: "grant-pr-author", repositoryId: "repo-acme-docs", subjectType: "account", subjectId: "pr-author", role: "Write" },
    { id: "grant-pr-maintainer", repositoryId: "repo-acme-docs", subjectType: "account", subjectId: "pr-maintainer", role: "Maintain" },
    { id: "grant-pr-viewer", repositoryId: "repo-acme-docs", subjectType: "account", subjectId: "pr-viewer", role: "Read" },
    { id: "grant-protection-admin", repositoryId: "repo-branch-protection-demo", subjectType: "account", subjectId: "protection-admin", role: "Admin" },
    // REQ-3-5: the repository-administrator permission of the archive
    // repositories and the read permission of the Member account.
    { id: "grant-evo-archive-admin-s1", repositoryId: "repo-evo-archive-repository-s1", subjectType: "account", subjectId: "evo-archive-admin", role: "Admin" },
    { id: "grant-evo-archive-admin-s2", repositoryId: "repo-evo-archive-repository-s2", subjectType: "account", subjectId: "evo-archive-admin", role: "Admin" },
    { id: "grant-evo-archive-admin-s3", repositoryId: "repo-evo-archive-repository-s3", subjectType: "account", subjectId: "evo-archive-admin", role: "Admin" },
    { id: "grant-evo-archive-viewer-s2", repositoryId: "repo-evo-archive-repository-s2", subjectType: "account", subjectId: "evo-archive-viewer", role: "Read" },
  ];

  // Pull requests, their activity and their status checks (REQ-6).
  const pullRequests: FakePullRequest[] = PULL_REQUEST_SEEDS.map((seed) => ({
    id: seed.id,
    repositoryId: seed.repositoryId,
    number: seed.number,
    title: seed.title,
    description: seed.description,
    status: seed.status,
    authorName: seed.author,
    sourceBranch: seed.sourceBranch,
    targetBranch: seed.targetBranch,
    baseCommitId: seed.baseCommitId,
    creationCompareCommitId: seed.creationCompareCommitId,
    createdAt: seed.createdAt,
    updatedAt: seed.createdAt,
    checks: seed.checks.map((check) => ({ ...check, setter: null })),
    requestedReviewers: [...(seed.requestedReviewers ?? [])],
  }));
  const pullRequestEvents: FakePullRequestEvent[] = pullRequests.map((pull, index) => ({
    id: `event-${pull.id}-${index + 1}`,
    pullRequestId: pull.id,
    type: "created",
    actorName: pull.authorName,
    detail: "",
    createdAt: pull.createdAt,
  }));
  const reviewComments: FakeReviewComment[] = [];
  const reviews: FakeReviewDecision[] = PULL_REQUEST_REVIEW_SEEDS.map((seed) => ({
    id: seed.id,
    pullRequestId: seed.pullRequestId,
    reviewerName: seed.reviewer,
    decision: seed.decision,
    summary: seed.summary,
    commitId: seed.commitId,
    createdAt: seed.createdAt,
  }));
  const branchProtectionRules: FakeBranchProtectionRule[] = ACEME_DOCS_PROTECTION_RULES.map((rule) => ({
    ...rule,
  }));

  // Issue records, their discussion and their append-only timeline (REQ-5).
  const issueLabels: FakeIssueLabel[] = ACEME_DOCS_ISSUE_LABELS.map((label) => ({
    id: `label-acme-docs-${label.name}`,
    repositoryId: "repo-acme-docs",
    name: label.name,
    color: label.color,
  }));
  const issueMilestones = ACEME_DOCS_MILESTONES.map((name) => ({
    id: `milestone-acme-docs-${name}`,
    repositoryId: "repo-acme-docs",
    name,
  }));
  const issues: FakeIssue[] = [];
  const issueComments: FakeIssueComment[] = [];
  const issueEvents: FakeIssueEvent[] = [];
  const issueReactions: FakeIssueReaction[] = [];
  /** Seeds the issues of one repository, keeping the repository-scoped ids. */
  const seedIssueRecords = (repositoryId: string, seeds: FakeIssueSeed[]) => {
    for (const seed of seeds) {
      const id = `issue-${repositoryId.replace(/^repo-/, "")}-${seed.number}`;
      issues.push({
        id,
        repositoryId,
        number: seed.number,
        title: seed.title,
        description: seed.description,
        status: seed.status,
        authorName: seed.author,
        labelIds: seed.labels.map((name) => `label-acme-docs-${name}`),
        assigneeIds: [],
        milestoneId: null,
        createdAt: seed.createdAt,
        updatedAt: seed.createdAt,
      });
      issueEvents.push({
        id: `event-${id}-1`,
        issueId: id,
        type: "created",
        actorName: seed.author,
        createdAt: seed.createdAt,
      });
      for (const comment of seed.comments) {
        const commentId = `comment-${id}-${issueComments.length + 1}`;
        issueComments.push({
          id: commentId,
          issueId: id,
          authorName: comment.author,
          body: comment.body,
          createdAt: seed.createdAt,
        });
        issueEvents.push({
          id: `event-${id}-${issueEvents.length + 1}`,
          issueId: id,
          type: "commented",
          actorName: comment.author,
          createdAt: seed.createdAt,
        });
      }
    }
  };
  seedIssueRecords("repo-acme-docs", ACEME_DOCS_ISSUES);
  seedIssueRecords(EVO_REACTION_REPOSITORY_ID, EVO_REACTION_ISSUES);
  // REQ-5-5: the one `+1` the third reaction issue already carries. The other
  // two adaptation issues start without any reaction at all.
  issueReactions.push({
    id: EVO_REACTION_SEED_REACTION.id,
    issueId: `issue-${EVO_REACTION_REPOSITORY_ID.replace(/^repo-/, "")}-${EVO_REACTION_SEED_REACTION.issueNumber}`,
    type: EVO_REACTION_SEED_REACTION.type,
    accountId: `account-${EVO_REACTION_SEED_REACTION.author}`,
    accountName: EVO_REACTION_SEED_REACTION.author,
    createdAt: EVO_REACTION_SEED_REACTION.createdAt,
  });

  const organization = (id: string) => organizations.find((entry) => entry.id === id) ?? null;
  const accountByIdentifier = (identifier: string): { username: string; email: string } | null => {
    const value = identifier.trim();
    if (!value) return null;
    const lowered = value.toLowerCase();
    return listAccounts().find((entry) => entry.username === value || entry.email.toLowerCase() === lowered) ?? null;
  };
  const membershipOf = (organizationId: string, username: string | null) =>
    username
      ? memberships.find((entry) => entry.organizationId === organizationId && entry.username === username) ?? null
      : null;
  const teamOf = (organizationId: string, name: string) =>
    teams.find((entry) => entry.organizationId === organizationId && entry.name === name) ?? null;
  const repositoryOf = (owner: string, name: string) =>
    repositories.find(
      (entry) =>
        entry.name === name &&
        (entry.ownerId === owner ||
          (entry.ownerType === "account" && entry.ownerDisplayName === owner)),
    ) ?? null;

  /** Resolves the owner selected on the creation/fork form. */
  const namespaceOf = (ownerType: "organization" | "account", value: string) => {
    if (ownerType === "organization") {
      const found = organization(value);
      return found
        ? { ownerType: "organization" as const, ownerId: found.id, displayName: found.displayName }
        : null;
    }
    const byName = accountByIdentifier(value);
    if (byName) {
      const ownerId = `account-${byName.username}`;
      return { ownerType: "account" as const, ownerId, displayName: byName.username };
    }
    const byId = listAccounts().find((entry) => `account-${entry.username}` === value);
    return byId
      ? { ownerType: "account" as const, ownerId: value, displayName: byId.username }
      : null;
  };

  const viewer = () => {
    const username = currentUsername();
    if (!username) return null;
    return { username, accountId: currentAccountId() };
  };
  const canRead = (repository: FakeRepository, viewer: { username: string; accountId: string | null } | null): boolean => {
    if (repository.visibility === "public") return true;
    if (!viewer) return false;
    if (repository.ownerType === "account" && repository.ownerId === viewer.accountId) return true;
    if (repository.ownerType === "organization" && membershipOf(repository.ownerId, viewer.username)?.role === "Owner") {
      return true;
    }
    if (
      grants.some(
        (grant) =>
          grant.repositoryId === repository.id &&
          grant.subjectType === "account" &&
          grant.subjectId === viewer.username,
      )
    ) {
      return true;
    }
    const teamsOfAccount = new Set(
      teamMembers.filter((entry) => entry.username === viewer.username).map((entry) => entry.teamName),
    );
    return grants.some(
      (grant) =>
        grant.repositoryId === repository.id &&
        grant.subjectType === "team" &&
        teamsOfAccount.has(grant.subjectId),
    );
  };

  /** The address of an account-owned repository uses the username. */
  const ownerAddress = (repository: FakeRepository) =>
    repository.ownerType === "account" ? repository.ownerDisplayName : repository.ownerId;

  const describeRepository = (repository: FakeRepository) => ({
    id: repository.id,
    name: repository.name,
    description: repository.description,
    visibility: repository.visibility,
    defaultBranch: repository.defaultBranch,
    forkOfRepositoryId: repository.forkOfRepositoryId,
    archived: repository.archived === true,
    updatedAt: repository.updatedAt,
    owner: { id: ownerAddress(repository), displayName: repository.ownerDisplayName },
  });

  // Directory listing, file content, history, commit difference and code
  // search of the default branch; they share the read check used above.
  const codeApi = createFakeCodeApi({
    repositories,
    commits,
    branches,
    canRead,
    describeRepository,
  });

  const describeDetail = (
    repository: FakeRepository,
    viewer: { username: string; accountId: string | null } | null,
  ) => {
    const source = repository.forkOfRepositoryId
      ? repositories.find((entry) => entry.id === repository.forkOfRepositoryId) ?? null
      : null;
    const files = codeApi.headFiles(repository) ?? [];
    const readme = files.find((file) => !file.path.includes("/") && README_PATTERN.test(file.path));
    return {
      ...describeRepository(repository),
      canManage: canManage(repository, viewer),
      canWrite: canWrite(repository, viewer),
      fork: source
        ? {
            id: source.id,
            name: source.name,
            owner: { id: ownerAddress(source), displayName: source.ownerDisplayName },
          }
        : null,
      readmePath: readme ? readme.path : null,
      commitCount: codeApi.repositoryCommits(repository).length,
    };
  };

  const canManage = (
    repository: FakeRepository,
    viewer: { username: string; accountId: string | null } | null,
  ): boolean => {
    if (!viewer) return false;
    if (repository.ownerType === "account" && repository.ownerId === viewer.accountId) return true;
    if (repository.ownerType === "organization" && membershipOf(repository.ownerId, viewer.username)?.role === "Owner") {
      return true;
    }
    const teamsOfAccount = new Set(
      teamMembers.filter((entry) => entry.username === viewer.username).map((entry) => entry.teamName),
    );
    return grants.some(
      (grant) =>
        grant.repositoryId === repository.id &&
        grant.role === "Admin" &&
        ((grant.subjectType === "account" && grant.subjectId === viewer.username) ||
          (grant.subjectType === "team" && teamsOfAccount.has(grant.subjectId))),
    );
  };
  const canWrite = (
    repository: FakeRepository,
    viewer: { username: string; accountId: string | null } | null,
  ): boolean => {
    // REQ-3-5: an archived repository is read-only for every caller.
    if (repository.archived === true) return false;
    if (!viewer) return false;
    if (repository.ownerType === "account" && repository.ownerId === viewer.accountId) return true;
    if (repository.ownerType === "organization" && membershipOf(repository.ownerId, viewer.username)?.role === "Owner") {
      return true;
    }
    const teamsOfAccount = new Set(
      teamMembers.filter((entry) => entry.username === viewer.username).map((entry) => entry.teamName),
    );
    return grants.some(
      (grant) =>
        grant.repositoryId === repository.id &&
        ["Write", "Maintain", "Admin"].includes(grant.role) &&
        ((grant.subjectType === "account" && grant.subjectId === viewer.username) ||
          (grant.subjectType === "team" && teamsOfAccount.has(grant.subjectId))),
    );
  };
  const canTriage = (
    repository: FakeRepository,
    viewer: { username: string; accountId: string | null } | null,
  ): boolean => {
    // REQ-3-5: the issue metadata of an archived repository is read-only too.
    if (repository.archived === true) return false;
    if (!viewer) return false;
    if (repository.ownerType === "account" && repository.ownerId === viewer.accountId) return true;
    if (repository.ownerType === "organization" && membershipOf(repository.ownerId, viewer.username)?.role === "Owner") {
      return true;
    }
    const teamsOfAccount = new Set(
      teamMembers.filter((entry) => entry.username === viewer.username).map((entry) => entry.teamName),
    );
    return grants.some(
      (grant) =>
        grant.repositoryId === repository.id &&
        ["Triage", "Maintain", "Admin"].includes(grant.role) &&
        ((grant.subjectType === "account" && grant.subjectId === viewer.username) ||
          (grant.subjectType === "team" && teamsOfAccount.has(grant.subjectId))),
    );
  };

  /** One issue row of the list view; seed names and labels are read from state. */
  const describeIssue = (issue: FakeIssue) => ({
    number: issue.number,
    title: issue.title,
    description: issue.description,
    status: issue.status,
    author: issue.authorName,
    labels: issue.labelIds
      .map((id) => issueLabels.find((label) => label.id === id) ?? null)
      .filter((label): label is FakeIssueLabel => label !== null)
      .map((label) => ({ name: label.name, color: label.color })),
    assignees: issue.assigneeIds
      .map((id) => listAccounts().find((account) => `account-${account.username}` === id)?.username)
      .filter((username): username is string => Boolean(username)),
    milestone: issue.milestoneId
      ? { name: issueMilestones.find((entry) => entry.id === issue.milestoneId)?.name ?? "" }
      : null,
    commentCount: issueComments.filter((entry) => entry.issueId === issue.id).length,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  });

  /** Usernames an issue-metadata editor may assign (REQ-5-3-1). */
  const eligibleAssignees = (repository: FakeRepository): string[] => {
    const names = new Set<string>();
    if (repository.ownerType === "account") names.add(repository.ownerDisplayName);
    if (repository.ownerType === "organization") {
      for (const membership of memberships) {
        if (membership.organizationId === repository.ownerId) names.add(membership.username);
      }
    }
    const teamsOfGrant = new Set(
      grants
        .filter((grant) => grant.repositoryId === repository.id && grant.subjectType === "team")
        .map((grant) => grant.subjectId),
    );
    for (const grant of grants) {
      if (grant.repositoryId !== repository.id) continue;
      if (grant.subjectType === "account") names.add(grant.subjectId);
      else {
        for (const member of teamMembers) {
          if (member.teamName === grant.subjectId && teamsOfGrant.has(member.teamName)) {
            names.add(member.username);
          }
        }
      }
    }
    return [...names].sort((left, right) => left.localeCompare(right));
  };

  const issueViewPayload = (
    repository: FakeRepository,
    issue: FakeIssue,
    viewer: { username: string; accountId: string | null } | null,
  ) => ({
    repository: describeRepository(repository),
    issue: describeIssue(issue),
    comments: issueComments
      .filter((entry) => entry.issueId === issue.id)
      .map((entry) => ({
        id: entry.id,
        author: entry.authorName,
        body: entry.body,
        createdAt: entry.createdAt,
      })),
    events: issueEvents
      .filter((entry) => entry.issueId === issue.id)
      .map((entry) => ({
        id: entry.id,
        type: entry.type,
        actor: entry.actorName,
        detail: entry.detail ?? "",
        createdAt: entry.createdAt,
      })),
    canWrite: canWrite(repository, viewer),
    canTriage: canTriage(repository, viewer),
    availableLabels: issueLabels.map((label) => ({ name: label.name, color: label.color })),
    availableMilestones: issueMilestones.map((entry) => ({ name: entry.name })),
    availableAssignees: canTriage(repository, viewer) ? eligibleAssignees(repository) : [],
    // REQ-5-5: every supported reaction with its stored count and whether this
    // viewer is the account that added it.
    reactions: ISSUE_REACTION_TYPES.map((type) => {
      const entries = issueReactions.filter(
        (reaction) => reaction.issueId === issue.id && reaction.type === type,
      );
      return {
        type,
        count: entries.length,
        reacted: Boolean(viewer) && entries.some((entry) => entry.accountId === viewer?.accountId),
      };
    }),
    canReact: viewer !== null,
  });

  const issueListPayload = (
    repository: FakeRepository,
    viewer: { username: string; accountId: string | null } | null,
  ) => ({
    repository: describeRepository(repository),
    issues: issues
      .filter((entry) => entry.repositoryId === repository.id)
      .sort((left, right) => left.number - right.number)
      .map(describeIssue),
    canWrite: canWrite(repository, viewer),
    canTriage: canTriage(repository, viewer),
  });

  /**
   * Review and merge permission of a pull request: Maintain or Admin, or an
   * organization Owner. Write alone is never enough (REQ-6).
   */
  const canMaintain = (
    repository: FakeRepository,
    viewer: { username: string; accountId: string | null } | null,
  ): boolean => {
    if (!viewer) return false;
    if (repository.ownerType === "account" && repository.ownerId === viewer.accountId) return true;
    if (repository.ownerType === "organization" && membershipOf(repository.ownerId, viewer.username)?.role === "Owner") {
      return true;
    }
    const teamsOfAccount = new Set(
      teamMembers.filter((entry) => entry.username === viewer.username).map((entry) => entry.teamName),
    );
    return grants.some(
      (grant) =>
        grant.repositoryId === repository.id &&
        ["Maintain", "Admin"].includes(grant.role) &&
        ((grant.subjectType === "account" && grant.subjectId === viewer.username) ||
          (grant.subjectType === "team" && teamsOfAccount.has(grant.subjectId))),
    );
  };

  const commitById = (commitId: string | null | undefined) =>
    commitId ? commits.find((entry) => entry.id === commitId) ?? null : null;

  const branchOf = (repositoryId: string, name: string) =>
    branches.find((entry) => entry.repositoryId === repositoryId && entry.name === name) ?? null;

  const chainOf = (repositoryId: string, name: string) => {
    const chain: FakeCommit[] = [];
    const seen = new Set<string>();
    let cursor = commitById(branchOf(repositoryId, name)?.headCommitId);
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      chain.push(cursor);
      cursor = commitById(cursor.parentCommitId);
    }
    return chain;
  };

  const publicCommit = (commit: FakeCommit) => ({
    id: commit.id,
    message: commit.message,
    authorName: commit.authorName,
    createdAt: commit.createdAt,
    parentCommitId: commit.parentCommitId,
  });

  const currentCompareCommitId = (pull: FakePullRequest) =>
    branchOf(pull.repositoryId, pull.sourceBranch)?.headCommitId ?? null;

  /** Commits the compare branch adds on top of the stored base commit. */
  const commitsRelativeToBase = (pull: FakePullRequest) => {
    const compareChain = chainOf(pull.repositoryId, pull.sourceBranch);
    const reachableFromBase = new Set<string>();
    let cursor = commitById(pull.baseCommitId);
    while (cursor && !reachableFromBase.has(cursor.id)) {
      reachableFromBase.add(cursor.id);
      cursor = commitById(cursor.parentCommitId);
    }
    return compareChain
      .map((commit, index) => ({ commit, index }))
      .filter(({ commit }) => !reachableFromBase.has(commit.id))
      .sort((left, right) => {
        const difference = Date.parse(right.commit.createdAt) - Date.parse(left.commit.createdAt);
        return difference !== 0 ? difference : right.index - left.index;
      })
      .map(({ commit }) => publicCommit(commit));
  };

  const changesOf = (pull: FakePullRequest) =>
    diffSnapshots(
      commitById(pull.baseCommitId)?.files ?? null,
      commitById(currentCompareCommitId(pull))?.files ?? [],
    );

  const describePull = (pull: FakePullRequest) => ({
    number: pull.number,
    title: pull.title,
    description: pull.description,
    status: pull.status,
    author: pull.authorName,
    sourceBranch: pull.sourceBranch,
    targetBranch: pull.targetBranch,
    createdAt: pull.createdAt,
    updatedAt: pull.updatedAt,
    commentCount: 0,
    compareCommitId: currentCompareCommitId(pull),
    creationCompareCommitId: pull.creationCompareCommitId,
    baseCommitId: pull.baseCommitId,
    mergedBy: pull.mergedByName ?? null,
    mergedAt: pull.mergedAt ?? null,
    mergedCommitId: pull.mergedCommitId ?? null,
  });

  const checksOf = (pull: FakePullRequest) => {
    const commitId = currentCompareCommitId(pull);
    return pull.checks
      .filter((entry) => entry.commitId === commitId || entry.commitId === null)
      .map((entry) => ({ name: entry.name, status: entry.status, setter: entry.setter }));
  };

  /** The persistent protection rule of the exact target branch (REQ-6-5). */
  const protectionRuleFor = (pull: FakePullRequest) =>
    branchProtectionRules.find(
      (rule) => rule.repositoryId === pull.repositoryId && rule.branchName === pull.targetBranch,
    ) ?? null;

  const hasMergeConflict = (pull: FakePullRequest): boolean => {
    const target = branchOf(pull.repositoryId, pull.targetBranch);
    const targetHeadId = target?.headCommitId ?? null;
    if (!targetHeadId || !pull.baseCommitId || targetHeadId === pull.baseCommitId) return false;
    const baseFiles = new Map(
      (commitById(pull.baseCommitId)?.files ?? []).map((file) => [file.path, file.content]),
    );
    const targetFiles = new Map(
      (commitById(targetHeadId)?.files ?? []).map((file) => [file.path, file.content]),
    );
    const compare = commitById(currentCompareCommitId(pull));
    for (const file of compare?.files ?? []) {
      const before = baseFiles.get(file.path);
      if (file.content === before) continue;
      if (targetFiles.has(file.path) !== baseFiles.has(file.path)) return true;
      if (targetFiles.has(file.path) && targetFiles.get(file.path) !== before) return true;
    }
    return false;
  };

  /** Merge eligibility of one pull request, mirroring the server (REQ-6-5). */
  const mergeStateOf = (repository: FakeRepository, pull: FakePullRequest) => {
    const rule = protectionRuleFor(pull);
    const compareId = currentCompareCommitId(pull);
    const valid = reviews.filter(
      (entry) => entry.pullRequestId === pull.id && entry.commitId === compareId,
    );
    const changesRequested = valid.some((entry) => entry.decision === "changes-requested");
    const approvals = valid.filter(
      (entry) => entry.decision === "approved" && entry.reviewerName !== pull.authorName,
    ).length;
    const checks = checksOf(pull);
    const approvalRequired = rule?.requireApprovals === true;
    const checkRequired = rule?.requireStatusCheck === true;
    const approvalSatisfied = !approvalRequired || approvals >= 1;
    const checkSatisfied =
      !checkRequired || checks.some((check) => check.name === "test" && check.status === "success");
    const conflict = hasMergeConflict(pull);
    // REQ-3-5: an archived repository accepts no write, so a merge into it is
    // refused by the same stored status that hides the write controls.
    const archived = repository.archived === true;
    const open = pull.status === "open";
    const conditions: Array<{ key: string; label: string; satisfied: boolean }> = [
      { key: "conflicts", label: "No merge conflicts", satisfied: !conflict },
      { key: "changes-requested", label: "No changes requested", satisfied: !changesRequested },
    ];
    if (approvalRequired) {
      conditions.push({ key: "approval", label: "At least 1 approval", satisfied: approvalSatisfied });
    }
    if (checkRequired) {
      conditions.push({ key: "check", label: "Status check test", satisfied: checkSatisfied });
    }
    const eligible = open && !archived && conditions.every((entry) => entry.satisfied);
    let blockedReason: string | null = null;
    if (archived) blockedReason = "Repository is archived";
    else if (!open) blockedReason = "This pull request cannot be merged";
    else if (conflict) blockedReason = "This branch has conflicts that must be resolved";
    else if (changesRequested) blockedReason = "Changes requested";
    else if (!approvalSatisfied) blockedReason = "Review required by branch protection";
    else if (!checkSatisfied) blockedReason = "Required status check is not successful";
    return {
      eligible,
      method: "Create a merge commit",
      conditions,
      reviewRequired: approvalRequired && !approvalSatisfied,
      blockedReason,
    };
  };

  const pullViewPayload = (
    repository: FakeRepository,
    pull: FakePullRequest,
    viewer: { username: string; accountId: string | null } | null,
  ) => {
    const difference = changesOf(pull);
    const base = commitById(pull.baseCommitId);
    const compare = commitById(currentCompareCommitId(pull));
    return {
      repository: describeRepository(repository),
      pullRequest: describePull(pull),
      baseCommit: base ? publicCommit(base) : null,
      compareCommit: compare ? publicCommit(compare) : null,
      commits: commitsRelativeToBase(pull),
      changes: difference.files,
      totals: difference.totals,
      checks: checksOf(pull),
      comments: [],
      reviewComments: reviewComments
        .filter((entry) => entry.pullRequestId === pull.id)
        .map((entry) => ({
          id: entry.id,
          author: entry.authorName,
          body: entry.body,
          filePath: entry.filePath,
          lineIndex: entry.lineIndex,
          state: entry.state,
          commitId: entry.commitId,
          outdated: entry.commitId !== currentCompareCommitId(pull),
          createdAt: entry.createdAt,
        })),
      events: pullRequestEvents
        .filter((entry) => entry.pullRequestId === pull.id)
        .map((entry) => ({
          id: entry.id,
          type: entry.type,
          actor: entry.actorName,
          detail: entry.detail,
          createdAt: entry.createdAt,
        })),
      reviews: reviews
        .filter((entry) => entry.pullRequestId === pull.id)
        .map((entry) => ({
          id: entry.id,
          reviewer: entry.reviewerName,
          decision: entry.decision,
          summary: entry.summary,
          commitId: entry.commitId,
          stale: entry.commitId !== currentCompareCommitId(pull),
          createdAt: entry.createdAt,
        })),
      requestedReviewers: [...pull.requestedReviewers],
      availableReviewers: eligibleAssignees(repository).filter((name) => name !== pull.authorName),
      merge: mergeStateOf(repository, pull),
      canWrite: canWrite(repository, viewer),
      canMaintain: canMaintain(repository, viewer),
      canManage: canManage(repository, viewer),
      canReview:
        Boolean(viewer) &&
        pull.status === "open" &&
        canWrite(repository, viewer) &&
        pull.authorName !== viewer?.username,
      canManageReviewers:
        Boolean(viewer) &&
        (pull.authorName === viewer?.username || canMaintain(repository, viewer)),
    };
  };

  const describeAccess = (grant: FakeGrant) => ({
    id: grant.id,
    subjectType: grant.subjectType,
    subjectName: grant.subjectId,
    role: grant.role,
  });

  const describeTeam = (team: FakeTeam) => ({
    id: `team-${team.organizationId}-${team.name}`,
    name: team.name,
    parentName: team.parentName,
  });

  return {
    canHandle(path) {
      return path.startsWith("/api/organizations") || path.startsWith("/api/repositories");
    },

    handle(path, method, body) {
      const [route, rawQuery] = path.split("?");
      const searchParams = new URLSearchParams(rawQuery ?? "");
      const segments = route.split("/").filter(Boolean).map(decodeURIComponent);
      const currentViewer = viewer();
      const username = currentViewer?.username ?? null;

      if (segments[1] === "repositories") {
        if (segments.length === 2 && method === "GET") {
          const query = searchParams.get("q")?.trim().toLowerCase() ?? "";
          return reply(200, {
            repositories: repositories
              .filter((entry) => canRead(entry, currentViewer))
              .filter(
                (entry) =>
                  query === "" ||
                  entry.name.toLowerCase().includes(query) ||
                  entry.description.toLowerCase().includes(query),
              )
              .map(describeRepository),
          });
        }
        if (segments.length === 2 && method === "POST") {
          if (!currentViewer) return reply(401, { message: "Not signed in" });
          const ownerType = body.ownerType === "organization" ? "organization" : "account";
          const name = String(body.name ?? "").trim();
          const description = String(body.description ?? "").trim();
          const visibility = String(body.visibility ?? "");
          const owner = namespaceOf(ownerType, String(body.ownerId ?? body.owner ?? ""));
          const fieldErrors: Record<string, string> = {};
          if (!owner) fieldErrors.owner = "Owner is invalid";
          if (!name) fieldErrors.name = "Repository name is required";
          else if (name.length > 100 || !/^[A-Za-z0-9._-]+$/.test(name)) {
            fieldErrors.name = "Repository name format is invalid";
          }
          if (visibility !== "public" && visibility !== "private") {
            fieldErrors.visibility = "Visibility is invalid";
          }
          if (Object.keys(fieldErrors).length > 0) {
            return reply(400, { message: "Validation failed", fieldErrors });
          }
          if (!(owner!.ownerType === "account" && owner!.ownerId === currentViewer.accountId)
            && !(owner!.ownerType === "organization" && membershipOf(owner!.ownerId, currentViewer.username)?.role === "Owner")) {
            return reply(403, { message: ACCESS_DENIED, fieldErrors: { owner: ACCESS_DENIED } });
          }
          if (repositoryOf(owner!.ownerId, name)) {
            return reply(400, { message: "Validation failed", fieldErrors: { name: "Repository name already exists" } });
          }
          const created: FakeRepository = {
            id: `repo-new-${repositories.length + 1}`,
            ownerType: owner!.ownerType,
            ownerId: owner!.ownerId,
            ownerDisplayName: owner!.displayName,
            name,
            description,
            visibility: visibility as "public" | "private",
            defaultBranch: "main",
            forkOfRepositoryId: null,
            updatedAt: new Date(0).toISOString(),
          };
          repositories.push(created);
          if (created.ownerType === "organization") {
            recordAuditEvent({
              organizationId: created.ownerId,
              actorName: currentViewer.username,
              action: AUDIT_ACTIONS.repositoryCreated,
              target: created.name,
            });
          }
          const commitId = `commit-${created.id}-1`;
          if (body.initialize === true) {
            commits.push({
              id: commitId,
              repositoryId: created.id,
              branch: "main",
              message: "Initial commit",
              authorName: currentViewer.username,
              createdAt: created.updatedAt,
              parentCommitId: null,
              files: [{ path: "README.md", content: `# ${name}\n` }],
            });
          }
          branches.push({
            id: `branch-${created.id}-main`,
            repositoryId: created.id,
            name: "main",
            headCommitId: body.initialize === true ? commitId : null,
            createdAt: created.updatedAt,
          });
          return reply(201, { repository: describeDetail(created, currentViewer) });
        }
        if (segments.length >= 4) {
          const repository = repositoryOf(segments[2], segments[3]);
          if (!repository) return reply(404, { error: "Not found" });
          if (segments.length === 4 && method === "GET") {
            if (!canRead(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
            return reply(200, { repository: describeDetail(repository, currentViewer) });
          }
          // REQ-5-1 / REQ-5-2: the issue list, one issue with its discussion
          // and timeline, issue creation and appended comments.
          if (segments[4] === "issues") {
            const issueOf = (number: number) =>
              issues.find(
                (entry) => entry.repositoryId === repository.id && entry.number === number,
              ) ?? null;

            if (segments.length === 5 && method === "GET") {
              if (!canRead(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
              return reply(200, issueListPayload(repository, currentViewer));
            }
            if (segments.length === 5 && method === "POST") {
              if (!currentViewer) return reply(401, { message: "Not signed in" });
              if (!canWrite(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
              const title = String(body.title ?? "").trim();
              const description = typeof body.description === "string" ? body.description : "";
              const fieldErrors: Record<string, string> = {};
              if (!title) fieldErrors.title = "Title is required";
              else if (title.length > 256) fieldErrors.title = "Title must be 256 characters or fewer";
              if (description.length > 65536) {
                fieldErrors.description = "Description must be 65536 characters or fewer";
              }
              if (Object.keys(fieldErrors).length > 0) {
                return reply(400, { message: "Validation failed", fieldErrors });
              }
              const numbers = issues
                .filter((entry) => entry.repositoryId === repository.id)
                .map((entry) => entry.number);
              const now = new Date().toISOString();
              const issue: FakeIssue = {
                id: `issue-${issues.length + 1}`,
                repositoryId: repository.id,
                number: numbers.length > 0 ? Math.max(...numbers) + 1 : 1,
                title,
                description,
                status: "open",
                authorName: currentViewer.username,
                labelIds: [],
                assigneeIds: [],
                milestoneId: null,
                createdAt: now,
                updatedAt: now,
              };
              issues.push(issue);
              issueEvents.push({
                id: `event-${issue.id}-1`,
                issueId: issue.id,
                type: "created",
                actorName: currentViewer.username,
                createdAt: now,
              });
              return reply(201, issueViewPayload(repository, issue, currentViewer));
            }
            if (segments.length === 6 && method === "GET") {
              if (!canRead(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
              const issue = issueOf(Number(segments[5]));
              if (!issue) return reply(404, { message: "Issue not found" });
              return reply(200, issueViewPayload(repository, issue, currentViewer));
            }
            // REQ-5-2-2: only the selected content field is written; a rejected
            // title leaves the stored issue untouched.
            if (segments.length === 6 && method === "PATCH") {
              if (!currentViewer) return reply(401, { message: "Not signed in" });
              if (!canWrite(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
              const issue = issueOf(Number(segments[5]));
              if (!issue) return reply(404, { message: "Issue not found" });
              const fieldErrors: Record<string, string> = {};
              let nextTitle: string | null = null;
              if (body.title !== undefined) {
                const value = String(body.title ?? "").trim();
                if (!value) fieldErrors.title = "Title is required";
                else if (value.length > 256) fieldErrors.title = "Title must be 256 characters or fewer";
                else nextTitle = value;
              }
              let nextDescription: string | null = null;
              if (body.description !== undefined) {
                const value = typeof body.description === "string" ? body.description : "";
                if (value.length > 65536) {
                  fieldErrors.description = "Description must be 65536 characters or fewer";
                } else {
                  nextDescription = value;
                }
              }
              if (Object.keys(fieldErrors).length > 0) {
                return reply(400, { message: "Validation failed", fieldErrors });
              }
              const now = new Date().toISOString();
              const event = (type: string, detail: string) =>
                issueEvents.push({
                  id: `event-${issue.id}-${issueEvents.length + 1}`,
                  issueId: issue.id,
                  type,
                  actorName: currentViewer.username,
                  detail,
                  createdAt: now,
                });
              if (nextTitle !== null && nextTitle !== issue.title) {
                issue.title = nextTitle;
                issue.updatedAt = now;
                event("renamed", nextTitle);
              }
              if (nextDescription !== null && nextDescription !== issue.description) {
                issue.description = nextDescription;
                issue.updatedAt = now;
                event("description-edited", "");
              }
              return reply(200, issueViewPayload(repository, issue, currentViewer));
            }
            // REQ-5-3-1/2/3: the metadata relationships saved immediately by
            // the selectors; the label and milestone must already exist in the
            // current repository.
            const metadataIssue = () => {
              if (!currentViewer) return { response: reply(401, { message: "Not signed in" }) };
              if (!canTriage(repository, currentViewer)) {
                return { response: reply(403, { message: ACCESS_DENIED }) };
              }
              const issue = issueOf(Number(segments[5]));
              if (!issue) return { response: reply(404, { message: "Issue not found" }) };
              return { issue };
            };
            const metadataEvent = (issue: FakeIssue, type: string, detail: string) => {
              const now = new Date().toISOString();
              issue.updatedAt = now;
              issueEvents.push({
                id: `event-${issue.id}-${issueEvents.length + 1}`,
                issueId: issue.id,
                type,
                actorName: currentViewer!.username,
                detail,
                createdAt: now,
              });
            };
            if (
              (segments.length === 7 && segments[6] === "assignees" && method === "POST") ||
              (segments.length === 8 && segments[6] === "assignees" && method === "DELETE")
            ) {
              const found = metadataIssue();
              if (found.response) return found.response;
              const issue = found.issue!;
              const username =
                method === "POST" ? String(body.username ?? "").trim() : segments[7];
              if (!eligibleAssignees(repository).includes(username)) {
                return reply(400, {
                  message: "Validation failed",
                  fieldErrors: { assignee: "Assignee is invalid" },
                });
              }
              const accountId = `account-${username}`;
              const assigned = method === "POST";
              const ids = issue.assigneeIds.filter((id) => id !== accountId);
              if (assigned) ids.push(accountId);
              if (ids.length !== issue.assigneeIds.length || assigned) {
                issue.assigneeIds = ids;
                metadataEvent(issue, assigned ? "assigned" : "unassigned", username);
              }
              return reply(200, issueViewPayload(repository, issue, currentViewer));
            }
            if (
              (segments.length === 7 && segments[6] === "labels" && method === "POST") ||
              (segments.length === 8 && segments[6] === "labels" && method === "DELETE")
            ) {
              const found = metadataIssue();
              if (found.response) return found.response;
              const issue = found.issue!;
              const name = method === "POST" ? String(body.name ?? "").trim() : segments[7];
              const label = issueLabels.find((entry) => entry.name === name);
              if (!label) {
                return reply(400, {
                  message: "Validation failed",
                  fieldErrors: { label: "Label is invalid" },
                });
              }
              const applied = method === "POST";
              const ids = issue.labelIds.filter((id) => id !== label.id);
              if (applied) ids.push(label.id);
              if (ids.length !== issue.labelIds.length || applied) {
                issue.labelIds = ids;
                metadataEvent(issue, applied ? "labeled" : "unlabeled", label.name);
              }
              return reply(200, issueViewPayload(repository, issue, currentViewer));
            }
            if (segments.length === 7 && segments[6] === "milestone" && (method === "PUT" || method === "DELETE")) {
              const found = metadataIssue();
              if (found.response) return found.response;
              const issue = found.issue!;
              const name = method === "PUT" ? String(body.name ?? "").trim() : "";
              let milestoneId: string | null = null;
              if (name) {
                const milestone = issueMilestones.find((entry) => entry.name === name);
                if (!milestone) {
                  return reply(400, {
                    message: "Validation failed",
                    fieldErrors: { milestone: "Milestone is invalid" },
                  });
                }
                milestoneId = milestone.id;
              }
              if (milestoneId !== issue.milestoneId) {
                issue.milestoneId = milestoneId;
                metadataEvent(issue, milestoneId ? "milestone-set" : "milestone-cleared", name);
              }
              return reply(200, issueViewPayload(repository, issue, currentViewer));
            }
            if (segments.length === 7 && segments[6] === "status" && method === "PATCH") {
              // REQ-5-4: the status transition needs the triage rule and stores
              // only the status plus its closure/reopen activity.
              if (!currentViewer) return reply(401, { message: "Not signed in" });
              if (!canTriage(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
              const issue = issueOf(Number(segments[5]));
              if (!issue) return reply(404, { message: "Issue not found" });
              const status: "open" | "closed" | null =
                body.status === "closed" ? "closed" : body.status === "open" ? "open" : null;
              if (!status) {
                return reply(400, {
                  message: "Validation failed",
                  fieldErrors: { status: "Status is invalid" },
                });
              }
              if (issue.status !== status) {
                issue.status = status;
                metadataEvent(issue, status === "closed" ? "closed" : "reopened", "");
              }
              return reply(200, issueViewPayload(repository, issue, currentViewer));
            }
            if (segments.length === 7 && segments[6] === "reactions" && method === "POST") {
              // REQ-5-5: any signed-in reader stores one reaction of its own
              // account; repeating the request leaves the count unchanged.
              if (!currentViewer) return reply(401, { message: "Not signed in" });
              const issue = issueOf(Number(segments[5]));
              if (!issue) return reply(404, { message: "Issue not found" });
              const type = String(body.type ?? "").trim();
              if (!ISSUE_REACTION_TYPES.includes(type)) {
                return reply(400, {
                  message: "Validation failed",
                  fieldErrors: { reaction: "Reaction is invalid" },
                });
              }
              const stored = issueReactions.some(
                (reaction) =>
                  reaction.issueId === issue.id &&
                  reaction.type === type &&
                  reaction.accountId === currentViewer.accountId,
              );
              if (!stored) {
                issueReactions.push({
                  id: `reaction-${issueReactions.length + 1}`,
                  issueId: issue.id,
                  type,
                  accountId: currentViewer.accountId ?? "",
                  accountName: currentViewer.username,
                  createdAt: new Date().toISOString(),
                });
              }
              return reply(200, issueViewPayload(repository, issue, currentViewer));
            }
            if (segments.length === 8 && segments[6] === "reactions" && method === "DELETE") {
              // REQ-5-5: the removal drops only this account's reaction.
              if (!currentViewer) return reply(401, { message: "Not signed in" });
              const issue = issueOf(Number(segments[5]));
              if (!issue) return reply(404, { message: "Issue not found" });
              const type = segments[7];
              if (!ISSUE_REACTION_TYPES.includes(type)) {
                return reply(400, {
                  message: "Validation failed",
                  fieldErrors: { reaction: "Reaction is invalid" },
                });
              }
              for (let index = issueReactions.length - 1; index >= 0; index -= 1) {
                const reaction = issueReactions[index];
                if (
                  reaction.issueId === issue.id &&
                  reaction.type === type &&
                  reaction.accountId === currentViewer.accountId
                ) {
                  issueReactions.splice(index, 1);
                }
              }
              return reply(200, issueViewPayload(repository, issue, currentViewer));
            }
            if (segments.length === 7 && segments[6] === "comments" && method === "POST") {
              if (!currentViewer) return reply(401, { message: "Not signed in" });
              if (!canWrite(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
              const text = String(body.body ?? "").trim();
              if (!text) {
                return reply(400, { message: "Validation failed", fieldErrors: { body: "Comment is required" } });
              }
              if (text.length > 65536) {
                return reply(400, {
                  message: "Validation failed",
                  fieldErrors: { body: "Comment must be 65536 characters or fewer" },
                });
              }
              const issue = issueOf(Number(segments[5]));
              if (!issue) return reply(404, { message: "Issue not found" });
              const now = new Date().toISOString();
              issueComments.push({
                id: `comment-${issueComments.length + 1}`,
                issueId: issue.id,
                authorName: currentViewer.username,
                body: text,
                createdAt: now,
              });
              issueEvents.push({
                id: `event-${issue.id}-${issueEvents.length + 1}`,
                issueId: issue.id,
                type: "commented",
                actorName: currentViewer.username,
                createdAt: now,
              });
              issue.updatedAt = now;
              return reply(201, issueViewPayload(repository, issue, currentViewer));
            }
            return reply(404, { error: "Not found" });
          }
          if (segments[4] === "fork" && method === "POST") {
            if (!currentViewer) return reply(401, { message: "Not signed in" });
            if (!canRead(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
            const ownerType = body.ownerType === "organization" ? "organization" : "account";
            const requested = String(body.visibility ?? "");
            const visibility = repository.visibility === "private" ? "private" : requested || "public";
            const name = String(body.name ?? "").trim() || repository.name;
            const owner = namespaceOf(ownerType, String(body.ownerId ?? body.owner ?? ""));
            const fieldErrors: Record<string, string> = {};
            if (!owner) fieldErrors.owner = "Owner is invalid";
            if (!name) fieldErrors.name = "Repository name is required";
            else if (name.length > 100 || !/^[A-Za-z0-9._-]+$/.test(name)) {
              fieldErrors.name = "Repository name format is invalid";
            }
            if (visibility !== "public" && visibility !== "private") {
              fieldErrors.visibility = "Visibility is invalid";
            }
            if (Object.keys(fieldErrors).length > 0) {
              return reply(400, { message: "Validation failed", fieldErrors });
            }
            if (!(owner!.ownerType === "account" && owner!.ownerId === currentViewer.accountId)
              && !(owner!.ownerType === "organization" && membershipOf(owner!.ownerId, currentViewer.username)?.role === "Owner")) {
              return reply(403, { message: ACCESS_DENIED, fieldErrors: { owner: ACCESS_DENIED } });
            }
            if (repositoryOf(owner!.ownerId, name)) {
              return reply(400, { message: "Validation failed", fieldErrors: { name: "Repository name already exists" } });
            }
            const created: FakeRepository = {
              id: `repo-fork-${repositories.length + 1}`,
              ownerType: owner!.ownerType,
              ownerId: owner!.ownerId,
              ownerDisplayName: owner!.displayName,
              name,
              description: repository.description,
              visibility: visibility as "public" | "private",
              defaultBranch: repository.defaultBranch,
              forkOfRepositoryId: repository.id,
              updatedAt: new Date(0).toISOString(),
            };
            repositories.push(created);
            if (created.ownerType === "organization") {
              recordAuditEvent({
                organizationId: created.ownerId,
                actorName: currentViewer.username,
                action: AUDIT_ACTIONS.repositoryCreated,
                target: created.name,
              });
            }
            const sourceCommits = commits.filter(
              (entry) => entry.repositoryId === repository.id && entry.branch === repository.defaultBranch,
            );
            let parentCommitId: string | null = null;
            let copied = 0;
            for (const entry of sourceCommits) {
              copied += 1;
              const copy: FakeCommit = {
                ...entry,
                id: `commit-${created.id}-${copied}`,
                repositoryId: created.id,
                parentCommitId,
                files: entry.files.map((file) => ({ ...file })),
              };
              commits.push(copy);
              parentCommitId = copy.id;
            }
            branches.push({
              id: `branch-${created.id}-main`,
              repositoryId: created.id,
              name: created.defaultBranch,
              headCommitId: parentCommitId,
              createdAt: created.updatedAt,
            });
            return reply(201, { repository: describeDetail(created, currentViewer) });
          }
          const codeResponse = codeApi.handleCodeRequest(
            repository,
            segments,
            method,
            searchParams,
            currentViewer,
          );
          if (codeResponse) return codeResponse;
          // REQ-4-3-1 / REQ-4-3-2: list the branches and create a new one from
          // the head of the base branch without copying files.
          if (segments[4] === "branches" && segments.length === 5) {
            if (method === "GET") {
              if (!canRead(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
              return reply(200, {
                repository: describeRepository(repository),
                defaultBranch: repository.defaultBranch,
                branches: codeApi.branchList(repository),
                canWrite: canWrite(repository, currentViewer),
              });
            }
            if (method === "POST") {
              if (!currentViewer) return reply(401, { message: "Not signed in" });
              if (!canWrite(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
              const name = String(body.name ?? "");
              const baseName = String(body.base ?? "").trim() || repository.defaultBranch;
              if (!isValidBranchName(name)) {
                return reply(400, { message: "Invalid branch", fieldErrors: { name: "Invalid branch" } });
              }
              if (branches.some((entry) => entry.repositoryId === repository.id && entry.name === name)) {
                return reply(400, {
                  message: "Branch name already exists",
                  fieldErrors: { name: "Branch name already exists" },
                });
              }
              const base = branches.find(
                (entry) => entry.repositoryId === repository.id && entry.name === baseName,
              );
              if (!base) {
                return reply(400, { message: "Branch not found", fieldErrors: { name: "Branch not found" } });
              }
              const branch: FakeBranch = {
                id: `branch-${repository.id}-${name}`,
                repositoryId: repository.id,
                name,
                headCommitId: base.headCommitId ?? null,
                createdAt: new Date().toISOString(),
              };
              branches.push(branch);
              return reply(201, {
                branch: { name: branch.name, headCommitId: branch.headCommitId },
                defaultBranch: repository.defaultBranch,
              });
            }
          }
          // REQ-4-3-3: change the default branch of the repository (Admin or
          // organization Owner only).
          if (segments[4] === "default-branch" && segments.length === 5 && method === "PATCH") {
            if (!currentViewer) return reply(401, { message: "Not signed in" });
            if (!canManage(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
            const branchName = String(body.branch ?? "").trim();
            if (!branches.some((entry) => entry.repositoryId === repository.id && entry.name === branchName)) {
              return reply(400, {
                message: "Default branch is invalid",
                fieldErrors: { branch: "Default branch is invalid" },
              });
            }
            repository.defaultBranch = branchName;
            return reply(200, { repository: describeDetail(repository, currentViewer) });
          }
          // REQ-4-4: add one file through the web editor; the commit advances
          // the head of the target branch and joins its history.
          if (segments[4] === "files" && segments.length === 5 && method === "POST") {
            if (!currentViewer) return reply(401, { message: "Not signed in" });
            if (!canWrite(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
            const path = String(body.path ?? "").trim();
            const content = typeof body.content === "string" ? body.content : "";
            const message = String(body.message ?? "").trim();
            const branchName = String(body.branch ?? "").trim() || repository.defaultBranch;
            const branch = branches.find(
              (entry) => entry.repositoryId === repository.id && entry.name === branchName,
            );
            if (!branch) return reply(404, { error: "Not found" });
            const fieldErrors: Record<string, string> = {};
            const segmentsOfPath = path.split("/");
            if (!path || path.startsWith("/") || segmentsOfPath.some((part) => !part || part === "." || part === "..")) {
              fieldErrors.path = "Invalid file path";
            }
            if (!message) fieldErrors.message = "Commit message is required";
            else if (message.length > 72) {
              fieldErrors.message = "Commit message must be 72 characters or fewer";
            }
            if (Object.keys(fieldErrors).length > 0) {
              return reply(400, { message: "Validation failed", fieldErrors });
            }
            const parent = commits.find((entry) => entry.id === branch.headCommitId) ?? null;
            const files = (parent?.files ?? []).map((file) => ({ ...file }));
            if (
              files.some(
                (file) =>
                  file.path === path ||
                  file.path.startsWith(`${path}/`) ||
                  path.startsWith(`${file.path}/`),
              )
            ) {
              return reply(400, {
                message: "Invalid file path",
                fieldErrors: { path: "Invalid file path" },
              });
            }
            files.push({ path, content });
            const commit: FakeCommit = {
              id: `commit-${repository.id}-${commits.length + 1}`,
              repositoryId: repository.id,
              branch: branchName,
              message,
              authorName: currentViewer.username,
              createdAt: new Date().toISOString(),
              parentCommitId: parent?.id ?? null,
              files,
            };
            commits.push(commit);
            branch.headCommitId = commit.id;
            return reply(201, {
              repository: describeDetail(repository, currentViewer),
              branch: branchName,
              file: {
                branch: branchName,
                defaultBranch: repository.defaultBranch,
                path,
                name: path.split("/").at(-1) ?? path,
                content,
              },
              commit: {
                id: commit.id,
                message: commit.message,
                authorName: commit.authorName,
                createdAt: commit.createdAt,
                parentCommitId: commit.parentCommitId,
              },
            });
          }
          if (segments[4] === "archive") {
            if (!canManage(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
            if (segments.length === 5 && method === "PATCH") {
              if (typeof body.archived !== "boolean") {
                return reply(400, {
                  message: "Validation failed",
                  fieldErrors: { archived: "Archived status is invalid" },
                });
              }
              repository.archived = body.archived;
              return reply(200, { repository: describeDetail(repository, currentViewer) });
            }
            return reply(404, { error: "Not found" });
          }
          if (segments[4] === "visibility") {
            if (!canManage(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
            if (segments.length === 5 && method === "PATCH") {
              const visibility = String(body.visibility ?? "");
              if (visibility !== "public" && visibility !== "private") {
                return reply(400, {
                  message: "Visibility is invalid",
                  fieldErrors: { visibility: "Visibility is invalid" },
                });
              }
              repository.visibility = visibility;
              return reply(200, { repository: describeDetail(repository, currentViewer) });
            }
            return reply(404, { error: "Not found" });
          }
          if (segments[4] === "access") {
            if (!canManage(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
            if (segments.length === 5 && method === "GET") {
              const candidates = {
                teams: teams
                  .filter((entry) => entry.organizationId === repository.ownerId)
                  .map((entry) => ({ id: `team-${entry.name}`, name: entry.name })),
                accounts: memberships
                  .filter((entry) => entry.organizationId === repository.ownerId)
                  .map((entry) => ({ id: `account-${entry.username}`, username: entry.username })),
              };
              return reply(200, {
                access: grants.filter((grant) => grant.repositoryId === repository.id).map(describeAccess),
                candidates,
              });
            }
            if (segments.length === 5 && method === "POST") {
              const role = String(body.role ?? "");
              if (!ACCESS_ROLES.includes(role)) {
                return reply(400, { message: "Role is invalid", fieldErrors: { role: "Role is invalid" } });
              }
              const subjectType = body.subjectType === "account" ? "account" : "team";
              const subjectName = String(body.subjectName ?? "").trim();
              const known =
                subjectType === "account"
                  ? memberships.some(
                      (entry) => entry.organizationId === repository.ownerId && entry.username === subjectName,
                    ) || Boolean(accountByIdentifier(subjectName))
                  : Boolean(teamOf(repository.ownerId, subjectName));
              if (!known) {
                return reply(400, {
                  message: "Account not found",
                  fieldErrors: { subjectName: "Account not found" },
                });
              }
              const existing = grants.find(
                (grant) =>
                  grant.repositoryId === repository.id &&
                  grant.subjectType === subjectType &&
                  grant.subjectId === subjectName,
              );
              if (existing) {
                existing.role = role;
                return reply(201, { access: describeAccess(existing) });
              }
              const grant: FakeGrant = {
                id: `grant-${grants.length + 1}`,
                repositoryId: repository.id,
                subjectType,
                subjectId: subjectName,
                role,
              };
              grants.push(grant);
              return reply(201, { access: describeAccess(grant) });
            }
            if (segments.length === 6 && method === "PATCH") {
              const grantId = segments[5];
              const role = String(body.role ?? "");
              if (!ACCESS_ROLES.includes(role)) {
                return reply(400, { message: "Role is invalid", fieldErrors: { role: "Role is invalid" } });
              }
              const grant = grants.find(
                (entry) => entry.repositoryId === repository.id && entry.id === grantId,
              );
              if (!grant) return reply(404, { error: "Not found" });
              grant.role = role;
              return reply(200, { access: describeAccess(grant) });
            }
          }
          // REQ-6: the pull-request list, the branch comparison, creation,
          // the detail view, the status transition and the status checks.
          if (segments[4] === "pulls") {
            if (!canRead(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
            const pullOf = (number: number) =>
              pullRequests.find(
                (entry) => entry.repositoryId === repository.id && entry.number === number,
              ) ?? null;

            if (segments.length === 5 && method === "GET") {
              return reply(200, {
                repository: describeRepository(repository),
                pullRequests: pullRequests
                  .filter((entry) => entry.repositoryId === repository.id)
                  .sort((left, right) => right.number - left.number)
                  .map(describePull),
                canWrite: canWrite(repository, currentViewer),
                canMaintain: canMaintain(repository, currentViewer),
                canManage: canManage(repository, currentViewer),
              });
            }

            if (segments.length === 5 && method === "POST") {
              if (!currentViewer) return reply(401, { message: "Not signed in" });
              if (!canWrite(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
              const title = String(body.title ?? "");
              const description = typeof body.description === "string" ? body.description : "";
              const baseName = String(body.base ?? "").trim();
              const compareName = String(body.compare ?? "").trim();
              const fieldErrors: Record<string, string> = {};
              if (title.trim().length === 0) fieldErrors.title = "Title is required";
              else if (title.trim().length > 256) fieldErrors.title = "Title must be 256 characters or fewer";
              if (!baseName || !compareName) fieldErrors.compare = "Branch not found";
              if (Object.keys(fieldErrors).length > 0) {
                return reply(400, { message: "Validation failed", fieldErrors });
              }
              const source = branchOf(repository.id, compareName);
              const target = branchOf(repository.id, baseName);
              if (!source || !target) {
                return reply(400, {
                  message: "Validation failed",
                  fieldErrors: { compare: "Branch not found" },
                });
              }
              const probe: FakePullRequest = {
                id: "probe",
                repositoryId: repository.id,
                number: 0,
                title: "",
                description: "",
                status: "open",
                authorName: "",
                sourceBranch: compareName,
                targetBranch: baseName,
                baseCommitId: target.headCommitId ?? null,
                creationCompareCommitId: source.headCommitId ?? null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                checks: [],
                requestedReviewers: [],
              };
              if (changesOf(probe).totals.files === 0) {
                return reply(400, {
                  message: "Validation failed",
                  fieldErrors: { compare: "No differences between these branches" },
                });
              }
              const numbers = pullRequests
                .filter((entry) => entry.repositoryId === repository.id)
                .map((entry) => entry.number);
              const now = new Date().toISOString();
              const pull: FakePullRequest = {
                id: `pull-${repository.id}-${numbers.length + 1}`,
                repositoryId: repository.id,
                number: numbers.length > 0 ? Math.max(...numbers) + 1 : 1,
                title: title.trim(),
                description,
                status: body.draft === true ? "draft" : "open",
                authorName: currentViewer.username,
                sourceBranch: compareName,
                targetBranch: baseName,
                baseCommitId: target.headCommitId ?? null,
                creationCompareCommitId: source.headCommitId ?? null,
                createdAt: now,
                updatedAt: now,
                checks: [],
                requestedReviewers: [],
              };
              pullRequests.push(pull);
              pullRequestEvents.push({
                id: `event-${pull.id}-1`,
                pullRequestId: pull.id,
                type: "created",
                actorName: currentViewer.username,
                detail: "",
                createdAt: now,
              });
              return reply(201, pullViewPayload(repository, pull, currentViewer));
            }

            if (segments.length === 6 && segments[5] === "compare" && method === "GET") {
              const baseName = searchParams.get("base")?.trim() || repository.defaultBranch;
              const compareName = searchParams.get("compare")?.trim() || baseName;
              const baseBranch = branchOf(repository.id, baseName);
              const compareBranch = branchOf(repository.id, compareName);
              if (!baseBranch || !compareBranch) {
                return reply(404, { message: "Branch not found" });
              }
              const probe: FakePullRequest = {
                id: "probe",
                repositoryId: repository.id,
                number: 0,
                title: "",
                description: "",
                status: "open",
                authorName: "",
                sourceBranch: compareName,
                targetBranch: baseName,
                baseCommitId: baseBranch.headCommitId ?? null,
                creationCompareCommitId: compareBranch.headCommitId ?? null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                checks: [],
                requestedReviewers: [],
              };
              const difference = changesOf(probe);
              const base = commitById(probe.baseCommitId);
              const compare = commitById(currentCompareCommitId(probe));
              return reply(200, {
                repository: describeRepository(repository),
                base: baseName,
                compare: compareName,
                baseCommit: base ? publicCommit(base) : null,
                compareCommit: compare ? publicCommit(compare) : null,
                commits: commitsRelativeToBase(probe),
                changes: difference.files,
                totals: difference.totals,
                identical: difference.totals.files === 0,
                canWrite: canWrite(repository, currentViewer),
              });
            }

            if (segments.length === 6 && method === "GET") {
              const pull = pullOf(Number(segments[5]));
              if (!pull) return reply(404, { message: "Pull request not found" });
              return reply(200, pullViewPayload(repository, pull, currentViewer));
            }

            if (segments.length === 7 && segments[6] === "status" && method === "PATCH") {
              const pull = pullOf(Number(segments[5]));
              if (!pull) return reply(404, { message: "Pull request not found" });
              if (!currentViewer) return reply(401, { message: "Not signed in" });
              if (pull.authorName !== currentViewer.username && !canMaintain(repository, currentViewer)) {
                return reply(403, { message: ACCESS_DENIED });
              }
              const status = String(body.status ?? "");
              if (status !== "open" && status !== "closed") {
                return reply(400, {
                  message: "Validation failed",
                  fieldErrors: { status: "Status is invalid" },
                });
              }
              const allowed =
                pull.status === status ||
                (pull.status !== "merged" &&
                  ((status === "open" && (pull.status === "draft" || pull.status === "closed")) ||
                    (status === "closed" && (pull.status === "draft" || pull.status === "open"))));
              if (!allowed) {
                return reply(400, {
                  message: "Status transition is not allowed",
                  fieldErrors: { status: "Status transition is not allowed" },
                });
              }
              if (pull.status !== status) {
                const previous = pull.status;
                pull.status = status;
                pull.updatedAt = new Date().toISOString();
                pullRequestEvents.push({
                  id: `event-${pull.id}-${pullRequestEvents.length + 1}`,
                  pullRequestId: pull.id,
                  type:
                    status === "closed"
                      ? "closed"
                      : previous === "draft"
                        ? "ready-for-review"
                        : "reopened",
                  actorName: currentViewer.username,
                  detail: "",
                  createdAt: pull.updatedAt,
                });
              }
              return reply(200, pullViewPayload(repository, pull, currentViewer));
            }

            if (segments.length === 7 && segments[6] === "checks" && method === "PATCH") {
              const pull = pullOf(Number(segments[5]));
              if (!pull) return reply(404, { message: "Pull request not found" });
              if (!currentViewer) return reply(401, { message: "Not signed in" });
              if (!canManage(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
              const status = String(body.status ?? "");
              if (!["pending", "success", "failure"].includes(status)) {
                return reply(400, {
                  message: "Validation failed",
                  fieldErrors: { status: "Check status is invalid" },
                });
              }
              const name = String(body.name ?? "").trim();
              const commitId = currentCompareCommitId(pull);
              const check = pull.checks.find(
                (entry) => entry.name === name && (entry.commitId === commitId || entry.commitId === null),
              );
              if (!check) {
                return reply(400, { message: "Check not found", fieldErrors: { status: "Check not found" } });
              }
              check.status = status as FakePullRequestCheck["status"];
              check.setter = currentViewer.username;
              pull.updatedAt = new Date().toISOString();
              return reply(200, pullViewPayload(repository, pull, currentViewer));
            }

            // REQ-6-3-3: one line comment of the current compare revision,
            // published immediately or kept as a pending review comment.
            if (segments.length === 7 && segments[6] === "comments" && method === "POST") {
              const pull = pullOf(Number(segments[5]));
              if (!pull) return reply(404, { message: "Pull request not found" });
              if (!currentViewer) return reply(401, { message: "Not signed in" });
              const reviewable =
                pull.status === "open" &&
                canWrite(repository, currentViewer) &&
                pull.authorName !== currentViewer.username;
              if (!reviewable) return reply(403, { message: ACCESS_DENIED });
              const rawBody = typeof body.body === "string" ? body.body : "";
              if (rawBody.trim().length === 0) {
                return reply(400, {
                  message: "Validation failed",
                  fieldErrors: { comment: "Comment is required" },
                });
              }
              const now = new Date().toISOString();
              reviewComments.push({
                id: `review-comment-${reviewComments.length + 1}`,
                pullRequestId: pull.id,
                authorName: currentViewer.username,
                body: rawBody.trim(),
                filePath: typeof body.filePath === "string" ? body.filePath : "",
                lineIndex: Number.isInteger(body.lineIndex) ? Number(body.lineIndex) : null,
                state: body.state === "pending" ? "pending" : "published",
                commitId: currentCompareCommitId(pull),
                createdAt: now,
              });
              pull.updatedAt = now;
              return reply(200, pullViewPayload(repository, pull, currentViewer));
            }

            // REQ-6-3-4: submit one review decision of the current compare
            // revision. A non-author reviewer with the write rule decides on an
            // Open pull request.
            if (segments.length === 7 && segments[6] === "reviews" && method === "POST") {
              const pull = pullOf(Number(segments[5]));
              if (!pull) return reply(404, { message: "Pull request not found" });
              if (!currentViewer) return reply(401, { message: "Not signed in" });
              const reviewable =
                pull.status === "open" &&
                canWrite(repository, currentViewer) &&
                pull.authorName !== currentViewer.username;
              if (!reviewable) return reply(403, { message: ACCESS_DENIED });
              const decision = String(body.decision ?? "");
              if (decision !== "approved" && decision !== "changes-requested") {
                return reply(400, {
                  message: "Validation failed",
                  fieldErrors: { decision: "Review decision is invalid" },
                });
              }
              const summary = typeof body.summary === "string" ? body.summary : "";
              if (summary.length > 65536) {
                return reply(400, {
                  message: "Validation failed",
                  fieldErrors: { summary: "Review summary must be 65536 characters or fewer" },
                });
              }
              const now = new Date().toISOString();
              const existing = reviews.find(
                (entry) =>
                  entry.pullRequestId === pull.id && entry.reviewerName === currentViewer.username,
              );
              if (existing) {
                existing.decision = decision;
                existing.summary = summary;
                existing.commitId = currentCompareCommitId(pull);
              } else {
                reviews.push({
                  id: `review-${reviews.length + 1}`,
                  pullRequestId: pull.id,
                  reviewerName: currentViewer.username,
                  decision,
                  summary,
                  commitId: currentCompareCommitId(pull),
                  createdAt: now,
                });
              }
              pull.updatedAt = now;
              pullRequestEvents.push({
                id: `event-${pull.id}-${pullRequestEvents.length + 1}`,
                pullRequestId: pull.id,
                type: "reviewed",
                actorName: currentViewer.username,
                detail: decision,
                createdAt: now,
              });
              return reply(200, pullViewPayload(repository, pull, currentViewer));
            }

            // REQ-6-4: request or remove one pending reviewer. The author or a
            // Maintain/Admin/Owner manages it and only an eligible collaborator
            // may be requested.
            if (
              (segments.length === 7 && segments[6] === "reviewers" && method === "POST") ||
              (segments.length === 8 && segments[6] === "reviewers" && method === "DELETE")
            ) {
              const pull = pullOf(Number(segments[5]));
              if (!pull) return reply(404, { message: "Pull request not found" });
              if (!currentViewer) return reply(401, { message: "Not signed in" });
              if (
                pull.authorName !== currentViewer.username &&
                !canMaintain(repository, currentViewer)
              ) {
                return reply(403, { message: ACCESS_DENIED });
              }
              const username =
                method === "POST"
                  ? String(body.username ?? "").trim()
                  : decodeURIComponent(segments[7] ?? "").trim();
              const eligible = eligibleAssignees(repository).filter(
                (name) => name !== pull.authorName,
              );
              if (!eligible.includes(username)) {
                return reply(400, {
                  message: "Validation failed",
                  fieldErrors: { reviewer: "Reviewer is invalid" },
                });
              }
              if (method === "POST") {
                if (!pull.requestedReviewers.includes(username)) {
                  pull.requestedReviewers.push(username);
                }
              } else {
                pull.requestedReviewers = pull.requestedReviewers.filter(
                  (entry) => entry !== username,
                );
              }
              pull.updatedAt = new Date().toISOString();
              return reply(200, pullViewPayload(repository, pull, currentViewer));
            }

            // REQ-6-5: merge the compare branch into the base branch. The
            // protection rules of the exact target branch are enforced before
            // anything is written, and Merged stays terminal.
            if (segments.length === 7 && segments[6] === "merge" && method === "POST") {
              const pull = pullOf(Number(segments[5]));
              if (!pull) return reply(404, { message: "Pull request not found" });
              if (!currentViewer) return reply(401, { message: "Not signed in" });
              if (!canMaintain(repository, currentViewer)) {
                return reply(403, { message: ACCESS_DENIED });
              }
              const mergeState = mergeStateOf(repository, pull);
              if (!mergeState.eligible) {
                const message = mergeState.blockedReason ?? "This pull request cannot be merged";
                return reply(400, { message, fieldErrors: { status: message } });
              }
              const target = branchOf(repository.id, pull.targetBranch);
              const compareCommit = commitById(currentCompareCommitId(pull));
              if (target && compareCommit) {
                const baseFiles = commitById(target.headCommitId)?.files ?? [];
                const compareFiles = compareCommit.files ?? [];
                const merged = new Map(baseFiles.map((file) => [file.path, file.content]));
                for (const file of compareFiles) merged.set(file.path, file.content);
                const now = new Date().toISOString();
                const commitId = `commit-${repository.id}-merge-${pull.number}`;
                commits.push({
                  id: commitId,
                  repositoryId: repository.id,
                  branch: pull.targetBranch,
                  message: `Merge pull request #${pull.number} from ${pull.sourceBranch} into ${pull.targetBranch}`,
                  authorName: currentViewer.username,
                  createdAt: now,
                  parentCommitId: target.headCommitId,
                  files: [...merged.entries()].map(([path, content]) => ({ path, content })),
                });
                target.headCommitId = commitId;
                pull.mergedCommitId = commitId;
              }
              pull.status = "merged";
              pull.mergedByName = currentViewer.username;
              pull.mergedAt = new Date().toISOString();
              pull.updatedAt = pull.mergedAt;
              pullRequestEvents.push({
                id: `event-${pull.id}-${pullRequestEvents.length + 1}`,
                pullRequestId: pull.id,
                type: "merged",
                actorName: currentViewer.username,
                detail: pull.mergedCommitId ?? "",
                createdAt: pull.updatedAt,
              });
              return reply(200, pullViewPayload(repository, pull, currentViewer));
            }

            return reply(404, { error: "Not found" });
          }
          // REQ-6-1: the persistent branch protection rules of this repository.
          // REQ-4-5: the Releases list, the publication of one release on an
          // existing branch and the release detail found by its exact tag. The
          // tag is unique inside the repository, so a duplicate reports the
          // exact message and adds no second release.
          if (segments[4] === "releases") {
            if (!canRead(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
            const describeRelease = (release: FakeRelease) => ({
              tag: release.tag,
              title: release.title,
              description: release.description,
              branch: release.branch,
              author: release.author,
              createdAt: release.createdAt,
            });
            const ofRepository = releases
              .filter((entry) => entry.repositoryId === repository.id)
              .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
            if (segments.length === 5 && method === "GET") {
              return reply(200, {
                repository: describeRepository(repository),
                defaultBranch: repository.defaultBranch,
                releases: ofRepository.map(describeRelease),
                canPublish: canWrite(repository, currentViewer),
              });
            }
            if (segments.length === 5 && method === "POST") {
              if (!currentViewer) return reply(401, { message: "Not signed in" });
              if (!canWrite(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
              const tag = String(body.tag ?? "").trim();
              const branchName = String(body.branch ?? "").trim() || repository.defaultBranch;
              if (!tag || /\s/.test(tag) || tag.length > 255) {
                return reply(400, {
                  message: "Validation failed",
                  fieldErrors: { tag: "Tag name is required" },
                });
              }
              if (
                releases.some(
                  (entry) => entry.repositoryId === repository.id && entry.tag === tag,
                )
              ) {
                return reply(400, {
                  message: "Tag already exists",
                  fieldErrors: { tag: "Tag already exists" },
                });
              }
              if (
                !branches.some(
                  (entry) => entry.repositoryId === repository.id && entry.name === branchName,
                )
              ) {
                return reply(400, {
                  message: "Target branch is invalid",
                  fieldErrors: { branch: "Target branch is invalid" },
                });
              }
              const created: FakeRelease = {
                id: `release-${releases.length + 1}`,
                repositoryId: repository.id,
                tag,
                title: String(body.title ?? "").trim(),
                description: typeof body.description === "string" ? body.description : "",
                branch: branchName,
                author: currentViewer.username,
                createdAt: new Date().toISOString(),
              };
              releases.push(created);
              return reply(201, { release: describeRelease(created) });
            }
            if (segments.length === 6 && method === "GET") {
              const tag = segments[5];
              const release = releases.find(
                (entry) => entry.repositoryId === repository.id && entry.tag === tag,
              );
              if (!release) return reply(404, { error: "Not found" });
              return reply(200, {
                repository: describeRepository(repository),
                release: describeRelease(release),
              });
            }
            return reply(404, { error: "Not found" });
          }
          if (segments[4] === "branch-protections" && segments.length === 5) {
            if (method === "GET") {
              if (!canRead(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
              return reply(200, {
                rules: branchProtectionRules
                  .filter((rule) => rule.repositoryId === repository.id)
                  .map((rule) => ({
                    ...rule,
                    statusCheckName: rule.requireStatusCheck ? "test" : null,
                  })),
                canManage: canManage(repository, currentViewer),
              });
            }
            if (method === "POST") {
              if (!currentViewer) return reply(401, { message: "Not signed in" });
              if (!canManage(repository, currentViewer)) return reply(403, { message: ACCESS_DENIED });
              const branchName = String(body.branchName ?? "").trim();
              if (!isValidBranchName(branchName)) {
                return reply(400, {
                  message: "Validation failed",
                  fieldErrors: { branchName: "Invalid branch" },
                });
              }
              const existing = branchProtectionRules.find(
                (rule) => rule.repositoryId === repository.id && rule.branchName === branchName,
              );
              const rule = existing ?? {
                id: `protection-${repository.id}-${branchProtectionRules.length + 1}`,
                repositoryId: repository.id,
                branchName,
                requireApprovals: false,
                requireStatusCheck: false,
              };
              rule.requireApprovals = body.requireApprovals === true;
              rule.requireStatusCheck = body.requireStatusCheck === true;
              if (!existing) branchProtectionRules.push(rule);
              return reply(200, {
                rule: { ...rule, statusCheckName: rule.requireStatusCheck ? "test" : null },
                rules: branchProtectionRules
                  .filter((entry) => entry.repositoryId === repository.id)
                  .map((entry) => ({
                    ...entry,
                    statusCheckName: entry.requireStatusCheck ? "test" : null,
                  })),
              });
            }
            return reply(404, { error: "Not found" });
          }
        }
        return reply(404, { error: "Not found" });
      }

      // segments: ["api", "organizations", organizationId?, section?, ...]
      if (segments.length === 2) {
        if (method === "GET") {
          if (username) {
            return reply(200, {
              organizations: memberships
                .filter((entry) => entry.username === username)
                .map((entry) => {
                  const found = organization(entry.organizationId);
                  return found ? { id: found.id, displayName: found.displayName, role: entry.role } : null;
                })
                .filter(Boolean),
            });
          }
          return reply(200, {
            organizations: organizations
              .filter((entry) =>
                repositories.some(
                  (repository) => repository.ownerId === entry.id && repository.visibility === "public",
                ),
              )
              .map((entry) => ({ id: entry.id, displayName: entry.displayName })),
          });
        }
        if (method === "POST") {
          if (!username) return reply(401, { message: "Not signed in" });
          const name = String(body.name ?? "");
          const displayName = String(body.displayName ?? "");
          // The submitted identifier may use either case; the stored and
          // compared value is the lowercase form (REQ-2-1-2 evolution).
          const organizationId = name.trim().toLowerCase();
          const fieldErrors: Record<string, string> = {};
          if (name.length < 1 || name.length > 39 || !ORGANIZATION_NAME_PATTERN.test(name)) {
            fieldErrors.name = "Organization name format is invalid";
          } else if (organization(organizationId)) {
            fieldErrors.name = "Organization name already exists";
          }
          const trimmed = displayName.trim();
          if (trimmed.length < 1 || trimmed.length > 100) {
            fieldErrors.displayName = "Display name is required";
          }
          if (Object.keys(fieldErrors).length > 0) return reply(400, { message: "Validation failed", fieldErrors });
          const created = { id: organizationId, displayName: trimmed };
          organizations.push(created);
          memberships.push({ organizationId, username, role: "Owner" });
          recordAuditEvent({
            organizationId,
            actorName: username ?? "",
            action: AUDIT_ACTIONS.organizationCreated,
            target: organizationId,
          });
          return reply(201, { organization: created });
        }
        return reply(404, { error: "Not found" });
      }

      const organizationId = segments[2];
      const found = organization(organizationId);
      if (!found) return reply(404, { error: "Not found" });

      if (segments.length === 3) {
        if (method === "GET") {
          if (!username && !repositories.some((entry) => entry.ownerId === organizationId && entry.visibility === "public")) {
            return reply(403, { message: ACCESS_DENIED });
          }
          return reply(200, {
            organization: { id: found.id, displayName: found.displayName },
            viewerRole: membershipOf(organizationId, username)?.role ?? null,
          });
        }
        return reply(404, { error: "Not found" });
      }

      const section = segments[3];

      if (section === "repositories" && method === "GET") {
        return reply(200, {
          organization: { id: found.id, displayName: found.displayName },
          repositories: repositories
            .filter((entry) => entry.ownerId === organizationId && canRead(entry, currentViewer))
            .map(describeRepository),
        });
      }

      // REQ-2-4: only an organization Owner may read the audit log.
      if (section === "audit-log" && method === "GET") {
        if (membershipOf(organizationId, username)?.role !== "Owner") {
          return reply(username ? 403 : 401, { message: username ? ACCESS_DENIED : "Not signed in" });
        }
        return reply(200, {
          organization: { id: found.id, displayName: found.displayName },
          events: auditEvents
            .filter((event) => event.organizationId === organizationId)
            .map((event) => ({
              id: event.id,
              actor: event.actorName,
              action: event.action,
              target: event.target,
              timestamp: event.createdAt,
            })),
        });
      }

      if (section === "people" && segments.length === 4) {
        if (method === "GET") {
          if (!membershipOf(organizationId, username)) return reply(403, { message: ACCESS_DENIED });
          return reply(200, {
            organization: { id: found.id, displayName: found.displayName },
            members: memberships
              .filter((entry) => entry.organizationId === organizationId)
              .map((entry) => ({ username: entry.username, role: entry.role })),
          });
        }
        if (method === "POST") {
          if (membershipOf(organizationId, username)?.role !== "Owner") {
            return reply(403, { message: ACCESS_DENIED });
          }
          const identifier = String(body.identifier ?? body.username ?? "").trim();
          const role = String(body.role ?? "") || "Member";
          if (!MEMBERSHIP_ROLES.includes(role)) {
            return reply(400, { message: "Role is invalid", fieldErrors: { role: "Role is invalid" } });
          }
          const account = accountByIdentifier(identifier);
          if (!account) {
            return reply(400, { message: "Account not found", fieldErrors: { identifier: "Account not found" } });
          }
          if (membershipOf(organizationId, account.username)) {
            return reply(400, {
              message: "Account is already a member",
              fieldErrors: { identifier: "Account is already a member" },
            });
          }
          memberships.push({ organizationId, username: account.username, role: role as "Owner" | "Member" });
          recordAuditEvent({
            organizationId,
            actorName: username ?? "",
            action: AUDIT_ACTIONS.memberAdded,
            target: account.username,
          });
          return reply(201, { member: { username: account.username, role } });
        }
        return reply(404, { error: "Not found" });
      }

      if (section === "people" && segments.length === 5 && method === "DELETE") {
        if (membershipOf(organizationId, username)?.role !== "Owner") {
          return reply(403, { message: ACCESS_DENIED });
        }
        const target = accountByIdentifier(segments[4]);
        if (!target) return reply(404, { error: "Not found" });
        const membership = membershipOf(organizationId, target.username);
        if (!membership) return reply(404, { error: "Not found" });
        const owners = memberships.filter(
          (entry) => entry.organizationId === organizationId && entry.role === "Owner",
        );
        if (membership.role === "Owner" && owners.length <= 1) {
          return reply(400, {
            message: "Organization must have at least one owner",
            fieldErrors: { member: "Organization must have at least one owner" },
          });
        }
        for (let index = memberships.length - 1; index >= 0; index -= 1) {
          const entry = memberships[index];
          if (entry.organizationId === organizationId && entry.username === target.username) {
            memberships.splice(index, 1);
          }
        }
        for (let index = teamMembers.length - 1; index >= 0; index -= 1) {
          const entry = teamMembers[index];
          if (entry.organizationId === organizationId && entry.username === target.username) {
            teamMembers.splice(index, 1);
          }
        }
        for (let index = grants.length - 1; index >= 0; index -= 1) {
          const entry = grants[index];
          if (entry.subjectType === "account" && entry.subjectId === target.username) {
            grants.splice(index, 1);
          }
        }
        recordAuditEvent({
          organizationId,
          actorName: username ?? "",
          action: AUDIT_ACTIONS.memberRemoved,
          target: target.username,
        });
        return reply(200, { ok: true });
      }

      if (section === "teams") {
        if (!membershipOf(organizationId, username)) return reply(403, { message: ACCESS_DENIED });
        if (segments.length === 4) {
          if (method === "GET") {
            return reply(200, {
              organization: { id: found.id, displayName: found.displayName },
              teams: teams.filter((entry) => entry.organizationId === organizationId).map(describeTeam),
            });
          }
          if (method === "POST") {
            if (membershipOf(organizationId, username)?.role !== "Owner") {
              return reply(403, { message: ACCESS_DENIED });
            }
            const name = String(body.name ?? "");
            if (name.length < 1 || name.length > 50 || !TEAM_NAME_PATTERN.test(name)) {
              return reply(400, {
                message: "Team name is invalid",
                fieldErrors: { name: "Team name is invalid" },
              });
            }
            if (teamOf(organizationId, name)) {
              return reply(400, {
                message: "Team name is invalid",
                fieldErrors: { name: "Team name is invalid" },
              });
            }
            const team: FakeTeam = { organizationId, name, parentName: null };
            teams.push(team);
            recordAuditEvent({
              organizationId,
              actorName: username ?? "",
              action: AUDIT_ACTIONS.teamCreated,
              target: name,
            });
            return reply(201, { team: describeTeam(team) });
          }
        }

        const teamName = segments[4];
        const team = teamName ? teamOf(organizationId, teamName) : null;
        if (!team) return reply(404, { error: "Not found" });

        if (segments.length === 5) {
          if (method === "GET") return reply(200, { team: describeTeam(team) });
          if (method === "PATCH") {
            if (membershipOf(organizationId, username)?.role !== "Owner") {
              return reply(403, { message: ACCESS_DENIED });
            }
            const parentName = body.parentName === null ? null : String(body.parentName ?? "");
            if (parentName === null || parentName === "") {
              team.parentName = null;
              return reply(200, { team: describeTeam(team) });
            }
            const parent = teamOf(organizationId, parentName);
            if (!parent) {
              return reply(400, {
                message: "Parent team is invalid",
                fieldErrors: { parentName: "Parent team is invalid" },
              });
            }
            const seen = new Set<string>();
            let cursor: FakeTeam | null = parent;
            while (cursor) {
              if (cursor.name === team.name) {
                return reply(400, {
                  message: "Cyclic team hierarchy is not allowed",
                  fieldErrors: { parentName: "Cyclic team hierarchy is not allowed" },
                });
              }
              if (seen.has(cursor.name)) break;
              seen.add(cursor.name);
              cursor = cursor.parentName ? teamOf(organizationId, cursor.parentName) : null;
            }
            team.parentName = parent.name;
            return reply(200, { team: describeTeam(team) });
          }
        }

        if (segments.length === 6 && segments[5] === "members") {
          if (method === "GET") {
            if (!membershipOf(organizationId, username)) return reply(403, { message: ACCESS_DENIED });
            return reply(200, {
              members: teamMembers
                .filter((entry) => entry.organizationId === organizationId && entry.teamName === teamName)
                .map((entry) => ({ username: entry.username })),
            });
          }
          if (method === "POST") {
            if (membershipOf(organizationId, username)?.role !== "Owner") {
              return reply(403, { message: ACCESS_DENIED });
            }
            const candidate = String(body.username ?? "").trim();
            const account = accountByIdentifier(candidate);
            if (!account) {
              return reply(400, { message: "Account not found", fieldErrors: { username: "Account not found" } });
            }
            if (!membershipOf(organizationId, account.username)) {
              return reply(400, {
                message: "Account is not an organization member",
                fieldErrors: { username: "Account is not an organization member" },
              });
            }
            if (
              !teamMembers.some(
                (entry) =>
                  entry.organizationId === organizationId &&
                  entry.teamName === teamName &&
                  entry.username === account.username,
              )
            ) {
              teamMembers.push({ organizationId, teamName, username: account.username });
            }
            return reply(201, { member: { username: account.username } });
          }
        }

        if (segments.length === 7 && segments[5] === "members" && method === "DELETE") {
          if (membershipOf(organizationId, username)?.role !== "Owner") {
            return reply(403, { message: ACCESS_DENIED });
          }
          const target = segments[6];
          for (let index = teamMembers.length - 1; index >= 0; index -= 1) {
            const entry = teamMembers[index];
            if (entry.organizationId === organizationId && entry.teamName === teamName && entry.username === target) {
              teamMembers.splice(index, 1);
            }
          }
          return reply(200, { ok: true });
        }
      }

      return reply(404, { error: "Not found" });
    },
  };
}
