import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { createJsonStore } from "./json-store.mjs";
import { normalizeState, seedState } from "../domain/workbook-model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const defaultDataDir = resolve(here, "../../.data");

/**
 * Directory holding persisted state. Controllers inject an isolated temporary
 * directory through SHALLOW_DATA_DIR so each run keeps its own storage.
 */
export function resolveDataDir(explicit) {
  return explicit ?? process.env.SHALLOW_DATA_DIR ?? defaultDataDir;
}

/**
 * JSON-backed store for the workbook aggregate. Empty storage is seeded with
 * the shared seed state; later successful mutations overwrite it and survive
 * restarts.
 *
 * Every read and write passes through `normalizeState`, so a workbook planted
 * or pre-provisioned by hand (for example an evaluation seed that only lists
 * cell values) is served with the grid size, selection and rule list the
 * editor needs, and its formulas stay intact.
 */
export function createWorkbookStore(options = {}) {
  const filePath = join(resolveDataDir(options.dataDir), "workbooks.json");
  const store = createJsonStore(filePath, seedState());
  return {
    async read() {
      return normalizeState(await store.read());
    },
    update(mutator) {
      return store.update(async (draft) => {
        const working = normalizeState(draft);
        const returned = await mutator(working);
        return normalizeState(returned === undefined ? working : returned);
      });
    },
  };
}
