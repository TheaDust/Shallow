import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readJson, sendJson } from "./lib/http.mjs";
import { getStores } from "./lib/db.mjs";
import { handleAuthRoutes } from "./routes/auth.mjs";
import { handleOrganizationRoutes } from "./routes/organizations.mjs";
import { handleRepositoryCollectionRoutes } from "./routes/repository-creation.mjs";
import { handleRepositoryRoutes } from "./routes/repositories.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const staticRoot = resolve(here, "../../frontend/dist");
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

async function readBody(request) {
  try {
    return { body: await readJson(request, { limitBytes: 64_000 }) };
  } catch {
    return { body: null };
  }
}

async function serveStatic(response, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!relative || relative.includes("..") || relative.startsWith("api/")) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  try {
    const content = await readFile(join(staticRoot, relative));
    response.writeHead(200, {
      "content-type": contentTypes.get(extname(relative)) ?? "application/octet-stream",
    });
    response.end(content);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    throw error;
  }
}

export function createRequestHandler() {
  return async function handler(request, response) {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/health")) {
        sendJson(response, 200, { ok: true });
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        const stores = getStores();
        const { body } = await readBody(request);
        const hasBody =
          request.method === "POST" || request.method === "PUT" || request.method === "PATCH";
        if (body === null && hasBody) {
          sendJson(response, 400, { error: "Invalid JSON body" });
          return;
        }
        const handled = await handleAuthRoutes({
          request,
          response,
          url,
          stores,
          body: body ?? {},
        });
        if (handled) return;
        const handledOrganization = await handleOrganizationRoutes({
          request,
          response,
          url,
          stores,
          body: body ?? {},
        });
        if (handledOrganization) return;
        const handledRepositoryCollection = await handleRepositoryCollectionRoutes({
          request,
          response,
          url,
          stores,
          body: body ?? {},
        });
        if (handledRepositoryCollection) return;
        const handledRepository = await handleRepositoryRoutes({
          request,
          response,
          url,
          stores,
          body: body ?? {},
        });
        if (handledRepository) return;
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      await serveStatic(response, url.pathname);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
