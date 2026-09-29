import { randomUUID } from "node:crypto";

import {
  REPOSITORY_GRANT_MESSAGES,
  REPOSITORY_ROLES,
  readRepositoryRole,
} from "../domain/organizations.mjs";
import { getCurrentAccount } from "../lib/auth-context.mjs";
import { sendJson } from "../lib/http.mjs";
import {
  canManageRepositoryAccess,
  canReadRepository,
  effectiveRepositoryRole,
  findOrganizationById,
  findRepositoryForOwner,
  membershipFor,
  organizationRole,
  resolveRepositoryOwner,
  teamsOfOrganization,
} from "../lib/org-access.mjs";
import {
  branchOf,
  commitsOf,
  entriesAtPath,
  findFile,
} from "../lib/repository-content.mjs";
import { repositoryOverview } from "../lib/repository-payload.mjs";

/**
 * Repository resource routes (REQ-2-1-1, REQ-2-3, REQ-3-3, REQ-3-2-3): the
 * overview, the stored content of a branch and the access management of a
 * repository. An owner is an organization or an individual account; a private
 * repository is only readable by its owner, an organization Owner, or an account
 * holding a direct or team grant.
 */

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function loadContext(stores) {
  const [
    { organizations },
    { memberships },
    { teams },
    { repositories },
    { grants },
    { accounts },
    { branches, commits, files },
  ] = await Promise.all([
    stores.organizations.read(),
    stores.organizationMembers.read(),
    stores.teams.read(),
    stores.repositories.read(),
    stores.repositoryGrants.read(),
    stores.accounts.read(),
    stores.repositoryContent.read(),
  ]);
  return {
    organizations,
    memberships,
    teams,
    repositories,
    grants,
    accounts,
    content: { branches, commits, files },
  };
}

async function requireAccount(stores, request, response) {
  const current = await getCurrentAccount(stores, request);
  if (!current) {
    sendJson(response, 401, { error: "Authentication required" });
    return null;
  }
  return current.account;
}

function accountById(accounts, accountId) {
  return accounts.find((account) => account.id === accountId) ?? null;
}

/**
 * Resolves the owner from the address (`organization` name or account username) and
 * the repository of that namespace; answers 404 when either does not exist.
 */
async function resolveTarget({ stores, response, ownerName, repositoryName }) {
  const context = await loadContext(stores);
  const owner = resolveRepositoryOwner(context, ownerName);
  const repository = owner
    ? findRepositoryForOwner(context.repositories, owner, repositoryName)
    : null;
  if (!owner || !repository) {
    sendJson(response, 404, { error: "Repository not found" });
    return null;
  }
  return { context, owner, repository };
}

/**
 * Read access boundary: 401 for a visitor, 403 for a signed-in account without a
 * role. Answers the request itself when access is denied; an allowed request is
 * answered with the viewer's account id, which stays null for a visitor reading a
 * public repository.
 */
async function requireReadAccess({ stores, request, response, context, repository }) {
  const account = await getCurrentAccount(stores, request);
  const accountId = account?.account.id ?? null;
  if (!canReadRepository({ ...context, repository, accountId })) {
    if (!accountId) {
      sendJson(response, 401, { error: "Authentication required" });
      return null;
    }
    sendJson(response, 403, { error: "Access denied" });
    return null;
  }
  return { accountId };
}

function repositoryRoleContext(context, repository, accountId) {
  return {
    repository,
    grants: context.grants,
    teams: context.teams,
    memberships: context.memberships,
    accountId,
  };
}

function grantSubjectName(context, repository, grant) {
  if (grant.subjectType === "team") {
    const team = context.teams.find(
      (candidate) =>
        candidate.id === grant.subjectId &&
        (repository.ownerType === "organization" ? candidate.organizationId === repository.ownerId : false),
    );
    return team ? team.name : null;
  }
  return accountById(context.accounts, grant.subjectId)?.username ?? null;
}

/**
 * Payload of the “Manage access” view: the stored grants of the repository plus the
 * candidate subjects an administrator may pick (`viewerRole` is the effective
 * repository role of the signed-in account).
 */
function accessPayload(context, repository, viewerRole) {
  const grants = context.grants
    .filter((grant) => grant.repositoryId === repository.id)
    .map((grant) => ({
      id: grant.id,
      subjectType: grant.subjectType === "team" ? "team" : "account",
      subjectId: grant.subjectId,
      subjectName: grantSubjectName(context, repository, grant),
      role: grant.role,
      createdAt: grant.createdAt ?? null,
    }))
    .filter((grant) => grant.subjectName && REPOSITORY_ROLES.includes(grant.role))
    .sort((left, right) => left.subjectName.localeCompare(right.subjectName));

  const organization =
    repository.ownerType === "organization"
      ? findOrganizationById(context.organizations, repository.ownerId)
      : null;
  const members = organization
    ? context.memberships
        .filter((membership) => membership.organizationId === organization.id)
        .map((membership) => accountById(context.accounts, membership.accountId))
        .filter(Boolean)
        .map((member) => ({ id: member.id, name: member.username }))
        .sort((left, right) => left.name.localeCompare(right.name))
    : [];
  const teams = organization
    ? teamsOfOrganization(context.teams, organization.id)
        .map((team) => ({ id: team.id, name: team.name }))
        .sort((left, right) => left.name.localeCompare(right.name))
    : [];

  return { grants, members, teams, viewerRole };
}

/** The repository overview plus the viewer's organization and repository roles. */
async function handleRepositoryDetail({ request, response, stores, ownerName, repositoryName }) {
  const target = await resolveTarget({ stores, response, ownerName, repositoryName });
  if (!target) return;
  const { context, owner, repository } = target;
  const access = await requireReadAccess({ stores, request, response, context, repository });
  if (!access) return;
  const { accountId } = access;

  sendJson(response, 200, {
    repository: repositoryOverview(repository, owner.name, context.content),
    viewerRole:
      repository.ownerType === "organization"
        ? organizationRole(context.memberships, repository.ownerId, accountId)
        : null,
    repositoryRole: effectiveRepositoryRole(repositoryRoleContext(context, repository, accountId)),
  });
}

async function handleRepositoryAccess({ request, response, stores, ownerName, repositoryName }) {
  const target = await resolveTarget({ stores, response, ownerName, repositoryName });
  if (!target) return;
  const { context, repository } = target;
  const access = await requireReadAccess({ stores, request, response, context, repository });
  if (!access) return;
  const { accountId } = access;
  const viewerRole = effectiveRepositoryRole(repositoryRoleContext(context, repository, accountId));
  sendJson(response, 200, accessPayload(context, repository, viewerRole));
}

/**
 * REQ-2-3: stores one direct role grant per (repository, subject). Repeating the
 * same role keeps a single record; a different role replaces the stored one.
 */
async function handleSaveRepositoryGrant({ request, response, stores, ownerName, repositoryName, body }) {
  const target = await resolveTarget({ stores, response, ownerName, repositoryName });
  if (!target) return;
  const { context, repository } = target;
  const account = await requireAccount(stores, request, response);
  if (!account) return;
  if (!canManageRepositoryAccess(repositoryRoleContext(context, repository, account.id))) {
    sendJson(response, 403, { error: "Access denied" });
    return;
  }

  const subjectType = body.subjectType === "team" ? "team" : body.subjectType === "account" ? "account" : null;
  const subjectId = typeof body.subjectId === "string" ? body.subjectId.trim() : "";
  const role = readRepositoryRole(body.role);
  const errors = {};
  if (!role) errors.role = REPOSITORY_GRANT_MESSAGES.role;
  if (!subjectType || !subjectId) {
    errors.subject = REPOSITORY_GRANT_MESSAGES.subject;
  } else if (subjectType === "account") {
    const subjectAccount = accountById(context.accounts, subjectId);
    if (!subjectAccount) errors.subject = REPOSITORY_GRANT_MESSAGES.account;
    else if (
      repository.ownerType === "organization" &&
      !membershipFor(context.memberships, repository.ownerId, subjectId)
    ) {
      errors.subject = REPOSITORY_GRANT_MESSAGES.subject;
    }
  } else {
    const team = context.teams.find(
      (candidate) =>
        candidate.id === subjectId &&
        repository.ownerType === "organization" &&
        candidate.organizationId === repository.ownerId,
    );
    if (!team) errors.subject = REPOSITORY_GRANT_MESSAGES.team;
  }
  if (Object.keys(errors).length > 0) {
    sendJson(response, 400, { error: "Grant not saved", errors });
    return;
  }

  const now = new Date().toISOString();
  await stores.repositoryGrants.update((state) => {
    const existing = state.grants.find(
      (grant) =>
        grant.repositoryId === repository.id &&
        grant.subjectType === subjectType &&
        grant.subjectId === subjectId,
    );
    if (existing) {
      existing.role = role;
      existing.grantedById = account.id;
      existing.updatedAt = now;
      return;
    }
    state.grants.push({
      id: `grant-${randomUUID()}`,
      repositoryId: repository.id,
      subjectType,
      subjectId,
      role,
      grantedById: account.id,
      createdAt: now,
      updatedAt: now,
    });
  });

  const { grants } = await stores.repositoryGrants.read();
  const updated = { ...context, grants };
  sendJson(
    response,
    200,
    accessPayload(
      updated,
      repository,
      effectiveRepositoryRole(repositoryRoleContext(updated, repository, account.id)),
    ),
  );
}

/** Entries directly inside `path` of a branch of the repository. */
async function handleRepositoryContents({ request, response, stores, ownerName, repositoryName, url }) {
  const target = await resolveTarget({ stores, response, ownerName, repositoryName });
  if (!target) return;
  const { context, repository } = target;
  const access = await requireReadAccess({ stores, request, response, context, repository });
  if (!access) return;

  const branch = url.searchParams.get("branch") || (repository.defaultBranch ?? "");
  const path = url.searchParams.get("path") ?? "";
  if (!branch || !branchOf(context.content, repository.id, branch)) {
    sendJson(response, 404, { error: "Branch not found" });
    return;
  }
  const entries = entriesAtPath(context.content, repository.id, branch, path);
  if (path.trim() && entries.length === 0) {
    sendJson(response, 404, { error: "Path not found" });
    return;
  }
  sendJson(response, 200, {
    branch,
    path: path.replace(/^\/+|\/+$/g, ""),
    entries,
  });
}

/** Stored content of one file on one branch. */
async function handleRepositoryFile({ request, response, stores, ownerName, repositoryName, url }) {
  const target = await resolveTarget({ stores, response, ownerName, repositoryName });
  if (!target) return;
  const { context, repository } = target;
  const access = await requireReadAccess({ stores, request, response, context, repository });
  if (!access) return;

  const branch = url.searchParams.get("branch") || (repository.defaultBranch ?? "");
  const path = url.searchParams.get("path") ?? "";
  if (!branch || !branchOf(context.content, repository.id, branch)) {
    sendJson(response, 404, { error: "Branch not found" });
    return;
  }
  const file = findFile(context.content, repository.id, branch, path);
  if (!file) {
    sendJson(response, 404, { error: "File not found" });
    return;
  }
  const [latestCommit] = commitsOf(context.content, repository.id, branch);
  sendJson(response, 200, {
    file: {
      name: file.path.split("/").pop(),
      path: file.path,
      branch,
      content: file.content ?? "",
      updatedAt: file.updatedAt ?? null,
    },
    commit: latestCommit
      ? {
          message: latestCommit.message,
          authorName: latestCommit.authorName,
          createdAt: latestCommit.createdAt,
        }
      : null,
  });
}

/** Commit history of the repository, newest first. */
async function handleRepositoryCommits({ request, response, stores, ownerName, repositoryName, url }) {
  const target = await resolveTarget({ stores, response, ownerName, repositoryName });
  if (!target) return;
  const { context, repository } = target;
  const access = await requireReadAccess({ stores, request, response, context, repository });
  if (!access) return;

  const branch = url.searchParams.get("branch") || (repository.defaultBranch ?? "");
  if (!branch || !branchOf(context.content, repository.id, branch)) {
    sendJson(response, 404, { error: "Branch not found" });
    return;
  }
  sendJson(response, 200, {
    branch,
    commits: commitsOf(context.content, repository.id, branch).map((commit) => ({
      id: commit.id,
      message: commit.message,
      authorName: commit.authorName,
      createdAt: commit.createdAt,
      changedPaths: commit.changedPaths ?? [],
    })),
  });
}

export async function handleRepositoryRoutes({ request, response, url, stores, body }) {
  const segments = url.pathname.split("/").filter(Boolean).map(decodeSegment);
  if (segments[0] !== "api" || segments[1] !== "repositories") return false;
  const method = request.method ?? "GET";
  const [ownerName, repositoryName, section] = segments.slice(2);

  if (ownerName && !repositoryName && method === "GET") {
    sendJson(response, 404, { error: "Repository not found" });
    return true;
  }
  if (ownerName && repositoryName && !section && method === "GET") {
    await handleRepositoryDetail({ request, response, stores, ownerName, repositoryName });
    return true;
  }
  if (ownerName && repositoryName && method === "GET") {
    if (section === "contents") {
      await handleRepositoryContents({ request, response, stores, ownerName, repositoryName, url });
      return true;
    }
    if (section === "file") {
      await handleRepositoryFile({ request, response, stores, ownerName, repositoryName, url });
      return true;
    }
    if (section === "commits") {
      await handleRepositoryCommits({ request, response, stores, ownerName, repositoryName, url });
      return true;
    }
  }
  if (ownerName && repositoryName && section === "access") {
    if (method === "GET") {
      await handleRepositoryAccess({ request, response, stores, ownerName, repositoryName });
      return true;
    }
    if (method === "POST") {
      await handleSaveRepositoryGrant({
        request,
        response,
        stores,
        ownerName,
        repositoryName,
        body: body ?? {},
      });
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }
  sendJson(response, 404, { error: "Not found" });
  return true;
}
