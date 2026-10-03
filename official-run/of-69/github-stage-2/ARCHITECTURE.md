# ARCHITECTURE

Simplified GitHub collaboration platform. REQ-1 covers identity (registration,
sign-in, recovery, sign-out); REQ-2 adds organizations, teams, membership and
organization repository browsing; REQ-3 covers discovery, repository creation,
forking, the clone surface and visibility; REQ-4-1/REQ-4-2 add the repository
Code page, commit history, commit diff and repository code search; REQ-4-3 adds
branch listing, branch creation and the default-branch setting; REQ-4-4 adds the
web file editor behind “Add file” → “Create new file”.

## Modification entry points

- `backend/src/server.mjs` — binds `PORT` (plus the `platform-ports.json` ports
  unless `ARC_EXTRA_PORTS=0`) and mounts one handler per port; `SHALLOW_DATA_DIR`
  supplies the data directory.
- `backend/src/app.mjs` — `createRequestHandler({ dataDir, staticRoot })` owns the
  identity API, `/health`, `/api/health` and delegates the rest (passing the
  query `searchParams`); unknown `/api/*` and files answer 404.
- `backend/src/routes/repositories.mjs` — `createRepositoryApi(database)`:
  `GET /api/repositories`, `GET /api/search/repositories?q=`,
  `GET /api/repositories/:owner/:repo[?branch=]`, `POST /api/repositories` and
  `POST …/fork`, plus the read-only code views `…/commits[?branch=&path=]`,
  `…/commit/:commitId` and `…/code-search?q=[&branch=&path=]`. The REQ-4-3/4-4
  write verbs live here too: `POST …/branches`, `POST …/files` and
  `PUT …/default-branch`; `writableRepository` decides the role they need.
- `backend/src/lib/repository-code.mjs` — branch/file/commit/diff/search helpers:
  `branchNames`, `resolveBranchName`, `branchFileList`, `computeLineDiff`,
  `commitHistory`, `commitDetail`, `filesInDirectory`, `searchCode`, plus
  `isValidNewFilePath`, `branchHeadCommit`, `createBranchReference` and
  `addFileCommit` for the write verbs.
- `backend/src/routes/organizations.mjs` — `createOrganizationApi(database)`: the
  organization, repository-access, member and team routes plus the
  organization-scoped repository detail (same branch/file fields).
- `backend/src/lib/organizations.mjs` — shared queries: `listReadableRepositories`,
  `searchReadableRepositories`, `repositoryResult`, `repositorySummary`,
  `repositoryOwnerRef`, `repositoryRoleFromState`, `canReadRepository`,
  `readmeFile`, `repositoryCommits`, `repositoryFiles`,
  `findRepositoryByOwnerName`. `organization-rules.mjs` holds the message maps
  (`*_MESSAGES`, `BRANCH_MESSAGES`, `FILE_MESSAGES`), the repository-role rules
  (`canWriteRepository`), `validateRepositoryName` and `validateBranchName`;
  `seed.mjs` holds every pre-provisioned account, organization, repository and
  branch history.
- `frontend/src/App.tsx` + `src/lib/routes.ts` — hash route table, dispatch and
  protected-view list (`#/search` is public); `routes.ts` also exposes
  `organizationUrl`, `repositoryPath`/`repositoryUrl`, the code-view URL builders
  (`repositoryCodePath/Url`, `repositoryCommitsPath/Url`, `repositoryCommitPath/Url`,
  `repositoryCodeSearchPath/Url`, `repositoryNewFileUrl`,
  `repositoryBranchesSettingsUrl`) and `repositoryContextForPath`.
- `frontend/src/components/RepositoryOverviewView.tsx` — the page frame shared by
  organization and personal repositories; `RepositoryOverviewBody.tsx` is its body
  and `RepositoryCodeBrowser.tsx` the branch selector, the entry list and the file
  view. `RepositoryLayout.tsx` takes an `owner` prop, builds every link through
  `repositoryUrl` and exposes the Code/Commits nav entries.
- `frontend/src/lib/repository-code.ts` — `buildCodeModel` (branch, directory
  entries, opened file and their URLs) and `directoryEntries`;
  `repository-overview.ts` normalizes a detail payload for the body;
  `organization-api.ts` is the typed same-origin client (including
  `fetchRepositoryCommits`, `fetchCommitDetail`, `searchRepositoryCode`);
  `relative-time.ts` formats “<count> <unit> ago”.
- `frontend/src/pages/RepositoryCommitsPage.tsx`, `RepositoryCommitPage.tsx` and
  `RepositorySearchPage.tsx` are the history, diff and code-search views;
  `components/GlobalSearch.tsx` is the top Search box (repository-scoped inside a
  repository). The creation/overview/settings entry points are
  `pages/NewRepositoryPage.tsx`, `RepositoryOverviewPage.tsx`,
  `UserRepositoryOverviewPage.tsx`, `RepositorySettingsPage.tsx`,
  `RepositoryAccessPage.tsx`; `components/OrganizationLayout.tsx`/`TeamLayout.tsx`
  frame the organization pages.
- `frontend/src/pages/RepositoryNewFilePage.tsx` (route `…/new`) and
  `RepositoryBranchesSettingsPage.tsx` (route `…/settings/branches`) are the web
  file editor and the default-branch setting; `lib/write-rules.ts` holds
  `canWriteRepository`, `isValidBranchName`, `isValidNewFilePath`,
  `commitMessageError` and the exact “Invalid branch” / “Invalid file path” /
  “Commit message is required” strings those pages render.

## Key constraints

- One aggregate store `organizations.json` (`database.organizationState`) holds
  organizations, memberships, teams, team memberships, `repositoryGrants`,
  `repositories`, `branches`, `commits` and `files`. Repository records carry
  `ownerType`, `ownerId`, `ownerName`, `defaultBranch`, `creatorId`, `forkedFrom`;
  the owner is identified by type+id, never by a bare name. A commit carries
  `parentId` and `changes: [{ path, previous, content }]` (the file before and
  after that revision); additions/deletions are always computed from those two
  contents (`computeLineDiff`), never stored separately. Creation writes the
  repository, its branch, README and commit in one update; a fork copies the
  source default branch, its commits (with their `changes`) and files in one
  update, so a failure leaves nothing partial.
- Repository permission is `repositoryRoleFromState(state, repository, account)`:
  a personal repository's owner and an organization Owner of an organization
  repository are Admin, otherwise the account's direct grants plus its teams'
  grants decide the highest role (read<triage<write<maintain<admin). Read is
  `canReadRepository`: public is always readable, private only with such a role;
  plain organization membership grants nothing. Lists, detail, search, code views
  and access all use this rule (`403 Access denied`); `access`/`visibility` also
  need `admin`, and the code views expose `GET` routes only.
- Visibility and the fork rule live on the repository record: a private source can
  only be forked as private, a public one as either, and a fork is refused without
  Read on the source or creation permission in the target namespace. Creation
  validates owner permission first, then name and visibility, all as `{ errors }`.- A repository page has a nav link “Code” and a clone **button** “Code” that opens
  a popover with tabs “HTTPS”/“SSH”, each holding a read-only address behind a
  button named “Copy to clipboard” (answers `role="status"` “Copied”). The nav also
  contains the history link “Commits” (`…/commits`); Settings/Manage access appear
  for an organization repository Admin only.
- The Code page is the repository page itself; the address carries the view:
  `?branch=<name>` (only when not the default branch), `?path=<dir>` for the listed
  directory and `?file=<path>` for the opened file (`buildCodeModel`). Directory and
  file entries are links named exactly after the entry; the file view repeats the
  file name, path, branch and content in a `.repository-file__content` `<pre>`. The
  page renders each recorded value once: the commit list is not repeated inline
  next to the file (its messages would make the file content ambiguous), so the
  history stays behind the “Commits” link. The branch selector is a unique button
  named “Branch <current branch>” opening a popover with a textbox “Find branch”, a
  `role="option"` per branch (accessible name = branch name) and a “No matching
  branch” state; Escape closes it. Unknown `branch`/`file`/`path` values fall back
  to the default branch / plain listing and never create anything.
- The write verbs of REQ-4-3/4-4 are refused server-side unless the effective
  repository role is Write/Maintain/Admin (`canWriteRepository`), never from the
  page: `POST …/branches` creates a reference at the current head and copies that
  revision's history and files into the new branch (the base branch is untouched),
  `POST …/files` appends one commit plus its file record, and `PUT …/default-branch`
  (Admin only) rewrites only `defaultBranch`. Refusals answer `{ errors }` with the
  exact “Invalid branch” / “Invalid file path” / “Commit message is required”
  strings and leave the store untouched; the rules live in `validateBranchName`,
  `isValidNewFilePath` and `frontend/src/lib/write-rules.ts`.
- The commit history lists one branch newest first (message link, author, relative
  time); the commit page shows the message as its heading, the base revision, and a
  “Changed files” section with the per-file comparison plus the numeric totals
  (`3 files changed`, `5 additions`, `3 deletions`) and each file’s own `+n`/`-n`.
- Code search is scoped to the directory the query was submitted from
  (`filesInDirectory`: the repository root’s own files when no `path` is given) and
  matches case-insensitively inside readable file content only. The results page
  (standalone, no repository nav) offers the results views “Code” and
  “Repositories” and answers “No code results” for an unmatched query while the top
  Search box keeps the query.
- The top Search box is a native `type="search"` input named exactly “Search” on
  every page; submitting it on a repository path navigates to that repository’s
  code search (`…/search?q=…`), elsewhere to `#/search?q=…`. Seed values apply only
  when a store file is absent; user changes persist over restarts. Passwords are
  hashed and never returned; a failed sign-in answers "Invalid credentials". The
  header home entry is a link “Home” and the account entry has the buttons “Account
  menu” and the username, both opening one popup (`AccountMenu.tsx`).
- Organization navigation entries are links styled as a tab strip, never tabs or
  buttons. The organization heading shows display name plus identifier and the
  repository heading `display/repository` plus the identifier form. The repository
  filter is mirrored into the hash with `replaceHash`.
- On the Code page a writer also gets a button “Add file” opening a popover with a
  button “Create new file” (`RepositoryOverviewBody.tsx`), which opens `…/new` — the
  “File name”/“File contents”/“Commit message”/“Commit changes” editor. Settings
  carries the sub-nav links “General”/“Branches”; `…/settings/branches` holds the
  native “Default branch” select plus “Update” → dialog “Confirm” for an Admin, and
  no combobox, update button or “default branch” wording for anyone else.
- Protected routes (workspace, `repositories/new`, settings, `organizations`,
  `organizations/new`, team creation, `…/new`) redirect to home without a session;
  People, Teams and repository settings stay reachable and surface the server's
  `403`.

## Necessary preparation

- Seed accounts (password `Valid-password-123!`, in `backend/src/lib/seed.mjs`;
  an empty `SHALLOW_DATA_DIR` = fresh seed): the REQ-1 accounts, REQ-2
  `org-owner`/`team-maintainer` (Owners of `Acme Demo`), `bob-reviewer`,
  `existing-member`, `org-member`, `protected-member`, `new-member`, `repo-admin`,
  REQ-3-4 `visibility-admin`/`collaborator`, REQ-3-2 `repo-owner`/`fork-user` and
  the REQ-4 demo contributors `branch-contributor`, `file-contributor`,
  `default-branch-admin`, `default-branch-viewer`. `unknown-reviewer` has no
  account on purpose.
- Seed organizations (the migration entry point for new demo data): `Acme Demo`
  (`acme-demo`) with public `acme-docs`, private `secret-research` and private
  `visibility-demo`, teams `platform-team` > `frontend-team` > `frontend-child` and
  `access-role-team`, and grants `repo-admin` Admin and `access-role-team` one Write
  on `acme-docs`, `visibility-admin` Admin and `collaborator` Read on
  `visibility-demo`.
- The `acme-docs` default branch `main` holds `README.md`, `src/README.md`
  (content `Document search flow`) and `src/search.ts`, with the history “Initial
  commit”, “Document installation”, “Document search flow” (author `alice-dev`)
  that the diff page shows. The personal `repo-owner/acme-docs` (duplicate-name
  case, private) and `fork-user/acme-docs-fork` (fork of `Acme Demo/acme-docs`,
  private) cover the creation/fork conflicts; distinct owners may hold the same
  repository name. Recovery uses the fixed code `123456`
  (`backend/src/lib/recovery.mjs`).
- REQ-4-3/4-4 demo repositories live in the second public organization `Demo Labs`
  (`demo-labs`), leaving `Acme Demo`'s lists as they were: public
  `branch-switch-demo` (`main` + `feature-search`, `main-only.md` on the target
  branch only), public `default-branch-demo` (`main` + `release`) and public
  `file-management-demo`. Direct grants: `branch-contributor` and `file-contributor`
  Write, `default-branch-admin` Admin and `default-branch-viewer` Read on
  `default-branch-demo`. A `SEED_HISTORY` entry may list per-branch
  `commits`/`files` under `branches`; the older single-history shape still seeds
  the default branch.
