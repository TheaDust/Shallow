import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createJsonStore } from "./json-store.mjs";
import { ensureSeedData } from "../domain/seed.mjs";

const EMPTY_STATE = {
  accounts: [],
  sessions: [],
  organizations: [],
  organizationMembers: [],
  repositories: [],
  repositoryGrants: [],
  teams: [],
  teamMembers: [],
  branches: [],
  commits: [],
  repositoryFiles: [],
};

const here = dirname(fileURLToPath(import.meta.url));

export function resolveDataDir(dataDir) {
  if (typeof dataDir === "string" && dataDir.length > 0) return dataDir;
  if (typeof process.env.SHALLOW_DATA_DIR === "string" && process.env.SHALLOW_DATA_DIR.length > 0) {
    return process.env.SHALLOW_DATA_DIR;
  }
  return resolve(here, "../../.data");
}

/**
 * Single authoritative state store. Reads and mutations go through the JSON
 * file store so that concurrent requests are serialized and every write is
 * atomic; the seed is applied once, before the first read of a fresh data dir.
 */
export function createStateStore(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const store = createJsonStore(join(dataDir, "state.json"), EMPTY_STATE);
  let seeded = false;

  async function ensureSeeded() {
    if (seeded) return;
    await store.update((state) => {
      ensureSeedData(state);
    });
    seeded = true;
  }

  return {
    filePath: join(dataDir, "state.json"),
    async read() {
      await ensureSeeded();
      return store.read();
    },
    async mutate(mutator) {
      await ensureSeeded();
      let result;
      await store.update((state) => {
        result = mutator(state);
        return undefined;
      });
      return result;
    },
  };
}
