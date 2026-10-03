import { randomUUID } from "node:crypto";

import { readJsonSafe, sendJson } from "../lib/http.mjs";
import { validateUsername } from "../lib/validation.mjs";
import { findCurrentAccount } from "../lib/sessions.mjs";
import {
  ACCESS_DENIED,
  MEMBER_MESSAGES,
  ORGANIZATION_MESSAGES,
  ORGANIZATION_NOT_FOUND,
  REPOSITORY_ACCESS_MESSAGES,
  REPOSITORY_NOT_FOUND,
  TEAM_MESSAGES,
  TEAM_NOT_FOUND,
  organizationKey,
  validateDisplayName,
  validateRepositoryRole,
  validateTeamName,
} from "../lib/organization-rules.mjs";
import {
  canReadRepository,
  findAccountByIdentifier,
  findAccountByUsername,
  findOrganizationByName,
  findOrganizationByKey,
  findRepository,
  findTeam,
  isOrganizationMember,
  listAccountMemberships,
  listOrganizationMembers,
  listOrganizationTeams,
  listPublicOrganizations,
  listRepositoryGrants,
  listTeamMemberUsernames,
  listVisibleRepositories,
  organizationRole,
  publicOrganization,
  publicRepository,
  publicTeam,
  repositoryRole,
  wouldCreateCycle,
} from "../lib/organizations.mjs";

function teamMemberPayload(team, usernames) {
  return { team: { name: team.name }, members: usernames.map((username) => ({ username })) };
}

/**
 * Organization, team and membership API. Every answer is derived from the
 * organization aggregate store for the current session account, so the pages,
 * the lists and the effective repository visibility always agree.
 */
export function createOrganizationApi(database) {
  async function listMyOrganizations(response, account) {
    const memberships = await listAccountMemberships(database, account.id);
    const { organizations } = await database.organizationState.read();
    const list = memberships
      .map((membership) => {
        const organization = organizations.find((candidate) => candidate.id === membership.organizationId);
        return organization ? { ...publicOrganization(organization), role: membership.role } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
    sendJson(response, 200, { organizations: list });
  }

  async function createOrganization(request, response, account) {
    const body = await readJsonSafe(request);
    const rawName = typeof body.name === "string" ? body.name : "";
    const rawDisplayName = typeof body.displayName === "string" ? body.displayName : "";
    const name = rawName.trim();
    const displayName = rawDisplayName.trim();

    // The duplicate check runs first, so an attempt that only differs from a
    // stored identifier in case or spacing reports the existing organization
    // instead of a format error.
    const errors = {};
    if (await findOrganizationByKey(database, organizationKey(rawName))) {
      errors.name = ORGANIZATION_MESSAGES.nameExists;
    } else if (!validateUsername(name)) {
      errors.name = ORGANIZATION_MESSAGES.nameInvalid;
    }
    if (displayName.length === 0) errors.displayName = ORGANIZATION_MESSAGES.displayNameRequired;
    else if (!validateDisplayName(displayName)) errors.displayName = ORGANIZATION_MESSAGES.displayNameTooLong;

    if (Object.keys(errors).length > 0) {
      sendJson(response, 422, { errors });
      return;
    }

    const now = new Date().toISOString();
    const organization = { id: `org-${randomUUID()}`, name, displayName, createdAt: now };
    // The organization object and the creator's Owner membership are written
    // together, so a created organization is never left without an Owner.
    await database.organizationState.update((state) => {
      state.organizations.push(organization);
      state.memberships.push({
        id: `membership-${randomUUID()}`,
        organizationId: organization.id,
        accountId: account.id,
        role: "owner",
        createdAt: now,
      });
      return state;
    });
    sendJson(response, 201, { organization: publicOrganization(organization) });
  }

  async function createTeam(request, response, organization) {
    const body = await readJsonSafe(request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const teams = await listOrganizationTeams(database, organization.id);
    if (teams.some((team) => team.name.toLowerCase() === name.toLowerCase())) {
      sendJson(response, 422, { errors: { name: TEAM_MESSAGES.nameExists } });
      return;
    }
    if (!validateTeamName(name)) {
      sendJson(response, 422, { errors: { name: TEAM_MESSAGES.nameInvalid } });
      return;
    }
    const team = {
      id: `team-${randomUUID()}`,
      organizationId: organization.id,
      name,
      parentTeamId: null,
      createdAt: new Date().toISOString(),
    };
    await database.organizationState.update((state) => {
      state.teams.push(team);
      return state;
    });
    sendJson(response, 201, { team: publicTeam(team, [...teams, team]) });
  }

  async function saveTeamParent(request, response, organization, team) {
    const body = await readJsonSafe(request);
    const parentName = typeof body.parentTeam === "string" ? body.parentTeam.trim() : "";
    const teams = await listOrganizationTeams(database, organization.id);
    const parent = parentName ? teams.find((candidate) => candidate.name === parentName) : null;
    if (parentName && !parent) {
      sendJson(response, 422, { error: TEAM_MESSAGES.foreignParent });
      return;
    }
    if (parent && wouldCreateCycle(teams, team.id, parent.id)) {
      sendJson(response, 422, { error: TEAM_MESSAGES.cycle });
      return;
    }
    const updated = await database.organizationState.update((state) => {
      const target = state.teams.find((candidate) => candidate.id === team.id);
      if (target) target.parentTeamId = parent ? parent.id : null;
      return state;
    });
    sendJson(response, 200, { team: publicTeam(updated.teams.find((candidate) => candidate.id === team.id), updated.teams) });
  }

  async function addOrganizationMember(request, response, organization, role) {
    const body = await readJsonSafe(request);
    const identifier =
      typeof body.identifier === "string"
        ? body.identifier
        : typeof body.username === "string"
          ? body.username
          : "";
    const memberRole = typeof body.role === "string" ? body.role.trim() : "";
    const target = await findAccountByIdentifier(database, identifier);
    if (!target) {
      sendJson(response, 422, { error: MEMBER_MESSAGES.accountNotFound });
      return;
    }
    if (memberRole !== "member" && memberRole !== "owner") {
      sendJson(response, 422, { error: MEMBER_MESSAGES.roleInvalid });
      return;
    }
    if (await isOrganizationMember(database, organization.id, target.id)) {
      sendJson(response, 422, { error: MEMBER_MESSAGES.alreadyMember });
      return;
    }
    await database.organizationState.update((state) => {
      state.memberships.push({
        id: `membership-${randomUUID()}`,
        organizationId: organization.id,
        accountId: target.id,
        role: memberRole,
        createdAt: new Date().toISOString(),
      });
      return state;
    });
    sendJson(response, 201, {
      organization: publicOrganization(organization),
      viewer: { role },
      canManage: true,
      members: await listOrganizationMembers(database, organization.id),
    });
  }

  async function removeOrganizationMember(request, response, organization, username, role) {
    const target = await findAccountByUsername(database, username);
    if (!target) {
      sendJson(response, 404, { error: MEMBER_MESSAGES.accountNotFound });
      return;
    }
    const state = await database.organizationState.read();
    const membership = state.memberships.find(
      (candidate) => candidate.organizationId === organization.id && candidate.accountId === target.id,
    );
    if (!membership) {
      sendJson(response, 422, { error: MEMBER_MESSAGES.notOrganizationMember });
      return;
    }
    // An organization must never be left without an Owner. The guard runs
    // before any write, so a rejected removal keeps every relationship intact.
    if (membership.role === "owner") {
      const owners = state.memberships.filter(
        (candidate) => candidate.organizationId === organization.id && candidate.role === "owner",
      );
      if (owners.length <= 1) {
        sendJson(response, 422, { error: MEMBER_MESSAGES.lastOwner });
        return;
      }
    }
    // One atomic update drops the organization membership, every team
    // membership of that account inside the organization, and every direct
    // grant to that account on the organization's repositories. Team grants
    // themselves are retained.
    await database.organizationState.update((draft) => {
      const repositoryIds = new Set(
        draft.repositories
          .filter((repository) => repository.organizationId === organization.id)
          .map((repository) => repository.id),
      );
      draft.memberships = draft.memberships.filter(
        (candidate) => !(candidate.organizationId === organization.id && candidate.accountId === target.id),
      );
      draft.teamMemberships = draft.teamMemberships.filter(
        (candidate) => !(candidate.organizationId === organization.id && candidate.accountId === target.id),
      );
      draft.repositoryGrants = (draft.repositoryGrants ?? []).filter(
        (grant) => !(grant.accountId === target.id && repositoryIds.has(grant.repositoryId)),
      );
      return draft;
    });
    sendJson(response, 200, {
      organization: publicOrganization(organization),
      viewer: { role },
      canManage: true,
      members: await listOrganizationMembers(database, organization.id),
    });
  }

  async function repositoryAccessPayload(organization, repository, role) {
    const teams = await listOrganizationTeams(database, organization.id);
    return {
      organization: publicOrganization(organization),
      viewer: { role },
      repository: publicRepository(repository),
      canManage: true,
      grants: await listRepositoryGrants(database, repository.id),
      teams: teams.map((team) => ({ name: team.name })),
    };
  }

  async function addRepositoryGrant(request, response, organization, repository, role) {
    const body = await readJsonSafe(request);
    const teamName = typeof body.teamName === "string" ? body.teamName.trim() : "";
    const grantRole = typeof body.role === "string" ? body.role.trim() : "";
    if (!validateRepositoryRole(grantRole)) {
      sendJson(response, 422, { error: REPOSITORY_ACCESS_MESSAGES.roleInvalid });
      return;
    }
    const team = await findTeam(database, organization.id, teamName);
    if (!team) {
      sendJson(response, 422, { error: TEAM_NOT_FOUND });
      return;
    }
    const existing = await listRepositoryGrants(database, repository.id);
    if (existing.some((grant) => grant.kind === "team" && grant.name === team.name)) {
      sendJson(response, 422, { error: REPOSITORY_ACCESS_MESSAGES.alreadyGranted });
      return;
    }
    await database.organizationState.update((state) => {
      state.repositoryGrants ??= [];
      state.repositoryGrants.push({
        id: `grant-${randomUUID()}`,
        repositoryId: repository.id,
        teamId: team.id,
        role: grantRole,
        createdAt: new Date().toISOString(),
      });
      return state;
    });
    sendJson(response, 201, await repositoryAccessPayload(organization, repository, role));
  }

  async function updateRepositoryGrant(request, response, organization, repository, grantId, role) {
    const body = await readJsonSafe(request);
    const grantRole = typeof body.role === "string" ? body.role.trim() : "";
    if (!validateRepositoryRole(grantRole)) {
      sendJson(response, 422, { error: REPOSITORY_ACCESS_MESSAGES.roleInvalid });
      return;
    }
    const state = await database.organizationState.read();
    const grant = (state.repositoryGrants ?? []).find(
      (candidate) => candidate.id === grantId && candidate.repositoryId === repository.id,
    );
    if (!grant) {
      sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.grantNotFound });
      return;
    }
    // The existing grant record is edited in place so the row is never duplicated.
    await database.organizationState.update((draft) => {
      const target = (draft.repositoryGrants ?? []).find((candidate) => candidate.id === grantId);
      if (target) target.role = grantRole;
      return draft;
    });
    sendJson(response, 200, await repositoryAccessPayload(organization, repository, role));
  }

  return async function handleOrganizationApi(request, response, pathname) {
    const segments = pathname.split("/").filter(Boolean);
    if (segments[0] !== "api") return false;

    if (segments[1] === "public" && segments[2] === "organizations") {
      if (segments.length !== 3 || request.method !== "GET") return false;
      sendJson(response, 200, { organizations: await listPublicOrganizations(database) });
      return true;
    }
    if (segments[1] !== "organizations") return false;

    const account = await findCurrentAccount(database, request);
    const [, , organizationName, section, sub, sub2] = segments;

    if (segments.length === 2) {
      if (request.method === "GET") {
        if (!account) {
          sendJson(response, 401, { error: "Sign in required" });
          return true;
        }
        await listMyOrganizations(response, account);
        return true;
      }
      if (request.method === "POST") {
        if (!account) {
          sendJson(response, 401, { error: "Sign in required" });
          return true;
        }
        if (!account.emailVerified) {
          sendJson(response, 403, { error: "A verified account is required" });
          return true;
        }
        await createOrganization(request, response, account);
        return true;
      }
      return false;
    }

    const organization = await findOrganizationByName(database, organizationName);
    if (!organization) {
      sendJson(response, 404, { error: ORGANIZATION_NOT_FOUND });
      return true;
    }
    const role = await organizationRole(database, organization.id, account?.id);
    const organizationSummary = publicOrganization(organization);

    if (segments.length === 3) {
      if (request.method !== "GET") return false;
      sendJson(response, 200, { organization: organizationSummary, viewer: { role } });
      return true;
    }

    if (segments.length === 4 && section === "members") {
      if (!role) {
        sendJson(response, 403, { error: ACCESS_DENIED });
        return true;
      }
      if (request.method === "GET") {
        sendJson(response, 200, {
          organization: organizationSummary,
          viewer: { role },
          canManage: role === "owner",
          members: await listOrganizationMembers(database, organization.id),
        });
        return true;
      }
      if (request.method === "POST") {
        if (!account) {
          sendJson(response, 401, { error: "Sign in required" });
          return true;
        }
        if (role !== "owner") {
          sendJson(response, 403, { error: ACCESS_DENIED });
          return true;
        }
        await addOrganizationMember(request, response, organization, role);
        return true;
      }
      return false;
    }

    if (segments.length === 5 && section === "members") {
      if (request.method !== "DELETE") return false;
      if (!account) {
        sendJson(response, 401, { error: "Sign in required" });
        return true;
      }
      if (role !== "owner") {
        sendJson(response, 403, { error: ACCESS_DENIED });
        return true;
      }
      await removeOrganizationMember(request, response, organization, decodeURIComponent(sub), role);
      return true;
    }

    if (section === "repositories") {
      if (request.method === "GET" && segments.length === 4) {
        sendJson(response, 200, {
          organization: organizationSummary,
          viewer: { role },
          repositories: await listVisibleRepositories(database, organization.id, account?.id, role),
        });
        return true;
      }
      if (segments.length >= 5) {
        const repository = await findRepository(database, organization.id, sub);
        if (!repository) {
          sendJson(response, 404, { error: REPOSITORY_NOT_FOUND });
          return true;
        }
        const repositoryAccess = await repositoryRole(database, repository, account?.id, role);
        if (!canReadRepository(repository, repositoryAccess)) {
          sendJson(response, 403, { error: ACCESS_DENIED });
          return true;
        }
        const viewer = { role, repositoryRole: repositoryAccess, canManage: repositoryAccess === "admin" };

        if (segments.length === 5 && request.method === "GET") {
          sendJson(response, 200, {
            organization: organizationSummary,
            viewer,
            repository: publicRepository(repository),
          });
          return true;
        }

        // Settings → Manage access. Only a repository Admin may see or change
        // the access list; the check is repeated for every verb.
        if (sub2 === "access") {
          if (segments.length === 6) {
            if (repositoryAccess !== "admin") {
              sendJson(response, 403, { error: ACCESS_DENIED });
              return true;
            }
            if (request.method === "GET") {
              sendJson(response, 200, await repositoryAccessPayload(organization, repository, role));
              return true;
            }
            if (request.method === "POST") {
              if (!account) {
                sendJson(response, 401, { error: "Sign in required" });
                return true;
              }
              await addRepositoryGrant(request, response, organization, repository, role);
              return true;
            }
            return false;
          }
          if (segments.length === 7 && request.method === "PUT") {
            if (repositoryAccess !== "admin") {
              sendJson(response, 403, { error: ACCESS_DENIED });
              return true;
            }
            if (!account) {
              sendJson(response, 401, { error: "Sign in required" });
              return true;
            }
            await updateRepositoryGrant(
              request,
              response,
              organization,
              repository,
              decodeURIComponent(segments[6]),
              role,
            );
            return true;
          }
        }
      }
      return false;
    }

    if (section === "teams") {
      if (segments.length === 4) {
        if (request.method === "GET") {
          if (!role) {
            sendJson(response, 403, { error: ACCESS_DENIED });
            return true;
          }
          const teams = await listOrganizationTeams(database, organization.id);
          sendJson(response, 200, {
            organization: organizationSummary,
            viewer: { role },
            teams: teams.map((team) => publicTeam(team, teams)),
          });
          return true;
        }
        if (request.method === "POST") {
          if (!account) {
            sendJson(response, 401, { error: "Sign in required" });
            return true;
          }
          if (role !== "owner") {
            sendJson(response, 403, { error: ACCESS_DENIED });
            return true;
          }
          await createTeam(request, response, organization);
          return true;
        }
        return false;
      }

      const team = await findTeam(database, organization.id, sub);
      if (!team) {
        sendJson(response, 404, { error: TEAM_NOT_FOUND });
        return true;
      }
      if (!role) {
        sendJson(response, 403, { error: ACCESS_DENIED });
        return true;
      }
      const canManage = role === "owner";

      if (segments.length === 5) {
        if (request.method === "GET") {
          const teams = await listOrganizationTeams(database, organization.id);
          sendJson(response, 200, {
            organization: organizationSummary,
            viewer: { role },
            canManage,
            team: publicTeam(team, teams),
            // Descendant teams stay selectable so a cyclic choice can be
            // attempted and rejected by the server.
            teams: teams.filter((candidate) => candidate.id !== team.id).map((candidate) => ({ name: candidate.name })),
          });
          return true;
        }
        if (request.method === "PUT") {
          if (!canManage) {
            sendJson(response, 403, { error: ACCESS_DENIED });
            return true;
          }
          await saveTeamParent(request, response, organization, team);
          return true;
        }
        return false;
      }

      if (segments.length === 6 && sub2 === "members") {
        if (request.method === "GET") {
          sendJson(response, 200, {
            organization: organizationSummary,
            viewer: { role },
            canManage,
            ...teamMemberPayload(team, await listTeamMemberUsernames(database, team.id)),
          });
          return true;
        }
        if (request.method === "POST") {
          if (!canManage) {
            sendJson(response, 403, { error: ACCESS_DENIED });
            return true;
          }
          const body = await readJsonSafe(request);
          const username = typeof body.username === "string" ? body.username.trim() : "";
          const target = await findAccountByUsername(database, username);
          if (!target) {
            sendJson(response, 422, { error: MEMBER_MESSAGES.accountNotFound });
            return true;
          }
          if (!(await isOrganizationMember(database, organization.id, target.id))) {
            sendJson(response, 422, { error: MEMBER_MESSAGES.notOrganizationMember });
            return true;
          }
          const current = await listTeamMemberUsernames(database, team.id);
          if (current.some((name) => name.toLowerCase() === target.username.toLowerCase())) {
            sendJson(response, 422, { error: MEMBER_MESSAGES.alreadyInTeam });
            return true;
          }
          await database.organizationState.update((state) => {
            state.teamMemberships.push({
              id: `team-membership-${randomUUID()}`,
              organizationId: organization.id,
              teamId: team.id,
              accountId: target.id,
              createdAt: new Date().toISOString(),
            });
            return state;
          });
          sendJson(response, 201, {
            ...teamMemberPayload(team, await listTeamMemberUsernames(database, team.id)),
          });
          return true;
        }
        return false;
      }

      if (segments.length === 7 && sub2 === "members") {
        if (request.method !== "DELETE") return false;
        if (!canManage) {
          sendJson(response, 403, { error: ACCESS_DENIED });
          return true;
        }
        const target = await findAccountByUsername(database, decodeURIComponent(segments[6]));
        if (target) {
          await database.organizationState.update((state) => {
            state.teamMemberships = state.teamMemberships.filter(
              (membership) => !(membership.teamId === team.id && membership.accountId === target.id),
            );
            return state;
          });
        }
        sendJson(response, 200, {
          ...teamMemberPayload(team, await listTeamMemberUsernames(database, team.id)),
        });
        return true;
      }
    }

    return false;
  };
}
