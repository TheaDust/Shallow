# Architecture Notes

Stable facts and conventions for the GitHub Collaboration Platform.

## Entry points & runtime contract

- Backend: `backend/src/server.js` — zero-dependency Node http (`npm --prefix backend run start`).
  Both `backend/package-lock.json` and `frontend/package-lock.json` are committed so a clean
  checkout's `npm install` never mutates the candidate tree.
  - Reads `PORT` (default 3000); additionally binds 3301 with its own `http.createServer(handler)`
    instance per port; skipped when `ARC_EXTRA_PORTS=0`. Binds all interfaces.
  - Health: `GET /health` and `GET /api/health` return `{"status":"ok"}`.
  - Serves frontend build from `frontend/dist` (resolved relative to the server file, not cwd);
    `GET /` → index.html. Any unknown path or API returns 404 and the process keeps running.
  - Persistence: JSON store in `SHALLOW_DATA_DIR` (fallback `backend/data/`, gitignored).
    Writes are atomic (tmp file + rename). Seeds are provisioned only when the store is empty,
    so user modifications survive restarts.
- Frontend: React 18 + Vite + TypeScript (`npm --prefix frontend run build`; `npm --prefix frontend run test`).
  - Hand-written hash router (`src/router.ts`): routes `#/` (home/workspace), `#/signin`,
    `#/signup`, `#/forgot-password`. Navigation is via links with href; actions via buttons.
  - All backend calls are same-origin relative paths (`src/api.ts`); no host/port in the build.
  - Single `<main>` per page (rendered by `App`); account menu lives in the topbar when signed in.

## Shared domain model (backend store: `db.json` collections)

- `accounts`: id, username (unique), email (unique, stored trimmed+lowercased), emailVerified
  (always true for registrations/seeds), status (`active`), salt + passwordHash (scrypt),
  createdAt. Passwords are never echoed by any page/API.
- `sessions`: id (cookie `session_id`, HttpOnly), accountId, active, createdAt.
  Sign-out and password changes invalidate sessions immediately.
- Future modules (organizations, teams, memberships, repos, issues, PRs) add collections to the
  same store with stable uuid ids and scoped permission checks server-side.

## Seed data (provisioned once into an empty store)

- Account `alice-dev` / `alice.dev@example.test` / `Valid-password-123!`, verified + active.

## API surface

- `GET /api/session` → `{user:{id,username,email}|null}` (from cookie).
- `POST /api/auth/register` → 200 `{ok:true}` | 422 `{ok:false,fieldErrors}`.
- `POST /api/auth/signin` → 200 `{ok:true,user}` + Set-Cookie | 401 `{message:"Invalid credentials"}`
  (unknown identifier, wrong password, and unavailable account are indistinguishable).
- `POST /api/auth/signout` → invalidates the cookie's session.
- `POST /api/auth/change-password` → 200 | 401 (no session) | 422 fieldErrors
  (`Current password is required`, `Current password is incorrect`,
  `Password requirements are not satisfied`, `Password confirmation does not
  match`). Requires the session's account; success updates the password and
  invalidates that account's sessions.
- `POST /api/auth/recover-request` → always `{ok:true,code:"123456"}` (no existence disclosure).
- `POST /api/auth/recover-reset` → 200 | 422 fieldErrors (`Verification code is invalid`,
  `Email is not registered`, password rules, confirmation mismatch).

## Validation rules (backend `src/validation.js`; authoritative server-side)

- Username: 1–39 chars, `^[a-z0-9]+(-[a-z0-9]+)*$` (lowercase ASCII, single hyphens, no
  leading/trailing hyphen).
- Email: after trim ≤254 chars, exactly one `@`, at least one dot and all non-empty labels
  after `@` (local part may be empty, e.g. `@example.test`).
- Password: 12–128 chars, ≥1 upper, ≥1 lower, ≥1 digit, ≥1 non-alphanumeric, no whitespace.

## Field error messages (exact UI strings)

Registration: `Username already exists` | `Username format is invalid` | `Email already exists`
| `Email format is invalid` | `Password requirements are not satisfied` |
`Password confirmation does not match` | `Agree to terms is required`. Multiple errors are
shown together; username/email retained, password fields cleared. Sign-in failure: exactly
`Invalid credentials`. Recovery success: `Password updated`.

## Account-access page conventions

- Sign-in page contains links `Create an account` (→ `#/signup`) and `Forgot password`
  (→ `#/forgot-password`); home page links `Sign up`, `Sign in`, `Forgot password`.
- Registration success → `#/signin?created=1` shows status `Registration successful`.
- Signed-in users are redirected from `#/signin` and `#/signup` to `#/`; the recovery
  page `#/forgot-password` stays reachable from any session state (REQ-1-1-3 scenario
  signs in first).
- Account menu (`Account menu` button) shows the username plus `Settings`
  (→ `#/settings`) and exactly one `Sign out` link; the `Sign out` dialog has
  `Confirm sign out` and `Cancel` and explains sign-out affects only the current
  browser session.
- Settings routes: `#/settings` (Settings page, `Password and authentication` link)
  and `#/settings/password-and-authentication` (security form with `Current password`,
  `New password`, `Confirm password`, button `Update password`; success status
  `Password updated`). Both redirect signed-out visitors to `#/`.
