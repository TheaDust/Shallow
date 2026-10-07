import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { EVOLUTION_WORKBOOK_SEEDS } from "../src/store/evolution-seed.mjs";

/** Workbook name from the requirement: 81 characters, one more than the limit. */
const TOO_LONG_NAME = "EVO-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function startApp({ dataDir }) {
  const staticRoot = dataDir;
  const server = createServer(createRequestHandler({ dataDir, staticRoot }));
  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      done({
        dataDir,
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        stop: () => new Promise((closed) => server.close(closed)),
      });
    });
  });
}

async function freshApp() {
  return startApp({ dataDir: await mkdtemp(join(tmpdir(), "shallowcode-evo-rename-")) });
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

function workbookOf(baseUrl, id) {
  return json(baseUrl, `/api/workbooks/${encodeURIComponent(id)}`);
}

test("pre-provisions the evolution workbooks with their worksheet and cells", async () => {
  const app = await freshApp();
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    assert.equal(list.status, 200);
    assert.equal(list.body.workbooks.length, EVOLUTION_WORKBOOK_SEEDS.length + 1);
    assert.ok(list.body.workbooks.some((entry) => entry.name === "Q3 Sales"));
    for (const seed of EVOLUTION_WORKBOOK_SEEDS) {
      const summary = list.body.workbooks.find((entry) => entry.id === seed.id);
      assert.ok(summary, `missing pre-provisioned workbook ${seed.id}`);
      assert.equal(summary.name, seed.name);
    }

    const ok = await workbookOf(app.baseUrl, "EVO-M01-RENAME-OK");
    assert.equal(ok.status, 200);
    const okWorksheet = ok.body.workbook.worksheets.find((sheet) => sheet.id === ok.body.workbook.activeWorksheetId);
    assert.equal(okWorksheet.name, "IdentityLog");
    assert.equal(okWorksheet.cells.F3, "unreviewed");

    const dup = await workbookOf(app.baseUrl, "EVO-M01-RENAME-DUP");
    assert.equal(dup.body.workbook.worksheets[0].name, "IdentityLog");

    const reserved = await workbookOf(app.baseUrl, "EVO-M01-ARCHIVE-RESERVED");
    assert.equal(reserved.status, 200);
    assert.equal(reserved.body.workbook.name, "EVO-M01-ARCHIVE-RESERVED");

    const limit = await workbookOf(app.baseUrl, "EVO-M01-RENAME-LIMIT");
    assert.equal(limit.body.workbook.worksheets[0].name, "LimitProbe");
    assert.equal(limit.body.workbook.worksheets[0].cells.C2, "limit sentinel");
  } finally {
    await app.stop();
  }
});

test("upgrades an inherited store without losing records and adds each seed once", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-evo-upgrade-"));
  // An older store: the baseline workbook (renamed by the user, with an edited
  // cell) plus a user-created workbook; no evolution workbook at all.
  const legacy = {
    workbooks: [
      {
        id: "wb-q3-sales",
        name: "Q3 Sales 2026",
        createdAt: "2026-09-21T09:00:00.000Z",
        updatedAt: "2026-09-28T14:05:00.000Z",
        activeWorksheetId: "ws-q3-sheet1",
        worksheets: [
          {
            id: "ws-q3-sheet1",
            name: "Sheet1",
            selection: { anchor: "A1", focus: "A1" },
            cells: { A1: "Region", B1: "User note" },
          },
        ],
      },
      {
        id: "wb-user-1",
        name: "My budget",
        createdAt: "2026-09-30T09:00:00.000Z",
        updatedAt: "2026-09-30T09:00:00.000Z",
        activeWorksheetId: "ws-user-1",
        worksheets: [{ id: "ws-user-1", name: "Sheet1", selection: { anchor: "A1", focus: "A1" }, cells: { A1: "7" } }],
      },
    ],
  };
  await writeFile(join(dataDir, "workbooks.json"), `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

  const app = await startApp({ dataDir });
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    assert.equal(list.body.workbooks.length, EVOLUTION_WORKBOOK_SEEDS.length + 2);

    const baseline = await workbookOf(app.baseUrl, "wb-q3-sales");
    assert.equal(baseline.body.workbook.name, "Q3 Sales 2026");
    assert.equal(baseline.body.workbook.worksheets[0].cells.B1, "User note");

    const user = await workbookOf(app.baseUrl, "wb-user-1");
    assert.equal(user.body.workbook.name, "My budget");
    assert.equal(user.body.workbook.worksheets[0].cells.A1, "7");

    const seeded = await workbookOf(app.baseUrl, "EVO-M01-RENAME-OK");
    assert.equal(seeded.body.workbook.worksheets[0].cells.F3, "unreviewed");
  } finally {
    await app.stop();
  }

  // A second start of the same directory must not duplicate anything.
  const restarted = await startApp({ dataDir });
  try {
    const list = await json(restarted.baseUrl, "/api/workbooks");
    assert.equal(list.body.workbooks.length, EVOLUTION_WORKBOOK_SEEDS.length + 2);
    const ids = list.body.workbooks.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length);
    const stored = JSON.parse(await readFile(join(dataDir, "workbooks.json"), "utf8"));
    assert.equal(stored.workbooks.length, EVOLUTION_WORKBOOK_SEEDS.length + 2);
    const baseline = await workbookOf(restarted.baseUrl, "wb-q3-sales");
    assert.equal(baseline.body.workbook.name, "Q3 Sales 2026");
  } finally {
    await restarted.stop();
  }
});

test("trims a new workbook name, persists it and keeps the worksheet cells", async () => {
  const app = await freshApp();
  try {
    const renamed = await rename(app.baseUrl, "EVO-M01-RENAME-OK", "  FY26 Procurement Ledger  ");
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.workbook.name, "FY26 Procurement Ledger");
    assert.equal(renamed.body.workbook.worksheets[0].cells.F3, "unreviewed");

    const list = await json(app.baseUrl, "/api/workbooks");
    assert.ok(list.body.workbooks.some((entry) => entry.name === "FY26 Procurement Ledger"));
    assert.ok(!list.body.workbooks.some((entry) => entry.name === "EVO-M01-RENAME-OK"));
  } finally {
    await app.stop();
  }

  const restarted = await startApp({ dataDir: app.dataDir });
  try {
    const reopened = await workbookOf(restarted.baseUrl, "EVO-M01-RENAME-OK");
    assert.equal(reopened.body.workbook.name, "FY26 Procurement Ledger");
    assert.equal(reopened.body.workbook.worksheets[0].cells.F3, "unreviewed");
  } finally {
    await restarted.stop();
  }
});

test("rejects a case-insensitive duplicate name and keeps the stored name", async () => {
  const app = await freshApp();
  try {
    const rejected = await rename(app.baseUrl, "EVO-M01-RENAME-DUP", "evo-m01-archive-reserved");
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Workbook name already exists");

    const after = await workbookOf(app.baseUrl, "EVO-M01-RENAME-DUP");
    assert.equal(after.body.workbook.name, "EVO-M01-RENAME-DUP");
    const reserved = await workbookOf(app.baseUrl, "EVO-M01-ARCHIVE-RESERVED");
    assert.equal(reserved.body.workbook.name, "EVO-M01-ARCHIVE-RESERVED");

    // Only another workbook blocks a name: re-saving the same name is allowed.
    const same = await rename(app.baseUrl, "EVO-M01-RENAME-DUP", " EVO-M01-RENAME-DUP ");
    assert.equal(same.status, 200);
    assert.equal(same.body.workbook.name, "EVO-M01-RENAME-DUP");
  } finally {
    await app.stop();
  }
});

test("rejects a name longer than 80 characters and accepts exactly 80", async () => {
  const app = await freshApp();
  try {
    assert.equal(TOO_LONG_NAME.length, 81);
    const rejected = await rename(app.baseUrl, "EVO-M01-RENAME-LIMIT", TOO_LONG_NAME);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Workbook name must be 80 characters or fewer");

    const after = await workbookOf(app.baseUrl, "EVO-M01-RENAME-LIMIT");
    assert.equal(after.body.workbook.name, "EVO-M01-RENAME-LIMIT");
    assert.equal(after.body.workbook.worksheets[0].cells.C2, "limit sentinel");

    const boundary = "Limit".padEnd(80, "x");
    assert.equal(boundary.length, 80);
    const accepted = await rename(app.baseUrl, "EVO-M01-RENAME-LIMIT", boundary);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.workbook.name, boundary);
  } finally {
    await app.stop();
  }
});

test("rejects an empty workbook name and keeps the last successful one", async () => {
  const app = await freshApp();
  try {
    await rename(app.baseUrl, "EVO-M01-RENAME-OK", "FY26 Procurement Ledger");
    const rejected = await rename(app.baseUrl, "EVO-M01-RENAME-OK", "   ");
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Workbook name cannot be empty");
    const after = await workbookOf(app.baseUrl, "EVO-M01-RENAME-OK");
    assert.equal(after.body.workbook.name, "FY26 Procurement Ledger");
  } finally {
    await app.stop();
  }
});
