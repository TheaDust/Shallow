import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { applyStructureOperation } from "../src/domain/structure.mjs";
import { shiftFormula } from "../src/domain/formula.mjs";

const SEED_WORKBOOK_ID = "workbook-q3-sales";

function baseWorksheet(overrides = {}) {
  return {
    id: "sheet-1",
    name: "Sheet1",
    rowCount: 5,
    columnCount: 4,
    cells: {
      A1: "Region",
      B1: "Sales",
      A2: "East",
      B2: "1200",
      A3: "North",
      B3: "800",
    },
    selection: { anchor: { row: 1, col: 0 }, focus: { row: 1, col: 0 } },
    ...overrides,
  };
}

test("shifts formula references for row and column insert/delete", () => {
  assert.equal(shiftFormula("=B2", { axis: "row", mode: "insert", index: 1 }), "=B3");
  assert.equal(shiftFormula("=B2", { axis: "row", mode: "delete", index: 1 }), "=#REF!");
  assert.equal(shiftFormula("=SUM(B2:B4)", { axis: "row", mode: "insert", index: 0 }), "=SUM(B3:B5)");
  assert.equal(shiftFormula("=SUM(B2:B4)", { axis: "row", mode: "delete", index: 1 }), "=SUM(B2:B3)");
  assert.equal(shiftFormula("=C3", { axis: "column", mode: "insert", index: 1 }), "=D3");
  assert.equal(shiftFormula("=C3", { axis: "column", mode: "delete", index: 2 }), "=#REF!");
  assert.equal(shiftFormula("=IF(B2>5,\"B2\",C3)", { axis: "row", mode: "insert", index: 0 }), "=IF(B3>5,\"B2\",C4)");
});

test("inserts a row below the target and shifts records, formulas and selection down", () => {
  const worksheet = baseWorksheet({ cells: { A1: "Region", A2: "East", B3: "=A2" } });
  const result = applyStructureOperation(worksheet, "insertRowBelow", 1);
  assert.equal(result.ok, true);
  const next = result.worksheet;
  assert.equal(next.rowCount, 6);
  assert.equal(next.cells.A2, "East");
  assert.equal(next.cells.A3, undefined);
  assert.equal(next.cells.A1, "Region");
  // `=A2` sat in row 3 and moved to row 4, its reference to the still-row-2 cell is unchanged.
  assert.equal(next.cells.B4, "=A2");
  assert.deepEqual(next.selection, { anchor: { row: 1, col: 0 }, focus: { row: 1, col: 0 } });
  assert.deepEqual(worksheet.cells, { A1: "Region", A2: "East", B3: "=A2" });
});

test("inserts a row above the target and deletes a row", () => {
  const worksheet = baseWorksheet();
  const above = applyStructureOperation(worksheet, "insertRowAbove", 1).worksheet;
  assert.equal(above.rowCount, 6);
  assert.equal(above.cells.A1, "Region");
  assert.equal(above.cells.A3, "East");
  assert.equal(above.cells.B3, "1200");
  assert.equal(above.cells.A4, "North");

  const deleted = applyStructureOperation(worksheet, "deleteRow", 1).worksheet;
  assert.equal(deleted.rowCount, 4);
  assert.equal(deleted.cells.A2, "North");
  assert.equal(deleted.cells.B2, "800");
  assert.equal(deleted.cells.A3, undefined);
});

test("inserts and deletes columns, preserving data outside the deleted column", () => {
  const worksheet = baseWorksheet();
  const right = applyStructureOperation(worksheet, "insertColumnRight", 1).worksheet;
  assert.equal(right.columnCount, 5);
  assert.equal(right.cells.A1, "Region");
  assert.equal(right.cells.B1, "Sales");
  assert.equal(right.cells.C1, undefined);
  assert.equal(right.cells.D1, undefined);

  const left = applyStructureOperation(worksheet, "insertColumnLeft", 1).worksheet;
  assert.equal(left.cells.A1, "Region");
  assert.equal(left.cells.C1, "Sales");
  assert.equal(left.cells.B2, undefined);
  assert.equal(left.cells.C2, "1200");

  const deleted = applyStructureOperation(worksheet, "deleteColumn", 1).worksheet;
  assert.equal(deleted.columnCount, 3);
  assert.equal(deleted.cells.A1, "Region");
  assert.equal(deleted.cells.A2, "East");
  assert.equal(deleted.cells.B1, undefined);
  assert.equal(deleted.cells.B2, undefined);
});

test("rejects unknown operations, out-of-range targets and deleting the only row/column", () => {
  const worksheet = baseWorksheet();
  assert.deepEqual(applyStructureOperation(worksheet, "nope", 0), {
    ok: false,
    error: "Unknown structure operation",
  });
  assert.deepEqual(applyStructureOperation(worksheet, "deleteRow", 9), {
    ok: false,
    error: "Row index out of range",
  });
  assert.deepEqual(applyStructureOperation(worksheet, "insertColumnRight", -1), {
    ok: false,
    error: "Column index out of range",
  });
  const single = baseWorksheet({ rowCount: 1, columnCount: 1, cells: { A1: "only" } });
  assert.deepEqual(applyStructureOperation(single, "deleteRow", 0), {
    ok: false,
    error: "Cannot delete the only row",
  });
  assert.deepEqual(applyStructureOperation(single, "deleteColumn", 0), {
    ok: false,
    error: "Cannot delete the only column",
  });
});

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-structure-"));
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
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    async workbook(id) {
      const detail = await this.call(`/api/workbooks/${id}`);
      return detail.body.workbook;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("persists a row insertion through the API without touching the other worksheet", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const before = await app.workbook(SEED_WORKBOOK_ID);
  const [sheet1, sheet2] = before.worksheets;

  const response = await app.call(
    `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${sheet1.id}/structure`,
    { method: "POST", body: JSON.stringify({ operation: "insertRowBelow", index: 1 }) },
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.worksheet.rowCount, sheet1.rowCount + 1);
  assert.equal(response.body.worksheet.cells.A2, "East");
  assert.equal(response.body.worksheet.cells.A3, undefined);
  assert.equal(response.body.worksheet.cells.A4, "North");
  assert.equal(response.body.worksheet.cells.B4, "800");
  assert.deepEqual(response.body.workbook.worksheets[1].cells, {});

  const reloaded = await app.workbook(SEED_WORKBOOK_ID);
  assert.equal(reloaded.worksheets[0].cells.A4, "North");
  assert.equal(reloaded.worksheets[0].cells.A3, undefined);
  assert.deepEqual(reloaded.worksheets[1].cells, sheet2.cells);
});

test("persists a column deletion through the API and keeps the rest of the sheet", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const before = await app.workbook(SEED_WORKBOOK_ID);
  const sheet1 = before.worksheets[0];

  const response = await app.call(
    `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${sheet1.id}/structure`,
    { method: "POST", body: JSON.stringify({ operation: "deleteColumn", index: 1 }) },
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.worksheet.columnCount, sheet1.columnCount - 1);
  assert.equal(response.body.worksheet.cells.A2, "East");
  assert.equal(response.body.worksheet.cells.B2, "Open");
  assert.equal(response.body.worksheet.cells.C2, undefined);

  const reloaded = await app.workbook(SEED_WORKBOOK_ID);
  assert.equal(reloaded.worksheets[0].cells.B1, "Status");
});

test("shifts a seeded formula with its values and keeps the pair consistent after reload", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const before = await app.workbook(SEED_WORKBOOK_ID);
  const sheet1 = before.worksheets[0];
  const cellsPath = `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${sheet1.id}/cells`;
  const seeded = await app.call(cellsPath, {
    method: "POST",
    body: JSON.stringify({
      start: { row: 5, col: 0 },
      values: [["2", "3", "=A6+B6", "=C6*2"]],
    }),
  });
  assert.equal(seeded.status, 200);

  const response = await app.call(
    `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${sheet1.id}/structure`,
    { method: "POST", body: JSON.stringify({ operation: "insertRowAbove", index: 5 }) },
  );
  assert.equal(response.status, 200);
  // The record and both formulas moved down together, so the results stay the same.
  assert.equal(response.body.worksheet.cells.A7, "2");
  assert.equal(response.body.worksheet.cells.B7, "3");
  assert.equal(response.body.worksheet.cells.C7, "=A7+B7");
  assert.equal(response.body.worksheet.cells.D7, "=C7*2");
  assert.equal(response.body.worksheet.cells.A6, undefined);
  // The shared table above the inserted row is untouched.
  assert.equal(response.body.worksheet.cells.A1, "Region");
  assert.equal(response.body.worksheet.cells.C1, "Status");

  const reloaded = await app.workbook(SEED_WORKBOOK_ID);
  assert.equal(reloaded.worksheets[0].cells.C7, "=A7+B7");
  assert.equal(reloaded.worksheets[0].cells.D7, "=C7*2");
});

test("leaves the stored shape unchanged when a structure operation is rejected", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const before = await app.workbook(SEED_WORKBOOK_ID);
  const sheet1 = before.worksheets[0];
  const endpoint = `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${sheet1.id}/structure`;

  const badOperation = await app.call(endpoint, { method: "POST", body: JSON.stringify({ operation: "explode", index: 0 }) });
  assert.equal(badOperation.status, 400);
  const badIndex = await app.call(endpoint, { method: "POST", body: JSON.stringify({ operation: "deleteRow", index: 999 }) });
  assert.equal(badIndex.status, 422);
  assert.equal(badIndex.body.error, "Row index out of range");

  const reloaded = await app.workbook(SEED_WORKBOOK_ID);
  assert.equal(reloaded.worksheets[0].rowCount, sheet1.rowCount);
  assert.equal(reloaded.worksheets[0].columnCount, sheet1.columnCount);
  assert.deepEqual(reloaded.worksheets[0].cells, sheet1.cells);

  const missing = await app.call(`/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/nope/structure`, {
    method: "POST",
    body: JSON.stringify({ operation: "deleteRow", index: 0 }),
  });
  assert.equal(missing.status, 404);
});
