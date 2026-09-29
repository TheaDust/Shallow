// Pull request review submission (REQ-6-3-4): one review decision (Comment,
// Approve or Request changes) is stored against the PR's current compare
// commit, with the reviewer, optional explanation and submission time. A newer
// decision by the same reviewer replaces the effective decision for that
// commit while the old record is preserved; the eligibility computation in
// pulls.mjs reads the stored decisions. Submitting a review also publishes the
// reviewer's pending inline comments (REQ-6-3-3: pending comments are shown
// only after the review is submitted).

export function createPullReviewsDomain(store, helpers) {
  const {
    effectiveRole,
    prKey,
    currentCompareCommit,
    serializePullDetail,
    WRITE_ROLES,
    REVIEW_DECISIONS,
    BODY_MAX,
  } = helpers;

  // Submit a review decision on an Open PR. Only a signed-in reviewer with
  // Write, Maintain or Admin who is not the PR author may submit; the author
  // and Draft PRs cannot. Approve is recorded against the current compare
  // commit, so it can never satisfy the requirement for an older commit, and
  // any valid Request changes blocks merging until a new Comment/Approve for
  // the current commit or a new compare commit makes the old decision stale.
  async function submitPullRequestReview(accountId, owner, name, number, input = {}) {
    const decision = typeof input.decision === "string" ? input.decision : "";
    const explanation = typeof input.summary === "string" ? input.summary.trim() : "";
    let result;
    await store.update(async (state) => {
      const repo = state.repositories?.[`${owner}:${name}`];
      if (!repo) {
        result = { ok: false, notFound: true };
        return;
      }
      const pr = state.pullRequests?.[repo.id]?.[number];
      if (!pr) {
        result = { ok: false, notFound: true };
        return;
      }
      if (pr.status !== "open") {
        result = { ok: false, errors: { review: "Only Open pull requests accept review submissions" } };
        return;
      }
      const role = effectiveRole(state, repo, accountId);
      if (!role || !WRITE_ROLES.has(role) || accountId === pr.author) {
        result = { ok: false, forbidden: true };
        return;
      }
      const errors = {};
      if (!REVIEW_DECISIONS.has(decision)) errors.decision = "Decision is invalid";
      if (explanation.length > BODY_MAX) {
        errors.summary = `Summary must be at most ${BODY_MAX} characters`;
      }
      if (Object.keys(errors).length > 0) {
        result = { ok: false, errors };
        return;
      }
      const git = state.git?.[repo.id];
      const commitId = currentCompareCommit(git, pr);
      const now = new Date().toISOString();
      const key = prKey(repo.id, pr.number);
      state.pullRequestReviews = state.pullRequestReviews ?? {};
      state.pullRequestReviews[key] = state.pullRequestReviews[key] ?? {};
      const id = `${key}:review:${Object.keys(state.pullRequestReviews[key]).length + 1}`;
      const review = {
        id,
        prKey: key,
        reviewer: accountId,
        commitId,
        decision,
        explanation,
        createdAt: now,
      };
      state.pullRequestReviews[key][id] = review;
      for (const record of Object.values(state.pullRequestInlineComments?.[key] ?? {})) {
        if (record.author === accountId && record.state === "pending") {
          record.state = "published";
        }
      }
      state.pullRequestTimelines = state.pullRequestTimelines ?? {};
      state.pullRequestTimelines[key] = state.pullRequestTimelines[key] ?? [];
      state.pullRequestTimelines[key].push({
        id: `${key}:tl:${state.pullRequestTimelines[key].length + 1}`,
        type: "review",
        author: accountId,
        decision,
        createdAt: now,
      });
      pr.updatedAt = now;
      result = {
        ok: true,
        review: {
          reviewer: review.reviewer,
          commitId: review.commitId,
          decision: review.decision,
          explanation: review.explanation,
          createdAt: review.createdAt,
        },
        pull: serializePullDetail(state, repo, pr),
      };
    });
    return result;
  }

  return { submitPullRequestReview };
}
