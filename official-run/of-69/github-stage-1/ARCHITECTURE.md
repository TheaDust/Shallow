# ARCHITECTURE

Simplified GitHub collaboration platform. Stage 1 (REQ-1) covers identity:
registration, sign-in, recovery, sign-out. REQ-2 adds organizations, teams,
membership and organization repository browsing; the current packet
(REQ-2-2-3, REQ-2-2-4, REQ-2-3) adds direct member add/remove on People and
per-repository access grants for people and teams.

## Modification entry points

- `backend/src/server.mjs` — binds `PORT` (plus the `platform-ports.json` ports
  unless `ARC_EXTRA_PORTS=0`) and mounts one handler per port; `SHALLOW_DATA_DIR`
  supplies the data directory.
- `backend/src/app.mjs` — `createRequestHandler({ dataDir, staticRoot })` owns
  the identity API (`/api/register`, `/api/signin`, `/api/signout`,
  `/api/session`, `/api/recovery/*`, `/api/account/password`, `/health`,
  `/api/health`) and delegates `/api/organizations/*` and
  `/api/public/organizations` to the organization API. Unknown `/api/*` and
  unknown files return 404.
- `backend/src/routes/organizations.mjs` — `createOrganizationApi(database)`:
  organization list/create/overview, `/repositories[/:name[/access[/:grantId]]]`,
  `/members[/:username]`, `/teams[/:team[/members[/:username]]]`. All permission
  decisions are made here from the session account, never from what the UI chose
  to render.
- `backend/src/lib/organizations.mjs` — organization-scoped queries:
  `findOrganizationByName`, `listAccountMemberships`, `listOrganizationMembers`,
  `listVisibleRepositories`, `repositoryRole`/`repositoryRoleFromState`,
  `canReadRepository`, `listRepositoryGrants`, `listOrganizationTeams`,
  `findTeam`, `wouldCreateCycle`, `listTeamMemberUsernames`.
- `backend/src/lib/organization-rules.mjs` — exact user-visible messages and
  validators (`ORGANIZATION_MESSAGES`, `TEAM_MESSAGES`, `MEMBER_MESSAGES`,
  `REPOSITORY_ACCESS_MESSAGES`, `REPOSITORY_ROLES`, `validateRepositoryRole`,
  `highestRepositoryRole`, `validateTeamName`, `organizationKey`).
- `backend/src/lib/database.mjs` + `seed.mjs` — `accounts` / `sessions` stores
  plus the single `organizationState` aggregate; seed accounts, `Acme Demo`, its
  teams and its public/private repositories.
- `frontend/src/App.tsx` + `src/lib/routes.ts` — hash route table, dispatch and
  protected-view list; `src/lib/hash-route.ts` exposes `navigate` (push) and
  `replaceHash` (in-page state such as the repository filter).
- `frontend/src/components/OrganizationLayout.tsx` + `TeamLayout.tsx` +
  `RepositoryLayout.tsx` — shared frames: the organization/team/repository link,
  the page heading and the Repositories/People/Teams (or Members/Settings, or
  Settings/Manage access) link entries.
- `frontend/src/pages/OrganizationPeoplePage.tsx` — member list plus the Owner
  “Add member” form and the per-row “Member menu <username>” / Remove
  confirmation; the member role is shown as text, the menu trigger is an
  icon-only button whose accessible name is “Member menu <username>”.
- `frontend/src/pages/RepositoryAccessPage.tsx` + `RepositorySettingsPage.tsx` —
  “Settings” then “Manage access”: the access table and the “Add people or
  teams” picker. `RepositorySettingsPage` must not repeat the “Manage access”
  link that `RepositoryLayout` already renders.
- `frontend/src/pages/` — `HomePage` (public organization discovery),
  `YourOrganizationsPage`, `NewOrganizationPage`, `OrganizationOverviewPage`,
  `OrganizationRepositoriesPage`, `RepositoryOverviewPage`,
  `OrganizationPeoplePage`, `OrganizationTeamsPage`, `NewTeamPage`,
  `TeamOverviewPage`, `TeamMembersPage`, `TeamSettingsPage`.
- `frontend/src/lib/organization-api.ts` — typed same-origin client for the
  organization API; `src/lib/use-async-data.ts` — page load/error/busy hook.

## Key constraints

- One aggregate store `organizations.json` (`database.organizationState`) holds
  organizations, memberships, teams, team memberships, `repositoryGrants` and
  organization repositories. Organization creation writes the organization
  object and the creator's Owner membership in a single update, and member
  removal deletes the membership, the account's team memberships in that
  organization and its direct repository grants in one update, so no
  organization can exist without an Owner and a relationship change is atomic.
  Removing the last remaining Owner is rejected before any write.
- Repository permission is `repositoryRoleFromState`: an organization Owner is
  Admin on every repository, otherwise the account's direct grants plus the
  grants of the teams it belongs to decide the highest role
  (read<triage<write<maintain<admin). Repository read permission is
  `canReadRepository`: every public repository is readable, a private one only
  when that role is not null; plain organization membership grants nothing. The
  list endpoint, the repository endpoint and the access endpoints all use the
  same rule, so a repository hidden from the list is also refused by direct URL
  (`403 Access denied`), and the `access` routes require the `admin` role.
- Only a repository Admin sees the Settings/Manage access entries, and while the
  “Add people or teams” picker is open the access table and its trigger are not
  rendered, so the page never has two “Role” comboboxes or two “Add” buttons at
  once.
- Seed values are applied only when a store file is absent; user changes persist
  and must not be overwritten on restart.
- Passwords are hashed and never returned. The sign-in failure is always the
  single string "Invalid credentials". The account menu popup items are `<a>`
  (role link) — “Your organizations”, “Settings”, “Sign out” — and navigate
  before unmounting; the trigger button's accessible name is exactly “Account
  menu”.
- Organization navigation entries are links (role link) styled as a tab strip,
  never tabs or buttons. The organization heading shows the display name and the
  identifier, and the repository heading shows `display/repository` plus the
  identifier form, because the scenarios expect a heading containing both the
  identifier (`mobile-guild`) and the visible label (`Acme Demo`).
- The repository filter is mirrored into the hash with `replaceHash`, so browser
  Back returns to the same filtered result instead of a lost filter state.
- Protected routes (workspace, settings, `organizations`, `organizations/new`,
  `organizations/:org/teams/new`) redirect to home without a session. People,
  Teams and the team/repository settings pages stay reachable and surface the
  server's `403 Access denied`; a non-Owner member sees the lists without any
  management controls, and a non-Admin sees no Settings/Manage access entries.

## Necessary preparation

- Seed accounts (password `Valid-password-123!`, defined in
  `backend/src/lib/seed.mjs`, provisioned on an empty `SHALLOW_DATA_DIR`; delete
  that directory to reset): the REQ-1 accounts plus `org-owner` and
  `team-maintainer` (Owners of `Acme Demo`), plain members `bob-reviewer`,
  `existing-member`, `org-member` and `protected-member`, and `new-member`
  (account only, no membership) and `repo-admin`. `unknown-reviewer` has no
  account on purpose.
- Seed organization `Acme Demo` (identifier `acme-demo`, display name
  `Acme Demo`) with public `acme-docs`, private `secret-research`, and teams
  `platform-team` > `frontend-team` > `frontend-child` plus `access-role-team`,
  with no team members. Direct grants: `repo-admin` Admin on `acme-docs` and
  `access-role-team` exactly one Write on `acme-docs`; `frontend-team` starts
  ungranted.
- Recovery uses the fixed code `123456` (`backend/src/lib/recovery.mjs`).
