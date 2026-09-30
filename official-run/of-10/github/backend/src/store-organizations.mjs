/**
 * Organization, membership and team mutations (REQ-2).
 *
 * Every write runs inside one `jsonStore.update`, so a rejected request leaves
 * the membership, team and grant relationships exactly as they were. The
 * handlers receive the shared store helpers (`resolveViewer`) so the current
 * session decides identity and permissions on the server side.
 */

import { randomUUID } from "node:crypto";

import {
  MEMBER_MESSAGES,
  ORGANIZATION_MESSAGES,
  ORGANIZATION_MEMBER_MESSAGE,
  ORGANIZATION_OWNER_MESSAGE,
  TEAM_MESSAGES,
  TEAM_MEMBER_MESSAGES,
  countOrganizationOwners,
  findOrganization,
  findTeam,
  findTeamById,
  isValidOrganizationName,
  isValidTeamName,
  isOrganizationOwner,
  isTeamMember,
  listOrganizationTeams,
  listTeamMembers,
  normalizeDisplayName,
  normalizeMemberRole,
  normalizeOrganizationName,
  normalizeTeamName,
  organizationMember,
  toOrganizationMemberPayload,
  toOrganizationPayload,
  toTeamPayload,
  wouldCreateTeamCycle,
} from "./domain/organizations.mjs";
import { canViewRepository, toRepositorySummary } from "./domain/repositories.mjs";

function failure(status, error, fields) {
  return { ok: false, status, error, fields: fields ?? {} };
}

function findAccountByUsername(state, username) {
  const wanted = String(username ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return (
    (state.accounts ?? []).find((account) => account.username.toLowerCase() === wanted) ?? null
  );
}

function findAccountByEmail(state, email) {
  const wanted = String(email ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return (
    (state.accounts ?? []).find(
      (account) => String(account.email ?? "").toLowerCase() === wanted,
    ) ?? null
  );
}

/** The account of a username, or of a verified email address, of one identifier. */
function findMemberCandidate(state, identifier) {
  const account = findAccountByUsername(state, identifier) ?? findAccountByEmail(state, identifier);
  if (!account) return null;
  if (account.emailVerified !== true) return null;
  return account;
}

/**
 * Deletes a member's organization relationship, every team membership of that
 * account in this organization and every direct grant to that account on a
 * repository of the organization. Team grants themselves and the account's
 * personal data stay untouched.
 */
function removeMemberRelationships(state, organization, accountId) {
  organization.members = (organization.members ?? []).filter(
    (member) => member.accountId !== accountId,
  );  const teamIds = new Set(
    (state.teams ?? [])
      .filter((team) => team.organizationId === organization.id)
      .map((team) => team.id),
  );
  state.teamMemberships = (state.teamMemberships ?? []).filter(
    (membership) => !(membership.accountId === accountId && teamIds.has(membership.teamId)),
  );
  const repositoryIds = new Set(
    (state.repositories ?? [])
      .filter((repository) => repository.owner.type === "organization" && repository.owner.id === organization.id)
      .map((repository) => repository.id),
  );
  state.repositoryGrants = (state.repositoryGrants ?? []).filter(
    (grant) =>
      !(
        grant.subjectType === "account" &&
        grant.subjectId === accountId &&
        repositoryIds.has(grant.repositoryId)
      ),
  );
}

export function createOrganizationHandlers({ jsonStore, resolveViewer }) {
  /** Organizations of the current session; a visitor cannot list any. */
  async function listViewerOrganizations(sessionId) {
    const state = await jsonStore.read();
    const viewer = resolveViewer(state, sessionId);
    if (!viewer) return failure(401, "Not authenticated");
    const organizations = (state.organizations ?? [])
      .filter((organization) => organizationMember(organization, viewer.id))
      .sort((left, right) => left.login.localeCompare(right.login))
      .map((organization) => ({
        ...toOrganizationPayload(organization),
        viewerRole: organizationMember(organization, viewer.id).role,
      }));
    return { ok: true, organizations };
  }

  /**
   * Creates the organization together with the creator's Owner membership in one
   * atomic write. The identifier is globally unique; the display name only has
   * to survive trimming.
   */
  async function createOrganization(sessionId, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const viewer = resolveViewer(state, sessionId);
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      const login = normalizeOrganizationName(input.name);
      const displayName = normalizeDisplayName(input.displayName);
      const fields = {};
      if (!isValidOrganizationName(login)) fields.name = ORGANIZATION_MESSAGES.nameFormat;
      else if (
        findOrganization(state, login) ||
        (state.accounts ?? []).some(
          (account) => account.username.toLowerCase() === login.trim().toLowerCase(),
        )
      ) {
        fields.name = ORGANIZATION_MESSAGES.nameExists;
      }
      if (!displayName) fields.displayName = ORGANIZATION_MESSAGES.displayNameRequired;
      else if (displayName.length > 100) {
        fields.displayName = ORGANIZATION_MESSAGES.displayNameTooLong;
      }
      if (Object.keys(fields).length > 0) {
        outcome = failure(400, "Organization creation failed", fields);
        return;
      }

      const organization = {
        id: randomUUID(),
        login: login.trim(),
        name: displayName,
        createdAt: new Date().toISOString(),
        createdBy: { accountId: viewer.id, login: viewer.username },
        members: [
          { accountId: viewer.id, role: "owner", createdAt: new Date().toISOString() },
        ],
      };
      state.organizations = state.organizations ?? [];
      state.organizations.push(organization);
      outcome = {
        ok: true,
        status: 201,
        organization: { ...toOrganizationPayload(organization), viewerRole: "owner" },
      };
    });
    return outcome;
  }

  /** Organization identity plus the viewer's membership, for any viewer. */
  async function getOrganization(sessionId, login) {
    const state = await jsonStore.read();
    const organization = findOrganization(state, login);
    if (!organization) return failure(404, ORGANIZATION_MESSAGES.notFound);
    const viewer = resolveViewer(state, sessionId);
    const membership = viewer ? organizationMember(organization, viewer.id) : null;
    return {
      ok: true,
      organization: toOrganizationPayload(organization),
      viewer: {
        role: membership ? membership.role : null,
        isMember: Boolean(membership),
        isOwner: membership?.role === "owner",
      },
    };
  }

  /** Repositories of the organization the current viewer may read. */
  async function listOrganizationRepositories(sessionId, login) {
    const state = await jsonStore.read();
    const organization = findOrganization(state, login);
    if (!organization) return failure(404, "Not found");
    const viewer = resolveViewer(state, sessionId);
    const repositories = (state.repositories ?? [])
      .filter(
        (repository) =>
          repository.owner.type === "organization" && repository.owner.id === organization.id,
      )
      .filter((repository) => canViewRepository(state, repository, viewer))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((repository) => toRepositorySummary(repository, state));
    return { ok: true, organization: toOrganizationPayload(organization), repositories };
  }

  /** People list: readable by members only; a visitor learns nothing. */
  async function listOrganizationMembers(sessionId, login) {
    const state = await jsonStore.read();
    const organization = findOrganization(state, login);
    if (!organization) return failure(404, "Not found");
    const viewer = resolveViewer(state, sessionId);
    const membership = viewer ? organizationMember(organization, viewer.id) : null;
    if (!membership) return failure(403, ORGANIZATION_MEMBER_MESSAGE);
    const members = (organization.members ?? []).map((member) =>
      toOrganizationMemberPayload(state, member),
    );
    return {
      ok: true,
      organization: toOrganizationPayload(organization),
      viewer: { role: membership.role, isOwner: membership.role === "owner", isMember: true },
      members,
    };
  }

  /** An Owner adds an existing, verified account directly: no invitation step. */
  async function addOrganizationMember(sessionId, login, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const organization = findOrganization(state, login);
      if (!organization) {
        outcome = failure(404, "Not found");
        return;
      }
      const viewer = resolveViewer(state, sessionId);
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      if (!isOrganizationOwner(organization, viewer.id)) {
        outcome = failure(403, ORGANIZATION_OWNER_MESSAGE);
        return;
      }
      const role = String(input.role ?? "").trim().toLowerCase();
      const fields = {};
      const account = findMemberCandidate(state, input.identifier ?? input.username);
      if (!account) fields.identifier = MEMBER_MESSAGES.notFound;
      else if (organizationMember(organization, account.id)) {
        fields.identifier = MEMBER_MESSAGES.alreadyMember;
      }
      if (role && role !== "member" && role !== "owner") fields.role = MEMBER_MESSAGES.role;
      if (Object.keys(fields).length > 0) {
        outcome = failure(400, "Member addition failed", fields);
        return;
      }
      const member = {
        accountId: account.id,
        role: normalizeMemberRole(role),
        createdAt: new Date().toISOString(),
      };
      organization.members.push(member);
      outcome = {
        ok: true,
        status: 201,
        member: toOrganizationMemberPayload(state, member),
        organization: toOrganizationPayload(organization),
      };
    });
    return outcome;
  }

  /**
   * Removes a member and every relationship the removal rule deletes. The last
   * Owner cannot be removed, and the account's own data is never touched.
   */
  async function removeOrganizationMember(sessionId, login, username) {
    let outcome;
    await jsonStore.update((state) => {
      const organization = findOrganization(state, login);
      if (!organization) {
        outcome = failure(404, "Not found");
        return;
      }
      const viewer = resolveViewer(state, sessionId);
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      if (!isOrganizationOwner(organization, viewer.id)) {
        outcome = failure(403, ORGANIZATION_OWNER_MESSAGE);
        return;
      }
      const account = findAccountByUsername(state, username);
      const membership = account ? organizationMember(organization, account.id) : null;
      if (!account || !membership) {
        outcome = failure(404, "Member not found");
        return;
      }
      if (membership.role === "owner" && countOrganizationOwners(organization) <= 1) {
        outcome = failure(400, MEMBER_MESSAGES.lastOwner, {});
        return;
      }
      removeMemberRelationships(state, organization, account.id);
      outcome = {
        ok: true,
        removedAccountId: account.id,
        organization: toOrganizationPayload(organization),
      };
    });
    return outcome;
  }

  /** Teams list: members see the hierarchy, non-members get no information. */
  async function listOrganizationTeamsForViewer(sessionId, login) {
    const state = await jsonStore.read();
    const organization = findOrganization(state, login);
    if (!organization) return failure(404, "Not found");
    const viewer = resolveViewer(state, sessionId);
    const membership = viewer ? organizationMember(organization, viewer.id) : null;
    if (!membership) return failure(403, ORGANIZATION_MEMBER_MESSAGE);
    return {
      ok: true,
      organization: toOrganizationPayload(organization),
      viewer: { role: membership.role, isOwner: membership.role === "owner", isMember: true },
      teams: listOrganizationTeams(state, organization.id).map((team) => ({
        ...toTeamPayload(state, team),
        memberCount: (state.teamMemberships ?? []).filter((entry) => entry.teamId === team.id).length,
      })),
    };
  }

  /** Only an organization Owner creates teams; the parent stays in the organization. */
  async function createOrganizationTeam(sessionId, login, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const organization = findOrganization(state, login);
      if (!organization) {
        outcome = failure(404, "Not found");
        return;
      }
      const viewer = resolveViewer(state, sessionId);
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      if (!isOrganizationOwner(organization, viewer.id)) {
        outcome = failure(403, ORGANIZATION_OWNER_MESSAGE);
        return;
      }
      const name = normalizeTeamName(input.name);
      const fields = {};
      if (!isValidTeamName(name)) fields.name = TEAM_MESSAGES.nameFormat;
      else if (findTeam(state, organization.id, name)) fields.name = TEAM_MESSAGES.nameExists;

      let parentTeam = null;
      const parentRef = String(input.parentTeam ?? "").trim();
      if (parentRef) {
        parentTeam = findTeam(state, organization.id, parentRef) ?? findTeamById(state, parentRef);
        if (!parentTeam || parentTeam.organizationId !== organization.id) {
          fields.parentTeam = TEAM_MESSAGES.parentNotInOrganization;
        }
      }
      if (Object.keys(fields).length > 0) {
        outcome = failure(400, "Team creation failed", fields);
        return;
      }

      const team = {
        id: randomUUID(),
        organizationId: organization.id,
        name,
        description: String(input.description ?? "").trim(),
        parentTeamId: parentTeam ? parentTeam.id : null,
        createdBy: { accountId: viewer.id, login: viewer.username },
        createdAt: new Date().toISOString(),
      };
      state.teams = state.teams ?? [];
      state.teams.push(team);
      outcome = { ok: true, status: 201, team: toTeamPayload(state, team) };
    });
    return outcome;
  }

  /** Team detail with its direct members and the selectable parent teams. */
  async function getOrganizationTeam(sessionId, login, teamName) {
    const state = await jsonStore.read();
    const organization = findOrganization(state, login);
    if (!organization) return failure(404, "Not found");
    const team = findTeam(state, organization.id, teamName);
    if (!team) return failure(404, TEAM_MESSAGES.notFound);
    const viewer = resolveViewer(state, sessionId);
    const membership = viewer ? organizationMember(organization, viewer.id) : null;
    if (!membership) return failure(403, ORGANIZATION_MEMBER_MESSAGE);
    const members = listTeamMembers(state, team.id);
    return {
      ok: true,
      organization: toOrganizationPayload(organization),
      viewer: { role: membership.role, isOwner: membership.role === "owner", isMember: true },
      team: toTeamPayload(state, team),
      members,
      // Every team of the organization is selectable, including the team itself
      // and its descendants: an assignment that would create a cycle is a
      // rejected save ("Cyclic team hierarchy is not allowed"), not a hidden
      // option, so the maintainer can see the rule enforced.
      parentOptions: listOrganizationTeams(state, organization.id).map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
      })),
    };
  }

  /**
   * Re-parents a team inside the same organization. A parent that is the team
   * itself or one of its descendants would create a cycle and is rejected
   * without writing anything.
   */
  async function setOrganizationTeamParent(sessionId, login, teamName, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const organization = findOrganization(state, login);
      if (!organization) {
        outcome = failure(404, "Not found");
        return;
      }
      const team = findTeam(state, organization.id, teamName);
      if (!team) {
        outcome = failure(404, TEAM_MESSAGES.notFound);
        return;
      }
      const viewer = resolveViewer(state, sessionId);
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      if (!isOrganizationOwner(organization, viewer.id)) {
        outcome = failure(403, ORGANIZATION_OWNER_MESSAGE);
        return;
      }
      const parentRef = String(input.parentTeam ?? "").trim();
      let parentTeam = null;
      if (parentRef) {
        parentTeam = findTeam(state, organization.id, parentRef) ?? findTeamById(state, parentRef);
        if (!parentTeam || parentTeam.organizationId !== organization.id) {
          outcome = failure(400, "Team update failed", {
            parentTeam: TEAM_MESSAGES.parentNotInOrganization,
          });
          return;
        }
        if (wouldCreateTeamCycle(state, team, parentTeam)) {
          outcome = failure(400, "Team update failed", { parentTeam: TEAM_MESSAGES.cycle });
          return;
        }
      }
      team.parentTeamId = parentTeam ? parentTeam.id : null;
      outcome = { ok: true, team: toTeamPayload(state, team) };
    });
    return outcome;
  }

  /**
   * Adds one existing organization member to the team as a direct team
   * membership. Organization membership and team membership stay independent
   * relationships: a non-member account is refused and no hierarchy level ever
   * contributes a membership.
   */
  async function addOrganizationTeamMember(sessionId, login, teamName, input = {}) {
    let outcome;
    await jsonStore.update((state) => {
      const organization = findOrganization(state, login);
      if (!organization) {
        outcome = failure(404, "Not found");
        return;
      }
      const team = findTeam(state, organization.id, teamName);
      if (!team) {
        outcome = failure(404, TEAM_MESSAGES.notFound);
        return;
      }
      const viewer = resolveViewer(state, sessionId);
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      if (!isOrganizationOwner(organization, viewer.id)) {
        outcome = failure(403, ORGANIZATION_OWNER_MESSAGE);
        return;
      }
      const identifier = input.username ?? input.identifier ?? input.account ?? "";
      const account = findAccountByUsername(state, identifier) ?? findAccountByEmail(state, identifier);
      const fields = {};
      if (!account) fields.username = MEMBER_MESSAGES.notFound;
      else if (!organizationMember(organization, account.id)) {
        fields.username = TEAM_MEMBER_MESSAGES.notMember;
      } else if (isTeamMember(state, team.id, account.id)) {
        fields.username = TEAM_MEMBER_MESSAGES.alreadyMember;
      }
      if (Object.keys(fields).length > 0) {
        outcome = failure(400, "Team member addition failed", fields);
        return;
      }
      const membership = {
        teamId: team.id,
        accountId: account.id,
        createdAt: new Date().toISOString(),
      };
      state.teamMemberships = state.teamMemberships ?? [];
      state.teamMemberships.push(membership);
      outcome = {
        ok: true,
        status: 201,
        member: { accountId: account.id, username: account.username, createdAt: membership.createdAt },
        team: toTeamPayload(state, team),
      };
    });
    return outcome;
  }

  /** Removes one direct team membership; the account and the organization stay. */
  async function removeOrganizationTeamMember(sessionId, login, teamName, username) {
    let outcome;
    await jsonStore.update((state) => {
      const organization = findOrganization(state, login);
      if (!organization) {
        outcome = failure(404, "Not found");
        return;
      }
      const team = findTeam(state, organization.id, teamName);
      if (!team) {
        outcome = failure(404, TEAM_MESSAGES.notFound);
        return;
      }
      const viewer = resolveViewer(state, sessionId);
      if (!viewer) {
        outcome = failure(401, "Not authenticated");
        return;
      }
      if (!isOrganizationOwner(organization, viewer.id)) {
        outcome = failure(403, ORGANIZATION_OWNER_MESSAGE);
        return;
      }
      const account = findAccountByUsername(state, username);
      if (!account || !isTeamMember(state, team.id, account.id)) {
        outcome = failure(404, TEAM_MEMBER_MESSAGES.notFound);
        return;
      }
      state.teamMemberships = (state.teamMemberships ?? []).filter(
        (membership) => !(membership.teamId === team.id && membership.accountId === account.id),
      );
      outcome = { ok: true, removedAccountId: account.id, team: toTeamPayload(state, team) };
    });
    return outcome;
  }

  return {
    listViewerOrganizations,
    createOrganization,
    getOrganization,
    listOrganizationRepositories,
    listOrganizationMembers,
    addOrganizationMember,
    removeOrganizationMember,
    listOrganizationTeamsForViewer,
    createOrganizationTeam,
    getOrganizationTeam,
    setOrganizationTeamParent,
    addOrganizationTeamMember,
    removeOrganizationTeamMember,
  };
}
