# ARCHITECTURE

React 18 + Vite + TypeScript frontend with hash routing, and a zero-dependency Node HTTP backend
serving a same-origin `/api` JSON API plus the built frontend. Implemented: identity and browser
sessions (REQ-1), organizations/teams/repository access, creation, forking and visibility (REQ-2,
REQ-3), code browsing, history, diffs, search, branches and the web editor (REQ-4), repository issues
(REQ-5), branch protection and pull requests (REQ-6).

## 修改入口

- `backend/src/app.mjs` — `createRequestHandler`: API routing (auth routes, `/api/account/*`, then
  `orgApi`), cookies, static serving, 404 fallback. `backend/src/server.mjs` — `PORT` (default 3000),
  extra ports from `platform-ports.json` unless `ARC_EXTRA_PORTS=0`, `SHALLOW_DATA_DIR`, one
  `createServer` per port, `await store.ensureSeeded()` and `await orgStore.ensureSeeded()` before
  serving.
- `backend/src/lib/auth-rules.mjs` — `MESSAGES` (exact user-visible text), `validateUsername`
  (`USERNAME_PATTERN`: lowercase/digit runs joined by single `-`/`_`, 1–39 chars, no edge separator),
  `validateEmail`, `validatePassword`, `validateRegistration`, `validatePasswordReset`,
  `validatePasswordChange`. `auth-store.mjs` — `SEED_ACCOUNTS` (optional per-entry `password`, else
  `SEED_PASSWORD`), `seedAccountId`, scrypt credentials, `ensureSeeded`, sessions, `describeDevice`.
- `backend/src/lib/org-rules.mjs` — `ORG_MESSAGES`, `BRANCH_MESSAGES`/`FILE_MESSAGES`, role lists
  (`WRITE_ROLES`, `TRIAGE_ROLES`, `ACCESS_ROLES`), name/role/branch validators;
  `validateOrganizationName` accepts either case, `normalizeOrganizationName` lowercases.
  `org-seeds.mjs` — `createSeedState()`: every predefined organization, team, membership, repository,
  branch, commit, grant, label, milestone, issue, pull request and audit event. `org-store.mjs` — that
  state plus `readAllowed`/`writeAllowed`/`triageAllowed`/`manageAllowed`/`maintainAllowed`, creation/
  fork/visibility, branch and file commits, code-view readers, `listRepositoryMemberAccountIds`, branch
  protection rules, `listAuditEvents` and `ensureSeeded`; it spreads
  `createIssueStore`/`createPullRequestStore` (one file writer). `audit-log.mjs` —
  `AUDIT_ACTIONS` (the exact action names), `publicAuditEvent`, `recordAuditEvent` (appends an event
  inside the mutator of the change it records).
- `backend/src/lib/repository-code-store.mjs` (pure branch readers), `text-diff.mjs`,
  `repository-code-routes.mjs` / `repository-write-routes.mjs` (per-repository GET code views and the
  write views); `issue-store.mjs` + `issue-routes.mjs` + `issue-rules.mjs` (the `.../issues` surface incl. reactions,
  `ISSUE_MESSAGES`); `pull-request-routes.mjs` + `pull-request-store.mjs` +
  `pull-request-rules.mjs` (the `.../pulls` surface); `release-rules.mjs` + `release-store.mjs` +
  `release-routes.mjs` (the `.../releases` surface); `org-routes.mjs` delegates to them and keeps
  `/api/organizations*`.
- `frontend/src/lib/routes.ts` — `parseRoute`, hash builders, `routeRepository`,
  `activeSessionsHash`; `App.tsx` — the shell (`AppHeader` + `RoutedView` in `app-shell`), the
  route dispatch and the revoked-session redirect; `hash-route.ts` — `navigate`/`replace` bridges;
  `lib/session.tsx` — the session context (`user`, `revoked`, `setUser`); `auth-api.ts` / `org-api.ts`
  — typed same-origin calls (`fetchSession`, `fetchActiveSessions`, `revokeSession`).
- `frontend/src/components/` + `pages/` — one file per view. REQ-1: `SignUpPage`, `SignInPage`,
  `ForgotPasswordPage`, `SettingsPage` (with its `Security` section), `PasswordSettingsPage`,
  `ActiveSessionsPage`; the `AccountMenu` trigger. REQ-2: `OrganizationPage` (its Owner-only
  `Audit log` entry) + `OrganizationAuditLogPage`, `YourOrganizationsPage`, `NewOrganizationPage`.
  `RepositoryGeneralSettings.tsx` is the one place the visibility change and (REQ-3-5) the
  `Archive repository`/`Restore repository` confirmations live.
  REQ-5: `RepositoryIssuesPage`, `RepositoryIssuePage`.
  REQ-4-5: `RepositoryReleasesPage`, `RepositoryNewReleasePage`, `RepositoryReleasePage`; the
  `Releases` tab of `RepositoryPage`.
  REQ-6: `RepositoryPullRequestsPage`, `RepositoryNewPullRequestPage`,
  `RepositoryPullRequestPage`, `components/PullRequestReview|PullRequestReviewers|PullRequestMerge|
  RepositoryBranchProtection.tsx`.
- Tests: `frontend/src/pages/*.test.tsx`, `backend/test/*.test.mjs`; the fakes under
  `frontend/src/test/` must stay in sync with the seeded rules, accounts and fixtures.

## 关键约束

- Trusted boundary: every route handler re-validates the rules; the UI only mirrors `fieldErrors`.
  Requests are same-origin `fetch` with cookies. Session = HttpOnly `shallow_session` cookie holding a
  server-side id; `getSessionAccount` is the only session reader (and the only place a session's
  last-active stamp is refreshed), `/api/session` answers `{user, revoked}` (`revoked` is true only
  when the cookie names a stored session that is no longer active), a failed sign-in
  `401 {message:"Invalid credentials"}` with no cookie.
- REQ-1-4 sessions: a session record carries a secret `id` (= cookie value) plus `publicId` (the only
  client-visible field). `GET /api/account/sessions` lists the account's **active**
  sessions, the cookie's own first with `current: true`;
  `POST /api/account/sessions/:publicId/revoke` marks another one inactive (`Session revoked`, `400`
  for the current session, `404` for unknown/foreign) and both routes need a session (`401`). A
  revoked cookie resolves to no user: while `session.revoked` is true, `RoutedView` redirects every
  view except the account-access routes to `#/sign-in`, URL included; a browser without a session
  keeps the public home entry and sign-out clears cookie and revoked state.
- Organization identity (REQ-2-1-2 evolution): a submitted identifier may use either case and is
  normalized to lowercase before the uniqueness check, before persistence and in `getOrganization`, so
  `EVO-LAB-02` collides with a stored `evo-lab-02`; an invalid identifier or whitespace-only display
  name creates nothing. The audit log (REQ-2-4) is read by `GET /api/organizations/:id/audit-log`
  (Owner only: `401` visitor, `403` Member) and holds `{actor, action, target, timestamp}` rows that
  `recordAuditEvent` appends inside the same store update as the action; the page keeps its selected
  `action` filter in the hash search string, so a reload restores the same filtered table.
- Read rule (`readAllowed`) — `GET /api/repositories?q=`, organization list, workspace list,
  repository detail, every code view, every issue view and every release view: public is readable by
  anyone, private only by an organization Owner, a direct account grant or a member of a granted team;
  membership alone grants nothing.
- Branches are the unit of reading: `defaultBranch` applies when no `branch` is named, every code-view
  response carries the resolved `branch` plus `defaultBranch`, and the branch travels in the hash
  search string (`?branch=...`) so a reload restores the same snapshot. A branch is only a named
  reference to its head commit, which holds the whole snapshot; a chain is walked through
  `parentCommitId`, commits are append-only and code search matches content lines only.
- Write rule (`writeAllowed`) is separate from read and manage: organization Owner, repository owner
  and a direct/team `Write`/`Maintain`/`Admin` grant may create branches and commits; `Read`/`Triage`
  only read (`403` from `POST .../branches`/`.../files`, while `GET .../branches` stays open with
  `canWrite`). A new branch copies nothing and is rejected with `Invalid branch`/`Branch name already
  exists`; `PATCH .../default-branch` needs `manageAllowed` and writes only `defaultBranch`; `POST
  .../files` appends one commit and moves the branch head in one `store.update`.
- Pull requests and branch protection (REQ-6): a PR is repository + repository-scoped number (not a
  branch, commit or issue) with status Draft/Open/Closed/Merged only — creation stores Open (or Draft)
  and the target head as the creation-time base, Merged is terminal, and the compare commit derives
  from the source branch head. Creating needs `writeAllowed`, the transitions also accept the author,
  `PATCH .../pulls/:number/checks` needs `manageAllowed`, and `canMaintain` gates review and merge.
  Comments and reviews need a signed-in non-author with `writeAllowed` on an Open PR and are fixed to
  the compare commit (a moved branch makes them `stale`); reviewers need the author or `canMaintain`
  plus a repository-associated collaborator. Merge re-reads `mergeStateOf` and enforces every enabled
  rule of the target's protection rule independently (approval, `test`, no conflict, no pending
  `Request changes`); a failure changes nothing. `branchProtectionRules` are keyed by repository +
  exact branch name.
- Issues (repository + number, stored in `organizations.json`): list, detail, creation, comments and
  every view read the same record, and the state/keyword filters stay in the browser. Create/edit/
  comment need `writeAllowed`; assign/label/milestone/status need `triageAllowed` (`403` for a `Write`
  caller, `canTriage` hides the control, the detail payload adds the `available*` lists); every route
  writes only the field the body carries and pairs the change with its own timeline event in one
  `store.update`.
- Issue reactions (REQ-5-5): `issueReactions` in `organizations.json` stores one record per issue ×
  account × `ISSUE_REACTION_TYPES` name (`+1`, `issue-rules.mjs`); the mutators touch nothing else,
  so the issue, timeline, discussion and metadata never change.
  `POST|DELETE .../issues/:n/reactions[/:type]` needs a session but no repository role (`401`
  visitor, `400` other name, `404` unknown issue); the detail payload carries
  `reactions[{type,count,reacted}]` and `canReact`, `false` for a visitor, who then sees the counts
  with no `Add reaction` control.
- Releases (REQ-4-5): a release is its repository plus its exact tag, so `release-store.mjs`
  (`getRelease`/`createRelease`) is the only reader/writer and the tag is unique inside that
  repository only. List and detail apply the read rule and carry `canPublish`; `POST .../releases`
  (401 visitor, 403 non-writer) re-checks the write rule, refuses an unknown target branch and answers
  a duplicate tag with `Tag already exists`, shown once on the form's tag field and writing nothing.
- `BranchSelector` (repository overview and Code page): the button `Branch <current branch name>`
  opens a textbox `Find branch` plus `role=option` buttons with the exact branch names; a writer also
  gets `Create branch: <name>`. `Add file` (Menu → `Create new file`), only with `canWrite`, opens
  `RepositoryNewFilePage`.
- The repository Search box is the header `role="search"` searchbox named "Search": on routes
  `routeRepository` resolves, Enter opens `#/repositories/:owner/:name/search?q=...`, elsewhere it
  searches repositories (REQ-3-1); the query lives in the hash. That global search is
  `GET /api/repositories?q=` filtered by the read rule and then by name **or** persisted description,
  lowercased on both sides (REQ-3-1 evolution).
- Archive status (REQ-3-5): the stored repository carries `archived`, `publicRepository` exposes it
  and `setRepositoryArchived` is the only writer; `writeAllowed`/`triageAllowed` answer false for an
  archived repository, while read and `manageAllowed` stay (so an Admin can restore it) and
  `mergeStateOf` refuses a merge. `PATCH /api/repositories/:owner/:name/archive` (body `{archived:boolean}`,
  `401` visitor, `403` non-admin) re-checks the administrator permission. The overview renders the
  exact `Archived` marker; the General panel's confirmations are named `Archive repository` /
  `Restore repository` with `Confirm archive` / `Confirm restore`.
- Creation (`canCreateRepository`): accounts create only in their personal namespace, organizations
  only as `Owner`; names are unique per (ownerType, ownerId, name). Forking re-checks the source read
  rule and the target creation rule and deep-copies the default-branch commits.
  `PATCH .../visibility` needs `manageAllowed` and writes only `visibility`/`updatedAt`.
  `Admin` is per-operation, never a cumulative ladder (`.../access` too).
- `removeOrganizationMember` is atomic (membership + team memberships + direct grants; team grants stay)
  and keeps at least one Owner (`last-owner`). Identity keys are owner + parent + name; URLs use the
  owner's URL identifier, headings the display name. Passwords are scrypt hash+salt, never returned;
  changing or resetting a password leaves no usable session for the old credential.
- Distinct names elsewhere: the clone-menu `Code` button vs the `Code` link, the `Commits` link with
  its count beside it, and each metadata selector naming the change once.
- Hash routing is the router (`lib/hash-route.ts` bridges clicks synchronously). `App.tsx` renders
  the global `<header>` banner (brand `Home` link, global `Search`, the signed-in username and
  `AccountMenu`) inside `.app-shell`, beside the single `<main>` the routed view renders — pages must
  not render `AppHeader` themselves, otherwise the header lands inside `main` and loses `banner`.
  Unknown `/api/*` or static paths and non-GET statics return 404 JSON.

## 必要准备

- Data dir: `SHALLOW_DATA_DIR` (controller temp dir), local `backend/.data`, git-ignored. An inherited
  file is upgraded, never skipped or overwritten: `auth-store.ensureSeeded()` (called by `server.mjs`,
  lazily by the first auth read) appends missing `SEED_ACCOUNTS` by stable id/username and backfills
  the newer session fields, so old accounts, sessions and user changes survive; `org-store.ensureSeeded()`
  appends preset records missing by `seedKey` (record id, or organization+account for memberships) and
  remembers them in `appliedSeedKeys`, so removals are not re-applied and startups stay idempotent.
- `SEED_ACCOUNTS` (`auth-store.mjs`) share `Valid-password-123!`; the `evo-*` evolution entries use
  `Evo-Password-987!` (read the file for the exact list). Membership/grants live in `org-seeds.mjs`;
  the org-side account ids are `seedAccountId(username)`.
- REQ-1-4 needs no seeded session: two browser sessions are two sign-ins. `firefox`/`chrome`
  User-Agents become the `describeDevice` labels (`Chrome on Linux`).
- Organization/repository seeds (`org-seeds.mjs`) define every preset organization, team,
  membership, repository, branch, commit, release, grant, label, milestone, issue and pull request —
  read the file for exact names, numbers and grants. Worth knowing: `acme-demo` (`Acme Demo`) owns the
  public `acme-docs` (its `main` carries one protection rule: approval + `test`), the REQ-4 `*-demo`
  repositories and the private `secret-research`/`visibility-demo`; `repo-owner/acme-docs` and
  `fork-user/acme-docs-fork` are private, so a visitor search for `acme-docs` keeps one match.
  `evo-lab-02`/`evo-audit-org` carry the REQ-2 evolution organizations (the latter with the private
  `evo-audit-repo`). The public evolution fixtures are personal-namespace repositories: `evo-search-*`
  (description `evolution-notebook`), `evo-archive-repository-s1` (active) plus `-s2`/`-s3` (archived,
  Admin `evo-archive-admin`, Read `evo-archive-viewer` on `-s2`), this round's
  `evo-branch-owner/evo-branch-switch-sN` (default branch `evo-main-sN` plus `evo-feature-sN`) and
  `evo-release-owner/evo-release-repository-sN` (default branch `evo-main-sN`, releases `evo-v0-1-s2`
  and `evo-v0-1-s3`). REQ-5-5 adds `evo-reaction-author/evo-reaction-repository-s1` (issues
  `Evo reaction issue s1`–`s3`, `s3` with one `+1`).
- `acme-docs` history: `Initial commit` (`org-owner`, 2024-05-01) then `Document search flow`
  (`alice-dev`, five days before seeding) changing `src/search.ts`; `src/README.md` alone carries the
  searchable phrase.
- Entry points: home `Public organizations`/`Repositories`, or `Account menu` →
  `Your organizations`/`Settings` (`Active sessions`, `Password and authentication`)/`Sign out`.
