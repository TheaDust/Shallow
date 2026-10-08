# ARCHITECTURE

React 18 + Vite + TypeScript frontend with hash routing and a zero-dependency Node HTTP backend that
serves a same-origin `/api` JSON API plus the built frontend. Implemented: identity/session (REQ-1),
organizations/teams/repository access, creation, forking and visibility (REQ-2, REQ-3), repository
discovery/search (REQ-3-1), archive and restore (REQ-3-5), code browsing, history, diffs, search,
branches and the web editor (REQ-4), repository releases (REQ-4-5), issues with discussion, editing,
metadata, status and reactions (REQ-5), pull requests with review, merge and branch protection (REQ-6),
and active browser session management (REQ-1-4).

## 修改入口

- `backend/src/app.mjs` — `createRequestHandler`: API routing, cookies, static serving, 404 fallback,
  `/api/account/sessions`. `backend/src/server.mjs` — `PORT` (default 3000), extra ports from
  `platform-ports.json` unless `ARC_EXTRA_PORTS=0`, `SHALLOW_DATA_DIR`, one `createServer` per port.
- `backend/src/lib/auth-rules.mjs`, `auth-store.mjs` — exact messages, `SEED_ACCOUNTS`, scrypt
  credentials, sessions, `seedAccountId`, `mergeSeedAccounts` (idempotent account upgrade),
  `describeDevice`, `listSessions`/`revokeSession`; a failed sign-in answers
  `401 {message:"Invalid credentials"}` without a cookie.
- `backend/src/lib/org-rules.mjs` — `ORG_MESSAGES` (incl. `repositoryArchived`, `archiveInvalid`),
  `BRANCH_MESSAGES`/`FILE_MESSAGES`/`ISSUE_MESSAGES`/`PULL_MESSAGES`, the role lists (`WRITE_ROLES`,
  `TRIAGE_ROLES`, `ACCESS_ROLES`) and the name/role/branch validators.
- `backend/src/lib/org-seeds.mjs` — `createSeedState()`, `ORG_SEED_VERSION`, `organizationSeedUpgrade`
  (missing-by-id completion of an older `organizations.json`) and the `evolution*Specs` functions shared by
  the empty-directory seed and the upgrade; it defines every predefined organization, repository, branch,
  commit, grant, release, label, milestone and issue.
- `backend/src/lib/org-store.mjs` — `createJsonStore` state plus the pure rules
  `readAllowed`/`writeAllowed`/`triageAllowed`/`manageAllowed`/`maintainAllowed` with their
  `canXRepository` wrappers, creation/fork/visibility, branch and file commits, code-view readers,
  `listReadableRepositories`, `listRepositoryMemberAccountIds` and branch protection; it spreads
  `createIssueStore`, `createPullRequestStore` and `createReleaseStore` so every record shares one writer.
- `backend/src/lib/org-routes.mjs` — the `/api/organizations*` and `/api/repositories*` surface:
  `GET /api/repositories?q=`, `PATCH .../visibility|archive`, the access grants, the archived-write guard
  and the delegation to the code/write/release/issue/pull routes.
- `backend/src/lib/repository-code-store.mjs` (pure branch readers), `text-diff.mjs`
  (`diffFileSnapshots`), `repository-code-routes.mjs` (per-repository GET code views incl. `branches`),
  `repository-write-routes.mjs` (`POST branches`/`files`, `PATCH default-branch`, `branch-protections`),
  `release-store.mjs` + `release-routes.mjs` (`.../releases`: readable list, one detail by tag, `POST`
  publishes; `RELEASE_MESSAGES` holds the exact `Tag already exists` message and
  `createRepositoryRelease` re-checks the tag inside one `store.update`).
- `backend/src/lib/issue-store.mjs` + `issue-routes.mjs` + `issue-rules.mjs` — the `.../issues` surface
  (list, detail, `PATCH :number|:number/status`, `comments`, `assignees`, `labels`, `milestone`,
  `reactions`); `pull-request-*.mjs` — the `.../pulls` surface (list, `pulls/compare`, create, detail,
  `PATCH :number/status|checks`, `POST :number/comments|reviews|merge`, `POST`/`DELETE :number/reviewers`).
- `frontend/src/lib/` — `routes.ts` (`parseRoute`, hash builders, `routeRepository`), `hash-route.ts`
  (`navigate`/`replace` synchronous bridges), `use-branch-address.ts` (`useBranchInAddress`: writes the
  resolved branch of a repository view into the address), `auth-api.ts`/`org-api.ts` (typed same-origin
  calls: `searchRepositories`, `saveRepositoryArchive`, `saveRepositoryVisibility`, the release calls,
  `addRepositoryIssueReaction`/`removeRepositoryIssueReaction`).
- `frontend/src/components/` + `pages/` — one file per view. REQ-3: `SearchResultsPage`,
  `RepositoryPage` (overview incl. the `Archived` marker, the disabled `Add file` and the `Releases`
  tab), `RepositoryGeneralSettings` (visibility **and** the archive/restore dialog),
  `components/ArchivedAction.tsx` (`ArchivedActionLink`, the non-actionable `New issue`/
  `New pull request` entries). REQ-4: `RepositoryCodePage`/`File`/`NewFile`/`Commits`/`CommitPage`,
  `BranchSelector`, `AddFileMenu`, `CloneMenu`. REQ-4-5: `RepositoryReleasesPage`,
  `RepositoryNewReleasePage`, `RepositoryReleasePage`. REQ-5: `RepositoryIssuesPage`,
  `RepositoryIssuePage` (incl. the `Add reaction` menu and the `Remove <type> reaction` button),
  `RepositoryNewIssuePage`. REQ-6: `RepositoryPullRequestsPage`,
  `RepositoryNewPullRequestPage`, `RepositoryPullRequestPage` and `components/PullRequestReview.tsx`,
  `PullRequestReviewers.tsx`, `PullRequestMerge.tsx`, `RepositoryBranchProtection.tsx`. REQ-1/2:
  `SessionsPage`, `SettingsPage`, `WorkspacePage`, `OrganizationPage`, `OrganizationAuditLogPage`,
  `OrganizationPeople`/`Teams`/`Repositories`.
- Tests: `frontend/src/pages/*.test.tsx` and `backend/test/*.test.mjs`; the fakes under
  `frontend/src/test/` (`fake-api.ts`, `fake-org-api.ts`, `fake-code-api.ts`, `fake-org-seed.ts`) mirror
  the seeded records, grants and the archived rule and must stay in sync with them.

## 关键约束

- Trusted boundary: every route module re-validates its rules; the UI only mirrors `fieldErrors` and
  its own `can*` flags. Requests are same-origin `fetch` with cookies; the session is an HttpOnly
  `shallow_session` cookie holding a server-side id (`getSessionAccount` is the only reader). Usernames
  match exactly, emails fold case.
- Read rule (`readAllowed`) — repository search, organization/workspace lists, repository detail, every
  code view and issue view: public is readable by anyone, private only by an organization Owner, a
  direct account grant or a granted-team member; membership alone grants nothing.
- Repository search (REQ-3-1): `GET /api/repositories?q=` filters the caller's readable set by a
  case-insensitive substring of the repository **name or persisted description**; the query travels in
  the hash (`#/search?q=`) and each row shows `owner/name`.
- Archived rule (REQ-3-5): `archived` is stored per repository and reported by `publicRepository`, so the
  overview badge, the settings flow and every list agree. An Archived repository stays readable, but
  `org-routes.mjs` refuses every non-GET repository sub-resource with `403 Repository is archived` except
  the administrator settings (`archive`/`visibility`/`access`); `manageAllowed` is deliberately
  unaffected so an Admin can restore, and the three named write entries render non-actionable while
  `canWrite` still reports the grant.
- Branches are the unit of reading: `defaultBranch` applies when none is named, every code-view response
  carries the resolved `branch` plus `defaultBranch`, and the branch travels in the hash (`?branch=...`).
  A branch is only a named reference to a commit head; commits are append-only (`parentCommitId`) and code
  search matches content lines only.
- Write rule (`writeAllowed`) is separate from read and manage: organization Owner, repository owner and
  a direct/team `Write`/`Maintain`/`Admin` grant may create branches and commits; `Read`/`Triage` only
  read (`403` from `POST .../branches`/`.../files`; `GET .../branches` stays open with `canWrite`). A new
  branch copies nothing (`Invalid branch`/`Branch name already exists`); `PATCH .../default-branch` needs
  `manageAllowed`; `POST .../files` appends one commit and moves the head in one `store.update`.
- `Admin`/`Triage`/`Maintain` are per-operation, never a cumulative ladder: `manageAllowed` only for
  Admin grants or an organization Owner, `triageAllowed` (issue metadata) for Triage/Maintain/Admin and
  `maintainAllowed` (review, merge, reviewers) for Maintain/Admin. `PATCH .../visibility` and
  `PATCH .../archive` need `manageAllowed` and write only their own field plus `updatedAt`.
- Pull requests (REQ-6): a PR = repository + repository-scoped number; status is only
  Draft/Open/Closed/Merged (Merged terminal), and the compare commit is derived from the source branch
  head. Creating needs `writeAllowed`, transitions also accept the author, `PATCH .../checks` needs
  `manageAllowed`. A line comment or review decision needs a signed-in non-author with `writeAllowed` on
  an Open PR (`canReview`); a review is fixed to the compare commit and turns `stale` when the branch
  moves. `.../reviewers` needs the author or `canMaintain`. Merge needs `canMaintain` and re-reads
  `mergeStateOf`: every enabled protection rule of the target branch is enforced independently (one
  non-stale non-author approval, `test` success) plus no conflict and no valid `Request changes`.
- Issues (repository + number): list/detail/creation/comments and every view read the same record;
  status/keyword filters stay in the browser (`?state=`/`?q=`). Create/edit/comment need `writeAllowed`,
  assign/label/milestone/status need `triageAllowed` (`canTriage` hides the control); each
  metadata/status route pairs its target with one timeline event in a single `store.update`.
- Reactions (REQ-5-5): one record per issue + account + type in `issueReactions` (never a field of the
  issue), so reacting needs only a signed-in viewer of a readable issue — `canReact` is `Boolean(user)`,
  the payload carries `reactions: [{type,count,reacted}]`, `POST .../issues/:number/reactions` is
  idempotent per account and `DELETE .../reactions/:type` removes only the caller's own reaction. Neither
  writes the issue, its discussion, its metadata or its timeline; an invalid type answers `400`.
- `BranchSelector` (overview and Code page): the unique button `Branch <current branch name>` opens a
  textbox `Find branch` plus `role=option` buttons with the exact names; a writer also gets
  `Create branch: <name>`, otherwise `No matching branch`/`Invalid branch`, and Escape closes it.
  `Add file` (Menu → `Create new file`, `canWrite` only) opens `RepositoryNewFilePage`; both entries are
  non-actionable on an Archived repository. The repository page and the Code page call
  `useBranchInAddress`, which writes `?branch=<resolved>` with `replace` **only while the address names
  no branch** — a selected branch or an unmatched query is therefore never overwritten — so selector,
  address and file list agree before and after a reload.
- Releases (REQ-4-5): a release = repository + tag (unique per repository), storing title, description and
  existing target branch in `organizations.json`. `GET .../releases` and `GET .../releases/:tag` need only
  the repository read rule (a visitor reads a published release); `POST .../releases` needs `writeAllowed`
  and answers `400 {fieldErrors.tagName:"Tag already exists"}` without writing when the tag is used, so
  publishing can never duplicate a release.
- The header `role="search"` searchbox named "Search" is the only search control: on routes
  `routeRepository` resolves, Enter opens `#/repositories/:owner/:name/search?q=...`, elsewhere it
  searches repositories. The query lives in the hash, so results and the value survive reload.
- Creation (`canCreateRepository`): accounts create only in their personal namespace, organizations only
  as `Owner`, names unique per (ownerType, ownerId, name); forking re-checks both sides and deep-copies
  the default-branch commits. Identity keys are owner + parent + name; URLs use the owner's URL
  identifier, headings the display name. Organization audit events are written in the same `store.update`
  as the action they describe and `GET /api/organizations/:id/audit-log` re-checks `Owner`.
  `removeOrganizationMember` is atomic (membership + team memberships + direct grants) and keeps at least
  one Owner (`last-owner`).
- Sessions (REQ-1-4): `{id,accountId,active,deviceLabel,createdAt,lastActiveAt}` in `auth.json`;
  `GET /api/account/sessions` lists the account's active sessions (current first),
  `POST .../sessions/:id/revoke` revokes another one, and a revoked session lands on the public home with
  its `Sign in` link.
- `App.tsx` renders the global `AppHeader` once as a top-level `<header>` (banner) that is a sibling of
  the single per-view `<main>` — pages must not re-render it, and an `<header>` nested in `<main>` would
  lose the banner role, so `AppHeader` and `ui/Dialog.tsx` use a plain `<div>` for inner headers.
  Dialog mounts its `<dialog>` only while `open`: closing closes the native element and then removes
  description/actions/children, so nothing lingers and focus returns to the pre-open element. Hash
  routing is the router; unknown `/api/*` or static paths and non-GET statics return 404 JSON.

## 必要准备

- Data dir: `SHALLOW_DATA_DIR` (controller temp dir), local `backend/.data`, git-ignored. An empty dir
  gets the full seed; an existing `auth.json`/`organizations.json` is completed in place by
  `mergeSeedAccounts` and `organizationSeedUpgrade` (`ORG_SEED_VERSION` 5, adding missing records by
  stable id, incl. the REQ-5-5 reaction repository, its issues and the seeded reaction), so user
  changes are kept and a restart is idempotent — records are only ever added.
- Accounts share `Valid-password-123!` unless they carry their own `password`; the `evo-*` evolution
  accounts use `Evo-Password-987!` (incl. `evo-release-owner` and the REQ-5-5 pair
  `evo-reaction-author`/`evo-reaction-user`).
- All predefined organizations, repositories, branches, commits, grants, releases, labels, milestones and
  issues live in `org-seeds.mjs` (`createSeedState`, `evolution*Specs`) and are mirrored by
  `frontend/src/test/fake-org-seed.ts` + `fake-org-api.ts`.
- Read-only seeds: `acme-docs` (`src/README.md` = `search flow`; issue #1-#11, labels
  `bug`/`documentation`, milestone `v1.0`; PRs #1-#13; one `main` protection rule),
  `branch-switch-demo`/`default-branch-demo`/`file-management-demo`, `branch-protection-demo`, the two
  REQ-3-1 search repositories and the three REQ-3-5 archive repositories of `evo-archive-org` (the
  archived `-s2` keeps a direct `Write`, so the archive rule, not a missing grant, disables its writes).
- REQ-4-3-1: `evo-branch-switch-s1`/`-s2`/`-s3` (public, `acme-demo`) default to `evo-main-s1`…`-s3`
  beside `evo-feature-s1`/`-s2`/`-s3`; only the `-s1`/`-s3` target branch carries
  `evo-target-s1.md`/`evo-target-s3.md`. REQ-4-5: `evo-release-repository-s1`/`-s2`/`-s3` (public,
  `acme-demo`) on the same branch names, `-s2` with the published `evo-v0-1-s2`, `-s3` with the used tag
  `evo-v0-1-s3`; `evo-release-owner` holds the direct `Write` grant on `-s1` and `-s3`.
- REQ-5-5: one public repository `evo-reaction-repository-s1` (`acme-demo`) holds the three scenario
  issues `Evo reaction issue s1` (number 1), `s2` (2) and `s3` (3); `s3` starts with one `+1` of
  `alice-dev`, `s1`/`s2` start without any reaction. No grant is needed — the repository is public.
- Entry points: home `Public organizations`/`Repositories`, or `Account menu` → `Your organizations`/
  workspace (`Settings`, `Sign out`).
