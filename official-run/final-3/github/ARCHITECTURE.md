# ARCHITECTURE

React 18 + Vite + TS frontend (hash routing) plus a zero-dependency Node HTTP backend serving a
same-origin `/api` JSON API and the built frontend. Implemented: REQ-1 identity/sessions, REQ-2
organizations, teams and the audit log, REQ-3 repository access, creation, search and archive, REQ-4
code browsing, branch switching, the web editor and repository releases, REQ-5 issues, REQ-6 pull
requests and branch protection.

## 修改入口

- `backend/src/app.mjs` — `createRequestHandler`: API routing, cookies, static serving, 404 fallback.
- `backend/src/lib/auth-rules.mjs` + `auth-store.mjs` — exact messages and validators, `SEED_ACCOUNTS`,
  scrypt credentials, `seedAccountId`, the idempotent `upgradeState` and the sessions
  (`createSession`/`listSessions`/`revokeSession`, `describeDevice`) with their
  `GET`/`POST /api/account/sessions*` routes and `/api/session`'s `{user, revoked}`. `org-rules.mjs` —
  `ORG_MESSAGES`, `BRANCH_MESSAGES`/`FILE_MESSAGES`, the role lists (`WRITE_ROLES`, `TRIAGE_ROLES`,
  `ACCESS_ROLES`), the name/role/branch validators and `normalizeOrganizationName` (a submitted
  identifier is lowercased before its format check, uniqueness check and write).
- `backend/src/lib/org-seeds.mjs` — `createSeedState()` (every predefined organization, team,
  membership, repository, branch, commit, grant, label, milestone, issue and audit event) plus
  `SEED_GENERATION`/`upgradeSeedState` (the merge-by-identity seed upgrade). `org-store.mjs` — the JSON
  store, the permission readers (`readAllowed`/`writeAllowed`/`triageAllowed`/`manageAllowed`/
  `maintainAllowed`), creation/fork/visibility/archive writers, branch and file commits, the code-view
  readers (`listRepositoryMemberAccountIds` feeds the eligible issue assignees), the branch protection
  rules and `listAuditEvents`; it spreads `createIssueStore(store)` and `createPullRequestStore(store)`,
  so issues, pull requests and organizations share one file writer.
- `backend/src/lib/repository-code-store.mjs` (pure branch readers), `text-diff.mjs` (`diffFileSnapshots`),
  `repository-code-routes.mjs` (the GET code views incl. `branches`), `repository-write-routes.mjs`
  (branch/file/default-branch/branch-protection writes), `issue-store.mjs` + `issue-routes.mjs` +
  `issue-rules.mjs` (incl. `ISSUE_REACTION_TYPES` and the `reactions` routes), `pull-request-store.mjs` +
  `pull-request-routes.mjs` + `pull-request-rules.mjs`.
  `org-routes.mjs` delegates to them and owns `/api/organizations*`, `PATCH .../visibility`,
  `POST .../archive|restore` and the Owner-only `GET /api/organizations/:id/audit-log`.
- `backend/src/lib/release-store.mjs` + `release-routes.mjs` + `release-rules.mjs` (REQ-4-5) — the stored
  releases (`listReleases`/`getRelease`/`createRelease`), `RELEASE_MESSAGES`/validators and the readable
  list/detail plus the publishing route (`GET`/`POST /api/repositories/:owner/:name/releases`,
  `GET .../releases/:tag`); `org-routes.mjs` delegates to it like the issue/PR routes.
- `backend/src/server.mjs` — `PORT` (default 3000), the extra `platform-ports.json` ports unless
  `ARC_EXTRA_PORTS=0`, `SHALLOW_DATA_DIR`, one `createServer` per port.
- `frontend/src/lib/routes.ts` — `parseRoute`, the hash builders, `routeRepository`; `App.tsx` dispatch;
  `hash-route.ts` — `navigate`/`replace` synchronous bridges; `org-api.ts`/`auth-api.ts` — typed
  same-origin calls; `lib/session.tsx` holds the client session state. One file per view in
  `components/` + `pages/`; the exact control names live there. The header search is
  `components/GlobalSearch.tsx` with `pages/SearchResultsPage.tsx` behind it; the repository settings
  `General` panel (`components/RepositoryGeneralSettings.tsx`) owns both admin operations (visibility
  and `Archive repository`/`Restore repository` with their dialogs). Releases: `RepositoryReleasesPage`
  (list + `New release`), `RepositoryReleasePage` (detail), `RepositoryNewReleasePage` (the
  `Tag name`/`Release title`/`Description`/`Target branch` form) and the `Releases` tab of
  `pages/RepositoryPage.tsx`.
- Tests: `frontend/src/pages/*.test.tsx` and `backend/test/*.test.mjs`, one file per feature; the fakes
  under `src/test/` mirror the server seeds and rules and must stay in sync with them.

## 关键约束

- Trusted boundary: `app.mjs`, `org-routes.mjs`, `repository-code-routes.mjs`,
  `repository-write-routes.mjs` and `issue-routes.mjs` re-validate every rule; the UI only mirrors
  `fieldErrors`; requests are same-origin `fetch` with cookies. Session = HttpOnly `shallow_session`
  cookie holding a server-side id; `getSessionAccount` is the only session reader; a failed sign-in
  answers `401 {message:"Invalid credentials"}` with no cookie.
- Browser sessions (REQ-1-4): one account may hold several at once. A row of `GET /api/account/sessions`
  carries an opaque `key` (never the cookie value), a device label, `lastActiveAt` and `current:true`;
  `POST .../sessions/:key/revoke` revokes another record (the current one is refused), so the revoked
  cookie answers `user:null` everywhere plus `revoked:true` — which sends that browser to `SignInPage` —
  while the current session keeps working. Signed-out records leave the list, revoked ones stay visible.
- Read rule (`readAllowed`) — `GET /api/repositories?q=`, the organization and workspace lists, the
  repository detail, every code view and every issue/PR view: public is readable by anyone, private only
  by an organization Owner, a direct account grant or a member of a granted team; membership alone
  grants nothing. Branches are the unit of reading: `defaultBranch` applies when no branch is named,
  every code view carries the resolved `branch`, and the branch travels in the hash search string
  (`?branch=`) so a reload restores the same snapshot. A branch head commit holds the whole snapshot; a
  chain is walked through `parentCommitId`; commits are append-only and code search matches content only.
- Repository overview (`pages/RepositoryPage.tsx`): the breadcrumb keeps the owner and the repository
  name as two separate links, so the name is its own element (exact-text lookup) on the overview while
  the `h1` stays the combined `owner/name`. Keep that split when touching the page.
- Search (REQ-3-1): the header `role="search"` searchbox named "Search" resolves `routeRepository` —
  inside a repository Enter opens `#/repositories/:owner/:name/search?q=`, elsewhere `#/search?q=` lists
  repositories with one link per result (its accessible name is the repository name) plus the
  owner/name metadata. The query lives in the hash, so results and the value survive a reload; matching
  is case-insensitive and matches a substring of the repository name **or** its persisted description,
  always inside the caller's read scope.
- Write rule (`writeAllowed`) is separate from read and manage: organization Owner, repository owner or
  a direct/team `Write`/`Maintain`/`Admin` grant; `Read`/`Triage` only read (`403` from the mutating
  routes while the GET views stay open with `canWrite`). `triageAllowed` (Triage/Maintain/Admin) gates
  the issue metadata, `maintainAllowed` (Maintain/Admin) the PR reviews and merge, `manageAllowed`
  (Admin/Owner) the settings operations. Archive (REQ-3-5): a stored `repository.archived` keeps the
  repository readable while `writeAllowed`/`triageAllowed`/`maintainAllowed` refuse **every** account
  (file edits, branches, commits, issues, pull requests, comments, reviews, merge); `manageAllowed` keeps
  working, so an Admin still reaches Settings and can restore. `POST .../archive|restore` only flips the
  flag — content, issues, branches and permissions stay — and the flag persists across reload and restart.
- Pull requests (REQ-6): repository + repository-scoped number, never a branch/issue, status only
  Draft/Open/Closed/Merged (Merged terminal), compare commit derived from the source branch head.
  Creating needs `writeAllowed`, the transitions also accept the author, `checks` needs `manageAllowed`,
  `canMaintain` gates reviewers and merge, and line comments/reviews need a signed-in non-author with
  `writeAllowed` on an Open PR (one non-stale review per reviewer, keyed to the compare commit). Merge
  re-reads `mergeStateOf` and every enabled rule of the target's `branchProtectionRules` entry; a
  failure leaves branches and PRs untouched. Rules are keyed by repository + exact branch name.
- Issues (REQ-5, stored in `organizations.json`): list, detail, comments and every view read the same
  record; the status/keyword filters stay in the browser (`?state=`/`?q=`). Create/edit/comment need
  `writeAllowed`; assign/label/milestone and status need `triageAllowed`. `PATCH .../issues/:number`
  writes only the field the body carries and each route pairs the target with its timeline event in one
  `store.update`.
- Reactions (REQ-5-5, `issueReactions` in `organizations.json`, `components/IssueReactions.tsx`): one
  record per issue + type + account (no counter), so `getIssue(repositoryId, number, viewerAccountId)`
  derives `reactions` (`{type,count,viewerReacted}`, `ISSUE_REACTION_TYPES` order, positive counts only)
  and `canReact` (any signed-in reader); `POST`/`DELETE .../issues/:number/reactions[/:type]` store or
  drop only the session account's record (401 without a session, 400 unknown type) and write no timeline
  event, so content, discussion and metadata stay unchanged; a visitor sees the counts without a control.
- Releases (REQ-4-5, stored in `organizations.json` as `releases`): keyed by repository + exact tag
  (unique inside that repository only), pointing at one existing branch. Reads follow the shared read
  rule; publishing needs `writeAllowed` (else `401`/`403`). A reused tag answers
  `400 {fieldErrors.tag:"Tag already exists"}` and writes nothing; `.../releases`, `.../releases/:tag`
  and the literal `new` are the routes.
- `BranchSelector` (repository overview and Code page): the unique button `Branch <current branch name>`
  opens a textbox `Find branch` plus `role=option` buttons with the exact branch names, filtered while
  typing; a writer also gets `Create branch: <name>`, otherwise the panel shows `No matching branch` /
  `Invalid branch`. Selecting a branch writes `?branch=<name>` into the hash (the default branch stays
  implicit) and every code view reads that snapshot back, so a reload restores the same branch; an
  unmatched query leaves the address and the active branch untouched. `Add file` (Menu → `Create new
  file`), only with `canWrite`, opens `RepositoryNewFilePage`; every writer path re-checks the rule.
- Creation (`canCreateRepository`): accounts create only in their personal namespace, organizations only
  as `Owner`; names are unique per (ownerType, ownerId, name). Forking re-checks the source read rule and
  the target creation rule and deep-copies the default-branch commits (a private source forks privately).
  `Admin` is per-operation, never a cumulative ladder.
- `removeOrganizationMember` is atomic (membership + team memberships + direct grants; team grants stay)
  and keeps at least one Owner (`last-owner`). Identity keys are owner + parent + name; URLs use the
  owner's URL identifier and headings the display name; team hierarchy is display only (a cyclic parent
  is rejected); passwords are scrypt hash+salt and never returned.
- Seed upgrade: both stores merge their predefined records by stable identity on every start
  (`auth.json` `upgradeState`, `organizations.json` `upgradeSeedState`, gated by `SEED_GENERATION`), so an
  older file receives the current seeds while stored records and user changes stay, a removed record is
  never resurrected, and `readState` awaits the upgrade so no read observes a half-upgraded file.
- Audit log (REQ-2-4): `auditEvents` stores actor/action/target/createdAt, written by
  `appendAuditEvent` inside the same `store.update` as the action it records (a rejected operation
  writes nothing) with the actor taken from the session, never the body. `GET .../audit-log` answers
  401/403 to a non-Owner, the entry link only renders for `viewerRole === "Owner"` and the selected
  filter travels in the hash.
- Hash routing is the router (`lib/hash-route.ts` bridges clicks synchronously); every view renders one
  `<main>` with `AppHeader`. The clone-menu `Code` button stays distinct from the `Code` link; the
  history link is named `Commits` with its count beside it. Unknown `/api/*` or static paths and non-GET
  statics return 404 JSON.

## 必要准备

- Data dir: `SHALLOW_DATA_DIR` (controller temp dir), local `backend/.data`, git-ignored; both stores
  merge their predefined records on every start, so an existing file still receives the current seeds
  while stored records and user changes stay.
- Seeded passwords are `Valid-password-123!` unless stated; the evolution accounts below use
  `Evo-Password-987!`.
- REQ-2 seeds: organization `acme-demo` (`Acme Demo`) with the
  `platform-team`/`frontend-team`/`frontend-child`/`access-role-team` teams and their members, plus
  `acme-docs` (public) and `secret-research`/`visibility-demo` (private) with their grants. `acme-docs`
  history: `Initial commit` (`org-owner`) then `Document search flow` (`alice-dev`) changing
  `src/search.ts`; only `src/README.md` carries the phrase, so code search stays unambiguous.
- REQ-6 seeds (`org-seeds.mjs`): the whole branch set, PRs #1-#13 and the `pr-*`/`bob-reviewer` grants;
  `acme-docs` `main` holds one protection rule (approval + `test`), while `branch-protection-demo`
  (PR #1 `test` pending, Admin `protection-admin`, no viewer grant) starts rule-free because its
  scenario creates its own. REQ-4-3/4-4 seeds (public, `acme-demo`): `branch-switch-demo`,
  `default-branch-demo` and `file-management-demo` with their Write/Admin grants. REQ-5 seeds
  (`acme-docs`): issues #1-#11, labels `bug`/`documentation`, milestone `v1.0`,
  `issue-author`/`issue-commenter` Write, `issue-editor` Maintain, `issue-viewer` Read.
- REQ-1-1/1-4 and REQ-2-1-2/2-4 evolution seeds (mirrored by `src/test/fake-api.ts` /
  `fake-org-seed.ts`): `evo-register-existing`, `evo-login-case`, the session owners
  `evo-session-owner`/`-s2`/`-s3`, `evo-org-owner`, `evo-audit-owner`/`evo-audit-viewer` of
  `evo-audit-org` (private `audit-demo`, `audit-team`, four audit events) and `evo-lab-02` (`Evo Lab
  Two`). Browser sessions are never pre-provisioned: each sign-in creates its own record.
- REQ-3-1/REQ-3-5 evolution seeds: `evo-search-owner` owns the public `evo-search-catalog-s1` and
  `evo-search-notebook-s2` (its description holds `evolution-notebook`); `evo-archive-admin` owns the
  public `evo-archive-repository-s1` (active) plus `-s2` and `-s3` (both stored `archived: true`, each
  with a `README.md`); `evo-archive-viewer` holds no grant. All five are personal, so the visitor
  organization discovery and the organization repository lists are unchanged.
- Other repositories stay private on purpose: `repo-owner/acme-docs` and `fork-user/acme-docs-fork`, so
  a visitor search for `acme-docs` keeps exactly one match. Every repository has a `main` branch (or its
  `defaultBranch`) and an initialized new repository adds one `Initial commit`. Entry points: home
  `Public organizations`/`Repositories`, or `Account menu` → `Your organizations`/workspace
  (`Settings`, `Sign out`).
- REQ-4-3-1 / REQ-4-5 evolution seeds (personal, public): `evo-branch-switch-owner` owns
  `evo-branch-switch-s1/s2/s3` (active `evo-main-s<n>` + target `evo-feature-s<n>`; `-s1`/`-s3` carry
  `evo-target-s<n>.md` only on the target branch). `evo-release-owner` (password `Evo-Password-987!`)
  owns `evo-release-repository-s1/s2/s3` (branches `evo-main-s<n>`); `-s2`/`-s3` store the published
  `evo-v0-1-s2`/`evo-v0-1-s3` releases. Personal namespaces leave org discovery and repo lists unchanged.
- REQ-5-5 evolution seeds (personal, public, `Evo-Password-987!`): `evo-reaction-author` owns the only
  reaction repository `evo-reaction-repository-s1` (issues #1-#3 = `Evo reaction issue s1/s2/s3`, its
  entry point; `-s1`/`-s2` start reaction-free, `-s3` holds one `+1` reaction of that account);
  `evo-reaction-user` is the second reacting account.
