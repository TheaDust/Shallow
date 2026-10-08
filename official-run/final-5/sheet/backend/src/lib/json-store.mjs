import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function clone(value) {
  return structuredClone(value);
}

/**
 * Small JSON-file store. `initialValue` seeds a fresh (missing) file. An
 * optional `upgrade(state)` returns a new state (or `undefined` when nothing
 * changed) and is applied to an already existing file, so shipped seed objects
 * can be merged in by stable id without overwriting records a user already
 * edited. Every read and write goes through one queue, so concurrent callers
 * serialize and never interleave a partial file.
 */
export function createJsonStore(filePath, initialValue, { upgrade } = {}) {
  let queue = Promise.resolve();

  async function readFileState() {
    try {
      return JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function writeAtomic(value) {
    await mkdir(dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, filePath);
  }

  /**
   * Loads the current state, seeding a missing file and applying the upgrade to
   * an existing one. Any change is written atomically; an idempotent upgrade
   * leaves the file untouched on the next load, so repeated starts stay stable.
   */
  async function loadState() {
    const current = await readFileState();
    if (current === null) {
      const seeded = clone(initialValue);
      await writeAtomic(seeded);
      return seeded;
    }
    if (typeof upgrade !== "function") return current;
    const draft = clone(current);
    const result = await upgrade(draft);
    const next = result === undefined ? draft : result;
    if (JSON.stringify(next) !== JSON.stringify(current)) await writeAtomic(next);
    return next;
  }

  function run(operation) {
    const queued = queue.then(operation);
    queue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  return {
    async read() {
      return clone(await run(() => loadState()));
    },

    update(mutator) {
      return run(async () => {
        const draft = await loadState();
        const returned = await mutator(draft);
        const next = returned === undefined ? draft : returned;
        await writeAtomic(next);
        return clone(next);
      });
    },
  };
}
