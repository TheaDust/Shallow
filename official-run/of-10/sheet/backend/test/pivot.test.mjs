import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { SEED_WORKBOOK_ID, SEED_WORKSHEET_ID } from "../src/lib/seed.mjs";
import { createWorkbookRepository } from "../src/lib/workbook-store.mjs";

async function startTestServer() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-pivot-"));
  const repository = createWorkbookRepository(directory);
  const server = createServer(createApp(repository));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function jsonRequest(base, path, method, payload) {
  return fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

async function getWorkbook(base, id = SEED_WORKBOOK_ID) {
  const response = await fetch(`${base}/api/workbooks/${id}`);
  return (await response.json()).workbook;
}

const sheetPath = (worksheetId = SEED_WORKSHEET_ID) =>
  `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${worksheetId}`;

function createPivot(base, payload) {
  return jsonRequest(base, `/api/workbooks/${SEED_WORKBOOK_ID}/pivots`, "POST", {
    sourceWorksheetId: SEED_WORKSHEET_ID,
    sourceRange: "A1:C4",
    ...payload,
  });
}

function applyPivot(base, pivotSheetId, payload) {
  return jsonRequest(base, `${sheetPath(pivotSheetId)}/pivot`, "PUT", payload);
}

function refreshPivot(base, pivotSheetId) {
  return jsonRequest(base, `${sheetPath(pivotSheetId)}/pivot/refresh`, "POST");
}

/** Text of one cell of a worksheet, as the grid shows it. */
function cellText(worksheet, cellId) {
  const cell = worksheet.cells[cellId];
  if (!cell) return "";
  return cell.display ?? cell.value ?? "";
}

/** The whole visible rectangle of a worksheet as `A1` keys, so a layout can be compared at once. */
function rectangle(worksheet, bottom, right) {
  const grid = [];
  for (let row = 1; row <= bottom; row += 1) {
    const line = [];
    for (let column = 1; column <= right; column += 1) {
      const label = String.fromCharCode(64 + column);
      line.push(cellText(worksheet, `${label}${row}`));
    }
    grid.push(line.join("|"));
  }
  return grid.join("\n");
}

function worksheetOf(workbook, id) {
  const worksheet = workbook.worksheets.find((candidate) => candidate.id === id);
  assert.ok(worksheet, `worksheet ${id} is missing`);
  return worksheet;
}

test("creates the first unused PivotN result worksheet for the selected range", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const sourceBefore = worksheetOf(await getWorkbook(server.base), SEED_WORKSHEET_ID);
  const created = await createPivot(server.base, {});
  assert.equal(created.status, 201);
  const workbook = (await created.json()).workbook;
  const pivot = worksheetOf(workbook, workbook.activeWorksheetId);

  assert.equal(pivot.name, "Pivot1");
  assert.deepEqual(pivot.cells, {});
  assert.deepEqual(pivot.pivot, {
    sourceWorksheetId: SEED_WORKSHEET_ID,
    sourceRange: { top: 1, bottom: 4, left: 1, right: 3 },
    rows: null,
    columns: null,
    values: null,
    summarizeBy: "SUM",
  });
  assert.deepEqual(worksheetOf(workbook, SEED_WORKSHEET_ID), sourceBefore);

  const reloaded = worksheetOf(await getWorkbook(server.base), pivot.id);
  assert.equal(reloaded.name, "Pivot1");
  assert.deepEqual(reloaded.pivot, pivot.pivot);

  const second = await createPivot(server.base, {});
  const secondWorkbook = (await second.json()).workbook;
  assert.equal(worksheetOf(secondWorkbook, secondWorkbook.activeWorksheetId).name, "Pivot2");
});

test("refuses a pivot for a range without a data row and stores nothing", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const before = JSON.stringify(await getWorkbook(server.base));

  const headerOnly = await createPivot(server.base, { sourceRange: "A1:C1" });
  assert.equal(headerOnly.status, 400);
  assert.equal(
    (await headerOnly.json()).error,
    "Select a range with a header row to create a pivot table.",
  );

  const outside = await createPivot(server.base, { sourceRange: "A1:C400" });
  assert.equal(outside.status, 400);

  const malformed = await createPivot(server.base, { sourceRange: "not a range" });
  assert.equal(malformed.status, 400);

  const unknownSheet = await createPivot(server.base, { sourceWorksheetId: "ws_missing" });
  assert.equal(unknownSheet.status, 404);

  const unknownWorkbook = await jsonRequest(server.base, "/api/workbooks/wb_missing/pivots", "POST", {
    sourceWorksheetId: SEED_WORKSHEET_ID,
    sourceRange: "A1:C4",
  });
  assert.equal(unknownWorkbook.status, 404);

  assert.equal(JSON.stringify(await getWorkbook(server.base)), before);
});

test("summarizes the value field by row group with SUM, COUNT and AVERAGE", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const pivotId = worksheetOf(
    (await (await createPivot(server.base, {})).json()).workbook,
    (await getWorkbook(server.base)).activeWorksheetId,
  ).id;
  const sourceBefore = JSON.stringify(worksheetOf(await getWorkbook(server.base), SEED_WORKSHEET_ID));

  const sum = await applyPivot(server.base, pivotId, {
    rows: "Region",
    columns: null,
    values: "Sales",
    summarizeBy: "SUM",
  });
  assert.equal(sum.status, 200);
  let worksheet = worksheetOf((await sum.json()).workbook, pivotId);
  assert.equal(
    rectangle(worksheet, 5, 2),
    ["Region|SUM of Sales", "East|1200", "North|800", "South|700", "Grand Total|2700"].join("\n"),
  );

  const count = await applyPivot(server.base, pivotId, {
    rows: "Region",
    columns: null,
    values: "Sales",
    summarizeBy: "COUNT",
  });
  assert.equal(count.status, 200);
  worksheet = worksheetOf((await count.json()).workbook, pivotId);
  assert.equal(
    rectangle(worksheet, 5, 2),
    ["Region|COUNT of Sales", "East|1", "North|1", "South|1", "Grand Total|3"].join("\n"),
  );

  const average = await applyPivot(server.base, pivotId, {
    rows: "Region",
    columns: null,
    values: "Sales",
    summarizeBy: "AVERAGE",
  });
  assert.equal(average.status, 200);
  const workbook = (await average.json()).workbook;
  worksheet = worksheetOf(workbook, pivotId);
  assert.equal(
    rectangle(worksheet, 5, 2),
    ["Region|AVERAGE of Sales", "East|1200", "North|800", "South|700", "Grand Total|900"].join("\n"),
  );
  assert.equal(JSON.stringify(worksheetOf(workbook, SEED_WORKSHEET_ID)), sourceBefore);

  const reloaded = worksheetOf(await getWorkbook(server.base), pivotId);
  assert.equal(cellText(reloaded, "B1"), "AVERAGE of Sales");
  assert.equal(cellText(reloaded, "B5"), "900");
  assert.equal(reloaded.pivot.summarizeBy, "AVERAGE");
  assert.equal(reloaded.pivot.rows, "Region");
  assert.equal(reloaded.pivot.values, "Sales");
});

test("arranges the column field from B1 onward with a Grand Total column and row", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await createPivot(server.base, {});
  const pivotId = (await created.json()).workbook.activeWorksheetId;

  const applied = await applyPivot(server.base, pivotId, {
    rows: "Region",
    columns: "Status",
    values: "Sales",
    summarizeBy: "SUM",
  });
  assert.equal(applied.status, 200);
  const workbook = (await applied.json()).workbook;
  const worksheet = worksheetOf(workbook, pivotId);
  assert.equal(
    rectangle(worksheet, 5, 4),
    [
      "Region|Open|Closed|Grand Total",
      "East|1200|0|1200",
      "North|0|800|800",
      "South|700|0|700",
      "Grand Total|1900|800|2700",
    ].join("\n"),
  );
  assert.equal(JSON.stringify(worksheetOf(workbook, SEED_WORKSHEET_ID)), JSON.stringify(worksheetOf(await getWorkbook(server.base), SEED_WORKSHEET_ID)));
  assert.equal(JSON.stringify(worksheetOf(workbook, SEED_WORKSHEET_ID)), JSON.stringify(worksheetOf(await getWorkbook(server.base), SEED_WORKSHEET_ID)));
});

test("COUNT counts non-empty value fields and shows 0 for an empty combination", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const extra = [
    ["A5", "West"],
    ["B5", "n/a"],
    ["C5", "Open"],
    ["A6", "West"],
    ["B6", ""],
    ["C6", "Open"],
    ["A7", "East"],
    ["B7", "1200"],
    ["C7", "Open"],
    ["A8", "West"],
    ["B8", ""],
    ["C8", "Closed"],
  ];
  for (const [cellId, value] of extra) {
    const written = await jsonRequest(server.base, `${sheetPath()}/cells/${cellId}`, "PUT", { value });
    assert.equal(written.status, 200);
  }

  const created = await createPivot(server.base, { sourceRange: "A1:C8" });
  const pivotId = (await created.json()).workbook.activeWorksheetId;
  const applied = await applyPivot(server.base, pivotId, {
    rows: "Region",
    columns: "Status",
    values: "Sales",
    summarizeBy: "COUNT",
  });
  assert.equal(applied.status, 200);
  const worksheet = worksheetOf((await applied.json()).workbook, pivotId);
  assert.equal(
    rectangle(worksheet, 6, 4),
    [
      "Region|Open|Closed|Grand Total",
      "East|2|0|2",
      "North|0|1|1",
      "South|1|0|1",
      "West|1|0|1",
      "Grand Total|4|1|5",
    ].join("\n"),
  );
});

test("refuses SUM and AVERAGE without a parseable number and keeps the last result", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await createPivot(server.base, {});
  const pivotId = (await created.json()).workbook.activeWorksheetId;

  const rejected = await applyPivot(server.base, pivotId, {
    rows: "Region",
    columns: null,
    values: "Status",
    summarizeBy: "SUM",
  });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, "Value field requires numeric values");
  assert.deepEqual(worksheetOf(await getWorkbook(server.base), pivotId).cells, {});

  const applied = await applyPivot(server.base, pivotId, {
    rows: "Region",
    values: "Sales",
    summarizeBy: "SUM",
  });
  assert.equal(applied.status, 200);
  const sourceBefore = JSON.stringify(worksheetOf(await getWorkbook(server.base), SEED_WORKSHEET_ID));

  const rejectedAgain = await applyPivot(server.base, pivotId, {
    rows: "Region",
    columns: null,
    values: "Status",
    summarizeBy: "AVERAGE",
  });
  assert.equal(rejectedAgain.status, 400);
  assert.equal((await rejectedAgain.json()).error, "Value field requires numeric values");

  const stored = worksheetOf(await getWorkbook(server.base), pivotId);
  assert.equal(cellText(stored, "B1"), "SUM of Sales");
  assert.equal(cellText(stored, "B5"), "2700");
  assert.equal(stored.pivot.summarizeBy, "SUM");
  assert.equal(JSON.stringify(worksheetOf(await getWorkbook(server.base), SEED_WORKSHEET_ID)), sourceBefore);
});

test("keeps the result when a selected header is deleted and refuses the refresh", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await createPivot(server.base, {});
  const pivotId = (await created.json()).workbook.activeWorksheetId;
  await applyPivot(server.base, pivotId, { rows: "Region", values: "Sales", summarizeBy: "SUM" });
  const resultBefore = JSON.stringify(worksheetOf(await getWorkbook(server.base), pivotId).cells);

  const deleted = await jsonRequest(server.base, `${sheetPath()}/structure`, "POST", {
    axis: "column",
    op: "delete",
    index: 1,
  });
  assert.equal(deleted.status, 200);
  const afterDelete = worksheetOf((await deleted.json()).workbook, pivotId);
  assert.equal(JSON.stringify(afterDelete.cells), resultBefore);
  assert.deepEqual(afterDelete.pivot.sourceRange, { top: 1, bottom: 4, left: 1, right: 2 });

  const refreshed = await refreshPivot(server.base, pivotId);
  assert.equal(refreshed.status, 400);
  assert.equal(
    (await refreshed.json()).error,
    "Pivot field is no longer available. Select a new field.",
  );

  const stored = worksheetOf(await getWorkbook(server.base), pivotId);
  assert.equal(JSON.stringify(stored.cells), resultBefore);
  assert.equal(cellText(stored, "A2"), "East");
  assert.equal(worksheetOf(await getWorkbook(server.base), SEED_WORKSHEET_ID).cells.A1.value, "Sales");
});

test("refresh replaces the whole summary after a source change and follows a shifted range", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await createPivot(server.base, {});
  const pivotId = (await created.json()).workbook.activeWorksheetId;
  await applyPivot(server.base, pivotId, { rows: "Region", columns: "Status", values: "Sales", summarizeBy: "SUM" });

  const written = await jsonRequest(server.base, `${sheetPath()}/cells/B2`, "PUT", { value: "1500" });
  assert.equal(written.status, 200);
  assert.equal(cellText(worksheetOf((await written.json()).workbook, pivotId), "B2"), "1200");

  const refreshed = await refreshPivot(server.base, pivotId);
  assert.equal(refreshed.status, 200);
  let worksheet = worksheetOf((await refreshed.json()).workbook, pivotId);
  assert.equal(cellText(worksheet, "B2"), "1500");
  assert.equal(cellText(worksheet, "D5"), "3000");
  assert.equal(cellText(worksheet, "B5"), "2200");

  // Inserting a row above the first record moves the source range down with the data.
  const inserted = await jsonRequest(server.base, `${sheetPath()}/structure`, "POST", {
    axis: "row",
    op: "insert",
    index: 2,
    side: "before",
  });
  assert.equal(inserted.status, 200);
  const afterInsert = worksheetOf((await inserted.json()).workbook, pivotId);
  assert.deepEqual(afterInsert.pivot.sourceRange, { top: 1, bottom: 5, left: 1, right: 3 });

  const refreshedAgain = await refreshPivot(server.base, pivotId);
  assert.equal(refreshedAgain.status, 200);
  worksheet = worksheetOf((await refreshedAgain.json()).workbook, pivotId);
  assert.equal(
    rectangle(worksheet, 5, 4),
    [
      "Region|Open|Closed|Grand Total",
      "East|1500|0|1500",
      "North|0|800|800",
      "South|700|0|700",
      "Grand Total|2200|800|3000",
    ].join("\n"),
  );
});

test("refuses the pivot write and the refresh on a worksheet that is not a pivot table", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const applied = await applyPivot(server.base, SEED_WORKSHEET_ID, { rows: "Region", values: "Sales" });
  assert.equal(applied.status, 400);
  assert.equal((await applied.json()).error, "This worksheet is not a pivot table.");

  const refreshed = await refreshPivot(server.base, SEED_WORKSHEET_ID);
  assert.equal(refreshed.status, 400);

  const missing = await applyPivot(server.base, "ws_missing", { rows: "Region", values: "Sales" });
  assert.equal(missing.status, 404);
});
