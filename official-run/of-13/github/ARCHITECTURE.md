# Architecture

## Stack and entry points

- `frontend/` — React 18 + Vite + TypeScript, hash routing (`src/lib/hash-route.ts`), Vitest + Testing Library. `backend/` — zero-dependency Node HTTP (`server.mjs` →
  `createHandler` in `app.mjs`); `api.mjs` owns `/api/*`, delegating to the `api-repository-*.mjs`/`api-organizations.mjs` modules; unknown paths answer 404.
- Platform contract: `PORT` (default 3000) plus the ports in `platform-ports.json` (3301) unless `ARC_EXTRA_PORTS=0`, each its own `http.createServer` on `0.0.0.0`;
  `/health` and `/api/health` return `{ ok: true }`; static files come from `frontend/dist` resolved from the server file location.
- Services over one `store` (`app.mjs`): `accounts`, `organizations`, `teams`, `access`, `code`, `history`, `codeSearch`, `search`, `repositories`, `visibility`, `branches`,
  `files`, `issues`, `issueWrites`, `issueMetadata`, `pulls`, `pullTransitions`, `pullReviews`, `pullReviewers`, `pullChecks`, `branchProtection`; every service re-resolves the
  viewer and re-checks its stored permission in the write.

## Persistence and seeds

- State file `join(SHALLOW_DATA_DIR ?? backend/.data, "state.json")`, written atomically by `json-store.mjs`. Collections: `accounts`, `sessions`,
  `organizations`, `memberships`, `teams`, `teamMembers`, `repositories`, `repositoryGrants`, `branches`, `commits`, `labels`, `milestones`, `issues` (+ `issueComments`/
  `issueEvents`/`issueReactions`), `pullRequests` (+ `pullRequestEvents`/`pullRequestReviews`/`pullRequestComments`/`pullRequestChecks`) and `branchProtectionRules`.
- Shared shapes: repository `{ id, ownerType, ownerId, name, description, visibility, defaultBranch, sourceRepositoryId? }`; repositoryGrant
  `{ id, repositoryId, subjectType: account|team, subjectId, role, grantedBy, updatedAt }`; commit `{ id, repositoryId, sha, message, authorId, parentId, parentIds?, createdAt, files }`;
  label/milestone/issue with `number`, `title`/`name`, `state`, `authorId`, `assigneeIds`, `labelIds`, `milestoneId`; append-only issueEvent; unique issueReaction.
- Pull request `{ id, repositoryId, number, title, description, authorId, status: draft|open|closed|merged, sourceBranch (= compare), targetBranch (= base), baseCommitId
  (creation time), compareCommitId (current), reviewerIds, createdAt, updatedAt, closedAt, closedById, mergedAt, mergedById, mergeCommitId?, mergeCommitSha? }` (number unique per
  repository); pullRequestEvent (append-only: `created`, `review_requested`, `review_request_removed`, `ready_for_review`, `reviewed`, `stale_reviews_marked`, `commented`,
  `closed`, `reopened`, `merged`); pullRequestReview `{ reviewerId, decision, body, commitId, stale, superseded, createdAt }` — a decision counts only while neither stale nor
  superseded **and** on the current compare commit; pullRequestComment `{ authorId, body, path?, line?, commitId, outdated, pending, createdAt }` — kept at its
  original commit and line; pullRequestCheck `{ pullRequestId, commitId, name: "test", status: pending|success|failure,
  updatedById, updatedAt }` — the `test` status of one commit, `pending` while no result is stored; branchProtectionRule `{ repositoryId, branchName (verbatim),
  requireApproval, requireStatusCheck, createdById, createdAt, updatedById, updatedAt }` — one rule per repository+branch.
- Seed accounts (`seed.mjs`, only without a state file): `alice-dev` / `alice.dev@example.test` and `bob-reviewer` / `bob.reviewer@example.test`, both
  `Valid-password-123!`, verified, active; `carol-maintainer` / `carol.maintainer@example.test`, same password, direct `maintain` grant on `acme-docs`, no organization
  membership (the Maintain account). `alice-dev` is Admin wherever she is Owner (`acme-demo` Owner, owner of her fork); `bob-reviewer` is the distinct non-Admin
  collaborator and seeded Write reviewer of `acme-docs` (direct `write` grant), a plain member below Maintain, so Write alone never triages, merges or administers.
- Seed organization `acme-demo` (`Acme Demo`): `acme-docs` (public, `main`) and `secret-research` (private); `bob-reviewer` owns the public `bob-notes`; `alice-dev`'s private
  `acme-docs-fork` holds the duplicate-name conflict. Teams (display-only hierarchy, no members): `platform-team` (seeded `write` grant on `acme-docs`), `frontend-team` (child),
  `frontend-child`, `design-team`.
- Seed code (`seed-code.mjs`): `main` → `d4e5f6a` "Document search flow" over `a1b2c3d` "Initial commit"; `feature-search`/`draft-feature` → `f7a8b9c`, `release` → `b8c9d0e`,
  `search-filters` → `c9d0e1f`, `search-ranking` → `d0e1f2a`, `search-fixes` → `e1f2a3b`, `docs-polish` → `f2a3b4c`; every branch above `main` refreshes `src/search.ts` plus one
  added file, so each seeded pull request shows `3 additions, 1 deletions`.
- Seed branch protection (`seed-branch-protection.mjs`): one rule for `acme-docs` `main` with **both** requirements (`1 approval`, `Require status check test`), so the mergeable
  and the blocked merge records start from a protected target; no other branch carries a rule. Conflicting GIVENs: REQ-4-4's direct write uses the unprotected
  `feature-search` (the editor states the protection up front).
- Seed pull requests (`seed-pull-requests.mjs`, public `acme-docs`), none starting with a reviewer request: `#1 Improve onboarding` Open (`release` → `main`, one
  discussion comment); `#2 Fix search` Closed and `#3 Draft onboarding update` Draft (`feature-search`/`draft-feature` → `main`); `#4 Update search filters`/`#5 Refine
  search ranking`/`#7 Refresh the docs layout` Open (`search-filters`/`search-ranking`/`docs-polish` → `main`) as reviewable records without an initial decision (`#7`
  without a check result either — the blocked record); `#6 Ship the search fixes` Open (`search-fixes` → `main`) carries the valid non-author approval of `bob-reviewer`
  and `test: success` (the mergeable record). Only `#6` stores a check result; every other compare commit answers `pending`. Seed issues: labels `bug` + `documentation`,
  milestones `Q3 launch`/`v1.0`; open `#1 Improve onboarding`, closed `#2 Legacy welcome text`, invalid-edit seed `#3 Original issue title`; `bob-notes` owns the foreign
  `bug` label and `Personal backlog` milestone. Runtime ids `<kind>-<uuid>`; credentials `scrypt:salt:digest`.

## Auth, organization, repository and code contracts

- `GET /api/session` → `{ account | null }`; `POST` `{ identifier, password }` → `{ account }` or 401 `{ error: "Invalid credentials" }` (one generic failure for unknown account,
  wrong password and unavailable account); `DELETE` ends it. The cookie `shallowcode_session` (HttpOnly, SameSite=Lax) resolves every protected request.
- `/api/organizations`: `GET`/`POST` (session), `GET .../:name` → `{ organization, viewerRole }`, plus `.../members`/`.../teams`/`.../repositories`. Membership and team writes are
  Owner-only; removing a member clears its team memberships and direct grants (400 `Organization must have at least one Owner` keeps the last Owner).
- `/api/repositories/:owner/:name` → `{ repository, viewerRole, canAdminister }` (404 unknown; 403 unreadable private). Code reads: `tree?branch=&path=`, `blob?branch=&path=`,
  `commits?branch=&path=` (newest first), `commits/:sha?path=`, `compare?branch=&base=&compare=&path=`, `search?branch=&q=&path=&language=`; unknown branch/path 404; every read
  returns `viewerRole`. `POST .../branches` (session) `{ name, base? }` and `POST .../files` `{ branch, path, content, message, previousPath? }` → 201 — a rule for that exact
  branch refuses the commit with 403 `The branch is protected by a branch protection rule` before any write. `GET .../settings/branches` → `{ repository, branches,
  canAdminister, canWrite, branchProtectionRules }`; `POST .../settings/branches` `{ defaultBranch }` and `POST .../settings/branches/protection` `{ branchName,
  requireApproval, requireStatusCheck }` → `{ branchProtectionRules }` are Admin (or organization Owner) only; saving an existing branch name replaces that rule's toggles.
- Issues: `GET .../issues` → `{ repository, issues, labels, milestones, counts }`; `GET .../issues/:number` (leading `#` tolerated) → the issue with comments, events,
  `viewerRole`, `canWrite`, `canTriage` and (triaging viewers only) `assigneeCandidates`. Writes answer that payload: `POST` (201), `PATCH`/`PUT .../:number` (200, submitted
  fields only), `POST .../:number/comments`, `.../reactions`; create/edit/comment need `canWriteRepository`, a reaction only view; title 1–256 after trimming, description/comment
  ≤ 65536, failures 400 `{ error, fieldErrors }`, a new number `max(number)+1`. Triage metadata (`issue-metadata.mjs`; Triage/Maintain/Admin only): `POST .../:number/assignees`,
  `.../labels`, `.../milestone`, `.../state`, each accepted call appending its activity record.

## Pull request, review and merge contract

- Under `/api/repositories/:owner/:name/pulls`: `GET` → `{ repository, canCreate, counts, pullRequests }`; `GET /compare?base=&compare=` → the read-only comparison (Write+ only); `GET /:number` → `{ repository, pullRequest, comparison, checks, reviews, comments, events, viewerRole, canWrite, canMerge, mergeable, mergeConditions,
  mergeBlocker, targetProtection, canReadyForReview, reviewerCandidates, canRequestReviewers, canClose, canReopen }`; `POST` `{ base, compare, title, description?, draft? }`
  → 201; `POST /:number/ready-for-review`, `/:number/merge`, `/:number/close`, `/:number/reopen` → 200; `POST /:number/checks` `{ name: "test", status }` → 200 (a repository
  Admin only; answers the detail payload) and `GET /:number/checks` → `{ checks }`. Failures are 401/403/404 first, then 400 `{ error, fieldErrors }`.
- Creation rules: Write/Maintain/Admin (org Owner counts) only, rejected without a partial record when the branches are the same, have no comparable commit or difference, the
  title is blank (`Title is required`) or overlong (1–256 after trimming, description ≤ 65536), or the repository already holds a **Draft or Open** pull request of the same pair
  (Closed and Merged never block). A Draft becomes Open when its author, a Maintain, an Admin or the org Owner calls ready for review; only Maintain/Admin/Owner may merge an
  Open record, and Merged is terminal. `pull-request-transitions.mjs` owns creation plus the ready/merge/close/reopen transitions.
- Collaboration writes (Write/Maintain/Admin; they answer the detail payload): `POST /:number/comments` `{ body, path, line, pending? }` (201) anchors the comment to a changed
  line of the current diff (`pending` keeps it private); `POST /:number/reviews` `{ decision: comment|approve|request_changes, body? }` (201) stores the decision on the current
  compare commit, superseding that reviewer's earlier one for that commit; `POST /:number/reviewers` `{ username }` (201) / `DELETE /:number/reviewers/:username` (200)
  store or delete one reviewer request (author or Maintain/Admin/org Owner; candidate = non-author with Write+). `pull-request-reviews.mjs` and
  `pull-request-reviewers.mjs` own those writes; `pull-request-checks.mjs` the `Checks` area.
- Merge (`pull-request-merge-rules.mjs`): the conditions are reread at merge — no valid `Request changes`, the enabled rule requirements of the target branch (1 valid
  non-author approval for the current compare commit, `test` success for it) and no conflict (a path both the target head and the compare commit changed since the base with a
  different result). An unprotected target needs neither approval nor check success; a missing approval answers `Review required by branch protection`. One atomic `store.update`
  then creates a merge commit (parents: the target-branch head at merge time and the current compare commit), moves the target branch to it and stores merger, time and
  commit identifier. A new compare commit marks earlier decisions stale and starts the check as pending.

## Domain rules and frontend

- `validation.mjs` is the single source of truth for username/email/password rules; `accounts.mjs` runs every auth check-and-write inside one `store.update`. `access.mjs` is
  the single source of truth for permissions: `canReadRepository`, `canAdministerRepository` (Admin), `canWriteRepository` (Write/Maintain/Admin), `canTriageRepository`,
  `canMaintainPullRequest` (Maintain/Admin/org Owner) and `canBeAssignedToIssue` (rank ≥ Triage). Roles are not a cumulative ladder, so Write alone never triages, merges or
  manages access; `.../access` is Admin-only. `pull-request-decisions.mjs` is the single reader of review decisions and the `test` check of the current compare commit.
- Frontend routes (`App.tsx`, `*Href` helpers build every address): `#/`, `#/login`, `#/signup`, `#/forgot-password`, `#/settings(/password)`, `#/dashboard`, `#/organizations`,
  `#/repositories/new`, `#/search?q=&type=` and per repository `tree/:branch/*path`, `blob/:branch/*path`, `commits`, `commit/:revision`, `compare`, `search`, `edit/:branch/*path`,
  `issues[...]`, `pulls[?state=&author=&review=]`, `pulls/new`, `pulls/compare`, `pulls/:number[|/commits|/files|/checks]`, `settings[|/general|/branches|/access]`.
- `RepositoryHeader` renders the `owner/name` heading, the `Public`/`Private` marker, `Default branch: <name>`, `ClonePopover` (button `Code`), `Fork`, the `Add file` menu, the
  `Edit` link for a Write viewer, the optional branch selector, a `Commits` history link and the nav links `Code`/`Issues`/`Pull requests`/`Settings`. Issue metadata
  controls: a button named exactly `Assignees`/`Labels`/`Milestone` for Triage+ only with `role="listbox"` of `role="option"` buttons; the header button is `Close
  issue`/`Reopen issue`; Read/Write viewers receive none of these.- `frontend/src/features/`: `repositories/` (overview, tree, blob, editor, commits, commit, compare, code search, settings, `BranchProtectionRules` — rules verbatim with the
  `1 approval`/`Require status check test` summaries, `Add branch protection rule` and its `Branch name pattern`/two-checkbox form with `Create` or `Save changes`; access,
  `useRepositoryResource`, `RepositoryPageStates`), `issues/`, `pulls/` and the account/organization/search/workspace pages.
- `frontend/src/features/pulls/`: `PullRequestsListPage` (number, title, status, author, branches, time; `Author` and `Review status` refilter only, carried by the address);
  `PullRequestsComparePage` (`base`/`compare` selects, `Compare changes`, the diff, `Create pull request`/`Create draft pull request`, then the `New pull request` form with
  `Title`/`Description`); `PullRequestDetailPage` (heading exactly the title, visible status, the links `Conversation`/`Commits`/`Files changed`/`Checks`, `Ready for review`,
  `Close pull request`/`Reopen pull request`, the sidebar `Reviewers`); `PullRequestMergeArea` (the single method `Create a merge commit`, every condition with
  `Satisfied`/`Not satisfied` next to `Merge pull request`, the `Confirm merge` box and the `Merge commit`/`Merger`/`Time` block of a merged record); `PullRequestChecks` (visible
  `test: <status>` with its setter, the `test status` combobox whose `pending`/`success`/`failure` options are clickable, `Save` for a repository Admin);
  `PullRequestConversation`, `PullRequestCommits`, `PullRequestFilesChanged`, `PullRequestReviewForm` (`Summary`, radios `Comment`/`Approve`/`Request changes`, `Submit
  review`), `PullRequestReviewSummary` (the live `status` region of the review status, its accessible name exactly `Approved`/`Changes requested`, followed by every stored
  decision with reviewer, body and time; once per page: named `Review summary` in Conversation, unnamed on Files changed, whose `Summary` field it must not
  shadow), `pull-filters.ts`, `pull-format.ts`. The file editor states a protected branch before any submit.

## Checks

- `run_tests backend` — `node --test` over `backend/test/` (branch-protection, checks and merge suites included); `run_tests frontend` — Vitest with one worker and the API
  stubbed via `test-support/auth-stub.ts` plus the fixtures `repository-stub.ts`, `repository-code-stub.ts`, `issue-stub.ts`, `pull-fixtures.ts` + `pull-request-stub.ts`, whose
  write stubs mirror the stored rules (protection rules, merge conditions, merge commit).