# ARCHITECTURE

Simplified GitHub collaboration platform: `frontend/` (React + Vite + TS) and `backend/`
(zero-dependency Node HTTP) serving `frontend/dist`.

## Entry points

- `backend/src/server.mjs` — `PORT` (default 3000) plus every `platform-ports.json` port unless
  `ARC_EXTRA_PORTS=0`; one `http.createServer` per port on `0.0.0.0`; static root from the server file
  location; unknown paths answer 404 without exiting.
- `backend/src/app.mjs` — `createRequestHandler({ store, staticRoot })`; `/api/*` goes to
  `api/discovery-routes.mjs`, `api/repository-routes.mjs` (which hands the pull-request sub-resources
  of a resolved repository to `api/pull-request-routes.mjs`), `api/organization-routes.mjs`, then the
  static build (`/` → `index.html`); `/health` and `/api/health` answer the readiness.
- `frontend/src/main.tsx` → `App.tsx` — hash routing (`lib/hash-route.ts`): the auth pages, `/`,
  `/new`, `/workspace`, `/settings[/password]`, `/search?...`, `#/organizations/…` | `#/orgs/…`,
  `#/<name>`, `#/<owner>/<repo>[/code|/commits|/commit/<id>|/compare|/issues|/pulls|/fork|/edit|`
  `/blob|/tree|/settings…]` — all survive reload and direct opening; unknown paths render
  `NotFoundPage`. `lib/` adds `api.ts` (JSON, blocking `postJsonSync`/`mutateJsonSync`),
  `session.tsx`, `forms.ts`.

## Persistence

- `domain/store.mjs` — `createAppStore(dataDir)` wraps `lib/json-store.mjs` (atomic read/update of
  `data.json`) under `SHALLOW_DATA_DIR` (else `backend/data`); the collections `accounts, sessions,
  organizations, memberships, teams, teamMembers, repositories, issues, pullRequests` normalize to
  `[]`; the seed is written on the first write.
- `Account { id, username, email, emailVerified, status, passwordHash, createdAt }` (scrypt),
  `Session { id, accountId, active, createdAt }` — the browser holds only the httpOnly `sid` cookie.
- `Organization { id, name, displayName }`, `Membership { organizationId, accountId, role }`,
  `Team { organizationId, name, description, parentTeamId }`, `TeamMember { teamId, accountId }` —
  the team hierarchy grants nothing. `Repository { id, ownerType, ownerId, name, description,
  visibility, defaultBranch, grants[], branches[], commits[], labels[], milestones[],
  protectionRules[] }`, one grant per subject, with branch `{ name, headId, protected? }` and commit
  `{ id, message, authorId, author, branch, parentId, createdAt, files[], tree[] }` carrying an
  immutable `tree` snapshot; directories, a file's newest commit and the history derive from it
  (`domain/repository-branches.mjs`).
- Work items (`domain/issues.mjs`): `Issue { id, repositoryId, number, title, body, status, author,
  authorId, labels[], assignees[], milestone, createdAt, updatedAt, comments[], reactions[],
  timeline[] }`, `number` unique per repository; `issue-writes.mjs` needs `Write|Maintain|Admin`,
  `issue-metadata-writes.mjs` `Triage|Maintain|Admin`, with the atomic `issue-mutations.mjs` helpers.
- Pull requests (`domain/pull-requests.mjs`, REQ-6): `PullRequest { id, repositoryId, number, title,
  description, authorId, author, status: draft|open|closed|merged, baseBranch, compareBranch,
  baseCommitId, compareCommitId, reviewers[], reviews[], comments[], reviewComments[], checks[],
  timeline[], createdAt, updatedAt, mergedAt?, mergedBy?, mergeCommitId?, closedAt? }`, `number`
  unique per repository. The current compare commit is the compare-branch head at read time, so a new
  commit moves it while a stored `checks[]`/`reviews[]` record stays attached to its own commit (a new
  commit's check is `pending`, an older decision `stale`); `pullRequestChangedFiles()` numbers each
  diff line per side (`lineNumber` + `side`) for inline comments; `pullRequestMergeState()` applies
  the base-branch rule (≥1 valid non-author approval, no valid request-changes, `test` success) and
  returns the `conditions[]` the merge area spells, where a missing required approval reads
  `Review required by branch protection`. `pullRequestPermissions()` adds `canClose`/`canReopen`.
- Reviewer requests and status transitions (REQ-6-4, REQ-6-6): `reviewers[]` = `{ username, accountId,
  requestedBy, requestedById, requestedAt }` — one pending-review relationship per candidate, never a
  submitted decision; a candidate holds Write/Maintain/Admin and is not the author
  (`pullRequestReviewerCandidates()` feeds `reviewerCandidates`). `pull-request-reviewers.mjs`
  creates/deletes it (author of an Open/Draft PR, Maintain, Admin or Owner) and keeps every review,
  comment and activity of that account; `changePullRequestStatus` (`pull-request-writes.mjs`) stores
  the status, `closedAt` and the activity and moves no branch.
- Reviews (REQ-6-3, `pull-request-reviews.mjs`): `reviewComments[]` = `{ filePath, line, side,
  commitId, authorId, author, body, pending, createdAt }` (`pending` = the private draft of `Start a
  review`, served to its author only and published with the review; a published comment of an older
  compare commit reads `outdated`). `reviews[]` = `{ reviewerId, reviewer, decision:
  comment|approve|request_changes, summary, commitId, createdAt }`; only the latest decision of one
  reviewer on the current compare commit counts. Both writes need Write/Maintain/Admin (never the
  author) while the pull request is open, and store nothing when refused.
- Branch protection (`domain/branch-protection.mjs`, REQ-6-1): `protectionRules[]` holds one rule per
  exact branch name, `{ id, pattern, requireApproval, requireStatusCheck, createdBy, createdAt,
  updatedBy, updatedAt }`; an enabled requirement protects that branch (a direct file commit is
  refused, the requirements gate the merge). `branch-protection-writes.mjs` / `pull-request-writes.mjs`
  check the role inside the same atomic update that stores the change: only `Admin` saves a rule or a
  `test` check result, only `Maintain|Admin|Owner` merges.

## Seed state (shared across scenarios)

- `alice-dev`, `bob-reviewer`, `carol-maintainer`, `dana-observer`, all `Valid-password-123!`.
  `acme-demo` ("Acme Demo"): alice Owner, bob Member; `acme-web` (public, no grant), `acme-internal`
  (private, team `platform-team` Write); `platform-team` → `frontend-team` → `frontend-child` has no
  members and membership alone grants no access.
- `alice-dev` owns public `acme-docs`, private `secret-research` (bob Write) and the private fork
  `acme-docs-fork` (REQ-3-2-2). Grants on `acme-docs`: `carol-maintainer` Maintain (also an assignable
  member) and `bob-reviewer` Write (the REQ-6-3/6-4 non-author reviewer); `dana-observer` holds no role
  anywhere (REQ-5-3-1) and reaches public repositories read-only.
- `acme-docs` code: `main` (head `Document search flow`: adds `src/search.ts`, modifies `README.md`
  and `docs/intro.md`), `feature-search` (from the `main` head: adds `main-only.md`, drops the label
  line of `src/search.ts`, so `main` ← `feature-search` is two files with `3 additions, 1 deletions`),
  `release` (= the `main` head), `onboarding-docs` (= the `main` head plus `docs/onboarding.md` and
  the same `src/search.ts` change), `draft-feature`; `secret-research` adds `must not leak`.
- `acme-docs` issues: **#1** `Improve onboarding` (open, alice, `bug`/`documentation`, assignee
  `bob-reviewer`, milestone `Q3 launch`, one comment), **#2** `Legacy welcome text` (closed, bob,
  `bug`), **#3** `Original issue title` and **#4** `Add changelog page` (open, empty); no seeded
  reaction. `secret-research` holds protected **#1** `Summarize the early findings`; `acme-web` keeps
  its own labels/milestones.
- `acme-docs` pull requests (REQ-6): **#1** `Improve onboarding` (alice, Open, `main` ←
  `onboarding-docs`, one comment by `bob-reviewer`), **#2** `Fix search` (alice, Closed, `main` ←
  `feature-search`; both pull requests carry the same two-file diff with `3 additions, 1 deletions`),
  **#3** `Draft onboarding update` (alice, Draft, `main` ← `draft-feature`), **#4**
  `Add onboarding notes for the release` and **#5** `Add draft notes for the release` (alice, Open,
  `release` ← `onboarding-docs`/`draft-feature` — the REQ-6-3 review workspace). No seeded reviewer
  request and no check record (`test` starts `pending`); `acme-docs` carries no protection rule
  because REQ-6-1 creates the first one on `main`, and `main` ← `feature-search` stays free as a
  creation context.
- `merge-lab` (public, alice; `carol-maintainer` Maintain, `bob-reviewer` Write) serves REQ-6-5: `main`
  carries both protection requirements; **#1** `Merge the release notes` (`feature-merge`) is eligible
  (bob approved the current compare commit, `test: success`), **#2** `Update the merge checklist`
  (`feature-blocked`) is blocked (check `success`, no approval → only `Review required by branch
  protection`), **#3** `Document the release process` (`feature-pending`) keeps `test` pending.

## Shared interfaces

- Auth: `POST /api/accounts` (rules in `domain/validation.mjs`); `POST /api/sessions` (any failure =
  `401 { error: "Invalid credentials" }`); `GET|DELETE /api/session` → `user = { username, email,
  organizations }`; password change/recovery (REQ-1-3, REQ-1-1-3, code `123456`).
- Organizations (REQ-2): `GET /api/organizations`, `POST /api/organizations`,
  `GET /api/organizations/<org>` = `{ organization, viewerRole, members, teams, repositories }`;
  Owner-only writes under `/members[/<username>]` and `/teams[/<team>[/members[/<username>]]]`.
- Repository reads (`domain/repository-access.mjs`): `GET /api/repositories/<owner>/<repo>` =
  `{ repository }` with `viewerRole`, `canChangeVisibility`, `canChangeDefaultBranch`, `canWrite`,
  `forkedFrom`, `branches`, `protectionRules`, `canManageBranchProtection`, `files`/`entries`,
  `cloneUrls`; `GET .../contents?path=&branch=` answers a file or a directory plus `commitCount`,
  next to the GET-only `.../commits?branch=&path=`, `.../commits/<id>`, `.../revisions`,
  `.../compare?base=&compare=` (`400 Unknown revision`) and `.../code-search?q=` (REQ-4-2).
- Repository writes (`domain/repository-writes.mjs`): `POST /api/repositories` (initializing stores
  `main` and its `Initial commit`) → `201`; `POST .../forks`; `POST .../visibility`
  `{ visibility, confirmation }` → `200`; failures `401`/`403`/`400 { error, fields }`.
- Branch writes (`domain/repository-branch-writes.mjs`, REQ-4-3-2/3): `POST .../branches`
  `{ name, base }` → `201`; `POST .../default-branch` `{ branch }` → `200`; name rule (`Invalid
  branch`, `Branch already exists`, `Base revision not found`) 1–255 `[A-Za-z0-9._/-]`; Write+ creates
  a branch, Admin moves the default.
- File commits (`domain/repository-file-commits.mjs`, REQ-4-4): `POST .../contents` `{ branch, path,
  content, message, create, originalPath? }` → `201 { branch, path, file, commit }`, one atomic
  update that moves the head; `404` unknown branch, else `400 { error, fields }` with the verbatim
  messages (`Invalid file path`, `Commit message is required`, `This branch is protected`, …).
- Issues (REQ-5): `GET .../issues` → `{ repository, viewerRole, permissions, labels, milestones,
  assignableMembers, openCount, closedCount, issues }`; `GET .../issues/<number>` adds `comments` and
  the chronological `timeline`. Content writes (`POST .../issues`, `.../title`, `.../description`,
  `.../comments`, `.../reactions`) need Write/Maintain/Admin; metadata writes (`.../assignees`,
  `.../labels`, `.../milestone`, `.../status`) need Triage/Maintain/Admin; otherwise `401`/`403` or
  `400 { error, fields }` with nothing stored (`repositoryAssignableMembers()` = Triage+).
- Repository access (REQ-2-3): `GET|PUT .../access` `{ subjectType, subject, role }` →
  `{ repository, viewerRole, canManage, roles, candidates, grants }`; `GET
  /api/search/repositories?q=` and `GET /api/namespaces/<name>` answer readable ones.
- Pull requests and branch protection (REQ-6): `GET .../pulls` → `{ repository, viewerRole,
  canCreatePullRequest, pullRequests[] }`; `GET .../pulls/<n>` → `{ repository, viewerRole,
  pullRequest }` with `description`, `number`/`title`/`author`/`status`/branches, `check { name,
  status, commitId, setBy, setAt }`, `reviewers` + `reviewerCandidates`, `reviews`, `comments`,
  `reviewComments` (`pending`/`outdated`), `timeline`, `commits[]`, `files[]` + `summary`, `merge`
  (with `conditions`), `mergedBy`/`mergedAt`/`mergeCommitId`, `permissions` (`404` unknown number).
  Writes answer the refreshed payload: `POST .../protection-rules` and `.../pulls/<n>/checks` (Admin),
  `POST .../pulls/<n>/comments` `{ filePath, line, side, body, pending }` and `.../reviews`
  `{ decision, summary }` (non-author Write+ on an Open PR), `POST .../pulls/<n>/merge` (`403` without
  Maintain/Admin, `400 { error, blockers }` while blocked), `.../reviewers[/<username>]` (`400`
  ineligible, `404` unknown) and `POST .../pulls/<n>/close` | `/reopen` (no branch write).

## Frontend conventions

- `lib/session.tsx` — `SessionProvider` loads `GET /api/session` once and exposes `{ user, loading,
  signIn, signOut, refresh }`; `signIn` is blocking, so the cookie is committed before it returns;
  `AppHeader`/`AccountMenu` show the username.
- `features/repositories/`: `repository-api.ts`, `use-repository.ts` (`useRepositoryOverview` with
  `reload()`), `use-repository-contents.ts`, `branch-actions.ts`, `repository-links.ts` (`codeHref`,
  `pullsHref`, `pullHref`, …), `format-commit.ts`, `RepositoryNav.tsx` (the settings-page repository
  links), `RepositoryHeader.tsx` (`<h1>` = `fullName`,
  Public/Private marker, fork source, owner, default-branch chip, the clone-menu button `Code`
  distinct from the `Code` link and the repository links, an optional `tabs` prop,
  `RepositoryFileList`, `BranchSelector` and `BranchProtectionSettings`). The other pages
  (`RepositoryPage.tsx`, the tree/file/editor, organization/team/settings, REQ-4-2
  commit/comparison/code-search and REQ-2-3 access pages) follow the same conventions;
  `test/repository-server-mock.ts` mirrors the seed and the write endpoints.
- `features/issues/` (REQ-5): `issue-api.ts`, `use-issues.ts` (a reload keeps the rendered record),
  `issue-filters.ts`, `issue-links.ts`, `IssueFilterBar.tsx` (links `Open`/`Closed` with
  `aria-current`, searchbox `Search issues`, native `Label` select), `RepositoryIssuesPage.tsx`,
  `NewIssuePage.tsx` and `RepositoryIssuePage.tsx` with the title/description/comment editors, the
  reactions and the metadata controls (`IssueMetadata`, `MetadataPicker`, `IssueStatusControl`).
- `features/pull-requests/` (REQ-6): `pull-request-api.ts`, `use-pull-requests.ts`,
  `pull-request-filters.ts` + `pull-request-links.ts` (filter context and branches in the query),
  `PullRequestFilterBar` (Draft/Open/Closed/Merged, `Author`/`Review status`), `PullRequestList`,
  `PullRequestTabs` (Conversation/Commits/Files changed/Checks as `?tab=` links),
  `PullRequestConversation` (description, `Review summary`, discussions, activity),
  `PullRequestPanels` (`Commit summary` + commits), `PullRequestFiles` (diff summary + review form),
  `PullRequestDiff` (per file: path, numbered lines, one `Add comment` per changed line, `Add single
  comment`/`Start a review`, `Pending review`/`Outdated`) and `PullRequestReviewForm` (`Review changes`
  → `Summary`, radios `Comment`/`Approve`/`Request changes`, `Submit review`),
  `PullRequestReviewers` (the `Reviewers` picker offers the textbox `Search` and `role="option"`
  usernames; every requested account carries `Remove <username>`),
  `PullRequestStatusControl` (`Close pull request` / `Reopen pull request`, no dialog),
  `PullRequestChecks` (`test status` as a native `select` + `Save`, Admin only),
  `PullRequestReviewSummary` (each status a `<strong>`, in Conversation and next to
  `PullRequestReviewers`),
  `PullRequestMergeControl` (sole method
  radio `Create a merge commit`, `Merge conditions`, `Merge pull request` → dialog `Confirm merge`,
  then the merger/time/commit) and `PullRequestReadyForReviewControl` (Draft only). Pages:
  `RepositoryPullRequestsPage.tsx` (rows, filters, `New pull request`),
  `RepositoryNewPullRequestPage.tsx` (`/pulls/new`: `base`/`compare`, `Compare changes`, `Title`/
  `Description` behind `Create pull request`) and `RepositoryPullRequestPage.tsx` (detail).
