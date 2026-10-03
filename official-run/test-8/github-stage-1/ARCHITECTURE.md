# ARCHITECTURE

Simplified GitHub collaboration platform. `frontend/` is React + Vite + TypeScript (hash routing),
`backend/` is a zero-dependency Node HTTP server that serves `frontend/dist` and the `/api` JSON API.
Accounts, sessions, organizations, teams, repositories and access grants persist in one JSON document
under `SHALLOW_DATA_DIR` (`<dir>/state.json`, atomic writes in `backend/src/lib/json-store.mjs`).

## 修改入口

- `backend/src/app.mjs` — HTTP entry: `createApp({ dataDir })` returns `{ handle, store }`; owns the API
  route table, the `shallowcode_session` cookie and static serving. Tests drive it via a real server.
- `backend/src/lib/organizations.mjs` — organization domain: pure queries (`repositoryAccessRole`,
  `canReadRepository`, `repositoryAccessList`, `repositoryAccessCandidates`, `repositoriesForAccount`,
  `organizationPeople`, `teamDetail`, `organizationsForAccount`, `listRepositories`) plus store-locked
  mutations (`addOrganizationMember`, `removeOrganizationMember`, `grantRepositoryAccess`,
  `updateRepositoryGrant`, `createOrganization`, `createTeam`, `setTeamParent`, `addTeamMember`,
  `removeTeamMember`).
- `backend/src/lib/accounts.mjs` / `validation.mjs` — account/session domain; `validation.mjs` holds the
  `MESSAGES` texts, name/username rules and role vocabularies (`ORGANIZATION_ROLES`, `REPOSITORY_ROLES`,
  `roleLabel`). Keep new rejections there.
- `backend/src/lib/seeds.mjs` — `SEED_ACCOUNTS`/`SEED_ORGANIZATIONS` (members, teams, repositories with
  `grants`) and `ensureSeeded(store)`, called from `createApp`.
- `backend/src/server.mjs` — `PORT` (default 3000) plus `platform-ports.json` listeners, skipped only
  when `ARC_EXTRA_PORTS=0`.
- `frontend/src/App.tsx` + `frontend/src/lib/routes.ts` — hash route table + `matchRoute` (`RouteName` +
  params) covering nested org/team/repository paths.
- `frontend/src/api/organizations.ts` — typed org/repository/team client + payload types, the repository
  role vocabulary/labels (`REPOSITORY_ROLE_OPTIONS`, `repositoryRoleLabel`), `fetchYourRepositories`.
- `frontend/src/pages/organization/` — `OrganizationsPage` (“Your organizations”: the account’s
  organizations plus its readable repositories), `NewOrganizationPage`, `OrganizationPage`
  (+ `RepositoriesPanel`/`PeoplePanel`/`TeamsPanel`), `NewTeamPage`, `RepositoryPage`.
  `PeoplePanel` owns “Add member” and the “Member menu <username>” removal flow.
- `frontend/src/pages/repository/` — `RepositorySettingsPage` (“Settings”) and
  `RepositoryAccessPage`/`RepositoryAccessPanel` (“Manage access”: picker + access rows).
- `frontend/src/pages/team/` — `TeamPage` + `TeamMembersPanel`/`TeamSettingsPanel`.
- `frontend/src/components/SiteHeader.tsx` / `frontend/src/lib/useAsyncData.ts` — signed-in or public
  header (AccountMenu holds “Your organizations”) and the resource loader keeping the last value.
- `frontend/src/test/` — Vitest flows; `fake-api.ts` stubs the account, organization, member, access
  and `/api/repositories` API; `DEFAULT_ACCOUNTS`/`DEFAULT_ORGANIZATIONS` mirror the real seed (wiring
  only; real rules and persistence live in the backend suite).

## 关键约束

- Session authority is the server: the browser holds only an HttpOnly cookie; identity comes from
  `GET /api/session`. Sign-out and password reset flip `session.active`, so refresh/back is anonymous.
- Repository access is computed only by `repositoryAccessRole`/`canReadRepository` in
  `organizations.mjs`: organization Owner, a direct account grant, or membership of a team with a grant;
  public visibility reads for everyone. Membership alone grants nothing; every list/detail endpoint must
  use it so a private repository never leaks.
- Organization identity is split: `slug` (globally unique 1–39 lowercase identifier, used in URLs) vs
  `displayName` (human name shown on links). The overview renders the slug as `<h1>` and the display name
  as a second heading, so a heading named “Acme Demo” resolves while the slug stays visible;
  `RepositoryPage` renders `displayName/repositoryName` with the repository name in its own child
  element (accessible name unchanged). Creation is rejected when the submitted name equals any existing
  `slug` **or** `displayName`; that duplicate message beats format checks. Seed org `acme-demo`.
- `GET /api/repositories` returns `repositoriesForAccount`: every repository the account may read
  anywhere (public or granted). “Your organizations” lists them, so a repository Admin reaches a
  repository without an organization membership; ungranted private repositories stay hidden.
- The org “Repositories”/“People”/“Teams” and team “Members”/“Settings” entries are real `<a>` links
  (never `Tabs` buttons) even when styled as tabs, so they keep link roles and shareable URLs;
  `aria-current="page"` marks the active one. Frontend calls same-origin relative `/api` paths.
- Permission is checked inside the store-locked mutation, never from the body: team/parent/member and
  organization member changes need an Owner (`isOwner`); access grants need the repository Admin.
- Removing a member is one `store.update`: it drops the membership, that account’s team memberships in
  the organization and its direct grants on the organization’s repositories; team grants stay. The last
  Owner cannot be removed.
- Access rows are upserted by subject: a grant updates an existing account/team row, and
  `updateRepositoryGrant` changes a role in place. Roles are stored lowercase and labelled by
  `roleLabel`/`repositoryRoleLabel`.
- An access row carries `aria-label` `<subject name> <Role>` (`row` has no name from content), so “the row
  whose accessible name contains <team>” resolves. While a picker/dialog is open the panel behind it is
  `aria-hidden`, so only the dialog’s “Role”/“Add”/“Remove” controls match.
- Organization memberships are seeded once per organization (`organization.seededMembers`): a removed
  membership stays removed across restarts, while an earlier stage’s document still gains current seed
  members. Other seeds are add-if-missing and never overwrite stored changes.
- A rejected change must not leave partial state: each mutation runs in one `store.update`, a rejected
  parent change keeps the stored parent, and a rejected access save re-selects the saved role.
- `useAsyncData` keeps the last successful value during reloads, so detail views must not render it while
  `error` is set (a denied object would otherwise show a previously loaded one).
- Static serving has no SPA catch-all: `/` serves `index.html`, unknown paths/APIs return 404 JSON.
- `frontend/vitest.config.ts` pins `minWorkers: 1` (the controller runs Vitest with `--maxWorkers=1`).

## 必要准备

- `ensureSeeded` writes these verified, available accounts on first start (empty storage only; restarts
  keep stored state), all with password `Valid-password-123!`: `alice-dev`, `recovery-visibility`,
  `recovery-invalid-code`, `recovery-success`, `password-change-success`, `password-change-invalid`,
  `password-change-required`, `org-owner`, `team-maintainer`, `bob-reviewer`, `new-member`,
  `existing-member`, `org-member`, `protected-member`, `repo-admin`.
- It also seeds organization `acme-demo` (“Acme Demo”) with Owners `org-owner`/`team-maintainer` and
  members `bob-reviewer`, `existing-member`, `org-member`, `protected-member`; teams `platform-team` ←
  `frontend-team` ← `frontend-child` plus `access-role-team`; repositories `acme-docs` (public, with the
  grants `repo-admin`→admin and `access-role-team`→write) and `secret-research` (private, ungranted).
- Scenario-only objects use normal product paths: an ungranted private repository is opened by URL and
  answers “Access denied” for a member without a grant; `repo-admin` (no membership) reaches `acme-docs`
  through “Your organizations” → its repositories list.
- Password recovery needs no delivery service: `/api/password/forgot` answers with the fixed code
  `123456`; a password change resolves the account from the session cookie and ends that session.
