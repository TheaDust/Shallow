import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  EVO_ARCHIVE_WORKBOOK_ID,
  EVO_RENAME_DUP_WORKBOOK_ID,
  EVO_RENAME_LIMIT_WORKBOOK_ID,
  EVO_RENAME_WORKBOOK_ID,
  createSeedState,
} from "../src/store/workbooks.mjs";

/** The 81-character value of the length scenario. */
const TOO_LONG_NAME = `EVO-${"A".repeat(77)}`;

/** An 80-character name, the longest one accepted after trimming. */
const MAX_LENGTH_NAME = "B".repeat(80);

async function startApp({ state } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-rename-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-dist-"));
  await mkdir(join(staticRoot, "assets"), { recursive: true });
  await writeFile(join(staticRoot, "index.html"), "<!doctype html><div id=\"root\"></div>", "utf8");
  if (state) await writeFile(join(dataDir, "workbooks.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const server = createServer(createRequestHandler({ dataDir, staticRoot }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    dataDir,
    staticRoot,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async stop() {
      await new Promise((done) => server.close(done));
    },
    /** Second server on the same data directory, as after a restart. */
    async restart() {
      await new Promise((done) => server.close(done));
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot }));
      await new Promise((done) => restarted.listen(0, "127.0.0.1", done));
      return {
        baseUrl: `http://127.0.0.1:${restarted.address().port}`,
        async stop() {
          await new Promise((done) => restarted.close(done));
        },
      };
    },
  };
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function rename(baseUrl, id, name) {
  return json(baseUrl, `/api/workbooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

function detail(baseUrl, id) {
  return json(baseUrl, `/api/workbooks/${encodeURIComponent(id)}`);
}

test("pre-provisions the rename workbooks with their active worksheet and sentinel cells", async () => {
  const app = await startApp();
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    const names = list.body.workbooks.map((entry) => entry.name);
    for (const expected of [
      EVO_RENAME_WORKBOOK_ID,
      EVO_RENAME_DUP_WORKBOOK_ID,
      EVO_ARCHIVE_WORKBOOK_ID,
      EVO_RENAME_LIMIT_WORKBOOK_ID,
    ]) {
      assert.ok(names.includes(expected), `missing pre-provisioned workbook ${expected}`);
    }

    const ok = await detail(app.baseUrl, EVO_RENAME_WORKBOOK_ID);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.workbook.name, "EVO-M01-RENAME-OK");
    assert.equal(ok.body.workbook.activeWorksheetId, ok.body.workbook.worksheets[0].id);
    assert.equal(ok.body.workbook.worksheets[0].name, "IdentityLog");
    assert.equal(ok.body.workbook.worksheets[0].cells.F3, "unreviewed");

    const duplicate = await detail(app.baseUrl, EVO_RENAME_DUP_WORKBOOK_ID);
    assert.equal(duplicate.body.workbook.name, "EVO-M01-RENAME-DUP");
    assert.equal(duplicate.body.workbook.worksheets[0].name, "IdentityLog");

    const archive = await detail(app.baseUrl, EVO_ARCHIVE_WORKBOOK_ID);
    assert.equal(archive.body.workbook.name, "EVO-M01-ARCHIVE-RESERVED");

    const limit = await detail(app.baseUrl, EVO_RENAME_LIMIT_WORKBOOK_ID);
    assert.equal(limit.body.workbook.name, "EVO-M01-RENAME-LIMIT");
    assert.equal(limit.body.workbook.worksheets[0].name, "LimitProbe");
    assert.equal(limit.body.workbook.worksheets[0].cells.C2, "limit sentinel");
  } finally {
    await app.stop();
  }
});

test("trims and persists an available workbook name without touching its cells", async () => {
  const app = await startApp();
  try {
    const renamed = await rename(app.baseUrl, EVO_RENAME_WORKBOOK_ID, "  FY26 Procurement Ledger  ");
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.workbook.name, "FY26 Procurement Ledger");
    assert.equal(renamed.body.workbook.worksheets[0].cells.F3, "unreviewed");

    const restarted = await app.restart();
    try {
      const persisted = await detail(restarted.baseUrl, EVO_RENAME_WORKBOOK_ID);
      assert.equal(persisted.body.workbook.name, "FY26 Procurement Ledger");
      assert.equal(persisted.body.workbook.worksheets[0].name, "IdentityLog");
      assert.equal(persisted.body.workbook.worksheets[0].cells.F3, "unreviewed");
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("rejects a case-insensitive duplicate name and keeps the last successful name", async () => {
  const app = await startApp();
  try {
    const lowered = await rename(app.baseUrl, EVO_RENAME_DUP_WORKBOOK_ID, "evo-m01-archive-reserved");
    assert.equal(lowered.status, 400);
    assert.equal(lowered.body.error, "Workbook name already exists");

    const exact = await rename(app.baseUrl, EVO_RENAME_DUP_WORKBOOK_ID, "EVO-M01-ARCHIVE-RESERVED");
    assert.equal(exact.status, 400);
    assert.equal(exact.body.error, "Workbook name already exists");

    const kept = await detail(app.baseUrl, EVO_RENAME_DUP_WORKBOOK_ID);
    assert.equal(kept.body.workbook.name, "EVO-M01-RENAME-DUP");
    const archive = await detail(app.baseUrl, EVO_ARCHIVE_WORKBOOK_ID);
    assert.equal(archive.body.workbook.name, "EVO-M01-ARCHIVE-RESERVED");
    // A rejected rename changes no record at all.
    const list = await json(app.baseUrl, "/api/workbooks");
    assert.equal(list.body.workbooks.length, createSeedState().workbooks.length);

    // Its own name is not a duplicate, not even with different letter case.
    const own = await rename(app.baseUrl, EVO_RENAME_DUP_WORKBOOK_ID, "evo-m01-rename-dup");
    assert.equal(own.status, 200);
    assert.equal(own.body.workbook.name, "evo-m01-rename-dup");

    const restarted = await app.restart();
    try {
      const persisted = await detail(restarted.baseUrl, EVO_RENAME_DUP_WORKBOOK_ID);
      assert.equal(persisted.body.workbook.name, "evo-m01-rename-dup");
      const keptArchive = await detail(restarted.baseUrl, EVO_ARCHIVE_WORKBOOK_ID);
      assert.equal(keptArchive.body.workbook.name, "EVO-M01-ARCHIVE-RESERVED");
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("rejects a workbook name longer than 80 characters and accepts 80 after trimming", async () => {
  const app = await startApp();
  try {
    assert.equal(TOO_LONG_NAME.length, 81);

    const tooLong = await rename(app.baseUrl, EVO_RENAME_LIMIT_WORKBOOK_ID, TOO_LONG_NAME);
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.error, "Workbook name must be 80 characters or fewer");

    const kept = await detail(app.baseUrl, EVO_RENAME_LIMIT_WORKBOOK_ID);
    assert.equal(kept.body.workbook.name, "EVO-M01-RENAME-LIMIT");
    assert.equal(kept.body.workbook.worksheets[0].cells.C2, "limit sentinel");

    const padded = await rename(app.baseUrl, EVO_RENAME_LIMIT_WORKBOOK_ID, `  ${MAX_LENGTH_NAME}  `);
    assert.equal(padded.status, 200);
    assert.equal(padded.body.workbook.name, MAX_LENGTH_NAME);

    const restarted = await app.restart();
    try {
      const persisted = await detail(restarted.baseUrl, EVO_RENAME_LIMIT_WORKBOOK_ID);
      assert.equal(persisted.body.workbook.name, MAX_LENGTH_NAME);
      assert.equal(persisted.body.workbook.worksheets[0].cells.C2, "limit sentinel");
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("reports an unknown workbook and an empty name without changing stored state", async () => {
  const app = await startApp();
  try {
    assert.equal((await rename(app.baseUrl, "no-such-workbook", "Anything")).status, 404);

    const empty = await rename(app.baseUrl, EVO_RENAME_WORKBOOK_ID, "   ");
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, "Workbook name cannot be empty");
    const kept = await detail(app.baseUrl, EVO_RENAME_WORKBOOK_ID);
    assert.equal(kept.body.workbook.name, "EVO-M01-RENAME-OK");
  } finally {
    await app.stop();
  }
});

test("upgrades an older store by adding the missing pre-provisioned workbooks only once", async () => {
  const legacy = createSeedState();
  legacy.workbooks = legacy.workbooks.filter(
    (workbook) => workbook.id !== EVO_RENAME_WORKBOOK_ID && workbook.id !== EVO_RENAME_LIMIT_WORKBOOK_ID,
  );
  // An existing store: the baseline workbook renamed by a user, a workbook
  // created by a user and a pre-provisioned record the user renamed. All three
  // must survive the upgrade untouched.
  const baseline = legacy.workbooks.find((workbook) => workbook.id === "wb-q3-sales");
  baseline.name = "My Ledger";
  baseline.worksheets[0].cells.A1 = "Region edited";
  const renamedSeed = legacy.workbooks.find((workbook) => workbook.id === EVO_RENAME_DUP_WORKBOOK_ID);
  renamedSeed.name = "Archive notes (mine)";
  legacy.workbooks.push({
    id: "user-workbook-1",
    name: "My own workbook",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:05:00.000Z",
    activeWorksheetId: "user-worksheet-1",
    worksheets: [{ id: "user-worksheet-1", name: "Sheet1", selection: { anchor: "A1", focus: "A1" }, cells: {} }],
  });

  const app = await startApp({ state: legacy });
  try {
    const first = await json(app.baseUrl, "/api/workbooks");
    const ids = first.body.workbooks.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, "upgrade must not duplicate workbooks");
    assert.ok(ids.includes(EVO_RENAME_WORKBOOK_ID));
    assert.ok(ids.includes(EVO_RENAME_LIMIT_WORKBOOK_ID));
    assert.ok(ids.includes("user-workbook-1"));
    // The user-renamed baseline workbook and its edited cell stay as they are.
    const renamedBaseline = first.body.workbooks.find((entry) => entry.id === "wb-q3-sales");
    assert.equal(renamedBaseline.name, "My Ledger");
    // A record that already exists keeps its stored name instead of the seed name.
    const keptSeed = await detail(app.baseUrl, EVO_RENAME_DUP_WORKBOOK_ID);
    assert.equal(keptSeed.body.workbook.name, "Archive notes (mine)");

    const restarted = await app.restart();
    try {
      const second = await json(restarted.baseUrl, "/api/workbooks");
      const secondIds = second.body.workbooks.map((entry) => entry.id);
      assert.equal(new Set(secondIds).size, secondIds.length);
      assert.equal(secondIds.length, first.body.workbooks.length);
      const persistedSeed = await detail(restarted.baseUrl, EVO_RENAME_WORKBOOK_ID);
      assert.equal(persistedSeed.body.workbook.name, "EVO-M01-RENAME-OK");
      assert.equal(persistedSeed.body.workbook.worksheets[0].cells.F3, "unreviewed");
      const persistedBaseline = await detail(restarted.baseUrl, "wb-q3-sales");
      assert.equal(persistedBaseline.body.workbook.name, "My Ledger");
      assert.equal(persistedBaseline.body.workbook.worksheets[0].cells.A1, "Region edited");
      assert.equal(persistedBaseline.body.workbook.worksheets.length, 2);
    } finally {
      await restarted.stop();
    }

    const onDisk = JSON.parse(await readFile(join(app.dataDir, "workbooks.json"), "utf8"));
    assert.equal(onDisk.workbooks.filter((workbook) => workbook.id === EVO_RENAME_WORKBOOK_ID).length, 1);
    assert.equal(onDisk.workbooks.filter((workbook) => workbook.id === EVO_RENAME_LIMIT_WORKBOOK_ID).length, 1);
  } finally {
    await app.stop();
  }
});
