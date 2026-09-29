import { randomUUID } from "node:crypto";

import {
  ORGANIZATION_MEMBER_MESSAGES,
  ORGANIZATION_MESSAGES,
  TEAM_MEMBER_MESSAGES,
  TEAM_MESSAGES,
  organizationKey,
  readDisplayName,
  readMemberRole,
  readTeamDescription,
  readTeamParentId,
  validateOrganizationName,
  validateTeamName,
} from "../domain/organizations.mjs";
import { findAccountByIdentifier } from "../domain/accounts.mjs";
import { getCurrentAccount } from "../lib/auth-context.mjs";
import { sendJson } from "../lib/http.mjs";
import {
  findOrganizationById,
  findOrganizationByName,
  findTeamByName,
  isOrganizationOwner,
  isTeamMember,
  membershipFor,
  organizationRepositories,
  organizationRole,
  teamMemberIds,
  teamsOfOrganization,
  wouldCreateTeamCycle,
} from "../lib/org-access.mjs";

/**
 * Organization, team and organization-repository routes (REQ-2-1-1, REQ-2-1-2,
 * REQ-2-2-1, REQ-2-2-2, REQ-2-2-3, REQ-2-2-4). Every request resolves the
 * signed-in account from the session cookie; permissions are enforced here, never
 * by the browser.
 */

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function loadContext(stores) {
  const [{ organizations }, { memberships }, { teams }, { repositories }, { grants }, { accounts }] =
    await Promise.all([
      stores.organizations.read(),
      stores.organizationMembers.read(),
      stores.teams.read(),
      stores.repositories.read(),
      stores.repositoryGrants.read(),
      stores.accounts.read(),
    ]);
  return { organizations, memberships, teams, repositories, grants, accounts };
}

function accountById(accounts, accountId) {
  return accounts.find((account) => account.id === accountId) ?? null;
}

function organizationPayload(organization, role) {
  return {
    id: organization.id,
    name: organization.name,
    displayName: organization.displayName,
    createdAt: organization.createdAt,
    role: role ?? null,
    isMember: Boolean(role),
  };
}

function repositoryPayload(repository) {
  return {
    name: repository.name,
    description: repository.description ?? "",
    visibility: repository.visibility === "private" ? "private" : "public",
    updatedAt: repository.updatedAt ?? null,
  };
}

function teamPayload(context, organization, team) {
  const parent = team.parentTeamId
    ? context.teams.find((candidate) => candidate.id === team.parentTeamId) ?? null
    : null;
  return {
    id: team.id,
    name: team.name,
    description: team.description ?? "",
    organizationId: organization.id,
    organizationName: organization.name,
    parentTeamId: team.parentTeamId ?? null,
    parentName: parent ? parent.name : null,
    createdAt: team.createdAt ?? null,
    members: teamMemberIds(team)
      .map((accountId) => accountById(context.accounts, accountId)?.username ?? null)
      .filter(Boolean),
    children: context.teams
      .filter((candidate) => candidate.parentTeamId === team.id)
      .map((candidate) => candidate.name),
  };
}

/**
 * Resolves a submitted parent reference — a team identifier or the name of a team
 * of the same organization — to the stored team, or null when the reference is
 * empty or belongs to no team of that organization (REQ-2-2-1/REQ-2-2-2).
 */
function resolveParentTeam(teams, organizationId, reference) {
  if (!reference) return null;
  return (
    teams.find((team) => team.id === reference && team.organizationId === organizationId) ??
    teams.find(
      (team) =>
        team.organizationId === organizationId &&
        organizationKey(team.name) === organizationKey(reference),
    ) ??
    null
  );
}

function teamSummary(team, teams) {
  const parent = team.parentTeamId
    ? teams.find((candidate) => candidate.id === team.parentTeamId) ?? null
    : null;
  return {
    id: team.id,
    name: team.name,
    description: team.description ?? "",
    parentTeamId: team.parentTeamId ?? null,
    parentName: parent ? parent.name : null,
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

/** `scope=public` (default) lists the organization directory, `scope=mine` the memberships. */
async function handleListOrganizations({ request, response, stores, url }) {
  const context = await loadContext(stores);
  const scope = url.searchParams.get("scope") ?? "public";
  if (scope === "mine") {
    const account = await requireAccount(stores, request, response);
    if (!account) return;
    const organizations = context.memberships
      .filter((membership) => membership.accountId === account.id)
      .map((membership) => {
        const organization = findOrganizationById(context.organizations, membership.organizationId);
        return organization
          ? { name: organization.name, displayName: organization.displayName, role: membership.role }
          : null;
      })
      .filter(Boolean)
      .sort((left, right) => left.name.localeCompare(right.name));
    sendJson(response, 200, { organizations });
    return;
  }
  const organizations = context.organizations
    .map((organization) => ({ name: organization.name, displayName: organization.displayName }))
    .sort((left, right) => left.name.localeCompare(right.name));
  sendJson(response, 200, { organizations });
}

async function handleCreateOrganization({ request, response, stores, body }) {
  const account = await requireAccount(stores, request, response);
  if (!account) return;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const key = organizationKey(name);
  const formatError = validateOrganizationName(name);
  const { displayName, error: displayError } = readDisplayName(body.displayName);

  const errors = {};
  // An existing identifier is reported as a duplicate even when the submitted
  // identifier does not satisfy the creation format (the seed organization keeps
  // the name given by the requirements).
  const { organizations } = await stores.organizations.read();
  const duplicate =
    Boolean(key) && organizations.some((organization) => organizationKey(organization.name) === key);
  if (duplicate) {
    errors.name = ORGANIZATION_MESSAGES.taken;
  } else if (formatError) {
    errors.name = formatError;
  }
  if (displayError) errors.displayName = displayError;
  if (Object.keys(errors).length > 0) {
    sendJson(response, 400, { error: "Organization creation failed", errors });
    return;
  }

  const organization = {
    id: `org-${randomUUID()}`,
    name,
    displayName,
    createdAt: new Date().toISOString(),
  };
  let created = false;
  await stores.organizations.update((state) => {
    if (state.organizations.some((candidate) => organizationKey(candidate.name) === key)) return;
    state.organizations.push(organization);
    created = true;
  });
  if (!created) {
    sendJson(response, 400, {
      error: "Organization creation failed",
      errors: { name: ORGANIZATION_MESSAGES.taken },
    });
    return;
  }
  await stores.organizationMembers.update((state) => {
    state.memberships.push({
      id: `orgmem-${randomUUID()}`,
      organizationId: organization.id,
      accountId: account.id,
      role: "owner",
      createdAt: organization.createdAt,
    });
  });
  sendJson(response, 201, { organization: organizationPayload(organization, "owner") });
}

async function handleOrganizationDetail({ request, response, stores, name }) {
  const context = await loadContext(stores);
  const organization = findOrganizationByName(context.organizations, name);
  if (!organization) {
    sendJson(response, 404, { error: "Organization not found" });
    return;
  }
  const account = await getCurrentAccount(stores, request);
  const role = organizationRole(context.memberships, organization.id, account?.account.id ?? null);
  sendJson(response, 200, { organization: organizationPayload(organization, role) });
}

async function handleOrganizationRepositories({ request, response, stores, name }) {
  const context = await loadContext(stores);
  const organization = findOrganizationByName(context.organizations, name);
  if (!organization) {
    sendJson(response, 404, { error: "Organization not found" });
    return;
  }
  const account = await getCurrentAccount(stores, request);
  const repositories = organizationRepositories(
    {
      repositories: context.repositories,
      grants: context.grants,
      teams: context.teams,
      memberships: context.memberships,
      accountId: account?.account.id ?? null,
    },
    organization.id,
  )
    .map(repositoryPayload)
    .sort((left, right) => left.name.localeCompare(right.name));
  sendJson(response, 200, { repositories });
}

function memberList(context, organization, memberships) {
  return memberships
    .filter((membership) => membership.organizationId === organization.id)
    .map((membership) => ({
      username: accountById(context.accounts, membership.accountId)?.username ?? "",
      role: membership.role === "owner" ? "owner" : "member",
    }))
    .filter((member) => member.username)
    .sort((left, right) =>
      left.role === right.role
        ? left.username.localeCompare(right.username)
        : left.role === "owner"
          ? -1
          : 1,
    );
}

async function handleOrganizationPeople({ request, response, stores, name }) {
  const context = await loadContext(stores);
  const organization = findOrganizationByName(context.organizations, name);
  if (!organization) {
    sendJson(response, 404, { error: "Organization not found" });
    return;
  }
  const account = await requireAccount(stores, request, response);
  if (!account) return;
  const role = organizationRole(context.memberships, organization.id, account.id);
  if (!role) {
    sendJson(response, 403, { error: "Access denied" });
    return;
  }
  sendJson(response, 200, {
    members: memberList(context, organization, context.memberships),
    viewerRole: role,
  });
}

/**
 * REQ-2-2-3: an Owner adds an existing account as Member or Owner. The membership
 * relationship is stored immediately — there is no invitation, Pending or
 * acceptance step — and the response carries the persisted People list.
 */
async function handleAddOrganizationMember({ request, response, stores, name, body }) {
  const context = await loadContext(stores);
  const organization = findOrganizationByName(context.organizations, name);
  if (!organization) {
    sendJson(response, 404, { error: "Organization not found" });
    return;
  }
  const account = await requireAccount(stores, request, response);
  if (!account) return;
  if (!isOrganizationOwner(context.memberships, organization.id, account.id)) {
    sendJson(response, 403, { error: "Access denied" });
    return;
  }

  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  const target = identifier ? findAccountByIdentifier(context.accounts, identifier) : null;
  const role = readMemberRole(body.role);
  const errors = {};
  if (!target) {
    errors.identifier = ORGANIZATION_MEMBER_MESSAGES.unknown;
  } else if (organizationRole(context.memberships, organization.id, target.id)) {
    errors.identifier = ORGANIZATION_MEMBER_MESSAGES.alreadyMember;
  }
  if (!role) errors.role = ORGANIZATION_MEMBER_MESSAGES.role;
  if (Object.keys(errors).length > 0) {
    sendJson(response, 400, { error: "Member not added", errors });
    return;
  }

  let added = false;
  await stores.organizationMembers.update((state) => {
    const duplicate = state.memberships.some(
      (membership) =>
        membership.organizationId === organization.id && membership.accountId === target.id,
    );
    if (duplicate) return;
    state.memberships.push({
      id: `orgmem-${randomUUID()}`,
      organizationId: organization.id,
      accountId: target.id,
      role,
      createdAt: new Date().toISOString(),
    });
    added = true;
  });
  if (!added) {
    sendJson(response, 400, {
      error: "Member not added",
      errors: { identifier: ORGANIZATION_MEMBER_MESSAGES.alreadyMember },
    });
    return;
  }

  const { memberships } = await stores.organizationMembers.read();
  sendJson(response, 200, { members: memberList(context, organization, memberships) });
}

/**
 * REQ-2-2-4: an Owner removes a member. The operation deletes the organization
 * membership, every team membership of that account in this organization and
 * every direct grant of the account on repositories of this organization. Team
 * grants, teams, the personal account and its other relationships are untouched;
 * the last remaining Owner cannot be removed.
 */
async function handleRemoveOrganizationMember({ request, response, stores, name, username }) {
  const context = await loadContext(stores);
  const organization = findOrganizationByName(context.organizations, name);
  if (!organization) {
    sendJson(response, 404, { error: "Organization not found" });
    return;
  }
  const account = await requireAccount(stores, request, response);
  if (!account) return;
  if (!isOrganizationOwner(context.memberships, organization.id, account.id)) {
    sendJson(response, 403, { error: "Access denied" });
    return;
  }

  const target = findAccountByIdentifier(context.accounts, username);
  if (!target || !membershipFor(context.memberships, organization.id, target.id)) {
    sendJson(response, 404, { error: ORGANIZATION_MEMBER_MESSAGES.missing });
    return;
  }

  let removed = false;
  let blockedByOwner = false;
  await stores.organizationMembers.update((state) => {
    const membership = state.memberships.find(
      (candidate) =>
        candidate.organizationId === organization.id && candidate.accountId === target.id,
    );
    if (!membership) return;
    const owners = state.memberships.filter(
      (candidate) => candidate.organizationId === organization.id && candidate.role === "owner",
    );
    if (membership.role === "owner" && owners.length <= 1) {
      blockedByOwner = true;
      return;
    }
    state.memberships = state.memberships.filter((candidate) => candidate !== membership);
    removed = true;
  });
  if (!removed) {
    if (blockedByOwner) {
      sendJson(response, 400, { error: ORGANIZATION_MEMBER_MESSAGES.lastOwner });
      return;
    }
    sendJson(response, 404, { error: ORGANIZATION_MEMBER_MESSAGES.missing });
    return;
  }

  const organizationTeamIds = new Set(
    teamsOfOrganization(context.teams, organization.id).map((team) => team.id),
  );
  await stores.teams.update((state) => {
    for (const team of state.teams) {
      if (!organizationTeamIds.has(team.id)) continue;
      team.memberIds = teamMemberIds(team).filter((accountId) => accountId !== target.id);
    }
  });

  const organizationRepositoryIds = new Set(
    context.repositories
      .filter(
        (repository) =>
          repository.ownerType === "organization" && repository.ownerId === organization.id,
      )
      .map((repository) => repository.id),
  );
  await stores.repositoryGrants.update((state) => {
    state.grants = state.grants.filter(
      (grant) =>
        !(
          grant.subjectType === "account" &&
          grant.subjectId === target.id &&
          organizationRepositoryIds.has(grant.repositoryId)
        ),
    );
  });

  const { memberships } = await stores.organizationMembers.read();
  sendJson(response, 200, { members: memberList(context, organization, memberships) });
}

async function handleOrganizationTeams({ request, response, stores, name }) {
  const context = await loadContext(stores);
  const organization = findOrganizationByName(context.organizations, name);
  if (!organization) {
    sendJson(response, 404, { error: "Organization not found" });
    return;
  }
  const account = await requireAccount(stores, request, response);
  if (!account) return;
  const role = organizationRole(context.memberships, organization.id, account.id);
  if (!role) {
    sendJson(response, 403, { error: "Access denied" });
    return;
  }
  const teams = teamsOfOrganization(context.teams, organization.id)
    .map((team) => teamSummary(team, context.teams))
    .sort((left, right) => left.name.localeCompare(right.name));
  sendJson(response, 200, { teams, viewerRole: role });
}

async function handleCreateTeam({ request, response, stores, name, body }) {
  const context = await loadContext(stores);
  const organization = findOrganizationByName(context.organizations, name);
  if (!organization) {
    sendJson(response, 404, { error: "Organization not found" });
    return;
  }
  const account = await requireAccount(stores, request, response);
  if (!account) return;
  if (!isOrganizationOwner(context.memberships, organization.id, account.id)) {
    sendJson(response, 403, { error: "Access denied" });
    return;
  }

  const teamName = typeof body.name === "string" ? body.name.trim() : "";
  const nameError = validateTeamName(teamName);
  const parentReference = readTeamParentId(body.parentTeamId);
  const parent = parentReference
    ? resolveParentTeam(context.teams, organization.id, parentReference)
    : null;
  const errors = {};
  if (nameError) errors.name = nameError;
  else if (teamsOfOrganization(context.teams, organization.id).some(
    (team) => organizationKey(team.name) === organizationKey(teamName),
  )) {
    errors.name = TEAM_MESSAGES.taken;
  }
  if (parentReference && !parent) {
    errors.parentTeamId = TEAM_MESSAGES.parentOrganization;
  }
  if (Object.keys(errors).length > 0) {
    sendJson(response, 400, { error: "Team creation failed", errors });
    return;
  }

  const team = {
    id: `team-${randomUUID()}`,
    organizationId: organization.id,
    name: teamName,
    description: readTeamDescription(body.description),
    parentTeamId: parent ? parent.id : null,
    createdById: account.id,
    createdAt: new Date().toISOString(),
    memberIds: [],
  };
  let created = false;
  await stores.teams.update((state) => {
    const duplicate = state.teams.some(
      (candidate) =>
        candidate.organizationId === organization.id &&
        organizationKey(candidate.name) === organizationKey(teamName),
    );
    if (duplicate) return;
    state.teams.push(team);
    created = true;
  });
  if (!created) {
    sendJson(response, 400, {
      error: "Team creation failed",
      errors: { name: TEAM_MESSAGES.taken },
    });
    return;
  }
  sendJson(response, 201, {
    team: teamPayload({ ...context, teams: [...context.teams, team] }, organization, team),
  });
}

async function loadTeamRequest({ request, response, stores, name, teamName, ownerOnly }) {
  const context = await loadContext(stores);
  const organization = findOrganizationByName(context.organizations, name);
  if (!organization) {
    sendJson(response, 404, { error: "Organization not found" });
    return null;
  }
  const account = await requireAccount(stores, request, response);
  if (!account) return null;
  const role = organizationRole(context.memberships, organization.id, account.id);
  if (!role || (ownerOnly && role !== "owner")) {
    sendJson(response, 403, { error: "Access denied" });
    return null;
  }
  const team = findTeamByName(context.teams, organization.id, teamName);
  if (!team) {
    sendJson(response, 404, { error: "Team not found" });
    return null;
  }
  return { context, organization, account, role, team };
}

async function handleTeamDetail(options) {
  const loaded = await loadTeamRequest({ ...options, ownerOnly: false });
  if (!loaded) return;
  sendJson(options.response, 200, {
    team: teamPayload(loaded.context, loaded.organization, loaded.team),
    viewerRole: loaded.role,
  });
}

async function handleAddTeamMember({ request, response, stores, name, teamName, body }) {
  const loaded = await loadTeamRequest({ request, response, stores, name, teamName, ownerOnly: true });
  if (!loaded) return;
  const { context, organization, team } = loaded;
  const identifier = typeof body.username === "string" ? body.username.trim() : "";
  const account = findAccountByIdentifier(context.accounts, identifier);
  const errors = {};
  if (!identifier) {
    errors.username = TEAM_MEMBER_MESSAGES.unknown;
  } else if (!account) {
    errors.username = TEAM_MEMBER_MESSAGES.unknown;
  } else if (!organizationRole(context.memberships, organization.id, account.id)) {
    errors.username = TEAM_MEMBER_MESSAGES.notMember;
  } else if (isTeamMember(team, account.id)) {
    errors.username = TEAM_MEMBER_MESSAGES.alreadyMember;
  }
  if (Object.keys(errors).length > 0) {
    sendJson(response, 400, { error: "Team member not added", errors });
    return;
  }
  let updated = null;
  await stores.teams.update((state) => {
    const target = state.teams.find((candidate) => candidate.id === team.id);
    if (!target) return;
    const memberIds = teamMemberIds(target);
    if (!memberIds.includes(account.id)) {
      target.memberIds = [...memberIds, account.id];
    }
    updated = target;
  });
  if (!updated) {
    sendJson(response, 404, { error: "Team not found" });
    return;
  }
  sendJson(response, 200, { team: teamPayload(context, organization, updated) });
}

async function handleRemoveTeamMember({ request, response, stores, name, teamName, username }) {
  const loaded = await loadTeamRequest({ request, response, stores, name, teamName, ownerOnly: true });
  if (!loaded) return;
  const { context, organization, team } = loaded;
  const account = findAccountByIdentifier(context.accounts, username);
  let updated = null;
  await stores.teams.update((state) => {
    const target = state.teams.find((candidate) => candidate.id === team.id);
    if (!target) return;
    target.memberIds = teamMemberIds(target).filter(
      (accountId) => !account || accountId !== account.id,
    );
    updated = target;
  });
  if (!updated) {
    sendJson(response, 404, { error: "Team not found" });
    return;
  }
  sendJson(response, 200, { team: teamPayload(context, organization, updated) });
}

async function handleSaveTeamParent({ request, response, stores, name, teamName, body }) {
  const loaded = await loadTeamRequest({ request, response, stores, name, teamName, ownerOnly: true });
  if (!loaded) return;
  const { context, organization, team } = loaded;
  const parentReference = readTeamParentId(body.parentTeamId);
  const parent = parentReference
    ? resolveParentTeam(context.teams, organization.id, parentReference)
    : null;
  const errors = {};
  if (parentReference && !parent) {
    errors.parentTeamId = TEAM_MESSAGES.parentOrganization;
  } else if (parent && wouldCreateTeamCycle(context.teams, team.id, parent.id)) {
    errors.parentTeamId = TEAM_MESSAGES.cycle;
  }
  if (Object.keys(errors).length > 0) {
    sendJson(response, 400, { error: "Parent team not saved", errors });
    return;
  }
  let updated = null;
  await stores.teams.update((state) => {
    const target = state.teams.find((candidate) => candidate.id === team.id);
    if (!target) return;
    target.parentTeamId = parent ? parent.id : null;
    updated = target;
  });
  if (!updated) {
    sendJson(response, 404, { error: "Team not found" });
    return;
  }
  sendJson(response, 200, { team: teamPayload(context, organization, updated) });
}

/**
 * Handles /api/organizations/*. Returns true when the request has been answered.
 */
export async function handleOrganizationRoutes({ request, response, url, stores, body }) {
  const segments = url.pathname.split("/").filter(Boolean).map(decodeSegment);
  if (segments[0] !== "api" || segments[1] !== "organizations") return false;
  const method = request.method ?? "GET";
  const rest = segments.slice(2);

  if (rest.length === 0) {
    if (method === "GET") {
      await handleListOrganizations({ request, response, stores, url });
      return true;
    }
    if (method === "POST") {
      await handleCreateOrganization({ request, response, stores, body });
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const [name, section, third, fourth] = rest;

  if (rest.length === 1 && method === "GET") {
    await handleOrganizationDetail({ request, response, stores, name });
    return true;
  }
  if (rest.length === 2 && section === "repositories" && method === "GET") {
    await handleOrganizationRepositories({ request, response, stores, name });
    return true;
  }
  if (rest.length === 2 && section === "people") {
    if (method === "GET") {
      await handleOrganizationPeople({ request, response, stores, name });
      return true;
    }
    if (method === "POST") {
      await handleAddOrganizationMember({ request, response, stores, name, body });
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }
  if (rest.length === 3 && section === "people" && third && method === "DELETE") {
    await handleRemoveOrganizationMember({
      request,
      response,
      stores,
      name,
      username: third,
    });
    return true;
  }
  if (rest.length === 2 && section === "teams") {
    if (method === "GET") {
      await handleOrganizationTeams({ request, response, stores, name });
      return true;
    }
    if (method === "POST") {
      await handleCreateTeam({ request, response, stores, name, body });
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }
  if (rest.length === 3 && section === "teams" && method === "GET") {
    await handleTeamDetail({ request, response, stores, name, teamName: third });
    return true;
  }
  if (rest.length === 4 && section === "teams" && third && fourth === "members" && method === "POST") {
    await handleAddTeamMember({ request, response, stores, name, teamName: third, body });
    return true;
  }
  if (rest.length === 4 && section === "teams" && third && fourth === "parent" && method === "PUT") {
    await handleSaveTeamParent({ request, response, stores, name, teamName: third, body });
    return true;
  }
  if (rest.length === 5 && section === "teams" && third && fourth === "members" && method === "DELETE") {
    await handleRemoveTeamMember({
      request,
      response,
      stores,
      name,
      teamName: third,
      username: rest[4],
    });
    return true;
  }
  sendJson(response, 404, { error: "Not found" });
  return true;
}