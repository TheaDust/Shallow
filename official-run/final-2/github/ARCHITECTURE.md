# ARCHITECTURE

React 18 + Vite + TypeScript frontend with hash routing, and a zero-dependency Node HTTP backend serving
a same-origin `/api` JSON API plus the built frontend. Implemented: identity/session (REQ-1),
organizations/teams/access, creation, forking, visibility, search, archive/restore (REQ-2, REQ-3), code
browsing, history, diffs, search, branches, the web editor, releases (REQ-4), issues incl. reactions
(REQ-5), branch protection and pull requests (REQ-6).

## 修改入口

- `backend/src/app.mjs` — `createRequestHandler`: API routing, cookies, static serving, 404 fallback.
  `server.mjs` — `PORT` (default 3000) plus extra ports unless `ARC_EXTRA_PORTS=0`, `SHALLOW_DATA_DIR`,
  one `createServer` per port.
- `backend/src/lib/auth-rules.mjs` — exact `MESSAGES` and validators; `auth-store.mjs` — `SEED_ACCOUNTS`,
  `EVOLUTION_SEED_PASSWORD`, `SEED_SESSIONS`, scrypt credentials and sessions;
  `account-session-routes.mjs` — `/api/account/sessions*`.
- `backend/src/lib/org-seeds.mjs` — `createSeedState()`: every predefined organization, team, membership,
  repository, branch, commit, grant, label, milestone, issue, reaction and release. `org-store.mjs` — the
  `createJsonStore` state plus the permission checks, creation/fork/visibility/archive, branch and file
  commits, code readers and the protection rules; it spreads the issue, pull-request, audit and release
  stores, so all of them share one writer.
- `backend/src/lib/org-rules.mjs` — `*_MESSAGES`, the role lists, validators,
  `normalizeOrganizationName`; `org-routes.mjs` — `/api/organizations*`, one audit event per accepted
  action, delegates the repository sub-APIs (`repository-code-*`, `repository-write-routes`, `issue-*`,
  `release-*`, `pull-request-*`, `text-diff`).
- `backend/src/lib/issue-store.mjs` — issue/comment/timeline/reaction persistence and the label/milestone
  readers; `issue-routes.mjs` + `issue-rules.mjs` — the `.../issues` surface, `ISSUE_MESSAGES` and
  `ISSUE_REACTION_TYPES`.
- `frontend/src/lib/` — `routes.ts` (`parseRoute`, hash builders, `routeRepository`), `hash-route.ts`
  (navigation bridge), `api.ts`, `session.tsx`, `auth-api.ts`, `org-api.ts`; `App.tsx` dispatch.
  `frontend/src/components/` + `pages/` hold one file per view (REQ-5: `RepositoryIssuesPage`,
  `RepositoryIssuePage`; other pages are named after their feature).
- Tests: `backend/test/*.test.mjs` and `frontend/src/pages/*.test.tsx`; the fakes in `frontend/src/test/`
  mirror the server rules, seeds and payload shapes, so a payload change has to be mirrored there.

## 关键约束

- Trusted boundary: the API route modules re-validate every rule; the UI only mirrors `fieldErrors`;
  requests are same-origin `fetch` with cookies.
- Session = HttpOnly `shallow_session` cookie holding a server-side id; `getSessionAccount` is the only
  reader and `GET /api/session` answers `{user, revoked}` (`revoked` = the cookie maps to no active
  session, since sign-out clears the cookie). `App` then renders sign-in with `replace("#/sign-in")`; a
  401 in a signed-in area emits `UNAUTHORIZED_EVENT`; a failed sign-in is
  `401 {message:"Invalid credentials"}` without cookie.
- Account rules: username 1–39 lowercase alphanumerics with *single* `-`/`_` separators, never at an edge
  or doubled; email trimmed ≤254 with one `@` and a dotted domain, matched case-insensitively (username
  exactly); passwords are scrypt hash+salt and validation collects every field error in one pass.
- `readAllowed` — organization/workspace lists, repository detail and every code, issue and release view:
  public is readable by anyone, private only by an organization Owner, a direct account grant or a member
  of a granted team (membership alone grants nothing); archived keeps the rule.
- Search (REQ-3-1) matches a case-insensitive substring of the repository name or persisted description of
  that readable set (`GET /api/repositories?q=`). The header `role="search"` searchbox named "Search"
  searches repositories, or the current repository's code inside one; the query lives in the hash.
- Archived (REQ-3-5): stored `archived` is the only source of the overview marker and of `canWrite`;
  `PATCH .../archive` (`requireRepositoryAdmin`) writes only that flag, and while it is set
  `writeAllowed`/`triageAllowed`/`maintainAllowed` answer false while `manageAllowed` stays true (that is
  what lets the Admin restore). The settings confirmation navigates to the overview first and reports the
  outcome through `lib/repository-status.ts`.
- Branches are the unit of reading: `defaultBranch` applies when no branch is named and every code view
  carries the resolved `branch` + `defaultBranch`; the Code page writes its branch into `?branch=` once
  (only an address naming no branch is rewritten), so a reload restores the snapshot. A head holds the
  whole snapshot, the chain is walked through `parentCommitId`, commits are append-only and code search
  matches content lines only.
- `writeAllowed` is separate from read and manage: organization Owner, repository owner or a direct/team
  Write/Maintain/Admin grant may create branches, commits and releases, while Read/Triage only read (403
  from the write routes, while `GET .../branches` stays open with `canWrite`). `PATCH .../default-branch`
  needs `manageAllowed`; `POST .../files` appends one commit and moves the branch head in one
  `store.update`.
- Releases (REQ-4-5): repository + exact tag (unique inside the repository only), title, description, one
  existing target branch; publishing needs `writeAllowed`, and a taken tag answers
  `400 {message:"Tag already exists", fieldErrors.tag}`, checked and written in one `store.update`.
- Pull requests and protection (REQ-6): a PR is repository + repository-scoped number with status
  Draft/Open/Closed/Merged (Merged terminal). Creating needs `writeAllowed`, transitions additionally
  accept the author, checks need `manageAllowed`, and `canMaintain` gates review and merge. A comment or
  review needs a signed-in non-author with `writeAllowed` on an Open PR, fixed to the compare commit.
  Merge re-reads `mergeStateOf`, enforces every enabled rule of the target's protection rule plus no
  conflict and no valid `Request changes`, and changes nothing on failure; rules are keyed by repository +
  exact branch name.
- Issues (repository + number, in `organizations.json`): list, detail and every view read the same record
  and status/keyword filters stay in the browser. create/edit/comment need `writeAllowed`;
  assign/label/milestone and status need `triageAllowed` (403 for a Write caller, `canTriage` hides the
  control); each metadata route writes only the carried field and appends its own timeline event in one
  `store.update`.
- Reactions (REQ-5-5): an `issueReactions` row is keyed by issue + account + type, so a repeated add stores
  nothing and a removal deletes only the caller's own row; reacting needs the signed-in read rule only
  (never a Write/Triage grant) and is refused while the repository is archived. The detail payload carries
  `canReact` and `reactions` aggregated per type (count > 0, canonical order) with a `reacted` flag for the
  reader; reactions never enter the timeline and never change the issue content or metadata.
- `BranchSelector` (overview and Code page): the unique button `Branch <branch>` opens a textbox
  `Find branch` plus `role=option` buttons with the exact branch names, filtered while typing; a writer
  also gets `Create branch: <name>`. `Add file` (Menu → `Create new file`) needs `canWrite`; the tab nav
  links `Code`, `Issues`, `Pull requests`, `Releases`, `Commits` and, with `canManage`, `Settings`.
- Creation: accounts create only in their personal namespace, organizations only as `Owner`, unique per
  (ownerType, ownerId, name); forking re-checks the source read rule and the target creation rule and
  deep-copies the default-branch commits. `removeOrganizationMember` is atomic (membership + team
  memberships + direct grants; team grants stay) and keeps at least one Owner. Identity keys are owner +
  parent + name; URLs use the owner's URL identifier, headings the display name.
- Audit log (REQ-2-4): `GET /api/organizations/:id/audit-log` is the only reader of the persisted
  `auditEvents`, gated by `requireOwner`; the filter is browser-only.
- Hash routing is the router; every view renders one `<main>` with `AppHeader`; unknown `/api/*`/static
  paths and non-GET statics return 404 JSON.

## 必要准备

- Data dir: `SHALLOW_DATA_DIR` (controller temp dir) or the local `backend/.data`, seeded only when empty
  (`auth.json`, `organizations.json`).
- Baseline (shared password `Valid-password-123!`): `acme-demo` with its four teams and members, plus
  `acme-docs` (public) and `secret-research`/`visibility-demo` (private);
  `repo-owner/acme-docs` and `fork-user/acme-docs-fork` stay private, so visitor search for `acme-docs`
  keeps one match. Entry points: home `Public organizations`/`Repositories`, or `Account menu` → workspace.
- Evolution accounts (`Evo-Password-987!`; email = username with `.` for `-`, `@evolution.test`):
  `evo-register-existing`, `evo-login-case`, `evo-session-owner(-s2/-s3)`, `evo-org-owner`,
  `evo-audit-owner`, `evo-audit-viewer`, `evo-archive-admin`, `evo-archive-viewer`, `evo-release-owner`,
  `evo-reaction-author`, `evo-reaction-user`; `SEED_SESSIONS` pre-provisions one placeholder session for
  `-s2`/`-s3`, dropped once a second real session exists.
- Evolution records: `evo-lab-02` (uppercase-duplicate organization), `evo-audit-org` (Owner, Member and
  the private `audit-demo` with its events); the public `acme-demo` repositories
  `evo-search-catalog-s1`/`evo-search-notebook-s2`, `evo-archive-repository-s1` (Active) with `-s2`/`-s3`
  (Archived), `evo-branch-switch-s1/-s2/-s3`, `evo-release-repository-s1` (empty, Write
  `evo-release-owner`), `-s2` (`evo-v0-1-s2`), `-s3` (`evo-v0-1-s3`, Write `evo-release-owner`) and
  `evo-reaction-repository-s1`; `acme-docs` history is `Initial commit` then `Document search flow`.
- REQ-5 (`acme-docs`): issues #1-#11 (one isolated mutation each), labels `bug`/`documentation`, milestone
  `v1.0`; Write `issue-author`/`issue-commenter`, Maintain `issue-editor`, Read `issue-viewer`.
- REQ-5-5: `evo-reaction-repository-s1` holds all three scenario issues — #1 `Evo reaction issue s1` and
  #2 `Evo reaction issue s2` start without any reaction, #3 `Evo reaction issue s3` already carries two
  `+1` rows of `alice-dev`/`org-owner`; any signed-in reader may toggle its own reaction, so neither
  reaction account needs a grant.
- REQ-6 (`acme-docs`): PRs #1-#13 (#6 Draft, #9 an approval plus `test` success) and one protection rule on
  `main`; Write `pr-contributor`/`draft-author`/`pr-reviewer`/`bob-reviewer`/`pr-author`, Maintain
  `pr-maintainer`, Read `pr-viewer`. `branch-protection-demo` keeps its rules empty (REQ-6-1 creates one);
  the branch/file seeds are `branch-switch-demo`, `default-branch-demo` and `file-management-demo` (Write
  `branch-contributor`/`file-contributor`, Admin `default-branch-admin`, none for `default-branch-viewer`).
