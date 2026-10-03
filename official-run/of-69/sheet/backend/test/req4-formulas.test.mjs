import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createWorkbookService } from "../src/lib/workbooks.mjs";

const WORKBOOK = "wb-q3-sales";
const SHEET1 = "ws-q3-sales-sheet1";
const SHEET2 = "ws-q3-sales-sheet2";

async function createService(t) {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-req4-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { filePath: join(directory, "workbooks.json"), directory };
}

function cellOf(workbook, worksheetId, name) {
  return workbook.worksheets.find((worksheet) => worksheet.id === worksheetId)?.cells[name];
}

const valueAt = (workbook, worksheetId, name) => cellOf(workbook, worksheetId, name)?.value;

// REQ-4-1-1: expressions entered through a write keep the original formula for the formula
// bar and the calculated result for the grid, and both survive a fresh service (refresh).
test("REQ-4-1-1 keeps the original expression and the calculated result across a reopen", async (t) => {
  const { filePath, directory } = await createService(t);
  const service = createWorkbookService({ filePath });
  const updated = await service.writeCells(WORKBOOK, SHEET1, {
    updates: [
      { name: "A1", input: "2" },
      { name: "B1", input: "3" },
      { name: "C1", input: "=A1+B1" },
      { name: "D1", input: "=C1*2" },
    ],
  });

  assert.equal(valueAt(updated, SHEET1, "A1"), "2");
  assert.equal(valueAt(updated, SHEET1, "B1"), "3");
  assert.equal(valueAt(updated, SHEET1, "C1"), "5", "the grid shows the result of the expression");
  assert.equal(cellOf(updated, SHEET1, "C1").formula, "=A1+B1", "the formula bar keeps the submitted expression");
  assert.equal(valueAt(updated, SHEET1, "D1"), "10", "an indirectly dependent formula is calculated");
  assert.equal(cellOf(updated, SHEET1, "D1").formula, "=C1*2");

  const reopened = createWorkbookService({ filePath });
  const reloaded = await reopened.get(WORKBOOK);
  assert.equal(valueAt(reloaded, SHEET1, "C1"), "5");
  assert.equal(cellOf(reloaded, SHEET1, "C1").formula, "=A1+B1");
  assert.equal(valueAt(reloaded, SHEET1, "D1"), "10");
  assert.equal(cellOf(reloaded, SHEET1, "D1").formula, "=C1*2");
  assert.ok(directory, "the isolated data directory is reused for the reopen");
});

// REQ-4-1-1: SUM/AVERAGE/COUNT/MIN/MAX over a contiguous range ignore blanks and text,
// treat only numeric cells as numbers, and match function names case-insensitively.
test("REQ-4-1-1 evaluates aggregate functions over a range using numeric cells only", async (t) => {
  const { filePath } = await createService(t);
  const service = createWorkbookService({ filePath });
  const updated = await service.writeCells(WORKBOOK, SHEET1, {
    updates: [
      { name: "A1", input: "1" },
      { name: "A2", input: "2" },
      { name: "A3", input: "text" },
      { name: "A4", input: "" },
      { name: "B1", input: "=SUM(A1:A4)" },
      { name: "B2", input: "=AVERAGE(A1:A4)" },
      { name: "B3", input: "=COUNT(A1:A4)" },
      { name: "B4", input: "=MIN(A1:A4)" },
      { name: "B5", input: "=MAX(A1:A4)" },
      { name: "B6", input: "=sum(A1:A2)" },
    ],
  });

  assert.equal(cellOf(updated, SHEET1, "A4"), undefined, "an empty input clears the cell");
  assert.equal(valueAt(updated, SHEET1, "B1"), "3", "SUM ignores text and blanks instead of treating them as zero");
  assert.equal(valueAt(updated, SHEET1, "B2"), "1.5", "AVERAGE divides by numeric cells only");
  assert.equal(valueAt(updated, SHEET1, "B3"), "2", "COUNT counts numeric cells only");
  assert.equal(valueAt(updated, SHEET1, "B4"), "1");
  assert.equal(valueAt(updated, SHEET1, "B5"), "2");
  assert.equal(valueAt(updated, SHEET1, "B6"), "3", "function names are case-insensitive");

  const reopened = await createWorkbookService({ filePath }).get(WORKBOOK);
  assert.equal(valueAt(reopened, SHEET1, "B1"), "3");
  assert.equal(cellOf(reopened, SHEET1, "B1").formula, "=SUM(A1:A4)");
});

// REQ-4-2-1: a source edit and a bulk write both update direct and indirect dependents.
test("REQ-4-2-1 recalculates dependent formulas after a source edit and a bulk write", async (t) => {
  const { filePath } = await createService(t);
  const service = createWorkbookService({ filePath });
  await service.writeCells(WORKBOOK, SHEET1, {
    updates: [
      { name: "A1", input: "2" },
      { name: "B1", input: "3" },
      { name: "C1", input: "=A1+B1" },
      { name: "D1", input: "=C1*2" },
    ],
  });

  const edited = await service.writeCells(WORKBOOK, SHEET1, { updates: [{ name: "A1", input: "5" }] });
  assert.equal(valueAt(edited, SHEET1, "C1"), "8", "directly dependent formula");
  assert.equal(valueAt(edited, SHEET1, "D1"), "16", "indirectly dependent formula");
  assert.equal(cellOf(edited, SHEET1, "C1").formula, "=A1+B1", "the source edit keeps the formula text");

  // A bulk paste applies every value at once and recalculates the whole sheet afterwards.
  const bulk = await service.writeCells(WORKBOOK, SHEET1, {
    updates: [
      { name: "A1", input: "10" },
      { name: "B1", input: "20" },
    ],
  });
  assert.equal(valueAt(bulk, SHEET1, "C1"), "30");
  assert.equal(valueAt(bulk, SHEET1, "D1"), "60");
});

// REQ-4-2-1: a range move rewrites relative references by the target offset, leaves
// absolute references alone, and shows results for the current source values.
test("REQ-4-2-1 adjusts copied references and recomputes the moved formula", async (t) => {
  const { filePath } = await createService(t);
  const service = createWorkbookService({ filePath });
  await service.writeCells(WORKBOOK, SHEET1, {
    updates: [
      { name: "A1", input: "2" },
      { name: "A2", input: "5" },
      { name: "B1", input: "3" },
      { name: "B2", input: "7" },
      { name: "C1", input: "=A1+B1" },
      { name: "D1", input: "=A1+$B$1" },
    ],
  });

  const moved = await service.transferRange(WORKBOOK, SHEET1, {
    mode: "copy",
    source: { anchor: "C1", focus: "D1" },
    target: { anchor: "C2", focus: "D2" },
  });
  assert.equal(cellOf(moved, SHEET1, "C1").formula, "=A1+B1", "the source formula is untouched by a copy");
  assert.equal(cellOf(moved, SHEET1, "C2").formula, "=A2+B2", "the copied relative references follow the offset");
  assert.equal(valueAt(moved, SHEET1, "C2"), "12", "the moved formula shows the new result");
  assert.equal(cellOf(moved, SHEET1, "D2").formula, "=A2+$B$1", "absolute references stay anchored");
  assert.equal(valueAt(moved, SHEET1, "D2"), "8", "A2=5 plus $B$1=3");
});

// REQ-4-2-1: row/column structure changes rewrite the stored formulas and recompute.
test("REQ-4-2-1 adjusts references after row and column changes and recomputes", async (t) => {
  const { filePath } = await createService(t);
  const service = createWorkbookService({ filePath });
  await service.writeCells(WORKBOOK, SHEET1, {
    updates: [
      { name: "A1", input: "2" },
      { name: "B1", input: "3" },
      { name: "C1", input: "=A1+B1" },
    ],
  });

  const withRow = await service.structure(WORKBOOK, SHEET1, { axis: "row", action: "insert-above", index: 0 });
  assert.equal(cellOf(withRow, SHEET1, "C2").formula, "=A2+B2", "row insertion shifts the references");
  assert.equal(valueAt(withRow, SHEET1, "C2"), "5", "the result uses the shifted sources");
  assert.equal(cellOf(withRow, SHEET1, "A1"), undefined, "the inserted row is blank");

  const withColumn = await service.structure(WORKBOOK, SHEET1, { axis: "column", action: "insert-left", index: 0 });
  assert.equal(cellOf(withColumn, SHEET1, "D2").formula, "=B2+C2", "column insertion shifts the references");
  assert.equal(valueAt(withColumn, SHEET1, "D2"), "5");
});

// REQ-4-2-1: a direct reference that cannot be preserved shows #REF!, while unrelated
// cells keep their own value or error.
test("REQ-4-2-1 shows #REF! for a deleted reference without disturbing other cells", async (t) => {
  const { filePath } = await createService(t);
  const service = createWorkbookService({ filePath });
  await service.writeCells(WORKBOOK, SHEET1, {
    updates: [
      { name: "A1", input: "2" },
      { name: "B1", input: "=A1*2" },
      { name: "C1", input: "=1/0" },
      { name: "D1", input: "kept" },
    ],
  });

  const deleted = await service.structure(WORKBOOK, SHEET1, { axis: "column", action: "delete", index: 0 });
  assert.equal(cellOf(deleted, SHEET1, "A1").formula, "=#REF!*2");
  assert.equal(valueAt(deleted, SHEET1, "A1"), "#REF!");
  assert.equal(valueAt(deleted, SHEET1, "B1"), "#DIV/0!", "an unrelated error cell is unchanged");
  assert.equal(valueAt(deleted, SHEET1, "C1"), "kept", "an unrelated ordinary cell is unchanged");
});

// REQ-4-2-1: formulas in another worksheet that do not reference the edited sources stay put.
test("REQ-4-2-1 leaves formulas in other worksheets unchanged", async (t) => {
  const { filePath } = await createService(t);
  const service = createWorkbookService({ filePath });
  await service.writeCells(WORKBOOK, SHEET2, {
    updates: [
      { name: "A1", input: "5" },
      { name: "B1", input: "=A1*2" },
    ],
  });

  const updated = await service.writeCells(WORKBOOK, SHEET1, { updates: [{ name: "A1", input: "99" }] });
  assert.equal(valueAt(updated, SHEET1, "A1"), "99");
  assert.equal(valueAt(updated, SHEET2, "A1"), "5", "the other worksheet keeps its source value");
  assert.equal(valueAt(updated, SHEET2, "B1"), "10", "the other worksheet keeps its result");
  assert.equal(cellOf(updated, SHEET2, "B1").formula, "=A1*2");
});

// REQ-4-2-1: one erroneous formula isolates to its own dependency chain.
test("REQ-4-2-1 isolates formula errors from unrelated cells", async (t) => {
  const { filePath } = await createService(t);
  const service = createWorkbookService({ filePath });
  const updated = await service.writeCells(WORKBOOK, SHEET1, {
    updates: [
      { name: "A1", input: "=1/0" },
      { name: "B1", input: "=A1+1" },
      { name: "C1", input: "=SUM(A1:B1)" },
      { name: "D1", input: "ok" },
      { name: "E1", input: "4" },
    ],
  });

  assert.equal(valueAt(updated, SHEET1, "A1"), "#DIV/0!");
  assert.equal(valueAt(updated, SHEET1, "B1"), "#DIV/0!", "errors propagate along the dependency chain");
  assert.equal(valueAt(updated, SHEET1, "C1"), "#DIV/0!");
  assert.equal(valueAt(updated, SHEET1, "D1"), "ok", "an unrelated cell is unaffected");
  assert.equal(valueAt(updated, SHEET1, "E1"), "4");
});
