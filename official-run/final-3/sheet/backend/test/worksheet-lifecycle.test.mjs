import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  DUPLICATE_WORKSHEET_NAME_MESSAGE,
  EMPTY_WORKSHEET_NAME_MESSAGE,
  LAST_WORKSHEET_MESSAGE,
  LONG_WORKSHEET_NAME_MESSAGE,
  PIVOT_SOURCE_DEPENDENCY_MESSAGE,
  SEED_SECOND_WORKSHEET_ID,
  SEED_WORKBOOK_ID,
  SEED_WORKSHEET_ID,
} from "../src/store/workbooks.mjs";

async function startApp(dataDir) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-ws-")));
  const server = createServer(createRequestHandler({ dataDir: dir, staticRoot: dir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir: dir,
    baseUrl,
    async stop() {
      await new Promise((done) => server.close(done));
    },
    restart() {
      const restarted = createServer(createRequestHandler({ dataDir: dir, staticRoot: dir }));
      return new Promise((done) =>
        restarted.listen(0, "127.0.0.1", () => {
          done({ server: restarted, baseUrl: `http://127.0.0.1:${restarted.address().port}` });
        }),
      );
    },
  };
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function send(method, body) {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) };
}

test("seeds Q3 Sales with two worksheets Sheet1 and Sheet2", async () => {
  const app = await startApp();
  try {
    const detail = await json(app.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
    assert.equal(detail.status, 200);
    const { workbook } = detail.body;
    assert.deepEqual(
      workbook.worksheets.map((worksheet) => worksheet.name),
      ["Sheet1", "Sheet2"],
    );
    assert.equal(workbook.worksheets[0].id, SEED_WORKSHEET_ID);
    assert.equal(workbook.worksheets[1].id, SEED_SECOND_WORKSHEET_ID);
    assert.equal(workbook.worksheets[0].cells.A2, "East");
    assert.equal(workbook.worksheets[0].cells.B3, "800");
    assert.deepEqual(workbook.worksheets[1].cells, {});
    assert.equal(workbook.activeWorksheetId, SEED_WORKSHEET_ID);
  } finally {
    await app.stop();
  }
});

test("adds a blank worksheet with the first unused SheetN name and persists it", async () => {
  const app = await startApp();
  try {
    const seeded = await json(app.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
    assert.deepEqual(
      seeded.body.workbook.worksheets.map((worksheet) => worksheet.name),
      ["Sheet1", "Sheet2"],
    );

    const added = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets`,
      send("POST"),
    );
    assert.equal(added.status, 201);
    const workbook = added.body.workbook;
    assert.deepEqual(
      workbook.worksheets.map((worksheet) => worksheet.name),
      ["Sheet1", "Sheet2", "Sheet3"],
    );
    const created = workbook.worksheets[2];
    assert.deepEqual(created.cells, {});
    assert.equal(workbook.activeWorksheetId, created.id);
    // Existing worksheets keep their data.
    assert.equal(workbook.worksheets[0].cells.A2, "East");
    assert.equal(workbook.worksheets[1].name, "Sheet2");

    const restarted = await app.restart();
    try {
      const persisted = await json(restarted.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
      assert.deepEqual(
        persisted.body.workbook.worksheets.map((worksheet) => worksheet.name),
        ["Sheet1", "Sheet2", "Sheet3"],
      );
      assert.equal(persisted.body.workbook.activeWorksheetId, created.id);
    } finally {
      await new Promise((done) => restarted.server.close(done));
    }
  } finally {
    await app.stop();
  }
});

test("reuses the first free SheetN gap when naming a new worksheet", async () => {
  const app = await startApp();
  try {
    const workbookId = (
      await json(app.baseUrl, "/api/workbooks", send("POST", { name: "Gaps" }))
    ).body.workbook.id;

    await json(app.baseUrl, `/api/workbooks/${workbookId}/worksheets`, send("POST"));
    const current = await json(app.baseUrl, `/api/workbooks/${workbookId}`);
    const secondId = current.body.workbook.worksheets[1].id;
    const renamed = await json(
      app.baseUrl,
      `/api/workbooks/${workbookId}/worksheets/${secondId}`,
      send("PATCH", { name: "Sheet9" }),
    );
    assert.equal(renamed.status, 200);

    const added = await json(app.baseUrl, `/api/workbooks/${workbookId}/worksheets`, send("POST"));
    assert.equal(added.status, 201);
    assert.deepEqual(
      added.body.workbook.worksheets.map((worksheet) => worksheet.name),
      ["Sheet1", "Sheet9", "Sheet2"],
    );
  } finally {
    await app.stop();
  }
});

test("renames a worksheet, trims spaces and persists the new name", async () => {
  const app = await startApp();
  try {
    const renamed = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_SECOND_WORKSHEET_ID}`,
      send("PATCH", { name: "  Revenue  " }),
    );
    assert.equal(renamed.status, 200);
    assert.deepEqual(
      renamed.body.workbook.worksheets.map((worksheet) => worksheet.name),
      ["Sheet1", "Revenue"],
    );
    // The other worksheet keeps its data.
    assert.equal(renamed.body.workbook.worksheets[0].cells.A2, "East");

    const restarted = await app.restart();
    try {
      const persisted = await json(restarted.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
      assert.deepEqual(
        persisted.body.workbook.worksheets.map((worksheet) => worksheet.name),
        ["Sheet1", "Revenue"],
      );
    } finally {
      await new Promise((done) => restarted.server.close(done));
    }
  } finally {
    await app.stop();
  }
});

test("rejects an empty worksheet name and keeps the original name", async () => {
  const app = await startApp();
  try {
    const rejected = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}`,
      send("PATCH", { name: "   " }),
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, EMPTY_WORKSHEET_NAME_MESSAGE);

    const after = await json(app.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
    assert.equal(after.body.workbook.worksheets[0].name, "Sheet1");
  } finally {
    await app.stop();
  }
});

test("rejects a duplicate worksheet name and keeps every worksheet unchanged", async () => {
  const app = await startApp();
  try {
    const rejected = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}`,
      send("PATCH", { name: "Sheet2" }),
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, DUPLICATE_WORKSHEET_NAME_MESSAGE);

    const after = await json(app.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
    assert.deepEqual(
      after.body.workbook.worksheets.map((worksheet) => worksheet.name),
      ["Sheet1", "Sheet2"],
    );
  } finally {
    await app.stop();
  }
});

test("allows keeping the same worksheet name and reports unknown targets", async () => {
  const app = await startApp();
  try {
    const same = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}`,
      send("PATCH", { name: "Sheet1" }),
    );
    assert.equal(same.status, 200);
    assert.equal(same.body.workbook.worksheets[0].name, "Sheet1");

    const unknownWorksheet = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/missing`,
      send("PATCH", { name: "Whatever" }),
    );
    assert.equal(unknownWorksheet.status, 400);

    const unknownWorkbook = await json(
      app.baseUrl,
      `/api/workbooks/missing/worksheets`,
      send("POST"),
    );
    assert.equal(unknownWorkbook.status, 404);

    const unknownWorkbookRename = await json(
      app.baseUrl,
      `/api/workbooks/missing/worksheets/${SEED_WORKSHEET_ID}`,
      send("PATCH", { name: "Whatever" }),
    );
    assert.equal(unknownWorkbookRename.status, 404);
  } finally {
    await app.stop();
  }
});

test("deletes a worksheet, activates an adjacent tab and persists the deletion", async () => {
  const app = await startApp();
  try {
    const removed = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}`,
      { method: "DELETE" },
    );
    assert.equal(removed.status, 200);
    const workbook = removed.body.workbook;
    // The removed tab and its data are gone; the remaining worksheet becomes active.
    assert.deepEqual(
      workbook.worksheets.map((worksheet) => worksheet.name),
      ["Sheet2"],
    );
    assert.equal(workbook.activeWorksheetId, SEED_SECOND_WORKSHEET_ID);

    const restarted = await app.restart();
    try {
      const persisted = await json(restarted.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
      assert.deepEqual(
        persisted.body.workbook.worksheets.map((worksheet) => worksheet.name),
        ["Sheet2"],
      );
      assert.equal(persisted.body.workbook.activeWorksheetId, SEED_SECOND_WORKSHEET_ID);
    } finally {
      await new Promise((done) => restarted.server.close(done));
    }
  } finally {
    await app.stop();
  }
});

test("deleting one of three worksheets keeps the remaining data and picks an adjacent tab", async () => {
  const app = await startApp();
  try {
    const added = await json(app.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets`, send("POST"));
    const thirdId = added.body.workbook.worksheets[2].id;

    // Delete the middle worksheet; the previously active third one stays active.
    const removed = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_SECOND_WORKSHEET_ID}`,
      { method: "DELETE" },
    );
    assert.equal(removed.status, 200);
    assert.deepEqual(
      removed.body.workbook.worksheets.map((worksheet) => worksheet.name),
      ["Sheet1", "Sheet3"],
    );
    assert.equal(removed.body.workbook.activeWorksheetId, thirdId);
    // The remaining seeded worksheet keeps its own cells.
    assert.equal(
      removed.body.workbook.worksheets.find((worksheet) => worksheet.id === SEED_WORKSHEET_ID).cells.A2,
      "East",
    );
  } finally {
    await app.stop();
  }
});

test("refuses to delete the last worksheet and keeps it", async () => {
  const app = await startApp();
  try {
    const first = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_SECOND_WORKSHEET_ID}`,
      { method: "DELETE" },
    );
    assert.equal(first.status, 200);

    const rejected = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}`,
      { method: "DELETE" },
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, LAST_WORKSHEET_MESSAGE);

    const after = await json(app.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
    assert.deepEqual(
      after.body.workbook.worksheets.map((worksheet) => worksheet.name),
      ["Sheet1"],
    );
    assert.equal(after.body.workbook.worksheets[0].cells.A2, "East");
  } finally {
    await app.stop();
  }
});

test("rejects deleting a pivot source worksheet until its pivot result is removed", async () => {
  const app = await startApp();
  try {
    const created = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}/pivot`,
      send("POST", { range: "A1:B4" }),
    );
    assert.equal(created.status, 201);
    const pivot = created.body.workbook.worksheets.find((worksheet) => worksheet.name === "Pivot1");
    assert.ok(pivot);

    // The source is still read by the pivot: the deletion is rejected and both stay intact.
    const rejected = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}`,
      { method: "DELETE" },
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, PIVOT_SOURCE_DEPENDENCY_MESSAGE);

    const afterReject = await json(app.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
    assert.equal(
      afterReject.body.workbook.worksheets.find((worksheet) => worksheet.id === SEED_WORKSHEET_ID).cells.A2,
      "East",
    );
    assert.equal(
      afterReject.body.workbook.worksheets.find((worksheet) => worksheet.name === "Pivot1").cells.B5,
      "2700",
    );

    // Deleting the pivot result worksheet lifts the constraint on its source.
    const removedPivot = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${pivot.id}`,
      { method: "DELETE" },
    );
    assert.equal(removedPivot.status, 200);
    assert.equal(removedPivot.body.workbook.worksheets.some((worksheet) => worksheet.name === "Pivot1"), false);

    const removedSource = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}`,
      { method: "DELETE" },
    );
    assert.equal(removedSource.status, 200);
    assert.deepEqual(
      removedSource.body.workbook.worksheets.map((worksheet) => worksheet.name),
      ["Sheet2"],
    );
  } finally {
    await app.stop();
  }
});

test("reports an unknown worksheet on delete", async () => {
  const app = await startApp();
  try {
    const rejected = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/missing`,
      { method: "DELETE" },
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Unknown worksheet");
  } finally {
    await app.stop();
  }
});

/** Pre-provisioned workbook of REQ-2-1-3 with its worksheet ids and cells. */
const SHEET_RENAME_WORKBOOKS = {
  "EVO-M02-SHEET-OK": [
    { id: "ws-evo-m02-sheet-ok-harbordraft", name: "HarborDraft", cells: { D5: "dock marker" } },
    { id: "ws-evo-m02-sheet-ok-ledgerview", name: "LedgerView", cells: {} },
  ],
  "EVO-M02-SHEET-DUP": [
    { id: "ws-evo-m02-sheet-dup-meridian", name: "Meridian", cells: {} },
    { id: "ws-evo-m02-sheet-dup-archivebay", name: "ArchiveBay", cells: {} },
  ],
  "EVO-M02-SHEET-LIMIT": [
    { id: "ws-evo-m02-sheet-limit-lengthgauge", name: "LengthGauge", cells: { G4: "sheet sentinel" } },
  ],
};

/** Requirement value: 51 characters, one more than the worksheet name limit. */
const TOO_LONG_WORKSHEET_NAME =
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function workbookOf(baseUrl, id) {
  return json(baseUrl, `/api/workbooks/${encodeURIComponent(id)}`);
}

function renameSheet(baseUrl, workbookId, worksheetId, name) {
  return json(
    baseUrl,
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}`,
    send("PATCH", { name }),
  );
}

function worksheetNames(workbook) {
  return workbook.worksheets.map((worksheet) => worksheet.name);
}

test("pre-provisions the REQ-2-1-3 workbooks with their worksheets and cells", async () => {
  const app = await startApp();
  try {
    for (const [workbookId, expected] of Object.entries(SHEET_RENAME_WORKBOOKS)) {
      const detail = await workbookOf(app.baseUrl, workbookId);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.workbook.name, workbookId);
      assert.deepEqual(worksheetNames(detail.body.workbook), expected.map((sheet) => sheet.name));
      for (const sheet of expected) {
        const stored = detail.body.workbook.worksheets.find((candidate) => candidate.id === sheet.id);
        assert.ok(stored, `missing worksheet ${sheet.id} in ${workbookId}`);
        assert.deepEqual(stored.cells, sheet.cells);
      }
    }

    const ok = await workbookOf(app.baseUrl, "EVO-M02-SHEET-OK");
    assert.equal(ok.body.workbook.activeWorksheetId, "ws-evo-m02-sheet-ok-harbordraft");
    const dup = await workbookOf(app.baseUrl, "EVO-M02-SHEET-DUP");
    assert.equal(dup.body.workbook.activeWorksheetId, "ws-evo-m02-sheet-dup-archivebay");
    const limit = await workbookOf(app.baseUrl, "EVO-M02-SHEET-LIMIT");
    assert.equal(limit.body.workbook.activeWorksheetId, "ws-evo-m02-sheet-limit-lengthgauge");
  } finally {
    await app.stop();
  }
});

test("trims and persists an available worksheet name in the pre-provisioned workbook", async () => {
  const app = await startApp();
  try {
    const renamed = await renameSheet(
      app.baseUrl,
      "EVO-M02-SHEET-OK",
      "ws-evo-m02-sheet-ok-harbordraft",
      "  Dispatch Register  ",
    );
    assert.equal(renamed.status, 200);
    assert.deepEqual(worksheetNames(renamed.body.workbook), ["Dispatch Register", "LedgerView"]);
    assert.equal(renamed.body.workbook.activeWorksheetId, "ws-evo-m02-sheet-ok-harbordraft");
    assert.equal(renamed.body.workbook.worksheets[0].cells.D5, "dock marker");
  } finally {
    await app.stop();
  }

  const restarted = await app.restart();
  try {
    const persisted = await workbookOf(restarted.baseUrl, "EVO-M02-SHEET-OK");
    assert.deepEqual(worksheetNames(persisted.body.workbook), ["Dispatch Register", "LedgerView"]);
    assert.equal(persisted.body.workbook.activeWorksheetId, "ws-evo-m02-sheet-ok-harbordraft");
    assert.equal(persisted.body.workbook.worksheets[0].cells.D5, "dock marker");
  } finally {
    await new Promise((done) => restarted.server.close(done));
  }
});

test("rejects a worksheet name differing only by case and keeps the active tab", async () => {
  const app = await startApp();
  try {
    const rejected = await renameSheet(
      app.baseUrl,
      "EVO-M02-SHEET-DUP",
      "ws-evo-m02-sheet-dup-archivebay",
      "meridian",
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, DUPLICATE_WORKSHEET_NAME_MESSAGE);

    const after = await workbookOf(app.baseUrl, "EVO-M02-SHEET-DUP");
    assert.deepEqual(worksheetNames(after.body.workbook), ["Meridian", "ArchiveBay"]);
    assert.equal(after.body.workbook.activeWorksheetId, "ws-evo-m02-sheet-dup-archivebay");

    // Re-saving the own name (any letter case) is allowed, and uniqueness stays
    // scoped to the workbook: `Meridian` belongs to another workbook.
    const same = await renameSheet(
      app.baseUrl,
      "EVO-M02-SHEET-DUP",
      "ws-evo-m02-sheet-dup-archivebay",
      "ARCHIVEBAY",
    );
    assert.equal(same.status, 200);
    assert.deepEqual(worksheetNames(same.body.workbook), ["Meridian", "ARCHIVEBAY"]);

    const crossWorkbook = await renameSheet(
      app.baseUrl,
      "EVO-M02-SHEET-OK",
      "ws-evo-m02-sheet-ok-harbordraft",
      "Meridian",
    );
    assert.equal(crossWorkbook.status, 200);
    assert.deepEqual(worksheetNames(crossWorkbook.body.workbook), ["Meridian", "LedgerView"]);
  } finally {
    await app.stop();
  }
});

test("rejects a worksheet name longer than 50 characters and accepts exactly 50", async () => {
  const app = await startApp();
  try {
    assert.equal(TOO_LONG_WORKSHEET_NAME.length, 51);
    const rejected = await renameSheet(
      app.baseUrl,
      "EVO-M02-SHEET-LIMIT",
      "ws-evo-m02-sheet-limit-lengthgauge",
      TOO_LONG_WORKSHEET_NAME,
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, LONG_WORKSHEET_NAME_MESSAGE);

    const after = await workbookOf(app.baseUrl, "EVO-M02-SHEET-LIMIT");
    assert.deepEqual(worksheetNames(after.body.workbook), ["LengthGauge"]);
    assert.equal(after.body.workbook.activeWorksheetId, "ws-evo-m02-sheet-limit-lengthgauge");
    assert.equal(after.body.workbook.worksheets[0].cells.G4, "sheet sentinel");

    // The limit counts the trimmed name, so 50 characters with padding fits.
    const boundary = "L".repeat(50);
    assert.equal(boundary.length, 50);
    const accepted = await renameSheet(
      app.baseUrl,
      "EVO-M02-SHEET-LIMIT",
      "ws-evo-m02-sheet-limit-lengthgauge",
      ` ${boundary} `,
    );
    assert.equal(accepted.status, 200);
    assert.deepEqual(worksheetNames(accepted.body.workbook), [boundary]);

    const overBoundary = await renameSheet(
      app.baseUrl,
      "EVO-M02-SHEET-LIMIT",
      "ws-evo-m02-sheet-limit-lengthgauge",
      `${boundary}Z`,
    );
    assert.equal(overBoundary.status, 400);
    assert.equal(overBoundary.body.error, LONG_WORKSHEET_NAME_MESSAGE);
  } finally {
    await app.stop();
  }
});

test("upgrades an inherited store with the REQ-2-1-3 workbooks once and keeps old records", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-ws-upgrade-"));
  // An older store: the baseline workbook (renamed, with an edited cell), one
  // user-created workbook and no REQ-2-1-3 workbook at all.
  const legacy = {
    workbooks: [
      {
        id: SEED_WORKBOOK_ID,
        name: "Q3 Sales 2026",
        createdAt: "2026-09-21T09:00:00.000Z",
        updatedAt: "2026-09-28T14:05:00.000Z",
        activeWorksheetId: SEED_WORKSHEET_ID,
        worksheets: [
          { id: SEED_WORKSHEET_ID, name: "Sheet1", selection: { anchor: "A1", focus: "A1" }, cells: { A1: "Region" } },
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

  const app = await startApp(dataDir);
  try {
    const baseline = await workbookOf(app.baseUrl, SEED_WORKBOOK_ID);
    assert.equal(baseline.body.workbook.name, "Q3 Sales 2026");
    const user = await workbookOf(app.baseUrl, "wb-user-1");
    assert.equal(user.body.workbook.worksheets[0].cells.A1, "7");

    for (const workbookId of Object.keys(SHEET_RENAME_WORKBOOKS)) {
      const seeded = await workbookOf(app.baseUrl, workbookId);
      assert.equal(seeded.status, 200, `missing upgraded workbook ${workbookId}`);
      assert.deepEqual(
        worksheetNames(seeded.body.workbook),
        SHEET_RENAME_WORKBOOKS[workbookId].map((sheet) => sheet.name),
      );
    }
  } finally {
    await app.stop();
  }

  // A second start of the same directory must not duplicate anything.
  const restarted = await startApp(dataDir);
  try {
    const list = await json(restarted.baseUrl, "/api/workbooks");
    const ids = list.body.workbooks.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes("wb-user-1"));
    const stored = JSON.parse(await readFile(join(dataDir, "workbooks.json"), "utf8"));
    assert.equal(stored.workbooks.filter((entry) => entry.id === "EVO-M02-SHEET-OK").length, 1);
    const baseline = await workbookOf(restarted.baseUrl, SEED_WORKBOOK_ID);
    assert.equal(baseline.body.workbook.name, "Q3 Sales 2026");
  } finally {
    await restarted.stop();
  }
});
