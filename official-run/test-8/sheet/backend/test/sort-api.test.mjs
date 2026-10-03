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
const SHEET_2 = "workbook-q3-sales-sheet-2";

/** Starts the app over a temporary store, optionally pre-seeded with cells. */
async function startApp(prepare) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-sort-"));
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
    base,
    async call(path, init) {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      return { status: response.status, body };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function sortPath(worksheetId = SHEET_1) {
  return `/api/workbooks/${WORKBOOK_ID}/worksheets/${worksheetId}/sort`;
}

function cellsPath(worksheetId = SHEET_1) {
  return `/api/workbooks/${WORKBOOK_ID}/worksheets/${worksheetId}/cells`;
}

function validationsPath(worksheetId = SHEET_1) {
  return `/api/workbooks/${WORKBOOK_ID}/worksheets/${worksheetId}/validations`;
}

function filterPath(worksheetId = SHEET_1) {
  return `/api/workbooks/${WORKBOOK_ID}/worksheets/${worksheetId}/filter`;
}

async function readWorksheet(app, worksheetId = SHEET_1) {
  const detail = await app.call(`/api/workbooks/${WORKBOOK_ID}`);
  return detail.body.workbook.worksheets.find((entry) => entry.id === worksheetId);
}

/** The seeded A1:C4 block: headers plus East/1200/Open, North/800/Closed, South/700/Open. */
const SEED_RANGE = { minRow: 0, maxRow: 3, minCol: 0, maxCol: 2 };

/** Replaces the seeded cells of Sheet1 with a custom table. */
function withCells(cells) {
  return (state) => {
    state.workbooks[0].worksheets[0].cells = cells;
    return state;
  };
}

test("sorts the selected range by a column and keeps the result in the store", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const sorted = await app.call(sortPath(), {
    method: "POST",
    body: JSON.stringify({ range: SEED_RANGE, col: 1, order: "ascending", hasHeaderRow: true }),
  });
  assert.equal(sorted.status, 200);
  // The header row stays on top and every record keeps its own values.
  assert.deepEqual(sorted.body.worksheet.cells, {
    A1: "Region",
    B1: "Sales",
    C1: "Status",
    A2: "South",
    B2: "700",
    C2: "Open",
    A3: "North",
    B3: "800",
    C3: "Closed",
    A4: "East",
    B4: "1200",
    C4: "Open",
  });

  // Reopening the workbook from the store returns the same order.
  const reopened = await readWorksheet(app);
  assert.deepEqual(reopened.cells, sorted.body.worksheet.cells);
  // The other worksheet never took part.
  assert.deepEqual((await readWorksheet(app, SHEET_2)).cells, {});

  // Descending brings the same records back in the opposite order.
  const descending = await app.call(sortPath(), {
    method: "POST",
    body: JSON.stringify({ range: SEED_RANGE, col: 1, order: "descending", hasHeaderRow: true }),
  });
  assert.equal(descending.status, 200);
  assert.deepEqual(
    ["A2", "A3", "A4"].map((key) => descending.body.worksheet.cells[key]),
    ["East", "North", "South"],
  );
});

test("sorts only the selected rectangle", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  // The first row is data here, so it takes part in the sort: the numbers come
  // first, the text key (`Sales`) last.
  const sorted = await app.call(sortPath(), {
    method: "POST",
    body: JSON.stringify({
      range: { minRow: 0, maxRow: 3, minCol: 1, maxCol: 1 },
      col: 1,
      order: "ascending",
      hasHeaderRow: false,
    }),
  });
  assert.equal(sorted.status, 200);
  assert.deepEqual(
    ["B1", "B2", "B3", "B4"].map((key) => sorted.body.worksheet.cells[key]),
    ["700", "800", "1200", "Sales"],
  );
  // Column A sits outside the selection and keeps every value in place.
  assert.deepEqual(
    ["A1", "A2", "A3", "A4"].map((key) => sorted.body.worksheet.cells[key]),
    ["Region", "East", "North", "South"],
  );
});

test("compares numbers, dates and text by type and keeps equal keys stable", async (t) => {
  const app = await startApp(
    withCells({
      A1: "Key",
      B1: "Record",
      A2: "banana",
      B2: "r1",
      A3: "10",
      B3: "r2",
      A4: "2",
      B4: "r3",
      A5: "2024-01-05",
      B5: "r4",
      A6: "apple",
      B6: "r5",
      A7: "2024-01-01",
      B7: "r6",
      A8: "2",
      B8: "r7",
    }),
  );
  t.after(() => app.close());

  const range = { minRow: 0, maxRow: 7, minCol: 0, maxCol: 1 };
  const ascending = await app.call(sortPath(), {
    method: "POST",
    body: JSON.stringify({ range, col: 0, order: "ascending", hasHeaderRow: true }),
  });
  assert.equal(ascending.status, 200);
  const cells = ascending.body.worksheet.cells;
  // Numbers (2 before 2, then 10), then dates, then text; the two equal keys
  // keep the relative order they had before the sort.
  assert.deepEqual(
    ["A2", "A3", "A4", "A5", "A6", "A7", "A8"].map((key) => cells[key]),
    ["2", "2", "10", "2024-01-01", "2024-01-05", "apple", "banana"],
  );
  assert.deepEqual(
    ["B2", "B3", "B4", "B5", "B6", "B7", "B8"].map((key) => cells[key]),
    ["r3", "r7", "r2", "r6", "r4", "r5", "r1"],
  );
  assert.equal(cells.A1, "Key");
  assert.equal(cells.B1, "Record");

  const descending = await app.call(sortPath(), {
    method: "POST",
    body: JSON.stringify({ range, col: 0, order: "descending", hasHeaderRow: true }),
  });
  assert.equal(descending.status, 200);
  assert.deepEqual(
    ["A2", "A3", "A4", "A5", "A6", "A7", "A8"].map((key) => descending.body.worksheet.cells[key]),
    ["banana", "apple", "2024-01-05", "2024-01-01", "10", "2", "2"],
  );
  assert.deepEqual(
    ["B2", "B3", "B4", "B5", "B6", "B7", "B8"].map((key) => descending.body.worksheet.cells[key]),
    ["r1", "r5", "r4", "r6", "r2", "r3", "r7"],
  );
});

test("keeps the references of a moved formula pointing at the same records", async (t) => {
  const app = await startApp(
    withCells({
      A1: "Region",
      B1: "Sales",
      C1: "Computed",
      D1: "Helper",
      A2: "East",
      B2: "1200",
      C2: "=B2*2",
      A3: "North",
      B3: "800",
      C3: "=B3*2",
      A4: "South",
      B4: "700",
      C4: "=D2+B4",
      D2: "5",
    }),
  );
  t.after(() => app.close());

  const sorted = await app.call(sortPath(), {
    method: "POST",
    body: JSON.stringify({ range: SEED_RANGE, col: 1, order: "ascending", hasHeaderRow: true }),
  });
  assert.equal(sorted.status, 200);
  const cells = sorted.body.worksheet.cells;
  // South moved to row 2: its `=D2+B4` follows the moved row, while the `D2`
  // reference to a column outside the selection stays where it was.
  assert.equal(cells.C2, "=D2+B2");
  assert.equal(cells.C3, "=B3*2");
  assert.equal(cells.C4, "=B4*2");
  assert.equal(cells.D2, "5");
  assert.equal(cells.A2, "South");
  assert.equal(cells.B4, "1200");
});

test("keeps the filter and the validation rules of the same range active after a sort", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  await app.call(filterPath(), {
    method: "POST",
    body: JSON.stringify({
      filter: { range: SEED_RANGE, columns: [{ col: 0, kind: "values", values: ["East", "South"] }] },
    }),
  });
  const ruleRange = { minRow: 1, maxRow: 3, minCol: 1, maxCol: 1 };
  await app.call(validationsPath(), {
    method: "POST",
    body: JSON.stringify({
      action: "save",
      rule: { type: "numeric", min: 0, max: 100, range: ruleRange, style: "between" },
    }),
  });

  const sorted = await app.call(sortPath(), {
    method: "POST",
    body: JSON.stringify({ range: SEED_RANGE, col: 1, order: "ascending", hasHeaderRow: true }),
  });
  assert.equal(sorted.status, 200);
  // Sorting reorders records only: the filter and the rule still cover exactly
  // the range the user selected.
  assert.deepEqual(sorted.body.worksheet.filter.range, SEED_RANGE);
  assert.deepEqual(sorted.body.worksheet.filter.columns, [
    { col: 0, kind: "values", values: ["East", "South"] },
  ]);
  assert.deepEqual(sorted.body.worksheet.validations[0].range, ruleRange);

  // The rule still rejects a value outside 0..100 at the same coordinate, and
  // the sort stays in place.
  const rejected = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 2, col: 1 }, values: [["101"]] }),
  });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error, "Please enter a number between 0 and 100");
  const kept = await readWorksheet(app);
  assert.equal(kept.cells.A4, "East");
  assert.equal(kept.cells.B4, "1200");
});

test("rejects a sort that cannot be applied and keeps the stored order", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const outside = await app.call(sortPath(), {
    method: "POST",
    body: JSON.stringify({
      range: { minRow: 0, maxRow: 99, minCol: 0, maxCol: 2 },
      col: 1,
      order: "ascending",
      hasHeaderRow: true,
    }),
  });
  assert.equal(outside.status, 422);
  assert.equal(outside.body.error, "Invalid sort range");

  const wrongColumn = await app.call(sortPath(), {
    method: "POST",
    body: JSON.stringify({ range: SEED_RANGE, col: 5, order: "ascending", hasHeaderRow: true }),
  });
  assert.equal(wrongColumn.status, 422);
  assert.equal(wrongColumn.body.error, "The sort column is outside the selected range");

  const wrongOrder = await app.call(sortPath(), {
    method: "POST",
    body: JSON.stringify({ range: SEED_RANGE, col: 1, order: "sideways", hasHeaderRow: true }),
  });
  assert.equal(wrongOrder.status, 422);
  assert.equal(wrongOrder.body.error, "Unknown sort order");

  const wrongMethod = await app.call(sortPath());
  assert.equal(wrongMethod.status, 405);

  // Every rejection left the seeded order exactly as it was.
  const kept = await readWorksheet(app);
  assert.deepEqual(
    ["A2", "A3", "A4"].map((key) => kept.cells[key]),
    ["East", "North", "South"],
  );

  const missing = await app.call(sortPath("missing-sheet"), {
    method: "POST",
    body: JSON.stringify({ range: SEED_RANGE, col: 1, order: "ascending", hasHeaderRow: true }),
  });
  assert.equal(missing.status, 404);
});
