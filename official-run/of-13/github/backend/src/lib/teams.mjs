import { randomUUID } from "node:crypto";

import {
  isOrganizationOwner,
  isTeamDescendantOf,
  organizationByName,
  teamById,
  teamMemberOf,
  teamsOf,
  teamsOfOrganization,
} from "./access.mjs";
import { isValidTeamName } from "./validation.mjs";

export const TEAM_MESSAGES = {
  nameFormat: "Team name format is invalid",
  nameExists: "Team name already exists",
  parentInvalid: "Parent team is invalid",
  cycle: "Cyclic team hierarchy is not allowed",
  teamNotFound: "Team not found",
  organizationNotFound: "Organization not found",
  accessDenied: "Access denied",
  accountNotFound: "Account not found",
  notOrganizationMember: "Account is not an organization member",
  alreadyTeamMember: "Account is already a team member",
  teamMemberNotFound: "Account is not a team member",
};

let clock = () => new Date().toISOString();

function accountById(state, id) {
  return (state.accounts ?? []).find((account) => account.id === id) ?? null;
}

function accountByIdentifier(state, identifier) {
  const value = typeof identifier === "string" ? identifier.trim() : "";
  if (value.length === 0) return null;
  return (
    (state.accounts ?? []).find(
      (account) => account.username === value || account.email === value,
    ) ?? null
  );
}

/** Public team payload: the identifier pair plus the resolved parent name. */
export function publicTeam(state, team) {
  return {
    id: team.id,
    name: team.name,
    description: team.description ?? null,
    parentTeamId: team.parentTeamId ?? null,
    parent: teamById(state, team.parentTeamId)?.name ?? null,
    createdAt: team.createdAt ?? null,
  };
}

function resolveParentInput(input) {
  const source = input ?? {};
  if (source.parentTeamId !== undefined && source.parentTeamId !== null) {
    return typeof source.parentTeamId === "string" ? source.parentTeamId.trim() : "";
  }
  if (source.parent !== undefined && source.parent !== null) {
    return typeof source.parent === "string" ? source.parent.trim() : "";
  }
  return "";
}

/**
 * Team creation, hierarchy and direct membership. Every mutation runs inside
 * one store update so a rejected name, parent or cycle leaves the state as it
 * was.
 */
export function createTeamService(store) {
  async function list(organizationName) {
    const state = await store.read();
    const organization = organizationByName(state, organizationName);
    if (!organization) return null;
    return teamsOfOrganization(state, organization.id)
      .map((team) => publicTeam(state, team))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async function create(organizationName, accountId, input) {
    const name = typeof input?.name === "string" ? input.name.trim() : "";
    const description = typeof input?.description === "string" ? input.description.trim() : "";
    const parentValue = resolveParentInput(input);

    let outcome = { ok: false, fieldErrors: {} };
    await store.update((state) => {
      const organization = organizationByName(state, organizationName);
      if (!organization) {
        outcome = { notFound: true };
        return;
      }
      if (!isOrganizationOwner(state, organization.id, accountId)) {
        outcome = { forbidden: true };
        return;
      }
      if (!isValidTeamName(name)) {
        outcome = { ok: false, fieldErrors: { name: TEAM_MESSAGES.nameFormat } };
        return;
      }
      const siblings = teamsOfOrganization(state, organization.id);
      if (siblings.some((team) => team.name === name)) {
        outcome = { ok: false, fieldErrors: { name: TEAM_MESSAGES.nameExists } };
        return;
      }

      let parent = null;
      if (parentValue.length > 0) {
        parent =
          siblings.find((team) => team.id === parentValue || team.name === parentValue) ?? null;
        if (!parent) {
          // A parent outside the current organization is never accepted.
          outcome = { ok: false, fieldErrors: { parent: TEAM_MESSAGES.parentInvalid } };
          return;
        }
      }

      const team = {
        id: `team-${randomUUID()}`,
        organizationId: organization.id,
        name,
        description: description.length > 0 ? description : null,
        parentTeamId: parent?.id ?? null,
        createdBy: accountId,
        createdAt: clock(),
      };
      state.teams = [...(state.teams ?? []), team];
      outcome = { ok: true, team: publicTeam(state, team) };
    });
    return outcome;
  }

  async function detail(organizationName, teamName, accountId) {
    const state = await store.read();
    const organization = organizationByName(state, organizationName);
    if (!organization) return null;
    const team = teamsOfOrganization(state, organization.id).find(
      (candidate) => candidate.name === teamName,
    );
    if (!team) return null;

    const members = (state.teamMembers ?? [])
      .filter((teamMember) => teamMember.teamId === team.id)
      .map((teamMember) => accountById(state, teamMember.accountId))
      .filter(Boolean)
      .map((account) => ({ username: account.username }))
      .sort((left, right) => left.username.localeCompare(right.username));

    const canManage = isOrganizationOwner(state, organization.id, accountId);
    return {
      organization: { name: organization.name, displayName: organization.displayName },
      team: publicTeam(state, team),
      members,
      viewerRole: canManage ? "owner" : null,
      canManage,
    };
  }

  async function addMember(organizationName, teamName, accountId, input) {
    const identifier =
      typeof input?.username === "string"
        ? input.username.trim()
        : typeof input?.identifier === "string"
          ? input.identifier.trim()
          : "";

    let outcome = { ok: false, fieldErrors: {} };
    await store.update((state) => {
      const organization = organizationByName(state, organizationName);
      if (!organization) {
        outcome = { notFound: true };
        return;
      }
      const team = teamsOfOrganization(state, organization.id).find(
        (candidate) => candidate.name === teamName,
      );
      if (!team) {
        outcome = { notFound: true };
        return;
      }
      if (!isOrganizationOwner(state, organization.id, accountId)) {
        outcome = { forbidden: true };
        return;
      }
      const account = accountByIdentifier(state, identifier);
      if (!account) {
        outcome = { ok: false, fieldErrors: { username: TEAM_MESSAGES.accountNotFound } };
        return;
      }
      const isOrganizationMember = (state.memberships ?? []).some(
        (membership) =>
          membership.organizationId === organization.id && membership.accountId === account.id,
      );
      if (!isOrganizationMember) {
        outcome = { ok: false, fieldErrors: { username: TEAM_MESSAGES.notOrganizationMember } };
        return;
      }
      if (teamMemberOf(state, team.id, account.id)) {
        outcome = { ok: false, fieldErrors: { username: TEAM_MESSAGES.alreadyTeamMember } };
        return;
      }
      state.teamMembers = [
        ...(state.teamMembers ?? []),
        { id: `team-member-${randomUUID()}`, teamId: team.id, accountId: account.id },
      ];
      outcome = { ok: true, member: { username: account.username } };
    });
    return outcome;
  }

  async function removeMember(organizationName, teamName, accountId, username) {
    let outcome = { ok: false, fieldErrors: {} };
    await store.update((state) => {
      const organization = organizationByName(state, organizationName);
      if (!organization) {
        outcome = { notFound: true };
        return;
      }
      const team = teamsOfOrganization(state, organization.id).find(
        (candidate) => candidate.name === teamName,
      );
      if (!team) {
        outcome = { notFound: true };
        return;
      }
      if (!isOrganizationOwner(state, organization.id, accountId)) {
        outcome = { forbidden: true };
        return;
      }
      const account = accountByIdentifier(state, username);
      const teamMember = account ? teamMemberOf(state, team.id, account.id) : null;
      if (!teamMember) {
        outcome = { ok: false, fieldErrors: { username: TEAM_MESSAGES.teamMemberNotFound } };
        return;
      }
      state.teamMembers = (state.teamMembers ?? []).filter(
        (candidate) => candidate.id !== teamMember.id,
      );
      outcome = { ok: true };
    });
    return outcome;
  }

  /** Stores the parent relationship; a cycle keeps the stored parent intact. */
  async function setParent(organizationName, teamName, accountId, input) {
    const parentValue = resolveParentInput(input);
    const hasParent = parentValue.length > 0;

    let outcome = { ok: false, fieldErrors: {} };
    await store.update((state) => {
      const organization = organizationByName(state, organizationName);
      if (!organization) {
        outcome = { notFound: true };
        return;
      }
      const team = teamsOfOrganization(state, organization.id).find(
        (candidate) => candidate.name === teamName,
      );
      if (!team) {
        outcome = { notFound: true };
        return;
      }
      if (!isOrganizationOwner(state, organization.id, accountId)) {
        outcome = { forbidden: true };
        return;
      }

      let parent = null;
      if (hasParent) {
        parent =
          teamsOfOrganization(state, organization.id).find(
            (candidate) => candidate.id === parentValue || candidate.name === parentValue,
          ) ?? null;
        if (!parent) {
          outcome = { ok: false, fieldErrors: { parent: TEAM_MESSAGES.parentInvalid } };
          return;
        }
        if (parent.id === team.id || isTeamDescendantOf(state, parent.id, team.id)) {
          outcome = { ok: false, fieldErrors: { parent: TEAM_MESSAGES.cycle } };
          return;
        }
      }

      const next = { ...team, parentTeamId: parent?.id ?? null };
      state.teams = teamsOf(state).map((candidate) => (candidate.id === team.id ? next : candidate));
      outcome = { ok: true, team: publicTeam(state, next) };
    });
    return outcome;
  }

  return { list, create, detail, addMember, removeMember, setParent };
}
