'use strict';

/**
 * Server-side authoritative validation for account fields.
 *
 * REQ-1-1-1 rules:
 * - username: 1..39 lowercase ASCII letters, digits, or single hyphens;
 *   must not begin or end with a hyphen.
 * - email: after trimming, exactly one `@`, at most 254 characters, at least
 *   one dot after the `@`, and every dot-separated domain label is non-empty.
 * - password: 12..128 characters, at least one uppercase letter, one lowercase
 *   letter, one digit, one non-alphanumeric special character, and no
 *   whitespace.
 */

const USERNAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function usernameFormatValid(username) {
  if (typeof username !== 'string') {
    return false;
  }
  if (username.length < 1 || username.length > 39) {
    return false;
  }
  return USERNAME_RE.test(username);
}

function emailFormatValid(rawEmail) {
  if (typeof rawEmail !== 'string') {
    return false;
  }
  const email = rawEmail.trim();
  if (email.length < 1 || email.length > 254) {
    return false;
  }
  const atIndexes = [];
  for (let i = 0; i < email.length; i += 1) {
    if (email.charAt(i) === '@') {
      atIndexes.push(i);
    }
  }
  if (atIndexes.length !== 1) {
    return false;
  }
  const domain = email.slice(atIndexes[0] + 1);
  if (domain.indexOf('.') === -1) {
    return false;
  }
  const labels = domain.split('.');
  for (const label of labels) {
    if (label.length === 0) {
      return false;
    }
  }
  return true;
}

function passwordRequirementsSatisfied(password) {
  if (typeof password !== 'string') {
    return false;
  }
  if (password.length < 12 || password.length > 128) {
    return false;
  }
  if (/\s/.test(password)) {
    return false;
  }
  if (!/[a-z]/.test(password)) {
    return false;
  }
  if (!/[A-Z]/.test(password)) {
    return false;
  }
  if (!/\d/.test(password)) {
    return false;
  }
  if (!/[^a-zA-Z0-9]/.test(password)) {
    return false;
  }
  return true;
}

/**
 * Validates a registration payload against the REQ-1-1-1 rules plus
 * uniqueness. Returns an object mapping field names to visible messages.
 * Every violated field is reported together (no single-error masking).
 */
function validateRegistration(payload, isUsernameTaken, isEmailTaken) {
  const errors = {};
  const username = typeof payload.username === 'string' ? payload.username : '';
  const rawEmail = typeof payload.email === 'string' ? payload.email : '';
  const email = rawEmail.trim().toLowerCase();
  const password = typeof payload.password === 'string' ? payload.password : '';
  const confirmPassword =
    typeof payload.confirmPassword === 'string' ? payload.confirmPassword : '';

  if (username.trim() === '') {
    errors.username = 'Username is required';
  } else if (!usernameFormatValid(username)) {
    errors.username = 'Username format is invalid';
  } else if (isUsernameTaken(username)) {
    errors.username = 'Username already exists';
  }

  if (rawEmail.trim() === '') {
    errors.email = 'Email is required';
  } else if (!emailFormatValid(rawEmail)) {
    errors.email = 'Email format is invalid';
  } else if (isEmailTaken(email)) {
    errors.email = 'Email already exists';
  }

  if (password === '') {
    errors.password = 'Password is required';
  } else if (!passwordRequirementsSatisfied(password)) {
    errors.password = 'Password requirements are not satisfied';
  }

  if (confirmPassword === '') {
    errors.confirmPassword = 'Confirm password is required';
  } else if (password !== confirmPassword) {
    errors.confirmPassword = 'Password confirmation does not match';
  }

  if (payload.agreeToTerms !== true) {
    errors.agreeToTerms = 'Agree to terms is required';
  }

  return errors;
}

/**
 * Validates a signed-in password-change payload (REQ-1-3). The current
 * password is checked against the session account's stored credentials; every
 * violated field is reported together and a rejected attempt changes nothing.
 */
function validateChangePassword(payload, currentPasswordMatches) {
  const errors = {};
  const currentPassword =
    typeof payload.currentPassword === 'string' ? payload.currentPassword : '';
  const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : '';
  const confirmPassword =
    typeof payload.confirmPassword === 'string' ? payload.confirmPassword : '';

  if (currentPassword === '') {
    errors.currentPassword = 'Current password is required';
  } else if (!currentPasswordMatches) {
    errors.currentPassword = 'Current password is incorrect';
  }

  if (newPassword === '') {
    errors.newPassword = 'New password is required';
  } else if (!passwordRequirementsSatisfied(newPassword)) {
    errors.newPassword = 'Password requirements are not satisfied';
  }

  if (confirmPassword === '') {
    errors.confirmPassword = 'Confirm password is required';
  } else if (newPassword !== confirmPassword) {
    errors.confirmPassword = 'Password confirmation does not match';
  }

  return errors;
}

/**
 * Validates a password-recovery reset payload. The verification code is the
 * fixed local demo value "123456"; an unknown email is reported on the email
 * field, an invalid code on the verification-code field.
 */
function validateRecoveryReset(payload, accountExists) {
  const errors = {};
  const rawEmail = typeof payload.email === 'string' ? payload.email : '';
  const email = rawEmail.trim().toLowerCase();
  const code = typeof payload.code === 'string' ? payload.code : '';
  const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : '';
  const confirmPassword =
    typeof payload.confirmPassword === 'string' ? payload.confirmPassword : '';

  if (rawEmail.trim() === '') {
    errors.email = 'Email is required';
  } else if (!emailFormatValid(rawEmail)) {
    errors.email = 'Email format is invalid';
  } else if (!accountExists(email)) {
    errors.email = 'Email is not registered';
  }

  if (code === '') {
    errors.verificationCode = 'Verification code is required';
  } else if (code !== '123456') {
    errors.verificationCode = 'Verification code is invalid';
  }

  if (newPassword === '') {
    errors.newPassword = 'New password is required';
  } else if (!passwordRequirementsSatisfied(newPassword)) {
    errors.newPassword = 'Password requirements are not satisfied';
  }

  if (confirmPassword === '') {
    errors.confirmPassword = 'Confirm password is required';
  } else if (newPassword !== confirmPassword) {
    errors.confirmPassword = 'Password confirmation does not match';
  }

  return errors;
}

/**
 * REQ-2-2 team name format: 1..50 lowercase ASCII letters, digits, or
 * hyphens; must not begin or end with a hyphen. Unlike organization/usernames
 * (single hyphens), consecutive hyphens are permitted inside a team name.
 */
const TEAM_NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function teamNameFormatValid(name) {
  if (typeof name !== 'string') {
    return false;
  }
  if (name.length < 1 || name.length > 50) {
    return false;
  }
  return TEAM_NAME_RE.test(name);
}

/**
 * Validates an organization-team-creation payload (REQ-2-2-1). A team name
 * must be present, compliant with the 1..50 character team format, and unique
 * within the owning organization; an optional parent team must belong to the
 * same organization and must not create a direct or indirect cycle. Every
 * violated field is reported together; a rejected attempt creates no team.
 */
function validateTeamCreation(payload, context) {
  const errors = {};
  const name = typeof payload.name === 'string' ? payload.name : '';
  const rawParentTeam =
    typeof payload.parentTeamName === 'string' ? payload.parentTeamName : '';
  const parentTeamName = rawParentTeam.trim();

  if (name === '') {
    errors.name = 'Team name is required';
  } else if (!teamNameFormatValid(name)) {
    errors.name = 'Team name format is invalid';
  } else if (context.isTeamNameTaken(name)) {
    errors.name = 'Team name already exists';
  }

  if (parentTeamName !== '') {
    if (!context.isParentInOrganization(parentTeamName)) {
      errors.parentTeam = 'Parent team is not in this organization';
    } else if (context.isParentCycle && context.isParentCycle(parentTeamName)) {
      errors.parentTeam = 'Cyclic team hierarchy is not allowed';
    }
  }

  return errors;
}

/**
 * Validates an organization-creation payload (REQ-2-1-2). The organization
 * name must comply with the REQ-1 username format (1..39 lowercase ASCII
 * letters, digits, single hyphens, no leading/trailing hyphen) and be
 * globally unique; the display name must contain 1..100 non-empty characters
 * after trimming. Every violated field is reported together; a duplicate name
 * is reported even when the display name is also missing. The applicable
 * visible messages are "Organization name already exists", "Organization name
 * format is invalid", and "Display name is required".
 */
function validateOrganizationCreation(payload, isNameTaken) {
  const errors = {};
  const name = typeof payload.name === 'string' ? payload.name : '';
  const rawDisplayName =
    typeof payload.displayName === 'string' ? payload.displayName : '';
  const displayName = rawDisplayName.trim();

  if (!usernameFormatValid(name)) {
    errors.name = 'Organization name format is invalid';
  } else if (isNameTaken(name)) {
    errors.name = 'Organization name already exists';
  }

  if (displayName === '') {
    errors.displayName = 'Display name is required';
  } else if (displayName.length > 100) {
    errors.displayName = 'Display name is too long';
  }

  return errors;
}

/**
 * REQ-2-2-2: validates an add-team-member payload. Only current organization
 * members may be added to a team; the username must be non-empty. The visible
 * failure message for a non-member is returned on the username field.
 */
function validateTeamMemberAddition(payload, isOrganizationMember) {
  const errors = {};
  const username =
    typeof payload.username === 'string' ? payload.username.trim() : '';

  if (username === '') {
    errors.username = 'Username is required';
  } else if (!isOrganizationMember(username)) {
    errors.username = 'User is not a member of this organization';
  }

  return errors;
}

/**
 * REQ-2-2-3: validates an add-organization-member payload. The identifier is
 * the username or verified email of an existing account; unknown accounts are
 * reported with "Account not found", existing members with "Account is
 * already a member". The role must be exactly "member" or "owner". Every
 * violated field is reported together and a rejected attempt stores nothing.
 */
function validateMemberAddition(payload, context) {
  const errors = {};
  const identifier =
    typeof payload.identifier === 'string' ? payload.identifier.trim() : '';
  const role = typeof payload.role === 'string' ? payload.role.trim() : '';

  if (identifier === '') {
    errors.identifier = 'Username or email is required';
  } else {
    const account = context.findAccount(identifier);
    if (!account) {
      errors.identifier = 'Account not found';
    } else if (context.isMember(account.id)) {
      errors.identifier = 'Account is already a member';
    }
  }

  if (role === '') {
    errors.role = 'Role is required';
  } else if (role !== 'member' && role !== 'owner') {
    errors.role = 'Role is invalid';
  }

  return errors;
}

/**
 * REQ-2-3 repository role values. The organization Owner or repository Admin
 * may grant Read, Triage, Write, Maintain, or Admin to a current
 * organization member or team.
 */
const REPO_ROLES = ['read', 'triage', 'write', 'maintain', 'admin'];

/**
 * REQ-2-3: validates a repository-access grant payload. The subject is
 * either a current organization member (subjectType 'user') or a team of the
 * owning organization (subjectType 'team'); the role must be one of Read,
 * Triage, Write, Maintain, or Admin. Every violated field is reported
 * together and a rejected grant stores nothing.
 */
function validateRepoAccessGrant(payload, context) {
  const errors = {};
  const subjectType =
    typeof payload.subjectType === 'string' ? payload.subjectType.trim() : '';
  const subjectName =
    typeof payload.subjectName === 'string' ? payload.subjectName.trim() : '';
  const role = typeof payload.role === 'string' ? payload.role.trim() : '';

  if (subjectType === '') {
    errors.subjectType = 'Subject type is required';
  } else if (subjectType !== 'user' && subjectType !== 'team') {
    errors.subjectType = 'Subject type is invalid';
  }

  if (subjectName === '') {
    errors.subjectName = 'Subject is required';
  } else if (subjectType === 'user' && !context.isOrgMember(subjectName)) {
    errors.subjectName = 'User is not a member of this organization';
  } else if (subjectType === 'team' && !context.isOrgTeam(subjectName)) {
    errors.subjectName = 'Team is not in this organization';
  }

  if (role === '') {
    errors.role = 'Role is required';
  } else if (!REPO_ROLES.includes(role)) {
    errors.role = 'Role is invalid';
  }

  return errors;
}

/**
 * REQ-3-2-1: validates a repository-creation payload. The owner namespace is
 * required; the repository name must be present, comply with the platform
 * repository-name format (1..39 lowercase ASCII letters, digits, single
 * hyphens, no leading/trailing hyphen), and be unique within the target
 * namespace; visibility must be exactly "public" or "private". Every
 * violated field is reported together and a rejected attempt stores nothing.
 */
function validateRepositoryCreation(payload, context) {
  const errors = {};
  const owner = typeof payload.owner === 'string' ? payload.owner.trim() : '';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const visibility =
    typeof payload.visibility === 'string' ? payload.visibility.trim() : '';

  if (owner === '') {
    errors.owner = 'Owner is required';
  }

  if (name === '') {
    errors.name = 'Repository name is required';
  } else if (!usernameFormatValid(name)) {
    errors.name = 'Repository name format is invalid';
  } else if (context.isNameTaken(name)) {
    errors.name = 'Repository name already exists';
  }

  if (visibility === '') {
    errors.visibility = 'Visibility is required';
  } else if (visibility !== 'public' && visibility !== 'private') {
    errors.visibility = 'Visibility is invalid';
  }

  return errors;
}

/**
 * REQ-4-3: the branch-name rule shared by the branch creation form and the
 * server. A branch name is 1-255 characters and may contain only ASCII
 * letters, digits, `-`, `_`, `.`, and `/`; it must not end with `/` or `.`,
 * and must not contain consecutive `..` or `//`. The same function drives the
 * live "Invalid branch" state of the branch selector and the server-side
 * rejection, so both always agree.
 */
function isValidBranchName(name) {
  if (typeof name !== 'string') {
    return false;
  }
  if (name.length < 1 || name.length > 255) {
    return false;
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) {
    return false;
  }
  if (name.endsWith('/') || name.endsWith('.')) {
    return false;
  }
  if (name.includes('..') || name.includes('//')) {
    return false;
  }
  return true;
}

/**
 * REQ-4-3-2: server-side validation of a branch-creation request. Empty or
 * malformed names report "Invalid branch" (the same text the selector shows
 * while typing); duplicate names report "Branch already exists". Both are
 * field errors so the selector can render them next to the create entry.
 */
function validateBranchCreation(payload, isNameTaken) {
  const errors = {};
  const name = typeof payload.name === 'string' ? payload.name : '';
  if (name === '') {
    errors.name = 'Invalid branch';
  } else if (!isValidBranchName(name)) {
    errors.name = 'Invalid branch';
  } else if (isNameTaken(name)) {
    errors.name = 'Branch already exists';
  }
  return errors;
}

/**
 * REQ-4-4: the file-path rule of the web file editor. A new or renamed file
 * path must not be empty after trimming, must not begin with `/`, and must
 * not contain a `..` path segment. Conflicts with an existing file or
 * directory on the current branch are checked by the caller against the
 * branch-head snapshot; every path violation reports the exact visible
 * message "Invalid file path".
 */
function isValidFilePath(rawPath) {
  if (typeof rawPath !== 'string') {
    return false;
  }
  const filePath = rawPath.trim();
  if (filePath === '') {
    return false;
  }
  if (filePath.startsWith('/')) {
    return false;
  }
  return !filePath.split('/').includes('..');
}

/**
 * REQ-4-4: server-side validation of a web file-editor submission. The path
 * must satisfy the file-path rule and must not conflict with an existing
 * file or directory at the branch head; the commit message must contain
 * 1-72 non-empty characters after trimming. Path violations report the exact
 * visible message "Invalid file path"; an empty (or over-long) message
 * reports "Commit message is required" (or "Commit message is too long").
 */
function validateFileWrite(payload, context) {
  const errors = {};
  const rawPath = typeof payload.path === 'string' ? payload.path : '';
  const rawMessage = typeof payload.message === 'string' ? payload.message : '';
  const filePath = rawPath.trim();
  const message = rawMessage.trim();
  if (!isValidFilePath(rawPath)) {
    errors.path = 'Invalid file path';
  } else if (context.isPathConflict(filePath)) {
    errors.path = 'Invalid file path';
  }
  if (message === '') {
    errors.message = 'Commit message is required';
  } else if (message.length > 72) {
    errors.message = 'Commit message is too long';
  }
  return errors;
}

/** REQ-5-2: the issue title rule — 1-256 non-empty characters after trimming. */
const ISSUE_TITLE_MAX = 256;
/** REQ-5-2: the issue description may be empty and is at most 65536 characters. */
const ISSUE_BODY_MAX = 65536;

/**
 * REQ-5-2-1: server-side validation of an issue-creation payload. The title
 * must contain 1-256 non-empty characters after trimming leading and
 * trailing whitespace (a title of only spaces is blank and reports the exact
 * visible message "Title is required"); the optional description may be
 * empty and is at most 65536 characters. Every violated field is reported
 * together and a rejected submission allocates no issue number and stores
 * nothing.
 */
function validateIssueCreation(payload) {
  const errors = {};
  const rawTitle = typeof payload.title === 'string' ? payload.title : '';
  const rawBody = typeof payload.body === 'string' ? payload.body : '';
  const title = rawTitle.trim();
  if (title === '') {
    errors.title = 'Title is required';
  } else if (title.length > ISSUE_TITLE_MAX) {
    errors.title = 'Title is too long';
  }
  if (rawBody.length > ISSUE_BODY_MAX) {
    errors.body = 'Description is too long';
  }
  return errors;
}

/**
 * REQ-5-2-2: server-side validation of an issue edit payload. Saving the
 * title and saving the description are separate actions, so only the fields
 * that are present in the payload are validated (and changed): a provided
 * title must contain 1-256 non-empty characters after trimming leading and
 * trailing whitespace (a title of only spaces is blank and reports the exact
 * visible message "Title is required"; over-long input reports "Title is too
 * long"); a provided description is at most 65536 characters (over-long input
 * reports "Description is too long"). Every violated field is reported
 * together and a rejected edit changes nothing.
 */
function validateIssueEdit(payload) {
  const errors = {};
  const hasTitle =
    payload && Object.prototype.hasOwnProperty.call(payload, 'title');
  const hasBody =
    payload && Object.prototype.hasOwnProperty.call(payload, 'body');
  if (hasTitle) {
    const rawTitle = typeof payload.title === 'string' ? payload.title : '';
    const title = rawTitle.trim();
    if (title === '') {
      errors.title = 'Title is required';
    } else if (title.length > ISSUE_TITLE_MAX) {
      errors.title = 'Title is too long';
    }
  }
  if (hasBody) {
    const rawBody = typeof payload.body === 'string' ? payload.body : '';
    if (rawBody.length > ISSUE_BODY_MAX) {
      errors.body = 'Description is too long';
    }
  }
  return errors;
}

/**
 * REQ-5-2-3: server-side validation of an issue-comment payload. A comment
 * contains 1-65536 non-empty characters after trimming leading and trailing
 * whitespace: a blank comment (including whitespace-only text) reports the
 * exact visible message "Comment is required", an over-long comment reports
 * "Comment is too long". Every violated field is reported together and a
 * rejected submission stores no comment and appends no timeline record.
 */
function validateIssueComment(payload) {
  const errors = {};
  const rawBody = typeof payload.body === 'string' ? payload.body : '';
  if (rawBody.trim() === '') {
    errors.body = 'Comment is required';
  } else if (rawBody.length > ISSUE_BODY_MAX) {
    errors.body = 'Comment is too long';
  }
  return errors;
}

/**
 * REQ-5-2-3: server-side validation of a reaction payload. The reaction type
 * must be a non-empty value after trimming; the set of available types is a
 * product concern of the page (the association stores exactly the type sent).
 */
function validateIssueReaction(payload) {
  const errors = {};
  const reaction =
    typeof payload.reaction === 'string' ? payload.reaction.trim() : '';
  if (reaction === '') {
    errors.reaction = 'Reaction is required';
  }
  return errors;
}

/**
 * REQ-6-1: validates a branch-protection-rule payload. The rule is bound to
 * one exact branch name (no wildcard semantics), so the branch-name pattern
 * must be a non-empty trimmed value; the two requirement toggles are
 * independently selectable booleans (missing toggles default to off).
 */
function validateBranchProtectionRule(payload) {
  const errors = {};
  const branchName =
    typeof payload.branchName === 'string' ? payload.branchName.trim() : '';
  if (branchName === '') {
    errors.branchName = 'Branch name pattern is required';
  }
  return errors;
}

/**
 * REQ-6-2-3: server-side validation of a pull-request-creation payload. The
 * title must contain 1-256 non-empty characters after trimming leading and
 * trailing whitespace (a title of only spaces is blank and reports the exact
 * visible message "Title is required"); the optional description may be empty
 * and is at most 65536 characters. Every violated field is reported together
 * and a rejected submission creates no PR and allocates no number. The
 * distinct-branch/differences/duplicate-pair/permission checks are performed
 * by the route against the store (they need repository state).
 */
function validatePullRequestCreation(payload) {
  const errors = {};
  const rawTitle = typeof payload.title === 'string' ? payload.title : '';
  const rawDescription =
    typeof payload.description === 'string' ? payload.description : '';
  const title = rawTitle.trim();
  if (title === '') {
    errors.title = 'Title is required';
  } else if (title.length > ISSUE_TITLE_MAX) {
    errors.title = 'Title is too long';
  }
  if (rawDescription.length > ISSUE_BODY_MAX) {
    errors.description = 'Description is too long';
  }
  return errors;
}

/**
 * REQ-6-3-3: server-side validation of an inline review-comment payload.
 * The comment body contains 1-65536 non-empty characters after trimming
 * leading and trailing whitespace (a blank body reports the exact visible
 * message "Comment is required", an over-long body reports "Comment is too
 * long") and the target file path must be a non-empty trimmed value. The
 * line position and the file's presence in the current diff are checked by
 * the route against the repository state.
 */
function validateInlineComment(payload) {
  const errors = {};
  const rawBody = typeof payload.body === 'string' ? payload.body : '';
  if (rawBody.trim() === '') {
    errors.body = 'Comment is required';
  } else if (rawBody.length > ISSUE_BODY_MAX) {
    errors.body = 'Comment is too long';
  }
  const filePath =
    typeof payload.filePath === 'string' ? payload.filePath.trim() : '';
  if (filePath === '') {
    errors.filePath = 'File path is required';
  }
  return errors;
}

/**
 * REQ-6-1: validates a Checks-area status update payload. The `test` status
 * must be exactly pending, success, or failure.
 */
function validatePullCheckStatus(payload) {
  const errors = {};
  const status = typeof payload.status === 'string' ? payload.status.trim() : '';
  if (status === '') {
    errors.status = 'Status is required';
  } else if (status !== 'pending' && status !== 'success' && status !== 'failure') {
    errors.status = 'Status is invalid';
  }
  return errors;
}

/**
 * REQ-6-3-4: server-side validation of a pull-request review submission.
 * The decision is required and must be exactly Comment, Approve, or Request
 * changes; the optional Summary (explanation) may contain at most 65536
 * characters. The permission/author/draft-status rules are checked by the
 * route against the session, the repository role, and the PR state.
 */
function validatePullReview(payload) {
  const errors = {};
  const rawDecision = typeof payload.decision === 'string' ? payload.decision : '';
  const decision = rawDecision.trim();
  if (decision === '') {
    errors.decision = 'Decision is required';
  } else if (
    decision !== 'comment' &&
    decision !== 'approve' &&
    decision !== 'request_changes'
  ) {
    errors.decision = 'Decision is invalid';
  }
  const rawExplanation =
    typeof payload.explanation === 'string' ? payload.explanation : '';
  if (rawExplanation.length > ISSUE_BODY_MAX) {
    errors.explanation = 'Summary is too long';
  }
  return errors;
}

module.exports = {
  usernameFormatValid,
  emailFormatValid,
  passwordRequirementsSatisfied,
  teamNameFormatValid,
  isValidBranchName,
  isValidFilePath,
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
};
