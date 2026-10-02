import { hashPassword } from "./passwords.mjs";
import { SEED_BRANCH_PROTECTION_RULES } from "./seed-branch-protection.mjs";
import { SEED_BRANCHES, SEED_COMMITS } from "./seed-code.mjs";
import {
  SEED_PULL_REQUEST_CHECKS,
  SEED_PULL_REQUEST_COMMENTS,
  SEED_PULL_REQUEST_EVENTS,
  SEED_PULL_REQUEST_REVIEWS,
  SEED_PULL_REQUESTS,
} from "./seed-pull-requests.mjs";

// Predefined accounts supplied by the requirement seed values. Seeds are only
// used when no state file exists yet, so user modifications survive restarts.
const SEED_TIMESTAMP = "2024-01-01T00:00:00.000Z";

export const SEED_ACCOUNTS = [
  {
    id: "account-alice-dev",
    username: "alice-dev",
    email: "alice.dev@example.test",
    password: "Valid-password-123!",
  },
  {
    id: "account-bob-reviewer",
    username: "bob-reviewer",
    email: "bob.reviewer@example.test",
    password: "Valid-password-123!",
  },
  // The Maintain account of the merge requirements: a collaborator below Admin
  // with a direct `maintain` grant on `acme-docs`, so the product really holds
  // an account that may merge without being able to administer the repository.
  // She is not an organization member, exactly like a direct collaborator.
  {
    id: "account-carol-maintainer",
    username: "carol-maintainer",
    email: "carol.maintainer@example.test",
    password: "Valid-password-123!",
  },
];

// Organization identifier `acme-demo` with the display name `Acme Demo`.
export const SEED_ORGANIZATIONS = [
  {
    id: "organization-acme-demo",
    name: "acme-demo",
    displayName: "Acme Demo",
  },
];

export const SEED_MEMBERSHIPS = [
  {
    id: "membership-acme-demo-alice-dev",
    organizationId: "organization-acme-demo",
    accountId: "account-alice-dev",
    role: "owner",
  },
  {
    id: "membership-acme-demo-bob-reviewer",
    organizationId: "organization-acme-demo",
    accountId: "account-bob-reviewer",
    role: "member",
  },
];

// `frontend-team` keeps its stored parent `platform-team` and owns the
// descendant `frontend-child`, so the hierarchy scenario can select a
// descendant and observe the rejected cycle. `design-team` is a valid
// non-descendant candidate parent for `frontend-team`.
export const SEED_TEAMS = [
  {
    id: "team-acme-demo-platform-team",
    organizationId: "organization-acme-demo",
    name: "platform-team",
    description: "Platform maintainers",
    parentTeamId: null,
  },
  {
    id: "team-acme-demo-design-team",
    organizationId: "organization-acme-demo",
    name: "design-team",
    description: "Design systems",
    parentTeamId: null,
  },
  {
    id: "team-acme-demo-frontend-team",
    organizationId: "organization-acme-demo",
    name: "frontend-team",
    description: "Frontend maintainers",
    parentTeamId: "team-acme-demo-platform-team",
  },
  {
    id: "team-acme-demo-frontend-child",
    organizationId: "organization-acme-demo",
    name: "frontend-child",
    description: null,
    parentTeamId: "team-acme-demo-frontend-team",
  },
];

// Team membership is independent persisted data: the seeded organization
// member `bob-reviewer` is not yet in any team.
export const SEED_TEAM_MEMBERS = [];

// The seed organization owns one public repository and one distinct private
// repository that stays invisible to visitors and unauthorized members.
export const SEED_REPOSITORIES = [
  {
    id: "repository-acme-demo-acme-docs",
    ownerType: "organization",
    ownerId: "organization-acme-demo",
    name: "acme-docs",
    description: "Documentation for the Acme Demo platform.",
    visibility: "public",
    defaultBranch: "main",
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    id: "repository-acme-demo-secret-research",
    ownerType: "organization",
    ownerId: "organization-acme-demo",
    name: "secret-research",
    description: "Private research notes for Acme Demo.",
    visibility: "private",
    defaultBranch: "main",
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  // The seeded member `bob-reviewer` also owns a personal repository, which
  // removing the organization membership must leave untouched.
  {
    id: "repository-bob-reviewer-bob-notes",
    ownerType: "account",
    ownerId: "account-bob-reviewer",
    name: "bob-notes",
    description: "Personal notes of bob-reviewer.",
    visibility: "public",
    defaultBranch: "main",
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  // `alice-dev` already owns the personal fork `acme-docs-fork`. It is the
  // existing name both the duplicate-name validation of the creation form and
  // the fork conflict case start from. The fork is private, exactly like a
  // private fork of a public source may be, so it never widens what a visitor
  // can find by searching for the source name.
  {
    id: "repository-alice-dev-acme-docs-fork",
    ownerType: "account",
    ownerId: "account-alice-dev",
    name: "acme-docs-fork",
    description: "Personal fork of the Acme Demo documentation.",
    visibility: "private",
    defaultBranch: "main",
    sourceRepositoryId: "repository-acme-demo-acme-docs",
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
];

// The seeded grants of the public repository `acme-docs`: the team grant of
// `platform-team` for the access-management scenarios, and the direct Write
// grant of `bob-reviewer`. The pull-request requirements supply a non-author
// Write reviewer, so the seeded reviewer of the Open pull requests holds Write
// on this repository while remaining a plain member of the organization (his
// personal repository and the private one keep their own permissions).
export const SEED_REPOSITORY_GRANTS = [
  {
    id: "grant-acme-docs-platform-team-write",
    repositoryId: "repository-acme-demo-acme-docs",
    subjectType: "team",
    subjectId: "team-acme-demo-platform-team",
    role: "write",
    grantedBy: "account-alice-dev",
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    id: "grant-acme-docs-bob-reviewer-write",
    repositoryId: "repository-acme-demo-acme-docs",
    subjectType: "account",
    subjectId: "account-bob-reviewer",
    role: "write",
    grantedBy: "account-alice-dev",
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    id: "grant-acme-docs-carol-maintainer-maintain",
    repositoryId: "repository-acme-demo-acme-docs",
    subjectType: "account",
    subjectId: "account-carol-maintainer",
    role: "maintain",
    grantedBy: "account-alice-dev",
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
];

// Issue classification names of the public repository `acme-docs`. A label is
// a repository-scoped colored name, and a milestone is a repository-scoped
// goal that several issues may share without changing their content. The
// personal repository `bob-notes` owns a label and a milestone of its own, so
// the metadata pickers of `acme-docs` can never offer a record of another
// repository (`bug` deliberately has the same name in both).
export const SEED_LABELS = [
  {
    id: "label-acme-docs-bug",
    repositoryId: "repository-acme-demo-acme-docs",
    name: "bug",
    color: "d73a4a",
    description: "Something is not working",
  },
  {
    id: "label-acme-docs-documentation",
    repositoryId: "repository-acme-demo-acme-docs",
    name: "documentation",
    color: "0075ca",
    description: "Improvements or additions to documentation",
  },
  {
    id: "label-bob-notes-bug",
    repositoryId: "repository-bob-reviewer-bob-notes",
    name: "bug",
    color: "d73a4a",
    description: "Notes defect",
  },
];

export const SEED_MILESTONES = [
  {
    id: "milestone-acme-docs-q3-launch",
    repositoryId: "repository-acme-demo-acme-docs",
    title: "Q3 launch",
    description: "Ship the documentation for the Q3 launch.",
    dueOn: "2024-09-30",
    state: "open",
  },
  // The selectable milestone the metadata scenario starts from: it belongs to
  // `acme-docs` and no seeded issue is associated with it yet.
  {
    id: "milestone-acme-docs-v1",
    repositoryId: "repository-acme-demo-acme-docs",
    title: "v1.0",
    description: "First public release.",
    dueOn: "2024-12-31",
    state: "open",
  },
  // A milestone of another repository, which the `acme-docs` picker must never
  // offer.
  {
    id: "milestone-bob-notes-backlog",
    repositoryId: "repository-bob-reviewer-bob-notes",
    title: "Personal backlog",
    description: "Ideas for the personal notes.",
    dueOn: null,
    state: "open",
  },
];

// The two read-only issues of `acme-docs`: one open issue with its label,
// milestone and discussion, and the distinct closed issue. Both keep the
// status the requirement states, so every reader observes the same rows. The
// open issue starts without an assignee and without the `bug` label, so the
// assignment and the label scenarios can add and remove exactly one
// association on it (the eligible member is `alice-dev`, and `bug` stays an
// existing label of the repository).
export const SEED_ISSUES = [
  {
    id: "issue-acme-docs-1",
    repositoryId: "repository-acme-demo-acme-docs",
    number: 1,
    title: "Improve onboarding",
    body: "Describe the onboarding improvement.",
    state: "open",
    authorId: "account-alice-dev",
    assigneeIds: [],
    labelIds: ["label-acme-docs-documentation"],
    milestoneId: "milestone-acme-docs-q3-launch",
    createdAt: "2024-01-02T09:00:00.000Z",
    updatedAt: "2024-01-03T10:00:00.000Z",
    closedAt: null,
    closedById: null,
  },
  {
    id: "issue-acme-docs-2",
    repositoryId: "repository-acme-demo-acme-docs",
    number: 2,
    title: "Legacy welcome text",
    body: "Replace the legacy welcome text on the home page.",
    state: "closed",
    authorId: "account-alice-dev",
    assigneeIds: [],
    labelIds: ["label-acme-docs-bug"],
    milestoneId: null,
    createdAt: "2024-01-04T09:00:00.000Z",
    updatedAt: "2024-01-05T09:00:00.000Z",
    closedAt: "2024-01-05T09:00:00.000Z",
    closedById: "account-alice-dev",
  },
  // The invalid-edit seed: a separate open issue with the known original title
  // `Original issue title`, whose initial state stays untouched by the other
  // mutation scenarios. It carries a description and one comment, so both the
  // edit and the discussion workflows start from a stored record here too.
  {
    id: "issue-acme-docs-3",
    repositoryId: "repository-acme-demo-acme-docs",
    number: 3,
    title: "Original issue title",
    body: "Describe the original issue.",
    state: "open",
    authorId: "account-alice-dev",
    assigneeIds: [],
    labelIds: [],
    milestoneId: null,
    createdAt: "2024-01-06T09:00:00.000Z",
    updatedAt: "2024-01-06T11:00:00.000Z",
    closedAt: null,
    closedById: null,
  },
];

export const SEED_ISSUE_COMMENTS = [
  {
    id: "issue-comment-acme-docs-1-1",
    issueId: "issue-acme-docs-1",
    authorId: "account-alice-dev",
    body: "Start with the first-run checklist.",
    createdAt: "2024-01-03T10:00:00.000Z",
  },
  {
    id: "issue-comment-acme-docs-3-1",
    issueId: "issue-acme-docs-3",
    authorId: "account-alice-dev",
    body: "Keep the original scope for now.",
    createdAt: "2024-01-06T11:00:00.000Z",
  },
];

// The append-only activity history of the seeded issues, oldest first.
export const SEED_ISSUE_EVENTS = [
  {
    id: "issue-event-acme-docs-1-created",
    issueId: "issue-acme-docs-1",
    type: "created",
    actorId: "account-alice-dev",
    createdAt: "2024-01-02T09:00:00.000Z",
    data: {},
  },
  {
    id: "issue-event-acme-docs-1-labeled-documentation",
    issueId: "issue-acme-docs-1",
    type: "labeled",
    actorId: "account-alice-dev",
    createdAt: "2024-01-02T09:05:00.000Z",
    data: { labelName: "documentation" },
  },
  {
    id: "issue-event-acme-docs-1-milestoned",
    issueId: "issue-acme-docs-1",
    type: "milestoned",
    actorId: "account-alice-dev",
    createdAt: "2024-01-02T09:15:00.000Z",
    data: { milestoneTitle: "Q3 launch" },
  },
  {
    id: "issue-event-acme-docs-1-commented",
    issueId: "issue-acme-docs-1",
    type: "commented",
    actorId: "account-alice-dev",
    createdAt: "2024-01-03T10:00:00.000Z",
    data: {},
  },
  {
    id: "issue-event-acme-docs-2-created",
    issueId: "issue-acme-docs-2",
    type: "created",
    actorId: "account-alice-dev",
    createdAt: "2024-01-04T09:00:00.000Z",
    data: {},
  },
  {
    id: "issue-event-acme-docs-2-closed",
    issueId: "issue-acme-docs-2",
    type: "closed",
    actorId: "account-alice-dev",
    createdAt: "2024-01-05T09:00:00.000Z",
    data: {},
  },
  {
    id: "issue-event-acme-docs-3-created",
    issueId: "issue-acme-docs-3",
    type: "created",
    actorId: "account-alice-dev",
    createdAt: "2024-01-06T09:00:00.000Z",
    data: {},
  },
  {
    id: "issue-event-acme-docs-3-commented",
    issueId: "issue-acme-docs-3",
    type: "commented",
    actorId: "account-alice-dev",
    createdAt: "2024-01-06T11:00:00.000Z",
    data: {},
  },
];

export function createInitialState() {
  return {
    accounts: SEED_ACCOUNTS.map((seed) => ({
      id: seed.id,
      username: seed.username,
      email: seed.email,
      emailVerified: true,
      status: "active",
      passwordHash: hashPassword(seed.password),
      createdAt: SEED_TIMESTAMP,
    })),
    sessions: [],
    organizations: SEED_ORGANIZATIONS.map((organization) => ({
      ...organization,
      createdAt: SEED_TIMESTAMP,
    })),
    memberships: SEED_MEMBERSHIPS.map((membership) => ({
      ...membership,
      createdAt: SEED_TIMESTAMP,
    })),
    teams: SEED_TEAMS.map((team) => ({
      ...team,
      createdBy: "account-alice-dev",
      createdAt: SEED_TIMESTAMP,
    })),
    teamMembers: [...SEED_TEAM_MEMBERS],
    repositories: SEED_REPOSITORIES.map((repository) => ({ ...repository })),
    repositoryGrants: [...SEED_REPOSITORY_GRANTS],
    branchProtectionRules: SEED_BRANCH_PROTECTION_RULES.map((rule) => ({ ...rule })),
    branches: SEED_BRANCHES.map((branch) => ({ ...branch })),
    commits: SEED_COMMITS.map((commit) => ({ ...commit, files: commit.files.map((file) => ({ ...file })) })),
    labels: SEED_LABELS.map((label) => ({ ...label })),
    milestones: SEED_MILESTONES.map((milestone) => ({ ...milestone })),
    issues: SEED_ISSUES.map((issue) => ({
      ...issue,
      assigneeIds: [...issue.assigneeIds],
      labelIds: [...issue.labelIds],
    })),
    issueComments: SEED_ISSUE_COMMENTS.map((comment) => ({ ...comment })),
    issueEvents: SEED_ISSUE_EVENTS.map((event) => ({ ...event, data: { ...event.data } })),
    issueReactions: [],
    pullRequests: SEED_PULL_REQUESTS.map((pullRequest) => ({
      ...pullRequest,
      reviewerIds: [...pullRequest.reviewerIds],
    })),
    pullRequestEvents: SEED_PULL_REQUEST_EVENTS.map((event) => ({
      ...event,
      data: { ...event.data },
    })),
    pullRequestReviews: SEED_PULL_REQUEST_REVIEWS.map((review) => ({ ...review })),
    pullRequestComments: SEED_PULL_REQUEST_COMMENTS.map((comment) => ({ ...comment })),
    pullRequestChecks: SEED_PULL_REQUEST_CHECKS.map((check) => ({ ...check })),
  };
}
