import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSeedState } from "./domain/workbooks.mjs";
import { createJsonStore } from "./lib/json-store.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export function resolveDataDirectory(env = process.env) {
  const configured = env.SHALLOW_DATA_DIR;
  if (!configured) return resolve(here, "../data");
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

export function workbookStorePath(directory = resolveDataDirectory()) {
  return join(directory, "workbooks.json");
}

/** Single authoritative workbook state, persisted atomically as JSON. */
export function createWorkbookStore(directory = resolveDataDirectory()) {
  return createJsonStore(workbookStorePath(directory), createSeedState());
}
