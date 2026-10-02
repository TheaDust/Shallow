import {
  findOrganizationBySlug,
  isOrganizationOwner,
  organizationRoleOf,
  toPublicOrganization,
} from "../domain/organizations.mjs";
import {
  addTeamMember,
  createTeam,
  findTeamByName,
  listOrganizationTeams,
  parentTeamOf,
  removeTeamMember,
  setParentTeam,
  teamMemberRows,
  toPublicTeam,
} from "../domain/teams.mjs";
import { readJson, sendJson } from "../lib/http.mjs";
import { createRouter } from "../lib/router.mjs";
import { resolveSessionAccount } from "../lib/session.mjs";

const SIGN_IN_REQUIRED = "Sign in required";
const NOT_FOUND = "Not found";
const ACCESS_DENIED = "Access denied";

async function readBody(request, response) {
  try {
    return await readJson(request);
  } catch {
    sendJson(response, 400, { error: "Invalid request body" });
    return null;
  }
}

/**
 * Resolves the organization and team named by the address, plus the account of
 * the current session. When `requireOwner` is set the handler answers the
 * request itself (401/404/403) and returns null so that every write goes
 * through the same authorization decision.
 */
async function resolveTarget(store, request, response, params, { requireOwner = false } = {}) {
  const { state, account } = await resolveSessionAccount(store, request);
  const organization = findOrganizationBySlug(state, params.slug);
  if (!organization) {
    sendJson(response, 404, { error: NOT_FOUND });
    return null;
  }
  if (requireOwner) {
    if (!account) {
      sendJson(response, 401, { error: SIGN_IN_REQUIRED });
      return null;
    }
    if (!isOrganizationOwner(state, organization.id, account.id)) {
      sendJson(response, 403, { error: ACCESS_DENIED });
      return null;
    }
  }
  return { state, account, organization };
}

/**
 * Team API. Team names live inside one organization; the hierarchy (parent
 * team), the team memberships and the organization membership are separate
 * persisted relationships. Every write is decided from the stored state and is
 * limited to an organization Owner, while reads follow the public organization
 * page rules of the surrounding organization routes.
 */
export function createTeamRouter({ store }) {
  const router = createRouter();

  router.add("GET", "/api/organizations/:slug/teams", async (request, response, params) => {
    const target = await resolveTarget(store, request, response, params);
    if (!target) return;
    sendJson(response, 200, { teams: listOrganizationTeams(target.state, target.organization.id).map(toPublicTeam) });
  });

  router.add("POST", "/api/organizations/:slug/teams", async (request, response, params) => {
    const body = await readBody(request, response);
    if (body === null) return;
    const target = await resolveTarget(store, request, response, params, { requireOwner: true });
    if (!target) return;
    const result = await store.mutate((state) => createTeam(state, target.organization, body));
    if (result.errors) {
      sendJson(response, 400, { errors: result.errors });
      return;
    }
    sendJson(response, 201, { team: toPublicTeam(result.team) });
  });

  router.add("GET", "/api/organizations/:slug/teams/:name/members", async (request, response, params) => {
    const target = await resolveTarget(store, request, response, params);
    if (!target) return;
    const team = findTeamByName(target.state, target.organization.id, params.name);
    if (!team) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    sendJson(response, 200, { members: teamMemberRows(target.state, team.id) });
  });

  router.add("POST", "/api/organizations/:slug/teams/:name/members", async (request, response, params) => {
    const body = await readBody(request, response);
    if (body === null) return;
    const target = await resolveTarget(store, request, response, params, { requireOwner: true });
    if (!target) return;
    const team = findTeamByName(target.state, target.organization.id, params.name);
    if (!team) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    const result = await store.mutate((state) => {
      const currentTeam = findTeamByName(state, target.organization.id, params.name);
      if (!currentTeam) return { missing: true };
      return addTeamMember(state, target.organization.id, currentTeam, body);
    });
    if (result.missing) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    if (result.errors) {
      sendJson(response, 400, { errors: result.errors });
      return;
    }
    const state = await store.read();
    sendJson(response, 200, { members: teamMemberRows(state, team.id) });
  });

  router.add(
    "DELETE",
    "/api/organizations/:slug/teams/:name/members/:username",
    async (request, response, params) => {
      const target = await resolveTarget(store, request, response, params, { requireOwner: true });
      if (!target) return;
      const team = findTeamByName(target.state, target.organization.id, params.name);
      if (!team) {
        sendJson(response, 404, { error: NOT_FOUND });
        return;
      }
      await store.mutate((state) => removeTeamMember(state, team, params.username));
      const state = await store.read();
      sendJson(response, 200, { members: teamMemberRows(state, team.id) });
    },
  );

  router.add("PATCH", "/api/organizations/:slug/teams/:name", async (request, response, params) => {
    const body = await readBody(request, response);
    if (body === null) return;
    const target = await resolveTarget(store, request, response, params, { requireOwner: true });
    if (!target) return;
    const team = findTeamByName(target.state, target.organization.id, params.name);
    if (!team) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    const result = await store.mutate((state) => {
      const currentTeam = findTeamByName(state, target.organization.id, params.name);
      if (!currentTeam) return { missing: true };
      return setParentTeam(state, target.organization.id, currentTeam, body);
    });
    if (result.missing) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    if (result.errors) {
      sendJson(response, 400, { errors: result.errors });
      return;
    }
    sendJson(response, 200, { team: toPublicTeam(result.team) });
  });

  router.add("GET", "/api/organizations/:slug/teams/:name", async (request, response, params) => {
    const target = await resolveTarget(store, request, response, params);
    if (!target) return;
    const team = findTeamByName(target.state, target.organization.id, params.name);
    if (!team) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    sendJson(response, 200, {
      team: toPublicTeam(team),
      parentTeam: toPublicTeam(parentTeamOf(target.state, team)),
      organization: toPublicOrganization(target.organization),
      role: organizationRoleOf(target.state, target.organization.id, target.account?.id ?? null),
      teams: listOrganizationTeams(target.state, target.organization.id).map(toPublicTeam),
    });
  });

  return router;
}
