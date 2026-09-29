import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HttpError, createWorkbookService } from "../src/workbook-service.mjs";

async function freshService() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-workbook-"));
  return createWorkbookService({ dataDir });
}

const seededSheet1 = {
  id: "ws-seed-q3-1",
  name: "Sheet1",
  cells: {
    A1: { value: "Region" },
    B1: { value: "Sales" },
    C1: { value: "Status" },
    A2: { value: "East" },
    B2: { value: "1200" },
    C2: { value: "Open" },
    A3: { value: "North" },
    B3: { value: "800" },
    C3: { value: "Closed" },
    A4: { value: "South" },
    B4: { value: "700" },
    C4: { value: "Open" },
  },
};

const seededSheet2 = { id: "ws-seed-q3-2", name: "Sheet2", cells: {} };

/** Writes a workbook into a fresh store so tests can seed synthetic cells and rules. */
async function serviceWithWorkbook(workbook) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-workbook-"));
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    join(dataDir, "state.json"),
    `${JSON.stringify({ workbooks: [workbook] }, null, 2)}\n`,
    "utf8",
  );
  return createWorkbookService({ dataDir });
}

function baseWorkbook(extra) {
  return {
    id: "wb-test",
    name: "Q3 Sales",
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
    activeSheetId: seededSheet1.id,
    sheets: [structuredClone(seededSheet1), structuredClone(seededSheet2)],
    ...extra,
  };
}

test("seeds the Q3 Sales workbook with Sheet1/Sheet2, seeded headers and rows", async () => {
  const service = await freshService();
  const workbooks = await service.listWorkbooks();
  assert.equal(workbooks.length, 1);
  assert.equal(workbooks[0].name, "Q3 Sales");
  assert.ok(workbooks[0].updatedAt);

  const workbook = await service.getWorkbook(workbooks[0].id);
  assert.equal(workbook.name, "Q3 Sales");
  assert.equal(workbook.sheets.length, 2);
  assert.deepEqual(
    workbook.sheets.map((sheet) => sheet.name),
    ["Sheet1", "Sheet2"],
  );
  assert.equal(workbook.sheets[0].name, "Sheet1");
  assert.equal(workbook.sheets[0].cells.A1.value, "Region");
  assert.equal(workbook.sheets[0].cells.B1.value, "Sales");
  assert.equal(workbook.sheets[0].cells.C1.value, "Status");
  assert.equal(workbook.sheets[0].cells.A2.value, "East");
  assert.equal(workbook.sheets[0].cells.B2.value, "1200");
  assert.equal(workbook.sheets[0].cells.C2.value, "Open");
  assert.equal(workbook.sheets[0].cells.A3.value, "North");
  assert.equal(workbook.sheets[0].cells.B3.value, "800");
  assert.equal(workbook.sheets[0].cells.C3.value, "Closed");
  assert.equal(workbook.sheets[0].cells.A4.value, "South");
  assert.equal(workbook.sheets[0].cells.B4.value, "700");
  assert.equal(workbook.sheets[0].cells.C4.value, "Open");
  assert.deepEqual(workbook.sheets[1].cells, {});
  assert.equal(workbook.activeSheetId, workbook.sheets[0].id);
});

test("creates a blank workbook with an active Sheet1 and no cells", async () => {
  const service = await freshService();
  const workbook = await service.createBlankWorkbook();
  assert.equal(workbook.name, "Untitled workbook");
  assert.equal(workbook.sheets.length, 1);
  assert.equal(workbook.sheets[0].name, "Sheet1");
  assert.deepEqual(workbook.sheets[0].cells, {});
  assert.equal(workbook.activeSheetId, workbook.sheets[0].id);
  const listed = await service.listWorkbooks();
  assert.equal(listed.length, 2);
});

test("renames a workbook, trims the name and persists it", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const renamed = await service.renameWorkbook(summary.id, "  FY25 Sales  ");
  assert.equal(renamed.name, "FY25 Sales");

  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.name, "FY25 Sales");
});

test("rejects an empty workbook name without changing the record", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  await assert.rejects(
    () => service.renameWorkbook(summary.id, "   "),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "Workbook name cannot be empty");
      return true;
    },
  );
  const workbook = await service.getWorkbook(summary.id);
  assert.equal(workbook.name, "Q3 Sales");
});

test("adds a worksheet with the first unused SheetN name and makes it active", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const updated = await service.addWorksheet(summary.id);
  assert.deepEqual(
    updated.sheets.map((sheet) => sheet.name),
    ["Sheet1", "Sheet2", "Sheet3"],
  );
  const added = updated.sheets[2];
  assert.deepEqual(added.cells, {});
  assert.equal(updated.activeSheetId, added.id);
  assert.equal(updated.sheets[0].cells.A2.value, "East");

  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets.length, 3);
  assert.equal(reopened.activeSheetId, added.id);
  assert.equal(reopened.sheets[2].name, "Sheet3");
});

test("add worksheet reuses the first unused SheetN after renames", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  await service.renameSheet(workbook.id, workbook.sheets[0].id, "Data");
  await service.renameSheet(workbook.id, workbook.sheets[1].id, "Totals");
  const updated = await service.addWorksheet(workbook.id);
  assert.equal(updated.sheets[2].name, "Sheet1");
});

test("renames a worksheet, trims the name and persists it", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const updated = await service.renameSheet(workbook.id, workbook.sheets[0].id, "  Data  ");
  assert.equal(updated.sheets[0].name, "Data");

  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].name, "Data");
  assert.equal(reopened.sheets[1].name, "Sheet2");
});

test("rejects an empty worksheet name without changing the record", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  await assert.rejects(
    () => service.renameSheet(workbook.id, workbook.sheets[0].id, "   "),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "Worksheet name cannot be empty");
      return true;
    },
  );
  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].name, "Sheet1");
});

test("rejects a duplicate worksheet name without changing the record", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  await assert.rejects(
    () => service.renameSheet(workbook.id, workbook.sheets[0].id, "Sheet2"),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "Worksheet name already exists");
      return true;
    },
  );
  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].name, "Sheet1");
  assert.equal(reopened.sheets[1].name, "Sheet2");
});

test("rejects renaming a missing worksheet", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  await assert.rejects(
    () => service.renameSheet(summary.id, "missing", "Data"),
    (error) => error instanceof HttpError && error.status === 404,
  );
});

test("deletes a worksheet: target and its data disappear and persist after reopen", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const deleted = await service.deleteSheet(workbook.id, workbook.sheets[1].id);
  assert.deepEqual(
    deleted.sheets.map((sheet) => sheet.name),
    ["Sheet1"],
  );
  assert.equal(deleted.activeSheetId, workbook.sheets[0].id);
  // The remaining worksheet and its data are untouched.
  assert.equal(deleted.sheets[0].cells.A2.value, "East");
  assert.equal(deleted.sheets[0].cells.B2.value, "1200");

  const reopened = await service.getWorkbook(summary.id);
  assert.deepEqual(
    reopened.sheets.map((sheet) => sheet.name),
    ["Sheet1"],
  );
  assert.equal(reopened.sheets[0].cells.A3.value, "North");
  assert.equal(reopened.sheets[0].cells.B3.value, "800");
});

test("deleting the active worksheet makes an adjacent worksheet active", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  // Activate Sheet2 first, then delete it; the adjacent Sheet1 becomes active.
  await service.setActiveSheet(workbook.id, workbook.sheets[1].id);
  const deleted = await service.deleteSheet(workbook.id, workbook.sheets[1].id);
  assert.equal(deleted.sheets.length, 1);
  assert.equal(deleted.activeSheetId, deleted.sheets[0].id);
  assert.equal(deleted.sheets[0].name, "Sheet1");

  // Build a three-sheet workbook; deleting the first makes the next active.
  await service.addWorksheet(summary.id);
  await service.addWorksheet(summary.id);
  const three = await service.getWorkbook(summary.id);
  assert.deepEqual(
    three.sheets.map((sheet) => sheet.name),
    ["Sheet1", "Sheet2", "Sheet3"],
  );
  await service.setActiveSheet(three.id, three.sheets[0].id);
  const afterDelete = await service.deleteSheet(three.id, three.sheets[0].id);
  assert.deepEqual(
    afterDelete.sheets.map((sheet) => sheet.name),
    ["Sheet2", "Sheet3"],
  );
  assert.equal(afterDelete.activeSheetId, afterDelete.sheets[0].id);

  // Deleting the last sheet makes the previous one active.
  const last = await service.getWorkbook(summary.id);
  await service.setActiveSheet(last.id, last.sheets[last.sheets.length - 1].id);
  const afterLast = await service.deleteSheet(last.id, last.sheets[last.sheets.length - 1].id);
  assert.deepEqual(
    afterLast.sheets.map((sheet) => sheet.name),
    ["Sheet2"],
  );
  assert.equal(afterLast.activeSheetId, afterLast.sheets[0].id);
});

test("deleting a non-active worksheet keeps the active worksheet active", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  await service.setActiveSheet(workbook.id, workbook.sheets[0].id);
  const deleted = await service.deleteSheet(workbook.id, workbook.sheets[1].id);
  assert.equal(deleted.activeSheetId, workbook.sheets[0].id);
  assert.deepEqual(
    deleted.sheets.map((sheet) => sheet.name),
    ["Sheet1"],
  );
});

test("rejects deleting the last worksheet and leaves the store unchanged", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  await service.deleteSheet(workbook.id, workbook.sheets[1].id);
  const single = await service.getWorkbook(summary.id);
  await assert.rejects(
    () => service.deleteSheet(single.id, single.sheets[0].id),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "A workbook must contain at least one worksheet");
      return true;
    },
  );
  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets.length, 1);
  assert.equal(reopened.sheets[0].name, "Sheet1");
  assert.equal(reopened.sheets[0].cells.A2.value, "East");
});

test("rejects deleting a pivot source worksheet and preserves both worksheets", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const created = await service.createPivot(workbook.id, {
    sourceSheetId: workbook.sheets[0].id,
    sourceRange: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
  });
  const pivotSheet = created.sheets[2];
  await service.applyPivot(created.id, pivotSheet.id, {
    rowField: "Region",
    columnField: null,
    valueField: "Sales",
    summarizeBy: "SUM",
  });
  const before = await service.getWorkbook(created.id);
  await assert.rejects(
    () => service.deleteSheet(before.id, before.sheets[0].id),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "Please delete or rebuild dependent pivot tables first");
      return true;
    },
  );
  const reopened = await service.getWorkbook(created.id);
  // Source data and pivot results remain unchanged.
  assert.equal(reopened.sheets[0].cells.A2.value, "East");
  assert.equal(reopened.sheets[0].cells.B2.value, "1200");
  assert.equal(reopened.sheets[2].name, "Pivot1");
  assert.equal(reopened.sheets[2].cells.B5.value, "2700");
});

test("deleting a pivot result worksheet releases its source from the pivot constraint", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const created = await service.createPivot(workbook.id, {
    sourceSheetId: workbook.sheets[0].id,
    sourceRange: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
  });
  const pivotSheet = created.sheets[2];
  await service.applyPivot(created.id, pivotSheet.id, {
    rowField: "Region",
    columnField: null,
    valueField: "Sales",
    summarizeBy: "SUM",
  });
  const withPivot = await service.getWorkbook(created.id);
  // Pivot1 is the active sheet; deleting it activates the adjacent Sheet2.
  const after = await service.deleteSheet(withPivot.id, withPivot.sheets[2].id);
  assert.deepEqual(
    after.sheets.map((sheet) => sheet.name),
    ["Sheet1", "Sheet2"],
  );
  assert.equal(after.activeSheetId, after.sheets[1].id);
  // The source is no longer constrained: it can be deleted now.
  const freed = await service.getWorkbook(created.id);
  const final = await service.deleteSheet(freed.id, freed.sheets[0].id);
  assert.deepEqual(
    final.sheets.map((sheet) => sheet.name),
    ["Sheet2"],
  );
  const reopened = await service.getWorkbook(created.id);
  assert.equal(reopened.sheets.length, 1);
});

test("formulas referencing the deleted worksheet resolve to #REF!", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: { D1: "=Sheet2!A1+1" },
  });
  const deleted = await service.deleteSheet(workbook.id, workbook.sheets[1].id);
  assert.equal(deleted.sheets[0].cells.D1.value, "#REF!");
});

test("inserts a row above and shifts cells, formulas and validation rules down", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].cells.A2 = { value: "North" };
  workbook.sheets[0].cells.B2 = { value: "800" };
  workbook.sheets[0].cells.E4 = { value: "sum-result", formula: "=SUM(A2:B2)" };
  workbook.sheets[0].validationRules = [
    { id: "r1", range: { start: { row: 1, column: 1 }, end: { row: 2, column: 2 } } },
  ];
  const service = await serviceWithWorkbook(workbook);
  const updated = await service.changeSheetStructure(workbook.id, workbook.sheets[0].id, {
    op: "insert-row-above",
    index: 2,
  });
  const shifted = updated.sheets[0];
  assert.equal(shifted.cells.A3.value, "North");
  assert.equal(shifted.cells.B3.value, "800");
  assert.equal(shifted.cells.A2, undefined);
  assert.equal(shifted.cells.B2, undefined);
  assert.equal(shifted.cells.E5.formula, "=SUM(A3:B3)");
  assert.deepEqual(shifted.validationRules[0].range, {
    start: { row: 1, column: 1 },
    end: { row: 3, column: 2 },
  });

  const reopened = await service.getWorkbook(workbook.id);
  assert.equal(reopened.sheets[0].cells.A3.value, "North");
  assert.equal(reopened.sheets[0].cells.E5.formula, "=SUM(A3:B3)");
});

test("inserts a row below a target row", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const updated = await service.changeSheetStructure(workbook.id, workbook.sheets[0].id, {
    op: "insert-row-below",
    index: 1,
  });
  const cells = updated.sheets[0].cells;
  assert.equal(cells.A1.value, "Region");
  assert.equal(cells.B1.value, "Sales");
  assert.equal(cells.C1.value, "Status");
  assert.equal(cells.A2, undefined);
  assert.equal(cells.B2, undefined);
  assert.equal(cells.A3.value, "East");
  assert.equal(cells.B3.value, "1200");
  assert.equal(cells.C3.value, "Open");
  assert.equal(cells.A4.value, "North");
  assert.equal(cells.B4.value, "800");
});

test("deletes a row, shifts subsequent rows up and removes its rules", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].cells.A3 = { value: "North" };
  workbook.sheets[0].cells.B3 = { value: "800" };
  workbook.sheets[0].cells.D1 = { value: "a1", formula: "=A1" };
  workbook.sheets[0].cells.D4 = { value: "total", formula: "=A2+B2" };
  workbook.sheets[0].validationRules = [
    { id: "target", range: { start: { row: 2, column: 1 }, end: { row: 2, column: 2 } } },
    { id: "span", range: { start: { row: 1, column: 1 }, end: { row: 3, column: 2 } } },
  ];
  const service = await serviceWithWorkbook(workbook);
  const updated = await service.changeSheetStructure(workbook.id, workbook.sheets[0].id, { op: "delete-row", index: 2 });
  const shifted = updated.sheets[0];
  assert.equal(shifted.cells.A2.value, "North");
  assert.equal(shifted.cells.B2.value, "800");
  assert.equal(shifted.cells.A1.value, "Region");
  assert.equal(shifted.cells.A3.value, "South");
  assert.equal(shifted.cells.A4, undefined);
  assert.equal(shifted.cells.D1.formula, "=A1");
  assert.equal(shifted.cells.D3.value, "#REF!");
  assert.equal(shifted.cells.D3.formula, "=#REF!+#REF!");
  assert.equal(shifted.validationRules.length, 1);
  assert.equal(shifted.validationRules[0].id, "span");
  assert.deepEqual(shifted.validationRules[0].range, {
    start: { row: 1, column: 1 },
    end: { row: 2, column: 2 },
  });
});

test("inserts a column left and shifts data and formulas right", async () => {
  const workbook = baseWorkbook();
  const service = await serviceWithWorkbook(workbook);
  const updated = await service.changeSheetStructure(workbook.id, workbook.sheets[0].id, {
    op: "insert-column-left",
    index: 2,
  });
  const cells = updated.sheets[0].cells;
  assert.equal(cells.A1.value, "Region");
  assert.equal(cells.C1.value, "Sales");
  assert.equal(cells.D1.value, "Status");
  assert.equal(cells.B1, undefined);
  assert.equal(cells.C2.value, "1200");
  assert.equal(cells.D2.value, "Open");
  assert.equal(cells.C3.value, "800");
  assert.equal(cells.D3.value, "Closed");
});

test("inserts a column right of the target column", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const updated = await service.changeSheetStructure(workbook.id, workbook.sheets[0].id, {
    op: "insert-column-right",
    index: 1,
  });
  const cells = updated.sheets[0].cells;
  assert.equal(cells.A1.value, "Region");
  assert.equal(cells.B1, undefined);
  assert.equal(cells.C1.value, "Sales");
  assert.equal(cells.D1.value, "Status");
  assert.equal(cells.C2.value, "1200");
  assert.equal(cells.D2.value, "Open");
  assert.equal(cells.C3.value, "800");
  assert.equal(cells.D3.value, "Closed");
});

test("deletes a column, shifts subsequent columns left and preserves other data", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].cells.A3 = { value: "North" };
  workbook.sheets[0].cells.B3 = { value: "800" };
  workbook.sheets[0].cells.E1 = { value: "b1", formula: "=B1" };
  workbook.sheets[0].cells.F1 = { value: "c1", formula: "=C1" };
  workbook.sheets[0].cells.E2 = { value: "sum", formula: "=SUM(B1:C1)" };
  const service = await serviceWithWorkbook(workbook);
  const updated = await service.changeSheetStructure(workbook.id, workbook.sheets[0].id, { op: "delete-column", index: 2 });
  const cells = updated.sheets[0].cells;
  assert.equal(cells.A1.value, "Region");
  assert.equal(cells.A3.value, "North");
  assert.equal(cells.B1.value, "Status");
  assert.equal(cells.B2.value, "Open");
  assert.equal(cells.B3.value, "Closed");
  assert.equal(cells.D1.value, "#REF!");
  assert.equal(cells.D1.formula, "=#REF!");
  assert.equal(cells.D2.formula, "=SUM(B1:B1)");
  assert.equal(cells.D2.value, "0");
});

test("keeps other worksheets unchanged during structure changes", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  await service.changeSheetStructure(workbook.id, workbook.sheets[0].id, { op: "delete-row", index: 1 });
  const reopened = await service.getWorkbook(summary.id);
  assert.deepEqual(reopened.sheets[1].cells, {});
  assert.equal(reopened.sheets[1].name, "Sheet2");
});

test("shifts pivot source ranges and marks broken pivot fields on column deletion", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].pivot = {
    sourceRange: { start: { row: 1, column: 1 }, end: { row: 3, column: 2 } },
    columns: [{ sourceColumn: 2 }],
    rows: [{ sourceRow: 1 }],
    result: "cached",
  };
  const service = await serviceWithWorkbook(workbook);
  const updated = await service.changeSheetStructure(workbook.id, workbook.sheets[0].id, { op: "delete-column", index: 2 });
  const pivot = updated.sheets[0].pivot;
  assert.equal(pivot.result, "cached");
  assert.equal(pivot.broken, true);
  assert.deepEqual(pivot.sourceRange, {
    start: { row: 1, column: 1 },
    end: { row: 3, column: 1 },
  });
  assert.equal(pivot.columns[0].sourceColumn, 2);
});

test("rejects invalid structure operations without changing the store", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  await assert.rejects(
    () => service.changeSheetStructure(workbook.id, workbook.sheets[0].id, { op: "bogus", index: 1 }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      return true;
    },
  );
  await assert.rejects(
    () => service.changeSheetStructure(workbook.id, workbook.sheets[0].id, { op: "delete-row", index: 0 }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      return true;
    },
  );
  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].cells.A1.value, "Region");
  assert.equal(reopened.sheets[0].cells.B1.value, "Sales");
});

test("imports a CSV file as a workbook named after the file without .csv", async () => {
  const service = await freshService();
  const workbook = await service.importWorkbook({
    fileName: "sales-data.csv",
    csv: "Region,Amount\nEast,1200\nNorth,800",
  });
  assert.equal(workbook.name, "sales-data");
  assert.equal(workbook.sheets.length, 1);
  assert.equal(workbook.sheets[0].name, "Sheet1");
  assert.equal(workbook.sheets[0].cells.A1.value, "Region");
  assert.equal(workbook.sheets[0].cells.B1.value, "Amount");
  assert.equal(workbook.sheets[0].cells.A2.value, "East");
  assert.equal(workbook.sheets[0].cells.B2.value, "1200");
  assert.equal(workbook.sheets[0].cells.A3.value, "North");
  assert.equal(workbook.sheets[0].cells.B3.value, "800");
});

test("import preserves empty fields and quoted content", async () => {
  const service = await freshService();
  const workbook = await service.importWorkbook({
    fileName: "data.csv",
    csv: 'a,"East, West"\n"say ""hi""",\n\n',
  });
  const cells = workbook.sheets[0].cells;
  assert.equal(cells.A1.value, "a");
  assert.equal(cells.B1.value, "East, West");
  assert.equal(cells.A2.value, 'say "hi"');
  assert.equal(cells.B2.value, "");
  assert.equal(cells.A3.value, "");
});

test("failed import leaves the store unchanged and no workbook link appears", async () => {
  const service = await freshService();
  await assert.rejects(
    () => service.importWorkbook({ fileName: "broken.csv", csv: 'a,"unclosed' }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.message, "Invalid CSV file format. Import failed.");
      return true;
    },
  );
  const listed = await service.listWorkbooks();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, "Q3 Sales");
  assert.ok(!listed.some((item) => item.name === "broken"));
});

test("export returns the active worksheet used range with empty cells preserved", async () => {
  const service = await freshService();
  const workbook = await service.importWorkbook({
    fileName: "data.csv",
    csv: "a,b,c\n1,,3\n",
  });
  const { text, fileName } = await service.exportActiveSheet(workbook.id);
  assert.equal(text, "a,b,c\r\n1,,3\r\n");
  assert.equal(fileName, "data.csv");
});

test("export escapes commas, quotes and line breaks and uses calculated values", async () => {
  const service = await freshService();
  const workbook = await service.importWorkbook({
    fileName: "data.csv",
    csv: 'plain,"East, West"\n"say ""hi""","line1\nline2"\n',
  });
  const { text } = await service.exportActiveSheet(workbook.id);
  assert.equal(text, 'plain,"East, West"\r\n"say ""hi""","line1\nline2"\r\n');
});

test("export of the seeded workbook returns the used range with the seeded values", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const { text } = await service.exportActiveSheet(summary.id);
  assert.equal(text, "Region,Sales,Status\r\nEast,1200,Open\r\nNorth,800,Closed\r\nSouth,700,Open\r\n");
});

test("sets and persists the active worksheet", async () => {
  const service = await freshService();
  const workbook = await service.importWorkbook({ fileName: "other.csv", csv: "x" });
  const sheetId = workbook.sheets[0].id;

  const updated = await service.setActiveSheet(workbook.id, sheetId);
  assert.equal(updated.activeSheetId, sheetId);
  const reopened = await service.getWorkbook(workbook.id);
  assert.equal(reopened.activeSheetId, sheetId);
  await assert.rejects(
    () => service.setActiveSheet(workbook.id, "missing-sheet"),
    (error) => error instanceof HttpError && error.status === 404,
  );
});

test("unknown workbook ids are rejected", async () => {
  const service = await freshService();
  await assert.rejects(() => service.getWorkbook("nope"), (error) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 404);
    return true;
  });
});

test("updateCells writes plain values and persists them", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const updated = await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: { D1: "East", E1: "1200", D2: "North", E2: "800" },
  });
  const cells = updated.sheets[0].cells;
  assert.equal(cells.D1.value, "East");
  assert.equal(cells.E1.value, "1200");
  assert.equal(cells.D2.value, "North");
  assert.equal(cells.E2.value, "800");
  assert.equal(cells.A1.value, "Region");

  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].cells.D1.value, "East");
  assert.equal(reopened.sheets[0].cells.E2.value, "800");
});

test("updateCells stores the original formula and a computed value", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: { E1: "=B2+2", E2: "=E1*2" },
  });
  const reopened = await service.getWorkbook(summary.id);
  const sheet = reopened.sheets[0];
  assert.equal(sheet.cells.E1.formula, "=B2+2");
  assert.equal(sheet.cells.E1.value, "1202");
  assert.equal(sheet.cells.E2.formula, "=E1*2");
  assert.equal(sheet.cells.E2.value, "2404");
});

test("editing a source value recalculates direct and indirect dependents", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: { E1: "=B1*3", E2: "=E1+1" },
  });
  const updated = await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: { B1: "10" },
  });
  assert.equal(updated.sheets[0].cells.E1.value, "30");
  assert.equal(updated.sheets[0].cells.E2.value, "31");
});

test("a malformed formula is stored, displays #ERROR! and persists", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const updated = await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: { E1: "=1+", E2: "=E1+1" },
  });
  assert.equal(updated.sheets[0].cells.E1.formula, "=1+");
  assert.equal(updated.sheets[0].cells.E1.value, "#ERROR!");
  assert.equal(updated.sheets[0].cells.E2.value, "#ERROR!");

  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].cells.E1.formula, "=1+");
  assert.equal(reopened.sheets[0].cells.E1.value, "#ERROR!");
  assert.equal(reopened.sheets[0].cells.C1.value, "Status");
});

test("fixing an error cell recalculates its dependents", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: { E1: "=1/0", E2: "=E1+1" },
  });
  const errored = await service.getWorkbook(summary.id);
  assert.equal(errored.sheets[0].cells.E1.value, "#DIV/0!");
  assert.equal(errored.sheets[0].cells.E2.value, "#DIV/0!");

  const fixed = await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: { E1: "=B2*4" },
  });
  assert.equal(fixed.sheets[0].cells.E1.value, "4800");
  assert.equal(fixed.sheets[0].cells.E1.formula, "=B2*4");
  assert.equal(fixed.sheets[0].cells.E2.value, "4801");
  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].cells.E1.value, "4800");
  assert.equal(reopened.sheets[0].cells.E2.value, "4801");
});

test("a 0-to-100 numeric validation rule rejects violating writes atomically", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].validationRules = [
    { id: "r1", type: "number", min: 0, max: 100, range: { start: { row: 1, column: 4 }, end: { row: 2, column: 5 } } },
  ];
  const service = await serviceWithWorkbook(workbook);
  await assert.rejects(
    () => service.updateCells(workbook.id, workbook.sheets[0].id, { cells: { D1: "150" } }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "Please enter a number from 0 to 100");
      return true;
    },
  );
  const reopened = await service.getWorkbook(workbook.id);
  assert.equal(reopened.sheets[0].cells.D1, undefined);
  assert.equal(reopened.sheets[0].cells.A1.value, "Region");

  const ok = await service.updateCells(workbook.id, workbook.sheets[0].id, { cells: { D1: "80" } });
  assert.equal(ok.sheets[0].cells.D1.value, "80");
});

test("transferRange copy pastes the rectangle and keeps the source unchanged", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const updated = await service.transferRange(workbook.id, workbook.sheets[0].id, {
    source: { start: { row: 1, column: 1 }, end: { row: 1, column: 2 } },
    target: { start: { row: 1, column: 4 }, end: { row: 1, column: 4 } },
    mode: "copy",
  });
  const cells = updated.sheets[0].cells;
  assert.equal(cells.D1.value, "Region");
  assert.equal(cells.E1.value, "Sales");
  assert.equal(cells.A1.value, "Region");
  assert.equal(cells.B1.value, "Sales");
  assert.equal(cells.C2.value, "Open");

  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].cells.D1.value, "Region");
  assert.equal(reopened.sheets[0].cells.E1.value, "Sales");
});

test("transferRange adjusts relative formula references and keeps absolute ones", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].cells.A1 = { value: "5" };
  workbook.sheets[0].cells.B1 = { value: "6" };
  workbook.sheets[0].cells.A2 = { value: "7" };
  workbook.sheets[0].cells.B2 = { value: "8" };
  workbook.sheets[0].cells.C1 = { value: "26", formula: "=A1+$B$2+B$1+$A2" };
  workbook.sheets[0].cells.C2 = { value: "26", formula: "=SUM(A1:B2)" };
  workbook.sheets[0].cells.C3 = { value: "1" };
  workbook.sheets[0].cells.D1 = { value: "2" };
  workbook.sheets[0].cells.A4 = { value: "3" };
  workbook.sheets[0].cells.D3 = { value: "4" };
  workbook.sheets[0].cells.C4 = { value: "5" };
  workbook.sheets[0].cells.D4 = { value: "6" };
  const service = await serviceWithWorkbook(workbook);
  const updated = await service.transferRange(workbook.id, workbook.sheets[0].id, {
    source: { start: { row: 1, column: 3 }, end: { row: 2, column: 3 } },
    target: { start: { row: 3, column: 5 }, end: { row: 3, column: 5 } },
    mode: "copy",
  });
  const cells = updated.sheets[0].cells;
  assert.equal(cells.E3.formula, "=C3+$B$2+D$1+$A4");
  assert.equal(cells.E4.formula, "=SUM(C3:D4)");
  assert.equal(cells.E3.value, "14");
  assert.equal(cells.E4.value, "16");
});

test("transferRange cut clears the source only after the paste is applied", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const updated = await service.transferRange(workbook.id, workbook.sheets[0].id, {
    source: { start: { row: 1, column: 1 }, end: { row: 1, column: 2 } },
    target: { start: { row: 1, column: 4 }, end: { row: 1, column: 4 } },
    mode: "cut",
  });
  const cells = updated.sheets[0].cells;
  assert.equal(cells.A1, undefined);
  assert.equal(cells.B1, undefined);
  assert.equal(cells.D1.value, "Region");
  assert.equal(cells.E1.value, "Sales");
  assert.equal(cells.C1.value, "Status");
  assert.equal(cells.C1.formula, undefined);
  assert.equal(cells.C2.value, "Open");
});

test("transferRange rejects validation-violating targets atomically", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].validationRules = [
    { id: "r1", type: "number", min: 0, max: 100, range: { start: { row: 1, column: 4 }, end: { row: 2, column: 5 } } },
  ];
  workbook.sheets[0].cells.A1 = { value: "150" };
  workbook.sheets[0].cells.B1 = { value: "2" };
  const service = await serviceWithWorkbook(workbook);
  await assert.rejects(
    () => service.transferRange(workbook.id, workbook.sheets[0].id, {
      source: { start: { row: 1, column: 1 }, end: { row: 1, column: 2 } },
      target: { start: { row: 1, column: 4 }, end: { row: 1, column: 4 } },
      mode: "copy",
    }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.message, "Please enter a number from 0 to 100");
      return true;
    },
  );
  const reopened = await service.getWorkbook(workbook.id);
  assert.equal(reopened.sheets[0].cells.A1.value, "150");
  assert.equal(reopened.sheets[0].cells.D1, undefined);
  assert.equal(reopened.sheets[0].cells.E1, undefined);
});

test("setSelection persists the complete rectangle per worksheet", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const selection = { start: { row: 1, column: 4 }, end: { row: 2, column: 5 } };
  const updated = await service.setSelection(workbook.id, workbook.sheets[0].id, { selection });
  assert.deepEqual(updated.sheets[0].selection, selection);
  assert.equal(updated.sheets[1].selection, undefined);

  const reopened = await service.getWorkbook(summary.id);
  assert.deepEqual(reopened.sheets[0].selection, selection);

  await service.setSelection(workbook.id, workbook.sheets[1].id, {
    selection: { start: { row: 3, column: 1 }, end: { row: 3, column: 1 } },
  });
  const after = await service.getWorkbook(summary.id);
  assert.deepEqual(after.sheets[0].selection, selection);
  assert.deepEqual(after.sheets[1].selection, { start: { row: 3, column: 1 }, end: { row: 3, column: 1 } });
});

test("setSelection normalizes reversed rectangles and rejects bad input", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const updated = await service.setSelection(workbook.id, workbook.sheets[0].id, {
    selection: { start: { row: 2, column: 5 }, end: { row: 1, column: 4 } },
  });
  assert.deepEqual(updated.sheets[0].selection, { start: { row: 1, column: 4 }, end: { row: 2, column: 5 } });
  await assert.rejects(
    () => service.setSelection(workbook.id, workbook.sheets[0].id, { selection: { start: { row: 0, column: 1 }, end: { row: 1, column: 1 } } }),
    (error) => error instanceof HttpError && error.status === 400,
  );
});

test("restoreSheet replaces cells, rules, filters and pivot atomically and persists", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  await service.updateCells(summary.id, "ws-seed-q3-1", { cells: { C1: "5", D1: "East" } });
  const before = await service.getWorkbook(summary.id);
  const snapshot = {
    cells: { ...before.sheets[0].cells },
    validationRules: before.sheets[0].validationRules,
    filterViews: before.sheets[0].filterViews,
    pivot: before.sheets[0].pivot,
  };
  // Mutate the sheet, then restore the captured snapshot.
  await service.updateCells(summary.id, "ws-seed-q3-1", { cells: { C1: "99", D1: "West" } });
  const mutated = await service.getWorkbook(summary.id);
  assert.equal(mutated.sheets[0].cells.C1.value, "99");
  assert.equal(mutated.sheets[0].cells.D1.value, "West");

  const restored = await service.restoreSheet(summary.id, "ws-seed-q3-1", { sheet: snapshot });
  assert.equal(restored.sheets[0].cells.C1.value, "5");
  assert.equal(restored.sheets[0].cells.D1.value, "East");
  assert.equal(restored.sheets[0].cells.A1.value, "Region");
  assert.equal(restored.sheets[1].cells.C1, undefined);

  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].cells.C1.value, "5");
  assert.equal(reopened.sheets[0].cells.D1.value, "East");
});

test("restoreSheet restores formula text and recalculates results", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  await service.updateCells(summary.id, "ws-seed-q3-1", { cells: { A3: "7", B3: "=A3*2" } });
  const before = await service.getWorkbook(summary.id);
  assert.equal(before.sheets[0].cells.B3.value, "14");
  const snapshot = { cells: { ...before.sheets[0].cells } };

  await service.updateCells(summary.id, "ws-seed-q3-1", { cells: { A3: "10" } });
  const changed = await service.getWorkbook(summary.id);
  assert.equal(changed.sheets[0].cells.B3.value, "20");

  const restored = await service.restoreSheet(summary.id, "ws-seed-q3-1", { sheet: snapshot });
  assert.equal(restored.sheets[0].cells.A3.value, "7");
  assert.equal(restored.sheets[0].cells.B3.formula, "=A3*2");
  assert.equal(restored.sheets[0].cells.B3.value, "14");
});

test("restoreSheet restores row/column structure captured before a structure change", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const before = await service.getWorkbook(summary.id);
  const snapshot = { cells: { ...before.sheets[0].cells } };

  await service.changeSheetStructure(summary.id, "ws-seed-q3-1", { op: "insert-row-above", index: 1 });
  const shifted = await service.getWorkbook(summary.id);
  assert.equal(shifted.sheets[0].cells.A2.value, "Region");
  assert.equal(shifted.sheets[0].cells.B2.value, "Sales");
  assert.equal(shifted.sheets[0].cells.C2.value, "Status");
  assert.equal(shifted.sheets[0].cells.A3.value, "East");
  assert.equal(shifted.sheets[0].cells.B3.value, "1200");

  const restored = await service.restoreSheet(summary.id, "ws-seed-q3-1", { sheet: snapshot });
  assert.equal(restored.sheets[0].cells.A1.value, "Region");
  assert.equal(restored.sheets[0].cells.B1.value, "Sales");
  assert.equal(restored.sheets[0].cells.C1.value, "Status");
  assert.equal(restored.sheets[0].cells.A2.value, "East");
  assert.equal(restored.sheets[0].cells.B2.value, "1200");
});

test("restoreSheet rejects a snapshot violating the 0-to-100 rule without changing the store", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  await service.updateCells(summary.id, "ws-seed-q3-1", { cells: { D1: "5" } });
  const wb = await service.getWorkbook(summary.id);
  const rules = [
    {
      id: "r1",
      range: { start: { row: 1, column: 4 }, end: { row: 1, column: 4 } },
      type: "number",
      min: 0,
      max: 100,
    },
  ];
  await service.restoreSheet(summary.id, "ws-seed-q3-1", { sheet: { cells: { ...wb.sheets[0].cells }, validationRules: rules } });
  const withRule = await service.getWorkbook(summary.id);
  assert.equal(withRule.sheets[0].validationRules.length, 1);

  await assert.rejects(
    () =>
      service.restoreSheet(summary.id, "ws-seed-q3-1", {
        sheet: { cells: { ...wb.sheets[0].cells, D1: { value: "1200" } }, validationRules: rules },
      }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "Please enter a number from 0 to 100");
      return true;
    },
  );
  const unchanged = await service.getWorkbook(summary.id);
  assert.equal(unchanged.sheets[0].cells.D1.value, "5");
  assert.equal(unchanged.sheets[0].validationRules.length, 1);
});

test("restoreSheet rejects invalid snapshots without changing the store", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  await assert.rejects(
    () => service.restoreSheet(summary.id, "ws-seed-q3-1", { sheet: { cells: { "1A": { value: "x" } } } }),
    (error) => error instanceof HttpError && error.status === 400,
  );
  await assert.rejects(
    () => service.restoreSheet(summary.id, "ws-seed-q3-1", { sheet: null }),
    (error) => error instanceof HttpError && error.status === 400,
  );
  const unchanged = await service.getWorkbook(summary.id);
  assert.equal(unchanged.sheets[0].cells.A1.value, "Region");
  assert.equal(unchanged.sheets[0].cells.C1.value, "Status");
});

test("a direct circular reference displays #REF! and persists", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const updated = await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: { E1: "=E1+1" },
  });
  assert.equal(updated.sheets[0].cells.E1.formula, "=E1+1");
  assert.equal(updated.sheets[0].cells.E1.value, "#REF!");
  assert.equal(updated.sheets[0].cells.C1.value, "Status");

  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].cells.E1.formula, "=E1+1");
  assert.equal(reopened.sheets[0].cells.E1.value, "#REF!");
});

test("an indirect circular reference displays #REF! for every cell in the cycle", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const updated = await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: { E1: "=E2+1", E2: "=E1+1" },
  });
  assert.equal(updated.sheets[0].cells.E1.value, "#REF!");
  assert.equal(updated.sheets[0].cells.E2.value, "#REF!");
  assert.equal(updated.sheets[0].cells.C1.value, "Status");

  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].cells.E1.value, "#REF!");
  assert.equal(reopened.sheets[0].cells.E2.value, "#REF!");
});

test("breaking a circular reference recalculates normally", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: { E1: "=E2+1", E2: "=E1+1" },
  });
  const fixed = await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: { E2: "4" },
  });
  assert.equal(fixed.sheets[0].cells.E1.value, "5");
  assert.equal(fixed.sheets[0].cells.E2.value, "4");
  assert.equal(fixed.sheets[0].cells.E1.formula, "=E2+1");
});

test("one erroneous formula does not affect unrelated cells", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const updated = await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: { E1: "=1/0", F1: "=B2*2", G1: "=SUM(E1:F1)" },
  });
  assert.equal(updated.sheets[0].cells.E1.value, "#DIV/0!");
  assert.equal(updated.sheets[0].cells.F1.value, "2400");
  assert.equal(updated.sheets[0].cells.G1.value, "#DIV/0!");
  assert.equal(updated.sheets[0].cells.C1.value, "Status");
  assert.equal(updated.sheets[0].cells.D1, undefined);
});

test("aggregate functions ignore empty cells and count only numeric cells", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: { E1: "2", F1: "", G1: "East", E2: "4", F2: "6" },
  });
  const updated = await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: {
      H1: "=SUM(E1:G2)",
      H2: "=COUNT(E1:G2)",
      H3: "=AVERAGE(E1:F2)",
      H4: "=MIN(E1:G2)",
      H5: "=MAX(E1:G2)",
      H6: "=sum(e1:f2)",
      H7: "=SUM(E1,F1)",
    },
  });
  const sheet = updated.sheets[0];
  assert.equal(sheet.cells.H1.value, "12");
  assert.equal(sheet.cells.H2.value, "3");
  assert.equal(sheet.cells.H3.value, "4");
  assert.equal(sheet.cells.H4.value, "2");
  assert.equal(sheet.cells.H5.value, "6");
  assert.equal(sheet.cells.H6.value, "12");
  assert.equal(sheet.cells.H7.value, "2");

  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].cells.H1.value, "12");
  assert.equal(reopened.sheets[0].cells.H7.value, "2");
});

test("copying a formula out of the sheet bounds displays =#REF! and #REF!", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: { E1: "=B1" },
  });
  const updated = await service.transferRange(workbook.id, workbook.sheets[0].id, {
    source: { start: { row: 1, column: 5 }, end: { row: 1, column: 5 } },
    target: { start: { row: 1, column: 1 }, end: { row: 1, column: 1 } },
    mode: "copy",
  });
  const cells = updated.sheets[0].cells;
  assert.equal(cells.A1.formula, "=#REF!");
  assert.equal(cells.A1.value, "#REF!");
  assert.equal(cells.E1.formula, "=B1");
  assert.equal(cells.E1.value, "Sales");
  assert.equal(cells.B1.value, "Sales");
  assert.equal(cells.C1.value, "Status");
  assert.equal(cells.C1.formula, undefined);

  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].cells.A1.formula, "=#REF!");
  assert.equal(reopened.sheets[0].cells.A1.value, "#REF!");
  assert.equal(reopened.sheets[0].cells.E1.formula, "=B1");
});

test("copying a formula adjusts relative references and keeps absolute ones, persisting after reopen", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].cells.A1 = { value: "5" };
  workbook.sheets[0].cells.B1 = { value: "6" };
  workbook.sheets[0].cells.A3 = { value: "3" };
  workbook.sheets[0].cells.E1 = { value: "11", formula: "=A1+$B$1" };
  const service = await serviceWithWorkbook(workbook);
  const updated = await service.transferRange(workbook.id, workbook.sheets[0].id, {
    source: { start: { row: 1, column: 5 }, end: { row: 1, column: 5 } },
    target: { start: { row: 3, column: 5 }, end: { row: 3, column: 5 } },
    mode: "copy",
  });
  assert.equal(updated.sheets[0].cells.E3.formula, "=A3+$B$1");
  assert.equal(updated.sheets[0].cells.E3.value, "9");
  assert.equal(updated.sheets[0].cells.E1.formula, "=A1+$B$1");
  assert.equal(updated.sheets[0].cells.E1.value, "11");

  const reopened = await service.getWorkbook(workbook.id);
  assert.equal(reopened.sheets[0].cells.E3.formula, "=A3+$B$1");
  assert.equal(reopened.sheets[0].cells.E3.value, "9");
});

test("an invalid reference and unsupported function display stable error values", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const updated = await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: { E1: "=NOSHEET!A1", F1: "=SILLY(A1)", G1: "=A0" },
  });
  assert.equal(updated.sheets[0].cells.E1.value, "#REF!");
  assert.equal(updated.sheets[0].cells.F1.value, "#NAME?");
  assert.equal(updated.sheets[0].cells.G1.value, "#REF!");
  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].cells.F1.value, "#NAME?");
  assert.equal(reopened.sheets[0].cells.F1.formula, "=SILLY(A1)");
});

test("setFilter creates a filter view with conditions and persists it", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const range = { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } };
  const updated = await service.setFilter(workbook.id, workbook.sheets[0].id, {
    range,
    conditions: [
      { column: 1, mode: "values", values: ["East", "North"] },
      { column: 2, mode: "condition", condition: "greater-than", value: "800" },
    ],
  });
  assert.equal(updated.sheets[0].filterViews.length, 1);
  assert.deepEqual(updated.sheets[0].filterViews[0].range, range);
  assert.deepEqual(updated.sheets[0].filterViews[0].conditions, [
    { column: 1, mode: "values", values: ["East", "North"] },
    { column: 2, mode: "condition", condition: "greater-than", value: "800" },
  ]);

  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].filterViews.length, 1);
  assert.deepEqual(reopened.sheets[0].filterViews[0].conditions[1], {
    column: 2,
    mode: "condition",
    condition: "greater-than",
    value: "800",
  });
});

test("setFilter rejects invalid conditions atomically and clears with clear:true", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const range = { start: { row: 1, column: 1 }, end: { row: 4, column: 3 } };
  await service.setFilter(workbook.id, workbook.sheets[0].id, { range });
  await assert.rejects(
    () =>
      service.setFilter(workbook.id, workbook.sheets[0].id, {
        range,
        conditions: [{ column: 9, mode: "values", values: ["x"] }],
      }),
    (error) => error instanceof HttpError && error.status === 400,
  );
  await assert.rejects(
    () =>
      service.setFilter(workbook.id, workbook.sheets[0].id, {
        range,
        conditions: [{ column: 1, mode: "condition", condition: "bogus" }],
      }),
    (error) => error instanceof HttpError && error.status === 400,
  );
  const unchanged = await service.getWorkbook(summary.id);
  assert.equal(unchanged.sheets[0].filterViews.length, 1);
  assert.deepEqual(unchanged.sheets[0].filterViews[0].conditions, []);

  const cleared = await service.setFilter(workbook.id, workbook.sheets[0].id, { clear: true });
  assert.deepEqual(cleared.sheets[0].filterViews, []);
});

test("filter conditions shift with source columns and drop conditions on deleted columns", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].filterViews = [
    {
      id: "f1",
      range: { start: { row: 1, column: 1 }, end: { row: 4, column: 3 } },
      conditions: [
        { column: 1, mode: "values", values: ["East"] },
        { column: 3, mode: "condition", condition: "is-not-empty" },
      ],
    },
  ];
  const service = await serviceWithWorkbook(workbook);
  const updated = await service.changeSheetStructure(workbook.id, workbook.sheets[0].id, { op: "insert-column-left", index: 2 });
  const view = updated.sheets[0].filterViews[0];
  assert.deepEqual(view.range, { start: { row: 1, column: 1 }, end: { row: 4, column: 4 } });
  assert.deepEqual(view.conditions, [
    { column: 1, mode: "values", values: ["East"] },
    { column: 4, mode: "condition", condition: "is-not-empty" },
  ]);

  const deleted = await service.changeSheetStructure(workbook.id, workbook.sheets[0].id, { op: "delete-column", index: 2 });
  const view2 = deleted.sheets[0].filterViews[0];
  assert.deepEqual(view2.range, { start: { row: 1, column: 1 }, end: { row: 4, column: 3 } });
  assert.deepEqual(view2.conditions, [
    { column: 1, mode: "values", values: ["East"] },
    { column: 3, mode: "condition", condition: "is-not-empty" },
  ]);
});

test("createPivot creates the first unused PivotN worksheet and makes it active", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const updated = await service.createPivot(workbook.id, {
    sourceSheetId: workbook.sheets[0].id,
    sourceRange: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
  });
  assert.equal(updated.sheets.length, 3);
  assert.equal(updated.sheets[2].name, "Pivot1");
  assert.equal(updated.activeSheetId, updated.sheets[2].id);
  assert.deepEqual(updated.sheets[2].cells, {});
  assert.equal(updated.sheets[2].pivot.sourceSheetId, workbook.sheets[0].id);
  assert.deepEqual(updated.sheets[2].pivot.sourceRange, { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } });
  assert.equal(updated.sheets[2].pivot.summarizeBy, "SUM");
  assert.equal(updated.sheets[0].cells.A1.value, "Region");

  const again = await service.createPivot(workbook.id, {
    sourceSheetId: workbook.sheets[0].id,
    sourceRange: { start: { row: 1, column: 1 }, end: { row: 4, column: 3 } },
  });
  assert.equal(again.sheets[3].name, "Pivot2");
});

test("applyPivot computes SUM of Sales by Region with Grand Total", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const created = await service.createPivot(workbook.id, {
    sourceSheetId: workbook.sheets[0].id,
    sourceRange: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
  });
  const updated = await service.applyPivot(created.id, created.activeSheetId, {
    rowField: "Region",
    columnField: null,
    valueField: "Sales",
    summarizeBy: "SUM",
  });
  const sheet = updated.sheets[2];
  assert.equal(sheet.cells.A1.value, "Region");
  assert.equal(sheet.cells.B1.value, "SUM of Sales");
  assert.equal(sheet.cells.A2.value, "East");
  assert.equal(sheet.cells.B2.value, "1200");
  assert.equal(sheet.cells.A3.value, "North");
  assert.equal(sheet.cells.B3.value, "800");
  assert.equal(sheet.cells.A4.value, "South");
  assert.equal(sheet.cells.B4.value, "700");
  assert.equal(sheet.cells.A5.value, "Grand Total");
  assert.equal(sheet.cells.B5.value, "2700");

  const reopened = await service.getWorkbook(updated.id);
  assert.equal(reopened.sheets[2].cells.B5.value, "2700");
  // The source worksheet is untouched.
  assert.equal(reopened.sheets[0].cells.A2.value, "East");
  assert.equal(reopened.sheets[0].cells.B2.value, "1200");
});

test("applyPivot with a column field arranges column groups and a Grand Total column", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const created = await service.createPivot(workbook.id, {
    sourceSheetId: workbook.sheets[0].id,
    sourceRange: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
  });
  const updated = await service.applyPivot(created.id, created.activeSheetId, {
    rowField: "Region",
    columnField: "Status",
    valueField: "Sales",
    summarizeBy: "COUNT",
  });
  const sheet = updated.sheets[2];
  assert.equal(sheet.cells.A1.value, "Region");
  assert.equal(sheet.cells.B1.value, "Open");
  assert.equal(sheet.cells.C1.value, "Closed");
  assert.equal(sheet.cells.D1.value, "Grand Total");
  assert.equal(sheet.cells.A2.value, "East");
  assert.equal(sheet.cells.B2.value, "1");
  assert.equal(sheet.cells.C2.value, "0");
  assert.equal(sheet.cells.D2.value, "1");
  assert.equal(sheet.cells.A3.value, "North");
  assert.equal(sheet.cells.B3.value, "0");
  assert.equal(sheet.cells.C3.value, "1");
  assert.equal(sheet.cells.A5.value, "Grand Total");
  assert.equal(sheet.cells.B5.value, "2");
  assert.equal(sheet.cells.C5.value, "1");
  assert.equal(sheet.cells.D5.value, "3");
});

test("applyPivot AVERAGE aggregates only parseable numbers and ignores text rows", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  await service.updateCells(workbook.id, workbook.sheets[0].id, {
    cells: { A5: "West", B5: "text", A6: "West", B6: "900" },
  });
  const created = await service.createPivot(workbook.id, {
    sourceSheetId: workbook.sheets[0].id,
    sourceRange: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
  });
  const updated = await service.applyPivot(created.id, created.activeSheetId, {
    rowField: "Region",
    columnField: null,
    valueField: "Sales",
    summarizeBy: "AVERAGE",
  });
  const sheet = updated.sheets[2];
  assert.equal(sheet.cells.B2.value, "1200");
  assert.equal(sheet.cells.B5.value, "900");
  assert.equal(sheet.cells.A6.value, "Grand Total");
  assert.equal(sheet.cells.B6.value, "900");
});

test("refreshPivot recomputes from current source data and replaces the old result", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const created = await service.createPivot(workbook.id, {
    sourceSheetId: workbook.sheets[0].id,
    sourceRange: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
  });
  await service.applyPivot(created.id, created.activeSheetId, {
    rowField: "Region",
    columnField: null,
    valueField: "Sales",
    summarizeBy: "SUM",
  });
  await service.updateCells(workbook.id, workbook.sheets[0].id, { cells: { B2: "1500" } });
  const refreshed = await service.refreshPivot(created.id, created.activeSheetId);
  const sheet = refreshed.sheets[2];
  assert.equal(sheet.cells.B2.value, "1500");
  assert.equal(sheet.cells.B5.value, "3000");
});

test("refreshPivot after a deleted header preserves the last result and reports the field error", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const created = await service.createPivot(workbook.id, {
    sourceSheetId: workbook.sheets[0].id,
    sourceRange: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
  });
  await service.applyPivot(created.id, created.activeSheetId, {
    rowField: "Region",
    columnField: null,
    valueField: "Sales",
    summarizeBy: "SUM",
  });
  const before = await service.getWorkbook(created.id);
  const cached = before.sheets[2].cells.B5.value;

  // Delete the Sales header column from the source worksheet.
  await service.changeSheetStructure(workbook.id, workbook.sheets[0].id, { op: "delete-column", index: 2 });
  await assert.rejects(
    () => service.refreshPivot(created.id, created.activeSheetId),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "Pivot field is no longer available. Select a new field.");
      return true;
    },
  );
  const after = await service.getWorkbook(created.id);
  // Last successful result preserved; source sheet keeps its remaining data.
  assert.equal(after.sheets[2].cells.B5.value, cached);
  assert.equal(after.sheets[0].cells.A1.value, "Region");
});

test("SUM on a non-numeric value field reports the numeric error and preserves the old result", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const created = await service.createPivot(workbook.id, {
    sourceSheetId: workbook.sheets[0].id,
    sourceRange: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
  });
  await service.applyPivot(created.id, created.activeSheetId, {
    rowField: "Region",
    columnField: null,
    valueField: "Sales",
    summarizeBy: "SUM",
  });
  const before = await service.getWorkbook(created.id);
  await assert.rejects(
    () =>
      service.applyPivot(created.id, created.activeSheetId, {
        rowField: "Region",
        columnField: null,
        valueField: "Status",
        summarizeBy: "SUM",
      }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.message, "Value field requires numeric values");
      return true;
    },
  );
  const after = await service.getWorkbook(created.id);
  assert.equal(after.sheets[2].cells.B5.value, before.sheets[2].cells.B5.value);
  assert.equal(after.sheets[0].cells.C1.value, "Status");
});

test("source row/column changes move the pivot source range and refresh uses the adjusted range", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const created = await service.createPivot(workbook.id, {
    sourceSheetId: workbook.sheets[0].id,
    sourceRange: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
  });
  await service.applyPivot(created.id, created.activeSheetId, {
    rowField: "Region",
    columnField: null,
    valueField: "Sales",
    summarizeBy: "SUM",
  });
  await service.changeSheetStructure(workbook.id, workbook.sheets[0].id, { op: "insert-row-below", index: 5 });
  await service.updateCells(workbook.id, workbook.sheets[0].id, { cells: { A6: "North", B6: "200" } });
  const refreshed = await service.refreshPivot(created.id, created.activeSheetId);
  const sheet = refreshed.sheets[2];
  assert.equal(sheet.cells.B5.value, "2900");
  assert.deepEqual(refreshed.sheets[2].pivot.sourceRange, { start: { row: 1, column: 1 }, end: { row: 7, column: 3 } });
});

test("setValidation saves a dropdown rule with trimmed allowed values and persists", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const updated = await service.setValidation(workbook.id, workbook.sheets[0].id, {
    range: { start: { row: 2, column: 1 }, end: { row: 3, column: 1 } },
    rule: { type: "dropdown", allowedValues: [" East ", "North", "", " South "] },
  });
  const rules = updated.sheets[0].validationRules;
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "dropdown");
  assert.deepEqual(rules[0].allowedValues, ["East", "North", "South"]);
  assert.deepEqual(rules[0].range, { start: { row: 2, column: 1 }, end: { row: 3, column: 1 } });

  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].validationRules.length, 1);
  assert.deepEqual(reopened.sheets[0].validationRules[0].allowedValues, ["East", "North", "South"]);
});

test("setValidation saves a number rule and rejects invalid range payloads", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const updated = await service.setValidation(workbook.id, workbook.sheets[0].id, {
    range: { start: { row: 2, column: 2 }, end: { row: 4, column: 2 } },
    rule: { type: "number", min: 10, max: 20 },
  });
  assert.equal(updated.sheets[0].validationRules.length, 1);
  assert.equal(updated.sheets[0].validationRules[0].min, 10);
  assert.equal(updated.sheets[0].validationRules[0].max, 20);

  await assert.rejects(
    () =>
      service.setValidation(workbook.id, workbook.sheets[0].id, {
        range: { start: { row: 1, column: 1 }, end: { row: 1, column: 1 } },
        rule: { type: "number", min: 30, max: 10 },
      }),
    (error) => error instanceof HttpError && error.status === 400,
  );
  await assert.rejects(
    () =>
      service.setValidation(workbook.id, workbook.sheets[0].id, {
        range: { start: { row: 1, column: 1 }, end: { row: 1, column: 1 } },
        rule: { type: "dropdown", allowedValues: [] },
      }),
    (error) => error instanceof HttpError && error.status === 400,
  );
});

test("a dropdown rule rejects violating writes atomically with the exact message", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].validationRules = [
    {
      id: "r1",
      type: "dropdown",
      allowedValues: ["East", "North", "South"],
      range: { start: { row: 2, column: 1 }, end: { row: 3, column: 1 } },
    },
  ];
  const service = await serviceWithWorkbook(workbook);
  await assert.rejects(
    () => service.updateCells(workbook.id, workbook.sheets[0].id, { cells: { A2: "West" } }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "Please select one of the following values: East, North, South");
      return true;
    },
  );
  const reopened = await service.getWorkbook(workbook.id);
  assert.equal(reopened.sheets[0].cells.A2.value, "East");

  const ok = await service.updateCells(workbook.id, workbook.sheets[0].id, { cells: { A3: "North" } });
  assert.equal(ok.sheets[0].cells.A3.value, "North");
  const empty = await service.updateCells(workbook.id, workbook.sheets[0].id, { cells: { A3: "" } });
  assert.equal(empty.sheets[0].cells.A3.value, "");
});

test("a number range rule rejects writes outside the inclusive bounds with the custom message", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].validationRules = [
    {
      id: "r1",
      type: "number",
      min: 0,
      max: 10,
      range: { start: { row: 2, column: 2 }, end: { row: 3, column: 2 } },
    },
  ];
  const service = await serviceWithWorkbook(workbook);
  await assert.rejects(
    () => service.updateCells(workbook.id, workbook.sheets[0].id, { cells: { B2: "25" } }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.message, "Please enter a number between 0 and 10");
      return true;
    },
  );
  await assert.rejects(
    () => service.updateCells(workbook.id, workbook.sheets[0].id, { cells: { B2: "abc" } }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.message, "Please enter a number between 0 and 10");
      return true;
    },
  );
  const reopened = await service.getWorkbook(workbook.id);
  assert.equal(reopened.sheets[0].cells.B2.value, "1200");

  const ok = await service.updateCells(workbook.id, workbook.sheets[0].id, { cells: { B2: "10" } });
  assert.equal(ok.sheets[0].cells.B2.value, "10");
});

test("rejecting 101 in a 0-to-100 ruled cell displays the boundary message", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].validationRules = [
    {
      id: "r1",
      type: "number",
      min: 0,
      max: 100,
      range: { start: { row: 3, column: 2 }, end: { row: 3, column: 2 } },
    },
  ];
  const service = await serviceWithWorkbook(workbook);
  await assert.rejects(
    () => service.updateCells(workbook.id, workbook.sheets[0].id, { cells: { B3: "101" } }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.message, "Please enter a number from 0 to 100");
      return true;
    },
  );
  const reopened = await service.getWorkbook(workbook.id);
  assert.equal(reopened.sheets[0].cells.B3.value, "800");
});

test("bulk writes are all-or-nothing when any target violates a rule", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].validationRules = [
    {
      id: "r1",
      type: "dropdown",
      allowedValues: ["East", "North"],
      range: { start: { row: 2, column: 1 }, end: { row: 2, column: 1 } },
    },
  ];
  const service = await serviceWithWorkbook(workbook);
  await assert.rejects(
    () =>
      service.updateCells(workbook.id, workbook.sheets[0].id, {
        cells: { A1: "Changed", B1: "Also changed", A2: "West" },
      }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.message, "Please select one of the following values: East, North");
      return true;
    },
  );
  const reopened = await service.getWorkbook(workbook.id);
  assert.equal(reopened.sheets[0].cells.A1.value, "Region");
  assert.equal(reopened.sheets[0].cells.B1.value, "Sales");
  assert.equal(reopened.sheets[0].cells.A2.value, "East");
});

test("transferRange rejects a dropdown-violating target and keeps every cell unchanged", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].validationRules = [
    {
      id: "r1",
      type: "dropdown",
      allowedValues: ["East", "North"],
      range: { start: { row: 2, column: 4 }, end: { row: 2, column: 4 } },
    },
  ];
  const service = await serviceWithWorkbook(workbook);
  await assert.rejects(
    () =>
      service.transferRange(workbook.id, workbook.sheets[0].id, {
        source: { start: { row: 1, column: 1 }, end: { row: 1, column: 1 } },
        target: { start: { row: 2, column: 4 }, end: { row: 2, column: 4 } },
        mode: "copy",
      }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.message, "Please select one of the following values: East, North");
      return true;
    },
  );
  const reopened = await service.getWorkbook(workbook.id);
  assert.equal(reopened.sheets[0].cells.D2, undefined);
  assert.equal(reopened.sheets[0].cells.A1.value, "Region");
});

test("setValidation replaces intersecting rules and deletes a named rule", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const first = await service.setValidation(workbook.id, workbook.sheets[0].id, {
    range: { start: { row: 2, column: 1 }, end: { row: 4, column: 1 } },
    rule: { type: "dropdown", allowedValues: ["East", "North"] },
  });
  const firstId = first.sheets[0].validationRules[0].id;
  const second = await service.setValidation(workbook.id, workbook.sheets[0].id, {
    range: { start: { row: 3, column: 1 }, end: { row: 5, column: 1 } },
    rule: { type: "number", min: 1, max: 5 },
  });
  assert.equal(second.sheets[0].validationRules.length, 1);
  assert.equal(second.sheets[0].validationRules[0].type, "number");

  const deleted = await service.setValidation(workbook.id, workbook.sheets[0].id, {
    deleteRuleId: second.sheets[0].validationRules[0].id,
  });
  assert.deepEqual(deleted.sheets[0].validationRules, []);
  await assert.rejects(
    () => service.setValidation(workbook.id, workbook.sheets[0].id, { deleteRuleId: firstId }),
    (error) => error instanceof HttpError && error.status === 404,
  );
});

test("structure changes shift dropdown rules with the constrained cells", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].validationRules = [
    {
      id: "r1",
      type: "dropdown",
      allowedValues: ["East", "North"],
      range: { start: { row: 2, column: 1 }, end: { row: 3, column: 1 } },
    },
  ];
  const service = await serviceWithWorkbook(workbook);
  const shifted = await service.changeSheetStructure(workbook.id, workbook.sheets[0].id, {
    op: "insert-row-above",
    index: 2,
  });
  assert.deepEqual(shifted.sheets[0].validationRules[0].range, {
    start: { row: 3, column: 1 },
    end: { row: 4, column: 1 },
  });
  assert.deepEqual(shifted.sheets[0].validationRules[0].allowedValues, ["East", "North"]);
});

test("sortRange sorts rows by a numeric column, keeps the header and persists", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const updated = await service.sortRange(workbook.id, workbook.sheets[0].id, {
    range: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
    sortBy: 2,
    order: "ascending",
    hasHeaderRow: true,
  });
  const cells = updated.sheets[0].cells;
  assert.equal(cells.A1.value, "Region");
  assert.equal(cells.B1.value, "Sales");
  assert.equal(cells.A2.value, "South");
  assert.equal(cells.B2.value, "700");
  assert.equal(cells.C2.value, "Open");
  assert.equal(cells.A3.value, "North");
  assert.equal(cells.B3.value, "800");
  assert.equal(cells.C3.value, "Closed");
  assert.equal(cells.A4.value, "East");
  assert.equal(cells.B4.value, "1200");
  assert.equal(cells.C4.value, "Open");

  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].cells.A2.value, "South");
  assert.equal(reopened.sheets[0].cells.A4.value, "East");
});

test("sortRange descending restores the original seed order", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  const updated = await service.sortRange(workbook.id, workbook.sheets[0].id, {
    range: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
    sortBy: 2,
    order: "descending",
    hasHeaderRow: true,
  });
  const cells = updated.sheets[0].cells;
  assert.equal(cells.A2.value, "East");
  assert.equal(cells.A3.value, "North");
  assert.equal(cells.A4.value, "South");
});

test("sortRange sorts text values, keeps equal keys stable and leaves outside data untouched", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].cells.D1 = { value: "outside" };
  workbook.sheets[0].cells.D2 = { value: "outside2" };
  const service = await serviceWithWorkbook(workbook);
  const updated = await service.sortRange(workbook.id, workbook.sheets[0].id, {
    range: { start: { row: 1, column: 1 }, end: { row: 4, column: 3 } },
    sortBy: 3,
    order: "ascending",
    hasHeaderRow: true,
  });
  const cells = updated.sheets[0].cells;
  // Status: Open, Closed, Open -> Closed (North), Open (East), Open (South);
  // equal keys keep original relative order: East before South.
  assert.equal(cells.A2.value, "North");
  assert.equal(cells.A3.value, "East");
  assert.equal(cells.A4.value, "South");
  assert.equal(cells.D1.value, "outside");
  assert.equal(cells.D2.value, "outside2");
});

test("sortRange without a header row sorts every row and moves formulas with recalculated results", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].cells.A1 = { value: "30" };
  workbook.sheets[0].cells.B1 = { value: "100" };
  workbook.sheets[0].cells.C1 = { value: "50", formula: "=B1/2" };
  workbook.sheets[0].cells.A2 = { value: "10" };
  workbook.sheets[0].cells.B2 = { value: "200" };
  workbook.sheets[0].cells.C2 = { value: "100", formula: "=B2/2" };
  workbook.sheets[0].cells.A3 = { value: "20" };
  workbook.sheets[0].cells.B3 = { value: "300" };
  workbook.sheets[0].cells.C3 = { value: "150", formula: "=B3/2" };
  workbook.sheets[0].cells.A4 = { value: "40" };
  workbook.sheets[0].cells.B4 = { value: "400" };
  workbook.sheets[0].cells.C4 = { value: "200", formula: "=B4/2" };
  const service = await serviceWithWorkbook(workbook);
  const updated = await service.sortRange(workbook.id, workbook.sheets[0].id, {
    range: { start: { row: 1, column: 1 }, end: { row: 4, column: 3 } },
    sortBy: 1,
    order: "ascending",
    hasHeaderRow: false,
  });
  const cells = updated.sheets[0].cells;
  assert.equal(cells.A1.value, "10");
  assert.equal(cells.B1.value, "200");
  assert.equal(cells.C1.formula, "=B2/2");
  assert.equal(cells.C1.value, "150");
  assert.equal(cells.A2.value, "20");
  assert.equal(cells.B2.value, "300");
  assert.equal(cells.C2.formula, "=B3/2");
  assert.equal(cells.C2.value, "50");
  assert.equal(cells.A3.value, "30");
  assert.equal(cells.B3.value, "100");
  assert.equal(cells.C3.formula, "=B1/2");
  assert.equal(cells.C3.value, "100");
  assert.equal(cells.A4.value, "40");
  assert.equal(cells.C4.value, "200");
});

test("sortRange rejects invalid payloads atomically", async () => {
  const service = await freshService();
  const [summary] = await service.listWorkbooks();
  const workbook = await service.getWorkbook(summary.id);
  await assert.rejects(
    () =>
      service.sortRange(workbook.id, workbook.sheets[0].id, {
        range: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
        sortBy: 5,
        order: "ascending",
        hasHeaderRow: true,
      }),
    (error) => error instanceof HttpError && error.status === 400,
  );
  await assert.rejects(
    () =>
      service.sortRange(workbook.id, workbook.sheets[0].id, {
        range: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
        sortBy: 2,
        order: "sideways",
        hasHeaderRow: true,
      }),
    (error) => error instanceof HttpError && error.status === 400,
  );
  const reopened = await service.getWorkbook(summary.id);
  assert.equal(reopened.sheets[0].cells.A2.value, "East");
  assert.equal(reopened.sheets[0].cells.B2.value, "1200");
});

test("sortRange sorts parseable dates by their time value", async () => {
  const workbook = baseWorkbook();
  workbook.sheets[0].cells.A1 = { value: "Date" };
  workbook.sheets[0].cells.B1 = { value: "n/a" };
  workbook.sheets[0].cells.A2 = { value: "2026-03-01" };
  workbook.sheets[0].cells.A3 = { value: "2026-01-15" };
  workbook.sheets[0].cells.A4 = { value: "2026-02-20" };
  const service = await serviceWithWorkbook(workbook);
  const updated = await service.sortRange(workbook.id, workbook.sheets[0].id, {
    range: { start: { row: 1, column: 1 }, end: { row: 4, column: 1 } },
    sortBy: 1,
    order: "ascending",
    hasHeaderRow: true,
  });
  const cells = updated.sheets[0].cells;
  assert.equal(cells.A2.value, "2026-01-15");
  assert.equal(cells.A3.value, "2026-02-20");
  assert.equal(cells.A4.value, "2026-03-01");
});
