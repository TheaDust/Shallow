import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
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

/** Pre-provisioned workbook ids of the worksheet-rename scenarios (REQ-2-1-3). */
const SHEET_OK = { workbook: "wb-evo-m02-sheet-ok", worksheet: "ws-evo-m02-sheet-ok-harbor-draft" };
const SHEET_DUP = {
  workbook: "wb-evo-m02-sheet-dup",
  meridian: "ws-evo-m02-sheet-dup-meridian",
  archiveBay: "ws-evo-m02-sheet-dup-archive-bay",
};
const SHEET_LIMIT = { workbook: "wb-evo-m02-sheet-limit", worksheet: "ws-evo-m02-sheet-limit-length-gauge" };

/** Name of the too-long scenario: one character past the accepted maximum. */
const OVER_LIMIT_NAME = "B".repeat(51);
const MAX_LENGTH_NAME = "B".repeat(50);

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-ws-"));
  const server = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir,
    baseUrl,
    async stop() {
      await new Promise((done) => server.close(done));
    },
    restart() {
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
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

test("pre-provisions the worksheet-rename workbooks of the evolution scenarios", async () => {
  const app = await startApp();
  try {
    const ok = await json(app.baseUrl, `/api/workbooks/${SHEET_OK.workbook}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.workbook.name, "EVO-M02-SHEET-OK");
    assert.deepEqual(
      ok.body.workbook.worksheets.map((worksheet) => worksheet.name),
      ["HarborDraft", "LedgerView"],
    );
    assert.equal(ok.body.workbook.activeWorksheetId, SHEET_OK.worksheet);
    assert.equal(ok.body.workbook.worksheets[0].cells.D5, "dock marker");

    const dup = await json(app.baseUrl, `/api/workbooks/${SHEET_DUP.workbook}`);
    assert.deepEqual(
      dup.body.workbook.worksheets.map((worksheet) => worksheet.name),
      ["Meridian", "ArchiveBay"],
    );
    assert.equal(dup.body.workbook.activeWorksheetId, SHEET_DUP.archiveBay);

    const limit = await json(app.baseUrl, `/api/workbooks/${SHEET_LIMIT.workbook}`);
    assert.equal(limit.body.workbook.worksheets[0].name, "LengthGauge");
    assert.equal(limit.body.workbook.activeWorksheetId, SHEET_LIMIT.worksheet);
    assert.equal(limit.body.workbook.worksheets[0].cells.G4, "sheet sentinel");

    // The baseline seed is untouched by the added pre-provisioned workbooks.
    const baseline = await json(app.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
    assert.deepEqual(
      baseline.body.workbook.worksheets.map((worksheet) => worksheet.name),
      ["Sheet1", "Sheet2"],
    );
  } finally {
    await app.stop();
  }
});

test("renames one worksheet of a pre-provisioned workbook and keeps the other tab and cells", async () => {
  const app = await startApp();
  try {
    const renamed = await json(
      app.baseUrl,
      `/api/workbooks/${SHEET_OK.workbook}/worksheets/${SHEET_OK.worksheet}`,
      send("PATCH", { name: "  Dispatch Register  " }),
    );
    assert.equal(renamed.status, 200);
    const workbook = renamed.body.workbook;
    assert.deepEqual(
      workbook.worksheets.map((worksheet) => worksheet.name),
      ["Dispatch Register", "LedgerView"],
    );
    assert.equal(workbook.activeWorksheetId, SHEET_OK.worksheet);
    assert.equal(workbook.worksheets[0].cells.D5, "dock marker");

    const restarted = await app.restart();
    try {
      const persisted = await json(restarted.baseUrl, `/api/workbooks/${SHEET_OK.workbook}`);
      assert.deepEqual(
        persisted.body.workbook.worksheets.map((worksheet) => worksheet.name),
        ["Dispatch Register", "LedgerView"],
      );
      assert.equal(persisted.body.workbook.activeWorksheetId, SHEET_OK.worksheet);
      assert.equal(persisted.body.workbook.worksheets[0].cells.D5, "dock marker");
    } finally {
      await new Promise((done) => restarted.server.close(done));
    }
  } finally {
    await app.stop();
  }
});

test("rejects a worksheet name differing only by case and keeps both tabs", async () => {
  const app = await startApp();
  try {
    const rejected = await json(
      app.baseUrl,
      `/api/workbooks/${SHEET_DUP.workbook}/worksheets/${SHEET_DUP.archiveBay}`,
      send("PATCH", { name: "meridian" }),
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, DUPLICATE_WORKSHEET_NAME_MESSAGE);

    // The other direction is rejected as well: `Meridian` against `ArchiveBay`.
    const other = await json(
      app.baseUrl,
      `/api/workbooks/${SHEET_DUP.workbook}/worksheets/${SHEET_DUP.meridian}`,
      send("PATCH", { name: "ARCHIVEBAY" }),
    );
    assert.equal(other.status, 400);
    assert.equal(other.body.error, DUPLICATE_WORKSHEET_NAME_MESSAGE);

    // A case change of the worksheet's own name stays available.
    const ownCase = await json(
      app.baseUrl,
      `/api/workbooks/${SHEET_DUP.workbook}/worksheets/${SHEET_DUP.meridian}`,
      send("PATCH", { name: "MERIDIAN" }),
    );
    assert.equal(ownCase.status, 200);
    assert.deepEqual(
      ownCase.body.workbook.worksheets.map((worksheet) => worksheet.name),
      ["MERIDIAN", "ArchiveBay"],
    );

    const restarted = await app.restart();
    try {
      const persisted = await json(restarted.baseUrl, `/api/workbooks/${SHEET_DUP.workbook}`);
      assert.deepEqual(
        persisted.body.workbook.worksheets.map((worksheet) => worksheet.name),
        ["MERIDIAN", "ArchiveBay"],
      );
      assert.equal(persisted.body.workbook.activeWorksheetId, SHEET_DUP.archiveBay);
    } finally {
      await new Promise((done) => restarted.server.close(done));
    }
  } finally {
    await app.stop();
  }
});

test("rejects a worksheet name longer than 50 characters and accepts exactly 50", async () => {
  const app = await startApp();
  try {
    const rejected = await json(
      app.baseUrl,
      `/api/workbooks/${SHEET_LIMIT.workbook}/worksheets/${SHEET_LIMIT.worksheet}`,
      send("PATCH", { name: OVER_LIMIT_NAME }),
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, LONG_WORKSHEET_NAME_MESSAGE);

    const afterReject = await json(app.baseUrl, `/api/workbooks/${SHEET_LIMIT.workbook}`);
    assert.equal(afterReject.body.workbook.worksheets[0].name, "LengthGauge");
    assert.equal(afterReject.body.workbook.worksheets[0].cells.G4, "sheet sentinel");

    // The limit is measured after trimming, so spaces around 50 characters pass.
    const accepted = await json(
      app.baseUrl,
      `/api/workbooks/${SHEET_LIMIT.workbook}/worksheets/${SHEET_LIMIT.worksheet}`,
      send("PATCH", { name: `  ${MAX_LENGTH_NAME}  ` }),
    );
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.workbook.worksheets[0].name, MAX_LENGTH_NAME);

    const restarted = await app.restart();
    try {
      const persisted = await json(restarted.baseUrl, `/api/workbooks/${SHEET_LIMIT.workbook}`);
      assert.equal(persisted.body.workbook.worksheets[0].name, MAX_LENGTH_NAME);
      assert.equal(persisted.body.workbook.worksheets[0].cells.G4, "sheet sentinel");
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
