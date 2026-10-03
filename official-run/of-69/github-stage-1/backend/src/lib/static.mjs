import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

import { sendJson } from "./http.mjs";

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
]);

/**
 * Serves the built SPA. Every unknown path (including /favicon.ico and unknown
 * assets) answers 404 instead of letting the process crash.
 */
export async function serveStatic(request, response, staticRoot) {
  const url = new URL(request.url ?? "/", "http://localhost");
  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  if (!relative || relative.includes("..") || relative.startsWith("api/")) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  const target = resolve(staticRoot, normalize(relative));
  if (target !== staticRoot && !target.startsWith(staticRoot + "/")) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  try {
    const content = await readFile(target);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES.get(extname(relative)) ?? "application/octet-stream",
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
