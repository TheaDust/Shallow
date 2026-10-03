import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CELL_OUT_OF_RANGE_MESSAGE,
  CELL_REFERENCE_INVALID_MESSAGE,
  SELECTION_INVALID_MESSAGE,
  WorkbookError,
  createWorkbookService,
} from "../src/lib/workbooks.mjs";
import { NUMBER_ZERO_TO_HUNDRED_MESSAGE } from "../src/lib/validation.mjs";

const SHEET = "ws-q3-sales-sheet1";

async function createService(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-cells-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "workbooks.json");
  return { filePath, service: createWorkbookService({ filePath, ...options }) };
}

test("writes ordinary values and formulas, then persists them for a later service", async (t) => {
  const { filePath, service } = await createService(t);

  const updated = await service.writeCells("wb-q3-sales", SHEET, {
    updates: [
      { name: "D1", input: "East" },
      { name: "E1", input: "1200" },
      { name: "d2", input: "North" },
      { name: "E2", input: "800" },
      { name: "F1", input: "=E1+E2" },
    ],
  });
  const sheet = updated.worksheets.find((worksheet) => worksheet.id === SHEET);
  assert.equal(sheet.cells.D1.value, "East");
  assert.equal(sheet.cells.E1.value, "1200");
  assert.equal(sheet.cells.D2.value, "North", "coordinates are normalised to upper case");
  assert.equal(sheet.cells.E2.value, "800");
  assert.equal(sheet.cells.F1.value, "2000", "formula results are calculated");
  assert.equal(sheet.cells.F1.formula, "=E1+E2", "the submitted formula is kept");
  assert.equal(sheet.cells.A1.value, "Region", "untouched cells keep their value");

  const reopened = createWorkbookService({ filePath });
  const reloaded = await reopened.get("wb-q3-sales");
  const reloadedSheet = reloaded.worksheets.find((worksheet) => worksheet.id === SHEET);
  assert.equal(reloadedSheet.cells.D1.value, "East");
  assert.equal(reloadedSheet.cells.F1.formula, "=E1+E2");
  assert.equal(reloadedSheet.cells.F1.value, "2000");
});

test("recalculates dependent formulas after a source cell is committed", async (t) => {
  const { service } = await createService(t);
  await service.writeCells("wb-q3-sales", SHEET, {
    updates: [
      { name: "A1", input: "2" },
      { name: "B1", input: "3" },
      { name: "C1", input: "=A1+B1" },
      { name: "C2", input: "=C1*2" },
    ],
  });

  const updated = await service.writeCells("wb-q3-sales", SHEET, { updates: [{ name: "A1", input: "5" }] });
  const sheet = updated.worksheets.find((worksheet) => worksheet.id === SHEET);
  assert.equal(sheet.cells.C1.value, "8", "directly dependent formula");
  assert.equal(sheet.cells.C2.value, "16", "indirectly dependent formula");
});

test("clearing a cell removes its value and updates dependents", async (t) => {
  const { service } = await createService(t);
  await service.writeCells("wb-q3-sales", SHEET, {
    updates: [
      { name: "A1", input: "2" },
      { name: "B1", input: "=A1*2" },
    ],
  });

  const updated = await service.writeCells("wb-q3-sales", SHEET, { updates: [{ name: "A1", input: "" }] });
  const sheet = updated.worksheets.find((worksheet) => worksheet.id === SHEET);
  assert.equal(sheet.cells.A1, undefined, "the cleared cell is removed");
  assert.equal(sheet.cells.B1.value, "0");
});

test("rejects invalid coordinates and never leaves a partial write", async (t) => {
  const { service } = await createService(t);

  await assert.rejects(
    () =>
      service.writeCells("wb-q3-sales", SHEET, {
        updates: [
          { name: "D1", input: "East" },
          { name: "not-a-cell", input: "1200" },
        ],
      }),
    (error) => error instanceof WorkbookError && error.message === CELL_REFERENCE_INVALID_MESSAGE,
  );
  await assert.rejects(
    () => service.writeCells("wb-q3-sales", SHEET, { updates: [{ name: "AA31", input: "1" }] }),
    (error) => error instanceof WorkbookError && error.message === CELL_OUT_OF_RANGE_MESSAGE,
  );
  await assert.rejects(
    () => service.writeCells("wb-q3-sales", SHEET, { updates: [{ name: "D1", input: 12 }] }),
    (error) => error instanceof WorkbookError,
  );
  await assert.rejects(
    () => service.writeCells("wb-q3-sales", SHEET, { updates: [] }),
    (error) => error instanceof WorkbookError,
  );
  await assert.rejects(
    () => service.writeCells("wb-missing", SHEET, { updates: [{ name: "D1", input: "East" }] }),
    (error) => error instanceof WorkbookError && error.status === 404,
  );

  const workbook = await service.get("wb-q3-sales");
  const sheet = workbook.worksheets.find((worksheet) => worksheet.id === SHEET);
  assert.equal(sheet.cells.D1, undefined, "a rejected write stores nothing");
  assert.equal(sheet.cells.A2.value, "East", "the seeded rows are unchanged");
});

test("rejects a paste of the whole rectangle when one target breaks a 0-to-100 rule", async (t) => {
  const { filePath, service } = await createService(t);
  await service.writeCells("wb-q3-sales", SHEET, {
    updates: [
      { name: "D1", input: "East" },
      { name: "E1", input: "50" },
    ],
  });

  // Persist a numeric 0-to-100 rule the way the data validation feature stores it.
  const stored = JSON.parse(await readFile(filePath, "utf8"));
  stored.workbooks[0].worksheets[0].validations = [{ range: "E1:E2", type: "number", min: 0, max: 100 }];
  await writeFile(filePath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");

  const guarded = createWorkbookService({ filePath });
  await assert.rejects(
    () =>
      guarded.writeCells("wb-q3-sales", SHEET, {
        updates: [
          { name: "D2", input: "North" },
          { name: "E2", input: "101" },
        ],
      }),
    (error) => error instanceof WorkbookError && error.message === NUMBER_ZERO_TO_HUNDRED_MESSAGE,
  );

  const after = await guarded.get("wb-q3-sales");
  const sheet = after.worksheets.find((worksheet) => worksheet.id === SHEET);
  assert.equal(sheet.cells.D2, undefined, "every target in a rejected bulk write keeps its value");
  assert.equal(sheet.cells.E2, undefined);
  assert.equal(sheet.cells.E1.value, "50");

  const accepted = await guarded.writeCells("wb-q3-sales", SHEET, {
    updates: [
      { name: "D2", input: "North" },
      { name: "E2", input: "100" },
    ],
  });
  const sheetAfter = accepted.worksheets.find((worksheet) => worksheet.id === SHEET);
  assert.equal(sheetAfter.cells.D2.value, "North", "cells outside the rule range accept text");
  assert.equal(sheetAfter.cells.E2.value, "100", "the bounds are inclusive");
});

test("persists the complete selection rectangle of each worksheet without changing content", async (t) => {
  const { filePath, service } = await createService(t);

  const updated = await service.setSelection("wb-q3-sales", SHEET, { anchor: "d1", focus: "e2" });
  assert.deepEqual(
    updated.worksheets.find((worksheet) => worksheet.id === SHEET).selection,
    { anchor: "D1", focus: "E2" },
  );
  assert.equal(updated.updatedAt, "2026-10-01T08:00:00.000Z", "selection is not a content change");
  assert.deepEqual(
    updated.worksheets.find((worksheet) => worksheet.id === "ws-q3-sales-sheet2").selection,
    { anchor: "A1", focus: "A1" },
    "the other worksheet keeps its own selection",
  );

  const reopened = createWorkbookService({ filePath });
  const reloaded = await reopened.get("wb-q3-sales");
  assert.deepEqual(
    reloaded.worksheets.find((worksheet) => worksheet.id === SHEET).selection,
    { anchor: "D1", focus: "E2" },
  );
  assert.equal(reloaded.worksheets.find((worksheet) => worksheet.id === SHEET).cells.A1.value, "Region");

  await reopened.setSelection("wb-q3-sales", "ws-q3-sales-sheet2", { anchor: "B2", focus: "C3" });
  const both = await reopened.get("wb-q3-sales");
  assert.deepEqual(both.worksheets[0].selection, { anchor: "D1", focus: "E2" }, "sheet1 keeps its rectangle");
  assert.deepEqual(both.worksheets[1].selection, { anchor: "B2", focus: "C3" });
});

test("rejects an invalid selection and keeps the stored rectangles", async (t) => {
  const { service } = await createService(t);

  await assert.rejects(
    () => service.setSelection("wb-q3-sales", SHEET, { anchor: "D1", focus: "AA31" }),
    (error) => error instanceof WorkbookError && error.message === SELECTION_INVALID_MESSAGE,
  );
  await assert.rejects(
    () => service.setSelection("wb-q3-sales", SHEET, { anchor: "??", focus: "A1" }),
    (error) => error instanceof WorkbookError && error.message === SELECTION_INVALID_MESSAGE,
  );

  const workbook = await service.get("wb-q3-sales");
  assert.deepEqual(workbook.worksheets[0].selection, { anchor: "A1", focus: "A1" });
});

test("writes cells and the selection in one atomic change", async (t) => {
  const { service } = await createService(t);

  const updated = await service.writeCells("wb-q3-sales", SHEET, {
    updates: [{ name: "D1", input: "East" }],
    selection: { anchor: "D1", focus: "E2" },
  });
  const sheet = updated.worksheets.find((worksheet) => worksheet.id === SHEET);
  assert.equal(sheet.cells.D1.value, "East");
  assert.deepEqual(sheet.selection, { anchor: "D1", focus: "E2" });

  await assert.rejects(
    () =>
      service.writeCells("wb-q3-sales", SHEET, {
        updates: [{ name: "D2", input: "North" }],
        selection: { anchor: "A1", focus: "A99" },
      }),
    (error) => error instanceof WorkbookError && error.message === SELECTION_INVALID_MESSAGE,
  );
  const after = await service.get("wb-q3-sales");
  const afterSheet = after.worksheets.find((worksheet) => worksheet.id === SHEET);
  assert.equal(afterSheet.cells.D2, undefined, "the rejected write stored no cell");
  assert.deepEqual(afterSheet.selection, { anchor: "D1", focus: "E2" }, "the rejected write moved no selection");
});

test("recalculates stored formula results after a row or column change", async (t) => {
  const { service } = await createService(t);
  await service.writeCells("wb-q3-sales", SHEET, {
    updates: [
      { name: "A1", input: "2" },
      { name: "A2", input: "3" },
      { name: "C3", input: "=SUM(A1:A2)" },
    ],
  });
  const seeded = await service.get("wb-q3-sales");
  assert.equal(seeded.worksheets[0].cells.C3.value, "5");

  const updated = await service.structure("wb-q3-sales", SHEET, { axis: "row", action: "delete", index: 0 });
  const sheet = updated.worksheets.find((worksheet) => worksheet.id === SHEET);
  assert.equal(sheet.cells.C2.formula, "=SUM(A1:A1)", "the reference follows the removed row");
  assert.equal(sheet.cells.C2.value, "3", "the stored result is recalculated after the structure change");
});
