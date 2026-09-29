/**
 * REQ-4-2-1 (dependent recalculation after a source change) and REQ-4-1-2
 * (copied formulas adjust their references) through the real HTTP write paths.
 *
 * Every test starts from the shared seed and reaches the formula state
 * `A1=2`, `B1=3`, `=A1+B1`, `=C1*2` through the public cell route, because the
 * seed keeps `Region` in A1. Display values are read back from the same
 * workbook payload the browser renders, so every assertion is the result of the
 * stored raw text plus the engine.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createSeedState } from "../src/domain/workbooks.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";
import { request, startApp } from "./support.mjs";

const WORKBOOK = "/api/workbooks/wb-q3-sales";
const SHEET1 = "ws-q3-sheet1";
const SHEET2 = "ws-q3-sheet2";

function sheetOf(workbook, id = SHEET1) {
  return workbook.worksheets.find((sheet) => sheet.id === id);
}

/** One commit through the public cell route (a single edit or a pasted table). */
function write(baseUrl, updates, worksheetId = SHEET1) {
  return request(baseUrl, `${WORKBOOK}/worksheets/${worksheetId}/cells`, {
    method: "POST",
    body: JSON.stringify({ updates }),
  });
}

function transfer(baseUrl, body, worksheetId = SHEET1) {
  return request(baseUrl, `${WORKBOOK}/worksheets/${worksheetId}/range-transfer`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function structure(baseUrl, kind, body, worksheetId = SHEET1) {
  return request(baseUrl, `${WORKBOOK}/worksheets/${worksheetId}/${kind}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function readSheet(baseUrl, worksheetId = SHEET1) {
  const response = await request(baseUrl, WORKBOOK);
  assert.equal(response.status, 200);
  return sheetOf(response.body.workbook, worksheetId);
}

/** The `=A1+B1` / `=C1*2` chain of the requirements, entered cell by cell. */
async function seedFormulaChain(baseUrl) {
  const written = await write(baseUrl, {
    A1: "2",
    B1: "3",
    C1: "=A1+B1",
    D1: "=C1*2",
    E1: "=D1+1",
  });
  assert.equal(written.status, 200);
  const sheet = sheetOf(written.body.workbook);
  assert.equal(sheet.values.C1, "5");
  assert.equal(sheet.values.D1, "10");
  assert.equal(sheet.values.E1, "11");
  return sheet;
}

test("REQ-4-2-1: editing a source recalculates direct and indirect dependents", async () => {
  const app = await startApp();
  try {
    await seedFormulaChain(app.baseUrl);

    const edited = await write(app.baseUrl, { A1: "5" });
    assert.equal(edited.status, 200);
    const sheet = sheetOf(edited.body.workbook);
    assert.equal(sheet.cells.A1, "5");
    // Every formula keeps the expression the user submitted ...
    assert.equal(sheet.cells.C1, "=A1+B1");
    assert.equal(sheet.cells.D1, "=C1*2");
    assert.equal(sheet.cells.E1, "=D1+1");
    // ... while the grid shows results computed from the new source value.
    assert.equal(sheet.values.C1, "8");
    assert.equal(sheet.values.D1, "16");
    assert.equal(sheet.values.E1, "17");
    assert.equal(sheet.values.B1, "3");

    // Reopening reads the stored expressions, never a pre-change result.
    const reopened = await readSheet(app.baseUrl);
    assert.equal(reopened.cells.C1, "=A1+B1");
    assert.equal(reopened.values.C1, "8");
    assert.equal(reopened.values.D1, "16");
    assert.equal(reopened.values.E1, "17");

    // The same state survives a restart of the process (stored raw text only).
    const persisted = await createJsonStore(app.storePath, createSeedState()).read();
    assert.equal(sheetOf(persisted.workbooks[0]).cells.D1, "=C1*2");
  } finally {
    await app.close();
  }
});

test("REQ-4-2-1: a bulk paste updates its own formulas and every dependent", async () => {
  const app = await startApp();
  try {
    await seedFormulaChain(app.baseUrl);

    // A pasted rectangle overwrites its targets in one write, including sources.
    const pasted = await write(app.baseUrl, { A1: "10", B1: "4", F1: "=A1+B1", F2: "=F1*3" });
    assert.equal(pasted.status, 200);
    const sheet = sheetOf(pasted.body.workbook);
    assert.equal(sheet.values.A1, "10");
    assert.equal(sheet.values.C1, "14");
    assert.equal(sheet.values.D1, "28");
    assert.equal(sheet.values.E1, "29");
    assert.equal(sheet.values.F1, "14");
    assert.equal(sheet.values.F2, "42");

    // A later source edit reaches the pasted formulas too.
    const edited = await write(app.baseUrl, { B1: "5" });
    const afterEdit = sheetOf(edited.body.workbook);
    assert.equal(afterEdit.values.F1, "15");
    assert.equal(afterEdit.values.F2, "45");
    assert.equal(afterEdit.values.D1, "30");

    const reopened = await readSheet(app.baseUrl);
    assert.equal(reopened.cells.F2, "=F1*3");
    assert.equal(reopened.values.F2, "45");
  } finally {
    await app.close();
  }
});

test("REQ-4-2-1: moving a source range recalculates the formulas that read it", async () => {
  const app = await startApp();
  try {
    await write(app.baseUrl, { A5: "2", B5: "3", C5: "=A5+B5", D5: "=C5*2" });
    const before = await readSheet(app.baseUrl);
    assert.equal(before.values.C5, "5");
    assert.equal(before.values.D5, "10");

    // Cutting A5 away empties it, so C5 recomputes from the remaining source.
    const moved = await transfer(app.baseUrl, { mode: "cut", source: "A5", target: "A6" });
    assert.equal(moved.status, 200);
    const sheet = sheetOf(moved.body.workbook);
    assert.equal(sheet.cells.A6, "2");
    assert.equal(Object.hasOwn(sheet.cells, "A5"), false);
    assert.equal(sheet.cells.C5, "=A5+B5");
    assert.equal(sheet.values.C5, "3");
    assert.equal(sheet.values.D5, "6");

    // Moving the formulas themselves offsets their references and recalcs.
    const formulasMoved = await transfer(app.baseUrl, { mode: "cut", source: "C5:D5", target: "C7" });
    assert.equal(formulasMoved.status, 200);
    const afterFormulas = sheetOf(formulasMoved.body.workbook);
    assert.equal(afterFormulas.cells.C7, "=A7+B7");
    assert.equal(afterFormulas.cells.D7, "=C7*2");
    assert.equal(Object.hasOwn(afterFormulas.cells, "C5"), false);
    assert.equal(Object.hasOwn(afterFormulas.cells, "D5"), false);
    assert.equal(afterFormulas.values.C7, "0");
    assert.equal(afterFormulas.values.D7, "0");

    const sourced = await write(app.baseUrl, { A7: "4", B7: "6" });
    const afterSource = sheetOf(sourced.body.workbook);
    assert.equal(afterSource.values.C7, "10");
    assert.equal(afterSource.values.D7, "20");

    const reopened = await readSheet(app.baseUrl);
    assert.equal(reopened.cells.C7, "=A7+B7");
    assert.equal(reopened.values.C7, "10");
    assert.equal(reopened.values.D7, "20");
  } finally {
    await app.close();
  }
});

test("REQ-4-2-1: row and column changes shift formulas and recalculate their results", async () => {
  const app = await startApp();
  try {
    await seedFormulaChain(app.baseUrl);

    // Inserting one row above row 1 moves the whole chain down together.
    const rows = await structure(app.baseUrl, "rows", { op: "insert-row-above", row: 1 });
    assert.equal(rows.status, 200);
    const shifted = sheetOf(rows.body.workbook);
    assert.equal(shifted.cells.A2, "2");
    assert.equal(shifted.cells.C2, "=A2+B2");
    assert.equal(shifted.cells.D2, "=C2*2");
    assert.equal(shifted.values.C2, "5");
    assert.equal(shifted.values.D2, "10");
    assert.equal(shifted.cells.A3, "East");
    assert.equal(shifted.cells.B3, "1200");
    assert.equal(shifted.cells.A4, "North");
    assert.equal(shifted.cells.B4, "800");

    const edited = await write(app.baseUrl, { A2: "10" });
    const afterEdit = sheetOf(edited.body.workbook);
    assert.equal(afterEdit.values.C2, "13");
    assert.equal(afterEdit.values.D2, "26");

    // A new column on the left shifts the same data right, references included.
    const columns = await structure(app.baseUrl, "columns", { op: "insert-column-left", column: 1 });
    assert.equal(columns.status, 200);
    const wider = sheetOf(columns.body.workbook);
    assert.equal(wider.cells.B2, "10");
    assert.equal(wider.cells.D2, "=B2+C2");
    assert.equal(wider.cells.E2, "=D2*2");
    assert.equal(wider.values.D2, "13");
    assert.equal(wider.values.E2, "26");

    // Deleting the column that held a source leaves #REF! without hurting others.
    const deleted = await structure(app.baseUrl, "columns", { op: "delete-column", column: 2 });
    assert.equal(deleted.status, 200);
    const broken = sheetOf(deleted.body.workbook);
    assert.equal(broken.cells.B2, "3");
    assert.equal(broken.cells.C2, "=#REF!+B2");
    assert.equal(broken.values.C2, "#REF!");
    assert.equal(broken.values.D2, "#REF!");
    // The remaining seed rows moved left with their values intact.
    assert.equal(broken.cells.B3, "1200");
    assert.equal(broken.cells.B4, "800");
    assert.equal(broken.values.B4, "800");

    const reopened = await readSheet(app.baseUrl);
    assert.equal(reopened.cells.C2, "=#REF!+B2");
    assert.equal(reopened.values.C2, "#REF!");
    assert.equal(reopened.values.D2, "#REF!");
    assert.equal(reopened.cells.B2, "3");
  } finally {
    await app.close();
  }
});

test("REQ-4-2-1: formulas of another worksheet are untouched by a source change", async () => {
  const app = await startApp();
  try {
    const second = await write(app.baseUrl, { A1: "2", B1: "3", C1: "=A1+B1" }, SHEET2);
    assert.equal(second.status, 200);
    assert.equal(sheetOf(second.body.workbook, SHEET2).values.C1, "5");

    await seedFormulaChain(app.baseUrl);
    const changed = await write(app.baseUrl, { A1: "40" });
    const workbook = changed.body.workbook;
    // The changed worksheet recalculates ...
    assert.equal(sheetOf(workbook, SHEET1).values.C1, "43");
    // ... while the other worksheet keeps its own sources and results.
    const other = sheetOf(workbook, SHEET2);
    assert.equal(other.cells.A1, "2");
    assert.equal(other.cells.C1, "=A1+B1");
    assert.equal(other.values.C1, "5");

    // Its own dependencies still recalculate inside that worksheet.
    const secondEdit = await write(app.baseUrl, { A1: "10" }, SHEET2);
    const afterSecond = sheetOf(secondEdit.body.workbook, SHEET2);
    assert.equal(afterSecond.values.C1, "13");
    assert.equal(sheetOf(secondEdit.body.workbook, SHEET1).values.C1, "43");
  } finally {
    await app.close();
  }
});

test("REQ-4-1-2: a copied formula moves relative references and keeps absolute ones", async () => {
  const app = await startApp();
  try {
    await write(app.baseUrl, {
      A5: "2",
      B5: "3",
      C5: "=A5+B5",
      D5: "=C5*2",
      F5: "=$A$5+B5",
      A6: "4",
      B6: "6",
    });

    const copied = await transfer(app.baseUrl, { mode: "copy", source: "C5", target: "C6" });
    assert.equal(copied.status, 200);
    const sheet = sheetOf(copied.body.workbook);
    assert.equal(sheet.cells.C6, "=A6+B6");
    assert.equal(sheet.values.C6, "10");
    // The source formula and its result stay as they were.
    assert.equal(sheet.cells.C5, "=A5+B5");
    assert.equal(sheet.values.C5, "5");
    assert.equal(sheet.values.D5, "10");

    const anchored = await transfer(app.baseUrl, { mode: "copy", source: "F5", target: "F6" });
    const anchoredSheet = sheetOf(anchored.body.workbook);
    assert.equal(anchoredSheet.cells.F6, "=$A$5+B6");
    assert.equal(anchoredSheet.values.F6, "8");
    assert.equal(anchoredSheet.cells.F5, "=$A$5+B5");
    assert.equal(anchoredSheet.values.F5, "5");

    // The adjusted expressions and their results survive a refresh.
    const reopened = await readSheet(app.baseUrl);
    assert.equal(reopened.cells.C6, "=A6+B6");
    assert.equal(reopened.values.C6, "10");
    assert.equal(reopened.cells.F6, "=$A$5+B6");
    assert.equal(reopened.values.F6, "8");
  } finally {
    await app.close();
  }
});

test("REQ-4-1-2: an offset that leaves the grid stores =#REF! and shows #REF!", async () => {
  const app = await startApp();
  try {
    await write(app.baseUrl, { A1: "5", C1: "=A1", C3: "=A1*2" });

    // Copying `=A1` one column left pushes the only reference out of the grid.
    const broken = await transfer(app.baseUrl, { mode: "copy", source: "C1", target: "B2" });
    assert.equal(broken.status, 200);
    const sheet = sheetOf(broken.body.workbook);
    assert.equal(sheet.cells.B2, "=#REF!");
    assert.equal(sheet.values.B2, "#REF!");
    // The source formula and result are unchanged.
    assert.equal(sheet.cells.C1, "=A1");
    assert.equal(sheet.values.C1, "5");
    // A surviving reference keeps working next to a broken one.
    assert.equal(sheet.cells.C3, "=A1*2");
    assert.equal(sheet.values.C3, "10");

    const partial = await transfer(app.baseUrl, { mode: "copy", source: "C3", target: "B3" });
    const partialSheet = sheetOf(partial.body.workbook);
    assert.equal(partialSheet.cells.B3, "=#REF!*2");
    assert.equal(partialSheet.values.B3, "#REF!");
    assert.equal(partialSheet.values.C3, "10");
    assert.equal(partialSheet.values.B2, "#REF!");

    const reopened = await readSheet(app.baseUrl);
    assert.equal(reopened.cells.B2, "=#REF!");
    assert.equal(reopened.values.B2, "#REF!");
    assert.equal(reopened.cells.B3, "=#REF!*2");
    assert.equal(reopened.values.B3, "#REF!");
    assert.equal(reopened.values.C1, "5");
  } finally {
    await app.close();
  }
});
