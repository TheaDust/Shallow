import {
  addOrganizationMember,
  createOrganization,
  findOrganizationBySlug,
  isOrganizationOwner,
  listMemberships,
  listOrganizationsForAccount,
  organizationRoleOf,
  removeOrganizationMember,
  toPublicOrganization,
} from "../domain/organizations.mjs";
import {
  canReadRepository,
  findRepository,
  listVisibleRepositories,
  toPublicRepository,
} from "../domain/repositories.mjs";
import { canManageRepositoryAccess } from "../domain/repository-access.mjs";
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

function memberRows(state, organization) {
  return listMemberships(state, organization.id)
    .map((membership) => {
      const account = state.accounts.find((candidate) => candidate.id === membership.accountId);
      if (!account) return null;
      return { username: account.username, role: membership.role };
    })
    .filter(Boolean)
    .sort((left, right) => (
      left.role === right.role ? left.username.localeCompare(right.username) : left.role === "owner" ? -1 : 1
    ));
}

/**
 * Resolves the organization and the session account for a member-management
 * request. Only an organization Owner may add or remove members; the answer is
 * produced here so both writes use the same authorization decision.
 */
async function resolveOwnerTarget(store, request, response, params) {
  const { state, account } = await resolveSessionAccount(store, request);
  const organization = findOrganizationBySlug(state, params.slug);
  if (!organization) {
    sendJson(response, 404, { error: NOT_FOUND });
    return null;
  }
  if (!account) {
    sendJson(response, 401, { error: SIGN_IN_REQUIRED });
    return null;
  }
  if (!isOrganizationOwner(state, organization.id, account.id)) {
    sendJson(response, 403, { error: ACCESS_DENIED });
    return null;
  }
  return { state, account, organization };
}

/**
 * Organization and repository API. Visibility and read access are decided here
 * from the authoritative state: a visitor only ever receives public data, while
 * the Repositories list and the repository overview apply the repository access
 * rules for the current session.
 */
export function createOrganizationRouter({ store }) {
  const router = createRouter();

  // Public directory used by visitors to discover public organization pages.
  router.add("GET", "/api/explore/organizations", async (request, response) => {
    const state = await store.read();
    sendJson(response, 200, {
      organizations: state.organizations.map(toPublicOrganization),
    });
  });

  // "Your organizations": only organizations the signed-in account is a member of.
  router.add("GET", "/api/organizations", async (request, response) => {
    const { state, account } = await resolveSessionAccount(store, request);
    if (!account) {
      sendJson(response, 401, { error: SIGN_IN_REQUIRED });
      return;
    }
    const organizations = listOrganizationsForAccount(state, account.id).map(({ organization, role }) => ({
      ...toPublicOrganization(organization),
      role,
    }));
    sendJson(response, 200, { organizations });
  });

  router.add("POST", "/api/organizations", async (request, response) => {
    const body = await readBody(request, response);
    if (body === null) return;
    const { account } = await resolveSessionAccount(store, request);
    if (!account) {
      sendJson(response, 401, { error: SIGN_IN_REQUIRED });
      return;
    }
    // The owner relationship is created in the same mutation as the organization.
    const result = await store.mutate((state) => {
      const current = state.accounts.find((candidate) => (
        candidate.id === account.id && candidate.status === "available"
      ));
      if (!current) return { authenticated: false };
      return { authenticated: true, ...createOrganization(state, current, body) };
    });
    if (!result.authenticated) {
      sendJson(response, 401, { error: SIGN_IN_REQUIRED });
      return;
    }
    if (result.errors) {
      sendJson(response, 400, { errors: result.errors });
      return;
    }
    sendJson(response, 201, { organization: toPublicOrganization(result.organization) });
  });

  router.add("GET", "/api/organizations/:slug/repositories", async (request, response, params) => {
    const { state, account } = await resolveSessionAccount(store, request);
    const organization = findOrganizationBySlug(state, params.slug);
    if (!organization) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    const repositories = listVisibleRepositories(state, organization.id, account?.id ?? null)
      .map(toPublicRepository);
    sendJson(response, 200, { organization: toPublicOrganization(organization), repositories });
  });

  router.add("GET", "/api/organizations/:slug/repositories/:name", async (request, response, params) => {
    const { state, account } = await resolveSessionAccount(store, request);
    const organization = findOrganizationBySlug(state, params.slug);
    if (!organization) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    const repository = findRepository(state, organization.id, params.name);
    if (!repository) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    if (!canReadRepository(state, repository, account?.id ?? null)) {
      // A visitor is told nothing about a private repository; a signed-in but
      // unauthorized account gets the explicit access denial.
      sendJson(response, account ? 403 : 404, { error: account ? ACCESS_DENIED : NOT_FOUND });
      return;
    }
    sendJson(response, 200, {
      repository: {
        ...toPublicRepository(repository),
        organization: toPublicOrganization(organization),
        // Only an organization Owner or a repository Admin reaches repository
        // Settings; the flag decides whether the entry is offered at all.
        canManageAccess: canManageRepositoryAccess(state, repository, account?.id ?? null),
      },
    });
  });

  router.add("GET", "/api/organizations/:slug/members", async (request, response, params) => {
    const state = await store.read();
    const organization = findOrganizationBySlug(state, params.slug);
    if (!organization) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    sendJson(response, 200, { members: memberRows(state, organization) });
  });

  // Directly adds an existing account to the organization as Member or Owner.
  router.add("POST", "/api/organizations/:slug/members", async (request, response, params) => {
    const body = await readBody(request, response);
    if (body === null) return;
    const target = await resolveOwnerTarget(store, request, response, params);
    if (!target) return;
    const result = await store.mutate((state) => {
      const organization = findOrganizationBySlug(state, params.slug);
      if (!organization) return { missing: true };
      return addOrganizationMember(state, organization, body);
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
    sendJson(response, 200, { members: memberRows(state, findOrganizationBySlug(state, params.slug)) });
  });

  // Removes the membership together with the account's team memberships and
  // direct repository grants of this organization.
  router.add("DELETE", "/api/organizations/:slug/members/:username", async (request, response, params) => {
    const target = await resolveOwnerTarget(store, request, response, params);
    if (!target) return;
    const result = await store.mutate((state) => {
      const organization = findOrganizationBySlug(state, params.slug);
      if (!organization) return { missing: true };
      return removeOrganizationMember(state, organization, params.username);
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
    sendJson(response, 200, { members: memberRows(state, findOrganizationBySlug(state, params.slug)) });
  });

  router.add("GET", "/api/organizations/:slug", async (request, response, params) => {
    const { state, account } = await resolveSessionAccount(store, request);
    const organization = findOrganizationBySlug(state, params.slug);
    if (!organization) {
      sendJson(response, 404, { error: NOT_FOUND });
      return;
    }
    sendJson(response, 200, {
      organization: toPublicOrganization(organization),
      role: organizationRoleOf(state, organization.id, account?.id ?? null),
    });
  });

  return router;
}
