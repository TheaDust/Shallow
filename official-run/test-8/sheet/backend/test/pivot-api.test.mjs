import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { seedState } from "../src/domain/workbook-model.mjs";

const WORKBOOK_ID = "workbook-q3-sales";
const SHEET_1 = "workbook-q3-sales-sheet-1";
const SEED_RANGE = { minRow: 0, maxRow: 3, minCol: 0, maxCol: 2 };

/** Starts the app over a temporary store, optionally pre-seeded. */
async function startApp(prepare) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-pivot-"));
  if (prepare) {
    const state = prepare(seedState());
    await writeFile(join(dataDir, "workbooks.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
  const { handler } = createApp({ dataDir });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    dataDir,
    async call(path, init) {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      return { status: response.status, body };
    },
    async workbook() {
      const detail = await this.call(`/api/workbooks/${WORKBOOK_ID}`);
      return detail.body.workbook;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function pivotsPath() {
  return `/api/workbooks/${WORKBOOK_ID}/pivots`;
}

function structurePath(worksheetId = SHEET_1) {
  return `/api/workbooks/${WORKBOOK_ID}/worksheets/${worksheetId}/structure`;
}

async function createPivot(app) {
  const created = await app.call(pivotsPath(), {
    method: "POST",
    body: JSON.stringify({ action: "create", sourceWorksheetId: SHEET_1, range: SEED_RANGE }),
  });
  assert.equal(created.status, 201);
  return created.body.workbook;
}

test("creates the first unused PivotN worksheet and seeds a default summary", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const workbook = await createPivot(app);
  const names = workbook.worksheets.map((entry) => entry.name);
  assert.deepEqual(names, ["Sheet1", "Sheet2", "Pivot1"]);

  const pivot = workbook.worksheets.find((entry) => entry.name === "Pivot1");
  assert.equal(workbook.activeWorksheetId, pivot.id);
  // Region rows, SUM of Sales, in first-appearance order, with a Grand Total.
  assert.deepEqual(pivot.cells, {
    A1: "Region",
    B1: "SUM of Sales",
    A2: "East",
    B2: "1200",
    A3: "North",
    B3: "800",
    A4: "South",
    B4: "700",
    A5: "Grand Total",
    B5: "2700",
  });
  // The source worksheet is untouched.
  const source = workbook.worksheets.find((entry) => entry.id === SHEET_1);
  assert.deepEqual(source.cells.A2, "East");
  assert.deepEqual(source.cells.B2, "1200");

  assert.equal(workbook.pivots.length, 1);
  assert.equal(workbook.pivots[0].rowField, "Region");
  assert.equal(workbook.pivots[0].valueField, "Sales");
  assert.equal(workbook.pivots[0].summarizeBy, "SUM");
});

test("applies COUNT, AVERAGE and a column field with grand totals", async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const created = await createPivot(app);
  const pivot = created.pivots[0];

  const counted = await app.call(pivotsPath(), {
    method: "POST",
    body: JSON.stringify({
      action: "apply",
      pivotId: pivot.id,
      rowField: "Region",
      columnField: null,
      valueField: "Sales",
      summarizeBy: "COUNT",
    }),
  });
  assert.equal(counted.status, 200);
  const countedSheet = counted.body.workbook.worksheets.find((entry) => entry.id === pivot.resultWorksheetId);
  assert.equal(countedSheet.cells.B1, "COUNT of Sales");
  assert.equal(countedSheet.cells.B2, "1");
  assert.equal(countedSheet.cells.B5, "3");

  const averaged = await app.call(pivotsPath(), {
    method: "POST",
    body: JSON.stringify({
      action: "apply",
      pivotId: pivot.id,
      rowField: "Region",
      columnField: null,
      valueField: "Sales",
      summarizeBy: "AVERAGE",
    }),
  });
  assert.equal(averaged.status, 200);
  const averagedSheet = averaged.body.workbook.worksheets.find((entry) => entry.id === pivot.resultWorksheetId);
  assert.equal(averagedSheet.cells.B1, "AVERAGE of Sales");
  assert.equal(averagedSheet.cells.B5, "900");

  const withColumn = await app.call(pivotsPath(), {
    method: "POST",
    body: JSON.stringify({
      action: "apply",
      pivotId: pivot.id,
      rowField: "Region",
      columnField: "Status",
      valueField: "Sales",
      summarizeBy: "SUM",
    }),
  });
  assert.equal(withColumn.status, 200);
  const pivotSheet = withColumn.body.workbook.worksheets.find((entry) => entry.id === pivot.resultWorksheetId);
  // Header row: row field, column values in first-appearance order, Grand Total.
  assert.equal(pivotSheet.cells.A1, "Region");
  assert.equal(pivotSheet.cells.B1, "Open");
  assert.equal(pivotSheet.cells.C1, "Closed");
  assert.equal(pivotSheet.cells.D1, "Grand Total");
  assert.equal(pivotSheet.cells.A2, "East");
  assert.equal(pivotSheet.cells.B2, "1200");
  // No Closed record for East -> COUNT-style 0 cell for the missing combination.
  assert.equal(pivotSheet.cells.C2, "0");
  assert.equal(pivotSheet.cells.D2, "1200");
  assert.equal(pivotSheet.cells.A5, "Grand Total");
  assert.equal(pivotSheet.cells.B5, "1900");
  assert.equal(pivotSheet.cells.C5, "800");
  assert.equal(pivotSheet.cells.D5, "2700");
});

test("refreshes the result from the current source range and persists it", async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const created = await createPivot(app);
  const pivot = created.pivots[0];

  // A change inside the source range updates the summary only after refresh.
  const written = await app.call(`/api/workbooks/${WORKBOOK_ID}/worksheets/${SHEET_1}/cells`, {
    method: "POST",
    body: JSON.stringify({ start: { row: 3, col: 1 }, values: [["1000"]] }),
  });
  assert.equal(written.status, 200);
  const beforeRefresh = await app.workbook();
  const unchanged = beforeRefresh.worksheets.find((entry) => entry.id === pivot.resultWorksheetId);
  assert.equal(unchanged.cells.B4, "700");
  assert.equal(unchanged.cells.B5, "2700");

  const refreshed = await app.call(pivotsPath(), {
    method: "POST",
    body: JSON.stringify({ action: "refresh", pivotId: pivot.id }),
  });
  assert.equal(refreshed.status, 200);
  const refreshedSheet = refreshed.body.workbook.worksheets.find((entry) => entry.id === pivot.resultWorksheetId);
  assert.equal(refreshedSheet.cells.A4, "South");
  assert.equal(refreshedSheet.cells.B4, "1000");
  assert.equal(refreshedSheet.cells.B5, "3000");

  // Reopening the workbook returns the same pivot worksheet and result.
  const reopened = await app.workbook();
  const persisted = reopened.worksheets.find((entry) => entry.id === pivot.resultWorksheetId);
  assert.equal(persisted.cells.B5, "3000");
  assert.equal(reopened.pivots[0].summarizeBy, "SUM");
});

test("reports a deleted field on refresh and preserves the last successful result", async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const created = await createPivot(app);
  const pivot = created.pivots[0];
  const successful = created.worksheets.find((entry) => entry.id === pivot.resultWorksheetId).cells;

  // Deleting the "Sales" column removes the value field header.
  const removed = await app.call(structurePath(), {
    method: "POST",
    body: JSON.stringify({ operation: "deleteColumn", index: 1 }),
  });
  assert.equal(removed.status, 200);

  const failed = await app.call(pivotsPath(), {
    method: "POST",
    body: JSON.stringify({ action: "refresh", pivotId: pivot.id }),
  });
  assert.equal(failed.status, 422);
  assert.equal(failed.body.error, "Pivot field is no longer available. Select a new field.");

  const after = await app.workbook();
  assert.deepEqual(
    after.worksheets.find((entry) => entry.id === pivot.resultWorksheetId).cells,
    successful,
  );
  // The source worksheet keeps the rest of its data.
  assert.equal(after.worksheets.find((entry) => entry.id === SHEET_1).cells.A2, "East");
});

test("rejects SUM over a value field without numbers and keeps both worksheets", async (t) => {
  const app = await startApp((state) => {
    const sheet = state.workbooks[0].worksheets[0];
    sheet.cells = { A1: "Region", B1: "Status", A2: "East", B2: "Open", A3: "North", B3: "Closed" };
    return state;
  });
  t.after(() => app.close());
  const created = await createPivot(app);
  const pivot = created.pivots[0];

  const failed = await app.call(pivotsPath(), {
    method: "POST",
    body: JSON.stringify({
      action: "apply",
      pivotId: pivot.id,
      rowField: "Region",
      columnField: null,
      valueField: "Status",
      summarizeBy: "SUM",
    }),
  });
  assert.equal(failed.status, 422);
  assert.equal(failed.body.error, "Value field requires numeric values");
  const after = await app.workbook();
  assert.equal(after.worksheets.find((entry) => entry.id === SHEET_1).cells.B2, "Open");
  assert.equal(after.pivots[0].valueField, "Status");

  // COUNT does not fail on nonnumeric content.
  const counted = await app.call(pivotsPath(), {
    method: "POST",
    body: JSON.stringify({
      action: "apply",
      pivotId: pivot.id,
      rowField: "Region",
      columnField: null,
      valueField: "Status",
      summarizeBy: "COUNT",
    }),
  });
  assert.equal(counted.status, 200);
});

test("creates a second pivot worksheet with the next unused PivotN name", async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  await createPivot(app);
  const second = await createPivot(app);
  assert.deepEqual(second.worksheets.map((entry) => entry.name), [
    "Sheet1",
    "Sheet2",
    "Pivot1",
    "Pivot2",
  ]);
  assert.equal(second.pivots.length, 2);
});
