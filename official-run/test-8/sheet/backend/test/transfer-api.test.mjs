import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { seedState } from "../src/domain/workbook-model.mjs";
import { shiftFormulaByOffset } from "../src/domain/formula.mjs";

const SEED_WORKBOOK_ID = "workbook-q3-sales";
const SHEET_1 = "workbook-q3-sales-sheet-1";
const GRID = { rowCount: 50, columnCount: 26 };

/** Starts the app over a temporary store, optionally pre-seeded with rules. */
async function startApp(prepare) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-transfer-"));
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
  return {
    dataDir,
    base: `http://127.0.0.1:${port}`,
    async call(path, init) {
      const response = await fetch(`${this.base}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function transferPath(worksheetId = SHEET_1) {
  return `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${worksheetId}/transfer`;
}

function cellsPath(worksheetId = SHEET_1) {
  return `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${worksheetId}/cells`;
}

/** A rectangular selection from two A1-style corners. */
function range(from, to) {
  const parse = (label) => {
    const match = /^([A-Z]+)([0-9]+)$/.exec(label);
    const col = [...match[1]].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
    return { row: Number(match[2]) - 1, col };
  };
  return { anchor: parse(from), focus: parse(to) };
}

async function transfer(app, source, target, mode) {
  return app.call(transferPath(), {
    method: "POST",
    body: JSON.stringify({ source, target, mode }),
  });
}

async function readWorksheet(app, worksheetId = SHEET_1) {
  const detail = await app.call(`/api/workbooks/${SEED_WORKBOOK_ID}`);
  return detail.body.workbook.worksheets.find((entry) => entry.id === worksheetId);
}

test("copies a range to a target location and leaves the source untouched", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const copied = await transfer(app, range("A1", "B2"), range("D1", "E2"), "copy");
  assert.equal(copied.status, 200);
  const cells = copied.body.worksheet.cells;
  assert.equal(cells.D1, "Region");
  assert.equal(cells.E1, "Sales");
  assert.equal(cells.D2, "East");
  assert.equal(cells.E2, "1200");
  // The source keeps its values and cells outside both ranges are untouched.
  assert.equal(cells.A1, "Region");
  assert.equal(cells.B2, "1200");
  assert.equal(cells.C1, "Status");
  assert.equal(cells.A3, "North");
  assert.equal(cells.F1, undefined);

  const persisted = await readWorksheet(app);
  assert.equal(persisted.cells.E2, "1200");
  assert.equal(persisted.cells.A1, "Region");
});

test("pastes the same copied range more than once", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  await transfer(app, range("A2", "B3"), range("D1", "E2"), "copy");
  await transfer(app, range("A2", "B3"), range("D4", "E5"), "copy");

  const persisted = await readWorksheet(app);
  assert.equal(persisted.cells.D1, "East");
  assert.equal(persisted.cells.E2, "800");
  assert.equal(persisted.cells.D4, "East");
  assert.equal(persisted.cells.E5, "800");
  assert.equal(persisted.cells.A2, "East");
  assert.equal(persisted.cells.B3, "800");
});

test("clears the cut source only after the target holds the moved values", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const moved = await transfer(app, range("A1", "B2"), range("D1", "E2"), "cut");
  assert.equal(moved.status, 200);
  const cells = moved.body.worksheet.cells;
  assert.equal(cells.D1, "Region");
  assert.equal(cells.E1, "Sales");
  assert.equal(cells.D2, "East");
  assert.equal(cells.E2, "1200");
  assert.equal(cells.A1, undefined);
  assert.equal(cells.B1, undefined);
  assert.equal(cells.A2, undefined);
  assert.equal(cells.B2, undefined);
  assert.equal(cells.C1, "Status");

  const persisted = await readWorksheet(app);
  assert.equal(persisted.cells.A1, undefined);
  assert.equal(persisted.cells.D1, "Region");
});

test("moves relative references by the target offset and keeps absolute ones", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 0, col: 5 }, values: [["=D1+$E$1+SUM($D$1:E2)"]] }),
  });

  const copied = await transfer(app, range("F1", "F1"), range("F2", "F2"), "copy");
  assert.equal(copied.status, 200);
  assert.equal(copied.body.worksheet.cells.F2, "=D2+$E$1+SUM($D$1:E3)");
  // The source formula is untouched.
  assert.equal(copied.body.worksheet.cells.F1, "=D1+$E$1+SUM($D$1:E2)");

  const persisted = await readWorksheet(app);
  assert.equal(persisted.cells.F2, "=D2+$E$1+SUM($D$1:E3)");
});

test("moves a copied range right and down so its layout is preserved", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const copied = await transfer(app, range("A1", "C2"), range("E4", "G5"), "copy");
  assert.equal(copied.status, 200);
  const cells = copied.body.worksheet.cells;
  assert.equal(cells.E4, "Region");
  assert.equal(cells.F4, "Sales");
  assert.equal(cells.G4, "Status");
  assert.equal(cells.E5, "East");
  assert.equal(cells.F5, "1200");
  assert.equal(cells.G5, "Open");
  assert.equal(cells.H5, undefined);
});

test("rejects the whole transfer when a 0-to-100 rule covers a target cell", async (t) => {
  const app = await startApp((state) => {
    state.workbooks[0].worksheets[0].validations = [
      { id: "rule-1", type: "numeric", min: 0, max: 100, range: { minRow: 0, maxRow: 1, minCol: 4, maxCol: 4 } },
    ];
    return state;
  });
  t.after(() => app.close());

  const rejected = await transfer(app, range("A1", "B2"), range("D1", "E2"), "cut");
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error, "Please enter a number from 0 to 100");

  // Neither the source nor the target changed: no partial move.
  const persisted = await readWorksheet(app);
  assert.equal(persisted.cells.A1, "Region");
  assert.equal(persisted.cells.B2, "1200");
  assert.equal(persisted.cells.D1, undefined);
  assert.equal(persisted.cells.E2, undefined);
});

test("a value inside the rule still transfers", async (t) => {
  const app = await startApp((state) => {
    state.workbooks[0].worksheets[0].validations = [
      { id: "rule-1", type: "numeric", min: 0, max: 100, range: { minRow: 0, maxRow: 3, minCol: 3, maxCol: 4 } },
    ];
    return state;
  });
  t.after(() => app.close());

  await app.call(cellsPath(), {
    method: "POST",
    body: JSON.stringify({ start: { row: 0, col: 5 }, values: [["100"]] }),
  });
  const copied = await transfer(app, range("F1", "F1"), range("D1", "D1"), "copy");
  assert.equal(copied.status, 200);
  assert.equal(copied.body.worksheet.cells.D1, "100");
});

test("rejects an unknown mode and an out-of-grid range without changing the sheet", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const mode = await transfer(app, range("A1", "B2"), range("D1", "E2"), "move");
  assert.equal(mode.status, 400);
  assert.equal(mode.body.error, "Unknown transfer mode");

  const outside = await transfer(app, range("A1", "B2"), { anchor: { row: 60, col: 0 }, focus: { row: 60, col: 0 } }, "copy");
  assert.equal(outside.status, 400);
  assert.equal(outside.body.error, "Invalid range");

  const persisted = await readWorksheet(app);
  assert.equal(persisted.cells.A1, "Region");
  assert.equal(persisted.cells.D1, undefined);
});

test("grows the worksheet so a transfer into new rows is never truncated", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const copied = await transfer(app, range("A2", "B2"), { anchor: { row: 49, col: 25 }, focus: { row: 49, col: 25 } }, "copy");
  assert.equal(copied.status, 200);
  assert.equal(copied.body.worksheet.rowCount, 50);
  assert.equal(copied.body.worksheet.columnCount, 27);
  assert.equal(copied.body.worksheet.cells.Z50, "East");
  assert.equal(copied.body.worksheet.cells.AA50, "1200");
});

test("shiftFormulaByOffset replaces a reference pushed outside the grid", () => {
  assert.equal(shiftFormulaByOffset("=A2", -1, -2, GRID), "=#REF!");
  assert.equal(shiftFormulaByOffset("=B2", 1, 1, GRID), "=C3");
  assert.equal(shiftFormulaByOffset("=$B2", 1, 1, GRID), "=$B3");
  assert.equal(shiftFormulaByOffset("=B$2", 1, 1, GRID), "=C$2");
  assert.equal(shiftFormulaByOffset("=SUM(A1:B2)", 2, 0, GRID), "=SUM(A3:B4)");
  assert.equal(shiftFormulaByOffset("=\"A1\"&B1", 1, 0, GRID), "=\"A1\"&B2");
  assert.equal(shiftFormulaByOffset("Region", 1, 1, GRID), "Region");
  assert.equal(shiftFormulaByOffset("=B2", 0, 0, GRID), "=B2");
  assert.equal(shiftFormulaByOffset("=A1", 0, 30, GRID), "=#REF!");
});
