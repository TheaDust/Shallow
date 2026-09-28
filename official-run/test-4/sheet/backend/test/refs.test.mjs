import assert from "node:assert/strict";
import test from "node:test";

import {
  adjustReference,
  rewriteFormulaRefs,
} from "../src/lib/refs.mjs";

test("adjustReference shifts columns for insertion and deletion", () => {
  assert.deepEqual(adjustReference(1, 2, { axis: "column", insert: 1 }), { col: 2, row: 2 });
  assert.deepEqual(adjustReference(0, 2, { axis: "column", insert: 1 }), { col: 0, row: 2 });
  assert.deepEqual(adjustReference(1, 2, { axis: "column", insert: 0 }), { col: 2, row: 2 });
  assert.deepEqual(adjustReference(1, 2, { axis: "column", delete: 1 }), null);
  assert.deepEqual(adjustReference(2, 2, { axis: "column", delete: 1 }), { col: 1, row: 2 });
  assert.deepEqual(adjustReference(0, 2, { axis: "column", delete: 1 }), { col: 0, row: 2 });
});

test("adjustReference shifts rows for insertion and deletion", () => {
  assert.deepEqual(adjustReference(1, 2, { axis: "row", insert: 3 }), { col: 1, row: 2 });
  assert.deepEqual(adjustReference(1, 2, { axis: "row", insert: 2 }), { col: 1, row: 3 });
  assert.deepEqual(adjustReference(1, 2, { axis: "row", delete: 2 }), null);
  assert.deepEqual(adjustReference(1, 3, { axis: "row", delete: 2 }), { col: 1, row: 2 });
});

test("rewriteFormulaRefs leaves plain cell values untouched", () => {
  assert.equal(rewriteFormulaRefs("East", { axis: "column", insert: 1 }), "East");
  assert.equal(rewriteFormulaRefs("", { axis: "column", insert: 1 }), "");
  assert.equal(rewriteFormulaRefs("=East", { axis: "column", insert: 1 }), "=East");
});

test("rewriteFormulaRefs adjusts references on column insertion", () => {
  const op = { axis: "column", insert: 1 }; // new blank column at index 1 (B)
  assert.equal(rewriteFormulaRefs("=B2+C3", op), "=C2+D3");
  assert.equal(rewriteFormulaRefs("=A1", op), "=A1");
  assert.equal(rewriteFormulaRefs("=SUM(A1:B3)", op), "=SUM(A1:C3)");
  assert.equal(rewriteFormulaRefs("=$B$2", op), "=$C$2");
});

test("rewriteFormulaRefs adjusts references on column deletion and emits #REF!", () => {
  const op = { axis: "column", delete: 1 }; // column B removed
  assert.equal(rewriteFormulaRefs("=A1", op), "=A1");
  assert.equal(rewriteFormulaRefs("=B2", op), "=#REF!");
  assert.equal(rewriteFormulaRefs("=C2+D3", op), "=B2+C3");
  assert.equal(rewriteFormulaRefs("=SUM(A1:B3)", op), "=SUM(#REF!)");
});

test("rewriteFormulaRefs adjusts references on row insertion", () => {
  const op = { axis: "row", insert: 2 }; // new blank row 2
  assert.equal(rewriteFormulaRefs("=B2", op), "=B3");
  assert.equal(rewriteFormulaRefs("=A1", op), "=A1");
});

test("rewriteFormulaRefs emits #REF! for references into a deleted row", () => {
  const op = { axis: "row", delete: 2 };
  assert.equal(rewriteFormulaRefs("=B2", op), "=#REF!");
  assert.equal(rewriteFormulaRefs("=B3", op), "=B2");
});

test("rewriteFormulaRefs handles multiple independent references", () => {
  assert.equal(
    rewriteFormulaRefs("=A1+B2*C3", { axis: "column", insert: 0 }),
    "=B1+C2*D3",
  );
});
