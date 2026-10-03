import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { seedState } from "../src/domain/workbook-model.mjs";

const SEED_WORKBOOK_ID = "workbook-q3-sales";
const SHEET_1 = "workbook-q3-sales-sheet-1";

/** Starts the app over a temporary store, optionally pre-seeded with rules. */
async function startApp(prepare) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-cells-"));
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

function cellsPath(worksheetId = SHEET_1) {
  return `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${worksheetId}/cells`;
}

async function readWorksheet(app, worksheetId = SHEET_1) {
  const detail = await app.call(`/api/workbooks/${SEED_WORKBOOK_ID}`);
  return detail.body.workbook.worksheets.find((entry) => entry.id === worksheetId);
}

test("writes one cell and keeps the seeded range untouched", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const written = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 0, col: 3 }, values: [["East"]] }),
  });
  assert.equal(written.status, 200);
  assert.equal(written.body.worksheet.cells.D1, "East");
  assert.equal(written.body.worksheet.cells.A1, "Region");
  assert.equal(written.body.worksheet.cells.B2, "1200");

  const persisted = await readWorksheet(app);
  assert.equal(persisted.cells.D1, "East");
  assert.equal(persisted.cells.A1, "Region");
});

test("writes a whole rectangle, keeps empty fields and overwrites only the target", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  // D1:E2 currently holds nothing; F1 is outside the rectangle and must stay.
  await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 0, col: 5 }, values: [["keep"]] }),
  });

  const written = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({
      start: { row: 0, col: 3 },
      values: [
        ["East", "1200"],
        ["North", "800"],
      ],
    }),
  });
  assert.equal(written.status, 200);
  const cells = written.body.worksheet.cells;
  assert.equal(cells.D1, "East");
  assert.equal(cells.E1, "1200");
  assert.equal(cells.D2, "North");
  assert.equal(cells.E2, "800");
  assert.equal(cells.F1, "keep");
  assert.equal(cells.A3, "North");

  const persisted = await readWorksheet(app);
  assert.equal(persisted.cells.E2, "800");
});

test("clears a cell with an empty value and persists the removal", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const cleared = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 1, col: 1 }, values: [[""]] }),
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.worksheet.cells.B2, undefined);
  assert.equal(cleared.body.worksheet.cells.A2, "East");

  const persisted = await readWorksheet(app);
  assert.equal(persisted.cells.B2, undefined);
});

test("stores an original formula as raw text", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const written = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 0, col: 3 }, values: [["=B2+B3"]] }),
  });
  assert.equal(written.status, 200);
  assert.equal(written.body.worksheet.cells.D1, "=B2+B3");

  const persisted = await readWorksheet(app);
  assert.equal(persisted.cells.D1, "=B2+B3");
});

test("persists a rectangular selection with both corners", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const saved = await app.call(`/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SHEET_1}`, {
    method: "PATCH",
    body: JSON.stringify({ selection: { anchor: { row: 0, col: 3 }, focus: { row: 1, col: 4 } } }),
  });
  assert.equal(saved.status, 200);

  const persisted = await readWorksheet(app);
  assert.deepEqual(persisted.selection, { anchor: { row: 0, col: 3 }, focus: { row: 1, col: 4 } });
});

test("rejects invalid payloads without changing the worksheet", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const outside = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 99, col: 0 }, values: [["x"]] }),
  });
  assert.equal(outside.status, 400);
  assert.equal(outside.body.error, "Invalid start cell");

  const malformed = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 0, col: 3 }, values: [] }),
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error, "Invalid cell values");

  const persisted = await readWorksheet(app);
  assert.deepEqual(persisted.cells.D1, undefined);
});

test("grows the grid so a paste beyond the current bounds is never truncated", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const rows = Array.from({ length: 3 }, (_, index) => [`r${index}`, `c${index}`]);
  const written = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 0, col: 25 }, values: rows }),
  });
  assert.equal(written.status, 200);
  assert.equal(written.body.worksheet.columnCount, 27);
  assert.equal(written.body.worksheet.cells.Z1, "r0");
  assert.equal(written.body.worksheet.cells.AA3, "c2");
});

test("rejects a rectangle that would grow the grid past its maximum", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const values = Array.from({ length: 1001 }, (_, index) => [`r${index}`]);
  const rejected = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 0, col: 0 }, values }),
  });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error, "The pasted data does not fit in the worksheet");

  const persisted = await readWorksheet(app);
  assert.equal(persisted.cells.A1, "Region");
  assert.equal(persisted.rowCount, 50);
});

test("rejects the whole write when a numeric validation rule covers a target cell", async (t) => {
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

  const inside = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 2, col: 1 }, values: [["100"]] }),
  });
  assert.equal(inside.status, 200);
  assert.equal(inside.body.worksheet.cells.B3, "100");

  // The rejected value left no partial state anywhere in the rectangle.
  const bulk = await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({
      start: { row: 2, col: 0 },
      values: [["West", "101"]],
    }),
  });
  assert.equal(bulk.status, 422);
  const persisted = await readWorksheet(app);
  assert.equal(persisted.cells.A3, "North");
  assert.equal(persisted.cells.B3, "100");
});

test("moves a validation rule with the cells it constrains", async (t) => {
  const app = await startApp((state) => {
    state.workbooks[0].worksheets[0].validations = [
      { id: "rule-1", type: "numeric", min: 0, max: 100, range: { minRow: 1, maxRow: 2, minCol: 0, maxCol: 0 } },
    ];
    return state;
  });
  t.after(() => app.close());

  const inserted = await app.call(
    `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SHEET_1}/structure`,
    { method: "POST", body: JSON.stringify({ operation: "insertRowAbove", index: 0 }) },
  );
  assert.equal(inserted.status, 200);
  assert.deepEqual(inserted.body.worksheet.validations[0].range, {
    minRow: 2,
    maxRow: 3,
    minCol: 0,
    maxCol: 0,
  });
});
