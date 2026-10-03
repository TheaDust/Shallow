import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createWorkbookApi } from "./api/workbooks.mjs";
import { sendJson } from "./lib/http.mjs";
import { createWorkbookStore } from "./lib/workbook-store.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const staticRoot = resolve(here, "../../frontend/dist");
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

async function serveStatic(response, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!relative || relative.includes("..")) {
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
    if (error?.code === "ENOENT") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    throw error;
  }
}

/** Builds the shared request handler and its workbook store. */
export function createApp(options = {}) {
  const store = createWorkbookStore(options);
  const handleWorkbookApi = createWorkbookApi(store);

  async function handler(request, response) {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/health")) {
        sendJson(response, 200, { ok: true });
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        if (await handleWorkbookApi(request, response, url)) return;
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      if (request.method !== "GET") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      await serveStatic(response, url.pathname);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { handler, store };
}
