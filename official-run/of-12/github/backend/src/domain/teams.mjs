import { randomUUID } from "node:crypto";

import { findAccountByIdentifier, organizationMembership } from "./organizations.mjs";

/**
 * Organization teams (REQ-2-2-1 / REQ-2-2-2).
 *
 * A team always belongs to exactly one organization. Its name is a lower-case
 * identifier (1-50 characters of `[a-z0-9-]`, no leading or trailing hyphen)
 * that is unique inside that organization. The optional parent team must
 * belong to the same organization and may never create a direct or indirect
 * cycle. Team membership and team hierarchy are independent relationships:
 * neither ever adds members (or repository permission) to another team.
 */

export const TEAM_NAME_MAX_LENGTH = 50;
export const TEAM_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const TEAM_MESSAGES = {
  nameFormat: "Team name format is invalid",
  nameExists: "Team name already exists",
  parentNotFound: "Parent team does not belong to this organization",
  cycle: "Cyclic team hierarchy is not allowed",
  notFound: "Team not found",
  accountNotFound: "Account not found",
  alreadyTeamMember: "Account is already a member of this team",
  notOrganizationMember: "Account is not a member of this organization",
  forbidden: "Only an organization Owner can manage teams",
};

export function normalizeTeamName(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidTeamName(value) {
  const name = normalizeTeamName(value);
  if (!name || name.length > TEAM_NAME_MAX_LENGTH) return false;
  return TEAM_NAME_PATTERN.test(name);
}

/** Resolves a team of an organization by its name or its stored id. */
export function findTeam(data, organizationId, identifier) {
  if (typeof identifier !== "string") return null;
  const raw = identifier.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return data.teams.find((team) => team.organizationId === organizationId && team.name === lower)
    ?? data.teams.find((team) => team.organizationId === organizationId && team.id === raw)
    ?? null;
}

export function organizationTeams(data, organizationId) {
  const teams = data.teams.filter((team) => team.organizationId === organizationId);
  return teams
    .map((team) => {
      const parent = teams.find((candidate) => candidate.id === team.parentTeamId) ?? null;
      return teamSummary(team, parent);
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function teamSummary(team, parent) {
  return {
    name: team.name,
    description: team.description ?? "",
    parentTeamName: parent ? parent.name : null,
    createdAt: team.createdAt ?? null,
  };
}

export function teamMemberUsernames(data, teamId) {
  return data.teamMembers
    .filter((member) => member.teamId === teamId)
    .map((member) => data.accounts.find((account) => account.id === member.accountId)?.username ?? null)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

export function organizationTeamNames(data, organizationId) {
  return data.teams
    .filter((team) => team.organizationId === organizationId)
    .map((team) => team.name)
    .sort((left, right) => left.localeCompare(right));
}

/** True when making `parentTeamId` the parent of `teamId` would close a cycle. */
export function createsCycle(data, teamId, parentTeamId) {
  let current = parentTeamId;
  const seen = new Set();
  while (current) {
    if (current === teamId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = data.teams.find((team) => team.id === current)?.parentTeamId ?? null;
  }
  return false;
}

/**
 * Validates the team fields inside an atomic update and resolves the optional
 * parent team to a team of the same organization.
 */
function validateTeamInput(data, organizationId, input, ignoreTeamId = null) {
  const errors = {};
  // The stored name is the lower-case identifier itself: an input with upper
  // case letters is malformed instead of being silently normalized.
  const name = normalizeTeamName(input.name);
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const parentName = normalizeTeamName(input.parentTeam);

  const duplicate = data.teams.find(
    (team) => team.organizationId === organizationId
      && team.name === name.toLowerCase()
      && team.id !== ignoreTeamId,
  );
  if (!isValidTeamName(name)) errors.name = TEAM_MESSAGES.nameFormat;
  else if (duplicate) errors.name = TEAM_MESSAGES.nameExists;

  let parentTeam = null;
  if (parentName) {
    parentTeam = findTeam(data, organizationId, parentName);
    if (!parentTeam) errors.parentTeam = TEAM_MESSAGES.parentNotFound;
  }

  return { errors, name, description, parentTeam };
}

/** Creates a team inside an organization. */
export async function createTeam(store, organizationId, accountId, input) {
  const data = await store.read();
  const membership = organizationMembership(data, organizationId, accountId);
  if (membership?.role !== "Owner") return { ok: false, forbidden: true };

  let outcome = null;
  await store.update((draft) => {
    const check = organizationMembership(draft, organizationId, accountId);
    if (check?.role !== "Owner") {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }
    const { errors, name, description, parentTeam } = validateTeamInput(draft, organizationId, input);
    if (Object.keys(errors).length > 0) {
      outcome = { ok: false, errors };
      return undefined;
    }
    const team = {
      id: randomUUID(),
      organizationId,
      name,
      description,
      parentTeamId: parentTeam ? parentTeam.id : null,
      createdBy: accountId,
      createdAt: new Date().toISOString(),
    };
    draft.teams.push(team);
    outcome = { ok: true, team: teamSummary(team, parentTeam) };
    return draft;
  });
  return outcome;
}

/**
 * Sets (or clears) the parent team of a team. Anything that would make the
 * team its own ancestor is rejected and leaves the stored hierarchy untouched.
 */
export async function updateTeamParent(store, teamId, accountId, parentTeam) {
  let outcome = null;
  await store.update((draft) => {
    const team = draft.teams.find((candidate) => candidate.id === teamId);
    if (!team) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    if (organizationMembership(draft, team.organizationId, accountId)?.role !== "Owner") {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }
    const parentName = normalizeTeamName(parentTeam);
    let parent = null;
    if (parentName) {
      parent = findTeam(draft, team.organizationId, parentName);
      if (!parent) {
        outcome = { ok: false, errors: { parentTeam: TEAM_MESSAGES.parentNotFound } };
        return undefined;
      }
    }
    if (parent && createsCycle(draft, team.id, parent.id)) {
      outcome = { ok: false, errors: { parentTeam: TEAM_MESSAGES.cycle } };
      return undefined;
    }
    team.parentTeamId = parent ? parent.id : null;
    outcome = { ok: true, team: teamSummary(team, parent) };
    return draft;
  });
  return outcome;
}

/** Adds an organization member to a team. */
export async function addTeamMember(store, teamId, accountId, identifier) {
  let outcome = null;
  await store.update((draft) => {
    const team = draft.teams.find((candidate) => candidate.id === teamId);
    if (!team) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    if (organizationMembership(draft, team.organizationId, accountId)?.role !== "Owner") {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }
    const account = findAccountByIdentifier(draft, identifier);
    if (!account) {
      outcome = { ok: false, errors: { username: TEAM_MESSAGES.accountNotFound } };
      return undefined;
    }
    if (!organizationMembership(draft, team.organizationId, account.id)) {
      outcome = { ok: false, errors: { username: TEAM_MESSAGES.notOrganizationMember } };
      return undefined;
    }
    const existing = draft.teamMembers.find(
      (member) => member.teamId === team.id && member.accountId === account.id,
    );
    if (existing) {
      outcome = { ok: false, errors: { username: TEAM_MESSAGES.alreadyTeamMember } };
      return undefined;
    }
    draft.teamMembers.push({ teamId: team.id, accountId: account.id, createdAt: new Date().toISOString() });
    outcome = { ok: true, member: account.username };
    return draft;
  });
  return outcome;
}

/** Removes a team membership; the organization membership is untouched. */
export async function removeTeamMember(store, teamId, accountId, identifier) {
  let outcome = null;
  await store.update((draft) => {
    const team = draft.teams.find((candidate) => candidate.id === teamId);
    if (!team) {
      outcome = { ok: false, missing: true };
      return undefined;
    }
    if (organizationMembership(draft, team.organizationId, accountId)?.role !== "Owner") {
      outcome = { ok: false, forbidden: true };
      return undefined;
    }
    const account = findAccountByIdentifier(draft, identifier);
    if (!account) {
      outcome = { ok: false, errors: { username: TEAM_MESSAGES.accountNotFound } };
      return undefined;
    }
    const before = draft.teamMembers.length;
    draft.teamMembers = draft.teamMembers.filter(
      (member) => !(member.teamId === team.id && member.accountId === account.id),
    );
    if (draft.teamMembers.length === before) {
      outcome = { ok: false, errors: { username: TEAM_MESSAGES.notOrganizationMember } };
      return undefined;
    }
    outcome = { ok: true, member: account.username };
    return draft;
  });
  return outcome;
}
