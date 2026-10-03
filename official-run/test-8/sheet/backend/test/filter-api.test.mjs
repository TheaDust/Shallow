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

/** Starts the app over a temporary store, optionally pre-seeded with rules. */
async function startApp(prepare) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-filter-"));
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

function filterPath(worksheetId = SHEET_1) {
  return `/api/workbooks/${WORKBOOK_ID}/worksheets/${worksheetId}/filter`;
}

function validationsPath(worksheetId = SHEET_1) {
  return `/api/workbooks/${WORKBOOK_ID}/worksheets/${worksheetId}/validations`;
}

function cellsPath(worksheetId = SHEET_1) {
  return `/api/workbooks/${WORKBOOK_ID}/worksheets/${worksheetId}/cells`;
}

async function readWorksheet(app, worksheetId = SHEET_1) {
  const detail = await app.call(`/api/workbooks/${WORKBOOK_ID}`);
  return detail.body.workbook.worksheets.find((entry) => entry.id === worksheetId);
}

const SEED_RANGE = { minRow: 0, maxRow: 3, minCol: 0, maxCol: 2 };

test("stores a filter for one worksheet and keeps the other worksheets untouched", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const saved = await app.call(filterPath(), {
    method: "POST",
    body: JSON.stringify({
      filter: { range: SEED_RANGE, columns: [{ col: 0, kind: "values", values: ["East", "South"] }] },
    }),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.worksheet.filter, {
    range: SEED_RANGE,
    columns: [{ col: 0, kind: "values", values: ["East", "South"] }],
  });

  // The filter is a view over the data: no cell was removed or reordered.
  assert.deepEqual(saved.body.worksheet.cells, {
    A1: "Region",
    B1: "Sales",
    C1: "Status",
    A2: "East",
    B2: "1200",
    C2: "Open",
    A3: "North",
    B3: "800",
    C3: "Closed",
    A4: "South",
    B4: "700",
    C4: "Open",
  });

  // Reopening the workbook (a fresh read of the store) returns the same filter.
  const reopened = await readWorksheet(app);
  assert.deepEqual(reopened.filter, saved.body.worksheet.filter);

  const other = await readWorksheet(app, SHEET_2);
  assert.equal(other.filter, null);
});

test("clears a filter and rejects a region outside the grid", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  await app.call(filterPath(), {
    method: "POST",
    body: JSON.stringify({
      filter: { range: SEED_RANGE, columns: [{ col: 1, kind: "condition", operator: "greaterThan", value: "1000" }] },
    }),
  });

  const rejected = await app.call(filterPath(), {
    method: "POST",
    body: JSON.stringify({
      filter: { range: { minRow: 0, maxRow: 99, minCol: 0, maxCol: 2 }, columns: [] },
    }),
  });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error, "Invalid filter range");

  const malformed = await app.call(filterPath(), {
    method: "POST",
    body: JSON.stringify({
      filter: { range: SEED_RANGE, columns: [{ col: 0, kind: "condition", operator: "matches", value: "x" }] },
    }),
  });
  assert.equal(malformed.status, 422);
  assert.equal(malformed.body.error, "Invalid filter");
  const kept = await readWorksheet(app);
  assert.equal(kept.filter.columns[0].operator, "greaterThan");

  const cleared = await app.call(filterPath(), {
    method: "POST",
    body: JSON.stringify({ filter: null }),
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.worksheet.filter, null);
  assert.equal((await readWorksheet(app)).filter, null);
});

test("moves a filter region and its columns with row and column changes", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  await app.call(filterPath(), {
    method: "POST",
    body: JSON.stringify({
      filter: { range: SEED_RANGE, columns: [{ col: 1, kind: "values", values: ["800"] }] },
    }),
  });

  const inserted = await app.call(`/api/workbooks/${WORKBOOK_ID}/worksheets/${SHEET_1}/structure`, {
    method: "POST",
    body: JSON.stringify({ operation: "insertColumnLeft", index: 0 }),
  });
  assert.equal(inserted.status, 200);
  assert.deepEqual(inserted.body.worksheet.filter, {
    range: { minRow: 0, maxRow: 3, minCol: 1, maxCol: 3 },
    columns: [{ col: 2, kind: "values", values: ["800"] }],
  });

  const deleted = await app.call(`/api/workbooks/${WORKBOOK_ID}/worksheets/${SHEET_1}/structure`, {
    method: "POST",
    body: JSON.stringify({ operation: "deleteColumn", index: 2 }),
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body.worksheet.filter, {
    range: { minRow: 0, maxRow: 3, minCol: 1, maxCol: 2 },
    columns: [],
  });
});

test("saves a dropdown rule that trims its values and rejects other input", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const saved = await app.call(validationsPath(), {
    method: "POST",
    body: JSON.stringify({
      action: "save",
      rule: {
        type: "dropdown",
        values: [" East ", "North", "", "South "],
        range: { minRow: 1, maxRow: 3, minCol: 0, maxCol: 0 },
      },
    }),
  });
  assert.equal(saved.status, 200);
  const rule = saved.body.worksheet.validations[0];
  assert.equal(rule.type, "dropdown");
  assert.deepEqual(rule.values, ["East", "North", "South"]);
  assert.equal(typeof rule.id, "string");

  const rejected = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 1, col: 0 }, values: [["West"]] }),
  });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error, "Please select one of the following values: East, North, South");
  assert.equal((await readWorksheet(app)).cells.A2, "East");

  const accepted = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 2, col: 0 }, values: [["South"]] }),
  });
  assert.equal(accepted.status, 200);
  assert.equal((await readWorksheet(app)).cells.A3, "South");

  const empty = await app.call(validationsPath(), {
    method: "POST",
    body: JSON.stringify({
      action: "save",
      rule: { type: "dropdown", values: ["  ", ""], range: { minRow: 1, maxRow: 3, minCol: 0, maxCol: 0 } },
    }),
  });
  assert.equal(empty.status, 422);
  assert.equal(empty.body.error, "Enter at least one allowed value");
});

test("saves an inclusive number range rule with the dialog wording and deletes it again", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const saved = await app.call(validationsPath(), {
    method: "POST",
    body: JSON.stringify({
      action: "save",
      rule: { type: "numeric", min: 0, max: 100, range: { minRow: 1, maxRow: 3, minCol: 1, maxCol: 1 }, style: "between" },
    }),
  });
  assert.equal(saved.status, 200);
  const ruleId = saved.body.worksheet.validations[0].id;

  const boundary = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 1, col: 1 }, values: [["100"]] }),
  });
  assert.equal(boundary.status, 200);

  const rejected = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 2, col: 1 }, values: [["101"]] }),
  });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error, "Please enter a number between 0 and 100");
  assert.equal((await readWorksheet(app)).cells.B3, "800");

  const deleted = await app.call(validationsPath(), {
    method: "POST",
    body: JSON.stringify({ action: "delete", id: ruleId }),
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body.worksheet.validations, []);
  // Existing values survive both the rule and its removal.
  assert.equal(deleted.body.worksheet.cells.B2, "100");

  const nowAccepted = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 2, col: 1 }, values: [["101"]] }),
  });
  assert.equal(nowAccepted.status, 200);

  const unknown = await app.call(validationsPath(), {
    method: "POST",
    body: JSON.stringify({ action: "delete", id: "missing-rule" }),
  });
  assert.equal(unknown.status, 404);
});

test("keeps the historical wording of a numeric rule stored without a style", async (t) => {
  const app = await startApp((state) => {
    state.workbooks[0].worksheets[0].validations = [
      { id: "rule-1", type: "numeric", min: 0, max: 100, range: { minRow: 2, maxRow: 2, minCol: 1, maxCol: 1 } },
    ];
    return state;
  });
  t.after(() => app.close());

  const rejected = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 2, col: 1 }, values: [["101"]] }),
  });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error, "Please enter a number from 0 to 100");
});

test("re-saving the same rectangle replaces the rule instead of stacking one", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const range = { minRow: 1, maxRow: 3, minCol: 1, maxCol: 1 };
  await app.call(validationsPath(), {
    method: "POST",
    body: JSON.stringify({ action: "save", rule: { type: "numeric", min: 0, max: 10, range } }),
  });
  const updated = await app.call(validationsPath(), {
    method: "POST",
    body: JSON.stringify({ action: "save", rule: { type: "numeric", min: 0, max: 500, range } }),
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.worksheet.validations.length, 1);
  assert.equal(updated.body.worksheet.validations[0].max, 500);

  const accepted = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 2, col: 1 }, values: [["450"]] }),
  });
  assert.equal(accepted.status, 200);
});

test("rejects a rule whose rectangle is outside the grid", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const rejected = await app.call(validationsPath(), {
    method: "POST",
    body: JSON.stringify({
      action: "save",
      rule: { type: "numeric", min: 0, max: 10, range: { minRow: 0, maxRow: 500, minCol: 0, maxCol: 0 } },
    }),
  });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error, "Invalid validation rule");
  assert.deepEqual((await readWorksheet(app)).validations, []);

  const unknownAction = await app.call(validationsPath(), {
    method: "POST",
    body: JSON.stringify({ action: "reset" }),
  });
  assert.equal(unknownAction.status, 400);
});
