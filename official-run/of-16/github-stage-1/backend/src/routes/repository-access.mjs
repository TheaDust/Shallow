import { findOrganizationBySlug, toPublicOrganization } from "../domain/organizations.mjs";
import {
  addTeamAccessGrant,
  canManageRepositoryAccess,
  listRepositoryAccess,
  updateAccessGrantRole,
} from "../domain/repository-access.mjs";
import { findRepository, toPublicRepository } from "../domain/repositories.mjs";
import { listOrganizationTeams, toPublicTeam } from "../domain/teams.mjs";
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
 * Resolves the organization, the repository and the current account for an
 * access-management request. Only an organization Owner or a repository Admin
 * may read or change the access list; every branch answers the request itself
 * (401/404/403) and returns null so reads and writes share one decision.
 */
async function resolveAdminTarget(store, request, response, params) {
  const { state, account } = await resolveSessionAccount(store, request);
  const organization = findOrganizationBySlug(state, params.slug);
  if (!organization) {
    sendJson(response, 404, { error: NOT_FOUND });
    return null;
  }
  const repository = findRepository(state, organization.id, params.name);
  if (!repository) {
    sendJson(response, 404, { error: NOT_FOUND });
    return null;
  }
  if (!account) {
    sendJson(response, 401, { error: SIGN_IN_REQUIRED });
    return null;
  }
  if (!canManageRepositoryAccess(state, repository, account.id)) {
    sendJson(response, 403, { error: ACCESS_DENIED });
    return null;
  }
  return { state, account, organization, repository };
}

function accessPayload(target) {
  return {
    repository: { ...toPublicRepository(target.repository), organization: toPublicOrganization(target.organization) },
    canManageAccess: true,
    grants: listRepositoryAccess(target.state, target.repository),
    // Candidates for the "Add people or teams" picker: every team of the
    // repository's organization, whether or not it already holds a grant.
    teams: listOrganizationTeams(target.state, target.organization.id).map(toPublicTeam),
  };
}

/**
 * Repository "Manage access" API, addressed under a repository Settings page.
 * The access list is the authoritative state: adding a team with a role and
 * saving a row role both rewrite the same stored grant, so a role change never
 * leaves a duplicate record. Every request is decided from the stored state and
 * remains limited to an organization Owner or a repository Admin.
 */
export function createRepositoryAccessRouter({ store }) {
  const router = createRouter();

  router.add("GET", "/api/organizations/:slug/repositories/:name/access", async (request, response, params) => {
    const target = await resolveAdminTarget(store, request, response, params);
    if (!target) return;
    sendJson(response, 200, accessPayload(target));
  });

  router.add("POST", "/api/organizations/:slug/repositories/:name/access", async (request, response, params) => {
    const body = await readBody(request, response);
    if (body === null) return;
    const target = await resolveAdminTarget(store, request, response, params);
    if (!target) return;
    const result = await store.mutate((state) => {
      const organization = findOrganizationBySlug(state, params.slug);
      const repository = organization ? findRepository(state, organization.id, params.name) : null;
      if (!repository) return { missing: true };
      return addTeamAccessGrant(state, repository, body);
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
    const organization = findOrganizationBySlug(state, params.slug);
    sendJson(response, 200, accessPayload({
      state,
      organization,
      repository: findRepository(state, organization.id, params.name),
      account: target.account,
    }));
  });

  router.add(
    "PATCH",
    "/api/organizations/:slug/repositories/:name/access/:grantId",
    async (request, response, params) => {
      const body = await readBody(request, response);
      if (body === null) return;
      const target = await resolveAdminTarget(store, request, response, params);
      if (!target) return;
      const result = await store.mutate((state) => {
        const organization = findOrganizationBySlug(state, params.slug);
        const repository = organization ? findRepository(state, organization.id, params.name) : null;
        if (!repository) return { missing: true };
        return updateAccessGrantRole(state, repository, params.grantId, body);
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
      const organization = findOrganizationBySlug(state, params.slug);
      sendJson(response, 200, accessPayload({
        state,
        organization,
        repository: findRepository(state, organization.id, params.name),
        account: target.account,
      }));
    },
  );

  return router;
}
