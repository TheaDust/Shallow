import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { sendJson } from "./lib/http.mjs";
import { createApiHandler } from "./api.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const defaultStaticRoot = resolve(here, "../../frontend/dist");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
]);

function isHeadless(request) {
  return request.method === "HEAD";
}

async function serveStatic(request, response, pathname, staticRoot) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const target = normalize(join(staticRoot, relative));
  if (!target.startsWith(staticRoot + sep) || relative.includes("..")) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  try {
    const content = await readFile(target);
    response.writeHead(200, {
      "content-type": contentTypes.get(extname(target)) ?? "application/octet-stream",
      "content-length": content.length,
    });
    response.end(isHeadless(request) ? undefined : content);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    throw error;
  }
}

/** Builds the single request handler used by every listening port. */
export function createRequestHandler({ store, staticRoot = defaultStaticRoot }) {
  const handleApi = createApiHandler(store);

  return async function handler(request, response) {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (url.pathname === "/health" || url.pathname === "/api/health") {
        if (request.method !== "GET" && !isHeadless(request)) {
          sendJson(response, 405, { error: "Method not allowed" });
          return;
        }
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(isHeadless(request) ? undefined : JSON.stringify({ ok: true }));
        return;
      }

      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        if (await handleApi(request, response, url)) return;
        sendJson(response, 404, { error: "Not found" });
        return;
      }

      if (request.method !== "GET" && !isHeadless(request)) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }

      await serveStatic(request, response, url.pathname, staticRoot);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
