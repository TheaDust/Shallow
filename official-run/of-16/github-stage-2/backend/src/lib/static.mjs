import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Resolved from this module's own location so the working directory never matters.
export const staticRoot = resolve(here, "../../../frontend/dist");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

export function resolveStaticPath(pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (!relative) return null;
  const target = normalize(join(staticRoot, relative));
  if (target !== staticRoot && !target.startsWith(staticRoot + sep)) return null;
  return target;
}

/**
 * Serves the built frontend. Missing files and unknown paths return null so the
 * caller can answer 404 without ever throwing out of the request handler.
 */
export async function readStaticFile(pathname) {
  const target = resolveStaticPath(pathname);
  if (!target) return null;
  try {
    return { content: await readFile(target), contentType: contentTypes.get(extname(target)) ?? "application/octet-stream" };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") return null;
    throw error;
  }
}
