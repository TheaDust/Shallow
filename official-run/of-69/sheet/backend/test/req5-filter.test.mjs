import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FILTER_RANGE_INVALID_MESSAGE, filterBounds, hiddenRowsOf } from "../src/lib/filter.mjs";
import { WorkbookError, createWorkbookService } from "../src/lib/workbooks.mjs";

const WORKBOOK = "wb-q3-sales";
const SHEET = "ws-q3-sales-sheet1";
/** The seeded data region: headers on row 1, records on rows 2-4. */
const REGION = "A1:C4";

async function createService(t) {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-filter-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "workbooks.json");
  return { directory, filePath, service: createWorkbookService({ filePath }) };
}

function sheetOf(workbook, index = 0) {
  return workbook.worksheets[index];
}

test("REQ-5-1-2 the evaluation seed carries the Region/Sales/Status records", async (t) => {
  const { service } = await createService(t);
  const workbook = await service.get(WORKBOOK);
  const sheet = sheetOf(workbook);

  assert.deepEqual(
    [sheet.cells.A1.value, sheet.cells.B1.value, sheet.cells.C1.value],
    ["Region", "Sales", "Status"],
  );
  assert.deepEqual(
    [sheet.cells.A2.value, sheet.cells.B2.value, sheet.cells.C2.value],
    ["East", "1200", "Open"],
  );
  assert.deepEqual(
    [sheet.cells.A3.value, sheet.cells.B3.value, sheet.cells.C3.value],
    ["North", "800", "Closed"],
  );
  assert.deepEqual(
    [sheet.cells.A4.value, sheet.cells.B4.value, sheet.cells.C4.value],
    ["South", "700", "Open"],
  );
  assert.equal(sheet.filter, undefined, "no filter view exists before one is created");
});

test("REQ-5-1-2 creating a filter over a region and hiding rows by value persists", async (t) => {
  const { filePath, service } = await createService(t);

  const created = await service.setFilter(WORKBOOK, SHEET, { range: REGION, rules: [] });
  assert.deepEqual(sheetOf(created).filter, { range: REGION, rules: [] });
  assert.deepEqual(hiddenRowsOf(sheetOf(created)), [], "an unfiltered region hides nothing");

  const filtered = await service.setFilter(WORKBOOK, SHEET, {
    range: REGION,
    rules: [{ column: 0, mode: "values", values: ["East", "South"] }],
  });
  const sheet = sheetOf(filtered);
  assert.deepEqual(hiddenRowsOf(sheet), [2], "the North record is hidden, not deleted");
  assert.equal(sheet.cells.A3.value, "North", "the hidden record keeps its values");
  assert.equal(sheet.cells.A2.value, "East");
  assert.equal(sheet.cells.A4.value, "South");

  // The view survives a reopen: the same records stay visible.
  const reopened = createWorkbookService({ filePath });
  const stored = sheetOf(await reopened.get(WORKBOOK));
  assert.deepEqual(stored.filter, {
    range: REGION,
    rules: [{ column: 0, mode: "values", values: ["East", "South"] }],
  });
  assert.deepEqual(hiddenRowsOf(stored), [2]);

  // CSV export still contains every record of the filtered range.
  const { csv } = await service.exportCsv(WORKBOOK, SHEET);
  assert.equal(csv, "Region,Sales,Status\nEast,1200,Open\nNorth,800,Closed\nSouth,700,Open");
});

test("REQ-5-1-2 condition rules narrow the region and combine with AND", async (t) => {
  const { service } = await createService(t);

  const contains = await service.setFilter(WORKBOOK, SHEET, {
    range: REGION,
    rules: [{ column: 0, mode: "condition", condition: "text-contains", value: "th" }],
  });
  assert.deepEqual(hiddenRowsOf(sheetOf(contains)), [1], "North and South contain 'th', East does not");

  const greater = await service.setFilter(WORKBOOK, SHEET, {
    range: REGION,
    rules: [{ column: 1, mode: "condition", condition: "greater-than", value: "750" }],
  });
  assert.deepEqual(hiddenRowsOf(sheetOf(greater)), [3], "only the 700 record stays below 750");

  const combined = await service.setFilter(WORKBOOK, SHEET, {
    range: REGION,
    rules: [
      { column: 1, mode: "condition", condition: "greater-than", value: "750" },
      { column: 2, mode: "condition", condition: "is-not-empty", value: "" },
    ],
  });
  assert.deepEqual(hiddenRowsOf(sheetOf(combined)), [3], "conditions on different columns are ANDed");

  const empty = await service.setFilter(WORKBOOK, SHEET, {
    range: REGION,
    rules: [{ column: 2, mode: "condition", condition: "is-empty", value: "" }],
  });
  assert.deepEqual(hiddenRowsOf(sheetOf(empty)), [1, 2, 3], "every Status cell is filled");

  const before = await service.setFilter(WORKBOOK, SHEET, {
    range: REGION,
    rules: [{ column: 2, mode: "condition", condition: "before", value: "2026-01-01" }],
  });
  assert.deepEqual(hiddenRowsOf(sheetOf(before)), [1, 2, 3], "no Status text parses as a date");

  const dates = await service.writeCells(WORKBOOK, SHEET, {
    updates: [
      { name: "C2", input: "2025-01-05" },
      { name: "C3", input: "2026-02-05" },
    ],
  });
  const dated = await service.setFilter(WORKBOOK, SHEET, {
    range: REGION,
    rules: [{ column: 2, mode: "condition", condition: "before", value: "2026-01-01" }],
  });
  assert.equal(sheetOf(dates).cells.C2.value, "2025-01-05");
  assert.deepEqual(hiddenRowsOf(sheetOf(dated)), [2, 3], "South is empty and North is later");
});

test("REQ-5-1-2 clearing the filter restores every source record in its original order", async (t) => {
  const { filePath, service } = await createService(t);

  await service.setFilter(WORKBOOK, SHEET, {
    range: REGION,
    rules: [{ column: 0, mode: "values", values: ["North"] }],
  });
  const cleared = await service.clearFilter(WORKBOOK, SHEET);
  const sheet = sheetOf(cleared);
  assert.equal(sheet.filter, undefined);
  assert.deepEqual(hiddenRowsOf(sheet), []);
  assert.deepEqual(
    [sheet.cells.A2.value, sheet.cells.A3.value, sheet.cells.A4.value],
    ["East", "North", "South"],
    "row order and values are untouched",
  );
  assert.equal(sheet.cells.B2.value, "1200");
  assert.equal(sheet.cells.B4.value, "700");

  const reopened = createWorkbookService({ filePath });
  assert.equal(sheetOf(await reopened.get(WORKBOOK)).filter, undefined);
});

test("REQ-5-1-2 rejects a filter region outside the worksheet without changing state", async (t) => {
  const { service } = await createService(t);
  await service.setFilter(WORKBOOK, SHEET, { range: REGION, rules: [] });

  await assert.rejects(
    () => service.setFilter(WORKBOOK, SHEET, { range: "not-a-range", rules: [] }),
    (error) => error instanceof WorkbookError && error.message === FILTER_RANGE_INVALID_MESSAGE,
  );
  await assert.rejects(
    () => service.setFilter(WORKBOOK, SHEET, { range: "A1:ZZ99", rules: [] }),
    (error) => error instanceof WorkbookError,
  );
  assert.deepEqual(sheetOf(await service.get(WORKBOOK)).filter, { range: REGION, rules: [] });

  // Unknown conditions and columns outside the region are dropped from the payload.
  const normalized = await service.setFilter(WORKBOOK, SHEET, {
    range: REGION,
    rules: [
      { column: 9, mode: "values", values: ["x"] },
      { column: 0, mode: "condition", condition: "nope", value: "x" },
      { column: 1, mode: "values", values: ["1200"] },
    ],
  });
  assert.deepEqual(sheetOf(normalized).filter, {
    range: REGION,
    rules: [{ column: 1, mode: "values", values: ["1200"] }],
  });
});

test("REQ-5-1-2 moves the filter region with inserted rows and columns", async (t) => {
  const { service } = await createService(t);
  await service.setFilter(WORKBOOK, SHEET, {
    range: REGION,
    rules: [{ column: 2, mode: "values", values: ["Open"] }],
  });

  const rowInserted = await service.structure(WORKBOOK, SHEET, {
    axis: "row",
    action: "insert-below",
    index: 1,
  });
  const afterRow = sheetOf(rowInserted);
  assert.equal(afterRow.filter.range, "A1:C5");
  assert.deepEqual(hiddenRowsOf(afterRow), [2, 3], "the inserted blank record is hidden");

  const columnInserted = await service.structure(WORKBOOK, SHEET, {
    axis: "column",
    action: "insert-left",
    index: 1,
  });
  const afterColumn = sheetOf(columnInserted);
  assert.equal(afterColumn.filter.range, "A1:D5");
  assert.deepEqual(afterColumn.filter.rules, [{ column: 3, mode: "values", values: ["Open"] }]);
  assert.deepEqual(hiddenRowsOf(afterColumn), [2, 3], "the Status rule follows its column");
});

test("REQ-5-1-2 parses a filter range symmetrically", () => {
  assert.deepEqual(filterBounds("C4:A1"), { top: 0, bottom: 3, left: 0, right: 2 });
  assert.equal(filterBounds("A1"), null);
  assert.equal(filterBounds(""), null);
});
