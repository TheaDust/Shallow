import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { SEED_WORKBOOK_ID, createSeedState } from "../src/store/workbooks.mjs";

const OK_ID = "EVO-M01-RENAME-OK";
const DUP_ID = "EVO-M01-RENAME-DUP";
const ARCHIVE_ID = "EVO-M01-ARCHIVE-RESERVED";
const LIMIT_ID = "EVO-M01-RENAME-LIMIT";

/** 81 characters: `EVO-` followed by 77 `A`s. */
const TOO_LONG_NAME = `EVO-${"A".repeat(77)}`;
/** Exactly the 80-character limit. */
const MAX_LENGTH_NAME = `EVO-${"B".repeat(76)}`;

async function startApp({ dataDir: provided } = {}) {
  const dataDir = provided ?? (await mkdtemp(join(tmpdir(), "shallowcode-rename-")));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-dist-"));
  await writeFile(join(staticRoot, "index.html"), "<!doctype html><div id=\"root\"></div>", "utf8");

  const server = createServer(createRequestHandler({ dataDir, staticRoot }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    dataDir,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise((done) => server.close(done)),
    async restart() {
      await new Promise((done) => server.close(done));
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot }));
      await new Promise((done) => restarted.listen(0, "127.0.0.1", done));
      return {
        baseUrl: `http://127.0.0.1:${restarted.address().port}`,
        stop: () => new Promise((done) => restarted.close(done)),
      };
    },
  };
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function rename(baseUrl, id, name) {
  return json(baseUrl, `/api/workbooks/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

function getWorkbook(baseUrl, id) {
  return json(baseUrl, `/api/workbooks/${id}`).then((response) => response.body.workbook);
}

test("the EVO rename scenarios start from their own pre-provisioned workbooks", async () => {
  const app = await startApp();
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    const ids = list.body.workbooks.map((workbook) => workbook.id);
    for (const id of [OK_ID, DUP_ID, ARCHIVE_ID, LIMIT_ID]) {
      assert.ok(ids.includes(id), `${id} is pre-provisioned`);
    }

    const ok = await getWorkbook(app.baseUrl, OK_ID);
    assert.equal(ok.name, OK_ID);
    assert.equal(ok.worksheets.length, 1);
    assert.equal(ok.worksheets[0].name, "IdentityLog");
    assert.equal(ok.activeWorksheetId, ok.worksheets[0].id);
    assert.equal(ok.worksheets[0].cells.F3, "unreviewed");

    const dup = await getWorkbook(app.baseUrl, DUP_ID);
    assert.equal(dup.name, DUP_ID);
    assert.equal(dup.worksheets[0].name, "IdentityLog");

    const archive = await getWorkbook(app.baseUrl, ARCHIVE_ID);
    assert.equal(archive.name, ARCHIVE_ID);

    const limit = await getWorkbook(app.baseUrl, LIMIT_ID);
    assert.equal(limit.name, LIMIT_ID);
    assert.equal(limit.worksheets[0].name, "LimitProbe");
    assert.equal(limit.worksheets[0].cells.C2, "limit sentinel");
  } finally {
    await app.stop();
  }
});

test("renames a workbook after trimming and keeps the name and cells across restarts", async () => {
  const app = await startApp();
  try {
    const renamed = await rename(app.baseUrl, OK_ID, "  FY26 Procurement Ledger  ");
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.workbook.name, "FY26 Procurement Ledger");

    const restarted = await app.restart();
    try {
      const persisted = await getWorkbook(restarted.baseUrl, OK_ID);
      assert.equal(persisted.name, "FY26 Procurement Ledger");
      assert.equal(persisted.worksheets[0].cells.F3, "unreviewed");
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("rejects a case-insensitive duplicate workbook name and keeps the last successful name", async () => {
  const app = await startApp();
  try {
    const rejected = await rename(app.baseUrl, DUP_ID, "evo-m01-archive-reserved");
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Workbook name already exists");

    const after = await getWorkbook(app.baseUrl, DUP_ID);
    assert.equal(after.name, DUP_ID);

    const restarted = await app.restart();
    try {
      assert.equal((await getWorkbook(restarted.baseUrl, DUP_ID)).name, DUP_ID);
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("rejects a workbook name longer than 80 characters and keeps the last successful name", async () => {
  const app = await startApp();
  try {
    assert.equal(TOO_LONG_NAME.length, 81);
    const rejected = await rename(app.baseUrl, LIMIT_ID, TOO_LONG_NAME);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Workbook name must be 80 characters or fewer");

    const after = await getWorkbook(app.baseUrl, LIMIT_ID);
    assert.equal(after.name, LIMIT_ID);
    assert.equal(after.worksheets[0].cells.C2, "limit sentinel");
  } finally {
    await app.stop();
  }
});

test("accepts a name of exactly 80 characters and rejects a renamed-in duplicate", async () => {
  const app = await startApp();
  try {
    assert.equal(MAX_LENGTH_NAME.length, 80);
    const accepted = await rename(app.baseUrl, OK_ID, MAX_LENGTH_NAME);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.workbook.name, MAX_LENGTH_NAME);

    // The freshly renamed name is now a case-insensitive duplicate for LIMIT.
    const rejected = await rename(app.baseUrl, LIMIT_ID, MAX_LENGTH_NAME.toLowerCase());
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Workbook name already exists");
    assert.equal((await getWorkbook(app.baseUrl, LIMIT_ID)).name, LIMIT_ID);
  } finally {
    await app.stop();
  }
});

test("upgrades an existing data directory by adding the missing EVO workbooks without dropping records", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-upgrade-"));
  await mkdir(dataDir, { recursive: true });
  const q3 = createSeedState().workbooks.find((workbook) => workbook.id === SEED_WORKBOOK_ID);
  const userWorkbook = {
    id: "user-wb-1",
    name: "My Ledger",
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    activeWorksheetId: "user-ws-1",
    worksheets: [
      { id: "user-ws-1", name: "Sheet1", selection: { anchor: "A1", focus: "A1" }, cells: { A1: "keep" } },
    ],
  };
  await writeFile(
    join(dataDir, "workbooks.json"),
    JSON.stringify({ workbooks: [q3, userWorkbook] }, null, 2),
    "utf8",
  );

  const app = await startApp({ dataDir });
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    const ids = list.body.workbooks.map((workbook) => workbook.id);
    for (const id of [SEED_WORKBOOK_ID, "user-wb-1", OK_ID, DUP_ID, ARCHIVE_ID, LIMIT_ID]) {
      assert.ok(ids.includes(id), `${id} present after upgrade`);
    }
    const user = await getWorkbook(app.baseUrl, "user-wb-1");
    assert.equal(user.name, "My Ledger");
    assert.equal(user.worksheets[0].cells.A1, "keep");

    const restarted = await app.restart();
    try {
      const after = await json(restarted.baseUrl, "/api/workbooks");
      const count = (id) => after.body.workbooks.filter((workbook) => workbook.id === id).length;
      for (const id of [SEED_WORKBOOK_ID, "user-wb-1", OK_ID, DUP_ID, ARCHIVE_ID, LIMIT_ID]) {
        assert.equal(count(id), 1, `${id} appears exactly once`);
      }
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});
