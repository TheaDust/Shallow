import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/handler.mjs";
import {
  PIVOT_FIELD_MISSING_MESSAGE,
  PIVOT_VALUE_NUMERIC_MESSAGE,
} from "../src/lib/pivot.mjs";
import { WorkbookError, createWorkbookService, nextPivotWorksheetName } from "../src/lib/workbooks.mjs";

const WORKBOOK = "wb-q3-sales";
const SHEET = "ws-q3-sales-sheet1";
/** The seeded data region: headers on row 1, records on rows 2-4. */
const REGION = "A1:C4";

async function createService(t) {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-pivot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "workbooks.json");
  return { directory, filePath, service: createWorkbookService({ filePath }) };
}

function sheetOf(workbook, index) {
  return workbook.worksheets[index];
}

function pivotSheetOf(workbook) {
  return workbook.worksheets.find((worksheet) => worksheet.pivot);
}

/** `{A1: "Region", ...}` view of one worksheet, for compact assertions. */
function values(worksheet) {
  const cells = {};
  for (const [name, cell] of Object.entries(worksheet.cells ?? {})) cells[name] = cell.value;
  return cells;
}

async function createPivot(service, range = REGION) {
  const workbook = await service.createPivotTable(WORKBOOK, {
    sourceWorksheetId: SHEET,
    range,
  });
  // Creation makes the new result worksheet active, so this is the one just added.
  const pivot = workbook.worksheets.find(
    (worksheet) => worksheet.id === workbook.activeWorksheetId && worksheet.pivot,
  );
  return { workbook, pivot };
}

test("REQ-5-3-1 the evaluation seed carries no pivot worksheet", async (t) => {
  const { service } = await createService(t);
  const workbook = await service.get(WORKBOOK);
  assert.equal(workbook.worksheets.length, 2);
  assert.deepEqual(workbook.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2"]);
  assert.equal(pivotSheetOf(workbook), undefined);
});

test("REQ-5-3-1 creating a pivot table uses the first unused PivotN name and reads only the source", async (t) => {
  const { filePath, service } = await createService(t);

  const { workbook, pivot } = await createPivot(service);
  assert.equal(pivot.name, "Pivot1");
  assert.deepEqual(values(pivot), {}, "the result worksheet starts blank");
  assert.deepEqual(pivot.pivot, {
    sourceWorksheetId: SHEET,
    sourceRange: REGION,
    rowField: null,
    columnField: null,
    valueField: null,
    summarizeBy: "SUM",
  });
  assert.equal(workbook.activeWorksheetId, pivot.id, "the new result worksheet becomes active");
  assert.equal(sheetOf(workbook, 0).filter, undefined);
  assert.deepEqual(values(sheetOf(workbook, 0)).A2, "East", "the source stays untouched");

  const second = await createPivot(service);
  assert.equal(second.pivot.name, "Pivot2");

  const reopened = createWorkbookService({ filePath });
  const stored = pivotSheetOf(await reopened.get(WORKBOOK));
  assert.equal(stored.name, "Pivot1");
  assert.equal(stored.pivot.sourceRange, REGION);
  assert.deepEqual(
    (await service.get(WORKBOOK)).worksheets.map((worksheet) => worksheet.name),
    ["Sheet1", "Sheet2", "Pivot1", "Pivot2"],
  );
});

test("REQ-5-3-1 names pivot worksheets with the first unused PivotN", () => {
  assert.equal(nextPivotWorksheetName([]), "Pivot1");
  assert.equal(nextPivotWorksheetName([{ name: "Sheet1" }, { name: "Pivot1" }]), "Pivot2");
  assert.equal(
    nextPivotWorksheetName([{ name: "Pivot2" }, { name: "Pivot1" }, { name: "Pivot3" }]),
    "Pivot4",
  );
});

test("REQ-5-3-1 applies one row and one value field with first-appearance order and Grand Total", async (t) => {
  const { filePath, service } = await createService(t);
  const { pivot } = await createPivot(service);

  const applied = await service.applyPivotTable(WORKBOOK, pivot.id, {
    rowField: "Region",
    columnField: "",
    valueField: "Sales",
    summarizeBy: "SUM",
  });
  const result = pivotSheetOf(applied);
  assert.deepEqual(values(result), {
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
  assert.equal(result.pivot.columnField, null);
  assert.deepEqual(values(sheetOf(applied, 0)).A2, "East", "the source keeps its values");

  const reopened = createWorkbookService({ filePath });
  const stored = pivotSheetOf(await reopened.get(WORKBOOK));
  assert.equal(stored.pivot.summarizeBy, "SUM");
  assert.equal(stored.pivot.rowField, "Region");
  assert.deepEqual(values(stored).B5, "2700", "the result survives a reopen");
});

test("REQ-5-3-1 lays out an optional column field and counts non-empty records", async (t) => {
  const { service } = await createService(t);
  const { pivot } = await createPivot(service);

  const counted = await service.applyPivotTable(WORKBOOK, pivot.id, {
    rowField: "Region",
    columnField: "Status",
    valueField: "Sales",
    summarizeBy: "COUNT",
  });
  assert.deepEqual(values(pivotSheetOf(counted)), {
    A1: "Region",
    B1: "Open",
    C1: "Closed",
    D1: "Grand Total",
    A2: "East",
    B2: "1",
    C2: "0",
    D2: "1",
    A3: "North",
    B3: "0",
    C3: "1",
    D3: "1",
    A4: "South",
    B4: "1",
    C4: "0",
    D4: "1",
    A5: "Grand Total",
    B5: "2",
    C5: "1",
    D5: "3",
  });
});

test("REQ-5-3-1 SUMS only parseable numbers and AVERAGEs the parseable ones", async (t) => {
  const { service } = await createService(t);
  const { pivot } = await createPivot(service);
  // A nonnumeric value in one record is skipped instead of failing the aggregation.
  const written = await service.writeCells(WORKBOOK, SHEET, {
    updates: [{ name: "B4", input: "n/a" }],
  });
  assert.equal(sheetOf(written, 0).cells.B4.value, "n/a");

  const summed = await service.applyPivotTable(WORKBOOK, pivot.id, {
    rowField: "Region",
    valueField: "Sales",
    summarizeBy: "SUM",
  });
  assert.deepEqual(values(pivotSheetOf(summed)), {
    A1: "Region",
    B1: "SUM of Sales",
    A2: "East",
    B2: "1200",
    A3: "North",
    B3: "800",
    A4: "South",
    B4: "0",
    A5: "Grand Total",
    B5: "2000",
  });

  const averaged = await service.applyPivotTable(WORKBOOK, pivot.id, {
    rowField: "Region",
    valueField: "Sales",
    summarizeBy: "AVERAGE",
  });
  assert.deepEqual(values(pivotSheetOf(averaged)), {
    A1: "Region",
    B1: "AVERAGE of Sales",
    A2: "East",
    B2: "1200",
    A3: "North",
    B3: "800",
    A4: "South",
    B4: "0",
    A5: "Grand Total",
    B5: "1000",
  });
});

test("REQ-5-3-1 COUNT tolerates nonnumeric content and reports 0 for empty combinations", async (t) => {
  const { service } = await createService(t);
  const { pivot } = await createPivot(service);
  await service.writeCells(WORKBOOK, SHEET, {
    updates: [
      { name: "C3", input: "" },
      { name: "B3", input: "closed soon" },
    ],
  });

  const counted = await service.applyPivotTable(WORKBOOK, pivot.id, {
    rowField: "Region",
    columnField: "Status",
    valueField: "Sales",
    summarizeBy: "COUNT",
  });
  const cells = values(pivotSheetOf(counted));
  assert.equal(cells.C2, "0", "East has no blank-Status record");
  assert.equal(cells.B3, "0", "the North record lost its Status value");
  assert.equal(cells.C3, "1", "the North record still carries a value field");
  assert.equal(cells.D5, "3", "every record is counted once");
});

test("REQ-5-3-1 rejects SUM/AVERAGE without parseable numbers and keeps the last result", async (t) => {
  const { filePath, service } = await createService(t);
  const { pivot } = await createPivot(service);
  const applied = await service.applyPivotTable(WORKBOOK, pivot.id, {
    rowField: "Region",
    valueField: "Sales",
    summarizeBy: "SUM",
  });
  const before = values(pivotSheetOf(applied));

  await assert.rejects(
    () =>
      service.applyPivotTable(WORKBOOK, pivot.id, {
        rowField: "Region",
        valueField: "Region",
        summarizeBy: "SUM",
      }),
    (error) => error instanceof WorkbookError && error.message === PIVOT_VALUE_NUMERIC_MESSAGE,
  );

  const stored = pivotSheetOf(await service.get(WORKBOOK));
  assert.deepEqual(values(stored), before, "the rejected configuration keeps the last result");
  assert.equal(stored.pivot.valueField, "Sales");

  // Every value of the field is nonnumeric: SUM and AVERAGE both report the visible error.
  await service.writeCells(WORKBOOK, SHEET, {
    updates: [
      { name: "B2", input: "east" },
      { name: "B3", input: "north" },
      { name: "B4", input: "south" },
    ],
  });
  await assert.rejects(
    () => service.refreshPivotTable(WORKBOOK, pivot.id),
    (error) => error instanceof WorkbookError && error.message === PIVOT_VALUE_NUMERIC_MESSAGE,
  );
  const after = pivotSheetOf(await service.get(WORKBOOK));
  assert.deepEqual(values(after), before, "the failing refresh keeps the last successful summary");
  assert.equal(sheetOf(await service.get(WORKBOOK), 0).cells.B2.value, "east", "the source is unmodified");
  assert.equal(filePath.endsWith("workbooks.json"), true);
});

test("REQ-5-3-1 refresh replaces the summary from the current source data", async (t) => {
  const { service } = await createService(t);
  const { pivot } = await createPivot(service);
  await service.applyPivotTable(WORKBOOK, pivot.id, {
    rowField: "Region",
    valueField: "Sales",
    summarizeBy: "SUM",
  });

  await service.writeCells(WORKBOOK, SHEET, {
    updates: [
      { name: "B2", input: "2000" },
      { name: "A4", input: "South" },
    ],
  });
  const stale = pivotSheetOf(await service.get(WORKBOOK));
  assert.equal(values(stale).B2, "1200", "the old summary stays until the refresh");

  const refreshed = await service.refreshPivotTable(WORKBOOK, pivot.id);
  assert.deepEqual(values(pivotSheetOf(refreshed)), {
    A1: "Region",
    B1: "SUM of Sales",
    A2: "East",
    B2: "2000",
    A3: "North",
    B3: "800",
    A4: "South",
    B4: "700",
    A5: "Grand Total",
    B5: "3500",
  });
  assert.deepEqual(values(sheetOf(refreshed, 0)).B2, "2000", "the source keeps its edited value");
});

test("REQ-5-3-1 a deleted source header reports the reselect error and preserves both worksheets", async (t) => {
  const { service } = await createService(t);
  const { pivot } = await createPivot(service);
  const applied = await service.applyPivotTable(WORKBOOK, pivot.id, {
    rowField: "Region",
    valueField: "Sales",
    summarizeBy: "SUM",
  });
  const before = values(pivotSheetOf(applied));

  // Delete the "Sales" column: the region shrinks and the stored field disappears.
  await service.structure(WORKBOOK, SHEET, { axis: "column", action: "delete", index: 1 });
  const shrunk = sheetOf(await service.get(WORKBOOK), 0);
  assert.equal(values(shrunk).A1, "Region");
  assert.equal(values(shrunk).B1, "Status");

  await assert.rejects(
    () => service.refreshPivotTable(WORKBOOK, pivot.id),
    (error) => error instanceof WorkbookError && error.message === PIVOT_FIELD_MISSING_MESSAGE,
  );
  const after = pivotSheetOf(await service.get(WORKBOOK));
  assert.deepEqual(values(after), before, "the last successful result is preserved");
  assert.equal(sheetOf(await service.get(WORKBOOK), 0).cells.A2.value, "East");
});

test("REQ-5-3-1 inserted source columns move the range and the refreshed fields follow", async (t) => {
  const { service } = await createService(t);
  const { pivot } = await createPivot(service);
  await service.applyPivotTable(WORKBOOK, pivot.id, {
    rowField: "Region",
    valueField: "Sales",
    summarizeBy: "SUM",
  });

  const inserted = await service.structure(WORKBOOK, SHEET, {
    axis: "column",
    action: "insert-left",
    index: 1,
  });
  assert.equal(pivotSheetOf(inserted).pivot.sourceRange, "A1:D4");
  assert.equal(
    values(pivotSheetOf(inserted)).B5,
    "2700",
    "the existing result stays until the refresh",
  );

  const refreshed = await service.refreshPivotTable(WORKBOOK, pivot.id);
  assert.deepEqual(values(pivotSheetOf(refreshed)), {
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
});

test("REQ-5-3-1 ignores blank rows of the source range when grouping", async (t) => {
  const { service } = await createService(t);
  const { pivot } = await createPivot(service, "A1:C6");

  const applied = await service.applyPivotTable(WORKBOOK, pivot.id, {
    rowField: "Region",
    columnField: "Status",
    valueField: "Sales",
    summarizeBy: "COUNT",
  });
  assert.deepEqual(values(pivotSheetOf(applied)), {
    A1: "Region",
    B1: "Open",
    C1: "Closed",
    D1: "Grand Total",
    A2: "East",
    B2: "1",
    C2: "0",
    D2: "1",
    A3: "North",
    B3: "0",
    C3: "1",
    D3: "1",
    A4: "South",
    B4: "1",
    C4: "0",
    D4: "1",
    A5: "Grand Total",
    B5: "2",
    C5: "1",
    D5: "3",
  });
});

test("REQ-5-3-1 rejects an invalid source range without creating a worksheet", async (t) => {
  const { service } = await createService(t);

  await assert.rejects(
    () => service.createPivotTable(WORKBOOK, { sourceWorksheetId: SHEET, range: "nope" }),
    (error) => error instanceof WorkbookError && error.message === "Invalid pivot source range",
  );
  await assert.rejects(
    () => service.createPivotTable(WORKBOOK, { sourceWorksheetId: SHEET, range: "A1:ZZ99" }),
    (error) => error instanceof WorkbookError,
  );
  await assert.rejects(
    () => service.createPivotTable(WORKBOOK, { sourceWorksheetId: "ws-nope", range: REGION }),
    (error) => error instanceof WorkbookError && error.status === 404,
  );

  const workbook = await service.get(WORKBOOK);
  assert.deepEqual(workbook.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2"]);
  assert.equal(workbook.activeWorksheetId, SHEET);
});

test("REQ-5-3-1 applying to a worksheet without a pivot configuration is rejected", async (t) => {
  const { service } = await createService(t);
  await assert.rejects(
    () => service.applyPivotTable(WORKBOOK, SHEET, { rowField: "Region", valueField: "Sales" }),
    (error) => error instanceof WorkbookError,
  );
  await assert.rejects(
    () => service.refreshPivotTable(WORKBOOK, SHEET),
    (error) => error instanceof WorkbookError,
  );
});

test("REQ-5-3-1 exposes create, apply and refresh over HTTP", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-pivot-http-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = createWorkbookService({ filePath: join(directory, "workbooks.json") });
  const server = createServer(createRequestHandler({ service, staticRoot: directory }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return { status: response.status, body: await response.json() };
  };

  const created = await post(`/api/workbooks/${WORKBOOK}/pivots`, {
    sourceWorksheetId: SHEET,
    range: REGION,
  });
  assert.equal(created.status, 201);
  const pivot = created.body.workbook.worksheets.find((worksheet) => worksheet.pivot);
  assert.equal(pivot.name, "Pivot1");
  assert.equal(created.body.workbook.activeWorksheetId, pivot.id);

  const applied = await post(
    `/api/workbooks/${WORKBOOK}/worksheets/${pivot.id}/pivot`,
    { rowField: "Region", valueField: "Sales", summarizeBy: "SUM" },
  );
  assert.equal(applied.status, 200);
  const summary = applied.body.workbook.worksheets.find((worksheet) => worksheet.id === pivot.id);
  assert.equal(summary.cells.B5.value, "2700");

  const refreshed = await post(`/api/workbooks/${WORKBOOK}/worksheets/${pivot.id}/pivot/refresh`);
  assert.equal(refreshed.status, 200);
  assert.equal(
    refreshed.body.workbook.worksheets.find((worksheet) => worksheet.id === pivot.id).cells.B5.value,
    "2700",
  );

  const rejected = await post(
    `/api/workbooks/${WORKBOOK}/worksheets/${pivot.id}/pivot`,
    { rowField: "Region", valueField: "Region", summarizeBy: "AVERAGE" },
  );
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, PIVOT_VALUE_NUMERIC_MESSAGE);

  await post(`/api/workbooks/${WORKBOOK}/worksheets/${SHEET}/columns`, { action: "delete", index: 1 });
  const stale = await post(`/api/workbooks/${WORKBOOK}/worksheets/${pivot.id}/pivot/refresh`);
  assert.equal(stale.status, 400);
  assert.equal(stale.body.error, PIVOT_FIELD_MISSING_MESSAGE);

  const missing = await post(`/api/workbooks/${WORKBOOK}/worksheets/ws-nope/pivot/refresh`);
  assert.equal(missing.status, 404);
  const badSource = await post(`/api/workbooks/${WORKBOOK}/pivots`, {
    sourceWorksheetId: SHEET,
    range: "A1",
  });
  assert.equal(badSource.status, 400);
});
