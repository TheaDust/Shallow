import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function clone(value) {
  return structuredClone(value);
}

export function createJsonStore(filePath, initialValue) {
  let queue = Promise.resolve();

  async function readCurrent() {
    try {
      return JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return clone(initialValue);
      throw error;
    }
  }

  async function writeAtomic(value) {
    await mkdir(dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, filePath);
  }

  return {
    async read() {
      await queue;
      return clone(await readCurrent());
    },

    /** Writes the initial value to disk when the file does not exist yet. */
    seedIfMissing() {
      const operation = queue.then(async () => {
        try {
          await readFile(filePath);
          return false;
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        await writeAtomic(clone(initialValue));
        return true;
      });
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    },

    update(mutator) {
      const operation = queue.then(async () => {
        const draft = clone(await readCurrent());
        const returned = await mutator(draft);
        const next = returned === undefined ? draft : returned;
        await writeAtomic(next);
        return clone(next);
      });
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
}
