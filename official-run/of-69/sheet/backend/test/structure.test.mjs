import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LAST_COLUMN_MESSAGE,
  LAST_ROW_MESSAGE,
  STRUCTURE_ACTION_INVALID_MESSAGE,
  STRUCTURE_INDEX_INVALID_MESSAGE,
  WorkbookError,
  createWorkbookService,
} from "../src/lib/workbooks.mjs";
import {
  applyColumnChange,
  applyRowChange,
  shiftFormula,
  structureActions,
} from "../src/lib/structure.mjs";

async function createService(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-structure-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    directory,
    service: createWorkbookService({ filePath: join(directory, "workbooks.json"), ...options }),
  };
}


test("inserts a row above and below the target row, shifting the following records", async (t) => {
  const { service } = await createService(t);

  const below = await service.structure("wb-q3-sales", "ws-q3-sales-sheet1", {
    axis: "row",
    action: "insert-below",
    index: 1,
  });
  const sheet1 = below.worksheets[0];
  assert.equal(sheet1.rowCount, 31);
  assert.equal(sheet1.cells.A1.value, "Region");
  assert.equal(sheet1.cells.B1.value, "Sales");
  assert.equal(sheet1.cells.A2.value, "East");
  assert.equal(sheet1.cells.B2.value, "1200");
  assert.equal(sheet1.cells.A3, undefined);
  assert.equal(sheet1.cells.A4.value, "North");
  assert.equal(sheet1.cells.B4.value, "800");
  assert.deepEqual(below.worksheets[1].cells, {});

  const above = await service.structure("wb-q3-sales", "ws-q3-sales-sheet1", {
    axis: "row",
    action: "insert-above",
    index: 1,
  });
  const shifted = above.worksheets[0];
  assert.equal(shifted.rowCount, 32);
  assert.equal(shifted.cells.A2, undefined);
  assert.equal(shifted.cells.A3.value, "East");
  assert.equal(shifted.cells.A5.value, "North");
  // Column structure and the other worksheet stay untouched.
  assert.equal(shifted.columnCount, 26);
  assert.equal(shifted.cells.B3.value, "1200");
  assert.deepEqual(above.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2"]);
});

test("deletes the target row, drops its rules and shifts the following rows up", async (t) => {
  const { service } = await createService(t);

  const deleted = await service.structure("wb-q3-sales", "ws-q3-sales-sheet1", {
    axis: "row",
    action: "delete",
    index: 1,
  });
  const sheet1 = deleted.worksheets[0];
  assert.equal(sheet1.rowCount, 29);
  assert.equal(sheet1.cells.A1.value, "Region");
  assert.equal(sheet1.cells.A2.value, "North");
  assert.equal(sheet1.cells.B2.value, "800");
  assert.equal(sheet1.cells.A3.value, "South");
  assert.equal(sheet1.cells.B3.value, "700");
  assert.equal(deleted.worksheets[1].name, "Sheet2");
  assert.equal(deleted.worksheets[1].rowCount, 30);
  assert.deepEqual(deleted.worksheets[1].cells, {});
});

test("inserts and deletes columns in the active worksheet only", async (t) => {
  const { service } = await createService(t);

  const inserted = await service.structure("wb-q3-sales", "ws-q3-sales-sheet1", {
    axis: "column",
    action: "insert-left",
    index: 1,
  });
  const sheet1 = inserted.worksheets[0];
  assert.equal(sheet1.columnCount, 27);
  assert.equal(sheet1.rowCount, 30);
  assert.equal(sheet1.cells.A1.value, "Region");
  assert.equal(sheet1.cells.B1, undefined);
  assert.equal(sheet1.cells.C1.value, "Sales");
  assert.equal(sheet1.cells.C2.value, "1200");
  assert.equal(sheet1.cells.A2.value, "East");

  const right = await service.structure("wb-q3-sales", "ws-q3-sales-sheet1", {
    axis: "column",
    action: "insert-right",
    index: 0,
  });
  assert.equal(right.worksheets[0].cells.A1.value, "Region");
  assert.equal(right.worksheets[0].cells.B1, undefined);
  assert.equal(right.worksheets[0].cells.C1, undefined);
  assert.equal(right.worksheets[0].cells.D1.value, "Sales");
  assert.equal(right.worksheets[0].cells.D2.value, "1200");
  assert.equal(right.worksheets[0].cells.A2.value, "East");
  assert.equal(right.worksheets[0].columnCount, 28);

  const removed = await service.structure("wb-q3-sales", "ws-q3-sales-sheet1", {
    axis: "column",
    action: "delete",
    index: 0,
  });
  const afterDelete = removed.worksheets[0];
  assert.equal(afterDelete.columnCount, 27);
  assert.equal(afterDelete.cells.A1, undefined);
  assert.equal(afterDelete.cells.C1.value, "Sales");
  assert.equal(afterDelete.cells.C2.value, "1200");
  assert.equal(afterDelete.cells.C3.value, "800");
  assert.deepEqual(removed.worksheets[1].cells, {});
});

test("keeps the selection on the shifted data and clamps onto a deleted row", (t) => {
  const selected = {
    rowCount: 30,
    columnCount: 26,
    cells: {},
    selection: { anchor: "A2", focus: "B3" },
  };
  assert.deepEqual(applyRowChange(selected, "insert-above", 1).selection, { anchor: "A3", focus: "B4" });
  assert.deepEqual(applyRowChange(selected, "insert-below", 2).selection, { anchor: "A2", focus: "B3" });
  assert.deepEqual(applyRowChange(selected, "delete", 0).selection, { anchor: "A1", focus: "B2" });
  assert.deepEqual(applyRowChange(selected, "delete", 2).selection, { anchor: "A2", focus: "B3" });
  assert.deepEqual(applyRowChange({ ...selected, selection: { anchor: "A30", focus: "A30" } }, "delete", 29).selection, {
    anchor: "A29",
    focus: "A29",
  });
  assert.deepEqual(applyColumnChange(selected, "insert-left", 0).selection, { anchor: "B2", focus: "C3" });
  assert.deepEqual(applyColumnChange(selected, "delete", 1).selection, { anchor: "A2", focus: "B3" });
  assert.equal(applyColumnChange(selected, "delete", 1).columnCount, 25);
});

test("shifts formula references with the moved rows and columns", () => {
  assert.equal(shiftFormula("=B2+C2", { axis: "row", action: "insert-above", index: 0 }), "=B3+C3");
  assert.equal(shiftFormula("=SUM(B2:B5)", { axis: "row", action: "insert-below", index: 1 }), "=SUM(B2:B6)");
  assert.equal(shiftFormula("=SUM(B2:B5)", { axis: "row", action: "delete", index: 2 }), "=SUM(B2:B4)");
  assert.equal(shiftFormula("=SUM(B2:B5)", { axis: "row", action: "delete", index: 4 }), "=SUM(B2:B4)");
  assert.equal(shiftFormula("=SUM(B2:B5)", { axis: "row", action: "delete", index: 0 }), "=SUM(B1:B4)");
  assert.equal(shiftFormula("=SUM(B4:B4)", { axis: "row", action: "delete", index: 3 }), "=SUM(#REF!)");
  assert.equal(shiftFormula("=A2+$B$2+$B2+B$2", { axis: "row", action: "insert-above", index: 0 }), "=A3+$B$3+$B3+B$3");
  assert.equal(shiftFormula("=B4+A2", { axis: "row", action: "delete", index: 3 }), "=#REF!+A2");
  assert.equal(shiftFormula("=C2+D2", { axis: "column", action: "insert-left", index: 0 }), "=D2+E2");
  assert.equal(shiftFormula("=C2+D2", { axis: "column", action: "delete", index: 2 }), "=#REF!+C2");
  assert.equal(shiftFormula("=SUM(C2:D5)", { axis: "column", action: "delete", index: 3 }), "=SUM(C2:C5)");
  assert.equal(shiftFormula("=SUM(C2:C2)", { axis: "column", action: "delete", index: 2 }), "=SUM(#REF!)");
  assert.equal(shiftFormula("=LOG10(B2)", { axis: "row", action: "insert-above", index: 0 }), "=LOG10(B3)");
  assert.equal(shiftFormula('=CONCAT("A1",B2)', { axis: "row", action: "insert-above", index: 0 }), '=CONCAT("A1",B3)');
});

test("keeps the adjusted formula text and coordinates when rows and columns move", () => {
  const worksheet = {
    rowCount: 10,
    columnCount: 5,
    cells: {
      A1: { value: "3", formula: "=1+2" },
      A2: { value: "9", formula: "=A1*3" },
      B2: { value: "12" },
      A3: { value: "8" },
    },
    selection: { anchor: "A2", focus: "A2" },
  };

  const inserted = applyRowChange(worksheet, "insert-above", 1);
  assert.equal(inserted.cells.A1.value, "3");
  assert.equal(inserted.cells.A1.formula, "=1+2");
  assert.equal(inserted.cells.A3.value, "9");
  assert.equal(inserted.cells.A3.formula, "=A1*3");
  assert.equal(inserted.cells.B3.value, "12");
  assert.equal(inserted.cells.A4.value, "8");
  assert.deepEqual(inserted.selection, { anchor: "A3", focus: "A3" });

  const deleted = applyRowChange(worksheet, "delete", 0);
  assert.equal(deleted.cells.A1.value, "9");
  assert.equal(deleted.cells.A1.formula, "=#REF!*3");
  assert.equal(deleted.cells.A2.value, "8");
  assert.equal(deleted.cells.B1.value, "12");
  assert.deepEqual(deleted.selection, { anchor: "A1", focus: "A1" });

  const formulaSheet = {
    rowCount: 10,
    columnCount: 5,
    cells: { A1: { value: "3" }, B1: { value: "9", formula: "=A1*3" }, A2: { value: "8" } },
    selection: { anchor: "B1", focus: "B1" },
  };
  const columnDeleted = applyColumnChange(formulaSheet, "delete", 0);
  assert.equal(columnDeleted.cells.A1.formula, "=#REF!*3");
  assert.equal(columnDeleted.cells.A1.value, "9");
  assert.equal(columnDeleted.cells.A2, undefined);
  assert.equal(columnDeleted.columnCount, 4);
  assert.deepEqual(columnDeleted.selection, { anchor: "A1", focus: "A1" });

  const columnInserted = applyColumnChange(formulaSheet, "insert-left", 0);
  assert.equal(columnInserted.cells.B1.value, "3");
  assert.equal(columnInserted.cells.C1.value, "9");
  assert.equal(columnInserted.cells.C1.formula, "=B1*3");
  assert.equal(columnInserted.columnCount, 6);
});

test("persists a structure change across service instances and rejects invalid requests", async (t) => {
  const { directory, service } = await createService(t, { now: () => "2026-10-03T14:00:00.000Z" });

  const updated = await service.structure("wb-q3-sales", "ws-q3-sales-sheet2", {
    axis: "row",
    action: "insert-below",
    index: 0,
  });
  assert.equal(updated.updatedAt, "2026-10-03T14:00:00.000Z");
  assert.equal(updated.worksheets[1].rowCount, 31);
  assert.equal(updated.worksheets[0].rowCount, 30);
  assert.equal(updated.worksheets[0].cells.A3.value, "North");

  const reopened = createWorkbookService({ filePath: join(directory, "workbooks.json") });
  const persisted = await reopened.get("wb-q3-sales");
  assert.equal(persisted.worksheets[1].rowCount, 31);
  assert.equal(persisted.worksheets[0].cells.A2.value, "East");

  for (const [params, message] of [
    [{ axis: "row", action: "insert-left", index: 0 }, STRUCTURE_ACTION_INVALID_MESSAGE],
    [{ axis: "diagonal", action: "insert-above", index: 0 }, STRUCTURE_ACTION_INVALID_MESSAGE],
    [{ axis: "row", action: "insert-above", index: 31 }, STRUCTURE_INDEX_INVALID_MESSAGE],
    [{ axis: "row", action: "delete", index: 30 }, STRUCTURE_INDEX_INVALID_MESSAGE],
    [{ axis: "column", action: "insert-right", index: -1 }, STRUCTURE_INDEX_INVALID_MESSAGE],
    [{ axis: "column", action: "delete", index: 26 }, STRUCTURE_INDEX_INVALID_MESSAGE],
    [{ axis: "row", action: "insert-below" }, STRUCTURE_INDEX_INVALID_MESSAGE],
    [{ axis: "row", action: "insert-below", index: 1.5 }, STRUCTURE_INDEX_INVALID_MESSAGE],
    [{ axis: "column", action: "delete", index: "x" }, STRUCTURE_INDEX_INVALID_MESSAGE],
  ]) {
    await assert.rejects(
      () => service.structure("wb-q3-sales", "ws-q3-sales-sheet1", params),
      (error) => {
        assert.ok(error instanceof WorkbookError);
        assert.equal(error.status, 400);
        assert.equal(error.message, message);
        return true;
      },
    );
  }

  const afterFailures = await service.get("wb-q3-sales");
  assert.equal(afterFailures.worksheets[0].rowCount, 30);
  assert.equal(afterFailures.worksheets[0].columnCount, 26);
  assert.equal(afterFailures.worksheets[0].cells.A2.value, "East");
  assert.equal(afterFailures.worksheets[0].cells.A3.value, "North");
  assert.equal(afterFailures.worksheets[1].rowCount, 31);

  await assert.rejects(
    () => service.structure("wb-q3-sales", "ws-missing", { axis: "row", action: "delete", index: 0 }),
    (error) => error.status === 404,
  );
  await assert.rejects(
    () => service.structure("missing", "ws-q3-sales-sheet1", { axis: "row", action: "delete", index: 0 }),
    (error) => error.status === 404,
  );
  assert.equal(structureActions("row").includes("delete"), true);
  assert.equal(structureActions("column").includes("insert-left"), true);
  assert.equal(structureActions("other"), null);
});

test("refuses to delete the only remaining row or column", async (t) => {
  const { service } = await createService(t, { now: () => "2026-10-03T15:00:00.000Z" });
  const worksheetId = "ws-q3-sales-sheet1";

  let workbook = await service.get("wb-q3-sales");
  while (workbook.worksheets[0].rowCount > 1) {
    workbook = await service.structure("wb-q3-sales", worksheetId, { axis: "row", action: "delete", index: 0 });
  }
  assert.equal(workbook.worksheets[0].rowCount, 1);
  await assert.rejects(
    () => service.structure("wb-q3-sales", worksheetId, { axis: "row", action: "delete", index: 0 }),
    (error) => error.message === LAST_ROW_MESSAGE && error.status === 400,
  );
  assert.equal((await service.get("wb-q3-sales")).worksheets[0].rowCount, 1);

  while (workbook.worksheets[0].columnCount > 1) {
    workbook = await service.structure("wb-q3-sales", worksheetId, { axis: "column", action: "delete", index: 0 });
  }
  assert.equal(workbook.worksheets[0].columnCount, 1);
  await assert.rejects(
    () => service.structure("wb-q3-sales", worksheetId, { axis: "column", action: "delete", index: 0 }),
    (error) => error.message === LAST_COLUMN_MESSAGE && error.status === 400,
  );
  assert.equal((await service.get("wb-q3-sales")).worksheets[0].columnCount, 1);
});
