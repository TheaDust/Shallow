# ARCHITECTURE

React 18 + Vite + TypeScript frontend with hash routing, and a zero-dependency Node HTTP backend
serving a same-origin `/api` JSON API plus the built frontend. Implemented: identity/session (REQ-1),
organizations/teams/repository access, creation, forking, visibility and archiving (REQ-2, REQ-3), code
browsing, history, diffs, search, branches, the web editor and releases (REQ-4), issues (REQ-5), pull
requests, reviews and branch protection (REQ-6).

## 修改入口

- `backend/src/app.mjs` — `createRequestHandler`: API routing, cookies, static serving, 404 fallback.
- `backend/src/lib/auth-rules.mjs`, `auth-store.mjs` — exact messages, `SEED_ACCOUNTS` (optional per-entry
  `password`), scrypt credentials, `seedAccountId`, the session surface; `session-device.mjs` —
  `deviceLabel`; `org-rules.mjs` — the message maps, role lists, validators and `AUDIT_ACTIONS`.
- `backend/src/lib/org-seeds.mjs` — `createSeedState()`: every predefined organization, team, membership,
  repository, branch, commit, grant, label, milestone and issue. `org-store.mjs` — `createJsonStore` state,
  the `readAllowed`/`writeAllowed`/`triageAllowed`/`manageAllowed`/`maintainAllowed` rules, every
  repository/branch/team write and the audit log; it spreads `createIssueStore`, `createPullRequestStore`
  and `createReleaseStore` so all of them share one file writer.
- `backend/src/lib/repository-code-store.mjs` — pure branch readers; `text-diff.mjs` — `diffFileSnapshots`.
  `repository-code-routes.mjs` / `repository-write-routes.mjs` — the per-repository GET code views (incl.
  `branches`) and the write views; `issue-store.mjs` + `issue-routes.mjs` + `issue-rules.mjs` — the
  `.../issues` surface (list, detail, `PATCH :number`, `PATCH :number/status`, `comments`, `assignees`,
  `labels`, `milestone`, `reactions`), issue/comment/timeline/reaction persistence, `REACTION_TYPES`,
  `addIssueReaction`/`removeIssueReaction` and `ISSUE_MESSAGES`; `org-routes.mjs`
  delegates to them and keeps `/api/organizations*`.
- `backend/src/lib/pull-request-routes.mjs` + `pull-request-store.mjs` + `pull-request-rules.mjs` — the
  `.../pulls` surface (list, compare, create, detail, status/checks, comments/reviews/merge, reviewers,
  milestone): a comment anchors to commit+file+line, one review per reviewer is keyed to the compare commit
  (stale once the branch moves), and `mergePullRequest` re-checks `mergeStateOf` before appending the merge
  commit. `repository-write-routes.mjs` also owns `GET`/`POST .../branch-protections`.
- `backend/src/lib/repository-release-routes.mjs` + `release-store.mjs` — the `.../releases` surface (list,
  detail, publish): publishing needs `writeAllowed`, list/detail follow `readAllowed`, and a used tag is
  refused inside one store update (`Tag already exists`).
- `backend/src/server.mjs` - `PORT` (default 3000), extra ports from `platform-ports.json` unless
  `ARC_EXTRA_PORTS=0`, `SHALLOW_DATA_DIR`, one `createServer` per port.
- `frontend/src/lib/routes.ts` - `parseRoute`, the `repository*Hash` builders, `organizationAuditLogHash`,
  `routeRepository`; `App.tsx` dispatch. `hash-route.ts` - `navigate`/`replace` synchronous bridges.
  `org-api.ts` - typed same-origin calls.
- `frontend/src/pages/ActiveSessionsPage.tsx` — REQ-1-4 `Active sessions` (`#/settings/sessions`, from the
  `Settings` nav); `lib/auth-api.ts` — `fetchAccountSessions`/`revokeAccountSession`.
- `frontend/src/components/` + `pages/` - one file per view. REQ-5: `RepositoryIssuesPage` (list) and
  `RepositoryIssuePage` (detail, `Comment` form, edit/metadata triggers, `Close issue`/`Reopen issue`,
  reactions: the stored counts, the own one as `Remove <type> reaction`, and the `Add reaction` scaffold
  Menu whose item is the `+1` `menuitem`; that row sits inside the `Description` region, and REQ-5-5 seed
  descriptions avoid spelling `+1` so the type text appears once).
  `components/IssueMetadataSelect.tsx` is the shared `Assignees`/`Labels`/`Milestone` selector of both
  detail pages (button + option panel, optional search textbox).
  REQ-6 pages/components: `RepositoryPullRequestsPage`, `RepositoryNewPullRequestPage`,
  `RepositoryPullRequestPage` (Conversation/Commits/Files changed/Checks views), `PullRequestReview`,
  `PullRequestReviewers`, `PullRequestMerge`, `RepositoryBranchProtection` (exact control names in source).
  REQ-4-5: the `RepositoryReleases*` pages, reached from the repository nav's `Releases` link;
  `lib/branch-address.ts` keeps the read branch in the address.
  `pages/OrganizationAuditLogPage.tsx` — the Owner-only `Audit log` table (`Actor`/`Action`/`Target`/
  `Timestamp`) with a `Filter action` combobox whose value lives in `?action=`.
- Tests: `frontend/src/pages/*.test.tsx`, `backend/test/*.test.mjs`, one concern per file; `src/test/`
  fakes must stay in sync with the seeds.

## 关键约束

- Trusted boundary: `app.mjs`, `org-routes.mjs`, `repository-code-routes.mjs`,
  `repository-write-routes.mjs`, `issue-routes.mjs` and `pull-request-routes.mjs` re-validate every rule;
  the UI only mirrors `fieldErrors`; requests are same-origin `fetch` with cookies. Session = HttpOnly
  `shallow_session` cookie holding a server-side secret id; `/api/session` returns `{user, revoked}`, a
  failed sign-in `401 {message:"Invalid credentials"}` with no cookie, and `getSessionAccount` is the only
  session reader. A session record keeps that secret separate from the `publicId` the sessions page lists
  and revokes; only sessions of the signed-in account are revocable (`404` otherwise) and revoking marks
  `active:false`, honoured by the very next request.
- Revoked browsers: `revoked:true` is returned only for a cookie naming an existing but inactive session
  (a signed-out or unknown cookie stays plain `null`), and `App.tsx` sends such a browser to `#/sign-in`
  from any non-account-access route. Usernames allow single `-`/`_` separators (never leading, trailing or
  repeated); email lookup is case-insensitive, username exact.
- Read rule (`readAllowed`) - `GET /api/repositories?q=`, organization list, workspace list, repository
  detail, every code and issue view: public is readable by anyone, private only by an organization Owner, a
  direct account grant or a member of a granted team; membership alone grants nothing. `q` matches
  case-insensitively as a substring of the repository name **or** its stored description (REQ-3-1), always
  inside the readable set.
- Archived repos (REQ-3-5): `archived` is a stored flag, not a visibility, so `readAllowed` is unchanged;
  `writeAllowed`/`triageAllowed`/`maintainAllowed` return false while it is true (writes and merge `403`),
  `manageAllowed` stays so an Admin can restore. `RepositoryGeneralSettings` owns the confirmation dialogs
  (title and confirm button `Archive repository`/`Confirm archive`, `Restore repository`/`Confirm restore`);
  `RepositoryPage` prints the exact `Archived` marker. `PATCH .../archive` writes only `archived`/`updatedAt`,
  so files, issues, branches and grants survive a restore.
- Branches are the unit of reading: `defaultBranch` applies when no `branch` is named, every code-view
  response carries the resolved `branch` plus `defaultBranch`, and the branch travels in the hash search
  string (`?branch=...`) so a reload restores the same snapshot; `lib/branch-address.ts` writes the resolved
  branch into the address, keeping selector, address and file list on one branch after a reload. A branch is
  only a named reference to its head commit; a chain is walked through `parentCommitId`, commits are
  append-only and code search matches content lines only.
- Write rule (`writeAllowed`) is separate from read and manage: organization Owner, repository owner and a
  direct/team `Write`/`Maintain`/`Admin` grant may create branches and commits; `Read`/`Triage` only read
  (`403` from `POST .../branches`/`.../files`, while `GET .../branches` stays open with `canWrite`). A new
  branch copies nothing and is rejected with `Invalid branch`/`Branch name already exists`; `PATCH
  .../default-branch` needs `manageAllowed`. `POST .../files` appends one commit and moves the branch head
  in one `store.update` (conflict → `fieldErrors.path`, empty message → `Commit message is required`).
- Pull requests and branch protection (REQ-6): a PR is repository + repository-scoped number, Draft/Open/
  Closed/Merged only (compare commit = source branch head, Merged terminal). Creating needs `writeAllowed`,
  the transitions also accept the author, `.../pulls/:number/checks` needs `manageAllowed`, and
  `canMaintain` (Maintain/Admin/Owner) covers review and merge. A line comment or review (`.../reviews`)
  needs a signed-in non-author with `writeAllowed` on an Open PR; `.../reviewers` needs the author or
  `canMaintain` and accepts only a repository collaborator, never the author. Merge re-reads `mergeStateOf`
  and enforces each enabled rule of the target's rule independently (1 non-stale non-author approval;
  `test` success) plus no conflict and no valid `Request changes` (missing approval → `Review required by
  branch protection`); a failure leaves branches and PR untouched. Rules are keyed by repository + exact
  branch name (`upsertBranchProtectionRule`); `GET .../branch-protections` answers `canManage`.
- Issues (repository + number, stored in `organizations.json`): list, detail, creation, comments and every
  view read the same record; status/keyword filters stay in the browser (`RepositoryIssuesPage`,
  `?state=`/`?q=`). Create/edit/comment need `writeAllowed`; assign/label/milestone and status need
  `triageAllowed` (`403` for a `Write` caller, `canTriage` hides the control). `PATCH
  .../issues/:number` writes only the field the body carries (rejected title → `400 {fieldErrors.title}`);
  `PATCH .../issues/:number/status` takes `{status:"open"|"closed"}`. Every metadata/status route resolves
  the same-repository target and pairs it with its own timeline event in one `store.update`; the detail
  payload adds `availableLabels`/`availableMilestones`/`availableAssignees` (triage only). Selectors save on
  selection and close. A repository-scoped milestone may belong to an issue
  (`PUT/DELETE .../issues/:number/milestone`) or a pull request
  (`PUT/DELETE .../pulls/:number/milestone`, `canTriage`); neither route creates one or accepts another
  repository's name.
- Reactions (REQ-5-5): `POST/DELETE .../issues/:number/reactions[/:type]` need only a session plus the read
  rule (`canReact`), not a write grant; `+1` is the only type, one record per issue + account + type, and no
  route writes an issue field, a comment or a timeline entry. The detail payload aggregates them into
  `reactions:[{type,count,reacted}]` for every later reader (reload, another account, signed-out visitor).
- `BranchSelector` (overview and Code page): the unique button `Branch <current branch name>` opens a
  textbox `Find branch` plus `role=option` buttons with the branch names, filtered while typing; a writer
  also gets `Create branch: <name>`, otherwise the panel shows `No matching branch` / `Invalid branch` and
  Escape closes it. `Add file` (Menu → `Create new file`), only with `canWrite`.
- The repository Search box is the header `role="search"` searchbox named "Search": on routes
  `routeRepository` resolves, Enter opens `#/repositories/:owner/:name/search?q=...`, elsewhere it searches
  repositories (REQ-3-1); the query lives in the hash, so results and the value survive reload.
- Creation (`canCreateRepository`): accounts create only in their personal namespace, organizations only
  as `Owner`; names are unique per (ownerType, ownerId, name). Forking re-checks the source read rule and
  the target creation rule and deep-copies the default-branch commits (a private source forks privately).
  `PATCH .../visibility` needs `manageAllowed` and writes only `visibility`/`updatedAt`; the UI hides it
  unless the server returned `canManage`. `Admin` is per-operation, never a cumulative ladder (`.../access` too).
- `removeOrganizationMember` is atomic (membership + team memberships + direct grants; team grants stay)
  and keeps at least one Owner (`last-owner`). Organization identifiers normalize uppercase ASCII to
  lowercase before the format/uniqueness checks and before persistence. `GET .../audit-log` is Owner-only
  (`403` for a Member), audit records are appended only by successful organization actions
  (`Organization created`, `Member added`, `Member removed`, `Team created`, `Repository created`) and
  reading or filtering the log never changes it. Identity keys are owner + parent + name; URLs use the
  owner's URL identifier, headings the display name. Team hierarchy is display only (a cyclic parent is
  rejected, `cyclic`); passwords are scrypt hash+salt and never returned.
- Hash routing is the router (`lib/hash-route.ts` bridges clicks synchronously); every view renders one
  `<main>` with `AppHeader`. The clone-menu `Code` button stays distinct from the `Code` link; the history
  link is named `Commits` with its count beside it. Unknown `/api/*` or static paths and non-GET statics
  return 404 JSON.

## 必要准备

- Data dir: `SHALLOW_DATA_DIR` (controller temp dir), local `backend/.data`, git-ignored; seeded only
  when empty (`auth.json`, `organizations.json`).
- Evolution seeds (`auth-store.mjs`/`org-seeds.mjs`; password `Evo-Password-987!`, domain `@evolution.test`):
  REQ-1/2 `evo-register-existing`, `evo-login-case`, `evo-session-owner`/`-s2`/`-s3`, `evo-org-owner`,
  `evo-audit-owner`/`-viewer`, `evo-lab-02`, `evo-audit-org`; REQ-3/4 per-scenario `s1`/`s2`/`s3`
  repositories (`evo-search-catalog`/`evo-search-notebook`, `evo-archive-repository` with `-s2` archived
  public and `-s3` archived private, `evo-branch-switch` default `evo-main-s*`/target `evo-feature-s*`,
  `evo-release-repository` where s2 holds release `evo-v0-1-s2` and s3 the used tag `evo-v0-1-s3`).
  Revoked-session scenarios sign in per browser instead of seeding. REQ-5-5 adds the reaction viewer
  accounts above.
- Seeds (`SEED_ACCOUNTS`, `org-seeds.mjs`; default password `Valid-password-123!`): `acme-demo` with the
  `platform-team`/`frontend-team`/`frontend-child`/`access-role-team` teams and members, `acme-docs`
  (public) and `secret-research`/`visibility-demo` (private) with their grants.
- `acme-docs` history: `Initial commit` (`org-owner`, 2024-05-01) then `Document search flow`
  (`alice-dev`, five days before seeding) changing `src/search.ts`; only `src/README.md` carries the
  searchable phrase, so `search flow` stays unambiguous.
- REQ-6 seeds: PRs #1-#13 with their source branches (`pullRequestSeeds`, `ACEME_DOCS_EXTRA_BRANCHES`);
  `acme-docs` `main` holds one protection rule (approval + `test`), `branch-protection-demo` shows a PR
  whose `test` starts pending with no rule. Per-scenario grants (`accessGrants`): the `pr-*` Write accounts,
  `pr-maintainer` (Maintain), `pr-viewer` (Read), `protection-admin` (Admin on the demo repository).
- REQ-4-3/4-4 seeds (public, via `seedBranchSet`): `branch-switch-demo`, `default-branch-demo`,
  `file-management-demo`; Write `branch-contributor`/`file-contributor`, Admin `default-branch-admin`.
- REQ-5 seeds (`acme-docs`): issue titles #1-#11 in `ACEME_DOCS_ISSUES` (one isolated mutation seed each;
  only #1 carries a comment). Labels `bug`/`documentation`, milestone `v1.0`; Write
  `issue-author`/`issue-commenter`, Maintain `issue-editor`, Read `issue-viewer`.
- REQ-5-5 seeds: public `evo-reaction-repository-s1` (seeded last) holds `Evo reaction issue s1`/`s2`/`s3` —
  only `s3` starts with a stored `+1` (from `alice-dev`) — plus the viewer accounts `evo-reaction-author`/
  `evo-reaction-user` (`@evolution.test`, no repository grant: a public repository is enough to react).
- Every repository has its `defaultBranch` (`main`); a new repository adds one "Initial commit".
  `repo-owner/acme-docs` and `fork-user/acme-docs-fork` are private, so visitor search for `acme-docs` keeps
  one match. Entry points: home `Public organizations`/`Repositories`, or `Account menu` →
  `Your organizations`/workspace (`Settings`, `Sign out`).
