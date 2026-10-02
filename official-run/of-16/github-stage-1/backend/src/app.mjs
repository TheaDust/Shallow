import { createAuthRouter } from "./routes/auth.mjs";
import { createOrganizationRouter } from "./routes/organizations.mjs";
import { createRepositoryAccessRouter } from "./routes/repository-access.mjs";
import { createTeamRouter } from "./routes/teams.mjs";
import { sendJson } from "./lib/http.mjs";
import { readStaticFile } from "./lib/static.mjs";

const bodylessMethods = new Set(["GET", "HEAD"]);

/**
 * Builds the single request handler shared by every listening port.
 */
export function createApp({ store }) {
  const auth = createAuthRouter({ store });
  const organizations = createOrganizationRouter({ store });
  const repositoryAccess = createRepositoryAccessRouter({ store });
  const teams = createTeamRouter({ store });

  return async function handle(request, response) {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (url.pathname === "/health" || url.pathname === "/api/health") {
        if (bodylessMethods.has(request.method ?? "")) {
          sendJson(response, 200, { ok: true });
          return;
        }
        sendJson(response, 404, { error: "Not found" });
        return;
      }

      if (await auth.handle(request, response, url)) return;
      if (await organizations.handle(request, response, url)) return;
      if (await repositoryAccess.handle(request, response, url)) return;
      if (await teams.handle(request, response, url)) return;

      if (url.pathname.startsWith("/api/")) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }

      if (!bodylessMethods.has(request.method ?? "")) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }

      const file = await readStaticFile(url.pathname);
      if (!file) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      response.writeHead(200, { "content-type": file.contentType, "content-length": file.content.length });
      response.end(request.method === "HEAD" ? undefined : file.content);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
