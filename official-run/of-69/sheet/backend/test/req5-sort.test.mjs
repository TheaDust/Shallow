import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/handler.mjs";
import { hiddenRowsOf } from "../src/lib/filter.mjs";
import {
  SORT_COLUMN_INVALID_MESSAGE,
  SORT_ORDER_INVALID_MESSAGE,
  SORT_RANGE_INVALID_MESSAGE,
  compareSortKeys,
  sortKey,
} from "../src/lib/sort.mjs";
import { WorkbookError, createWorkbookService } from "../src/lib/workbooks.mjs";

const WORKBOOK = "wb-q3-sales";
const SHEET = "ws-q3-sales-sheet1";
/** The seeded data region: headers on row 1, records on rows 2-4. */
const REGION = "A1:C4";

async function createService(t) {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-sort-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "workbooks.json");
  return { directory, filePath, service: createWorkbookService({ filePath }) };
}

function sheetOf(workbook, index = 0) {
  return workbook.worksheets[index];
}

test("REQ-5-1-1 sorts the selected range ascending by one column and persists", async (t) => {
  const { filePath, service } = await createService(t);

  const sorted = await service.sortRange(WORKBOOK, SHEET, {
    range: REGION,
    column: 1,
    order: "ascending",
    hasHeader: true,
  });
  const sheet = sheetOf(sorted);
  assert.deepEqual(
    [sheet.cells.A1.value, sheet.cells.B1.value, sheet.cells.C1.value],
    ["Region", "Sales", "Status"],
    "the header row does not participate",
  );
  assert.deepEqual(
    [sheet.cells.A2.value, sheet.cells.B2.value, sheet.cells.C2.value],
    ["South", "700", "Open"],
  );
  assert.deepEqual(
    [sheet.cells.A3.value, sheet.cells.B3.value, sheet.cells.C3.value],
    ["North", "800", "Closed"],
  );
  assert.deepEqual(
    [sheet.cells.A4.value, sheet.cells.B4.value, sheet.cells.C4.value],
    ["East", "1200", "Open"],
  );

  // The new order survives a reopen.
  const reopened = createWorkbookService({ filePath });
  const stored = sheetOf(await reopened.get(WORKBOOK));
  assert.deepEqual(
    [stored.cells.A2.value, stored.cells.A3.value, stored.cells.A4.value],
    ["South", "North", "East"],
  );
});

test("REQ-5-1-1 sorts descending and keeps equal keys in their original order", async (t) => {
  const { service } = await createService(t);

  const descending = await service.sortRange(WORKBOOK, SHEET, {
    range: REGION,
    column: 1,
    order: "descending",
    hasHeader: true,
  });
  assert.deepEqual(
    [2, 3, 4].map((row) => sheetOf(descending).cells[`B${row}`].value),
    ["1200", "800", "700"],
  );

  // The two Open statuses tie; East (row 2) keeps coming before South (row 4).
  const byStatus = await service.sortRange(WORKBOOK, SHEET, {
    range: REGION,
    column: 2,
    order: "ascending",
    hasHeader: true,
  });
  assert.deepEqual(
    [2, 3, 4].map((row) => sheetOf(byStatus).cells[`A${row}`].value),
    ["North", "East", "South"],
  );
});

test("REQ-5-1-1 compares numbers, dates and text by their own types", async (t) => {
  const { service } = await createService(t);
  await service.writeCells(WORKBOOK, SHEET, {
    updates: [
      { name: "C2", input: "2026-03-01" },
      { name: "C3", input: "2025-01-01" },
      { name: "C4", input: "2024-06-01" },
    ],
  });

  const byDate = await service.sortRange(WORKBOOK, SHEET, {
    range: REGION,
    column: 2,
    order: "ascending",
    hasHeader: true,
  });
  assert.deepEqual(
    [2, 3, 4].map((row) => sheetOf(byDate).cells[`C${row}`].value),
    ["2024-06-01", "2025-01-01", "2026-03-01"],
    "parseable dates compare chronologically, not as text",
  );

  // Numbers (10) sort before parseable dates, which sort before plain text.
  assert.equal(sortKey("10").rank, 0);
  assert.equal(sortKey("2025-01-01").rank, 1);
  assert.equal(sortKey("Region").rank, 2);
  assert.equal(compareSortKeys(sortKey("9"), sortKey("10")), -1, "numbers compare numerically");
});

test("REQ-5-1-1 moves whole records, translates moved formulas and leaves outside data alone", async (t) => {
  const { service } = await createService(t);
  await service.writeCells(WORKBOOK, SHEET, {
    updates: [
      { name: "D2", input: "=B2*2" },
      { name: "D3", input: "=B3*2" },
      { name: "D4", input: "=B4*2" },
      { name: "F1", input: "untouched" },
    ],
  });

  const sorted = await service.sortRange(WORKBOOK, SHEET, {
    range: "A1:D4",
    column: 1,
    order: "ascending",
    hasHeader: true,
  });
  const sheet = sheetOf(sorted);
  // South (row 4) moves to row 2, taking its formula and translating `=B4*2` to `=B2*2`.
  assert.equal(sheet.cells.A2.value, "South");
  assert.equal(sheet.cells.D2.formula, "=B2*2");
  assert.equal(sheet.cells.D2.value, "1400");
  assert.equal(sheet.cells.D3.formula, "=B3*2");
  assert.equal(sheet.cells.D3.value, "1600");
  assert.equal(sheet.cells.D4.formula, "=B4*2");
  assert.equal(sheet.cells.D4.value, "2400");
  assert.equal(sheet.cells.F1.value, "untouched", "data outside the selection is unchanged");
});

test("REQ-5-1-1 keeps the filter and validation rules on the same range", async (t) => {
  const { service } = await createService(t);
  await service.setFilter(WORKBOOK, SHEET, {
    range: REGION,
    rules: [{ column: 1, mode: "condition", condition: "greater-than", value: "750" }],
  });
  await service.setValidation(WORKBOOK, SHEET, { range: "B2:B4", type: "number", min: 0, max: 2000 });

  const sorted = await service.sortRange(WORKBOOK, SHEET, {
    range: REGION,
    column: 1,
    order: "ascending",
    hasHeader: true,
  });
  const sheet = sheetOf(sorted);
  assert.deepEqual(sheet.filter, {
    range: REGION,
    rules: [{ column: 1, mode: "condition", condition: "greater-than", value: "750" }],
  });
  assert.deepEqual(sheet.validations, [{ range: "B2:B4", type: "number", min: 0, max: 2000 }]);
  assert.deepEqual(hiddenRowsOf(sheet), [1], "the 700 record is still the one hidden by the filter");

  const accepted = await service.writeCells(WORKBOOK, SHEET, { updates: [{ name: "B2", input: "900" }] });
  assert.equal(sheetOf(accepted).cells.B2.value, "900", "validation still applies after the sort");
  await assert.rejects(
    () => service.writeCells(WORKBOOK, SHEET, { updates: [{ name: "B2", input: "5000" }] }),
    (error) => error instanceof WorkbookError && error.message === "Please enter a number between 0 and 2000",
  );
});

test("REQ-5-1-1 sorts the first row too when it is not a header row", async (t) => {
  const { service } = await createService(t);
  const sorted = await service.sortRange(WORKBOOK, SHEET, {
    range: REGION,
    column: 1,
    order: "ascending",
    hasHeader: false,
  });
  const sheet = sheetOf(sorted);
  assert.deepEqual(
    [1, 2, 3, 4].map((row) => sheet.cells[`B${row}`]?.value),
    ["700", "800", "1200", "Sales"],
    "every row of the range takes part and text keys sort after numbers",
  );
});

test("REQ-5-1-1 rejects invalid payloads without changing the stored order", async (t) => {
  const { service } = await createService(t);

  await assert.rejects(
    () => service.sortRange(WORKBOOK, SHEET, { range: "nope", column: 1, order: "ascending" }),
    (error) => error instanceof WorkbookError && error.message === SORT_RANGE_INVALID_MESSAGE,
  );
  await assert.rejects(
    () => service.sortRange(WORKBOOK, SHEET, { range: REGION, column: 9, order: "ascending" }),
    (error) => error instanceof WorkbookError && error.message === SORT_COLUMN_INVALID_MESSAGE,
  );
  await assert.rejects(
    () => service.sortRange(WORKBOOK, SHEET, { range: REGION, column: 1, order: "sideways" }),
    (error) => error instanceof WorkbookError && error.message === SORT_ORDER_INVALID_MESSAGE,
  );
  await assert.rejects(
    () => service.sortRange(WORKBOOK, SHEET, { range: "A1:ZZ99", column: 1, order: "ascending" }),
    (error) => error instanceof WorkbookError,
  );

  const sheet = sheetOf(await service.get(WORKBOOK));
  assert.deepEqual(
    [2, 3, 4].map((row) => sheet.cells[`A${row}`].value),
    ["East", "North", "South"],
    "the grid keeps its original order",
  );
});

test("REQ-5-1-1 sorts over HTTP and reports the persisted order", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-sort-http-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = createWorkbookService({ filePath: join(directory, "workbooks.json") });
  const server = createServer(createRequestHandler({ service, staticRoot: directory }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${base}/api/workbooks/${WORKBOOK}/worksheets/${SHEET}/sort`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ range: REGION, column: 1, order: "ascending", hasHeader: true }),
  });
  assert.equal(response.status, 200);
  const { workbook } = await response.json();
  assert.deepEqual(
    [2, 3, 4].map((row) => workbook.worksheets[0].cells[`A${row}`].value),
    ["South", "North", "East"],
  );

  const stored = await (await fetch(`${base}/api/workbooks/${WORKBOOK}`)).json();
  assert.equal(stored.workbook.worksheets[0].cells.A2.value, "South");
});
