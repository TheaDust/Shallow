# ARCHITECTURE

React 18 + Vite + TypeScript frontend with hash routing, and a zero-dependency Node HTTP backend
serving a same-origin `/api` JSON API plus the built frontend. Implemented: identity/session (REQ-1),
organizations/teams/repository access, creation, forking and visibility (REQ-2, REQ-3), code browsing,
history, diffs, search, branches and the web editor (REQ-4), repository issues with discussion,
editing, metadata and status transitions (REQ-5-1/5-2/5-3/5-4), and branch protection rules with pull
request discovery, comparison, draft creation, detail, line-comment review (REQ-6-1/6-2/6-3).

## 修改入口

- `backend/src/app.mjs` — `createRequestHandler`: API routing, cookies, static serving, 404 fallback.
- `backend/src/lib/auth-rules.mjs`, `auth-store.mjs` — exact messages, `SEED_ACCOUNTS`, scrypt
  credentials, sessions, `seedAccountId`. `org-rules.mjs` — `ORG_MESSAGES`,
  `BRANCH_MESSAGES`/`FILE_MESSAGES`, the role lists (`WRITE_ROLES`, `TRIAGE_ROLES`, `ACCESS_ROLES`) and
  the name/role/branch validators.
- `backend/src/lib/org-seeds.mjs` — `createSeedState()`: every predefined organization, team, membership,
  repository, branch, commit, grant, label, milestone and issue. `org-store.mjs` — `createJsonStore` state
  plus `readAllowed`/`writeAllowed`/`triageAllowed`/`manageAllowed`/`maintainAllowed`, creation/fork/visibility,
  branch and file commits, code-view readers, `listRepositoryMemberAccountIds` (the eligible issue
  assignees) and the branch protection rules
  (`listBranchProtectionRules`/`upsertBranchProtectionRule`); it spreads `createIssueStore(store)` and
  `createPullRequestStore(store)` so issues, pull requests and the organizations share the same file writer.
- `backend/src/lib/repository-code-store.mjs` — pure branch readers; `text-diff.mjs` — `diffFileSnapshots`.
  `repository-code-routes.mjs` / `repository-write-routes.mjs` — the per-repository GET code views (incl.
  `branches`) and the write views; `issue-store.mjs` — issue/comment/timeline persistence (`listIssues`,
  `getIssue`, `createIssue`, `addIssueComment`, `updateIssueContent`, `setIssueAssignee`, `setIssueLabel`,
  `setIssueMilestone`, `setIssueStatus`, the repository label/milestone readers); `issue-routes.mjs` +
  `issue-rules.mjs` — the `.../issues` surface (list, detail, `PATCH :number`, `PATCH :number/status`,
  `comments`, `assignees`, `labels`, `milestone`) and `ISSUE_MESSAGES`. `org-routes.mjs` delegates to them
  and keeps `/api/organizations*`.
- `backend/src/lib/pull-request-routes.mjs` + `pull-request-store.mjs` + `pull-request-rules.mjs` — the
  `.../pulls` surface (list, `pulls/compare`, create, detail, `PATCH :number/status|checks`, `POST
  :number/comments|reviews|merge`, `POST`/`DELETE :number/reviewers`). The store derives the current
  compare commit from the source branch head; `addPullRequestReviewComment` anchors a comment to commit +
  file + line, `addPullRequestReview` keeps one review per reviewer keyed to the compare commit (stale once
  the branch moves), `request/removePullRequestReviewer` write `pull.requestedReviewers`, and
  `mergePullRequest` re-checks `mergeStateOf` (target protection, non-author approval, `test` success, no
  conflict / Request changes) before appending the merge commit and setting Merged + merger/time/commit.
  `repository-write-routes.mjs` also owns `GET`/`POST .../branch-protections`.
- `backend/src/server.mjs` - `PORT` (default 3000), extra ports from `platform-ports.json` unless
  `ARC_EXTRA_PORTS=0`, `SHALLOW_DATA_DIR`, one `createServer` per port.
- `frontend/src/lib/routes.ts` - `parseRoute`, hash builders (`repositoryPullsHash`, `repositoryPullHash`,
  `repositoryPullCommitsHash`/`...FilesHash`/`...ChecksHash`, `repositoryNewPullHash`), `routeRepository`;
  `App.tsx` dispatch. `hash-route.ts` - `navigate`/`replace` synchronous bridges. `org-api.ts` - typed
  same-origin calls.
- `frontend/src/components/` + `pages/` - one file per view. REQ-5: `RepositoryIssuesPage` (list) and
  `RepositoryIssuePage` (detail, `Comment` form, `Edit issue title`/`Edit issue description`,
  `Assignees`/`Labels`/`Milestone` triggers, `Close issue`/`Reopen issue`). REQ-6:
  `RepositoryPullRequestsPage` (list), `RepositoryNewPullRequestPage` (`Create pull request` /
  `Create draft pull request` entries + form), `RepositoryPullRequestPage`
  (`Conversation`/`Commits`/`Files changed`/`Checks` links, aggregate `pull-files__totals`, per-changed-line
  `Add comment` editor labelled `Comment` with `Add single comment`/`Start a review`) plus
  `components/PullRequestReview.tsx` (`Review changes` dialog with `Approve`/`Request changes` radios and
  `Submit review`, `ReviewsList`), `components/PullRequestReviewers.tsx` (`Reviewers` picker with a
  `Search` textbox) and `components/PullRequestMerge.tsx` (`Create a merge commit`, `Merge pull request` →
  `Confirm merge`, blocked explanation), and `components/RepositoryBranchProtection.tsx` (the `Branches`
  rule form).
- Tests: `frontend/src/pages/*.test.tsx`, `backend/test/*.test.mjs` (REQ-4: `repository-code`,
  `repository-branch`; REQ-5: `issue-api`, `repository-issues`; REQ-6: `pull-request-api`,
  `pull-request-review`, `repository-pulls`); the fakes under `src/test/` must stay in sync with the seeded
  rules.

## 关键约束

- Trusted boundary: `app.mjs`, `org-routes.mjs`, `repository-code-routes.mjs`,
  `repository-write-routes.mjs` and `issue-routes.mjs` re-validate every rule; the UI only mirrors
  `fieldErrors`; requests are same-origin `fetch` with cookies. Session = HttpOnly `shallow_session` cookie
  holding a server-side id; `/api/session` returns `{user}`/`{user:null}`, a failed sign-in `401
  {message:"Invalid credentials"}` with no cookie, and `getSessionAccount` is the only session reader.
- Read rule (`readAllowed`) - `GET /api/repositories?q=`, organization list, workspace list, repository
  detail, every code view and every issue view: public is readable by anyone, private only by an
  organization Owner, a direct account grant or a member of a granted team; membership alone grants nothing.
- Branches are the unit of reading: `defaultBranch` applies when no `branch` is named, every code-view
  response carries the resolved `branch` plus `defaultBranch`, and the branch travels in the hash search
  string (`?branch=...`) so a reload restores the same snapshot. A branch is only a named reference: its
  head commit holds the whole snapshot, a chain is walked through `parentCommitId`, commits are
  append-only and code search matches content lines only.
- Write rule (`writeAllowed`) is separate from read and manage: organization Owner, repository owner and
  a direct/team `Write`/`Maintain`/`Admin` grant may create branches and commits; `Read`/`Triage` only
  read (`403` from `POST .../branches`/`.../files`, while `GET .../branches` stays open with `canWrite`).
  A new branch copies nothing and is rejected with `Invalid branch`/`Branch name already exists`; `PATCH
  .../default-branch` needs `manageAllowed` and writes only `defaultBranch`. `POST .../files` appends one
  commit and moves the branch head in one `store.update` (conflict → `fieldErrors.path`, empty message →
  `Commit message is required`).
- Pull requests and branch protection (REQ-6): a PR is identified by repository + repository-scoped
  number and is not a branch, commit or issue. Its status is only ever Draft/Open/Closed/Merged: creation
  stores Open (or Draft) plus the target head as the creation-time base commit, `setPullRequestStatus`
  allows draft→open/closed and closed→open, and Merged is terminal; the current compare commit is derived
  from the source branch head, so the same proposal follows a moved compare branch. Creating needs
  `writeAllowed`, the transitions additionally accept the author, and `PATCH .../pulls/:number/checks` (the
  `test` check of the compare commit plus its setter) needs `manageAllowed`; `canMaintain`
  (Maintain/Admin/Owner) is reported for review and merge. Reviewing a line comment (`POST
  .../pulls/:number/comments`) and a review decision (`POST .../pulls/:number/reviews`, decision
  `approved`/`changes-requested` + summary) both need a signed-in non-author with `writeAllowed` on an Open
  PR (the view answers `canReview`); a review is fixed to the compare commit and turns `stale` when the
  branch moves. `Reviewers`/`POST`/`DELETE .../pulls/:number/reviewers` need the author or `canMaintain`
  and accept only a repository-associated collaborator (never the author). Merge (`POST
  .../pulls/:number/merge`) needs `canMaintain` on an Open PR and re-reads `mergeStateOf`: each enabled rule
  of the target's protection rule is enforced independently (1 non-stale non-author approval; `test`
  success) while every target also needs no conflict and no valid `Request changes`; a missing approval
  answers `Review required by branch protection`. Merged is terminal; failure leaves branches/PR untouched.
  Rules in `branchProtectionRules` are keyed by
  repository + exact branch name and `upsertBranchProtectionRule` updates the same branch instead of
  duplicating it; `GET .../branch-protections` stays readable with the repository and answers `canManage`.
- Issues (repository + number, stored in `organizations.json`): list, detail, creation, comments and every
  view read the same record; status/keyword filters stay in the browser (`RepositoryIssuesPage`,
  `?state=`/`?q=`). Per-operation roles: create/edit/comment need `writeAllowed`; assign/label/milestone and
  status need `triageAllowed` (`403` for a `Write` caller, `canTriage` hides the control). `PATCH
  .../issues/:number` writes only the field the body carries (rejected title → `400 {fieldErrors.title}`);
  `PATCH .../issues/:number/status` takes `{status:"open"|"closed"}`. Every metadata/status route resolves
  the same-repository target and pairs it with its own timeline event (`closed`/`reopened` leaves other
  fields untouched) in one `store.update`; the detail payload adds `availableLabels`/`availableMilestones`/
  `availableAssignees` (triage only). Selectors save on selection and close; summaries name the kind of
  change without repeating the value, so a username/label/milestone stays one occurrence.
- `BranchSelector` (repository overview and Code page): the unique button `Branch <current branch name>`
  opens a textbox `Find branch` plus `role=option` buttons with the exact branch names, filtered while
  typing; a writer also gets `Create branch: <name>`, otherwise the panel shows `No matching branch` /
  `Invalid branch` and Escape closes it. `Add file` (Menu → `Create new file`), only with `canWrite`,
  opens `RepositoryNewFilePage`.
- The repository Search box is the header `role="search"` searchbox named "Search": on routes
  `routeRepository` resolves, Enter opens `#/repositories/:owner/:name/search?q=...`, elsewhere it searches
  repositories (REQ-3-1); the query lives in the hash, so results and the value survive reload.
- Creation (`canCreateRepository`): accounts create only in their personal namespace, organizations only
  as `Owner`; names are unique per (ownerType, ownerId, name). Forking re-checks the source read rule and
  the target creation rule and deep-copies the default-branch commits (a private source forks privately).
  `PATCH .../visibility` needs `manageAllowed` and writes only `visibility`/`updatedAt`; the UI hides it
  unless the server returned `canManage`. `Admin` is per-operation, never a cumulative ladder (`.../access` too).
- `removeOrganizationMember` is atomic (membership + team memberships + direct grants; team grants stay)
  and keeps at least one Owner (`last-owner`). Identity keys are owner + parent + name; URLs use the
  owner's URL identifier, headings the display name. Team hierarchy is display only (a cyclic parent is
  rejected, `cyclic`); passwords are scrypt hash+salt and never returned.
- Hash routing is the router (`lib/hash-route.ts` bridges clicks synchronously); every view renders one
  `<main>` with `AppHeader`. The clone-menu `Code` button stays distinct from the `Code` link; the history
  link is named `Commits` with its count beside it. Unknown `/api/*` or static paths and non-GET statics
  return 404 JSON.

## 必要准备

- Data dir: `SHALLOW_DATA_DIR` (controller temp dir), local `backend/.data`, git-ignored; seeded only
  when empty (`auth.json`, `organizations.json`).
- Seeds (`SEED_ACCOUNTS`, `org-seeds.mjs`; all accounts share `Valid-password-123!`): organization
  `acme-demo` (`Acme Demo`) with the `platform-team`/`frontend-team`/`frontend-child`/`access-role-team`
  teams and their members, plus `acme-docs` (public) and `secret-research`/`visibility-demo` (private) with
  their grants.
- `acme-docs` history: `Initial commit` (`org-owner`, 2024-05-01) then `Document search flow`
  (`alice-dev`, five days before seeding) changing `src/search.ts`; only `src/README.md` carries the
  searchable phrase, so `search flow` stays unambiguous.
- REQ-6 seeds (all accounts share `Valid-password-123!`): `acme-docs` carries the branches
  `feature-search` (changes `src/search.ts`), `onboarding-docs`, `draft-feature`, `overview-docs`,
  `public-search`, `review-feature`, `pending-feature` and the one-file
  `change-request-feature`/`reviewer-request-feature`/`merge-feature`/`blocked-feature`/`closable-feature`/
  `protected-feature`, plus PRs #1-#13 (`pullRequestSeeds`): #6 Draft (`draft-author`), #8 author
  `pr-author`, #9 with the seeded `bob-reviewer` approval + `test` success, #10 without approval, #11
  `Closable onboarding PR`, #12 `Protected onboarding PR`, #13 `Fix search`. Write for
  `pr-contributor`/`draft-author`/`pr-reviewer`/`bob-reviewer`/`pr-author`, Maintain `pr-maintainer`, Read
  `pr-viewer`; `acme-docs` `main` holds one protection rule (approval + `test`).
  `branch-protection-demo` (public) carries `main`/`onboarding-status` and PR #1 whose `test` starts
  pending; Admin `protection-admin`, no grant `protection-viewer`; its rules stay empty because the
  REQ-6-1 scenario creates its own rule.
- REQ-4-3/4-4 seeds (public, `acme-demo`-owned, via `seedBranchSet`): `branch-switch-demo` (`main`,
  `feature-search` with the target-only `main-only.md`), `default-branch-demo` (`main` default plus
  `release`), `file-management-demo`; Write for `branch-contributor`/`file-contributor`, Admin for
  `default-branch-admin`, none for `default-branch-viewer`.
- REQ-5 seeds (`acme-docs`): issues #1 `Improve onboarding` (Open, one comment), #2 `Legacy welcome text`
  (Closed), #3 `Commentable onboarding issue`, #4 `Comment validation issue`, #5 `Editable onboarding
  issue`, #6 `Original issue title`, #7 `Assignable onboarding issue`, #8 `Labelable onboarding issue`,
  #9 `Milestone onboarding issue` (one isolated mutation seed each, none carrying an assignee/label/
  milestone), #10 `Closable onboarding issue`, #11 `Protected onboarding issue` (Open). Labels
  `bug`/`documentation`, milestone `v1.0`; `issue-author`/`issue-commenter` Write, `issue-editor` Maintain
  and `issue-viewer` Read. Fakes under `src/test/` carry the same records/grants.
- Every repository has a `main` branch (or its `defaultBranch`) and an initialized new repository adds
  one "Initial commit". `repo-owner/acme-docs` and `fork-user/acme-docs-fork` are private, so visitor
  search for `acme-docs` keeps one match. Entry points: home `Public organizations`/`Repositories`, or
  `Account menu` → `Your organizations`/workspace (`Settings`, `Sign out`).
