import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

/** Pre-provisioned workbooks of the REQ-1-2-2 scenarios. */
const OK_ID = "wb-evo-m01-rename-ok";
const DUP_ID = "wb-evo-m01-rename-dup";
const ARCHIVE_ID = "wb-evo-m01-archive-reserved";
const LIMIT_ID = "wb-evo-m01-rename-limit";

const LONG_NAME = `EVO-${"A".repeat(77)}`; // 81 characters: one over the limit.

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-data-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-dist-"));
  await mkdir(staticRoot, { recursive: true });
  await writeFile(join(staticRoot, "index.html"), "<!doctype html><div id=\"root\"></div>", "utf8");

  const server = createServer(createRequestHandler({ dataDir, staticRoot }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    async stop() {
      await new Promise((done) => server.close(done));
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

test("pre-provisions one EVO workbook per rename scenario with its active worksheet", async () => {
  const app = await startApp();
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    assert.equal(list.status, 200);
    const names = list.body.workbooks.map((workbook) => workbook.name);
    for (const name of ["EVO-M01-RENAME-OK", "EVO-M01-RENAME-DUP", "EVO-M01-ARCHIVE-RESERVED", "EVO-M01-RENAME-LIMIT"]) {
      assert.ok(names.includes(name), `seeded ${name}`);
    }

    const ok = await json(app.baseUrl, `/api/workbooks/${OK_ID}`);
    assert.equal(ok.body.workbook.name, "EVO-M01-RENAME-OK");
    assert.equal(ok.body.workbook.worksheets.length, 1);
    const identityLog = ok.body.workbook.worksheets[0];
    assert.equal(identityLog.name, "IdentityLog");
    assert.equal(ok.body.workbook.activeWorksheetId, identityLog.id);
    assert.equal(identityLog.cells.F3, "unreviewed");

    const dup = await json(app.baseUrl, `/api/workbooks/${DUP_ID}`);
    assert.equal(dup.body.workbook.worksheets[0].name, "IdentityLog");
    assert.equal(dup.body.workbook.activeWorksheetId, dup.body.workbook.worksheets[0].id);

    const archive = await json(app.baseUrl, `/api/workbooks/${ARCHIVE_ID}`);
    assert.equal(archive.body.workbook.name, "EVO-M01-ARCHIVE-RESERVED");
    assert.notEqual(archive.body.workbook.id, DUP_ID);

    const limit = await json(app.baseUrl, `/api/workbooks/${LIMIT_ID}`);
    assert.equal(limit.body.workbook.worksheets[0].name, "LimitProbe");
    assert.equal(limit.body.workbook.worksheets[0].cells.C2, "limit sentinel");
  } finally {
    await app.stop();
  }
});

test("trims and persists an available name while the other cells stay unchanged", async () => {
  const app = await startApp();
  try {
    const renamed = await rename(app.baseUrl, OK_ID, "  FY26 Procurement Ledger  ");
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.workbook.name, "FY26 Procurement Ledger");
    assert.equal(renamed.body.workbook.id, OK_ID);

    const reopened = await json(app.baseUrl, `/api/workbooks/${OK_ID}`);
    assert.equal(reopened.body.workbook.name, "FY26 Procurement Ledger");
    assert.equal(reopened.body.workbook.worksheets[0].cells.F3, "unreviewed");
    assert.equal(reopened.body.workbook.worksheets[0].name, "IdentityLog");
  } finally {
    await app.stop();
  }
});

test("rejects a case-insensitive duplicate and keeps the last successful name", async () => {
  const app = await startApp();
  try {
    const rejected = await rename(app.baseUrl, DUP_ID, "evo-m01-archive-reserved");
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Workbook name already exists");

    const after = await json(app.baseUrl, `/api/workbooks/${DUP_ID}`);
    assert.equal(after.body.workbook.name, "EVO-M01-RENAME-DUP");
    const archive = await json(app.baseUrl, `/api/workbooks/${ARCHIVE_ID}`);
    assert.equal(archive.body.workbook.name, "EVO-M01-ARCHIVE-RESERVED");
  } finally {
    await app.stop();
  }
});

test("rejects a name longer than 80 characters and keeps the last successful name", async () => {
  const app = await startApp();
  try {
    const rejected = await rename(app.baseUrl, LIMIT_ID, LONG_NAME);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Workbook name must be 80 characters or fewer");

    const after = await json(app.baseUrl, `/api/workbooks/${LIMIT_ID}`);
    assert.equal(after.body.workbook.name, "EVO-M01-RENAME-LIMIT");
    assert.equal(after.body.workbook.worksheets[0].cells.C2, "limit sentinel");
  } finally {
    await app.stop();
  }
});

test("accepts exactly 80 characters and the workbook's own name in another case", async () => {
  const app = await startApp();
  try {
    const boundary = await rename(app.baseUrl, LIMIT_ID, "B".repeat(80));
    assert.equal(boundary.status, 200);
    assert.equal(boundary.body.workbook.name, "B".repeat(80));

    const recased = await rename(app.baseUrl, LIMIT_ID, "b".repeat(80));
    assert.equal(recased.status, 200);
    assert.equal(recased.body.workbook.name, "b".repeat(80));
  } finally {
    await app.stop();
  }
});
