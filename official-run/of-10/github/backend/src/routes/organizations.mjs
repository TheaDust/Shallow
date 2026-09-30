/**
 * Organization, membership and team HTTP routes (REQ-2).
 *
 * The router answers `/api/organizations…` and reports whether it handled the
 * request, so `app.mjs` keeps one dispatch order and every route below shares the
 * store of the account and repository routes. Permissions are decided by the
 * store from the current session; the router only shapes request and response.
 */

import { readJson, sendJson } from "../lib/http.mjs";

const ORGANIZATION_PATH = /^\/api\/organizations(?:\/([^/]+))?(?:\/(.+))?$/;

function decode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function createOrganizationRouter(store) {
  async function readBody(request, response) {
    try {
      return await readJson(request);
    } catch {
      sendJson(response, 400, { error: "Invalid request body" });
      return null;
    }
  }

  function respondWithFailure(response, result) {
    sendJson(response, result.status, { error: result.error, fields: result.fields });
  }

  /**
   * @returns {Promise<boolean>} true when the request was an organization route.
   */
  return async function handleOrganizationRequest({ request, response, method, pathname, sessionId }) {
    if (!pathname.startsWith("/api/organizations")) return false;
    const match = pathname.match(ORGANIZATION_PATH);
    if (!match) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    const login = match[1] ? decode(match[1]) : null;
    const rest = match[2] ?? "";

    if (!login) {
      if (method === "GET") {
        const result = await store.listViewerOrganizations(sessionId);
        if (!result.ok) {
          respondWithFailure(response, result);
          return true;
        }
        sendJson(response, 200, { organizations: result.organizations });
        return true;
      }
      if (method === "POST") {
        const body = await readBody(request, response);
        if (!body) return true;
        const result = await store.createOrganization(sessionId, body);
        if (!result.ok) {
          respondWithFailure(response, result);
          return true;
        }
        sendJson(response, result.status, { organization: result.organization });
        return true;
      }
      sendJson(response, 404, { error: "Not found" });
      return true;
    }

    if (rest === "" && method === "GET") {
      const result = await store.getOrganization(sessionId, login);
      if (!result.ok) {
        respondWithFailure(response, result);
        return true;
      }
      sendJson(response, 200, { organization: result.organization, viewer: result.viewer });
      return true;
    }

    if (rest === "repositories" && method === "GET") {
      const result = await store.listOrganizationRepositories(sessionId, login);
      if (!result.ok) {
        respondWithFailure(response, result);
        return true;
      }
      sendJson(response, 200, {
        organization: result.organization,
        repositories: result.repositories,
      });
      return true;
    }

    if (rest === "members") {
      if (method === "GET") {
        const result = await store.listOrganizationMembers(sessionId, login);
        if (!result.ok) {
          respondWithFailure(response, result);
          return true;
        }
        sendJson(response, 200, {
          organization: result.organization,
          viewer: result.viewer,
          members: result.members,
        });
        return true;
      }
      if (method === "POST") {
        const body = await readBody(request, response);
        if (!body) return true;
        const result = await store.addOrganizationMember(sessionId, login, body);
        if (!result.ok) {
          respondWithFailure(response, result);
          return true;
        }
        sendJson(response, result.status, {
          member: result.member,
          organization: result.organization,
        });
        return true;
      }
    }

    const memberMatch = rest.match(/^members\/(.+)$/);
    if (memberMatch && method === "DELETE") {
      const result = await store.removeOrganizationMember(sessionId, login, decode(memberMatch[1]));
      if (!result.ok) {
        respondWithFailure(response, result);
        return true;
      }
      sendJson(response, 200, { ok: true, organization: result.organization });
      return true;
    }

    if (rest === "teams") {
      if (method === "GET") {
        const result = await store.listOrganizationTeamsForViewer(sessionId, login);
        if (!result.ok) {
          respondWithFailure(response, result);
          return true;
        }
        sendJson(response, 200, {
          organization: result.organization,
          viewer: result.viewer,
          teams: result.teams,
        });
        return true;
      }
      if (method === "POST") {
        const body = await readBody(request, response);
        if (!body) return true;
        const result = await store.createOrganizationTeam(sessionId, login, body);
        if (!result.ok) {
          respondWithFailure(response, result);
          return true;
        }
        sendJson(response, result.status, { team: result.team });
        return true;
      }
    }

    const teamMatch = rest.match(/^teams\/([^/]+)(?:\/(.*))?$/);
    if (teamMatch) {
      const teamName = decode(teamMatch[1]);
      const teamRest = teamMatch[2] ?? "";
      if (!teamRest && method === "GET") {
        const result = await store.getOrganizationTeam(sessionId, login, teamName);
        if (!result.ok) {
          respondWithFailure(response, result);
          return true;
        }
        sendJson(response, 200, {
          organization: result.organization,
          viewer: result.viewer,
          team: result.team,
          members: result.members,
          parentOptions: result.parentOptions,
        });
        return true;
      }
      if (teamRest === "parent" && method === "POST") {
        const body = await readBody(request, response);
        if (!body) return true;
        const result = await store.setOrganizationTeamParent(sessionId, login, teamName, body);
        if (!result.ok) {
          respondWithFailure(response, result);
          return true;
        }
        sendJson(response, 200, { team: result.team });
        return true;
      }
      if (teamRest === "members" && method === "POST") {
        const body = await readBody(request, response);
        if (!body) return true;
        const result = await store.addOrganizationTeamMember(sessionId, login, teamName, body);
        if (!result.ok) {
          respondWithFailure(response, result);
          return true;
        }
        sendJson(response, result.status, { member: result.member, team: result.team });
        return true;
      }
      const teamMemberMatch = teamRest.match(/^members\/(.+)$/);
      if (teamMemberMatch && method === "DELETE") {
        const result = await store.removeOrganizationTeamMember(
          sessionId,
          login,
          teamName,
          decode(teamMemberMatch[1]),
        );
        if (!result.ok) {
          respondWithFailure(response, result);
          return true;
        }
        sendJson(response, 200, { ok: true, team: result.team });
        return true;
      }
    }

    sendJson(response, 404, { error: "Not found" });
    return true;
  };
}
