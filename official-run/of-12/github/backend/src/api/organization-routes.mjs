import { asString, readJson, sendJson } from "../lib/http.mjs";
import {
  createOrganization,
  findOrganization,
  organizationMembers,
  organizationMembership,
  organizationsForAccount,
  publicOrganizations,
} from "../domain/organizations.mjs";
import {
  addOrganizationMember,
  ORGANIZATION_MEMBER_MESSAGES,
  removeOrganizationMember,
} from "../domain/organization-members.mjs";
import {
  addTeamMember,
  createTeam,
  findTeam,
  organizationTeams,
  removeTeamMember,
  TEAM_MESSAGES,
  teamMemberUsernames,
  updateTeamParent,
} from "../domain/teams.mjs";
import { repositorySummary, visibleOrganizationRepositories } from "../domain/repository-access.mjs";

/**
 * HTTP surface for organization identity and discovery (REQ-2-1), the
 * repository read model the organization list links to (REQ-2-1-1) and
 * organization team / member management (REQ-2-2). A single repository
 * (`/api/repositories/*`, REQ-2-3 / REQ-3) is served by `repository-routes.mjs`.
 *
 * Every write is validated and authorized against the session inside the
 * atomic store update; the list endpoints only ever return repositories the
 * caller has read permission for.
 */

export function createOrganizationApi({ store, resolveAccount }) {
  function organizationDetail(data, organization, accountId) {
    const viewerRole = organizationMembership(data, organization.id, accountId)?.role ?? null;
    const repositories = visibleOrganizationRepositories(data, organization.id, accountId)
      .map((repository) => repositorySummary(data, repository))
      .sort((left, right) => left.name.localeCompare(right.name));
    return {
      organization: {
        name: organization.name,
        displayName: organization.displayName,
        createdAt: organization.createdAt,
      },
      viewerRole,
      // People and teams are only listed to members of the organization.
      members: viewerRole ? organizationMembers(data, organization.id) : [],
      teams: viewerRole ? organizationTeams(data, organization.id) : [],
      repositories,
    };
  }

  function teamDetail(data, organization, team, accountId) {
    const viewerRole = organizationMembership(data, organization.id, accountId)?.role ?? null;
    const parent = team.parentTeamId
      ? data.teams.find((candidate) => candidate.id === team.parentTeamId) ?? null
      : null;
    return {
      organization: { name: organization.name, displayName: organization.displayName },
      team: {
        name: team.name,
        description: team.description ?? "",
        parentTeamName: parent ? parent.name : null,
        createdAt: team.createdAt ?? null,
      },
      viewerRole,
      members: viewerRole ? teamMemberUsernames(data, team.id) : [],
      // The whole organization tree is needed to display and change the
      // hierarchy; a team always belongs to the organization that owns it.
      teams: organizationTeams(data, organization.id),
    };
  }

  async function handleOrganizationList(request, response, method, account) {
    if (method === "GET") {
      const data = await store.read();
      sendJson(response, 200, { organizations: publicOrganizations(data) });
      return true;
    }
    if (method === "POST") {
      if (!account) {
        sendJson(response, 401, { error: "Sign in is required to create an organization" });
        return true;
      }
      const body = await readJson(request);
      const result = await createOrganization(store, account.id, {
        name: asString(body.name),
        displayName: asString(body.displayName),
      });
      if (!result.ok) {
        sendJson(response, 400, { error: "Organization creation failed", fields: result.errors });
        return true;
      }
      sendJson(response, 201, {
        organization: {
          name: result.organization.name,
          displayName: result.organization.displayName,
          createdAt: result.organization.createdAt,
        },
      });
      return true;
    }
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  /** POST /api/organizations/:org/members — directly add an existing account. */
  async function handleAddOrganizationMember(request, response, organization, account) {
    const body = await readJson(request);
    const result = await addOrganizationMember(store, organization.id, account.id, {
      username: asString(body.username),
      role: body.role === undefined || body.role === null ? "Member" : asString(body.role),
    });
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: ORGANIZATION_MEMBER_MESSAGES.forbidden });
        return true;
      }
      const message = Object.values(result.errors ?? {})[0] ?? "The member could not be added";
      sendJson(response, 400, { error: message, fields: result.errors ?? {} });
      return true;
    }
    const data = await store.read();
    sendJson(response, 201, {
      member: result.member,
      members: organizationMembers(data, organization.id),
    });
    return true;
  }

  /** DELETE /api/organizations/:org/members/:username — remove a member. */
  async function handleRemoveOrganizationMember(request, response, organization, account, username) {
    const result = await removeOrganizationMember(store, organization.id, account.id, username);
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: ORGANIZATION_MEMBER_MESSAGES.forbidden });
        return true;
      }
      const message = Object.values(result.errors ?? {})[0] ?? "The member could not be removed";
      sendJson(response, 400, { error: message, fields: result.errors ?? {} });
      return true;
    }
    const data = await store.read();
    sendJson(response, 200, {
      member: result.member,
      members: organizationMembers(data, organization.id),
    });
    return true;
  }

  async function handleOrganizationScoped(request, response, organization, rest, method, account) {
    if (rest.length === 0) {
      if (method !== "GET") {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      const data = await store.read();
      sendJson(response, 200, organizationDetail(data, organization, account?.id ?? null));
      return true;
    }

    if (rest[0] === "members") {
      if (!account) {
        sendJson(response, 401, { error: "Sign in is required to manage this organization" });
        return true;
      }
      if (rest.length === 1 && method === "POST") {
        return handleAddOrganizationMember(request, response, organization, account);
      }
      if (rest.length === 2 && method === "DELETE") {
        return handleRemoveOrganizationMember(request, response, organization, account, rest[1]);
      }
      sendJson(response, 404, { error: "Not found" });
      return true;
    }

    if (rest[0] === "teams") {
      if (rest.length === 1 && method === "POST") {
        if (!account) {
          sendJson(response, 401, { error: "Sign in is required to create a team" });
          return true;
        }
        const body = await readJson(request);
        const result = await createTeam(store, organization.id, account.id, {
          name: asString(body.name),
          description: asString(body.description),
          parentTeam: asString(body.parentTeam),
        });
        if (!result.ok) {
          if (result.forbidden) {
            sendJson(response, 403, { error: TEAM_MESSAGES.forbidden });
            return true;
          }
          const message = Object.values(result.errors ?? {})[0] ?? "The team could not be created";
          sendJson(response, 400, { error: message, fields: result.errors ?? {} });
          return true;
        }
        sendJson(response, 201, { team: result.team });
        return true;
      }

      if (rest.length >= 2) {
        const data = await store.read();
        const team = findTeam(data, organization.id, rest[1]);
        if (!team) {
          sendJson(response, 404, { error: TEAM_MESSAGES.notFound });
          return true;
        }
        if (rest.length === 2) {
          if (method === "GET") {
            sendJson(response, 200, teamDetail(data, organization, team, account?.id ?? null));
            return true;
          }
          if (method === "PATCH" || method === "POST") {
            if (!account) {
              sendJson(response, 401, { error: "Sign in is required to change this team" });
              return true;
            }
            const body = await readJson(request);
            const result = await updateTeamParent(store, team.id, account.id, asString(body.parentTeam));
            if (!result.ok) {
              if (result.forbidden) {
                sendJson(response, 403, { error: TEAM_MESSAGES.forbidden });
                return true;
              }
              const message = Object.values(result.errors ?? {})[0] ?? "The parent team could not be saved";
              sendJson(response, 400, { error: message, fields: result.errors ?? {} });
              return true;
            }
            const refreshed = await store.read();
            sendJson(response, 200, {
              team: result.team,
              teams: organizationTeams(refreshed, organization.id),
              members: teamMemberUsernames(refreshed, team.id),
              viewerRole: organizationMembership(refreshed, organization.id, account.id)?.role ?? null,
            });
            return true;
          }
          sendJson(response, 404, { error: "Not found" });
          return true;
        }

        if (rest.length === 3 && rest[2] === "members" && method === "POST") {
          if (!account) {
            sendJson(response, 401, { error: "Sign in is required to manage this team" });
            return true;
          }
          const body = await readJson(request);
          const result = await addTeamMember(store, team.id, account.id, asString(body.username));
          if (!result.ok) {
            if (result.forbidden) {
              sendJson(response, 403, { error: TEAM_MESSAGES.forbidden });
              return true;
            }
            const message = Object.values(result.errors ?? {})[0] ?? "The member could not be added";
            sendJson(response, 400, { error: message, fields: result.errors ?? {} });
            return true;
          }
          const refreshed = await store.read();
          sendJson(response, 201, {
            member: result.member,
            members: teamMemberUsernames(refreshed, team.id),
          });
          return true;
        }

        if (rest.length === 4 && rest[2] === "members" && method === "DELETE") {
          if (!account) {
            sendJson(response, 401, { error: "Sign in is required to manage this team" });
            return true;
          }
          const result = await removeTeamMember(store, team.id, account.id, rest[3]);
          if (!result.ok) {
            if (result.forbidden) {
              sendJson(response, 403, { error: TEAM_MESSAGES.forbidden });
              return true;
            }
            const message = Object.values(result.errors ?? {})[0] ?? "The member could not be removed";
            sendJson(response, 400, { error: message, fields: result.errors ?? {} });
            return true;
          }
          const refreshed = await store.read();
          sendJson(response, 200, {
            member: result.member,
            members: teamMemberUsernames(refreshed, team.id),
          });
          return true;
        }
      }
    }

    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  /**
   * Returns true when the request was handled here.
   */
  return async function handleOrganizationRequest(request, response, { pathname, method }) {
    const segments = pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    // ["api", "organizations", ...] or ["api", "account", "organizations"].
    if (segments[0] !== "api") return false;

    if (segments[1] === "account" && segments[2] === "organizations" && segments.length === 3) {
      if (method !== "GET") {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      const account = await resolveAccount(request);
      if (!account) {
        sendJson(response, 401, { error: "Sign in is required to list your organizations" });
        return true;
      }
      const data = await store.read();
      sendJson(response, 200, { organizations: organizationsForAccount(data, account.id) });
      return true;
    }

    if (segments[1] === "organizations") {
      const account = await resolveAccount(request);
      const rest = segments.slice(2);
      if (rest.length === 0) return handleOrganizationList(request, response, method, account);
      const data = await store.read();
      const organization = findOrganization(data, rest[0]);
      if (!organization) {
        sendJson(response, 404, { error: "Organization not found" });
        return true;
      }
      return handleOrganizationScoped(request, response, organization, rest.slice(1), method, account);
    }

    return false;
  };
}
