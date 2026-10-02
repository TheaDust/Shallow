import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { computePivotResult } from "../src/domain/pivot.mjs";
import { createSeedState, createWorkbookService } from "../src/domain/workbooks.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

async function makeService() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-pivot-"));
  const file = join(directory, "workbooks.json");
  const store = createJsonStore(file, createSeedState());
  return { service: createWorkbookService(store), file };
}

const SHEET1 = "q3-sales-sheet1";
const SEED_CELLS = {
  A1: "Region", B1: "Sales", C1: "Status",
  A2: "East", B2: "1200", C2: "Open",
  A3: "North", B3: "800", C3: "Closed",
  A4: "South", B4: "700", C4: "Open",
};

/** Creates Pivot1 over the seeded sales region and returns it. */
async function createPivot(service, range = "A1:C4") {
  const workbook = await service.createPivot("q3-sales", { sourceWorksheetId: SHEET1, range });
  return workbook.worksheets.find((worksheet) => worksheet.name === "Pivot1");
}

/** One worksheet of one workbook by name (worksheets are appended in creation order). */
function sheetByName(workbook, name) {
  const worksheet = workbook.worksheets.find((candidate) => candidate.name === name);
  assert.ok(worksheet, `worksheet ${name} exists`);
  return worksheet;
}

test("a pivot worksheet is created blank, named PivotN and made active", async () => {
  const { service, file } = await makeService();
  const pivot = await createPivot(service);

  assert.equal(pivot.name, "Pivot1");
  assert.deepEqual(pivot.cells, {});
  assert.deepEqual(pivot.pivot, {
    sourceWorksheetId: SHEET1,
    sourceRange: "A1:C4",
    rowField: "",
    columnField: "",
    valueField: "",
    summarizeBy: "SUM",
  });
  const workbook = await service.get("q3-sales");
  assert.equal(workbook.activeWorksheetId, pivot.id);
  assert.equal(workbook.worksheets.length, 3);
  // Only the new worksheet; the seeded values and order stay exactly as they were.
  assert.deepEqual(workbook.worksheets[0].cells, SEED_CELLS);

  // A second pivot uses the next unused name.
  const second = await service.createPivot("q3-sales", { sourceWorksheetId: SHEET1, range: "A1:C4" });
  assert.ok(second.worksheets.some((worksheet) => worksheet.name === "Pivot2"));

  const reloaded = createWorkbookService(createJsonStore(file, createSeedState()));
  const stored = sheetByName(await reloaded.get("q3-sales"), "Pivot1");
  assert.equal(stored.name, "Pivot1");
  assert.deepEqual(stored.pivot, pivot.pivot);
});

test("an invalid source range creates nothing", async () => {
  const { service } = await makeService();
  await assert.rejects(
    () => service.createPivot("q3-sales", { sourceWorksheetId: SHEET1, range: "nonsense" }),
    /source range/i,
  );
  await assert.rejects(
    () => service.createPivot("q3-sales", { sourceWorksheetId: SHEET1, range: "A99:C99" }),
    /source range/i,
  );
  assert.equal((await service.get("q3-sales")).worksheets.length, 2);
});

test("SUM without a column field orders row groups by first appearance and totals them", async () => {
  const { service } = await makeService();
  const pivot = await createPivot(service);

  const updated = await service.configurePivot("q3-sales", pivot.id, {
    rowField: "Region",
    columnField: "",
    valueField: "Sales",
    summarizeBy: "SUM",
  });
  const result = sheetByName(updated, "Pivot1");
  assert.equal(result.cells.A1, "Region");
  assert.equal(result.cells.B1, "SUM of Sales");
  assert.equal(result.cells.A2, "East");
  assert.equal(result.cells.B2, "1200");
  assert.equal(result.cells.A3, "North");
  assert.equal(result.cells.B3, "800");
  assert.equal(result.cells.A4, "South");
  assert.equal(result.cells.B4, "700");
  assert.equal(result.cells.A5, "Grand Total");
  assert.equal(result.cells.B5, "2700");
  assert.deepEqual(result.pivot, {
    sourceWorksheetId: SHEET1,
    sourceRange: "A1:C4",
    rowField: "Region",
    columnField: "",
    valueField: "Sales",
    summarizeBy: "SUM",
  });
  // Reading the source never changes it.
  assert.deepEqual(sheetByName(updated, "Sheet1").cells, SEED_CELLS);
});

test("a column field arranges its values from B1 with a Grand Total column", async () => {
  const { service } = await makeService();
  const pivot = await createPivot(service);
  const updated = await service.configurePivot("q3-sales", pivot.id, {
    rowField: "Region",
    columnField: "Status",
    valueField: "Sales",
    summarizeBy: "SUM",
  });
  const cells = sheetByName(updated, "Pivot1").cells;
  assert.equal(cells.A1, "Region");
  assert.equal(cells.B1, "Open");
  assert.equal(cells.C1, "Closed");
  assert.equal(cells.D1, "Grand Total");
  assert.equal(cells.B2, "1200");
  assert.equal(cells.C2, "0");
  assert.equal(cells.D2, "1200");
  assert.equal(cells.B3, "0");
  assert.equal(cells.C3, "800");
  assert.equal(cells.A5, "Grand Total");
  assert.equal(cells.B5, "1900");
  assert.equal(cells.C5, "800");
  assert.equal(cells.D5, "2700");
});

test("COUNT counts non-empty value records and AVERAGE ignores nonnumeric text", async () => {
  const { service } = await makeService();
  const pivot = await createPivot(service);
  await service.configurePivot("q3-sales", pivot.id, {
    rowField: "Region",
    columnField: "",
    valueField: "Status",
    summarizeBy: "COUNT",
  });
  const counted = sheetByName(await service.get("q3-sales"), "Pivot1");
  assert.equal(counted.cells.B1, "COUNT of Status");
  assert.equal(counted.cells.B2, "1");
  assert.equal(counted.cells.B5, "3");

  // AVERAGE over a value field that also holds text aggregates the numbers only.
  const mixed = await service.updateCells("q3-sales", SHEET1, { B3: "not a number" });
  assert.equal(sheetByName(mixed, "Sheet1").cells.B3, "not a number");
  const averaged = await service.configurePivot("q3-sales", pivot.id, {
    rowField: "Region",
    columnField: "",
    valueField: "Sales",
    summarizeBy: "AVERAGE",
  });
  assert.equal(sheetByName(averaged, "Pivot1").cells.B3, "0");
  assert.equal(sheetByName(averaged, "Pivot1").cells.B5, "950");
});

test("SUM and AVERAGE reject a value field without parseable numbers and keep the old result", async () => {
  const { service } = await makeService();
  const pivot = await createPivot(service);
  await service.configurePivot("q3-sales", pivot.id, {
    rowField: "Region",
    columnField: "",
    valueField: "Sales",
    summarizeBy: "SUM",
  });

  await assert.rejects(
    () => service.configurePivot("q3-sales", pivot.id, {
      rowField: "Region",
      columnField: "",
      valueField: "Region",
      summarizeBy: "SUM",
    }),
    /Value field requires numeric values/,
  );
  const stored = await service.get("q3-sales");
  // The old summary, the configuration and the source worksheet all survive.
  assert.equal(sheetByName(stored, "Pivot1").cells.B5, "2700");
  assert.equal(sheetByName(stored, "Pivot1").pivot.valueField, "Sales");
  assert.deepEqual(sheetByName(stored, "Sheet1").cells, SEED_CELLS);

  // COUNT accepts the same text field, so it is the summarization that fails.
  const counted = await service.configurePivot("q3-sales", pivot.id, {
    rowField: "Region",
    columnField: "",
    valueField: "Region",
    summarizeBy: "COUNT",
  });
  assert.equal(sheetByName(counted, "Pivot1").cells.B1, "COUNT of Region");
  assert.equal(sheetByName(counted, "Pivot1").cells.B2, "1");
});

test("refresh recomputes the stored configuration and reports a deleted header", async () => {
  const { service, file } = await makeService();
  const pivot = await createPivot(service);
  await service.configurePivot("q3-sales", pivot.id, {
    rowField: "Region",
    columnField: "",
    valueField: "Sales",
    summarizeBy: "SUM",
  });

  await service.updateCells("q3-sales", SHEET1, { B2: "2000" });
  const refreshed = await service.refreshPivot("q3-sales", pivot.id);
  assert.equal(sheetByName(refreshed, "Pivot1").cells.B2, "2000");
  assert.equal(sheetByName(refreshed, "Pivot1").cells.B5, "3500");
  assert.equal(sheetByName(refreshed, "Sheet1").cells.B2, "2000");

  // Deleting the value column removes the header the pivot was built on.
  await service.changeStructure("q3-sales", SHEET1, "column", { action: "delete", index: 1 });
  await assert.rejects(
    () => service.refreshPivot("q3-sales", pivot.id),
    /Pivot field is no longer available\. Select a new field\./,
  );
  const reloaded = createWorkbookService(createJsonStore(file, createSeedState()));
  const stored = await reloaded.get("q3-sales");
  // The last successful summary survives and the source keeps its values.
  assert.equal(sheetByName(stored, "Pivot1").cells.B5, "3500");
  assert.equal(sheetByName(stored, "Sheet1").cells.A3, "North");
  assert.equal(sheetByName(stored, "Sheet1").cells.B4, "Open");
});

test("a source structure change shifts the stored pivot range for the next refresh", async () => {
  const { service } = await makeService();
  const pivot = await createPivot(service);
  await service.configurePivot("q3-sales", pivot.id, {
    rowField: "Region",
    columnField: "",
    valueField: "Sales",
    summarizeBy: "SUM",
  });

  // Inserting a row above the header moves the whole region down by one.
  const shifted = await service.changeStructure("q3-sales", SHEET1, "row", {
    action: "insert-above",
    index: 0,
  });
  assert.equal(sheetByName(shifted, "Pivot1").pivot.sourceRange, "A2:C5");
  // The existing result stays until the refresh runs.
  assert.equal(sheetByName(shifted, "Pivot1").cells.B5, "2700");

  const refreshed = await service.refreshPivot("q3-sales", pivot.id);
  assert.equal(sheetByName(refreshed, "Pivot1").cells.A1, "Region");
  assert.equal(sheetByName(refreshed, "Pivot1").cells.B2, "1200");
  assert.equal(sheetByName(refreshed, "Pivot1").cells.B5, "2700");
});

test("the pivot HTTP routes create, configure and refresh one workbook", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-pivot-api-"));
  const store = createJsonStore(join(directory, "workbooks.json"), createSeedState());
  const handler = createRequestHandler({ service: createWorkbookService(store), staticRoot: directory });
  const server = createServer((request, response) => void handler(request, response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const json = (response) => response.json();
  try {
    const created = await fetch(`${baseUrl}/api/workbooks/q3-sales/pivot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceWorksheetId: SHEET1, range: "A1:C4" }),
    });
    assert.equal(created.status, 201);
    const pivotId = (await json(created)).workbook.worksheets.find((worksheet) => worksheet.name === "Pivot1").id;

    const configured = await fetch(`${baseUrl}/api/workbooks/q3-sales/worksheets/${pivotId}/pivot`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rowField: "Region", columnField: "", valueField: "Sales", summarizeBy: "SUM" }),
    });
    assert.equal(configured.status, 200);
    assert.equal((await json(configured)).workbook.worksheets.find((worksheet) => worksheet.name === "Pivot1").cells.B5, "2700");

    const refreshed = await fetch(`${baseUrl}/api/workbooks/q3-sales/worksheets/${pivotId}/pivot/refresh`, {
      method: "POST",
    });
    assert.equal(refreshed.status, 200);
    assert.equal((await json(refreshed)).workbook.worksheets.find((worksheet) => worksheet.name === "Pivot1").cells.A1, "Region");

    const rejected = await fetch(`${baseUrl}/api/workbooks/q3-sales/worksheets/${pivotId}/pivot`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rowField: "Gone", columnField: "", valueField: "Sales", summarizeBy: "SUM" }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(
      (await json(rejected)).error,
      "Pivot field is no longer available. Select a new field.",
    );

    const notAPivot = await fetch(`${baseUrl}/api/workbooks/q3-sales/worksheets/${SHEET1}/pivot/refresh`, {
      method: "POST",
    });
    assert.equal(notAPivot.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("pivot aggregation reads plain values only and returns 0 for an empty source", () => {
  const worksheet = { cells: { A1: "Region", B1: "Sales" } };
  const empty = computePivotResult({
    worksheet,
    pivot: { sourceRange: "A1:B1", rowField: "Region", columnField: "", valueField: "Sales", summarizeBy: "COUNT" },
  });
  assert.equal(empty.cells.A1, "Region");
  assert.equal(empty.cells.B1, "COUNT of Sales");
  assert.equal(empty.cells.A2, "Grand Total");
  assert.equal(empty.cells.B2, "0");
});
