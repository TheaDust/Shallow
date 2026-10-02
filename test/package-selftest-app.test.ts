import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { withTempDir } from "./helpers/temp-dir.js";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL("../scripts/package-selftest-app.mjs", import.meta.url));

// The self-test channel rejects the upload outright when the zip root is not the
// app root, so assert on the archive itself rather than on the staging directory
// the script happens to keep around.
function readZipEntryNames(archive: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset + 30 <= archive.length) {
    if (archive.readUInt32LE(offset) !== 0x04034b50) break;
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    names.push(archive.toString("utf8", offset + 30, offset + 30 + nameLength));
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  return names;
}

async function writeApp(source: string): Promise<void> {
  await mkdir(join(source, "frontend", "src"), { recursive: true });
  await mkdir(join(source, "backend", "src"), { recursive: true });
  await writeFile(
    join(source, "frontend", "package.json"),
    JSON.stringify({ name: "app-frontend", scripts: { build: "vite build" } }),
  );
  await writeFile(
    join(source, "backend", "package.json"),
    JSON.stringify({ name: "app-backend", scripts: { start: "node src/server.mjs" } }),
  );
  await writeFile(join(source, "frontend", "src", "main.tsx"), "export {};\n");
  await writeFile(join(source, "backend", "src", "server.mjs"), "export {};\n");
}

async function packageApp(source: string, out: string, extraArgs: string[] = []): Promise<string[]> {
  await execFileAsync(process.execPath, [scriptPath, source, "--skip-build", "--out", out, ...extraArgs]);
  return readZipEntryNames(await readFile(join(out, "app.zip")));
}

test("self-test app zip carries the Dockerfile at the archive root, not under a wrapper folder", async () => {
  await withTempDir("shallow-selftest-zip-", async (directory) => {
    const source = join(directory, "source");
    await writeApp(source);

    const names = await packageApp(source, join(directory, "out"));

    assert.equal(names[0], "Dockerfile");
    assert.ok(names.includes("frontend/package.json"));
    assert.ok(names.includes("backend/src/server.mjs"));
    // The rejection the site reports as "zip 根目录缺少 Dockerfile" is exactly a
    // wrapper folder between the archive root and the Dockerfile.
    for (const name of names) {
      assert.ok(
        !name.split("/")[0].includes("app"),
        `entry is nested under a wrapper folder: ${name}`,
      );
    }
  });
});

test("self-test app zip drops the trees the evaluator reinstalls or ignores", async () => {
  await withTempDir("shallow-selftest-exclude-", async (directory) => {
    const source = join(directory, "source");
    await writeApp(source);
    for (const [path, content] of [
      ["frontend/node_modules/react/index.js", "module.exports = {};\n"],
      ["backend/node_modules/express/index.js", "module.exports = {};\n"],
      ["frontend/dist/index.html", "<!doctype html>\n"],
      ["backend/data/state.json", "{}\n"],
      ["frontend/.git/config", "[core]\n"],
    ] as const) {
      const absolute = join(source, ...path.split("/"));
      await mkdir(join(absolute, ".."), { recursive: true });
      await writeFile(absolute, content);
    }

    const names = await packageApp(source, join(directory, "out"));

    assert.ok(!names.some((name) => name.includes("node_modules/")));
    assert.ok(!names.some((name) => name.startsWith("frontend/dist/")));
    assert.ok(!names.some((name) => name.includes("/.git/")));
    // backend/data is the ambiguous one: the scaffold store falls back to the
    // in-code initial value when it is missing, so a data dir holding seed data
    // must survive by default.
    assert.ok(names.includes("backend/data/state.json"));
  });
});

test("self-test app zip can drop backend/data when it is local runtime state", async () => {
  await withTempDir("shallow-selftest-data-", async (directory) => {
    const source = join(directory, "source");
    await writeApp(source);
    const absolute = join(source, "backend", "data", "state.json");
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, "{}\n");

    const names = await packageApp(source, join(directory, "out"), ["--exclude-data"]);

    assert.ok(!names.some((name) => name.startsWith("backend/data/")));
    assert.ok(names.includes("backend/src/server.mjs"));
  });
});

test("self-test app packaging refuses an output dir that has no runnable app", async () => {
  await withTempDir("shallow-selftest-empty-", async (directory) => {
    const source = join(directory, "source");
    await mkdir(join(source, ".arc"), { recursive: true });

    await assert.rejects(
      () => execFileAsync(process.execPath, [scriptPath, source, "--skip-build", "--out", join(directory, "out")]),
      (error: unknown) => {
        const stderr = (error as { stderr?: string }).stderr ?? "";
        assert.match(stderr, /frontend[\\/]package\.json/);
        assert.match(stderr, /产物目录不完整/);
        return true;
      },
    );
  });
});
