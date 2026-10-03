# ARCHITECTURE

Simplified GitHub collaboration platform: `frontend/` React + Vite + TypeScript (hash routing),
`backend/` zero-dependency Node HTTP serving `frontend/dist` and the `/api` JSON API. Accounts, sessions,
organizations, teams, repositories (branches/commits/files) and access grants persist in one JSON document
under `SHALLOW_DATA_DIR` (`<dir>/state.json`, atomic writes in `backend/src/lib/json-store.mjs`).

## 修改入口

- `backend/src/app.mjs` — `createApp({dataDir})` → `{handle, store}`: API route table
  (`GET|POST /api/repositories` and `/api/repositories/:owner/:repo[/visibility|/access|/fork|/branches|
  /default-branch|/files|/tree[/:branch[/…path]]|/blob/:branch/*path|/commits[/:branch[/…path]]|/commit/:id|
  /search?q=]`), session cookie and static serving; code views resolve the viewer via `readableRepository`.
- `backend/src/lib/repositories.mjs` — repository domain: access (`repositoryAccessRole`, `canReadRepository`,
  `canWriteRepository`, `isRepositoryAdmin`), queries (`searchRepositories`, `listRepositories`,
  `repositoriesForAccount`), store-locked mutations (`createRepository`, `forkRepository`,
  `setRepositoryVisibility`, `grantRepositoryAccess`, `createRepositoryBranch`, `setRepositoryDefaultBranch`,
  `createRepositoryFile`), assets (`repositoryFile`, `readmePathOf`, `listRepositoryBranches`, `filePathError`)
  and code browsing (`repositoryTree`, `branchCommits`, `commitDetail`, `searchRepositoryFiles`,
  `resolveRepositoryBranch`, `fileContentAt`). `repository-ownership.mjs` resolves `ownerType`/`ownerId` →
  `{type, login, displayName}`.
- `backend/src/lib/organizations.mjs` — organizations, memberships, teams; `accounts.mjs` sessions;
  `validation.mjs` `MESSAGES` plus name/role rules (`isValidBranchName`, `commitMessageError`,
  `WRITE_REPOSITORY_ROLES`); `seeds.mjs` seeds and `ensureSeeded`; `server.mjs` listens on `PORT` (default
  3000) plus `platform-ports.json` unless `ARC_EXTRA_PORTS=0`. `frontend/vitest.config.ts` pins `minWorkers: 1`.
- `frontend/src/App.tsx` + `lib/routes.ts` — hash routes: `/repositories/:owner/:repo` (Code page),
  `/tree/:branch[/…path]`, `/blob/:branch/*path`, `/new/:branch` (file editor), `/commits/…`, `/commit/:id`,
  `/search?q=`, `/settings[/branches|/access]`; `lib/repository-paths.ts` builds every repository link.
- `frontend/src/api/organizations.ts` — repository/org payload types and fetchers (tree, file, commits, commit,
  code search, branches, `setRepositoryDefaultBranch`, `createRepositoryFile`) plus `canWriteRepositoryRole`.
- `frontend/src/pages/organization/RepositoryPage.tsx` and `pages/repository/*` — Code page (REQ-3-3 overview,
  `RepositoryNav`, `RepositorySearchBox`, `BranchSelector`, `AddFileMenu`, `CodeEntryList`) plus the tree, file,
  new-file, commits, commit, code-search, settings, branches-settings and fork pages; shared
  `CodeBreadcrumb.tsx`, `CodeEntryList.tsx`, `RepositorySettingsNav.tsx`, `lib/branch-names.ts`.
- `frontend/src/test/` — Vitest flows; `fake-api.ts`/`fake-seed.ts` mirror the API and seeds (branch data
  included), so a seed or API change must be applied to both.

## 关键约束

- Session authority is the server (HttpOnly cookie; identity from `GET /api/session`). Repository ownership is
  `ownerType` (`account`|`organization`) + `ownerId`; `repositoryOwnerRef` derives `login` (URL identifier)
  and `displayName` (link/heading text); a login resolves to the account namespace first, then an org `slug`.
- Access is computed only by `repositoryAccessRole`/`canReadRepository` (personal owner, organization Owner, a
  direct account grant, or a team grant through team membership; public reads for everyone). Lists, search,
  direct links and every code view reuse that one rule, so a private repository never leaks.
- Branches are named references: `state.branches[] = {repositoryId, name, headCommitId}`; the snapshot of a
  branch is the stored `state.files` rows of that branch name and its history is the commit chain reachable from
  `headCommitId` (`branchCommits`, `branchCommitCount`). `createRepositoryBranch` writes only the new record
  (pointing at the base head) plus a materialized copy of the base revision's files, so no commit is copied and
  the base history is never rewritten. `repository.defaultBranch` is a pointer used when a view omits the
  branch; `setRepositoryDefaultBranch` changes that field only, so the previous branch, its commits and its
  files stay stored and switchable. Branch names: 1–255 characters of `A-Za-z0-9.-_/`, no trailing `/` or `.`,
  no `..`/`//` (`isValidBranchName`).
- Writes (branch creation, file commits) need Write/Maintain/Admin — an organization Owner resolves to `admin`;
  `canWriteRepository` runs inside the store-locked mutation, so a hidden control is never the authority.
  `createRepositoryFile` writes one commit (`parentCommitId` = branch head) carrying `changes=[{path,content}]`,
  then advances `headCommitId` and stores the file row; a rejected path or message writes nothing
  (`filePathError`, `commitMessageError`; messages `Invalid file path`, `Commit message is required`).
- A commit owns its changes (`changes=[{path, content|null}]`) and the branch snapshot is replayed from that
  chain (`seeds.mjs`, `initializeRepository`), so tree, content, history and diff describe one revision. A
  directory is only a prefix of stored paths (`repositoryTree`); a named branch without a record is 404 while an
  omitted branch reads the default. Commit numbers are derived in `commitDetail` (LCS diff against the parent).
- Repository creation is decided inside the store-locked mutation (own personal namespace, or an organization
  namespace only for its Owner, else 403 `ownerForbidden`); name rules run required → duplicate → format.
- The branch selector is a button named `Branch <current branch>` opening a `Find branch` textbox and
  `role=option` branch names; selecting navigates to `/tree/<branch>`, so the selected branch survives a reload
  and the file list follows the URL (REQ-4-3-1/2). A file page’s `Commits` link carries its own path
  (`RepositoryNav path`), so a created file’s history shows the submitted message (REQ-4-4).
- The repository Search box replaces the global header search on repository code pages
  (`SiteHeader showGlobalSearch={false}`) so names stay unique per page; the results page keeps its query in the
  URL (`…/search?q=`).
- The Code page keeps the REQ-3-3 text unique: a `Code` *link* (nav, `aria-current="page"`) next to a distinct
  `Code` *button* (clone popover, one `Copy` per HTTPS/SSH tab, `Copied` status) and `Fork`.
- Member/team changes need an organization Owner and grants/visibility the repository Admin, all checked inside
  the store-locked mutation (never from the body); access rows are upserted by subject.
- `useAsyncData` keeps the last successful value, so a detail view must not render it while `error` is set.
  Static serving has no SPA catch-all (`/` = index.html, unknown paths/APIs = 404 JSON).

## 必要准备

- `ensureSeeded` writes the verified accounts (password `Valid-password-123!`) and the whole seed on empty
  storage only; read `seeds.mjs` for the exact lists. `acme-demo` owns the public `acme-docs` (branch `main`,
  two `alice-dev` commits, head `src/README.md` = “Document search flow”), the private `secret-research`
  (ungranted) and `visibility-demo` (granted), plus the REQ-4-3/4 demos `branch-switch-demo` (`main` +
  `feature-search` with `main-only.md`; `branch-contributor` Write), `default-branch-demo` (`main` +
  `release`; `default-branch-admin` Admin, `default-branch-viewer` no grant) and `file-management-demo`
  (`file-contributor` Write). A seed may list `branches` (a branch with `base` continues that branch’s head).
- `SEED_PERSONAL_REPOSITORIES` seeds the private `repo-owner/acme-docs` and `fork-user/acme-docs-fork` (visitor
  lists unchanged; on `fork-user`’s lists the name `acme-docs` also matches `acme-docs-fork`).
- Scenario-only objects use normal product paths: an ungranted private repository opened by URL answers
  “Access denied”; `repo-admin` (no membership) reaches `acme-docs` through “Your organizations”; password
  recovery uses the fixed code `123456`. Explore and workspace lists are seed-sized, so a test asserting them
  names the current public set (`backend/test/organizations|repository-access|repository-search`).
