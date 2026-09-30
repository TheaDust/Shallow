# ARCHITECTURE

Simplified GitHub collaboration platform. Stable facts only: entry points, shared interfaces, seed relations, key conventions; exact messages live in `domain/*.mjs`.

## Runtime entry points

- `frontend/`: React 18 + Vite + TypeScript, hand-written hash routing (`lib/hash-route.ts`): `#/`, `#/signin`, `#/signup`, `#/password-reset`,
  `#/settings[/password]`, `#/workspace`, `#/search`, `#/new` and `#/repos/:owner/:name` with its sub-addresses (`tree|blob|edit|commits|commit|compare`,
  `issues[/new|/<n>]`, `pulls[/new|/<n>?tab=&path=]`, `settings[/general|/branches|/access]`; tables in `lib/repository-routes.ts`, `lib/organization-routes.ts`);
  an unknown hash path renders a not-found `main`; `/` serves `frontend/dist/index.html`, so direct open and refresh work.
- `backend/`: zero-dependency `node:http`. `server.mjs` reads `PORT` (default 3000) and also binds every port of `backend/src/platform-ports.json` (3301)
  unless `ARC_EXTRA_PORTS=0`; one `createServer` per port, all on `0.0.0.0`, sharing one `createApp` handler and store. The static root resolves from the module
  location, not the cwd; `SHALLOW_DATA_DIR` (default `backend/.data`) holds `state.json` (`lib/json-store.mjs`). Unknown `/api/*` and static paths answer `404`
  and the process keeps serving.

## Shared API (same-origin, JSON)

- Accounts, sessions, repositories: `POST /api/accounts`; `POST|GET|DELETE /api/sessions[/current]` (`401 Invalid credentials` for an unknown account, a wrong
  password and an unavailable account alike); `POST /api/password-recovery[/requests]`; `POST /api/account/password`; `GET|POST /api/repositories`,
  `GET /api/repositories?owner=<login>`, `GET …/:owner/:name[?branch=&path=]`, `GET|POST …/forks`, `POST …/visibility`, `GET /api/namespaces`.
- Code and version control (REQ-4, `store-code-writes.mjs`): `GET …/file|/commits|/commits/:id|/compare` with `base`/`compare`/`changedFiles` where relevant;
  `POST …/branches` `{name,baseBranch}`, `POST …/default-branch` `{branch}` (`admin`) and `POST …/file` `{branch,path,content,message,previousPath?}` need
  `write`/`maintain`/`admin` and answer `401`/`403` or `400 {error,fields}`. A protected branch answers that write with `403`.
- Pull requests (REQ-6, `store-pull-requests.mjs`): `GET|POST …/pulls` (rows of this repository, created from `{base,compare,title?,description?,draft?}`),
  `GET …/pulls/compare?base=&compare=` (read-only comparable commits, changed files, diff, `canCreate`) and `GET …/pulls/:number` (the stored record plus
  commits, changed files, comments, review summary, the `test` check of the current compare commit, `mergeability`, `permissions`); `POST
  …/pulls/:number/checks|comments|reviews|reviewers|status` answers with the persisted pull request. Write/Maintain/Admin create, comment and review; the author
  or Maintain/Admin mark a draft ready, close and reopen; Maintain/Admin and Owners request reviewers and merge; only an Admin sets the check; `merged` is
  terminal. An equal pair, a pair without comparable commits, a duplicate Draft/Open pair and an unsatisfied
  protection rule answer `400`. `GET|POST …/branch-protection` (`store-branch-protection.mjs`) stores one rule per exact branch name
  (`{branchName,requireApproval,requireStatusCheck}`, summaries `1 approval` / `Require status check test`) for an Admin only.
- Organizations and access: `GET|POST /api/organizations`, `GET /api/organizations/:login`, `…/repositories`, `GET|POST …/members`,
  `Delete …/members/:username`, `GET|POST …/teams[/:name][/parent|/members[/:username]]` (one direct membership; it survives team removal); `GET …/access` → `{repository, viewer:{role,canAdminister}, grants, candidates}` and `POST …/access` stores one grant per subject and repository.
- Issues (REQ-5, `store-issues.mjs`): `GET|POST …/issues` and `GET …/issues/:number`; the writes `…/issues/:number/title|description|comments|reactions|
  assignees|labels|milestone|status` answer with the persisted issue. `write`/`maintain`/`admin` create, edit and comment, `triage` and above assign, label, set
  the milestone and change the status; any signed-in reader may react.
- Refusals: an unknown repository, revision, issue or pull-request number, and an anonymous viewer of a private repository, answer `404`; a signed-in viewer
  without access answers `403`, and a readable repository without that file, number or branch `404 {error,repository}`.

## State model (`state.json`)

- `accounts`: `{id,username,email,emailVerified,status,credential:{algorithm,salt,hash},createdAt}`; `sessions`: `{id,accountId,active,createdAt}`.
- `repositories`: `{id,owner:{type,id,login},name,visibility,description,defaultBranch,createdBy,createdAt,updatedAt,sourceRepository,branches,commits}`; a
  branch is `{name,headCommitId,createdBy?,createdAt?}` and a commit holds its message, author, parent and `changes:[{path,changeType,content}]`. Tree, file
  content, history, diff and code search are **derived** from that graph (`domain/commit-graph.mjs`, `line-diff.mjs`, `code-search.mjs`).
- `repositoryGrants`: `{repositoryId,subjectType:"account"|"team",subjectId,role?,grantorId,createdAt}` (one record per subject and repository, `role`
  defaulting to `read`); `organizations`: `{id,login,name,createdAt,createdBy,members:[{accountId,role:"owner"|"member",createdAt}]}`; `teams`:
  `{id,organizationId,name,description,parentTeamId|null,createdBy,createdAt}`; `teamMemberships`: `{teamId,accountId,createdAt}`.
- `labels`/`milestones` belong to one repository and `reactions` hold one record per account, target and type; `issues`:
  `{id,repositoryId,number,title,description,status:"open"|"closed",authorId,createdAt,updatedAt,labelIds,assigneeIds,milestoneId,comments,
  activities}`, the number being the repository-scoped `max+1` of one atomic write and `activities` append-only (`created`, `commented`, `closed`, …).
- `pullRequests`: `{id,repositoryId,number,title,description,status:"draft"|"open"|"closed"|"merged",authorId,baseBranch,compareBranch,baseCommitId,
  compareCommitId,creationCompareCommitId,createdAt,updatedAt,comments,reviews,reviewerIds,activities}`, the number being the repository-scoped `max+1`. The
  current compare commit, changed files, review summary and merge eligibility are read at request time, so a new compare commit makes older reviews stale but
  keeps them. `pullRequestChecks` holds one
  `{pullRequestId,commitId,name:"test",status,setById,setAt}` per compare commit (absent \u21d2 `pending`); `branchProtectionRules` holds
  `{id,repositoryId,branchName,requireApproval,requireStatusCheck,createdBy,createdAt,updatedBy,updatedAt}`.
- Roles (`domain/repository-access.mjs`): `effectiveRepositoryRole` = `admin` for the owning account or an organization Owner, else the highest of the direct
  account grants and the grants of the teams the account is a *direct* member of, else `null`; `canViewRepository` (public ⇒ everyone, private ⇒ any effective
  role) is the single access rule behind every read above.

## Seed (`backend/src/seed.mjs`)

- Accounts `alice-dev` (organization Owner), `bob-reviewer` (ordinary member) and `carol-dev` — each with a verified `<login with '-' as '.'>@example.test` and the
  password `Valid-password-123!`; `alice-dev` owns the organization `acme-demo` with its empty team `frontend-team`.
- Repositories, written only when `state.json` is absent (every later change persists): `alice-dev/acme-docs` (public), `alice-dev/secret-research` (private,
  Write grant for `bob-reviewer`), `alice-dev/acme-docs-fork` (private fork), `acme-demo/acme-docs` (public), `acme-demo/acme-internal` (private, `read` grant for
  `bob-reviewer`) and `bob-reviewer/bob-notes` (public); a repository has one owner, so `acme-docs` exists twice. `alice-dev/acme-docs` carries the branches
  `main`, `feature-search`, `release` and `draft-feature` with `search flow` only in `README.md` and `src/search.ts`. `feature-search` is one commit ahead of
  `main` (adding `main-only.md` and editing `src/search.ts`), so `main → feature-search` is one commit, one added and one modified file, `3 additions, 1
  deletions`; `release` is an ancestor of `main`, `draft-feature` a child of its head.
- REQ-6 seed of the same repository: pull requests `1 Improve onboarding` (Closed) and `2 Fix search` (Open), both proposing `feature-search` into `main`, the
  Open one with the requested reviewer `bob-reviewer`, plus the dedicated ready-for-review seed `3 Draft onboarding update` (Draft, author `carol-dev`, proposing
  `draft-feature` into `main`, no submitted review); no check result and no protection rule is stored, so `test` reads as `pending`.
- REQ-5 planning data of every `acme-docs` record: labels `bug` and `documentation`, milestones `Q3 launch` and `v1.0`, issues `1 Improve onboarding` (Open,
  label `bug`, assignee `alice-dev`, milestone `Q3 launch`, one comment), `2 Legacy welcome text` (Closed, label `bug`) and `3 Original issue title` (Open);
  `acme-demo/acme-internal` holds its own label `internal` and milestone `Internal beta`.

## Account-access conventions (REQ-1)

- Exact labels live in `domain/validation.mjs` and the pages; violations are reported in one submission, failed submissions keep non-sensitive input, and the
  guest entries (`Sign up`, `Sign in`, `Forgot password`) are hidden on the account-access, settings and `/new` pages. The account menu (`layout/AccountMenu.tsx`)
  has two triggers for one `role="menu"` — the username link and the `Account menu` button — with items `Your organizations`, `Settings`, `Sign out`.

## Repository conventions (REQ-3, REQ-4)

- The header carries the only search form (`layout/GlobalSearch.tsx`, `role="search"`, searchbox `Search`) of the current repository; the results page has
  `h1` `Search results`. Repository pages share `repository/RepositoryChrome.tsx`: `h1` = `owner/name` (`repositoryTitle` uses `<organization display name>/name`),
  a leaf `Public`/`Private` marker, the nav `Repository` (`Code`, `Issues`, `Pull requests`, `Settings`) and the description.
- The Code page carries the `Code` clone popover, the `Fork` dialog and `Forked from <owner/name>`; `/settings/general` shows the `Danger Zone` with
  `Change visibility` for an Admin only. Its branch selector lists matching names and, for a signed-in viewer typing a valid unused name, the `option`
  `Create branch: <name>` (`Invalid branch` otherwise, `No matching branch` for a visitor); entries are links named after the file; the path is the `Breadcrumb`
  nav (leaf `aria-current="page"`); a file page reads one `<pre><code>`.

## Pull-request conventions (REQ-6)

- `pages/RepositoryPullRequestsPage.tsx` (`…/pulls?state=&author=&review=`) has the `h2` `Pull requests`, the filter links `Draft`/`Open`/`Closed`/`Merged`
  (each addressing the same list with that status), the textbox `Author` and the `Review status` select over one `li` per stored record: status text, the number
  link `#<n>`, the title link (accessible name = the title), the author, the compare and base branches; `New pull request` is a *link* for Write and above.
- `pages/RepositoryPullRequestComparePage.tsx` (`…/pulls/new?base=&compare=` selects both branches) is read-only: the native `base`/`compare` selects (options
  are the exact branch names), `Compare changes`, `Commit summary` with the comparable commit count and `Changed files` (the known path `src/search.ts` verbatim).
  An equal or difference-free pair shows `No changes` and disables creation at once. `Create pull request` /
  `Create draft pull request` open `pull/PullRequestCreateForm.tsx` on the same page — `Title`, optional `Description`, one submit button named after the
  creation and no competing page action; the title is required and trimmed to ≤256 characters (`Title is required`) and success opens the detail page of the stored
  record.
- `pages/RepositoryPullRequestPage.tsx` (`…/pulls/<number>?tab=&path=`) renders the exact title as `h1`, then `#<n>`, the status text, the mergeability
  sentence and the *link* nav `Conversation`/`Commits`/`Files changed`/`Checks`; those sections read the same comparison (`Commit summary` with the count and one
  link per commit; `Changed files` with `N changed files`, the aggregate `N additions, M deletions`, one expanded diff block per file and a link per changed file
  that selects that file's diff in place via `?path=<file>`). Status actions: `Ready for review`, `Close pull request`, `Reopen pull request`,
  `Merge pull request` (while mergeable). Conversation holds the description, `Review summary`, `Comment` articles, `Activity`, the `Comment` editor and the
  `Review decision`/`Review comment` form (`Submit review`, absent on a Draft). A Draft shows `Ready for review` to the author or a Maintain/Admin (stores `open`
  with a `ready_for_review` activity, no confirmation) and keeps `Merge pull request` disabled for a writer; the server refuses a review or merge on a draft the
  same way. The Checks area sits on the page: `test: pending|success|failure` with setter and time; an Admin gets the `test status` combobox with `Save`.
- Settings → Branches carries `repository/BranchProtectionPanel.tsx`: the Admin-only `Add branch protection rule` opens the form with `Branch name pattern`,
  `Require 1 approval`, `Require status check test` and `Create` (`Save changes` for a stored rule); each rule shows its branch name and the summaries
  `1 approval`/`Require status check test`.

## Issue, organization and frontend conventions (REQ-2, REQ-5)

- Issues: `…/issues?state=&q=&label=` lists one `li` per issue (status, the `#<n>` link, the title link, labels, author, time) under
  `h2` `Issues`, with the filter links `Open`/`Closed`, the searchbox `Search issues` and the native `Labels` select. `…/issues/<number>` shows the title as `h1`,
  `#<n>`, the status, `Description`, the `Add reaction to issue` menu, the `Comment` articles, `Activity` and the `Assignees`/`Labels`/`Milestone` areas; a writer
  gets `Edit issue title`/`Edit issue description` and Triage and above `Close issue`/`Reopen issue`; a whitespace-only comment body appends nothing.
- Organizations and modules: `pages/OrganizationPage.tsx` shows `h1` = organization identifier, `h2` = display name, "Your role: …" and the tabs `Repositories`,
  `People`, `Teams` as *links* under `nav[aria-label="Organization"]`; an Owner sees `Add member` (`Username or email`, `Role`), `Member menu <username>` →
  `Remove from organization`, `New team` (`Team name`, `Description`, `Parent team`, `Create team`) and `TeamMembersSection.tsx` with `Add member`,
  `Remove <username>`, a native `Parent team` select and `Save`. Settings → `Manage access` (REQ-2-3) hides its grant rows while the picker is open, leaving the
  `Search` textbox, the `Role` combobox and `Add`. `src/auth/` mirrors the session (`AuthProvider`, `SignInRequired`); `src/lib/` holds one module per API
  (`api.ts` exports `ApiError`/`readErrorFields`), `src/ui/` the primitives and `src/pages|pull|repository|issue|organization/` the views, `store-*.mjs` the records.

## Scenario preparation

- REQ-1 … REQ-6 share one initial state: an anonymous session plus the seeds above. A visitor reads the public repositories and their pull requests; signing in as
  `alice-dev` through `#/signin` adds the private repositories, the organization, the pull-request creation flow and every issue control (owning a repository makes
  her its Admin). `bob-reviewer` holds `read` on `acme-demo/acme-internal` and no role on `alice-dev/acme-docs` (seeded Write collaborator `carol-dev`); a
  `write`/`triage` grant is prepared through `POST …/access` (Settings → `Manage access`).
- The seeded pull requests occupy the `feature-search → main` pair and `3 Draft onboarding update` the `draft-feature → main` pair, so a creation scenario uses
  another valid pair (`base=release&compare=main`; the reverse has no comparable commits) as `carol-dev` or `alice-dev`; the branch-protection rule is created by
  `alice-dev` first. The REQ-2-2-1 team cycle creates `child-team`, then `grandchild-team`; REQ-2-2-2 adds `bob-reviewer` to the seeded empty `frontend-team`.
