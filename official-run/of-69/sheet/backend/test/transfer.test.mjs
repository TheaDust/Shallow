import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CELL_OUT_OF_RANGE_MESSAGE,
  TRANSFER_MODE_INVALID_MESSAGE,
  WorkbookError,
  createWorkbookService,
} from "../src/lib/workbooks.mjs";
import { shiftValidationRange } from "../src/lib/structure.mjs";
import { translateFormula } from "../src/lib/transfer.mjs";
import { NUMBER_ZERO_TO_HUNDRED_MESSAGE } from "../src/lib/validation.mjs";

const SHEET = "ws-q3-sales-sheet1";

async function createService(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-transfer-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "workbooks.json");
  return { filePath, service: createWorkbookService({ filePath, ...options }) };
}

function sheetOf(workbook) {
  return workbook.worksheets.find((worksheet) => worksheet.id === SHEET);
}

test("copies a rectangle onto the target and leaves the source unchanged", async (t) => {
  const { filePath, service } = await createService(t);

  const updated = await service.transferRange("wb-q3-sales", SHEET, {
    mode: "copy",
    source: { anchor: "A1", focus: "B2" },
    target: { anchor: "D1", focus: "E2" },
  });
  const sheet = sheetOf(updated);
  assert.deepEqual(sheet.cells.D1, { value: "Region" });
  assert.deepEqual(sheet.cells.E1, { value: "Sales" });
  assert.deepEqual(sheet.cells.D2, { value: "East" });
  assert.deepEqual(sheet.cells.E2, { value: "1200" });
  assert.deepEqual(sheet.cells.A1, { value: "Region" }, "the source keeps its value");
  assert.deepEqual(sheet.cells.B2, { value: "1200" });
  assert.deepEqual(sheet.cells.C1, { value: "Status" }, "cells outside both ranges stay unchanged");

  const reopened = createWorkbookService({ filePath });
  const reloaded = sheetOf(await reopened.get("wb-q3-sales"));
  assert.deepEqual(reloaded.cells.D2, { value: "East" }, "the target persists after reload");
  assert.deepEqual(reloaded.cells.A1, { value: "Region" });
});

test("cuts a rectangle: the target gets the values and the source is cleared", async (t) => {
  const { service } = await createService(t);

  const updated = await service.transferRange("wb-q3-sales", SHEET, {
    mode: "cut",
    source: { anchor: "A1", focus: "B2" },
    target: { anchor: "D1", focus: "E2" },
  });
  const sheet = sheetOf(updated);
  assert.equal(sheet.cells.A1, undefined, "the cut source is cleared");
  assert.equal(sheet.cells.B1, undefined);
  assert.equal(sheet.cells.A2, undefined);
  assert.equal(sheet.cells.B2, undefined);
  assert.deepEqual(sheet.cells.D1, { value: "Region" });
  assert.deepEqual(sheet.cells.E2, { value: "1200" });
  assert.deepEqual(sheet.cells.A3, { value: "North" }, "rows outside the source are preserved");
});

test("keeps the moved values when a cut target overlaps its source", async (t) => {
  const { service } = await createService(t);
  await service.writeCells("wb-q3-sales", SHEET, {
    updates: [
      { name: "A1", input: "1" },
      { name: "B1", input: "2" },
    ],
  });

  const updated = await service.transferRange("wb-q3-sales", SHEET, {
    mode: "cut",
    source: { anchor: "A1", focus: "B1" },
    target: { anchor: "B1", focus: "C1" },
  });
  const sheet = sheetOf(updated);
  assert.equal(sheet.cells.A1, undefined, "the emptied coordinate stays empty");
  assert.deepEqual(sheet.cells.B1, { value: "1" }, "the overlapping target keeps the moved value");
  assert.deepEqual(sheet.cells.C1, { value: "2" });
});

test("adjusts relative references of copied formulas and keeps absolute ones", async (t) => {
  const { service } = await createService(t);
  await service.writeCells("wb-q3-sales", SHEET, {
    updates: [
      { name: "A1", input: "2" },
      { name: "B1", input: "3" },
      { name: "C1", input: "=A1+$A$1" },
      { name: "C2", input: "=SUM(A1:B1)" },
    ],
  });

  const updated = await service.transferRange("wb-q3-sales", SHEET, {
    mode: "copy",
    source: { anchor: "C1", focus: "C2" },
    target: { anchor: "D1", focus: "D2" },
  });
  const sheet = sheetOf(updated);
  assert.equal(sheet.cells.D1.formula, "=B1+$A$1", "the relative reference moves one column right");
  assert.equal(sheet.cells.D1.value, "5", "the copied formula is recalculated");
  assert.equal(sheet.cells.D2.formula, "=SUM(B1:C1)", "a copied range reference shifts with the target");
  assert.equal(sheet.cells.C1.formula, "=A1+$A$1", "the source formula is unchanged");
});

test("rejects the whole transfer when the target breaks a 0-to-100 rule", async (t) => {
  const { filePath, service } = await createService(t);
  await service.writeCells("wb-q3-sales", SHEET, {
    updates: [
      { name: "A1", input: "50" },
      { name: "A2", input: "101" },
    ],
  });
  const stored = JSON.parse(await readFile(filePath, "utf8"));
  stored.workbooks[0].worksheets[0].validations = [{ range: "D1:D2", type: "number", min: 0, max: 100 }];
  await writeFile(filePath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");

  const guarded = createWorkbookService({ filePath });
  await assert.rejects(
    () =>
      guarded.transferRange("wb-q3-sales", SHEET, {
        mode: "copy",
        source: { anchor: "A1", focus: "A2" },
        target: { anchor: "D1", focus: "D2" },
      }),
    (error) => error instanceof WorkbookError && error.message === NUMBER_ZERO_TO_HUNDRED_MESSAGE,
  );

  const after = sheetOf(await guarded.get("wb-q3-sales"));
  assert.equal(after.cells.D1, undefined, "a rejected transfer writes nothing");
  assert.equal(after.cells.D2, undefined);
  assert.deepEqual(after.cells.A1, { value: "50" });
});

test("rejects transfers with a bad mode or an out-of-range target without changing anything", async (t) => {
  const { service } = await createService(t);

  await assert.rejects(
    () =>
      service.transferRange("wb-q3-sales", SHEET, {
        mode: "move",
        source: { anchor: "A1", focus: "B2" },
        target: { anchor: "D1", focus: "E2" },
      }),
    (error) => error instanceof WorkbookError && error.message === TRANSFER_MODE_INVALID_MESSAGE,
  );
  await assert.rejects(
    () =>
      service.transferRange("wb-q3-sales", SHEET, {
        mode: "copy",
        source: { anchor: "A1", focus: "B2" },
        target: { anchor: "Z30", focus: "Z30" },
      }),
    (error) => error instanceof WorkbookError && error.message === CELL_OUT_OF_RANGE_MESSAGE,
  );

  const after = sheetOf(await service.get("wb-q3-sales"));
  assert.deepEqual(after.cells.A1, { value: "Region" });
  assert.equal(after.cells.Z30, undefined);
});

test("restores a captured worksheet state exactly, including structure and selection", async (t) => {
  const { filePath, service } = await createService(t);
  const before = structuredClone(sheetOf(await service.get("wb-q3-sales")));

  await service.structure("wb-q3-sales", SHEET, { axis: "row", action: "insert-below", index: 1 });
  await service.writeCells("wb-q3-sales", SHEET, {
    updates: [{ name: "A4", input: "North" }],
    selection: { anchor: "A4", focus: "A4" },
  });

  const restored = await service.restoreWorksheet("wb-q3-sales", SHEET, {
    rowCount: before.rowCount,
    columnCount: before.columnCount,
    cells: before.cells,
    selection: before.selection,
  });
  const sheet = sheetOf(restored);
  assert.equal(sheet.rowCount, before.rowCount);
  assert.deepEqual(sheet.cells, before.cells, "the grid returns to the captured values");
  assert.deepEqual(sheet.selection, before.selection);
  assert.equal(sheet.cells.A3.value, "North");

  const reopened = createWorkbookService({ filePath });
  assert.deepEqual(sheetOf(await reopened.get("wb-q3-sales")).cells, before.cells, "the restore persists");
});

test("translates references and drops rules whose range was removed", () => {
  assert.equal(translateFormula("=B2*2", 1, 1), "=C3*2");
  assert.equal(translateFormula("=$B2+B$2+$B$2", 1, 1), "=$B3+C$2+$B$2");
  assert.equal(translateFormula("=A1", 0, -1), "=#REF!");
  assert.equal(translateFormula('=SUM(A1:B2)&"A1"', 1, 0), '=SUM(A2:B3)&"A1"');

  assert.equal(shiftValidationRange("E1:E2", { isRow: true, kind: "delete", index: 0 }), "E1:E1");
  assert.equal(shiftValidationRange("E2:E2", { isRow: true, kind: "delete", index: 1 }), null);
  assert.equal(shiftValidationRange("E1:E2", { isRow: false, kind: "delete", index: 4 }), null);
  assert.equal(shiftValidationRange("E1:F2", { isRow: true, kind: "before", index: 0 }), "E2:F3");
});
