// Seed data for the pull-request model of the public repository `acme-docs`.
//
// A pull request is a persisted proposal to merge the compare branch into the
// base branch: it stores its repository-scoped number, both branch names, the
// creation-time base commit, the current compare commit, its author, title,
// description, status and its own append-only activity records.
//
// The seeded list holds exactly the records the requirement names: the Open
// pull request `Improve onboarding` and the Closed one `Fix search`, both
// authored by `alice-dev`, plus the dedicated draft `Draft onboarding update`
// of `draft-feature` that the ready-for-review scenario starts from. None of
// them uses the `main`/`feature-search` pair in a Draft or Open state, so the
// creation scenarios of that pair start from a comparison without a live
// pull request. No record starts with a reviewer request: the reviewer-request
// requirement supplies the Open `Improve onboarding` of the signed-in author
// `alice-dev` with no request from the eligible reviewer `bob-reviewer` yet,
// and every record carries the `test` check of its compare commit.
//
// Two more Open records of the same author own the separate reviewable states
// of the module: `Update search filters` is the Open pull request a reviewer
// may comment on, and `Refine search ranking` is the separate Open pull request
// a reviewer may approve or request changes on. Both keep the `src/search.ts`
// change of the module, start without any submitted review and start without a
// reviewer request, exactly like the two records the requirement names.
//
// The merge requirements own two dedicated Open records of the same branch
// family: `Ship the search fixes` already carries the valid non-author approval
// of `bob-reviewer` for its current compare commit and a successful `test`
// check, so it is the mergeable record, while `Refresh the docs layout` carries
// no approval at all and no stored `test` result (its check starts as pending),
// so it is the blocked record of the same protected target branch.

const SEED_PULL_REQUEST_TIMESTAMP = "2024-01-05T10:00:00.000Z";

export const SEED_PULL_REQUESTS = [
  {
    id: "pull-request-acme-docs-1",
    repositoryId: "repository-acme-demo-acme-docs",
    number: 1,
    title: "Improve onboarding",
    description: "Document the onboarding improvement.",
    authorId: "account-alice-dev",
    status: "open",
    sourceBranch: "release",
    targetBranch: "main",
    baseCommitId: "commit-acme-docs-search-flow",
    compareCommitId: "commit-acme-docs-release-prepare",
    reviewerIds: [],
    createdAt: SEED_PULL_REQUEST_TIMESTAMP,
    updatedAt: SEED_PULL_REQUEST_TIMESTAMP,
    closedAt: null,
    closedById: null,
    mergedAt: null,
    mergedById: null,
  },
  {
    id: "pull-request-acme-docs-2",
    repositoryId: "repository-acme-demo-acme-docs",
    number: 2,
    title: "Fix search",
    description: "Correct the search prototype before it ships.",
    authorId: "account-alice-dev",
    status: "closed",
    sourceBranch: "feature-search",
    targetBranch: "main",
    baseCommitId: "commit-acme-docs-search-flow",
    compareCommitId: "commit-acme-docs-search-prototype",
    reviewerIds: [],
    createdAt: "2024-01-04T10:00:00.000Z",
    updatedAt: "2024-01-04T12:00:00.000Z",
    closedAt: "2024-01-04T12:00:00.000Z",
    closedById: "account-alice-dev",
    mergedAt: null,
    mergedById: null,
  },
  // The dedicated ready-for-review seed: a draft of the supplied author without
  // any submitted review, whose source branch and target branch are displayed
  // verbatim on its detail page.
  {
    id: "pull-request-acme-docs-3",
    repositoryId: "repository-acme-demo-acme-docs",
    number: 3,
    title: "Draft onboarding update",
    description: "Work in progress on the onboarding update.",
    authorId: "account-alice-dev",
    status: "draft",
    sourceBranch: "draft-feature",
    targetBranch: "main",
    baseCommitId: "commit-acme-docs-search-flow",
    compareCommitId: "commit-acme-docs-search-prototype",
    reviewerIds: [],
    createdAt: "2024-01-06T10:00:00.000Z",
    updatedAt: "2024-01-06T10:00:00.000Z",
    closedAt: null,
    closedById: null,
    mergedAt: null,
    mergedById: null,
  },
  // The separate Open record a signed-in reviewer may comment on: the known
  // `src/search.ts` change of the module plus one added file.
  {
    id: "pull-request-acme-docs-4",
    repositoryId: "repository-acme-demo-acme-docs",
    number: 4,
    title: "Update search filters",
    description: "Filter the search results before they are shown.",
    authorId: "account-alice-dev",
    status: "open",
    sourceBranch: "search-filters",
    targetBranch: "main",
    baseCommitId: "commit-acme-docs-search-flow",
    compareCommitId: "commit-acme-docs-search-filters",
    reviewerIds: [],
    createdAt: "2024-01-06T12:00:00.000Z",
    updatedAt: "2024-01-06T12:05:00.000Z",
    closedAt: null,
    closedById: null,
    mergedAt: null,
    mergedById: null,
  },
  // The separate Open record for the review decisions: no submitted review of
  // the seeded reviewer yet.
  {
    id: "pull-request-acme-docs-5",
    repositoryId: "repository-acme-demo-acme-docs",
    number: 5,
    title: "Refine search ranking",
    description: "Rank the search results by their relevance.",
    authorId: "account-alice-dev",
    status: "open",
    sourceBranch: "search-ranking",
    targetBranch: "main",
    baseCommitId: "commit-acme-docs-search-flow",
    compareCommitId: "commit-acme-docs-search-ranking",
    reviewerIds: [],
    createdAt: "2024-01-07T09:00:00.000Z",
    updatedAt: "2024-01-07T09:05:00.000Z",
    closedAt: null,
    closedById: null,
    mergedAt: null,
    mergedById: null,
  },
  // The mergeable record: an Open, non-draft pull request of the protected
  // `main` whose current compare commit carries the approval of the non-author
  // reviewer and the successful `test` check.
  {
    id: "pull-request-acme-docs-6",
    repositoryId: "repository-acme-demo-acme-docs",
    number: 6,
    title: "Ship the search fixes",
    description: "Ship the search fixes that were prepared for the release.",
    authorId: "account-alice-dev",
    status: "open",
    sourceBranch: "search-fixes",
    targetBranch: "main",
    baseCommitId: "commit-acme-docs-search-flow",
    compareCommitId: "commit-acme-docs-search-fixes",
    reviewerIds: [],
    createdAt: "2024-01-08T09:00:00.000Z",
    updatedAt: "2024-01-08T11:30:00.000Z",
    closedAt: null,
    closedById: null,
    mergedAt: null,
    mergedById: null,
  },
  // The blocked record of the same protected target branch: no valid approval
  // of any reviewer exists, so the merge stays refused and explains the unmet
  // review requirement before any click.
  {
    id: "pull-request-acme-docs-7",
    repositoryId: "repository-acme-demo-acme-docs",
    number: 7,
    title: "Refresh the docs layout",
    description: "Refresh the layout of the documentation pages.",
    authorId: "account-alice-dev",
    status: "open",
    sourceBranch: "docs-polish",
    targetBranch: "main",
    baseCommitId: "commit-acme-docs-search-flow",
    compareCommitId: "commit-acme-docs-docs-polish",
    reviewerIds: [],
    createdAt: "2024-01-08T09:30:00.000Z",
    updatedAt: "2024-01-08T09:30:00.000Z",
    closedAt: null,
    closedById: null,
    mergedAt: null,
    mergedById: null,
  },
];

/** The append-only activity history of the seeded pull requests, oldest first. */
export const SEED_PULL_REQUEST_EVENTS = [
  {
    id: "pull-request-event-acme-docs-1-created",
    pullRequestId: "pull-request-acme-docs-1",
    type: "created",
    actorId: "account-alice-dev",
    createdAt: "2024-01-05T10:00:00.000Z",
    data: {},
  },
  {
    id: "pull-request-event-acme-docs-1-commented",
    pullRequestId: "pull-request-acme-docs-1",
    type: "commented",
    actorId: "account-bob-reviewer",
    createdAt: "2024-01-05T11:00:00.000Z",
    data: {},
  },
  {
    id: "pull-request-event-acme-docs-2-created",
    pullRequestId: "pull-request-acme-docs-2",
    type: "created",
    actorId: "account-alice-dev",
    createdAt: "2024-01-04T10:00:00.000Z",
    data: {},
  },
  {
    id: "pull-request-event-acme-docs-2-closed",
    pullRequestId: "pull-request-acme-docs-2",
    type: "closed",
    actorId: "account-alice-dev",
    createdAt: "2024-01-04T12:00:00.000Z",
    data: {},
  },
  {
    id: "pull-request-event-acme-docs-3-created",
    pullRequestId: "pull-request-acme-docs-3",
    type: "created",
    actorId: "account-alice-dev",
    createdAt: "2024-01-06T10:00:00.000Z",
    data: {},
  },
  {
    id: "pull-request-event-acme-docs-4-created",
    pullRequestId: "pull-request-acme-docs-4",
    type: "created",
    actorId: "account-alice-dev",
    createdAt: "2024-01-06T12:00:00.000Z",
    data: {},
  },
  {
    id: "pull-request-event-acme-docs-5-created",
    pullRequestId: "pull-request-acme-docs-5",
    type: "created",
    actorId: "account-alice-dev",
    createdAt: "2024-01-07T09:00:00.000Z",
    data: {},
  },
  {
    id: "pull-request-event-acme-docs-6-created",
    pullRequestId: "pull-request-acme-docs-6",
    type: "created",
    actorId: "account-alice-dev",
    createdAt: "2024-01-08T09:00:00.000Z",
    data: {},
  },
  {
    id: "pull-request-event-acme-docs-6-reviewed",
    pullRequestId: "pull-request-acme-docs-6",
    type: "reviewed",
    actorId: "account-bob-reviewer",
    createdAt: "2024-01-08T11:00:00.000Z",
    data: { reviewer: "bob-reviewer", decision: "approved" },
  },
  {
    id: "pull-request-event-acme-docs-7-created",
    pullRequestId: "pull-request-acme-docs-7",
    type: "created",
    actorId: "account-alice-dev",
    createdAt: "2024-01-08T09:30:00.000Z",
    data: {},
  },
];

/**
 * The seeded review decisions. A review is an explicit collaborator action, so
 * only the record that really carries a stored decision has one: the mergeable
 * pull request `Ship the search fixes` already carries the valid approval of
 * the non-author reviewer `bob-reviewer` for its current compare commit, while
 * every other seeded pull request starts without any decision.
 */
export const SEED_PULL_REQUEST_REVIEWS = [
  {
    id: "pull-request-review-acme-docs-6-1",
    pullRequestId: "pull-request-acme-docs-6",
    reviewerId: "account-bob-reviewer",
    commitId: "commit-acme-docs-search-fixes",
    decision: "approved",
    body: "",
    stale: false,
    superseded: false,
    createdAt: "2024-01-08T11:00:00.000Z",
  },
];

/**
 * The seeded discussion: `Improve onboarding` starts with one ordinary comment
 * of the requested reviewer, so the Conversation view of the public pull
 * request really holds a discussion. An ordinary comment carries no code
 * location; an inline comment is anchored to a file and a line.
 */
export const SEED_PULL_REQUEST_COMMENTS = [
  {
    id: "pull-request-comment-acme-docs-1-1",
    pullRequestId: "pull-request-acme-docs-1",
    commitId: "commit-acme-docs-release-prepare",
    authorId: "account-bob-reviewer",
    body: "The onboarding steps read well; the search example still needs a second pass.",
    path: null,
    line: null,
    outdated: false,
    pending: false,
    createdAt: "2024-01-05T11:00:00.000Z",
  },
];

// Only the mergeable record carries a stored `test` result: it is the success
// the merge requirement starts from. Every other seeded pull request has never
// stored a result for its current compare commit, so the Checks area of those
// records displays the initial `pending` state. A result belongs to one commit,
// so a new compare commit starts as pending again.
export const SEED_PULL_REQUEST_CHECKS = [
  {
    id: "pull-request-check-acme-docs-6-test",
    pullRequestId: "pull-request-acme-docs-6",
    commitId: "commit-acme-docs-search-fixes",
    name: "test",
    status: "success",
    updatedById: "account-alice-dev",
    createdAt: "2024-01-08T11:30:00.000Z",
    updatedAt: "2024-01-08T11:30:00.000Z",
  },
];
