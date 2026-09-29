// Pull request seed provisioning: for every repository named `acme-docs` the
// seed data includes pull requests `Improve onboarding` (Open) and `Fix search`
// (Closed), both authored by alice-dev, plus the `test` check initially pending
// on each PR's current compare commit (REQ-6-1 seed data). The Open/Draft pair
// main↔feature-search stays free so REQ-6-2-3 can create that comparison.

import { prKey } from "./pulls.mjs";

export function seedRepositoryPullRequests(state, repoId) {
  const now = Date.now();
  const daysAgo = (days) => new Date(now - days * 86400000).toISOString();
  const git = state.git?.[repoId];
  const mainHead = git?.branches?.main ?? "c2";
  const releaseHead = git?.branches?.release ?? "c4";
  const featureHead = git?.branches?.["feature-search"] ?? "c3";
  const draftHead = git?.branches?.["draft-feature"] ?? "c5";
  const paginationHead = git?.branches?.["search-pagination"] ?? "c6";
  const mergeReadyHead = git?.branches?.["merge-ready"] ?? "c7";
  const mergeBlockedHead = git?.branches?.["merge-blocked"] ?? "c8";

  const pulls = {
    1: {
      id: `${repoId}:1`,
      repoId,
      number: 1,
      title: "Improve onboarding",
      description: "Improve the onboarding flow for new users.",
      author: "alice-dev",
      status: "open",
      baseBranch: "main",
      compareBranch: "release",
      baseCommit: mainHead,
      compareCommit: releaseHead,
      createdAt: daysAgo(6),
      updatedAt: daysAgo(1),
    },
    2: {
      id: `${repoId}:2`,
      repoId,
      number: 2,
      title: "Fix search",
      description: "Return a result for non-empty search queries.",
      author: "alice-dev",
      status: "closed",
      baseBranch: "main",
      compareBranch: "feature-search",
      baseCommit: mainHead,
      compareCommit: featureHead,
      createdAt: daysAgo(4),
      updatedAt: daysAgo(3),
    },
    3: {
      id: `${repoId}:3`,
      repoId,
      number: 3,
      title: "Draft onboarding update",
      description: "Proposed onboarding improvements, still in draft.",
      author: "alice-dev",
      status: "draft",
      baseBranch: "main",
      compareBranch: "draft-feature",
      baseCommit: mainHead,
      compareCommit: draftHead,
      createdAt: daysAgo(2),
      updatedAt: daysAgo(1),
    },
    4: {
      id: `${repoId}:4`,
      repoId,
      number: 4,
      title: "Search result pagination",
      description: "Pagination for the search result list.",
      author: "carol-dev",
      status: "open",
      baseBranch: "main",
      compareBranch: "search-pagination",
      baseCommit: mainHead,
      compareCommit: paginationHead,
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    },
    // REQ-6-5 seeds: separate Open PRs for the successful merge and the
    // refused merge. #5 targets protected `main` and already has a valid
    // non-author Approve (bob-reviewer) on its current compare commit plus
    // `test: success`, so it is mergeable; #6 targets protected `main` with
    // `test: success` but has no valid approval, so its merge entry stays
    // disabled with “Review required by branch protection”.
    5: {
      id: `${repoId}:5`,
      repoId,
      number: 5,
      title: "Merge eligible changes",
      description: "Final onboarding improvements ready to merge.",
      author: "alice-dev",
      status: "open",
      baseBranch: "main",
      compareBranch: "merge-ready",
      baseCommit: mainHead,
      compareCommit: mergeReadyHead,
      createdAt: daysAgo(2),
      updatedAt: daysAgo(1),
    },
    6: {
      id: `${repoId}:6`,
      repoId,
      number: 6,
      title: "Merge blocked changes",
      description: "Changes that still need an approving review.",
      author: "alice-dev",
      status: "open",
      baseBranch: "main",
      compareBranch: "merge-blocked",
      baseCommit: mainHead,
      compareCommit: mergeBlockedHead,
      createdAt: daysAgo(2),
      updatedAt: daysAgo(1),
    },
  };
  state.pullRequests[repoId] = pulls;

  const openKey = prKey(repoId, 1);
  const commentId = `${openKey}:comment:c1`;
  state.pullRequestComments[openKey] = {
    [commentId]: {
      id: commentId,
      prKey: openKey,
      author: "bob-reviewer",
      body: "I can draft the new onboarding flow.",
      createdAt: daysAgo(2),
    },
  };
  state.pullRequestTimelines[openKey] = [
    {
      id: `${openKey}:tl:1`,
      type: "created",
      author: "alice-dev",
      createdAt: daysAgo(6),
    },
    {
      id: `${openKey}:tl:2`,
      type: "comment",
      author: "bob-reviewer",
      commentId,
      createdAt: daysAgo(2),
    },
  ];
  state.pullRequestChecks[openKey] = {
    [releaseHead]: {
      test: { status: "pending", setter: null, setAt: null },
    },
  };

  const closedKey = prKey(repoId, 2);
  state.pullRequestTimelines[closedKey] = [
    {
      id: `${closedKey}:tl:1`,
      type: "created",
      author: "alice-dev",
      createdAt: daysAgo(4),
    },
    {
      id: `${closedKey}:tl:2`,
      type: "closed",
      author: "alice-dev",
      createdAt: daysAgo(3),
    },
  ];
  state.pullRequestChecks[closedKey] = {
    [featureHead]: {
      test: { status: "pending", setter: null, setAt: null },
    },
  };

  // The dedicated ready-for-review seed PR (REQ-6-2-4): a Draft PR authored
  // by alice-dev with no submitted reviews; its Ready for review transition
  // converts it to Open without changing title, branches or number.
  const draftKey = prKey(repoId, 3);
  state.pullRequestTimelines[draftKey] = [
    {
      id: `${draftKey}:tl:1`,
      type: "created",
      author: "alice-dev",
      createdAt: daysAgo(2),
    },
  ];
  state.pullRequestChecks[draftKey] = {
    [draftHead]: {
      test: { status: "pending", setter: null, setAt: null },
    },
  };

  // The separate Open PR for the pending-comment scenario (REQ-6-3-3):
  // authored by carol-dev so bob-reviewer is a non-author Write reviewer on
  // both Open PRs.
  const pendingKey = prKey(repoId, 4);
  state.pullRequestTimelines[pendingKey] = [
    {
      id: `${pendingKey}:tl:1`,
      type: "created",
      author: "carol-dev",
      createdAt: daysAgo(1),
    },
  ];
  state.pullRequestChecks[pendingKey] = {
    [paginationHead]: {
      test: { status: "pending", setter: null, setAt: null },
    },
  };

  // REQ-6-5 merge seed states. The eligible PR already has the reviewer's
  // Approve on the current compare commit and a successful `test` check; the
  // blocked PR has `test: success` but no approval decision at all.
  const eligibleKey = prKey(repoId, 5);
  state.pullRequestTimelines[eligibleKey] = [
    {
      id: `${eligibleKey}:tl:1`,
      type: "created",
      author: "alice-dev",
      createdAt: daysAgo(2),
    },
    {
      id: `${eligibleKey}:tl:2`,
      type: "review",
      author: "bob-reviewer",
      decision: "approve",
      createdAt: daysAgo(1),
    },
  ];
  state.pullRequestChecks[eligibleKey] = {
    [mergeReadyHead]: {
      test: { status: "success", setter: "alice-dev", setAt: daysAgo(1) },
    },
  };
  state.pullRequestReviews = state.pullRequestReviews ?? {};
  state.pullRequestReviews[eligibleKey] = {
    [`${eligibleKey}:review:1`]: {
      id: `${eligibleKey}:review:1`,
      prKey: eligibleKey,
      reviewer: "bob-reviewer",
      commitId: mergeReadyHead,
      decision: "approve",
      explanation: "The onboarding improvements look good.",
      createdAt: daysAgo(1),
    },
  };

  const blockedKey = prKey(repoId, 6);
  state.pullRequestTimelines[blockedKey] = [
    {
      id: `${blockedKey}:tl:1`,
      type: "created",
      author: "alice-dev",
      createdAt: daysAgo(2),
    },
  ];
  state.pullRequestChecks[blockedKey] = {
    [mergeBlockedHead]: {
      test: { status: "success", setter: "alice-dev", setAt: daysAgo(1) },
    },
  };
}
