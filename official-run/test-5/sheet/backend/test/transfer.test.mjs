import test from "node:test";
import assert from "node:assert/strict";

import { offsetFormulaText, transferUpdates } from "../src/domain/transfer.mjs";
import { worksheetValues } from "../src/domain/formula.mjs";

const SHEET_NAME = "Sheet1";

function sheetWith(cells, name = SHEET_NAME) {
  return { name, cells };
}

test("a copy places the source rectangle at the target with its layout intact", () => {
  const worksheet = sheetWith({ A1: "Item", B1: "Qty", A2: "Pen", B2: "4", D9: "keep" });
  const result = transferUpdates(worksheet, {
    mode: "copy",
    source: { start: "A1", end: "B2" },
    target: { start: "D1", end: "E2" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.updates, { D1: "Item", E1: "Qty", D2: "Pen", E2: "4" });
  // The source and every cell outside both rectangles stay untouched.
  assert.equal(Object.hasOwn(result.updates, "A1"), false);
  assert.equal(Object.hasOwn(result.updates, "D9"), false);
});

test("a copy of a dragged rectangle uses the corners, not the drag direction", () => {
  const worksheet = sheetWith({ A1: "East", B1: "1200", A2: "North", B2: "800" });
  const result = transferUpdates(worksheet, {
    mode: "copy",
    source: { start: "B2", end: "A1" },
    target: { start: "E2", end: "D1" },
  });
  assert.deepEqual(result.updates, { D1: "East", E1: "1200", D2: "North", E2: "800" });
});

test("copied formulas move relative references, keep anchors and empty fields", () => {
  const worksheet = sheetWith({ A1: "=B1*2", B1: "5", A2: "=SUM(A1:B1)", A3: "=$B$1+A4", A4: "3" });
  const result = transferUpdates(worksheet, {
    mode: "copy",
    source: { start: "A1", end: "A4" },
    target: { start: "C1", end: "C4" },
  });
  assert.equal(result.updates.C1, "=D1*2");
  assert.equal(result.updates.C2, "=SUM(C1:D1)");
  assert.equal(result.updates.C3, "=$B$1+C4");
  assert.equal(result.updates.C4, "3");
});

test("a reference pushed outside the grid becomes #REF! and blanks stay blank", () => {
  const worksheet = sheetWith({ T1: "=U1+1" });
  const result = transferUpdates(worksheet, {
    mode: "copy",
    source: { start: "T1", end: "T1" },
    target: { start: "T2", end: "T2" },
  });
  assert.equal(result.updates.T2, "=#REF!+1");
  assert.equal(offsetFormulaText("=A1", -1, 0, "Sheet1"), "=#REF!");
  assert.equal(offsetFormulaText("=A1", 0, 0, "Sheet1"), "=A1");
});

test("a foreign-sheet reference is left alone while a same-sheet qualifier moves", () => {
  assert.equal(offsetFormulaText("=Sheet2!A1", 0, 1, "Sheet1"), "=Sheet2!A1");
  assert.equal(offsetFormulaText("=Sheet1!A1", 0, 1, "Sheet1"), "=Sheet1!B1");
  assert.equal(offsetFormulaText('="A1"&A1', 0, 1, "Sheet1"), '="A1"&B1');
});

test("a reference kept out of the grid displays #REF! in the grid", () => {
  const worksheet = sheetWith({ A1: "5", C1: "=A1" });
  const result = transferUpdates(worksheet, { mode: "copy", source: "C1", target: "B2" });
  assert.equal(result.updates.B2, "=#REF!");
  const cells = { ...worksheet.cells, ...result.updates };
  const values = worksheetValues({ ...worksheet, cells });
  assert.equal(values.B2, "#REF!");
  // The copied-from formula and every unrelated cell keep their values.
  assert.equal(values.C1, "5");
  assert.equal(values.A1, "5");
});

test("a cut writes the target and clears the source in the same map", () => {
  const worksheet = sheetWith({ A1: "East", A2: "North", C1: "keep" });
  const result = transferUpdates(worksheet, {
    mode: "cut",
    source: { start: "A1", end: "A1" },
    target: { start: "D1", end: "D1" },
  });
  assert.deepEqual(result.updates, { D1: "East", A1: "" });
});

test("a cut onto an overlapping rectangle keeps the pasted cells and clears the rest", () => {
  const worksheet = sheetWith({ A1: "1", B1: "2", A2: "3", B2: "4" });
  const result = transferUpdates(worksheet, {
    mode: "cut",
    source: { start: "A1", end: "B2" },
    target: { start: "B1", end: "C2" },
  });
  assert.deepEqual(result.updates, { B1: "1", C1: "2", B2: "3", C2: "4", A1: "", A2: "" });
});

test("rejects an unknown mode, an invalid range and a rectangle that leaves the grid", () => {
  const worksheet = sheetWith({ A1: "x" });
  assert.deepEqual(
    transferUpdates(worksheet, { mode: "move", source: "A1", target: "D1" }),
    { ok: false, error: "Unknown transfer mode" },
  );
  assert.deepEqual(
    transferUpdates(worksheet, { mode: "copy", source: "??", target: "D1" }),
    { ok: false, error: "Invalid range" },
  );
  assert.deepEqual(
    transferUpdates(worksheet, { mode: "copy", source: "A1:B1", target: "T40" }),
    { ok: false, error: "Cell is outside the worksheet bounds" },
  );
  // A source range that is itself outside the grid is an invalid range.
  assert.equal(transferUpdates(worksheet, { mode: "copy", source: "A41", target: "D1" }).error, "Invalid range");
  assert.deepEqual(worksheet.cells, { A1: "x" });
});
