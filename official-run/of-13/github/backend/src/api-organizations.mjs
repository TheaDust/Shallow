import { readJson, sendJson } from "./lib/http.mjs";
import { ORGANIZATION_MESSAGES } from "./lib/organizations.mjs";
import { TEAM_MESSAGES } from "./lib/teams.mjs";

async function readBody(request) {
  try {
    return await readJson(request);
  } catch {
    return null;
  }
}

function sendFieldError(response, error, fieldErrors, status = 400) {
  sendJson(response, status, { error, fieldErrors });
}

/**
 * Routes for organizations, their members/teams and repository access.
 * `account` is the account resolved from the trusted session cookie for this
 * request, or null for a visitor; permission decisions always happen here,
 * never in the client.
 */
export function createOrganizationApi({ organizations, teams, access }) {
  async function handleOrganizations(request, response, method, segments, { account }) {
    const organizationName = decodeURIComponent(segments[0]);
    const section = segments[1];
    const accountId = account?.id ?? null;

    if (!section) {
      if (method === "GET") {
        const detail = await organizations.detailForViewer(organizationName, accountId);
        if (!detail) {
          sendJson(response, 404, { error: ORGANIZATION_MESSAGES.notFound });
          return true;
        }
        sendJson(response, 200, detail);
        return true;
      }
      return false;
    }

    if (section === "repositories") {
      if (method !== "GET" || segments.length !== 2) return false;
      const repositories = await organizations.repositoriesFor(organizationName, accountId);
      if (!repositories) {
        sendJson(response, 404, { error: ORGANIZATION_MESSAGES.notFound });
        return true;
      }
      sendJson(response, 200, { repositories });
      return true;
    }

    if (section === "members") {
      if (segments.length === 2) {
        if (method === "GET") {
          const members = await organizations.membersFor(organizationName);
          if (!members) {
            sendJson(response, 404, { error: ORGANIZATION_MESSAGES.notFound });
            return true;
          }
          sendJson(response, 200, { members });
          return true;
        }
        if (method === "POST") {
          if (!account) {
            sendJson(response, 401, { error: ORGANIZATION_MESSAGES.notAuthenticated });
            return true;
          }
          const body = await readBody(request);
          if (body === null) {
            sendJson(response, 400, { error: "Invalid request body" });
            return true;
          }
          const outcome = await organizations.addMember(organizationName, account.id, body);
          if (outcome.notFound) {
            sendJson(response, 404, { error: ORGANIZATION_MESSAGES.notFound });
            return true;
          }
          if (outcome.forbidden) {
            sendJson(response, 403, { error: ORGANIZATION_MESSAGES.accessDenied });
            return true;
          }
          if (!outcome.ok) {
            sendFieldError(response, "Member not added", outcome.fieldErrors);
            return true;
          }
          sendJson(response, 201, { member: outcome.member });
          return true;
        }
        return false;
      }

      if (segments.length === 3 && method === "DELETE") {
        if (!account) {
          sendJson(response, 401, { error: ORGANIZATION_MESSAGES.notAuthenticated });
          return true;
        }
        const username = decodeURIComponent(segments[2]);
        const outcome = await organizations.removeMember(organizationName, account.id, username);
        if (outcome.notFound) {
          sendJson(response, 404, { error: ORGANIZATION_MESSAGES.notFound });
          return true;
        }
        if (outcome.forbidden) {
          sendJson(response, 403, { error: ORGANIZATION_MESSAGES.accessDenied });
          return true;
        }
        if (!outcome.ok) {
          sendFieldError(response, "Member not removed", outcome.fieldErrors);
          return true;
        }
        sendJson(response, 200, { ok: true });
        return true;
      }
      return false;
    }

    if (section === "teams") {
      if (segments.length === 2) {
        if (method === "GET") {
          const list = await teams.list(organizationName);
          if (!list) {
            sendJson(response, 404, { error: ORGANIZATION_MESSAGES.notFound });
            return true;
          }
          sendJson(response, 200, { teams: list });
          return true;
        }
        if (method === "POST") {
          if (!account) {
            sendJson(response, 401, { error: ORGANIZATION_MESSAGES.notAuthenticated });
            return true;
          }
          const body = await readBody(request);
          if (body === null) {
            sendJson(response, 400, { error: "Invalid request body" });
            return true;
          }
          const outcome = await teams.create(organizationName, account.id, body);
          if (outcome.notFound) {
            sendJson(response, 404, { error: ORGANIZATION_MESSAGES.notFound });
            return true;
          }
          if (outcome.forbidden) {
            sendJson(response, 403, { error: ORGANIZATION_MESSAGES.accessDenied });
            return true;
          }
          if (!outcome.ok) {
            sendFieldError(response, "Team not created", outcome.fieldErrors);
            return true;
          }
          sendJson(response, 201, { team: outcome.team });
          return true;
        }
        return false;
      }

      const teamName = decodeURIComponent(segments[2]);

      if (segments.length === 3) {
        if (method === "GET") {
          const detail = await teams.detail(organizationName, teamName, accountId);
          if (!detail) {
            sendJson(response, 404, { error: TEAM_MESSAGES.teamNotFound });
            return true;
          }
          sendJson(response, 200, detail);
          return true;
        }
        if (method === "PATCH" || method === "PUT") {
          if (!account) {
            sendJson(response, 401, { error: ORGANIZATION_MESSAGES.notAuthenticated });
            return true;
          }
          const body = await readBody(request);
          if (body === null) {
            sendJson(response, 400, { error: "Invalid request body" });
            return true;
          }
          const outcome = await teams.setParent(organizationName, teamName, account.id, body);
          if (outcome.notFound) {
            sendJson(response, 404, { error: TEAM_MESSAGES.teamNotFound });
            return true;
          }
          if (outcome.forbidden) {
            sendJson(response, 403, { error: ORGANIZATION_MESSAGES.accessDenied });
            return true;
          }
          if (!outcome.ok) {
            sendFieldError(response, "Parent team not saved", outcome.fieldErrors);
            return true;
          }
          sendJson(response, 200, { team: outcome.team });
          return true;
        }
        return false;
      }

      if (segments[3] !== "members") return false;

      if (segments.length === 4) {
        if (method !== "POST") return false;
        if (!account) {
          sendJson(response, 401, { error: ORGANIZATION_MESSAGES.notAuthenticated });
          return true;
        }
        const body = await readBody(request);
        if (body === null) {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }
        const outcome = await teams.addMember(organizationName, teamName, account.id, body);
        if (outcome.notFound) {
          sendJson(response, 404, { error: TEAM_MESSAGES.teamNotFound });
          return true;
        }
        if (outcome.forbidden) {
          sendJson(response, 403, { error: ORGANIZATION_MESSAGES.accessDenied });
          return true;
        }
        if (!outcome.ok) {
          sendFieldError(response, "Member not added", outcome.fieldErrors);
          return true;
        }
        sendJson(response, 201, { member: outcome.member });
        return true;
      }

      if (segments.length === 5 && method === "DELETE") {
        if (!account) {
          sendJson(response, 401, { error: ORGANIZATION_MESSAGES.notAuthenticated });
          return true;
        }
        const username = decodeURIComponent(segments[4]);
        const outcome = await teams.removeMember(organizationName, teamName, account.id, username);
        if (outcome.notFound) {
          sendJson(response, 404, { error: TEAM_MESSAGES.teamNotFound });
          return true;
        }
        if (outcome.forbidden) {
          sendJson(response, 403, { error: ORGANIZATION_MESSAGES.accessDenied });
          return true;
        }
        if (!outcome.ok) {
          sendFieldError(response, "Member not removed", outcome.fieldErrors);
          return true;
        }
        sendJson(response, 200, { ok: true });
        return true;
      }
      return false;
    }

    return false;
  }

  return async function handleOrganizationApi(request, response, url, { account }) {
    const method = request.method ?? "GET";
    const segments = url.pathname.split("/").filter(Boolean);

    if (segments[0] === "api" && segments[1] === "organizations") {
      if (segments.length === 2) {
        if (url.pathname !== "/api/organizations") return false;
        if (method === "GET") {
          if (!account) {
            sendJson(response, 401, { error: ORGANIZATION_MESSAGES.notAuthenticated });
            return true;
          }
          const list = await organizations.listForAccount(account.id);
          sendJson(response, 200, { organizations: list });
          return true;
        }
        if (method === "POST") {
          if (!account) {
            sendJson(response, 401, { error: ORGANIZATION_MESSAGES.notAuthenticated });
            return true;
          }
          const body = await readBody(request);
          if (body === null) {
            sendJson(response, 400, { error: "Invalid request body" });
            return true;
          }
          const outcome = await organizations.create(account.id, body);
          if (!outcome.ok) {
            sendFieldError(response, "Organization creation failed", outcome.fieldErrors);
            return true;
          }
          sendJson(response, 201, { organization: outcome.organization });
          return true;
        }
        return false;
      }
      return handleOrganizations(request, response, method, segments.slice(2), { account });
    }

    if (segments[0] === "api" && segments[1] === "repositories" && segments.length >= 4) {
      const owner = decodeURIComponent(segments[2]);
      const repositoryName = decodeURIComponent(segments[3]);

      if (segments.length === 4) {
        if (method !== "GET") return false;
        const outcome = await organizations.repositoryForViewer(
          owner,
          repositoryName,
          account?.id ?? null,
        );
        if (outcome.status === "not-found") {
          sendJson(response, 404, { error: "Not found" });
          return true;
        }
        if (outcome.status === "denied") {
          sendJson(response, 403, { error: ORGANIZATION_MESSAGES.accessDenied });
          return true;
        }
        sendJson(response, 200, {
          repository: outcome.repository,
          viewerRole: outcome.viewerRole ?? null,
          canAdminister: outcome.canAdminister === true,
        });
        return true;
      }

      // Repository access management: `.../access` lists and stores direct
      // role grants for organization members and teams.
      if (segments.length === 5 && segments[4] === "access") {
        if (method === "GET") {
          const outcome = await access.accessForViewer(
            owner,
            repositoryName,
            account?.id ?? null,
          );
          if (outcome.status === "not-found") {
            sendJson(response, 404, { error: "Not found" });
            return true;
          }
          if (outcome.status !== "ok") {
            sendJson(response, 403, { error: ORGANIZATION_MESSAGES.accessDenied });
            return true;
          }
          sendJson(response, 200, outcome.access);
          return true;
        }
        if (method === "PUT" || method === "POST") {
          if (!account) {
            sendJson(response, 401, { error: ORGANIZATION_MESSAGES.notAuthenticated });
            return true;
          }
          const body = await readBody(request);
          if (body === null) {
            sendJson(response, 400, { error: "Invalid request body" });
            return true;
          }
          const outcome = await access.saveGrant(owner, repositoryName, account.id, body);
          if (outcome.notFound) {
            sendJson(response, 404, { error: "Not found" });
            return true;
          }
          if (outcome.unauthorized) {
            sendJson(response, 401, { error: ORGANIZATION_MESSAGES.notAuthenticated });
            return true;
          }
          if (outcome.forbidden) {
            sendJson(response, 403, { error: ORGANIZATION_MESSAGES.accessDenied });
            return true;
          }
          if (!outcome.ok) {
            sendFieldError(response, "Grant not saved", outcome.fieldErrors);
            return true;
          }
          sendJson(response, 200, { grants: outcome.grants });
          return true;
        }
        return false;
      }

      return false;
    }

    return false;
  };
}
