# ARCHITECTURE

Simplified GitHub-like collaboration platform: React + Vite + TypeScript frontend, zero-dependency
Node `http` backend, hash routing. Stable index of entry points, shared interfaces, seed data,
conventions — not a requirements list.

## Run contract

- Backend reads `PORT` (default 3000) and additionally listens on every port in
  `backend/src/platform-ports.json` (3301) unless `ARC_EXTRA_PORTS=0`. One independent
  `http.createServer(handler)` per port, bound to `0.0.0.0`, serving the same app.
- Health: `/health` and `/api/health` → `{ ok: true }`. `/` and static files come from
  `frontend/dist` resolved relative to the server file; unknown paths (`/favicon.ico`, `/api/*`)
  return a JSON error and the process never exits.
- Persistence uses `SHALLOW_DATA_DIR` (default `backend/.data`); tests set their own temp dirs.

## Frontend

`frontend/src/main.tsx` → `App.tsx` = `SessionProvider` + `AppHeader` + `AppRoutes`; hash routes
(`lib/hash-route.ts`: `useHashLocation`, `navigate`, `makeHash`):

| Hash | View | Auth |
| --- | --- | --- |
| `#/` | `pages/HomePage.tsx` — guest intro / signed-in workspace | public |
| `#/login` | `pages/SignInPage.tsx` — sign-in form (`?registered=1` shows the success status) | public |
| `#/signup` | `pages/RegisterPage.tsx` — registration form | public |
| `#/forgot-password` | `pages/PasswordResetPage.tsx` — Email → `Send reset link` → code `123456` + reset form | public |
| `#/settings[/password]` | `SettingsPage` (index, link `Password and authentication`) / `PasswordSettingsPage` — `Current password` / `New password` / `Confirm password` + `Update password` | protected |
| `#/organizations[/new]` | `OrganizationsPage` — heading `Your organizations`, link `New organization` / `NewOrganizationPage` — `Organization name` / `Display name` + `Create organization` | protected |
| `#/organizations/:org` | `OrganizationRepositoriesPage` (default) / `/repositories`, `/people`, `/teams` | public (server filters) |
| `#/organizations/:org/teams/new` | `NewTeamPage` — `Team name` / `Description` / `Parent team` + `Create team` | Owner |
| `#/organizations/:org/teams/:team` | `TeamPage` (`/members` default, `/settings`) | member |
| `#/repositories/:org/:repo[/settings[/access]]` | `RepositoryOverviewPage` (heading `organization name/repository name` + `Settings`) → `RepositorySettingsPage` (link `Manage access`) → `RepositoryAccessPage` | public/private; admin (else read-only) |
| other | `pages/common.tsx` `NotFoundPage` | public |

Organization names may contain spaces (`Acme Demo`), so `App.tsx` splits the hash path into
percent-decoded segments and `org/org-api.ts` builds every hash from `encodeURIComponent`.
`OrganizationRoutes`/`RepositoryRoutes` map segments to pages (unknown → `NotFoundPage`); org names
match ignoring case, spaces and hyphens. Views, panels and `org/` helpers (API, tree, formatting)
stay separate modules, none near 1,000 lines.

- `components/AppHeader.tsx`: signed out → nav with `Sign up`, `Sign in` (→ `#/login`) and
  `Forgot password` (→ `#/forgot-password`) links, hidden on `SELF_ACCESS_PATHS` (`/login`,
  `/settings`, `/settings/password`) where the page renders its own access links; signed in →
  `components/AccountMenu.tsx`.
- `components/AccountMenu.tsx`: one button with `aria-label="Account menu"` whose visible
  text is exactly the current username (no avatar initial or other text); the `role="menu"`
  holds `Your organizations`, `Settings`, `Sign out`. `Sign out` opens the dialog `Sign out`
  (buttons `Confirm sign out`, `Cancel`); only confirm calls the API, then `#/` is opened.
- `session/SessionProvider.tsx`: `{ status, account, setAccount, reload, endSession }`;
  loads `GET /api/auth/session` on mount and pages render a `role="status"` busy state while
  `status === "loading"`.
- `session/session-api.ts`: typed auth calls; `auth/validation.ts` mirrors the backend field
  rules and messages; `auth/pending-signin.ts` carries the just-created username across the
  registration → sign-in hand-off (memory only). Credential forms disable their controls while
  a submission is in flight.
- `lib/api.ts`: same-origin JSON fetch; `ui/` primitives: Button, Dialog, FormField, Menu,
  Tabs, Combobox, Toast (imported from `styles.css`). `org/org-api.ts` (typed calls + hash
  builders), `org/use-async-data.ts` (`useAsyncData`: `loading`/`ready`/`error` + `reload`),
  `org/buildTeamTree` (`team-tree.ts`), `org/format.ts`, `org/repository-access.ts`
  (repository role labels + local subject matching). `pages/organizations/` holds the
  organization shell (`Repositories`/`People`/`Teams` are **links** styled as tabs) and its
  panels; `HomePage` lists public organizations to visitors and the signed-in account's
  organizations in the workspace.
- People (`OrganizationPeoplePage`): `AddMemberForm` (opener `Add member` → labeled
  `Username or email`, `Role` combobox with options `Member`/`Owner`, submitting `Add member`;
  the opener is hidden while the form is open so the submit is unique) and `MemberRowActions`
  (`Member menu <username>` → menuitem `Remove from organization` → dialog `Remove`) render
  only for an organization Owner.
- Repository access (`RepositorySettingsPage` → `RepositoryAccessPage` + `AccessSubjectPicker`
  + `RepositoryGrants`): the picker shows `Search`, a `listbox` of member/team options
  (accessible name = the plain subject name) and the `Role` combobox; grant rows show the
  subject name plus their own `Role` select and `Save`. Controls appear only for an effective
  repository role of `admin`. `TeamSettingsPanel` option values are team ids, so the stored
  `parentTeamId` is the selected value.

## Backend

`src/app.mjs` → routes `/health`, `/api/*` → `src/routes/auth.mjs` (delegating credential
routes to `src/routes/password.mjs`), else static files.

- `src/domain/accounts.mjs`: username/email/password rules and messages, scrypt password
  hashing/verification, `publicAccount()`, `findAccountByIdentifier()` (username or email).
- `src/lib/db.mjs`: `getStores()` / `ensureSeedData()` → the JSON stores under the data dir
  (`accounts`, `sessions`, `organizations`, `organization-members`, `teams`, `repositories`,
  `repository-grants`); seeds are written once when a file is missing.
- `src/lib/json-store.mjs`: queued atomic read/update (`seedIfMissing`, `read`, `update`).
  `src/lib/session.mjs`: cookie `shallow_session` (HttpOnly, SameSite=Lax); sign-out sets
  `active: false` and clears the cookie.

### API

| Route | Body | Success | Failure |
| --- | --- | --- | --- |
| `GET /api/auth/session` | — | `{ account, session }` (`null` when signed out) | — |
| `POST /api/auth/register` | `{ username, email, password, confirmPassword, agreeToTerms }` | `201 { account }` (verified, no session) | `400 { errors: { username?, email?, password?, confirmPassword?, terms? } }` |
| `POST /api/auth/sign-in` | `{ identifier, password }` | `200 { account, session }` + cookie | `401 { error: "Invalid credentials" }` |
| `POST /api/auth/sign-out` | — | `200 { ok: true }`, cookie cleared | — |
| `POST /api/auth/password` | `{ currentPassword, newPassword, confirmPassword }` (session) | `200 { ok: true }` | `401`; `400 { errors: { … } }` |
| `POST /api/auth/password-reset` | `{ email, code, newPassword, confirmPassword }` | `200 { ok: true }` (no session) | `400 { errors: { … } }` |
| `GET /api/organizations?scope=public\|mine` | — | `200 { organizations: [{ name, displayName, role? }] }` (`mine` needs a session) | `401` for `mine` |
| `POST /api/organizations` | `{ name, displayName }` (session) | `201 { organization }` + owner membership | `400 { errors: { name?, displayName? } }` |
| `GET /api/organizations/:name` | — | `200 { organization: { id, name, displayName, createdAt, role, isMember } }` | `404` |
| `GET /api/organizations/:name/repositories` | — | `200 { repositories: […] }` (viewer-visible) | `404` |
| `GET/POST /api/organizations/:name/people` | `{ identifier, role }` for POST (Owner) | `200 { members: [{ username, role }], viewerRole }` | `400 { errors: { identifier?, role? } }`, `401`/`403` |
| `DELETE /api/organizations/:name/people/:username` | — (Owner) | `200 { members }` | `400` last Owner, `403`, `404` |
| `GET /api/repositories/:org/:repo/access` | — | `200 { grants, members, teams, viewerRole }` | `401`/`403`/`404` |
| `POST /api/repositories/:org/:repo/access` | `{ subjectType, subjectId, role }` (Owner/Admin) | `200 { grants, members, teams, viewerRole }` | `400 { errors: { role?, subject? } }`, `403` |
| `GET /api/organizations/:name/teams` | — | `200 { teams, viewerRole }` | `401`/`403` |
| `POST /api/organizations/:name/teams` | `{ name, description, parentTeamId }` (Owner) | `201 { team }` | `400 { errors: { name?, parentTeamId? } }`, `403` |
| `GET /api/organizations/:name/teams/:team` | — | `200 { team, viewerRole }` (members, children, parent) | `403`/`404` |
| `POST/DELETE …/teams/:team[/members/:username]` | `{ username }` (Owner) | `200 { team }` | `400 { errors: { username } }`, `403`, `404` |
| `PUT …/teams/:team/parent` | `{ parentTeamId }` (Owner) | `200 { team }` | `400 { errors: { parentTeamId } }` (foreign parent, cycle) |
| `GET /api/repositories/:org/:repo` | — | `200 { repository: { …, ownerName, fullName } }` | `401` visitor on private, `403` no read, `404` |

Register reports every invalid field in one response; duplicate checks happen inside the store
update so accounts are created atomically. `src/routes/password.mjs` handles both credential
changes and `src/lib/auth-context.mjs` (`getCurrentAccount`) resolves session → account; changing
a credential keeps sessions valid. Routing: `handleAuthRoutes` → `handleOrganizationRoutes`
(`src/routes/organizations.mjs`) → `handleRepositoryRoutes`, else `404`.

### Organization routes

`src/domain/organizations.mjs` holds the field rules/messages, `src/lib/org-access.mjs` the
membership/role lookups, `canReadRepository`, `effectiveRepositoryRole`,
`organizationRepositories` and `wouldCreateTeamCycle`. Every route resolves the account from
the session cookie and re-checks the permission; the frontend only hides controls.

- Organization member write operations (`POST …/teams`, member add/remove, `PUT …/parent`)
  require role `owner`; reads of People/Teams require any membership; repository lists are
  filtered per viewer. A parent reference may be a team id or the name of a team of the same
  organization; create and parent-save resolve it to the stored id before checking cycles.
- Member add (REQ-2-2-3) stores the `organization-account-role` relationship at once — no
  invitation/Pending step — and reports `Account not found` / `Account is already a member` /
  `Unsupported role` without changing anything. Member removal (REQ-2-2-4) deletes the
  membership, every team membership of that account in the organization and every direct grant
  of the account on repositories of the organization; team grants, teams, the account and its
  other organizations survive, and the last Owner is rejected.
- `effectiveRepositoryRole` (Owner status = Admin, direct grants, team grants of teams the
  account directly belongs to; highest wins) drives both read access and access management
  (`admin` only). Organization membership alone never opens a private repository.
- Repository grants (REQ-2-3) are upserted per (repository, subject): repeating a role keeps
  one record, another role replaces it. `Search` filtering is client-side over the candidate
  members/teams the access payload returns.
- An existing identifier is reported as `Organization name already exists` **before** the
  format rule (the seeded `Acme Demo` is a valid duplicate case). Uniqueness trims, lowercases
  and maps whitespace to `-`, which is also how names resolve from URLs
  (`#/organizations/acme-demo`).

## Seed data and scenario preparation

- `alice-dev` / `alice.dev@example.test` / `Valid-password-123!` — verified, active account,
  seeded on first start and kept across restarts (`SEED_ACCOUNT` in `src/lib/db.mjs`);
  sign-in, recovery and password-change scenarios use it as-is. `bob-reviewer` /
  `bob.reviewer@example.test` / `Valid-password-123!` is the seeded **member**
  (`SEED_MEMBER_ACCOUNT`), `alice-dev` the seeded **Owner**.
- Organization `Acme Demo` (`SEED_ORGANIZATION`, id `org-acme-demo`): memberships
  `alice-dev` (owner) and `bob-reviewer` (member) in `organization-members.json`.
- Teams (`teams.json`): `platform-team` → `frontend-team` → `frontend-child` (parent chain),
  all with no direct members, so `bob-reviewer` is an organization member outside
  `frontend-team`; the stored parent of `frontend-team` is the selection shown by `Parent team`.
- Repositories (`repositories.json`, both owned by the organization): `acme-docs` (public)
  and `acme-internal` (private, no direct or team grant → invisible to visitors and to plain
  members; readable by an organization Owner). `repository-grants.json` starts **empty**: the
  REQ-2-3 creation scenario requires the subject to be ungranted, so the matching replacement
  scenario prepares its “existing Write grant” through the access picker (public operation).
- Additional accounts (e.g. `pw-user-<suffix>`) are created through the public registration
  form/API; there is no scenario-specific hardcoding of names or outcomes. Password-change
  tests register their own accounts so the seed password survives. Recovery has no server-side
  state: `#/forgot-password` switches step in the page, which displays the fixed code
  `123456` locally.

## Conventions

- Requirements state interface names verbatim: `Sign up`, `Sign in`, `Forgot password`,
  `Create an account`, `Username`, `Email`, `Password`, `Confirm password`,
  `Agree to the terms`, `Create account`, `Invalid credentials`, `Account menu`, `Sign out`,
  `Confirm sign out`, `Cancel`. Field errors: `Username format is invalid`,
  `Username already exists`, `Email format is invalid`, `Email already exists`,
  `Password requirements are not satisfied`, `Password confirmation does not match`,
  `Agree to terms is required`, `Current password is required`, `Current password is incorrect`,
  `Verification code is invalid`, `Email is not registered` (server + `auth/validation.ts`).
- Organization names/messages: `Your organizations`, `New organization`, `Organization name`,
  `Display name`, `Create organization`, `Organization name already exists`,
  `Organization name format is invalid`, `Display name is required`, `Repositories`, `People`,
  `Teams`, `Find a repository`, `New team`, `Team name`, `Create team`,
  `Team name format is invalid`, `Members`, `Settings`, `Add member`, `Username or email`,
  `Role` (options `Member`/`Owner`), `Account not found`, `Account is already a member`,
  `Unsupported role`, `The organization must keep at least one Owner`,
  `Member menu <username>`, `Remove from organization`, `Remove`, `Manage access`,
  `Add people or teams`, `Search`, `Add`, roles `Read`/`Triage`/`Write`/`Maintain`/`Admin`,
  `Save`, `Remove <username>`, `Parent team`, `Cyclic team hierarchy is not allowed`,
  `Access denied`. `Repositories`/`People`/`Teams` are links (aria-current="page"); a rejected
  team parent keeps the stored value selected; the picker's option listbox is named
  `Matching people and teams` so it cannot be confused with the `Search` textbox.
- Fixed local verification code `123456`, success status `Password updated`, seed passwords
  `New-password-456!` / `Required-password-789!` / `Replacement-password-456!` (values only).
  Password values are never echoed: the API never returns them, and after any failed submit
  the password/confirmation inputs are cleared while username/email are retained. After a
  successful registration the sign-in page is the active view and its identifier field
  starts with the new account's username.