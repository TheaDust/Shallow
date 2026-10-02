import { randomUUID } from "node:crypto";

import { findAccountByUsername } from "./identity.mjs";
import { findMembership } from "./organizations.mjs";
import { MESSAGES, hasErrors, normalizeTeamName, validateTeamFields } from "./validation.mjs";

export function toPublicTeam(team) {
  if (!team) return null;
  return { id: team.id, name: team.name, parentTeamId: team.parentTeamId ?? null };
}

function normalizeKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function findTeamById(state, teamId) {
  if (!teamId) return null;
  return state.teams.find((team) => team.id === teamId) ?? null;
}

export function findTeamByName(state, organizationId, name) {
  const needle = normalizeKey(name);
  if (!needle) return null;
  return state.teams.find((team) => (
    team.organizationId === organizationId && normalizeKey(team.name) === needle
  )) ?? null;
}

/** Teams of one organization, ordered by name for a stable list. */
export function listOrganizationTeams(state, organizationId) {
  return state.teams
    .filter((team) => team.organizationId === organizationId)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function isTeamNameTaken(state, organizationId, name) {
  return Boolean(findTeamByName(state, organizationId, name));
}

/** The parent team of a team, or null for a root team. */
export function parentTeamOf(state, team) {
  return findTeamById(state, team?.parentTeamId ?? null);
}

/**
 * Walks up from `startTeamId` through the parent chain and reports whether the
 * chain reaches `ancestorTeamId`. Used to reject a hierarchy change that would
 * make a team its own direct or indirect ancestor.
 */
function reachesAncestor(state, startTeamId, ancestorTeamId) {
  const visited = new Set();
  let current = startTeamId;
  while (current && !visited.has(current)) {
    if (current === ancestorTeamId) return true;
    visited.add(current);
    current = state.teams.find((team) => team.id === current)?.parentTeamId ?? null;
  }
  return false;
}

function resolveParent(state, organizationId, input = {}) {
  // An empty submission clears the parent; any other value names a team.
  const raw = input.parentTeamName ?? input.parentTeamId ?? "";
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) return { parent: null };
  const parent = findTeamByName(state, organizationId, value) ?? findTeamById(state, value);
  if (!parent || parent.organizationId !== organizationId) return { error: MESSAGES.parentTeamNotFound };
  return { parent };
}

/**
 * Creates a team inside one organization. The name rules come from the shared
 * validation module; uniqueness is scoped to the organization. A rejected
 * submission leaves the state untouched.
 */
export function createTeam(state, organization, input = {}) {
  const { errors, values } = validateTeamFields(input);
  if (!hasErrors(errors) && isTeamNameTaken(state, organization.id, values.name)) {
    errors.name = MESSAGES.teamNameExists;
  }
  if (hasErrors(errors)) return { errors };

  const team = {
    id: randomUUID(),
    organizationId: organization.id,
    name: values.name,
    parentTeamId: null,
    createdAt: new Date().toISOString(),
  };
  state.teams.push(team);
  return { team };
}

/**
 * Stores the parent of a team. The parent must belong to the same organization
 * and neither be the team itself nor one of its descendants; otherwise the
 * previously saved parent is kept and the reason is returned.
 */
export function setParentTeam(state, organizationId, team, input = {}) {
  const resolved = resolveParent(state, organizationId, input);
  if (resolved.error) return { errors: { parentTeam: resolved.error } };

  const parent = resolved.parent;
  if (parent) {
    if (parent.id === team.id || reachesAncestor(state, parent.id, team.id)) {
      return { errors: { parentTeam: MESSAGES.cyclicTeamHierarchy } };
    }
  }
  team.parentTeamId = parent ? parent.id : null;
  return { team };
}

export function listTeamMembers(state, teamId) {
  return state.teamMembers
    .filter((membership) => membership.teamId === teamId)
    .map((membership) => state.accounts.find((account) => account.id === membership.accountId))
    .filter(Boolean)
    .sort((left, right) => left.username.localeCompare(right.username));
}

/** Public member rows of a team: only the username is exposed. */
export function teamMemberRows(state, teamId) {
  return listTeamMembers(state, teamId).map((account) => ({ username: account.username }));
}

/**
 * Adds an existing organization member to a team. Team membership is an
 * independent relationship: it never adds the account to a parent or child
 * team, and it never changes organization membership.
 */
export function addTeamMember(state, organizationId, team, input = {}) {
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const account = findAccountByUsername(state, username);
  if (!account) return { errors: { username: MESSAGES.accountNotFound } };
  if (!findMembership(state, organizationId, account.id)) {
    return { errors: { username: MESSAGES.accountNotOrganizationMember } };
  }
  const existing = state.teamMembers.find((membership) => (
    membership.teamId === team.id && membership.accountId === account.id
  ));
  if (existing) return { member: account, alreadyMember: true };

  state.teamMembers.push({
    id: randomUUID(),
    teamId: team.id,
    accountId: account.id,
    createdAt: new Date().toISOString(),
  });
  return { member: account };
}

/** Removes a team membership only; organization membership is left untouched. */
export function removeTeamMember(state, team, username) {
  const account = findAccountByUsername(state, username);
  if (!account) return { removed: false };
  const before = state.teamMembers.length;
  state.teamMembers = state.teamMembers.filter((membership) => (
    membership.teamId !== team.id || membership.accountId !== account.id
  ));
  return { removed: state.teamMembers.length !== before };
}