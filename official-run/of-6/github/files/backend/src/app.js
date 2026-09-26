'use strict';

const fs = require('fs');
const path = require('path');
const { createStore } = require('./store');
const {
  validateRegistration,
  validateRecoveryReset,
  validateChangePassword,
  validateOrganizationCreation,
  validateTeamCreation,
  validateTeamMemberAddition,
  validateMemberAddition,
  validateRepoAccessGrant,
  validateRepositoryCreation,
  validateBranchCreation,
  validateFileWrite,
  validateIssueCreation,
  validateIssueEdit,
  validateIssueComment,
  validateIssueReaction,
  validateInlineComment,
  validateBranchProtectionRule,
  validatePullRequestCreation,
  validatePullCheckStatus,
  validatePullReview,
} = require('./validation');

const SESSION_COOKIE = 'session';
const FIXED_VERIFICATION_CODE = '123456';
// REQ-4-3-2: roles allowed to create branches on repository code pages.
const BRANCH_WRITE_ROLES = new Set(['write', 'maintain', 'admin']);
// REQ-5-3-1: roles allowed to assign/unassign issue participants. This is
// the explicit module rule — Triage, Maintain, or Admin may assign; Write
// (which may create/edit/comment) and Read are NOT assignable.
const ASSIGN_ROLES = new Set(['triage', 'maintain', 'admin']);
// REQ-5-3-2: roles allowed to apply/remove labels. Same explicit module
// rule as assignment — Triage, Maintain, or Admin; Write and Read may only
// view labels.
const LABEL_ROLES = new Set(['triage', 'maintain', 'admin']);
// REQ-5-3-3: roles allowed to set/remove an issue's milestone. Same
// explicit module rule as assignment and labels — Triage, Maintain, or
// Admin; Write and Read may only view the current milestone.
const MILESTONE_ROLES = new Set(['triage', 'maintain', 'admin']);
// REQ-5-4: roles allowed to close or reopen an issue. Same explicit module
// rule — Triage, Maintain, or Admin may change the Open/Closed status from
// the issue detail view; Write and Read may only view the status.
const STATE_ROLES = new Set(['triage', 'maintain', 'admin']);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw === '') {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) {
      continue;
    }
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    cookies[name] = value;
  }
  return cookies;
}

function sendJson(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  const allHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  };
  res.writeHead(statusCode, allHeaders);
  res.end(body);
}

function setSessionCookie(res, sessionId) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function send404(res, message = 'Not found') {
  sendJson(res, 404, { error: message });
}

function isWithinDir(baseDir, target) {
  const relative = path.relative(baseDir, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Creates the shared request handler. distDir is the frontend build output;
 * paths are resolved relative to the backend's own location by the caller.
 */
function createApp({ dataDir, distDir }) {
  const store = createStore(dataDir);

  function currentAccount(req) {
    const sessionId = parseCookies(req)[SESSION_COOKIE];
    const current = sessionId ? store.getActiveSession(sessionId) : null;
    return current ? current.account : null;
  }

  function serializeRepository(repository) {
    return {
      name: repository.name,
      description: repository.description || '',
      visibility: repository.visibility,
      updatedAt: repository.updatedAt,
      createdAt: repository.createdAt,
    };
  }

  /**
   * REQ-5-1-1: serializes an issue row/detail for the list and the detail
   * page. Every record carries the persisted issue number, title, state,
   * author, body, label names, milestone (a pre-existing goal-classification
   * item of the repository), and timestamps. The body is included in list
   * rows too because the keyword filter matches title or body; filtering is
   * a display concern and never writes or deletes issues.
   */
  function serializeIssue(issue) {
    const author = store.findAccountById(issue.authorId);
    const milestone = issue.milestoneId
      ? store.findMilestoneById(issue.milestoneId)
      : null;
    return {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      author: author ? author.username : null,
      body: issue.body || '',
      labels: store.getIssueLabelNames(issue.id),
      milestone: milestone ? { title: milestone.title } : null,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      closedAt: issue.closedAt || null,
    };
  }

  /**
   * REQ-5-1-2: serializes the full read view of one issue for the detail
   * page: the same persisted record the list displays plus the discussion
   * data — the right-side Assignees metadata, the saved comments (author,
   * body, time), and the append-only activity timeline in chronological
   * order (creation, comments, and later events). REQ-5-2-3: every write to
   * these records must persist atomically with the issue itself; comments
   * carry their reaction groups and the issue carries its own reaction group
   * (each group shows the count and whether the given account reacted).
   */
  function serializeIssueDetail(issue, accountId) {
    return {
      ...serializeIssue(issue),
      assignees: store.getIssueAssignees(issue.id),
      comments: store.getIssueComments(issue.id).map((comment) => ({
        ...comment,
        reactions: store.getIssueReactionGroups(
          issue.id,
          'comment',
          comment.id,
          accountId || null
        ),
      })),
      activity: store.getIssueActivity(issue.id),
      reactions: store.getIssueReactionGroups(
        issue.id,
        'issue',
        issue.id,
        accountId || null
      ),
    };
  }

  /**
   * REQ-6-1: serializes one pull request row for the Pull requests list —
   * the persisted repository-scoped number, title, author, source/target
   * branches, and status (only Draft/Open/Closed/Merged). REQ-6-2-1 adds
   * the review status of the PR's current compare commit so the list page
   * can filter by review status without modifying PRs, branches, or
   * reviews. The list is read-only and never changes the PR or the
   * branches.
   */
  function serializePullRequestSummary(pullRequest) {
    const author = store.findAccountById(pullRequest.authorId);
    return {
      number: pullRequest.number,
      title: pullRequest.title,
      author: author ? author.username : null,
      status: pullRequest.status,
      baseBranch: pullRequest.baseBranch,
      compareBranch: pullRequest.compareBranch,
      reviewStatus: store.getPullRequestReviewStatus(pullRequest),
      createdAt: pullRequest.createdAt,
      updatedAt: pullRequest.updatedAt,
    };
  }

  /**
   * REQ-6-1: serializes the full detail view of one pull request for the
   * detail page: the list row plus the description, the creation-time and
   * current compare commits, the activity timeline, the ordinary discussion
   * comments and review summaries (REQ-6-3-1 Conversation), the commits on
   * the compare branch relative to base, the per-file line diff of the base
   * versus the current compare commit, the Checks area (the `test` status on
   * the current compare commit with its setter and time), and the merge
   * eligibility (a PR without 1 valid non-author approval, with any valid
   * Request changes, or with `test` not equal to success is unmergeable).
   * When the compare branch gains a new commit the current compare commit
   * starts with a pending `test` run, so success from the old commit can
   * never be used for merging.
   */
  function serializePullRequestDetail(pullRequest, accountId) {
    const author = store.findAccountById(pullRequest.authorId);
    const currentCompareCommitId =
      store.getPullRequestCurrentCompareCommit(pullRequest);
    let check = null;
    if (currentCompareCommitId !== null) {
      const run = store.ensurePullCheckRun(
        pullRequest.repositoryId,
        pullRequest.id,
        currentCompareCommitId
      );
      const setter = run.setterId
        ? store.findAccountById(run.setterId)
        : null;
      check = {
        status: run.status,
        setter: setter ? setter.username : null,
        updatedAt: run.updatedAt,
      };
    }
    const mergeEligibility = store.computePullRequestMergeEligibility(pullRequest);
    const commits = store
      .getPullRequestCommits(pullRequest)
      .map((commit) => ({
        id: commit.id,
        shortId: commit.id.slice(0, 7),
        message: commit.message,
        author: (store.findAccountById(commit.authorId) || {}).username || null,
        createdAt: commit.createdAt,
      }));
    let filesChanged = [];
    let additions = 0;
    let deletions = 0;
    if (currentCompareCommitId !== null) {
      const diff = store.getCommitDiff(
        pullRequest.repositoryId,
        pullRequest.baseCommitId,
        currentCompareCommitId
      );
      if (diff) {
        filesChanged = diff.files;
        additions = diff.additions;
        deletions = diff.deletions;
      }
    }
    return {
      ...serializePullRequestSummary(pullRequest),
      description: pullRequest.description || '',
      baseCommitId: pullRequest.baseCommitId,
      compareCommitId: pullRequest.compareCommitId,
      currentCompareCommitId,
      activity: store.getPullRequestActivity(pullRequest.id),
      // REQ-6-3-1: the Conversation view reads the PR's ordinary discussion
      // comments (author, body, time) and the review summaries (reviewer,
      // decision, explanation, compare commit, time). Both are read-only;
      // viewing never creates comments or reviews.
      comments: store.getPullRequestComments(pullRequest.id),
      // REQ-6-3-3: the inline review comments anchored to changed lines of
      // the Files changed view. Published comments are visible to every
      // viewer; a pending Start-a-review draft is visible only to its
      // author (it is not public until the review is submitted). A comment
      // whose compare commit differs from the current compare commit is
      // marked outdated.
      inlineComments: store.getPullRequestInlineComments(
        pullRequest.id,
        accountId,
        currentCompareCommitId
      ),
      // REQ-6-4: the pending-review request relationships of the PR — the
      // requested reviewers shown in the Reviewers area on the right side of
      // the detail page. A reviewer request is not the same as a submitted
      // review decision; the list is read-only for viewers and managed by
      // the author of an Open or Draft PR, Maintain, Admin, or the
      // organization Owner.
      reviewers: store.getPullRequestReviewerUsernames(pullRequest.id),
      reviews: store.getPullRequestReviewSummaries(pullRequest),
      commits,
      filesChanged,
      additions,
      deletions,
      checks: check ? { test: check } : {},
      mergeable: mergeEligibility.mergeable,
      blockedReasons: mergeEligibility.blockedReasons,
      // REQ-6-5: the per-condition satisfaction list shown by the merge
      // confirmation area (satisfied and unsatisfied conditions).
      mergeConditions: mergeEligibility.conditions,
      // REQ-6-5: the merger, the merge time, and the resulting merge commit
      // identifier, stored when the PR is merged (Merged is terminal).
      mergedBy: pullRequest.mergedById
        ? (store.findAccountById(pullRequest.mergedById) || {}).username || null
        : null,
      mergedAt: pullRequest.mergedAt || null,
      mergeCommitId: pullRequest.mergeCommitId || null,
      authorId: author ? author.id : null,
    };
  }

  /**
   * Resolves the visible owner name (organization identifier or account
   * username) of a repository, or null when the owner record is missing.
   */
  function repositoryOwnerName(repository) {
    if (repository.ownerType === 'organization') {
      const organization = store.findOrganizationById(repository.ownerId);
      return organization ? organization.name : null;
    }
    const account = store.findAccountById(repository.ownerId);
    return account ? account.username : null;
  }

  /**
   * REQ-2-3: resolves a repository and checks that the caller may manage its
   * access (organization Owner status or an effective repository Admin role).
   * Returns { repository } on success or { error, message } on failure.
   */
  function repoAdminContext(ownerName, repoName, account) {
    if (!account) {
      return { error: 401, message: 'Authentication required' };
    }
    const repository = store.findRepositoryByOwnerAndName(ownerName, repoName);
    if (!repository) {
      return { error: 404, message: 'Repository not found' };
    }
    const role = store.effectiveRepositoryRole(repository.id, account.id);
    if (role !== 'admin') {
      return { error: 403, message: 'Access denied' };
    }
    return { repository };
  }

  /**
   * REQ-2-3: resolves a subject name to its account/team id for the owning
   * organization, or null when the subject does not exist / does not belong.
   */
  function resolveRepoAccessSubject(repository, subjectType, subjectName) {
    if (repository.ownerType !== 'organization') {
      return null;
    }
    if (subjectType === 'user') {
      const account = store.findAccountByUsername(subjectName);
      if (!account || !store.isOrganizationMember(repository.ownerId, account.id)) {
        return null;
      }
      return account.id;
    }
    const team = store.findTeamByOrganizationAndName(repository.ownerId, subjectName);
    return team ? team.id : null;
  }

  /**
   * REQ-3-2-1: resolves a repository for read access using the same rule as
   * the overview page (public repositories are open, private repositories
   * require an effective role). Returns { repository, role } on success or
   * { error, message } on failure.
   */
  function repositoryReadContext(ownerName, repoName, account) {
    const repository = store.findRepositoryByOwnerAndName(ownerName, repoName);
    if (!repository) {
      return { error: 404, message: 'Repository not found' };
    }
    const role = store.effectiveRepositoryRole(
      repository.id,
      account ? account.id : null
    );
    if (repository.visibility !== 'public' && role === null) {
      return { error: 403, message: 'Access denied' };
    }
    return { repository, role };
  }

  /**
   * REQ-6-4: the permission rule for creating or deleting a pending-review
   * request relationship of a pull request — the PR author of an Open or
   * Draft PR, Maintain, Admin, or the organization Owner (an effective
   * repository Admin) may manage requests; Read, Triage, Write (when not the
   * author), and anonymous callers may not. The server enforces this on
   * every options/request/remove call; the frontend only renders the modify
   * controls for the same rule.
   */
  function canManagePullRequestReviewers(pullRequest, accountId, role) {
    if (!accountId || !pullRequest) {
      return false;
    }
    const isAuthor = pullRequest.authorId === accountId;
    const authorCanManage =
      isAuthor &&
      (pullRequest.status === 'open' || pullRequest.status === 'draft');
    return authorCanManage || role === 'maintain' || role === 'admin';
  }

  /**
   * REQ-4-2-1: serializes a commit for the history list and the commit detail
   * page. Every record references the stored commit identifier (short hash),
   * author, time, message, parent commits, and changed files. includeContent
   * adds the stored file content (used by the detail page); the history list
   * carries the changed file paths only.
   */
  function serializeCommit(commit, includeContent) {
    const author = store.findAccountById(commit.authorId);
    const parents = (commit.parentCommitIds || [])
      .map((parentId) => store.findCommitById(parentId))
      .filter(Boolean)
      .map((parent) => ({
        id: parent.id,
        shortId: parent.id.slice(0, 7),
        message: parent.message,
      }));
    const files = store.getFilesAtCommit(commit.id);
    if (includeContent) {
      // REQ-4-2-2: the commit detail is a read-only diff of this commit versus
      // its first parent (or an empty base for the root commit). Only changed
      // files appear; each carries the compare-side content, the per-file
      // added/deleted line counts and the ordered diff lines, and the base
      // revision identifier is exposed alongside the commit identifier.
      const parentId =
        commit.parentCommitIds && commit.parentCommitIds.length > 0
          ? commit.parentCommitIds[0]
          : null;
      const parent = parentId ? store.findCommitById(parentId) : null;
      const diff = store.getCommitDiff(commit.repositoryId, parentId, commit.id);
      return {
        id: commit.id,
        shortId: commit.id.slice(0, 7),
        message: commit.message,
        author: author ? author.username : null,
        createdAt: commit.createdAt,
        parents,
        base: parent
          ? {
              id: parent.id,
              shortId: parent.id.slice(0, 7),
              message: parent.message,
            }
          : null,
        files: diff ? diff.files : [],
        additions: diff ? diff.additions : 0,
        deletions: diff ? diff.deletions : 0,
      };
    }
    return {
      id: commit.id,
      shortId: commit.id.slice(0, 7),
      message: commit.message,
      author: author ? author.username : null,
      createdAt: commit.createdAt,
      parents,
      files: files.map((f) => f.path),
    };
  }

  async function handleApi(req, res, pathname, url) {
    const segments = pathname.split('/').filter(Boolean);

    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await readBody(req);
      const errors = validateRegistration(
        body,
        (username) => store.findAccountByUsername(username) !== null,
        (email) => store.findAccountByEmail(email) !== null
      );
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const account = store.createAccount({
        username: body.username,
        email: body.email,
        password: body.password,
      });
      sendJson(res, 201, {
        ok: true,
        username: account.username,
        email: account.email,
        emailVerified: account.emailVerified,
      });
      return;
    }

    if (pathname === '/api/auth/signin' && req.method === 'POST') {
      const body = await readBody(req);
      const identifier = typeof body.identifier === 'string' ? body.identifier : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const account =
        store.findAccountByUsername(identifier) ||
        store.findAccountByEmail(identifier.trim().toLowerCase());
      const valid =
        account !== null &&
        account.available === true &&
        store.verifyCredentials(account, password);
      if (!valid) {
        sendJson(res, 401, { ok: false, message: 'Invalid credentials' });
        return;
      }
      const session = store.createSession(account.id);
      setSessionCookie(res, session.id);
      sendJson(res, 200, {
        ok: true,
        username: account.username,
        email: account.email,
      });
      return;
    }

    if (pathname === '/api/auth/session' && req.method === 'GET') {
      const sessionId = parseCookies(req)[SESSION_COOKIE];
      const current = sessionId ? store.getActiveSession(sessionId) : null;
      if (!current) {
        sendJson(res, 200, { authenticated: false });
        return;
      }
      sendJson(res, 200, {
        authenticated: true,
        username: current.account.username,
        email: current.account.email,
      });
      return;
    }

    if (pathname === '/api/auth/signout' && req.method === 'POST') {
      const sessionId = parseCookies(req)[SESSION_COOKIE];
      if (sessionId) {
        store.invalidateSession(sessionId);
      }
      clearSessionCookie(res);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/auth/recovery/request' && req.method === 'POST') {
      // Both registered and unknown emails enter the same next step; no
      // account existence is disclosed here.
      const body = await readBody(req);
      sendJson(res, 200, {
        ok: true,
        code: FIXED_VERIFICATION_CODE,
      });
      return;
    }

    if (pathname === '/api/auth/recovery/reset' && req.method === 'POST') {
      const body = await readBody(req);
      const errors = validateRecoveryReset(
        body,
        (email) => store.findAccountByEmail(email) !== null
      );
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const account = store.findAccountByEmail(body.email);
      store.updatePassword(account.id, body.newPassword);
      sendJson(res, 200, { ok: true, message: 'Password updated' });
      return;
    }

    if (pathname === '/api/auth/change-password' && req.method === 'POST') {
      // REQ-1-3: only the signed-in account can change its own password; the
      // current password is verified against the session account's record.
      const sessionId = parseCookies(req)[SESSION_COOKIE];
      const current = sessionId ? store.getActiveSession(sessionId) : null;
      if (!current) {
        sendJson(res, 401, { ok: false, message: 'Authentication required' });
        return;
      }
      const body = await readBody(req);
      const errors = validateChangePassword(
        body,
        store.verifyCredentials(current.account, body.currentPassword)
      );
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      store.updatePassword(current.account.id, body.newPassword);
      sendJson(res, 200, { ok: true, message: 'Password updated' });
      return;
    }

    // ---- REQ-2-1 organization and repository browsing ----

    if (
      segments.length === 2 &&
      segments[0] === 'api' &&
      segments[1] === 'organizations' &&
      req.method === 'POST'
    ) {
      // REQ-2-1-2: signed-in accounts create organizations. The creator is
      // saved as initial owner (and member). Validation errors are returned
      // per field; the identifier must be globally unique.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { ok: false, message: 'Authentication required' });
        return;
      }
      const body = await readBody(req);
      const errors = validateOrganizationCreation(
        body,
        (name) => store.findOrganizationByName(name) !== null
      );
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const organization = store.createOrganization({
        name: body.name,
        displayName: body.displayName,
        creatorId: account.id,
      });
      sendJson(res, 201, {
        ok: true,
        organization: {
          name: organization.name,
          displayName: organization.displayName,
          createdAt: organization.createdAt,
        },
      });
      return;
    }

    if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'organizations' && req.method === 'GET') {
      // "Your organizations" list: only organizations the signed-in account
      // belongs to. Unauthenticated callers get 401 (the page is protected).
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { ok: false, message: 'Authentication required' });
        return;
      }
      const organizations = store.getOrganizationsForAccount(account.id).map((o) => ({
        name: o.name,
        displayName: o.displayName,
        role: store.getAccountRoleInOrganization(o.id, account.id),
      }));
      sendJson(res, 200, { ok: true, organizations });
      return;
    }

    if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'organizations' && req.method === 'GET') {
      // Public organization overview page (visitors may view public repos).
      // The signed-in account's organization role is included so the UI can
      // show Owner-only actions; it is null for visitors and non-members.
      const organization = store.findOrganizationByName(segments[2]);
      if (!organization) {
        sendJson(res, 404, { error: 'Organization not found' });
        return;
      }
      const account = currentAccount(req);
      const role = account
        ? store.getAccountRoleInOrganization(organization.id, account.id)
        : null;
      sendJson(res, 200, {
        ok: true,
        organization: {
          name: organization.name,
          displayName: organization.displayName,
          createdAt: organization.createdAt,
        },
        role,
      });
      return;
    }

    if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'organizations' && segments[3] === 'people' && req.method === 'POST') {
      // REQ-2-2-3: an organization Owner directly adds an existing account
      // (by username or verified email) as Member or Owner. The
      // "organization-account-role" membership relationship is stored
      // atomically; duplicates, unknown accounts, and unsupported roles are
      // rejected without changing the membership relationship.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { ok: false, message: 'Authentication required' });
        return;
      }
      const organization = store.findOrganizationByName(segments[2]);
      if (!organization) {
        sendJson(res, 404, { error: 'Organization not found' });
        return;
      }
      if (!store.isOrganizationOwner(organization.id, account.id)) {
        sendJson(res, 403, { ok: false, message: 'Access denied' });
        return;
      }
      const body = await readBody(req);
      const errors = validateMemberAddition(body, {
        findAccount: (identifier) => store.findAccountByIdentity(identifier),
        isMember: (accountId) => store.isOrganizationMember(organization.id, accountId),
      });
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const target = store.findAccountByIdentity(body.identifier);
      const role = body.role === 'owner' ? 'owner' : 'member';
      store.addOrganizationMember(organization.id, target.id, role);
      sendJson(res, 201, {
        ok: true,
        member: { username: target.username, role },
      });
      return;
    }

    if (segments.length === 5 && segments[0] === 'api' && segments[1] === 'organizations' && segments[3] === 'people' && req.method === 'DELETE') {
      // REQ-2-2-4: an organization Owner removes a member from the
      // organization. The removal atomically deletes the account's
      // organization membership, its team memberships in this organization,
      // and its direct grants on this organization's repositories; the
      // account itself, personal repositories, relationships with other
      // organizations, teams, and team grants are never touched. The last
      // Owner cannot be removed (rejected with all relationships unchanged).
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { ok: false, message: 'Authentication required' });
        return;
      }
      const organization = store.findOrganizationByName(segments[2]);
      if (!organization) {
        sendJson(res, 404, { error: 'Organization not found' });
        return;
      }
      if (!store.isOrganizationOwner(organization.id, account.id)) {
        sendJson(res, 403, { ok: false, message: 'Access denied' });
        return;
      }
      const target = store.findAccountByUsername(segments[4]);
      if (!target) {
        sendJson(res, 404, { error: 'Account not found' });
        return;
      }
      const outcome = store.removeOrganizationMember(organization.id, target.id);
      if (!outcome.removed && outcome.reason === 'last-owner') {
        sendJson(res, 400, {
          ok: false,
          message: 'The last organization Owner cannot be removed',
        });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'organizations' && segments[3] === 'teams' && req.method === 'POST') {
      // REQ-2-2-1: only an organization Owner may create teams. The team name
      // must be unique within the organization; an optional parent must belong
      // to the same organization.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { ok: false, message: 'Authentication required' });
        return;
      }
      const organization = store.findOrganizationByName(segments[2]);
      if (!organization) {
        sendJson(res, 404, { error: 'Organization not found' });
        return;
      }
      if (!store.isOrganizationOwner(organization.id, account.id)) {
        sendJson(res, 403, { ok: false, message: 'Access denied' });
        return;
      }
      const body = await readBody(req);
      const errors = validateTeamCreation(body, {
        isTeamNameTaken: (name) =>
          store.findTeamByOrganizationAndName(organization.id, name) !== null,
        isParentInOrganization: (parentName) =>
          store.findTeamByOrganizationAndName(organization.id, parentName) !== null,
      });
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const parentName = typeof body.parentTeamName === 'string' ? body.parentTeamName.trim() : '';
      const parent = parentName
        ? store.findTeamByOrganizationAndName(organization.id, parentName)
        : null;
      const team = store.createTeam({
        organizationId: organization.id,
        name: body.name,
        description: typeof body.description === 'string' ? body.description : '',
        parentTeamId: parent ? parent.id : null,
        creatorId: account.id,
      });
      sendJson(res, 201, {
        ok: true,
        team: {
          name: team.name,
          description: team.description || '',
          parentTeamName: parent ? parent.name : null,
          createdAt: team.createdAt,
        },
      });
      return;
    }

    if (segments.length === 5 && segments[0] === 'api' && segments[1] === 'organizations' && req.method === 'GET') {
      // Team detail page (public, like the organization overview). Includes
      // the ancestor chain so the team tree can render org -> parents -> team.
      const organization = store.findOrganizationByName(segments[2]);
      if (!organization) {
        sendJson(res, 404, { error: 'Organization not found' });
        return;
      }
      const team = store.findTeamByOrganizationAndName(organization.id, segments[4]);
      if (!team) {
        sendJson(res, 404, { error: 'Team not found' });
        return;
      }
      const parent = team.parentTeamId ? store.findTeamById(team.parentTeamId) : null;
      const creator = store.findAccountById(team.creatorId);
      sendJson(res, 200, {
        ok: true,
        team: {
          name: team.name,
          description: team.description || '',
          parentTeamName: parent ? parent.name : null,
          creator: creator ? creator.username : null,
          createdAt: team.createdAt,
          ancestorNames: store.getTeamAncestorNames(team.id),
          organization: {
            name: organization.name,
            displayName: organization.displayName,
          },
        },
      });
      return;
    }

    if (segments.length === 6 && segments[0] === 'api' && segments[1] === 'organizations' && segments[3] === 'teams' && segments[5] === 'members' && req.method === 'GET') {
      // Team Members tab: the team's direct members (no inherited members).
      const organization = store.findOrganizationByName(segments[2]);
      if (!organization) {
        sendJson(res, 404, { error: 'Organization not found' });
        return;
      }
      const team = store.findTeamByOrganizationAndName(organization.id, segments[4]);
      if (!team) {
        sendJson(res, 404, { error: 'Team not found' });
        return;
      }
      const members = store.getTeamDirectMembers(team.id).map((account) => ({
        username: account.username,
      }));
      sendJson(res, 200, { ok: true, members });
      return;
    }

    if (segments.length === 6 && segments[0] === 'api' && segments[1] === 'organizations' && segments[3] === 'teams' && segments[5] === 'members' && req.method === 'POST') {
      // REQ-2-2-2: an organization Owner adds a current organization member to
      // a team. The team-membership relationship is persisted atomically; a
      // non-member of the organization is rejected and nothing is stored.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { ok: false, message: 'Authentication required' });
        return;
      }
      const organization = store.findOrganizationByName(segments[2]);
      if (!organization) {
        sendJson(res, 404, { error: 'Organization not found' });
        return;
      }
      if (!store.isOrganizationOwner(organization.id, account.id)) {
        sendJson(res, 403, { ok: false, message: 'Access denied' });
        return;
      }
      const team = store.findTeamByOrganizationAndName(organization.id, segments[4]);
      if (!team) {
        sendJson(res, 404, { error: 'Team not found' });
        return;
      }
      const body = await readBody(req);
      const errors = validateTeamMemberAddition(body, (username) => {
        const target = store.findAccountByUsername(username);
        return target !== null && store.isOrganizationMember(organization.id, target.id);
      });
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const target = store.findAccountByUsername(body.username.trim());
      store.addTeamMember(team.id, organization.id, target.id);
      sendJson(res, 201, { ok: true, member: { username: target.username } });
      return;
    }

    if (segments.length === 7 && segments[0] === 'api' && segments[1] === 'organizations' && segments[3] === 'teams' && segments[5] === 'members' && req.method === 'DELETE') {
      // REQ-2-2-2: an organization Owner removes a direct team member without
      // any confirmation step; the relationship is deleted atomically. Only
      // this team's membership is touched (no org membership, grants, or
      // other teams).
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { ok: false, message: 'Authentication required' });
        return;
      }
      const organization = store.findOrganizationByName(segments[2]);
      if (!organization) {
        sendJson(res, 404, { error: 'Organization not found' });
        return;
      }
      if (!store.isOrganizationOwner(organization.id, account.id)) {
        sendJson(res, 403, { ok: false, message: 'Access denied' });
        return;
      }
      const team = store.findTeamByOrganizationAndName(organization.id, segments[4]);
      if (!team) {
        sendJson(res, 404, { error: 'Team not found' });
        return;
      }
      const target = store.findAccountByUsername(segments[6]);
      if (target) {
        store.removeTeamMember(team.id, target.id);
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (segments.length === 5 && segments[0] === 'api' && segments[1] === 'organizations' && req.method === 'PATCH') {
      // REQ-2-2-1 team Settings: change the parent team. Only the organization
      // Owner may maintain hierarchy; the parent must belong to the same
      // organization and must not create a direct or indirect cycle.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { ok: false, message: 'Authentication required' });
        return;
      }
      const organization = store.findOrganizationByName(segments[2]);
      if (!organization) {
        sendJson(res, 404, { error: 'Organization not found' });
        return;
      }
      if (!store.isOrganizationOwner(organization.id, account.id)) {
        sendJson(res, 403, { ok: false, message: 'Access denied' });
        return;
      }
      const team = store.findTeamByOrganizationAndName(organization.id, segments[4]);
      if (!team) {
        sendJson(res, 404, { error: 'Team not found' });
        return;
      }
      const body = await readBody(req);
      const parentName =
        typeof body.parentTeamName === 'string' ? body.parentTeamName.trim() : '';
      const parent = parentName
        ? store.findTeamByOrganizationAndName(organization.id, parentName)
        : null;
      if (parentName !== '' && !parent) {
        sendJson(res, 400, {
          ok: false,
          errors: { parentTeam: 'Parent team is not in this organization' },
        });
        return;
      }
      if (parent && store.wouldCreateTeamCycle(team.id, parent.id)) {
        sendJson(res, 400, {
          ok: false,
          errors: { parentTeam: 'Cyclic team hierarchy is not allowed' },
        });
        return;
      }
      store.updateTeamParent(team.id, parent ? parent.id : null);
      const updatedParent = parent ? parent.name : null;
      sendJson(res, 200, {
        ok: true,
        team: {
          name: team.name,
          description: team.description || '',
          parentTeamName: updatedParent,
          createdAt: team.createdAt,
        },
      });
      return;
    }

    if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'organizations' && req.method === 'GET') {
      const organization = store.findOrganizationByName(segments[2]);
      if (!organization) {
        sendJson(res, 404, { error: 'Organization not found' });
        return;
      }
      const account = currentAccount(req);
      const accountId = account ? account.id : null;
      if (segments[3] === 'repositories') {
        const repositories = store
          .getRepositoriesVisibleTo(organization.id, accountId)
          .map(serializeRepository);
        sendJson(res, 200, { ok: true, repositories });
        return;
      }
      if (segments[3] === 'people') {
        const members = store
          .getOrganizationMembers(organization.id)
          .map((m) => {
            const memberAccount = store.findAccountById(m.accountId);
            return {
              username: memberAccount ? memberAccount.username : null,
              role: m.role,
            };
          })
          .filter((m) => m.username !== null);
        sendJson(res, 200, { ok: true, members });
        return;
      }
      if (segments[3] === 'teams') {
        const teams = store.getOrganizationTeams(organization.id).map((t) => ({
          name: t.name,
          description: t.description || '',
          parentTeamName: t.parentTeamId
            ? (() => {
                const parent = store.getOrganizationTeams(organization.id).find((x) => x.id === t.parentTeamId);
                return parent ? parent.name : null;
              })()
            : null,
        }));
        sendJson(res, 200, { ok: true, teams });
        return;
      }
      send404(res);
      return;
    }

    if (
      segments.length === 3 &&
      segments[0] === 'api' &&
      segments[1] === 'search' &&
      segments[2] === 'repositories' &&
      req.method === 'GET'
    ) {
      // REQ-3-1: global repository search. The server is the single permission
      // filter: visitors see only public repositories and signed-in accounts
      // see every repository they are authorized to view (the same rule as
      // lists and direct links). An empty query yields no results.
      const query = url.searchParams.get('q') ?? '';
      const account = currentAccount(req);
      const accountId = account ? account.id : null;
      const repositories = store.searchRepositories(query, accountId).map((r) => ({
        owner: r.owner,
        ownerType: r.ownerType,
        name: r.name,
        description: r.description || '',
        visibility: r.visibility,
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
      }));
      sendJson(res, 200, { ok: true, repositories });
      return;
    }

    // ---- REQ-3-2-1 repository creation and personal repository list ----

    if (
      segments.length === 2 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      req.method === 'POST'
    ) {
      // REQ-3-2-1: a signed-in user creates a repository in a personal or
      // organization namespace. Personal namespaces are limited to the
      // signed-in account itself; organization namespaces require the
      // organization Owner role. The name must be unique in the target
      // namespace and the visibility must be public or private. When
      // initialization is requested, the repository, initial branch, README
      // file, and initial commit are persisted atomically.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { ok: false, message: 'Authentication required' });
        return;
      }
      const body = await readBody(req);
      const ownerName = typeof body.owner === 'string' ? body.owner.trim() : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const description =
        typeof body.description === 'string' ? body.description.trim() : '';
      const visibility =
        typeof body.visibility === 'string' ? body.visibility.trim() : '';
      const initialize = body.initialize === true;

      let ownerType = null;
      let ownerId = null;
      if (ownerName !== '') {
        const organization = store.findOrganizationByName(ownerName);
        if (organization) {
          if (!store.isOrganizationOwner(organization.id, account.id)) {
            sendJson(res, 403, {
              ok: false,
              errors: { owner: 'Access denied' },
            });
            return;
          }
          ownerType = 'organization';
          ownerId = organization.id;
        } else {
          const ownerAccount = store.findAccountByUsername(ownerName);
          if (ownerAccount) {
            if (ownerAccount.id !== account.id) {
              sendJson(res, 403, {
                ok: false,
                errors: { owner: 'Access denied' },
              });
              return;
            }
            ownerType = 'user';
            ownerId = ownerAccount.id;
          }
        }
      }

      const errors = validateRepositoryCreation(
        { owner: ownerName, name, visibility },
        {
          isNameTaken: (repoName) =>
            ownerType !== null &&
            store.findRepositoryByOwnerAndName(ownerName, repoName) !== null,
        }
      );
      if (ownerName !== '' && ownerType === null) {
        errors.owner = 'Owner not found';
      }
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }

      const repository = store.createRepository({
        ownerType,
        ownerId,
        name,
        description,
        visibility,
        creatorId: account.id,
        initialize,
      });
      const owner =
        ownerType === 'organization'
          ? ownerName
          : store.findAccountById(repository.ownerId).username;
      sendJson(res, 201, {
        ok: true,
        repository: {
          ...serializeRepository(repository),
          owner,
          ownerType,
          defaultBranch: repository.defaultBranch,
        },
      });
      return;
    }

    if (
      segments.length === 5 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'forks' &&
      req.method === 'POST'
    ) {
      // REQ-3-2-2: a signed-in user forks a readable source repository into a
      // personal or organization namespace where they may create repositories.
      // The server validates Read-or-higher access on the source, creation
      // permission in the target namespace, name uniqueness, and the
      // visibility rule (a private source can only be forked as Private). The
      // fork records the source-repository link and a copy of the accessible
      // default-branch history; every check runs before anything is stored,
      // so a rejected request leaves no fork behind.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { ok: false, message: 'Authentication required' });
        return;
      }
      const sourceCtx = repositoryReadContext(segments[2], segments[3], account);
      if (sourceCtx.error) {
        sendJson(res, sourceCtx.error, { error: sourceCtx.message });
        return;
      }
      const source = sourceCtx.repository;
      const body = await readBody(req);
      const ownerName = typeof body.owner === 'string' ? body.owner.trim() : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const description =
        typeof body.description === 'string' ? body.description.trim() : '';
      const visibility =
        typeof body.visibility === 'string' ? body.visibility.trim() : '';

      let ownerType = null;
      let ownerId = null;
      if (ownerName !== '') {
        const organization = store.findOrganizationByName(ownerName);
        if (organization) {
          if (!store.isOrganizationOwner(organization.id, account.id)) {
            sendJson(res, 403, {
              ok: false,
              errors: { owner: 'Access denied' },
            });
            return;
          }
          ownerType = 'organization';
          ownerId = organization.id;
        } else {
          const ownerAccount = store.findAccountByUsername(ownerName);
          if (ownerAccount) {
            if (ownerAccount.id !== account.id) {
              sendJson(res, 403, {
                ok: false,
                errors: { owner: 'Access denied' },
              });
              return;
            }
            ownerType = 'user';
            ownerId = ownerAccount.id;
          }
        }
      }

      const errors = validateRepositoryCreation(
        { owner: ownerName, name, visibility },
        {
          isNameTaken: (repoName) =>
            ownerType !== null &&
            store.findRepositoryByOwnerAndName(ownerName, repoName) !== null,
        }
      );
      if (ownerName !== '' && ownerType === null) {
        errors.owner = 'Owner not found';
      }
      if (source.visibility === 'private' && visibility === 'public') {
        errors.visibility = 'Visibility is invalid';
      }
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }

      const repository = store.createFork({
        sourceRepositoryId: source.id,
        ownerType,
        ownerId,
        name,
        description,
        visibility,
        creatorId: account.id,
      });
      const owner =
        ownerType === 'organization'
          ? ownerName
          : store.findAccountById(repository.ownerId).username;
      sendJson(res, 201, {
        ok: true,
        repository: {
          ...serializeRepository(repository),
          owner,
          ownerType,
          defaultBranch: repository.defaultBranch,
          forkedFrom: { owner: segments[2], name: segments[3] },
        },
      });
      return;
    }

    if (
      segments.length === 2 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      req.method === 'GET'
    ) {
      // Personal (user-owned) repository list: the owner defaults to the
      // signed-in account when the query parameter is omitted. Visibility
      // follows the same server-side rule as the organization list and
      // direct links (public to everyone, private only with an effective
      // role).
      const account = currentAccount(req);
      const accountId = account ? account.id : null;
      const rawOwner = url.searchParams.get('owner');
      const ownerName =
        rawOwner && rawOwner.trim() !== ''
          ? rawOwner.trim()
          : account
            ? account.username
            : '';
      if (ownerName === '') {
        sendJson(res, 200, { ok: true, repositories: [] });
        return;
      }
      if (!store.findAccountByUsername(ownerName)) {
        send404(res, 'User not found');
        return;
      }
      const repositories = store
        .getUserRepositoriesVisibleTo(ownerName, accountId)
        .map((r) => ({
          owner: ownerName,
          ownerType: 'user',
          name: r.name,
          description: r.description || '',
          visibility: r.visibility,
          updatedAt: r.updatedAt,
          createdAt: r.createdAt,
        }));
      sendJson(res, 200, { ok: true, repositories });
      return;
    }

    if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'repositories' && req.method === 'GET') {
      const repository = store.findRepositoryByOwnerAndName(segments[2], segments[3]);
      if (!repository) {
        sendJson(res, 404, { error: 'Repository not found' });
        return;
      }
      const account = currentAccount(req);
      const accountId = account ? account.id : null;
      const role = store.effectiveRepositoryRole(repository.id, accountId);
      if (repository.visibility !== 'public' && role === null) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const owner =
        repository.ownerType === 'organization'
          ? (store.findOrganizationById(repository.ownerId) || {}).name
          : (store.findAccountById(repository.ownerId) || {}).username;
      // REQ-3-2-2: a fork carries the source-repository link so the overview
      // page can render “Forked from <source repository name>” with a link.
      let forkedFrom = null;
      if (repository.sourceRepositoryId) {
        const sourceRepository = store.findRepositoryById(repository.sourceRepositoryId);
        if (sourceRepository) {
          const sourceOwner = repositoryOwnerName(sourceRepository);
          if (sourceOwner) {
            forkedFrom = { owner: sourceOwner, name: sourceRepository.name };
          }
        }
      }
      sendJson(res, 200, {
        ok: true,
        repository: {
          ...serializeRepository(repository),
          owner,
          ownerType: repository.ownerType,
          defaultBranch: repository.defaultBranch,
          role,
          forkedFrom,
        },
      });
      return;
    }

    if (
      segments.length === 5 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'issues' &&
      req.method === 'GET'
    ) {
      // REQ-5-1-1: the Issues list page reads every issue row of the current
      // repository under the same repository-view rule as the overview (public
      // repositories are open; private repositories require an effective
      // role). The response carries each issue's persisted number, title,
      // state, author, labels, milestone, body, and timestamps together with
      // the repository's label names (the label-filter options). The request
      // is read-only: filtering happens on the page and never creates or
      // modifies work items.
      const account = currentAccount(req);
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const issues = store
        .getRepositoryIssues(ctx.repository.id)
        .map((issue) => serializeIssue(issue));
      const labels = store.getRepositoryLabels(ctx.repository.id).map((l) => l.name);
      sendJson(res, 200, { ok: true, issues, labels, role: ctx.role });
      return;
    }

    if (
      segments.length === 5 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'issues' &&
      req.method === 'POST'
    ) {
      // REQ-5-2-1: creates a repository issue. Only Write, Maintain, Admin,
      // or organization Owner may submit (Read and Triage only view;
      // unauthenticated callers get 401). The server trims the title and
      // description, validates the 1-256 title / 0-65536 description rules,
      // assigns the next incrementing repository-scoped number, and stores
      // the issue plus its `created` activity in one atomic write, so a
      // rejected or failed submission allocates no number and persists no
      // partial data. A successful submission returns the full detail record
      // so the page can open the new issue by its number.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      if (!BRANCH_WRITE_ROLES.has(ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const body = await readBody(req);
      const errors = validateIssueCreation(body);
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      let issue;
      try {
        issue = store.createIssue(
          ctx.repository.id,
          {
            title: typeof body.title === 'string' ? body.title : '',
            body: typeof body.body === 'string' ? body.body : '',
          },
          account.id
        );
      } catch (err) {
        sendJson(res, 500, { error: 'The issue could not be saved' });
        return;
      }
      sendJson(res, 201, { ok: true, issue: serializeIssueDetail(issue, account.id) });
      return;
    }

    if (
      segments.length === 6 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'issues' &&
      req.method === 'GET'
    ) {
      // REQ-5-1-1/REQ-5-1-2: the issue detail page of one persisted issue
      // number in the current repository (same repository-view rule; the
      // number is unique within the repository). The payload is the complete
      // read view: the record the list displays plus the discussion data
      // (assignees, comments, activity timeline). An unknown number is a 404
      // so the page can show that the issue does not exist. REQ-5-2-2: the
      // response also carries the caller's effective repository role so the
      // detail page can gate its edit controls (Write/Maintain/Admin only).
      const account = currentAccount(req);
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const issue = store.findIssueByNumber(ctx.repository.id, segments[5]);
      if (!issue) {
        send404(res, 'Issue not found');
        return;
      }
      sendJson(res, 200, {
        ok: true,
        issue: serializeIssueDetail(issue, account ? account.id : null),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 7 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'issues' &&
      segments[6] === 'comments' &&
      req.method === 'POST'
    ) {
      // REQ-5-2-3: appends a discussion comment to the issue. Only a
      // signed-in user with Write, Maintain, or Admin may comment (Read and
      // Triage only view; unauthenticated callers get 401). The server
      // trims the text and validates the 1-65536 non-empty character rule
      // (blank/whitespace-only text reports the exact visible message
      // "Comment is required", over-long input "Comment is too long"), then
      // stores the comment (identifier, issue identifier, author, body,
      // creation time) together with its `commented` activity record in one
      // atomic write. A rejected or failed submission stores no comment and
      // appends no timeline record.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      if (!BRANCH_WRITE_ROLES.has(ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const issue = store.findIssueByNumber(ctx.repository.id, segments[5]);
      if (!issue) {
        send404(res, 'Issue not found');
        return;
      }
      const body = await readBody(req);
      const errors = validateIssueComment(body);
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      try {
        store.addIssueComment(issue.id, body.body, account.id);
      } catch (err) {
        sendJson(res, 500, { error: 'The comment could not be saved' });
        return;
      }
      sendJson(res, 201, {
        ok: true,
        issue: serializeIssueDetail(issue, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 7 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'issues' &&
      segments[6] === 'reactions' &&
      req.method === 'POST'
    ) {
      // REQ-5-2-3: toggles a reaction on the issue itself. Any signed-in
      // user who can view the issue may add or remove their own reaction:
      // for the same user, target, and reaction only one association is
      // stored, and selecting it a second time removes it. The target of
      // this route is the issue; the reaction type is stored verbatim.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const issue = store.findIssueByNumber(ctx.repository.id, segments[5]);
      if (!issue) {
        send404(res, 'Issue not found');
        return;
      }
      const body = await readBody(req);
      const errors = validateIssueReaction(body);
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      try {
        store.toggleIssueReaction(
          issue.id,
          'issue',
          issue.id,
          account.id,
          body.reaction.trim()
        );
      } catch (err) {
        sendJson(res, 500, { error: 'The reaction could not be saved' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        issue: serializeIssueDetail(issue, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 9 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'issues' &&
      segments[6] === 'comments' &&
      segments[8] === 'reactions' &&
      req.method === 'POST'
    ) {
      // REQ-5-2-3: toggles a reaction on one of the issue's comments. The
      // target is the stored comment; the same toggle rules as the issue
      // reaction apply. An unknown comment identifier is a 404.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const issue = store.findIssueByNumber(ctx.repository.id, segments[5]);
      if (!issue) {
        send404(res, 'Issue not found');
        return;
      }
      const comment = store.findIssueCommentById(decodeURIComponent(segments[7]));
      if (!comment) {
        send404(res, 'Comment not found');
        return;
      }
      const body = await readBody(req);
      const errors = validateIssueReaction(body);
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      try {
        store.toggleIssueReaction(
          issue.id,
          'comment',
          comment.id,
          account.id,
          body.reaction.trim()
        );
      } catch (err) {
        sendJson(res, 500, { error: 'The reaction could not be saved' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        issue: serializeIssueDetail(issue, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 6 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'issues' &&
      req.method === 'PATCH'
    ) {
      // REQ-5-2-2: edits the title and/or description of one persisted issue.
      // Only a signed-in user with Write, Maintain, or Admin may submit (Read
      // and Triage only view; unauthenticated callers get 401). Saving the
      // title and saving the description are separate actions, so only the
      // fields present in the payload are validated and changed. The server
      // trims and validates a provided title (1-256 non-empty characters) and
      // a provided description (at most 65536 characters), then stores the
      // editor, the edit time, and the new value and appends an `edited`
      // activity record in one atomic write. For an empty title, overlong
      // input, or a persistence failure the original value of the
      // corresponding field is retained and nothing is appended.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      if (!BRANCH_WRITE_ROLES.has(ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const issue = store.findIssueByNumber(ctx.repository.id, segments[5]);
      if (!issue) {
        send404(res, 'Issue not found');
        return;
      }
      const body = await readBody(req);
      const errors = validateIssueEdit(body);
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const hasTitle =
        body && Object.prototype.hasOwnProperty.call(body, 'title');
      const hasBody = body && Object.prototype.hasOwnProperty.call(body, 'body');
      if (!hasTitle && !hasBody) {
        // A no-op edit: nothing changed, nothing appended.
        sendJson(res, 200, {
          ok: true,
          issue: serializeIssueDetail(issue, account.id),
          role: ctx.role,
        });
        return;
      }
      let updated;
      try {
        updated = store.updateIssue(
          ctx.repository.id,
          issue.id,
          {
            title: hasTitle ? body.title : undefined,
            body: hasBody ? body.body : undefined,
          },
          account.id
        );
      } catch (err) {
        sendJson(res, 500, { error: 'The issue could not be saved' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        issue: serializeIssueDetail(updated, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 7 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'issues' &&
      segments[6] === 'state' &&
      req.method === 'POST'
    ) {
      // REQ-5-4: closes or reopens one persisted issue from the detail view.
      // Only a signed-in user with Triage, Maintain, or Admin may submit
      // (Write and Read may only view the status; unauthenticated callers
      // get 401, the others 403). The server trims and validates the
      // requested state, then stores the new status together with the
      // operator and the time and appends a `closed`/`reopened` activity
      // record in one atomic write. The transition never touches the title,
      // description, comments, labels, assignees, or milestone. Closing an
      // already-closed issue or reopening an already-open issue is a no-op.
      // A rejected or failed submission changes nothing.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      if (!STATE_ROLES.has(ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const issue = store.findIssueByNumber(ctx.repository.id, segments[5]);
      if (!issue) {
        send404(res, 'Issue not found');
        return;
      }
      const body = await readBody(req);
      const state =
        body && typeof body.state === 'string' ? body.state.trim() : '';
      if (state !== 'open' && state !== 'closed') {
        sendJson(res, 400, { error: 'State is invalid' });
        return;
      }
      let updated;
      try {
        updated = store.setIssueState(issue.id, state, account.id);
      } catch (err) {
        sendJson(res, 500, { error: 'The issue could not be saved' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        issue: serializeIssueDetail(updated, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 7 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'issues' &&
      segments[6] === 'assignees' &&
      req.method === 'GET'
    ) {
      // REQ-5-3-1: the assignee-options list of one issue. Only a signed-in
      // user with Triage, Maintain, or Admin may open the selector, so the
      // list is only served to those roles (unauthenticated callers get 401,
      // Read/Write/visitors 403). Assignable members are exactly the accounts
      // with an effective repository role of at least Triage — the server
      // filters so non-assignable users never appear in the results.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      if (!ASSIGN_ROLES.has(ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const issue = store.findIssueByNumber(ctx.repository.id, segments[5]);
      if (!issue) {
        send404(res, 'Issue not found');
        return;
      }
      sendJson(res, 200, {
        ok: true,
        assignable: store.getAssignableMemberUsernames(ctx.repository.id),
      });
      return;
    }

    if (
      segments.length === 8 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'issues' &&
      segments[6] === 'assignees' &&
      req.method === 'PUT'
    ) {
      // REQ-5-3-1: assigns one participant to an issue. Only a signed-in user
      // with Triage, Maintain, or Admin may submit (Read/Write/visitors get
      // 401/403); the target account must exist and be assignable (effective
      // repository role at least Triage, otherwise 400). The server stores
      // the issue-account relationship, the operator, and the time together
      // with an `assigned` activity record in one atomic write. Assigning an
      // already-assigned account is a no-op (no duplicate relationship, no
      // duplicate activity).
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      if (!ASSIGN_ROLES.has(ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const issue = store.findIssueByNumber(ctx.repository.id, segments[5]);
      if (!issue) {
        send404(res, 'Issue not found');
        return;
      }
      const assignee = store.findAccountByUsername(
        decodeURIComponent(segments[7])
      );
      if (!assignee) {
        send404(res, 'User not found');
        return;
      }
      const assigneeRole = store.effectiveRepositoryRole(
        ctx.repository.id,
        assignee.id
      );
      if (assigneeRole === null || !ASSIGN_ROLES.has(assigneeRole)) {
        sendJson(res, 400, { error: 'User is not assignable' });
        return;
      }
      let updated;
      try {
        updated = store.setIssueAssignee(issue.id, assignee.id, account.id);
      } catch (err) {
        sendJson(res, 500, { error: 'The assignment could not be saved' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        issue: serializeIssueDetail(updated, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 8 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'issues' &&
      segments[6] === 'assignees' &&
      req.method === 'DELETE'
    ) {
      // REQ-5-3-1: removes the issue-account assignment. Only a signed-in
      // user with Triage, Maintain, or Admin may submit; only the issue
      // relationship is deleted — the member account and its repository
      // grant stay untouched — together with an `unassigned` activity record
      // in one atomic write. Unassigning an account that is not assigned is
      // a no-op (no new activity).
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      if (!ASSIGN_ROLES.has(ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const issue = store.findIssueByNumber(ctx.repository.id, segments[5]);
      if (!issue) {
        send404(res, 'Issue not found');
        return;
      }
      const assignee = store.findAccountByUsername(
        decodeURIComponent(segments[7])
      );
      if (!assignee) {
        send404(res, 'User not found');
        return;
      }
      let updated;
      try {
        updated = store.removeIssueAssignee(issue.id, assignee.id, account.id);
      } catch (err) {
        sendJson(res, 500, { error: 'The assignment could not be saved' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        issue: serializeIssueDetail(updated, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 7 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'issues' &&
      segments[6] === 'labels' &&
      req.method === 'GET'
    ) {
      // REQ-5-3-2: the label-options list of one issue — the exact names of
      // the current repository's pre-existing labels (the only labels the
      // selector may offer). Only a signed-in user with Triage, Maintain, or
      // Admin may open the selector, so the list is only served to those
      // roles (unauthenticated callers get 401, Read/Write/visitors 403).
      // The list is repository-scoped: labels stored for any other
      // repository (even with the same name) never appear here.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      if (!LABEL_ROLES.has(ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const issue = store.findIssueByNumber(ctx.repository.id, segments[5]);
      if (!issue) {
        send404(res, 'Issue not found');
        return;
      }
      const labels = store
        .getRepositoryLabels(ctx.repository.id)
        .map((l) => l.name);
      sendJson(res, 200, { ok: true, labels });
      return;
    }

    if (
      segments.length === 8 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'issues' &&
      segments[6] === 'labels' &&
      req.method === 'PUT'
    ) {
      // REQ-5-3-2: applies one existing repository label to an issue. Only a
      // signed-in user with Triage, Maintain, or Admin may submit
      // (Read/Write/visitors get 401/403). The label must already exist in
      // the current repository — the server never creates a label and never
      // resolves a label stored for another repository, even when the names
      // match (unknown names are 404 and change nothing). The server stores
      // the issue-label relationship, the operator, and the time together
      // with a `labeled` activity record in one atomic write. Applying an
      // already-applied label is a no-op (no duplicate relationship, no
      // duplicate activity).
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      if (!LABEL_ROLES.has(ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const issue = store.findIssueByNumber(ctx.repository.id, segments[5]);
      if (!issue) {
        send404(res, 'Issue not found');
        return;
      }
      const label = store.findLabelByRepositoryAndName(
        ctx.repository.id,
        decodeURIComponent(segments[7])
      );
      if (!label) {
        send404(res, 'Label not found');
        return;
      }
      let updated;
      try {
        updated = store.setIssueLabel(issue.id, label.id, account.id);
      } catch (err) {
        sendJson(res, 500, { error: 'The label could not be saved' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        issue: serializeIssueDetail(updated, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 8 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'issues' &&
      segments[6] === 'labels' &&
      req.method === 'DELETE'
    ) {
      // REQ-5-3-2: removes the issue-label association. Only a signed-in user
      // with Triage, Maintain, or Admin may submit; only the issue
      // relationship is deleted — the label record stays in the repository —
      // together with an `unlabeled` activity record in one atomic write.
      // Removing a label that is not applied is a no-op (no new activity).
      // Unknown labels and unknown issues are 404 and change nothing.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      if (!LABEL_ROLES.has(ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const issue = store.findIssueByNumber(ctx.repository.id, segments[5]);
      if (!issue) {
        send404(res, 'Issue not found');
        return;
      }
      const label = store.findLabelByRepositoryAndName(
        ctx.repository.id,
        decodeURIComponent(segments[7])
      );
      if (!label) {
        send404(res, 'Label not found');
        return;
      }
      let updated;
      try {
        updated = store.removeIssueLabel(issue.id, label.id, account.id);
      } catch (err) {
        sendJson(res, 500, { error: 'The label could not be saved' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        issue: serializeIssueDetail(updated, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 7 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'issues' &&
      segments[6] === 'milestones' &&
      req.method === 'GET'
    ) {
      // REQ-5-3-3: the milestone-options list of one issue — the exact titles
      // of the current repository's pre-existing milestones (the only
      // milestones the picker may offer). Only a signed-in user with Triage,
      // Maintain, or Admin may open the picker, so the list is only served to
      // those roles (unauthenticated callers get 401, Read/Write/visitors
      // 403). The list is repository-scoped: a milestone stored for any other
      // repository never appears here.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      if (!MILESTONE_ROLES.has(ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const issue = store.findIssueByNumber(ctx.repository.id, segments[5]);
      if (!issue) {
        send404(res, 'Issue not found');
        return;
      }
      const milestones = store
        .getRepositoryMilestones(ctx.repository.id)
        .map((m) => m.title);
      sendJson(res, 200, { ok: true, milestones });
      return;
    }

    if (
      segments.length === 8 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'issues' &&
      segments[6] === 'milestones' &&
      req.method === 'PUT'
    ) {
      // REQ-5-3-3: associates an issue with one milestone of the current
      // repository. Only a signed-in user with Triage, Maintain, or Admin may
      // submit (Read/Write/visitors get 401/403). The milestone must already
      // exist in the current repository — the server never creates a
      // milestone and never resolves a milestone stored for another
      // repository, even when the titles match (unknown titles are 404 and
      // change nothing). At most one milestone per work item: selecting a
      // different milestone replaces the previous association. The server
      // stores the issue-milestone association, the operator, and the time
      // together with a `milestoned` activity record in one atomic write.
      // Setting the already-associated milestone is a no-op (no duplicate
      // activity).
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      if (!MILESTONE_ROLES.has(ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const issue = store.findIssueByNumber(ctx.repository.id, segments[5]);
      if (!issue) {
        send404(res, 'Issue not found');
        return;
      }
      const milestone = store.findMilestoneByRepositoryAndTitle(
        ctx.repository.id,
        decodeURIComponent(segments[7])
      );
      if (!milestone) {
        send404(res, 'Milestone not found');
        return;
      }
      let updated;
      try {
        updated = store.setIssueMilestone(issue.id, milestone.id, account.id);
      } catch (err) {
        sendJson(res, 500, { error: 'The milestone could not be saved' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        issue: serializeIssueDetail(updated, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 7 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'issues' &&
      segments[6] === 'milestones' &&
      req.method === 'DELETE'
    ) {
      // REQ-5-3-3: removes the issue-milestone association (the picker's
      // “None” selection). Only a signed-in user with Triage, Maintain, or
      // Admin may submit; only the association is deleted — the milestone
      // record stays in the repository — together with a `demilestoned`
      // activity record in one atomic write. Clearing an issue that has no
      // milestone is a no-op (no new activity). Unknown issues are 404 and
      // change nothing.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      if (!MILESTONE_ROLES.has(ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const issue = store.findIssueByNumber(ctx.repository.id, segments[5]);
      if (!issue) {
        send404(res, 'Issue not found');
        return;
      }
      let updated;
      try {
        updated = store.clearIssueMilestone(issue.id, account.id);
      } catch (err) {
        sendJson(res, 500, { error: 'The milestone could not be saved' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        issue: serializeIssueDetail(updated, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 5 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'pulls' &&
      req.method === 'GET'
    ) {
      // REQ-6-1/REQ-6-2-1: the Pull requests list page reads every pull
      // request row of the current repository under the same repository-view
      // rule as the overview (public repositories are open; private
      // repositories require an effective role). Each row carries the
      // persisted number, title, author, source/target branches, status, and
      // the review status of the current compare commit. The request is
      // read-only; the list page filters rows (status, author, review
      // status) in the browser only, never changing PRs, branches, or
      // reviews.
      const account = currentAccount(req);
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const pulls = store
        .getRepositoryPullRequests(ctx.repository.id)
        .map((pullRequest) => serializePullRequestSummary(pullRequest));
      sendJson(res, 200, { ok: true, pulls, role: ctx.role });
      return;
    }

    if (
      segments.length === 5 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'pulls' &&
      req.method === 'POST'
    ) {
      // REQ-6-2-3/REQ-6-2-4: creates a new pull request from a valid
      // comparison — `draft: true` stores the PR in Draft state, otherwise it
      // is created Open. Only a signed-in user with Write, Maintain, Admin,
      // or organization Owner status may create (unauthenticated 401, every
      // other role 403; Read and Triage may view existing PRs but not
      // create). The server re-validates the branches (distinct and
      // existing), the differences (comparable commits and changed files),
      // the duplicate-pair rule (a Draft or Open PR with the same
      // source/target pair blocks creation), and the title/description
      // rules, then stores the PR (repository-scoped number, source/target
      // branches, creation-time base/compare commits, title, description,
      // author, creation time, and status) together with its `created`
      // activity record in one atomic write. Every rejection creates no
      // record and allocates no number.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const repository = store.findRepositoryByOwnerAndName(
        segments[2],
        segments[3]
      );
      if (!repository) {
        send404(res, 'Repository not found');
        return;
      }
      const role = store.effectiveRepositoryRole(repository.id, account.id);
      if (!BRANCH_WRITE_ROLES.has(role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const body = await readBody(req);
      const errors = validatePullRequestCreation(body);
      const baseName =
        typeof body.base === 'string' ? body.base.trim() : '';
      const compareName =
        typeof body.compare === 'string' ? body.compare.trim() : '';
      if (baseName === '') {
        errors.base = 'Base branch is required';
      }
      if (compareName === '') {
        errors.compare = 'Compare branch is required';
      }
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const baseBranch = store.findBranchByRepositoryAndName(
        repository.id,
        baseName
      );
      const compareBranch = store.findBranchByRepositoryAndName(
        repository.id,
        compareName
      );
      if (!baseBranch) {
        errors.base = 'Branch not found';
      }
      if (!compareBranch) {
        errors.compare = 'Branch not found';
      }
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      if (baseName === compareName) {
        sendJson(res, 400, {
          ok: false,
          errors: { general: 'No changes' },
        });
        return;
      }
      const commits = store.getCommitsBetweenBranches(
        repository.id,
        baseName,
        compareName
      );
      const diff = store.getCommitDiff(
        repository.id,
        baseBranch.headCommitId,
        compareBranch.headCommitId
      );
      if (commits.length === 0 || diff.files.length === 0) {
        // The branches are the same or have no differences: nothing to merge.
        sendJson(res, 400, {
          ok: false,
          errors: { general: 'No changes' },
        });
        return;
      }
      const existingPair = store.findOpenOrDraftPullRequestByPair(
        repository.id,
        baseName,
        compareName
      );
      if (existingPair) {
        sendJson(res, 400, {
          ok: false,
          errors: {
            general: 'A pull request already exists for these branches',
          },
        });
        return;
      }
      let pullRequest;
      try {
        pullRequest = store.createPullRequest(
          repository.id,
          {
            title: body.title,
            description:
              typeof body.description === 'string' ? body.description : '',
            baseBranch: baseName,
            compareBranch: compareName,
            baseCommitId: baseBranch.headCommitId,
            compareCommitId: compareBranch.headCommitId,
          },
          account.id,
          // REQ-6-2-4: `draft: true` creates a Draft PR (same persisted
          // fields as a normal PR, status Draft; a draft cannot submit
          // reviews or be merged).
          body.draft === true ? 'draft' : 'open'
        );
      } catch (err) {
        sendJson(res, 500, { error: 'The pull request could not be saved' });
        return;
      }
      sendJson(res, 201, {
        ok: true,
        pull: serializePullRequestDetail(pullRequest, account.id),
        role,
      });
      return;
    }

    if (
      segments.length === 6 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'pulls' &&
      segments[5] === 'compare' &&
      req.method === 'GET'
    ) {
      // REQ-6-2-2: the read-only PR comparison page shown before creation.
      // base is the target branch that receives the merge result, compare is
      // the source branch that provides the changes; the system calculates
      // the comparable commits (commits on the compare branch relative to the
      // base branch) and the changed-file diff based on the commits the two
      // branches currently point to. Only a signed-in user with Write,
      // Maintain, Admin, or organization Owner status may enter the
      // creation-comparison flow: unauthenticated callers get 401 and Read /
      // Triage get 403 (they may view existing PRs but not compare). The
      // request is read-only: comparing never saves a PR, commit, or branch
      // change.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const repository = store.findRepositoryByOwnerAndName(
        segments[2],
        segments[3]
      );
      if (!repository) {
        send404(res, 'Repository not found');
        return;
      }
      const role = store.effectiveRepositoryRole(repository.id, account.id);
      if (!BRANCH_WRITE_ROLES.has(role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const rawBase = url.searchParams.get('base') ?? '';
      const rawCompare = url.searchParams.get('compare') ?? '';
      const baseName = rawBase.trim();
      const compareName = rawCompare.trim();
      const errors = {};
      if (baseName === '') {
        errors.base = 'Base branch is required';
      }
      if (compareName === '') {
        errors.compare = 'Compare branch is required';
      }
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const baseBranch = store.findBranchByRepositoryAndName(
        repository.id,
        baseName
      );
      const compareBranch = store.findBranchByRepositoryAndName(
        repository.id,
        compareName
      );
      if (!baseBranch) {
        errors.base = 'Branch not found';
      }
      if (!compareBranch) {
        errors.compare = 'Branch not found';
      }
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const commits = store
        .getCommitsBetweenBranches(repository.id, baseName, compareName)
        .map((commit) => ({
          id: commit.id,
          shortId: commit.id.slice(0, 7),
          message: commit.message,
          author: (store.findAccountById(commit.authorId) || {}).username || null,
          createdAt: commit.createdAt,
        }));
      const diff = store.getCommitDiff(
        repository.id,
        baseBranch.headCommitId,
        compareBranch.headCommitId
      );
      sendJson(res, 200, {
        ok: true,
        role,
        base: { name: baseName, headCommitId: baseBranch.headCommitId },
        compare: { name: compareName, headCommitId: compareBranch.headCommitId },
        commitCount: commits.length,
        commits,
        files: diff.files,
        additions: diff.additions,
        deletions: diff.deletions,
      });
      return;
    }

    if (
      segments.length === 6 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'pulls' &&
      req.method === 'GET'
    ) {
      // REQ-6-1: the pull request detail page of one persisted PR number in
      // the current repository (same repository-view rule; the number is
      // unique within the repository). The payload is the complete read view:
      // the row the list displays plus the description, activity, commits,
      // files changed, Checks area, and merge eligibility. An unknown number
      // is a 404 so the page can show that the PR does not exist.
      const account = currentAccount(req);
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const pullRequest = store.findPullRequestByNumber(
        ctx.repository.id,
        segments[5]
      );
      if (!pullRequest) {
        send404(res, 'Pull request not found');
        return;
      }
      sendJson(res, 200, {
        ok: true,
        pull: serializePullRequestDetail(
          pullRequest,
          account ? account.id : null
        ),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 7 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'pulls' &&
      segments[6] === 'checks' &&
      req.method === 'PATCH'
    ) {
      // REQ-6-1: only a repository Admin (or organization Owner) may update
      // the `test` status of the PR's Checks area from the PR detail page;
      // unauthenticated callers get 401 and every other role 403. The server
      // trims and validates the status (pending, success, or failure), then
      // stores it together with the setter and the time on the PR's current
      // compare commit in one atomic write; reloading preserves the result
      // for that compare commit, and a new compare commit starts pending.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repoAdminContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const pullRequest = store.findPullRequestByNumber(
        ctx.repository.id,
        segments[5]
      );
      if (!pullRequest) {
        send404(res, 'Pull request not found');
        return;
      }
      const body = await readBody(req);
      const errors = validatePullCheckStatus(body);
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const currentCompareCommitId =
        store.getPullRequestCurrentCompareCommit(pullRequest);
      if (currentCompareCommitId === null) {
        sendJson(res, 400, {
          ok: false,
          errors: { status: 'Compare branch not found' },
        });
        return;
      }
      let updated;
      try {
        updated = store.setPullCheckStatus(
          ctx.repository.id,
          pullRequest.id,
          currentCompareCommitId,
          body.status.trim(),
          account.id
        );
      } catch (err) {
        sendJson(res, 500, { error: 'The check could not be saved' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        pull: serializePullRequestDetail(pullRequest, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 7 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'pulls' &&
      segments[6] === 'ready-for-review' &&
      req.method === 'POST'
    ) {
      // REQ-6-2-4: marks a Draft pull request as ready for review,
      // transitioning the same PR's persisted status from Draft to Open and
      // appending a `ready_for_review` activity in one atomic write. Only the
      // PR author, Maintain, Admin, or the organization Owner (an effective
      // repository Admin) may use it; unauthenticated callers get 401 and
      // every other role 403. A PR that is not a Draft is rejected and stays
      // unchanged; the transition never changes the PR's branches, commits,
      // title, description, or number, and Open persists on reload.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const pullRequest = store.findPullRequestByNumber(
        ctx.repository.id,
        segments[5]
      );
      if (!pullRequest) {
        send404(res, 'Pull request not found');
        return;
      }
      const isAuthor = pullRequest.authorId === account.id;
      const canReadyForReview =
        isAuthor || ctx.role === 'maintain' || ctx.role === 'admin';
      if (!canReadyForReview) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      if (pullRequest.status !== 'draft') {
        sendJson(res, 400, {
          ok: false,
          errors: { general: 'Pull request is not a draft' },
        });
        return;
      }
      let updated;
      try {
        updated = store.markPullRequestReadyForReview(pullRequest, account.id);
      } catch (err) {
        sendJson(res, 500, { error: 'The pull request could not be saved' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        pull: serializePullRequestDetail(updated, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 7 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'pulls' &&
      segments[6] === 'state' &&
      req.method === 'POST'
    ) {
      // REQ-6-6: closes or reopens one unmerged pull request from the detail
      // page. Only the PR author, Maintain, Admin, or the organization
      // Owner (an effective repository role of maintain or admin) may
      // transition the status; unauthenticated callers get 401, Read /
      // Triage / Write non-authors and every other role 403 (for a viewer
      // who is neither author nor Maintain/Admin/Owner both controls are
      // absent, and the server rejects the request anyway). The server
      // trims and validates the requested state (only `open` or `closed`),
      // then stores the new status together with the operator and the time
      // and appends a `closed`/`reopened` activity record in one atomic
      // write. An unmerged Open or Draft PR may be closed; a Closed PR may
      // be reopened to Open. The transition never updates any branch, and
      // the discussion, reviews, and diff stay viewable. Closing an
      // already-closed PR or reopening an already-open PR is a no-op.
      // Merged is terminal — the server rejects every status change of a
      // merged PR.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const pullRequest = store.findPullRequestByNumber(
        ctx.repository.id,
        segments[5]
      );
      if (!pullRequest) {
        send404(res, 'Pull request not found');
        return;
      }
      const isAuthor = pullRequest.authorId === account.id;
      const canChangeStatus =
        isAuthor || ctx.role === 'maintain' || ctx.role === 'admin';
      if (!canChangeStatus) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const body = await readBody(req);
      const state =
        body && typeof body.state === 'string' ? body.state.trim() : '';
      if (state !== 'open' && state !== 'closed') {
        sendJson(res, 400, { error: 'State is invalid' });
        return;
      }
      if (pullRequest.status === 'merged') {
        // Merged is terminal: the page does not display close or reopen
        // operations for a merged PR and the server rejects status changes.
        sendJson(res, 400, { error: 'Pull request is merged' });
        return;
      }
      let updated;
      try {
        updated = store.setPullRequestStatus(pullRequest, state, account.id);
      } catch (err) {
        sendJson(res, 500, { error: 'The pull request could not be saved' });
        return;
      }
      if (!updated) {
        // No valid transition (e.g. a Draft cannot be reopened to Open via
        // the state endpoint — Draft -> Open is the Ready-for-review
        // transition): nothing changes.
        sendJson(res, 400, { error: 'State is invalid' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        pull: serializePullRequestDetail(updated, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 7 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'pulls' &&
      segments[6] === 'inline-comments' &&
      req.method === 'POST'
    ) {
      // REQ-6-3-3: adds an inline review comment anchored to a changed line
      // of the Files changed view. Only a signed-in user with Write,
      // Maintain, or Admin who is not the PR author may comment on an Open
      // PR (unauthenticated 401, other roles / the author 403, a non-open
      // PR 400). The server validates the body (1-65536 non-empty
      // characters), the file path (must be one of the current diff's
      // changed files), and the line position (must be an added or deleted
      // line of that file's current diff), then stores the comment — target
      // PR, file path, current compare commit, line position, author, body,
      // and publication state (`pending === true` keeps it as a
      // Start-a-review draft that is not public until the review is
      // submitted) — in one atomic write. A rejected or failed submission
      // creates no comment and never displays as published.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const pullRequest = store.findPullRequestByNumber(
        ctx.repository.id,
        segments[5]
      );
      if (!pullRequest) {
        send404(res, 'Pull request not found');
        return;
      }
      if (!BRANCH_WRITE_ROLES.has(ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      if (pullRequest.authorId === account.id) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      if (pullRequest.status !== 'open') {
        sendJson(res, 400, {
          ok: false,
          errors: { general: 'Pull request is not open' },
        });
        return;
      }
      const body = await readBody(req);
      const errors = validateInlineComment(body);
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const filePath =
        typeof body.filePath === 'string' ? body.filePath.trim() : '';
      const currentCompareCommitId =
        store.getPullRequestCurrentCompareCommit(pullRequest);
      if (currentCompareCommitId === null) {
        sendJson(res, 400, {
          ok: false,
          errors: { general: 'Compare branch not found' },
        });
        return;
      }
      const diff = store.getCommitDiff(
        ctx.repository.id,
        pullRequest.baseCommitId,
        currentCompareCommitId
      );
      const diffFile = diff.files.find((f) => f.path === filePath);
      if (!diffFile) {
        sendJson(res, 400, {
          ok: false,
          errors: { filePath: 'File is not part of the diff' },
        });
        return;
      }
      const rawLine = body.line;
      const line =
        typeof rawLine === 'number' && Number.isInteger(rawLine)
          ? rawLine
          : Number(rawLine);
      if (
        !Number.isInteger(line) ||
        line < 0 ||
        line >= diffFile.lines.length ||
        diffFile.lines[line].type === 'context'
      ) {
        sendJson(res, 400, {
          ok: false,
          errors: { line: 'Line is not a commentable line' },
        });
        return;
      }
      try {
        store.addPullRequestInlineComment(
          pullRequest.id,
          account.id,
          currentCompareCommitId,
          filePath,
          line,
          body.body,
          body.pending === true
        );
      } catch (err) {
        sendJson(res, 500, { error: 'The comment could not be saved' });
        return;
      }
      sendJson(res, 201, {
        ok: true,
        pull: serializePullRequestDetail(pullRequest, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 7 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'pulls' &&
      segments[6] === 'reviews' &&
      req.method === 'POST'
    ) {
      // REQ-6-3-4: submits one pull-request review decision (Comment,
      // Approve, or Request changes) with an optional Summary. Only a
      // signed-in user with Write, Maintain, or Admin who is not the PR
      // author may review an Open PR (unauthenticated 401, other roles / the
      // author 403, a non-open PR 400); Draft does not allow review
      // submission. The server validates the decision and the optional
      // explanation, then stores the review — decision, reviewer, current
      // compare commit, explanation, and time — in one atomic write. A new
      // decision by the same reviewer replaces that reviewer's effective
      // decision for the current compare commit while preserving the old
      // record in the timeline; submitting also publishes the reviewer's
      // pending Start-a-review inline comments. Approve counts for merge
      // eligibility only while the compare commit is unchanged (a new commit
      // makes the decision stale). A rejected or failed submission persists
      // nothing and never displays as published.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const pullRequest = store.findPullRequestByNumber(
        ctx.repository.id,
        segments[5]
      );
      if (!pullRequest) {
        send404(res, 'Pull request not found');
        return;
      }
      if (!BRANCH_WRITE_ROLES.has(ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      if (pullRequest.authorId === account.id) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      if (pullRequest.status !== 'open') {
        sendJson(res, 400, {
          ok: false,
          errors: { general: 'Pull request is not open' },
        });
        return;
      }
      const body = await readBody(req);
      const errors = validatePullReview(body);
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const currentCompareCommitId =
        store.getPullRequestCurrentCompareCommit(pullRequest);
      if (currentCompareCommitId === null) {
        sendJson(res, 400, {
          ok: false,
          errors: { general: 'Compare branch not found' },
        });
        return;
      }
      try {
        store.submitPullRequestReview(
          pullRequest.id,
          account.id,
          currentCompareCommitId,
          body.decision.trim(),
          body.explanation
        );
      } catch (err) {
        sendJson(res, 500, { error: 'The review could not be saved' });
        return;
      }
      sendJson(res, 201, {
        ok: true,
        pull: serializePullRequestDetail(pullRequest, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 7 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'pulls' &&
      segments[6] === 'merge' &&
      req.method === 'POST'
    ) {
      // REQ-6-5: merges an eligible pull request into its base branch using
      // the sole supported “Create a merge commit” method. Only Maintain,
      // Admin, or the organization Owner (an effective repository role of
      // maintain or admin) may merge from the PR detail page;
      // unauthenticated callers get 401 and every other role 403. The
      // server rereads the target branch head, the current compare commit,
      // the merge-conflict state, and the protection rules at confirmation
      // time: the PR must be Open, there must be no valid Request changes
      // decision, no merge conflicts, and each enabled branch-protection
      // requirement of the target branch is enforced independently (1 valid
      // non-author Approve for the current compare commit when approval is
      // required — a missing approval is reported verbatim as `Review
      // required by branch protection` — and `test` success when the status
      // check is required). Any unmet condition returns 400 with the
      // reasons and changes neither the target branch nor the PR; a failed
      // write returns 500 and rolls everything back. On success the PR is
      // persisted as Merged with the merger, time, and resulting commit
      // identifier, and the target-branch head moves to the new merge
      // commit (Merged is terminal).
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      if (ctx.role !== 'maintain' && ctx.role !== 'admin') {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const pullRequest = store.findPullRequestByNumber(
        ctx.repository.id,
        segments[5]
      );
      if (!pullRequest) {
        send404(res, 'Pull request not found');
        return;
      }
      // The confirmation carries no payload — “Create a merge commit” is
      // the only supported method, so there is nothing to validate. Drain
      // the body so keep-alive connections stay reusable.
      await readBody(req);
      let result;
      try {
        result = store.mergePullRequest(pullRequest, account.id);
      } catch (err) {
        sendJson(res, 500, { error: 'The pull request could not be merged' });
        return;
      }
      if (!result.ok) {
        sendJson(res, 400, { ok: false, reasons: result.reasons });
        return;
      }
      const merged = store.findPullRequestByNumber(
        ctx.repository.id,
        segments[5]
      );
      sendJson(res, 200, {
        ok: true,
        pull: serializePullRequestDetail(merged, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 7 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'pulls' &&
      segments[6] === 'reviewers' &&
      req.method === 'GET'
    ) {
      // REQ-6-4: the eligible reviewer candidates of one pull request for
      // the Reviewers picker. Only the PR author of an Open or Draft PR,
      // Maintain, Admin, or the organization Owner may manage requests, so
      // the options are only served to those roles (unauthenticated 401,
      // every other role 403). A candidate must have Write, Maintain, or
      // Admin on the repository and must not be the PR author; the server
      // filters the accounts. The request is read-only.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const pullRequest = store.findPullRequestByNumber(
        ctx.repository.id,
        segments[5]
      );
      if (!pullRequest) {
        send404(res, 'Pull request not found');
        return;
      }
      if (!canManagePullRequestReviewers(pullRequest, account.id, ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        eligible: store.getEligibleReviewerUsernames(
          ctx.repository.id,
          pullRequest
        ),
      });
      return;
    }

    if (
      segments.length === 8 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'pulls' &&
      segments[6] === 'reviewers' &&
      (req.method === 'PUT' || req.method === 'DELETE')
    ) {
      // REQ-6-4: creates or deletes one pending-review request relationship
      // between the pull request and the named reviewer. Only the PR author
      // of an Open or Draft PR, Maintain, Admin, or the organization Owner
      // may modify requests (unauthenticated 401, every other role 403; the
      // author of a Closed or Merged PR cannot). Creating requires the
      // reviewer to be a candidate — Write, Maintain, or Admin on the
      // repository and not the PR author (unknown accounts 404 `User not
      // found`, ineligible candidates 400 `User is not an eligible
      // reviewer`). Requesting stores the relationship together with the
      // operator and time in one atomic write; removing only deletes the
      // relationship and never touches reviews, comments, or activity
      // records already submitted by that user (the effective review
      // decision is unchanged). Removing a reviewer with no request is an
      // idempotent no-op. Both return the updated detail so the Reviewers
      // area reflects the request set immediately and after reload.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const pullRequest = store.findPullRequestByNumber(
        ctx.repository.id,
        segments[5]
      );
      if (!pullRequest) {
        send404(res, 'Pull request not found');
        return;
      }
      if (!canManagePullRequestReviewers(pullRequest, account.id, ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const reviewer = store.findAccountByUsername(segments[7]);
      if (!reviewer) {
        send404(res, 'User not found');
        return;
      }
      if (req.method === 'PUT') {
        const eligible = store
          .getEligibleReviewerUsernames(ctx.repository.id, pullRequest)
          .includes(reviewer.username);
        if (!eligible) {
          sendJson(res, 400, {
            ok: false,
            errors: { reviewer: 'User is not an eligible reviewer' },
          });
          return;
        }
        try {
          store.requestPullRequestReviewer(
            pullRequest.id,
            reviewer.id,
            account.id
          );
        } catch (err) {
          sendJson(res, 500, { error: 'The review request could not be saved' });
          return;
        }
      } else {
        try {
          store.removePullRequestReviewer(pullRequest.id, reviewer.id);
        } catch (err) {
          sendJson(res, 500, { error: 'The review request could not be saved' });
          return;
        }
      }
      sendJson(res, 200, {
        ok: true,
        pull: serializePullRequestDetail(pullRequest, account.id),
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 5 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'branch-protection' &&
      req.method === 'GET'
    ) {
      // REQ-6-1: the branch protection rules of a repository (Settings →
      // Branches). Only a repository Admin or organization Owner may manage
      // rules, so the list is only served to those roles (unauthenticated
      // 401, every other role 403). Each rule carries the exact branch name
      // and the two requirement toggles.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repoAdminContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const rules = store.getBranchProtectionRules(ctx.repository.id).map((rule) => ({
        branchName: rule.branchName,
        requireApproval: rule.requireApproval,
        requireStatusCheck: rule.requireStatusCheck,
        updatedAt: rule.updatedAt,
      }));
      sendJson(res, 200, { ok: true, rules });
      return;
    }

    if (
      segments.length === 5 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'branch-protection' &&
      req.method === 'POST'
    ) {
      // REQ-6-1: a repository Admin creates a branch protection rule bound to
      // one exact branch name (no wildcard semantics) with the two
      // independently selectable requirements. The branch must exist in the
      // repository; a rule for the same exact branch name cannot be created
      // twice (the existing rule uses “Save changes”). One atomic write; a
      // rejected or failed submission stores nothing and the branch stays
      // unprotected.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repoAdminContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const body = await readBody(req);
      const errors = validateBranchProtectionRule(body);
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const branchName =
        typeof body.branchName === 'string' ? body.branchName.trim() : '';
      const branch = store.findBranchByRepositoryAndName(
        ctx.repository.id,
        branchName
      );
      if (!branch) {
        sendJson(res, 400, {
          ok: false,
          errors: { branchName: 'Branch not found' },
        });
        return;
      }
      let rule;
      try {
        rule = store.createBranchProtectionRule({
          repositoryId: ctx.repository.id,
          branchName,
          requireApproval: body.requireApproval === true,
          requireStatusCheck: body.requireStatusCheck === true,
          creatorId: account.id,
        });
      } catch (err) {
        sendJson(res, 500, { error: 'The rule could not be saved' });
        return;
      }
      if (!rule) {
        sendJson(res, 400, {
          ok: false,
          errors: { branchName: 'Rule already exists' },
        });
        return;
      }
      sendJson(res, 201, {
        ok: true,
        rules: store.getBranchProtectionRules(ctx.repository.id).map((r) => ({
          branchName: r.branchName,
          requireApproval: r.requireApproval,
          requireStatusCheck: r.requireStatusCheck,
          updatedAt: r.updatedAt,
        })),
      });
      return;
    }

    if (
      segments.length === 6 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'branch-protection' &&
      req.method === 'PATCH'
    ) {
      // REQ-6-1: an existing rule's “Save changes” action updates the two
      // requirement toggles. Only a repository Admin or organization Owner
      // may submit; the rule must already exist for that exact branch name
      // (unknown rules are 404 and change nothing). One atomic write; a
      // rejected or failed submission leaves the stored rule unchanged.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repoAdminContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const branchName = decodeURIComponent(segments[5]);
      const rule = store.findBranchProtectionRule(
        ctx.repository.id,
        branchName
      );
      if (!rule) {
        send404(res, 'Rule not found');
        return;
      }
      const body = await readBody(req);
      const errors = validateBranchProtectionRule({
        branchName,
      });
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      let updated;
      try {
        updated = store.updateBranchProtectionRule(ctx.repository.id, branchName, {
          requireApproval: body.requireApproval === true,
          requireStatusCheck: body.requireStatusCheck === true,
        });
      } catch (err) {
        sendJson(res, 500, { error: 'The rule could not be saved' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        rules: store.getBranchProtectionRules(ctx.repository.id).map((r) => ({
          branchName: r.branchName,
          requireApproval: r.requireApproval,
          requireStatusCheck: r.requireStatusCheck,
          updatedAt: r.updatedAt,
        })),
      });
      return;
    }

    if (
      segments.length === 5 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'contents' &&
      req.method === 'GET'
    ) {
      // REQ-3-2-1: files reachable at the default branch head (used by the
      // overview page to show the README file link). Access follows the same
      // rule as the repository overview. REQ-4-1: an optional ?branch= query
      // selects another branch, and `entries` names each top-level entry
      // (directory or file) so the Code page can render directory links.
      const account = currentAccount(req);
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const rawBranch = url.searchParams.get('branch');
      const branchName =
        rawBranch && rawBranch.trim() !== ''
          ? rawBranch.trim()
          : ctx.repository.defaultBranch;
      const { branch, files } = store.getFilesForBranch(
        ctx.repository.id,
        branchName
      );
      const { entries } = store.getDirectoryEntries(ctx.repository.id, branchName, '');
      sendJson(res, 200, {
        ok: true,
        branch: branch
          ? { name: branch.name, headCommitId: branch.headCommitId }
          : null,
        files: files.map((f) => ({ path: f.path, content: f.content })),
        entries,
      });
      return;
    }

    if (
      segments.length === 5 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'branches' &&
      req.method === 'GET'
    ) {
      // REQ-4-3-1: the branch list used by the Code page branch selector.
      // Read permission follows the same rule as the file browser; the
      // default branch is listed first, then the remaining branches by name,
      // so the selector order is stable across reloads. Read-only: no branch
      // head or commit is ever changed here. REQ-4-3-2: `canCreate` tells the
      // selector whether the signed-in account may create branches (Write,
      // Maintain, Admin, or organization Owner status); Read/Triage/visitors
      // only browse and never see the create entry.
      const account = currentAccount(req);
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const branches = store.getBranches(ctx.repository.id);
      branches.sort((a, b) => {
        if (a.name === ctx.repository.defaultBranch) {
          return -1;
        }
        if (b.name === ctx.repository.defaultBranch) {
          return 1;
        }
        return a.name.localeCompare(b.name);
      });
      sendJson(res, 200, {
        ok: true,
        defaultBranch: ctx.repository.defaultBranch,
        canCreate: BRANCH_WRITE_ROLES.has(ctx.role),
        branches: branches.map((b) => ({
          name: b.name,
          headCommitId: b.headCommitId,
        })),
      });
      return;
    }

    if (
      segments.length === 5 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'branches' &&
      req.method === 'POST'
    ) {
      // REQ-4-3-2: a signed-in user with Write, Maintain, Admin, or
      // organization Owner status creates a branch at an existing revision.
      // The base defaults to the branch currently read by the Code page (the
      // frontend always sends the current branch); the new branch stores its
      // unique name, the base commit, the creator, and the creation time in
      // one atomic write. Duplicate names, invalid names, or missing
      // permission prevent the creation and never change any stored branch
      // or commit (creating a branch only adds a reference; it never rewrites
      // the base history or copies files).
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      // Read and Triage may only browse; branch creation requires Write,
      // Maintain, Admin, or organization Owner status (the Owner is already
      // reflected as Admin by effectiveRepositoryRole).
      if (!BRANCH_WRITE_ROLES.has(ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const body = await readBody(req);
      const name = typeof body.name === 'string' ? body.name : '';
      const baseName = typeof body.base === 'string' ? body.base : '';
      const errors = validateBranchCreation(
        { name },
        (candidate) =>
          store.findBranchByRepositoryAndName(ctx.repository.id, candidate) !==
          null
      );
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const baseBranchName =
        baseName === '' ? ctx.repository.defaultBranch : baseName;
      const baseBranch = store.findBranchByRepositoryAndName(
        ctx.repository.id,
        baseBranchName
      );
      if (!baseBranch) {
        sendJson(res, 400, {
          ok: false,
          errors: { base: 'Base branch not found' },
        });
        return;
      }
      const branch = store.createBranch(
        ctx.repository.id,
        name,
        baseBranch.headCommitId,
        account.id
      );
      if (!branch) {
        sendJson(res, 400, {
          ok: false,
          errors: { name: 'Branch already exists' },
        });
        return;
      }
      sendJson(res, 201, {
        ok: true,
        branch: { name: branch.name, headCommitId: branch.headCommitId },
      });
      return;
    }

    if (
      segments.length === 5 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'search' &&
      req.method === 'GET'
    ) {
      // REQ-4-2-3: repository-scoped code search. Only file content of the
      // current repository (its default branch snapshot) is searched, under
      // the same access rule as the Code page (public repositories are open,
      // private repositories require an effective role), so results can never
      // leak across repositories. An optional path prefix and language
      // restrict the hits. The search is read-only: no commit or file is
      // created or modified.
      const account = currentAccount(req);
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const query = url.searchParams.get('q') ?? '';
      const pathFilter = url.searchParams.get('path') ?? '';
      const language = url.searchParams.get('lang') ?? '';
      const branchName = ctx.repository.defaultBranch;
      const { branch, results } = store.searchCode(
        ctx.repository.id,
        branchName,
        query,
        pathFilter,
        language
      );
      sendJson(res, 200, {
        ok: true,
        repository: { owner: segments[2], name: segments[3] },
        branch: branch
          ? { name: branch.name, headCommitId: branch.headCommitId }
          : null,
        query,
        path: pathFilter,
        language,
        languages: store.languagesForBranch(ctx.repository.id, branchName),
        results,
      });
      return;
    }

    if (
      segments.length >= 6 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'tree' &&
      req.method === 'GET'
    ) {
      // REQ-4-1: directory listing at a branch path. The path is everything
      // after the branch segment ('' for the branch root). Only paths that
      // exist as a directory are returned; a file path or an unknown path is
      // a 404 so the page can show that the location is not available.
      const account = currentAccount(req);
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const branchName = decodeURIComponent(segments[5]);
      const dirPath = segments.slice(6).map(decodeURIComponent).join('/');
      const { branch, entries } = store.getDirectoryEntries(
        ctx.repository.id,
        branchName,
        dirPath
      );
      if (!branch) {
        send404(res, 'Branch not found');
        return;
      }
      if (dirPath !== '') {
        if (store.getRepositoryFile(ctx.repository.id, branchName, dirPath)) {
          send404(res, 'Path not found');
          return;
        }
        if (entries.length === 0) {
          send404(res, 'Path not found');
          return;
        }
      }
      sendJson(res, 200, {
        ok: true,
        branch: { name: branch.name, headCommitId: branch.headCommitId },
        path: dirPath,
        entries,
        // REQ-4-4: the Code page gates the "Add file" button on the signed-in
        // account's effective repository role (Write, Maintain, Admin, or
        // organization Owner); visitors and Read/Triage accounts only view.
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length >= 7 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'contents' &&
      req.method === 'GET'
    ) {
      // Single file content at a branch head (the file-content page). The
      // path is everything after the branch segment (may contain slashes).
      // REQ-4-1: the response also carries the most recent commit of that
      // file on the branch so the page can display it.
      const account = currentAccount(req);
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const branchName = decodeURIComponent(segments[5]);
      const filePath = segments.slice(6).map(decodeURIComponent).join('/');
      const file = store.getRepositoryFile(
        ctx.repository.id,
        branchName,
        filePath
      );
      if (!file) {
        send404(res, 'File not found');
        return;
      }
      const commit = store.getMostRecentFileCommit(
        ctx.repository.id,
        branchName,
        filePath
      );
      sendJson(res, 200, {
        ok: true,
        branch: branchName,
        file: { path: file.path, content: file.content },
        commit: commit
          ? {
              id: commit.id,
              message: commit.message,
              author: (store.findAccountById(commit.authorId) || {}).username || null,
              createdAt: commit.createdAt,
            }
          : null,
        // REQ-4-4: the file page gates its "Edit" entry on the effective
        // repository role (Write, Maintain, Admin, or organization Owner).
        role: ctx.role,
      });
      return;
    }

    if (
      segments.length === 5 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'contents' &&
      req.method === 'POST'
    ) {
      // REQ-4-4: the web file editor submits one file-path + content change
      // with a commit message on the current branch. Only Write, Maintain,
      // Admin, or organization Owner may submit (Read and Triage only view;
      // unauthenticated callers get 401). One indivisible record stores the
      // commit (parent = the previous branch head, author, message, time) and
      // moves the branch head to it; the path must be non-empty, not begin
      // with `/`, contain no `..` segment, and not conflict with an existing
      // file or directory on the branch, the message must contain 1-72
      // non-empty characters after trimming, and a protected branch or a
      // persistence failure rejects the whole submission without changing
      // the file, branch head, or commit history.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      if (!BRANCH_WRITE_ROLES.has(ctx.role)) {
        sendJson(res, 403, { error: 'Access denied' });
        return;
      }
      const body = await readBody(req);
      const branchName =
        typeof body.branch === 'string' && body.branch.trim() !== ''
          ? body.branch.trim()
          : ctx.repository.defaultBranch;
      const rawPath = typeof body.path === 'string' ? body.path : '';
      const filePath = rawPath.trim();
      const content = typeof body.content === 'string' ? body.content : '';
      const rawMessage = typeof body.message === 'string' ? body.message : '';
      const message = rawMessage.trim();
      const branch = store.findBranchByRepositoryAndName(
        ctx.repository.id,
        branchName
      );
      const errors = validateFileWrite(
        { path: filePath, message },
        {
          isPathConflict: (candidate) => {
            if (!branch || !branch.headCommitId) {
              return false;
            }
            const headFiles = store.getFilesAtCommit(branch.headCommitId);
            return (
              headFiles.some((f) => f.path === candidate) ||
              // the target path is an existing directory (files under it)
              headFiles.some((f) => f.path.startsWith(`${candidate}/`)) ||
              // an existing file blocks using its path as a directory
              headFiles.some((f) => candidate.startsWith(`${f.path}/`))
            );
          },
        }
      );
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      if (!branch) {
        sendJson(res, 400, {
          ok: false,
          errors: { branch: 'Branch not found' },
        });
        return;
      }
      if (store.isBranchProtected(ctx.repository.id, branchName)) {
        sendJson(res, 400, {
          ok: false,
          errors: { branch: 'Branch is protected' },
        });
        return;
      }
      let commit;
      try {
        commit = store.createFileCommit(
          ctx.repository.id,
          branchName,
          filePath,
          content,
          message,
          account.id
        );
      } catch (err) {
        sendJson(res, 500, {
          ok: false,
          error: 'The file could not be saved',
        });
        return;
      }
      if (!commit) {
        sendJson(res, 400, {
          ok: false,
          errors: { branch: 'Branch not found' },
        });
        return;
      }
      sendJson(res, 201, {
        ok: true,
        branch: { name: branchName, headCommitId: commit.id },
        commit: {
          id: commit.id,
          shortId: commit.id.slice(0, 7),
          message: commit.message,
          author: account.username,
          createdAt: commit.createdAt,
        },
        file: { path: filePath, content },
      });
      return;
    }

    if (
      segments.length === 5 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'commits' &&
      req.method === 'GET'
    ) {
      // REQ-4-2-1: commit history of a branch (the default branch unless an
      // explicit branch is requested via ?branch=) or of a single file path
      // on that branch (?path=), newest first. Every record carries the short
      // hash, message, author, time, parent commit references, and the changed
      // file paths. A file-scoped history only includes commits whose
      // snapshot contains the path.
      const account = currentAccount(req);
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const rawBranch = url.searchParams.get('branch');
      const branchName =
        rawBranch && rawBranch.trim() !== ''
          ? rawBranch.trim()
          : ctx.repository.defaultBranch;
      const rawPath = url.searchParams.get('path');
      const filePath =
        rawPath && rawPath.trim() !== '' ? rawPath.trim() : '';
      const branch = store.findBranchByRepositoryAndName(
        ctx.repository.id,
        branchName
      );
      let history = store.getCommitHistory(ctx.repository.id, branchName);
      if (filePath !== '') {
        history = history.filter((commit) =>
          store
            .getFilesAtCommit(commit.id)
            .some((f) => f.path === filePath)
        );
      }
      sendJson(res, 200, {
        ok: true,
        branch: branch
          ? { name: branch.name, headCommitId: branch.headCommitId }
          : null,
        commits: history.map((c) => serializeCommit(c, false)),
      });
      return;
    }

    if (
      segments.length === 6 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'commits' &&
      req.method === 'GET'
    ) {
      // REQ-4-2-1: commit detail page. Only commits stored for this repository
      // are reachable; the payload includes the parent revision references and
      // the changed files (path + stored content) so the detail page can show
      // the corresponding parent revision and changed files.
      const account = currentAccount(req);
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const commit = store.findCommitById(decodeURIComponent(segments[5]));
      if (!commit || commit.repositoryId !== ctx.repository.id) {
        send404(res, 'Commit not found');
        return;
      }
      sendJson(res, 200, {
        ok: true,
        commit: serializeCommit(commit, true),
      });
      return;
    }

    if (
      segments.length === 5 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'compare' &&
      req.method === 'GET'
    ) {
      // REQ-4-2-2: read-only diff of two readable commits of the repository
      // (base is the earlier/target revision, compare is the newer revision;
      // an omitted base means an empty tree, e.g. the root commit's diff).
      // The payload carries both revision identifiers, only the changed
      // files, the per-file added/deleted line counts and the line-by-line
      // diff, and the aggregate additions/deletions. No review, comment, or
      // commit is created and nothing is modified.
      const account = currentAccount(req);
      const ctx = repositoryReadContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const rawBase = url.searchParams.get('base') ?? '';
      const rawCompare = url.searchParams.get('compare') ?? '';
      const baseId = rawBase.trim();
      const compareId = rawCompare.trim();
      if (compareId === '') {
        send404(res, 'Commit not found');
        return;
      }
      const compareCommit = store.findCommitById(compareId);
      if (!compareCommit || compareCommit.repositoryId !== ctx.repository.id) {
        send404(res, 'Commit not found');
        return;
      }
      const baseCommit = baseId !== '' ? store.findCommitById(baseId) : null;
      if (baseId !== '' && (!baseCommit || baseCommit.repositoryId !== ctx.repository.id)) {
        send404(res, 'Commit not found');
        return;
      }
      const diff = store.getCommitDiff(
        ctx.repository.id,
        baseId !== '' ? baseId : null,
        compareId
      );
      sendJson(res, 200, {
        ok: true,
        base: baseCommit
          ? {
              id: baseCommit.id,
              shortId: baseCommit.id.slice(0, 7),
              message: baseCommit.message,
            }
          : null,
        compare: {
          id: compareCommit.id,
          shortId: compareCommit.id.slice(0, 7),
          message: compareCommit.message,
        },
        files: diff.files,
        additions: diff.additions,
        deletions: diff.deletions,
      });
      return;
    }

    if (segments.length === 5 && segments[0] === 'api' && segments[1] === 'repositories' && segments[4] === 'access' && req.method === 'GET') {
      // REQ-2-3 Manage access list: only an organization Owner or repository
      // Admin may read the authorization grants of a repository. The response
      // carries each subject's visible name, type, role, grantor and the
      // timestamp of the stored grant.
      const account = currentAccount(req);
      const ctx = repoAdminContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const grants = store.getRepoAccessGrants(ctx.repository.id);
      sendJson(res, 200, { ok: true, grants });
      return;
    }

    if (segments.length === 5 && segments[0] === 'api' && segments[1] === 'repositories' && segments[4] === 'access' && req.method === 'POST') {
      // REQ-2-3: grant (or replace) a repository role for an organization
      // member or team. Exactly one direct role grant per (subject,
      // repository) is stored: saving the same role again updates the
      // existing record, changing the role replaces the original role.
      const account = currentAccount(req);
      const ctx = repoAdminContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const body = await readBody(req);
      const errors = validateRepoAccessGrant(body, {
        isOrgMember: (name) => {
          if (ctx.repository.ownerType !== 'organization') {
            return false;
          }
          const target = store.findAccountByUsername(name);
          return (
            target !== null &&
            store.isOrganizationMember(ctx.repository.ownerId, target.id)
          );
        },
        isOrgTeam: (name) => {
          if (ctx.repository.ownerType !== 'organization') {
            return false;
          }
          return (
            store.findTeamByOrganizationAndName(ctx.repository.ownerId, name) !==
            null
          );
        },
      });
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const subjectType = body.subjectType.trim();
      const subjectName = body.subjectName.trim();
      const subjectId = resolveRepoAccessSubject(
        ctx.repository,
        subjectType,
        subjectName
      );
      if (subjectId === null) {
        sendJson(res, 400, {
          ok: false,
          errors: {
            subjectName:
              subjectType === 'user'
                ? 'User is not a member of this organization'
                : 'Team is not in this organization',
          },
        });
        return;
      }
      store.setRepoAccess({
        repositoryId: ctx.repository.id,
        subjectType,
        subjectId,
        role: body.role.trim(),
        grantorId: account.id,
      });
      sendJson(res, 201, {
        ok: true,
        grants: store.getRepoAccessGrants(ctx.repository.id),
      });
      return;
    }

    if (
      segments.length === 7 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'access' &&
      (segments[5] === 'user' || segments[5] === 'team') &&
      req.method === 'PATCH'
    ) {
      // REQ-2-3: an existing grant row's Save button changes the stored role;
      // only one authorization record is retained for the subject and the
      // role is replaced. A grant that does not exist yet is a 404.
      const account = currentAccount(req);
      const ctx = repoAdminContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const subjectType = segments[5];
      const subjectName = segments[6];
      const body = await readBody(req);
      const errors = validateRepoAccessGrant(
        { subjectType, subjectName, role: body.role },
        { isOrgMember: () => true, isOrgTeam: () => true }
      );
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const subjectId = resolveRepoAccessSubject(
        ctx.repository,
        subjectType,
        subjectName
      );
      if (subjectId === null) {
        sendJson(res, 404, { error: 'Subject not found' });
        return;
      }
      const existing = store.findRepoAccessGrant(
        ctx.repository.id,
        subjectType,
        subjectId
      );
      if (!existing) {
        sendJson(res, 404, { error: 'Grant not found' });
        return;
      }
      store.setRepoAccess({
        repositoryId: ctx.repository.id,
        subjectType,
        subjectId,
        role: body.role.trim(),
        grantorId: account.id,
      });
      sendJson(res, 200, {
        ok: true,
        grants: store.getRepoAccessGrants(ctx.repository.id),
      });
      return;
    }

    if (
      segments.length === 5 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'visibility' &&
      req.method === 'PATCH'
    ) {
      // REQ-3-4: only an organization Owner or repository Admin may change a
      // repository's visibility. The server rejects a confirmation text that
      // does not match the repository name (the change is then blocked and
      // the visibility stays unchanged) and applies the selected visibility
      // atomically; every later read (overview, search, lists, direct links)
      // immediately enforces the new access rule.
      const account = currentAccount(req);
      const ctx = repoAdminContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const body = await readBody(req);
      const visibility =
        typeof body.visibility === 'string' ? body.visibility.trim() : '';
      const confirmation =
        typeof body.confirmation === 'string' ? body.confirmation.trim() : '';
      const errors = {};
      if (visibility === '') {
        errors.visibility = 'Visibility is required';
      } else if (visibility !== 'public' && visibility !== 'private') {
        errors.visibility = 'Visibility is invalid';
      }
      // The confirmation text is only validated when supplied; an empty text
      // completes the change without retyping the repository name.
      if (
        confirmation !== '' &&
        confirmation !== ctx.repository.name &&
        confirmation !== `${segments[2]}/${ctx.repository.name}`
      ) {
        errors.confirmation = 'Repository name does not match';
      }
      if (Object.keys(errors).length > 0) {
        sendJson(res, 400, { ok: false, errors });
        return;
      }
      const repository = store.updateRepositoryVisibility(
        ctx.repository.id,
        visibility
      );
      const owner = repositoryOwnerName(repository);
      sendJson(res, 200, {
        ok: true,
        repository: {
          ...serializeRepository(repository),
          owner,
          ownerType: repository.ownerType,
          defaultBranch: repository.defaultBranch,
          role: store.effectiveRepositoryRole(repository.id, account.id),
        },
      });
      return;
    }

    if (
      segments.length === 5 &&
      segments[0] === 'api' &&
      segments[1] === 'repositories' &&
      segments[4] === 'default-branch' &&
      req.method === 'PATCH'
    ) {
      // REQ-4-3-3: only a repository Admin or organization Owner may change
      // the default branch on the repository code and version-control pages;
      // other roles may only view. The server validates the role (401 when
      // unauthenticated, 403 for everyone else without Admin status), requires
      // the target to be an existing branch of the repository, and stores the
      // new default branch together with the operator and time in one atomic
      // write. Branches, commits, and open-PR references are never deleted or
      // rewritten; the previous default branch stays fully available.
      const account = currentAccount(req);
      if (!account) {
        sendJson(res, 401, { error: 'Authentication required' });
        return;
      }
      const ctx = repoAdminContext(segments[2], segments[3], account);
      if (ctx.error) {
        sendJson(res, ctx.error, { error: ctx.message });
        return;
      }
      const body = await readBody(req);
      const branchName =
        typeof body.branch === 'string' ? body.branch.trim() : '';
      if (branchName === '') {
        sendJson(res, 400, {
          ok: false,
          errors: { branch: 'Branch is required' },
        });
        return;
      }
      const branch = store.findBranchByRepositoryAndName(
        ctx.repository.id,
        branchName
      );
      if (!branch) {
        sendJson(res, 400, {
          ok: false,
          errors: { branch: 'Branch not found' },
        });
        return;
      }
      const repository = store.updateRepositoryDefaultBranch(
        ctx.repository.id,
        branchName,
        account.id
      );
      const owner = repositoryOwnerName(repository);
      sendJson(res, 200, {
        ok: true,
        repository: {
          ...serializeRepository(repository),
          owner,
          ownerType: repository.ownerType,
          defaultBranch: repository.defaultBranch,
          role: store.effectiveRepositoryRole(repository.id, account.id),
        },
      });
      return;
    }

    send404(res);
  }

  async function handleStatic(req, res, pathname) {
    let relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const target = path.resolve(distDir, relativePath);
    if (!isWithinDir(distDir, target)) {
      send404(res);
      return;
    }
    let stat;
    try {
      stat = fs.statSync(target);
    } catch (err) {
      send404(res);
      return;
    }
    if (!stat.isFile()) {
      send404(res);
      return;
    }
    const ext = path.extname(target).toLowerCase();
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.map': 'application/json; charset=utf-8',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.txt': 'text/plain; charset=utf-8',
    };
    const body = fs.readFileSync(target);
    const headers = {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Content-Length': body.length,
    };
    if (ext === '.html') {
      // The app shell must never be cached so hash-routed updates are picked up.
      headers['Cache-Control'] = 'no-cache';
    }
    res.writeHead(200, headers);
    res.end(body);
  }

  return async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;

      if (pathname === '/health' || pathname === '/api/health') {
        if (req.method === 'GET') {
          sendJson(res, 200, { status: 'ok' });
          return;
        }
        send404(res);
        return;
      }

      if (pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname, url);
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        send404(res);
        return;
      }

      await handleStatic(req, res, pathname);
    } catch (err) {
      // Never let a malformed request crash the process.
      sendJson(res, 400, { error: 'Bad request' });
    }
  };
}

module.exports = { createApp };
