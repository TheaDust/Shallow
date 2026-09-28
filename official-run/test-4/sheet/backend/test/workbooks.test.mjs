import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ApiError, cellName, columnName, createWorkbookService, parseCoord } from "../src/lib/workbooks.mjs";

async function freshService() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-workbooks-"));
  const service = createWorkbookService(directory);
  return { service, directory };
}

test("seeds the Q3 Sales workbook on an empty store", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "Q3 Sales");
    const workbook = await service.get(list[0].id);
    assert.equal(workbook.sheets.length, 2);
    assert.equal(workbook.sheets[0].name, "Sheet1");
    assert.equal(workbook.sheets[0].cells.A1, "Region");
    assert.equal(workbook.sheets[0].cells.B1, "Sales");
    assert.equal(workbook.sheets[0].cells.C1, "Status");
    assert.equal(workbook.sheets[0].cells.A2, "East");
    assert.equal(workbook.sheets[0].cells.B2, "1200");
    assert.equal(workbook.sheets[0].cells.C2, "Open");
    assert.equal(workbook.sheets[0].cells.A3, "North");
    assert.equal(workbook.sheets[0].cells.B3, "800");
    assert.equal(workbook.sheets[0].cells.C3, "Closed");
    assert.equal(workbook.sheets[0].cells.A4, "South");
    assert.equal(workbook.sheets[0].cells.B4, "700");
    assert.equal(workbook.sheets[0].cells.C4, "Open");
    assert.equal(workbook.sheets[0].pivot, null);
    assert.equal(workbook.sheets[1].name, "Sheet2");
    assert.deepEqual(workbook.sheets[1].cells, {});
    assert.equal(workbook.activeSheetId, workbook.sheets[0].id);
    assert.ok(workbook.updatedAt);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("seeding is persistent and does not duplicate on later reads", async () => {
  const { service, directory } = await freshService();
  try {
    await service.list();
    await service.list();
    const state = JSON.parse(await readFile(join(directory, "workbooks.json"), "utf8"));
    assert.equal(state.workbooks.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("creates a blank workbook and persists it", async () => {
  const { service, directory } = await freshService();
  try {
    const workbook = await service.create("Budget 2026");
    assert.equal(workbook.name, "Budget 2026");
    assert.equal(workbook.sheets.length, 1);
    assert.equal(workbook.sheets[0].name, "Sheet1");
    assert.deepEqual(workbook.sheets[0].cells, {});
    assert.equal(workbook.sheets[0].selectedCell, "A1");
    const listed = await service.list();
    assert.ok(listed.some((entry) => entry.name === "Budget 2026"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects an empty workbook name", async () => {
  const { service, directory } = await freshService();
  try {
    await assert.rejects(() => service.create("   "), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "Workbook name cannot be empty");
      return true;
    });
    const list = await service.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "Q3 Sales");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("renames a workbook and trims the name", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const renamed = await service.rename(list[0].id, "  Q3 Sales Revised  ");
    assert.equal(renamed.name, "Q3 Sales Revised");
    const again = await service.get(list[0].id);
    assert.equal(again.name, "Q3 Sales Revised");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects renaming to an empty name and keeps the original", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    await assert.rejects(() => service.rename(list[0].id, "   "), (error) => {
      assert.equal(error.message, "Workbook name cannot be empty");
      return true;
    });
    const after = await service.get(list[0].id);
    assert.equal(after.name, "Q3 Sales");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("updates cells and persists them", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const sheetId = (await service.get(id)).activeSheetId;
    const updated = await service.updateCells(id, sheetId, { A2: "East", B2: "1200" });
    assert.equal(updated.sheets[0].cells.A2, "East");
    assert.equal(updated.sheets[0].cells.B2, "1200");
    const reloaded = await service.get(id);
    assert.equal(reloaded.sheets[0].cells.A1, "Region");
    assert.equal(reloaded.sheets[0].cells.A2, "East");
    assert.ok(reloaded.updatedAt >= list[0].updatedAt);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("updates active sheet and selection state", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    const updated = await service.updateState(id, sheetId, "B2");
    assert.equal(updated.sheets[0].selectedCell, "B2");
    assert.equal(updated.activeSheetId, sheetId);
    assert.equal(updated.updatedAt, workbook.updatedAt);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("switching worksheets keeps each sheet's state and reopens the last active tab (REQ-2-1-2)", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheet1 = workbook.sheets[0];
    const sheet2 = workbook.sheets[1];
    // a worksheet without selection history opens on A1
    assert.equal(sheet2.selectedCell, "A1");
    assert.deepEqual(sheet2.selectedRange ?? { start: "A1", end: "A1" }, { start: "A1", end: "A1" });

    // select C1 on Sheet1, then switch to Sheet2 and select B2
    await service.updateState(id, sheet1.id, "C1", { start: "C1", end: "C1" });
    const switched = await service.updateState(id, sheet2.id, "B2", { start: "B2", end: "B2" });
    assert.equal(switched.activeSheetId, sheet2.id);
    // switching does not modify the source worksheet
    assert.equal(switched.sheets[0].selectedCell, "C1");
    assert.deepEqual(switched.sheets[0].selectedRange, { start: "C1", end: "C1" });
    assert.equal(switched.sheets[0].cells.A1, "Region");
    assert.equal(switched.sheets[0].cells.C1, "Status");
    assert.equal(switched.sheets[1].selectedCell, "B2");

    // reopening from disk restores the last active tab and each sheet's own selection
    const reopened = createWorkbookService(directory);
    const restored = await reopened.get(id);
    assert.equal(restored.activeSheetId, sheet2.id);
    assert.equal(restored.sheets[0].selectedCell, "C1");
    assert.deepEqual(restored.sheets[0].selectedRange, { start: "C1", end: "C1" });
    assert.equal(restored.sheets[1].selectedCell, "B2");
    assert.deepEqual(restored.sheets[1].selectedRange, { start: "B2", end: "B2" });
    // grid values stay per-sheet
    assert.equal(restored.sheets[0].cells.A2, "East");
    assert.equal(restored.sheets[1].cells.A1, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("imports CSV as a new workbook named after the file", async () => {
  const { service, directory } = await freshService();
  try {
    const workbook = await service.importCsv(
      "quarterly.csv",
      "Region,Amount\nEast,1200\nNorth,800\n",
    );
    assert.equal(workbook.name, "quarterly");
    const sheet = workbook.sheets[0];
    assert.equal(sheet.name, "Sheet1");
    assert.equal(sheet.cells.A1, "Region");
    assert.equal(sheet.cells.B1, "Amount");
    assert.equal(sheet.cells.A2, "East");
    assert.equal(sheet.cells.B2, "1200");
    assert.equal(sheet.cells.A3, "North");
    assert.equal(sheet.cells.B3, "800");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("import preserves empty fields, quoted commas and line breaks", async () => {
  const { service, directory } = await freshService();
  try {
    const workbook = await service.importCsv(
      "complex.csv",
      'name,note,count\n"Sales, Q3","line1\nline2",3\nplain,,0\n',
    );
    const sheet = workbook.sheets[0];
    assert.equal(sheet.cells.A1, "name");
    assert.equal(sheet.cells.B1, "note");
    assert.equal(sheet.cells.C1, "count");
    assert.equal(sheet.cells.A2, "Sales, Q3");
    assert.equal(sheet.cells.B2, "line1\nline2");
    assert.equal(sheet.cells.C2, "3");
    assert.equal(sheet.cells.A3, "plain");
    assert.equal(sheet.cells.C3, "0");
    assert.ok(!("B3" in sheet.cells));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects invalid CSV and creates no workbook record", async () => {
  const { service, directory } = await freshService();
  try {
    await assert.rejects(
      () => service.importCsv("broken.csv", 'a,"unclosed\nb,c\n'),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 400);
        assert.equal(error.message, "Invalid CSV file format. Import failed.");
        return true;
      },
    );
    const list = await service.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "Q3 Sales");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("gets a missing workbook with 404", async () => {
  const { service, directory } = await freshService();
  try {
    await assert.rejects(() => service.get("wb_missing"), (error) => {
      assert.equal(error.status, 404);
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("coordinate helpers produce expected names", () => {
  assert.equal(columnName(0), "A");
  assert.equal(columnName(25), "Z");
  assert.equal(columnName(26), "AA");
  assert.equal(cellName(1, 0), "A1");
  assert.equal(cellName(2, 1), "B2");
  assert.equal(cellName(12, 27), "AB12");
});

test("parseCoord reads row and column indices", () => {
  assert.deepEqual(parseCoord("A1"), { row: 1, col: 0 });
  assert.deepEqual(parseCoord("B2"), { row: 2, col: 1 });
  assert.deepEqual(parseCoord("AA10"), { row: 10, col: 26 });
  assert.equal(parseCoord("A0"), null);
  assert.equal(parseCoord("1A"), null);
  assert.equal(parseCoord(""), null);
});

test("exports the seeded workbook as a two-sheet CSV of the active sheet", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const exported = await service.exportSheetCsv(list[0].id);
    assert.equal(exported.fileName, "Sheet1.csv");
    assert.equal(
      exported.content,
      "Region,Sales,Status\r\nEast,1200,Open\r\nNorth,800,Closed\r\nSouth,700,Open\r\n",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("adds a worksheet with the first unused SheetN name and activates it", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const added = await service.addSheet(id);
    assert.equal(added.sheets.length, 3);
    const names = added.sheets.map((sheet) => sheet.name);
    assert.deepEqual(names, ["Sheet1", "Sheet2", "Sheet3"]);
    const newSheet = added.sheets[2];
    assert.deepEqual(newSheet.cells, {});
    assert.equal(newSheet.selectedCell, "A1");
    assert.equal(added.activeSheetId, newSheet.id);
    // existing sheets and their data are unchanged
    assert.equal(added.sheets[0].cells.A2, "East");
    const reloaded = await service.get(id);
    assert.equal(reloaded.activeSheetId, newSheet.id);
    assert.equal(reloaded.sheets.length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("adds a worksheet after gaps in the SheetN sequence are taken", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    await service.renameSheet(id, workbook.sheets[1].id, "Data");
    const added = await service.addSheet(id);
    const names = added.sheets.map((sheet) => sheet.name);
    assert.deepEqual(names, ["Sheet1", "Data", "Sheet2"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("renames a worksheet, trims the name, and keeps it after reload", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const renamed = await service.renameSheet(id, workbook.sheets[0].id, "  Sales Data  ");
    assert.equal(renamed.sheets[0].name, "Sales Data");
    assert.equal(renamed.sheets[1].name, "Sheet2");
    const reloaded = await service.get(id);
    assert.equal(reloaded.sheets[0].name, "Sales Data");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects an empty worksheet name and keeps the original", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    await assert.rejects(() => service.renameSheet(id, workbook.sheets[0].id, "   "), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "Worksheet name cannot be empty");
      return true;
    });
    const after = await service.get(id);
    assert.equal(after.sheets[0].name, "Sheet1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a duplicate worksheet name within the workbook", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    await assert.rejects(() => service.renameSheet(id, workbook.sheets[0].id, "Sheet2"), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "Worksheet name already exists");
      return true;
    });
    const after = await service.get(id);
    assert.equal(after.sheets[0].name, "Sheet1");
    // renaming to itself (case-only change) is allowed
    const renamed = await service.renameSheet(id, workbook.sheets[0].id, "sheet1");
    assert.equal(renamed.sheets[0].name, "sheet1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deletes a worksheet, activates an adjacent one, and keeps the rest after reload", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheet1 = workbook.sheets[0];
    const sheet2 = workbook.sheets[1];

    // deleting a non-active worksheet keeps the active sheet unchanged
    const deleted = await service.deleteSheet(id, sheet2.id);
    assert.deepEqual(deleted.sheets.map((sheet) => sheet.name), ["Sheet1"]);
    assert.equal(deleted.activeSheetId, sheet1.id);
    assert.equal(deleted.sheets[0].cells.A2, "East");
    assert.equal(deleted.sheets[0].cells.B2, "1200");

    // reload: the tab stays absent and the remaining sheet keeps its data
    const reloaded = await service.get(id);
    assert.equal(reloaded.sheets.length, 1);
    assert.equal(reloaded.sheets[0].name, "Sheet1");
    assert.equal(reloaded.sheets[0].cells.A3, "North");
    assert.equal(reloaded.sheets[0].cells.B3, "800");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deleting the active worksheet activates an adjacent worksheet", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheet1 = workbook.sheets[0];
    const sheet2 = workbook.sheets[1];
    await service.addSheet(id);
    const three = await service.get(id);
    const sheet3 = three.sheets[2];

    // deleting the active middle sheet activates the next sheet
    await service.updateState(id, sheet2.id, "A1", { start: "A1", end: "A1" });
    const middle = await service.deleteSheet(id, sheet2.id);
    assert.deepEqual(middle.sheets.map((sheet) => sheet.name), ["Sheet1", "Sheet3"]);
    assert.equal(middle.activeSheetId, sheet3.id);

    // deleting the active last sheet activates the previous sheet
    await service.updateState(id, sheet3.id, "A1", { start: "A1", end: "A1" });
    const last = await service.deleteSheet(id, sheet3.id);
    assert.deepEqual(last.sheets.map((sheet) => sheet.name), ["Sheet1"]);
    assert.equal(last.activeSheetId, sheet1.id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects deleting the only remaining worksheet and keeps it intact", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheet1 = workbook.sheets[0];
    await service.deleteSheet(id, workbook.sheets[1].id);

    await assert.rejects(() => service.deleteSheet(id, sheet1.id), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "A workbook must contain at least one worksheet");
      return true;
    });
    const after = await service.get(id);
    assert.equal(after.sheets.length, 1);
    assert.equal(after.sheets[0].name, "Sheet1");
    assert.equal(after.sheets[0].cells.A2, "East");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects deleting a pivot source worksheet and keeps both worksheets unchanged", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    await service.createPivotTable(id, sheetId, { start: "A1", end: "C6" });

    await assert.rejects(() => service.deleteSheet(id, sheetId), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "Please delete or rebuild dependent pivot tables first");
      return true;
    });
    const after = await service.get(id);
    assert.deepEqual(after.sheets.map((sheet) => sheet.name), ["Sheet1", "Sheet2", "Pivot1"]);
    assert.equal(after.sheets[0].cells.A2, "East");
    assert.ok(after.sheets[2].pivot);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deleting a pivot-result worksheet is allowed and frees its source worksheet", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    const created = await service.createPivotTable(id, sheetId, { start: "A1", end: "C6" });
    const pivotSheet = created.sheets.find((sheet) => sheet.pivot);
    assert.ok(pivotSheet);

    const deleted = await service.deleteSheet(id, pivotSheet.id);
    assert.deepEqual(deleted.sheets.map((sheet) => sheet.name), ["Sheet1", "Sheet2"]);
    assert.ok(!deleted.sheets.some((sheet) => sheet.pivot));
    assert.equal(deleted.sheets[0].cells.A2, "East");

    // the source worksheet is no longer constrained: it can now be deleted
    const sheet1 = deleted.sheets[0];
    const remaining = await service.deleteSheet(id, sheet1.id);
    assert.deepEqual(remaining.sheets.map((sheet) => sheet.name), ["Sheet2"]);
    assert.equal(remaining.activeSheetId, remaining.sheets[0].id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("inserts a row above the target row and shifts cells down", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    const updated = await service.insertRow(id, sheetId, 3, "above");
    const cells = updated.sheets[0].cells;
    assert.equal(cells.A1, "Region");
    assert.equal(cells.A2, "East");
    assert.equal(cells.B2, "1200");
    assert.equal(cells.A3, undefined);
    assert.equal(cells.B3, undefined);
    assert.equal(cells.A4, "North");
    assert.equal(cells.B4, "800");
    const reloaded = await service.get(id);
    assert.equal(reloaded.sheets[0].cells.A4, "North");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("inserts a row below the target row", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    const updated = await service.insertRow(id, sheetId, 2, "below");
    const cells = updated.sheets[0].cells;
    assert.equal(cells.A2, "East");
    assert.equal(cells.A3, undefined);
    assert.equal(cells.A4, "North");
    assert.equal(cells.B4, "800");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deletes a row and shifts subsequent rows up", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    const updated = await service.deleteRow(id, sheetId, 2);
    const cells = updated.sheets[0].cells;
    assert.equal(cells.A1, "Region");
    assert.equal(cells.A2, "North");
    assert.equal(cells.B2, "800");
    assert.equal(cells.A3, "South");
    assert.equal(cells.B3, "700");
    // other sheets are untouched
    assert.deepEqual(updated.sheets[1].cells, {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("inserts and deletes columns with coordinate shifting", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    const inserted = await service.insertColumn(id, sheetId, 2, "left");
    let cells = inserted.sheets[0].cells;
    assert.equal(cells.A2, "East");
    assert.equal(cells.C2, "1200");
    assert.equal(cells.C3, "800");
    const insertedRight = await service.insertColumn(id, sheetId, 1, "right");
    cells = insertedRight.sheets[0].cells;
    assert.equal(cells.A2, "East");
    assert.equal(cells.D2, "1200");
    assert.equal(cells.D3, "800");
    const deleted = await service.deleteColumn(id, sheetId, 3);
    cells = deleted.sheets[0].cells;
    assert.equal(cells.A2, "East");
    assert.equal(cells.C2, "1200");
    assert.equal(cells.C3, "800");
    assert.equal(cells.D2, "Open");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("structure operations rewrite formula references and emit #REF! for lost references", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;

    await service.updateCells(id, sheetId, {
      A1: "=B1+C1",
      B1: "10",
      C1: "20",
      D1: "=C1*2",
      A2: "=B2",
    });

    // insert a blank column to the left of B (index 2): everything from B on
    // shifts right and formulas point at the same logical cells.
    const inserted = await service.insertColumn(id, sheetId, 2, "left");
    let cells = inserted.sheets[0].cells;
    assert.equal(cells.A1, "=C1+D1");
    assert.ok(!("B1" in cells));
    assert.equal(cells.C1, "10");
    assert.equal(cells.D1, "20");
    assert.equal(cells.E1, "=D1*2");
    assert.equal(cells.A2, "=C2");
    assert.ok(!("B2" in cells));

    // delete column C (index 3): the column is removed, later columns shift
    // left, and direct references into the deleted column become #REF!.
    const deleted = await service.deleteColumn(id, sheetId, 3);
    cells = deleted.sheets[0].cells;
    assert.equal(cells.A1, "=#REF!+C1");
    assert.ok(!("B1" in cells));
    assert.equal(cells.C1, "20");
    assert.equal(cells.D1, "=C1*2");
    assert.equal(cells.A2, "=#REF!");
    assert.ok(!("E1" in cells));

    // row ops rewrite references the same way
    const rowInserted = await service.insertRow(id, sheetId, 3, "above");
    cells = rowInserted.sheets[0].cells;
    assert.equal(cells.A1, "=#REF!+C1");
    const rowDeleted = await service.deleteRow(id, sheetId, 3);
    cells = rowDeleted.sheets[0].cells;
    assert.equal(cells.A1, "=#REF!+C1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("structure operations reject invalid indices and positions", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    await assert.rejects(() => service.insertRow(id, sheetId, 0, "above"), (error) => {
      assert.equal(error.message, "Invalid row index");
      return true;
    });
    await assert.rejects(() => service.insertRow(id, sheetId, 2, "left"), (error) => {
      assert.equal(error.message, "Invalid row position");
      return true;
    });
    await assert.rejects(() => service.deleteColumn(id, sheetId, -1), (error) => {
      assert.equal(error.message, "Invalid column index");
      return true;
    });
    await assert.rejects(() => service.deleteRow("wb_missing", sheetId, 1), (error) => {
      assert.equal(error.status, 404);
      return true;
    });
    await assert.rejects(() => service.renameSheet(id, "s_missing", "X"), (error) => {
      assert.equal(error.message, "Worksheet not found");
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("exports the used range with row and column order and empty fields", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const sheetId = (await service.get(id)).activeSheetId;
    await service.updateCells(id, sheetId, {
      A2: "East",
      B2: "1200",
      A3: "North",
      B3: "800",
    });
    const exported = await service.exportSheetCsv(id);
    assert.equal(
      exported.content,
      "Region,Sales,Status\r\nEast,1200,Open\r\nNorth,800,Closed\r\nSouth,700,Open\r\n",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("export preserves internal gaps as empty fields", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const sheetId = (await service.get(id)).activeSheetId;
    await service.updateCells(id, sheetId, { C1: "x", A3: "deep" });
    const exported = await service.exportSheetCsv(id);
    assert.equal(
      exported.content,
      "Region,Sales,x\r\nEast,1200,Open\r\ndeep,800,Closed\r\nSouth,700,Open\r\n",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("export escapes commas, quotes and line breaks in cells", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const sheetId = (await service.get(id)).activeSheetId;
    await service.updateCells(id, sheetId, {
      A2: "Sales, Q3",
      B2: 'say "hi"',
      C2: "line1\nline2",
    });
    const exported = await service.exportSheetCsv(id);
    assert.equal(
      exported.content,
      "Region,Sales,Status\r\n\"Sales, Q3\",\"say \"\"hi\"\"\",\"line1\nline2\"\r\nNorth,800,Closed\r\nSouth,700,Open\r\n",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("export reads only the active sheet and does not bump updatedAt", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const before = await service.get(id);
    const exported = await service.exportSheetCsv(id);
    const after = await service.get(id);
    assert.equal(exported.fileName, "Sheet1.csv");
    assert.equal(after.updatedAt, before.updatedAt);
    assert.deepEqual(after.sheets[0].cells, before.sheets[0].cells);
    assert.equal(after.activeSheetId, before.activeSheetId);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("exporting a missing workbook fails with 404", async () => {
  const { service, directory } = await freshService();
  try {
    await assert.rejects(() => service.exportSheetCsv("wb_missing"), (error) => {
      assert.equal(error.status, 404);
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("responses attach computed results and persist the original formula text", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const sheetId = (await service.get(id)).activeSheetId;
    const updated = await service.updateCells(id, sheetId, {
      A1: "2",
      B1: "3",
      C1: "=A1+B1",
      D1: "=C1*2",
    });
    const sheet = updated.sheets[0];
    assert.equal(sheet.cells.C1, "=A1+B1"); // original formula is stored
    assert.equal(sheet.cells.D1, "=C1*2");
    assert.equal(sheet.results.C1, "5"); // derived result
    assert.equal(sheet.results.D1, "10");

    // results are recomputed after a source change
    const after = await service.updateCells(id, sheetId, { A1: "4" });
    assert.equal(after.sheets[0].results.C1, "7");
    assert.equal(after.sheets[0].results.D1, "14");

    // refresh recomputes the same results from the stored formulas
    const reloaded = await service.get(id);
    assert.equal(reloaded.sheets[0].results.C1, "7");
    assert.equal(reloaded.sheets[0].results.D1, "14");
    assert.equal(reloaded.sheets[0].cells.C1, "=A1+B1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dependent formulas recompute in dependency order after a source-value edit and refresh", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const sheetId = (await service.get(id)).activeSheetId;
    // seed the REQ-4-1-1 evaluation-seed shape: A1=2, B1=3, =A1+B1, =C1*2
    await service.updateCells(id, sheetId, {
      A1: "2",
      B1: "3",
      C1: "=A1+B1",
      D1: "=C1*2",
      E1: "=D1+1",
    });
    let sheet = (await service.get(id)).sheets[0];
    assert.equal(sheet.results.C1, "5");
    assert.equal(sheet.results.D1, "10");
    assert.equal(sheet.results.E1, "11");

    // one source edit recalculates the whole indirect chain
    sheet = (await service.updateCells(id, sheetId, { A1: "4" })).sheets[0];
    assert.equal(sheet.results.C1, "7");
    assert.equal(sheet.results.D1, "14");
    assert.equal(sheet.results.E1, "15");

    // after refresh the stored formulas and recomputed results stay consistent
    const reloaded = await service.get(id);
    assert.equal(reloaded.sheets[0].cells.C1, "=A1+B1");
    assert.equal(reloaded.sheets[0].results.C1, "7");
    assert.equal(reloaded.sheets[0].results.D1, "14");
    assert.equal(reloaded.sheets[0].results.E1, "15");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("results recompute from the shifted formulas after row/column structure changes", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const sheetId = (await service.get(id)).activeSheetId;
    await service.updateCells(id, sheetId, {
      A1: "2",
      B1: "3",
      C1: "=A1+B1",
      D1: "=C1*2",
    });

    // insert a row above row 1: everything shifts down, formulas keep
    // pointing at the same logical cells, results recompute in the new place
    let sheet = (await service.insertRow(id, sheetId, 1, "above")).sheets[0];
    assert.equal(sheet.cells.A2, "2");
    assert.equal(sheet.cells.B2, "3");
    assert.equal(sheet.cells.C2, "=A2+B2");
    assert.equal(sheet.cells.D2, "=C2*2");
    assert.equal(sheet.results.C2, "5");
    assert.equal(sheet.results.D2, "10");
    const afterInsert = await service.get(id);
    assert.equal(afterInsert.sheets[0].results.D2, "10");

    // delete row 1 again: formulas shift back and results move with them
    sheet = (await service.deleteRow(id, sheetId, 1)).sheets[0];
    assert.equal(sheet.cells.C1, "=A1+B1");
    assert.equal(sheet.results.C1, "5");
    assert.equal(sheet.results.D1, "10");

    // insert a column left of A: formulas shift right with their data
    sheet = (await service.insertColumn(id, sheetId, 1, "left")).sheets[0];
    assert.equal(sheet.cells.B1, "2");
    assert.equal(sheet.cells.C1, "3");
    assert.equal(sheet.cells.D1, "=B1+C1");
    assert.equal(sheet.cells.E1, "=D1*2");
    assert.equal(sheet.results.D1, "5");
    assert.equal(sheet.results.E1, "10");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("formula errors keep stable tokens, isolate to dependents, and can be fixed", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const sheetId = (await service.get(id)).activeSheetId;
    await service.updateCells(id, sheetId, {
      A1: "1",
      B1: "0",
      C1: "=A1/B1", // #DIV/0!
      D1: "=FOO(1)", // #NAME?
      E1: "=1+", // #ERROR!
      F1: "=1+1", // unrelated cell stays healthy
      G1: "=C1+1", // dependent of the error shows the propagated error
    });
    let sheet = (await service.get(id)).sheets[0];
    assert.equal(sheet.cells.C1, "=A1/B1"); // original formula text is stored
    assert.equal(sheet.results.C1, "#DIV/0!");
    assert.equal(sheet.results.D1, "#NAME?");
    assert.equal(sheet.results.E1, "#ERROR!");
    assert.equal(sheet.results.G1, "#DIV/0!");
    // one erroneous formula does not affect unrelated cells
    assert.equal(sheet.results.F1, "2");

    // errors and formulas persist after refresh
    const reloaded = await service.get(id);
    assert.equal(reloaded.sheets[0].cells.C1, "=A1/B1");
    assert.equal(reloaded.sheets[0].results.C1, "#DIV/0!");
    assert.equal(reloaded.sheets[0].results.F1, "2");

    // fixing the failing source recalculates the error cell and its dependents
    sheet = (await service.updateCells(id, sheetId, { B1: "2" })).sheets[0];
    assert.equal(sheet.results.C1, "0.5");
    assert.equal(sheet.results.G1, "1.5");

    // replacing the malformed formula with a valid one removes the error
    sheet = (await service.updateCells(id, sheetId, { E1: "=1+2" })).sheets[0];
    assert.equal(sheet.results.E1, "3");
    const afterFix = await service.get(id);
    assert.equal(afterFix.sheets[0].results.E1, "3");
    assert.equal(afterFix.sheets[0].results.F1, "2");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("direct and indirect circular references display #REF! after refresh", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const sheetId = (await service.get(id)).activeSheetId;
    await service.updateCells(id, sheetId, {
      A1: "=B1",
      B1: "=A1", // direct cycle
      C1: "=D1+1",
      D1: "=C1*2", // indirect cycle
    });
    let sheet = (await service.get(id)).sheets[0];
    assert.equal(sheet.results.A1, "#REF!");
    assert.equal(sheet.results.B1, "#REF!");
    assert.equal(sheet.results.C1, "#REF!");
    assert.equal(sheet.results.D1, "#REF!");

    const reloaded = await service.get(id);
    assert.equal(reloaded.sheets[0].results.A1, "#REF!");
    assert.equal(reloaded.sheets[0].cells.A1, "=B1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persists the complete selection rectangle per worksheet", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    const updated = await service.updateState(id, sheetId, "A1", {
      start: "A1",
      end: "C3",
    });
    assert.deepEqual(updated.sheets[0].selectedRange, { start: "A1", end: "C3" });
    assert.equal(updated.sheets[0].selectedCell, "A1");

    // refresh restores the whole rectangle, not just the anchor
    const reloaded = await service.get(id);
    assert.deepEqual(reloaded.sheets[0].selectedRange, { start: "A1", end: "C3" });
    assert.equal(reloaded.sheets[0].selectedCell, "A1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("single-cell selection persists a collapsed rectangle", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    const updated = await service.updateState(id, sheetId, "B4");
    assert.deepEqual(updated.sheets[0].selectedRange, { start: "B4", end: "B4" });
    assert.equal(updated.sheets[0].selectedCell, "B4");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a 0-to-100 numeric validation rule rejects an out-of-range commit", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    const store = JSON.parse(await readFile(join(directory, "workbooks.json"), "utf8"));
    store.workbooks[0].sheets[0].validationRules = [
      { id: "r1", start: "D1", end: "E2", type: "number", min: 0, max: 100 },
    ];
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(directory, "workbooks.json"), JSON.stringify(store));

    await assert.rejects(
      () => service.updateCells(id, sheetId, { D1: "East", E2: "101" }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 400);
        assert.equal(error.message, "Please enter a number from 0 to 100");
        return true;
      },
    );
    // nothing was written; D1 keeps its seeded (empty) value
    const after = await service.get(id);
    assert.ok(!("D1" in after.sheets[0].cells));
    assert.ok(!("E2" in after.sheets[0].cells));

    // valid values are accepted and persisted
    const ok = await service.updateCells(id, sheetId, { D1: "50", E2: "100" });
    assert.equal(ok.sheets[0].cells.D1, "50");
    assert.equal(ok.sheets[0].cells.E2, "100");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a generic numeric rule reports between-message wording", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    const store = JSON.parse(await readFile(join(directory, "workbooks.json"), "utf8"));
    store.workbooks[0].sheets[0].validationRules = [
      { id: "r1", start: "A1", end: "A1", type: "number", min: 10, max: 20 },
    ];
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(directory, "workbooks.json"), JSON.stringify(store));
    await assert.rejects(() => service.updateCells(id, sheetId, { A1: "25" }), (error) => {
      assert.equal(error.message, "Please enter a number between 10 and 20");
      return true;
    });
    // clearing a validated cell is allowed
    await service.updateCells(id, sheetId, { A1: "" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("export writes formula results instead of formula expressions", async () => {
  const { service, directory } = await freshService();
  try {
    const created = await service.create("Formula export");
    const sheetId = created.activeSheetId;
    await service.updateCells(created.id, sheetId, {
      A1: "2",
      B1: "3",
      C1: "=A1+B1",
    });
    const exported = await service.exportSheetCsv(created.id);
    assert.equal(exported.content, "2,3,5\r\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("filter view persists per worksheet and clears on null", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;

    const filtered = await service.updateFilter(id, sheetId, {
      start: "A1",
      end: "C6",
      columns: {
        A: { kind: "values", selected: ["East"] },
        B: { kind: "condition", condition: "Greater than", value: "900" },
      },
    });
    assert.deepEqual(filtered.sheets[0].filter, {
      start: "A1",
      end: "C6",
      columns: {
        A: { kind: "values", selected: ["East"] },
        B: { kind: "condition", condition: "Greater than", value: "900" },
      },
    });

    // refresh keeps the same filter view
    const reloaded = await service.get(id);
    assert.deepEqual(reloaded.sheets[0].filter, filtered.sheets[0].filter);
    assert.equal(reloaded.sheets[1].filter, null);

    // clearing restores all rows (filter removed)
    const cleared = await service.updateFilter(id, sheetId, null);
    assert.equal(cleared.sheets[0].filter, null);
    const after = await service.get(id);
    assert.equal(after.sheets[0].filter, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("filter rejects invalid ranges and columns", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    await assert.rejects(
      () => service.updateFilter(id, sheetId, { start: "A1", end: "Z99", columns: { AA: { kind: "values", selected: [] } } }),
      (error) => error.status === 400 && error.message === "Filter column outside range",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("saves dropdown and number validation rules that persist after refresh", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;

    const saved = await service.saveValidationRule(id, sheetId, {
      start: "A1",
      end: "A2",
      type: "dropdown",
      allowed: [" East ", "North", ""],
    });
    const dropdown = saved.sheets[0].validationRules[0];
    assert.equal(dropdown.type, "dropdown");
    // comma-separated items are trimmed; empty items are dropped
    assert.deepEqual(dropdown.allowed, ["East", "North"]);
    assert.deepEqual(dropdown.start, "A1");
    assert.deepEqual(dropdown.end, "A2");

    const numberSaved = await service.saveValidationRule(id, sheetId, {
      start: "B1",
      end: "B4",
      type: "number",
      min: 0,
      max: 100,
    });
    const numeric = numberSaved.sheets[0].validationRules[1];
    assert.equal(numeric.type, "number");
    assert.equal(numeric.min, 0);
    assert.equal(numeric.max, 100);

    // refresh keeps the rules
    const reloaded = await service.get(id);
    assert.equal(reloaded.sheets[0].validationRules.length, 2);
    assert.deepEqual(reloaded.sheets[0].validationRules[0].allowed, ["East", "North"]);
    assert.deepEqual(reloaded.sheets[0].validationRules[1].min, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("saving a rule edits the reopened rule id and makes the new range effective", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    const saved = await service.saveValidationRule(id, sheetId, {
      start: "A1",
      end: "A2",
      type: "dropdown",
      allowed: ["East", "North"],
    });
    const ruleId = saved.sheets[0].validationRules[0].id;
    const edited = await service.saveValidationRule(id, sheetId, {
      ruleId,
      start: "C1",
      end: "D3",
      type: "number",
      min: 5,
      max: 10,
    });
    const rules = edited.sheets[0].validationRules;
    assert.equal(rules.length, 1);
    assert.equal(rules[0].id, ruleId);
    assert.deepEqual(rules[0].start, "C1");
    assert.deepEqual(rules[0].end, "D3");
    assert.equal(rules[0].type, "number");
    assert.equal(rules[0].min, 5);
    assert.equal(rules[0].max, 10);
    assert.ok(!("allowed" in rules[0]));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deleting a rule removes the constraint and keeps cell values", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    const saved = await service.saveValidationRule(id, sheetId, {
      start: "A1",
      end: "A2",
      type: "dropdown",
      allowed: ["East"],
    });
    const ruleId = saved.sheets[0].validationRules[0].id;
    const deleted = await service.deleteValidationRule(id, sheetId, ruleId);
    assert.equal(deleted.sheets[0].validationRules.length, 0);
    // the seeded values are untouched
    assert.equal(deleted.sheets[0].cells.A1, "Region");
    await assert.rejects(
      () => service.deleteValidationRule(id, sheetId, ruleId),
      (error) => error.status === 400 && error.message === "Rule not found",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dropdown rules reject invalid commits and bulk pastes atomically", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    await service.saveValidationRule(id, sheetId, {
      start: "A2",
      end: "A3",
      type: "dropdown",
      allowed: ["East", "North", "South"],
    });

    await assert.rejects(
      () => service.updateCells(id, sheetId, { A2: "West" }),
      (error) =>
        error.message ===
        "Please select one of the following values: East, North, South",
    );
    const after = await service.get(id);
    assert.equal(after.sheets[0].cells.A2, "East"); // original value remains

    // a bulk update with one invalid target leaves every target unchanged
    await assert.rejects(
      () => service.updateCells(id, sheetId, { A2: "East", A3: "West" }),
      (error) => error.message.startsWith("Please select one of the following values"),
    );
    const untouched = await service.get(id);
    assert.equal(untouched.sheets[0].cells.A2, "East");
    assert.equal(untouched.sheets[0].cells.A3, "North");

    // valid dropdown values are accepted and persisted
    const ok = await service.updateCells(id, sheetId, { A2: "South", A3: "North" });
    assert.equal(ok.sheets[0].cells.A2, "South");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("validation rules move with cells across row and column changes", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    await service.saveValidationRule(id, sheetId, {
      start: "A2",
      end: "B3",
      type: "dropdown",
      allowed: ["East", "North"],
    });

    const inserted = await service.insertRow(id, sheetId, 2, "above");
    const rulesAfterRow = inserted.sheets[0].validationRules;
    assert.deepEqual(rulesAfterRow[0].start, "A3");
    assert.deepEqual(rulesAfterRow[0].end, "B4");

    const insertedColumn = await service.insertColumn(id, sheetId, 1, "right");
    const rulesAfterColumn = insertedColumn.sheets[0].validationRules;
    assert.deepEqual(rulesAfterColumn[0].start, "A3");
    assert.deepEqual(rulesAfterColumn[0].end, "C4");

    const deletedRow = await service.deleteRow(id, sheetId, 4);
    assert.deepEqual(deletedRow.sheets[0].validationRules[0].end, "C3");

    const deletedColumn = await service.deleteColumn(id, sheetId, 2);
    assert.deepEqual(deletedColumn.sheets[0].validationRules[0].start, "A3");
    assert.deepEqual(deletedColumn.sheets[0].validationRules[0].end, "B3");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a rule fully inside a deleted row/column is dropped", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    await service.saveValidationRule(id, sheetId, {
      start: "A2",
      end: "A2",
      type: "dropdown",
      allowed: ["East"],
    });
    const deleted = await service.deleteRow(id, sheetId, 2);
    assert.equal(deleted.sheets[0].validationRules.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("saveValidationRule rejects malformed payloads without changing state", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    await assert.rejects(
      () => service.saveValidationRule(id, sheetId, { start: "A1", end: "A2", type: "dropdown", allowed: [] }),
      (error) => error.status === 400 && error.message === "Allowed values cannot be empty",
    );
    await assert.rejects(
      () => service.saveValidationRule(id, sheetId, { start: "A1", end: "A2", type: "number", min: 5, max: 3 }),
      (error) => error.status === 400 && error.message === "Minimum must not exceed Maximum",
    );
    const after = await service.get(id);
    assert.equal(after.sheets[0].validationRules.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sorts a range by column and persists the order after refresh (REQ-5-1-1)", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    // build the seeded A1:C4 table on top of the shared seed
    await service.updateCells(id, sheetId, {
      A1: "Region",
      B1: "Sales",
      C1: "Status",
      A2: "East",
      B2: "1200",
      C2: "Open",
      A3: "North",
      B3: "800",
      C3: "Closed",
      A4: "South",
      B4: "700",
      C4: "Open",
    });

    const sorted = await service.sortRange(id, sheetId, {
      start: "A1",
      end: "C4",
      column: "B",
      order: "ascending",
      hasHeader: true,
    });
    const sheet = sorted.sheets[0];
    assert.equal(sheet.cells.A1, "Region");
    assert.equal(sheet.cells.A2, "South");
    assert.equal(sheet.cells.B2, "700");
    assert.equal(sheet.cells.A3, "North");
    assert.equal(sheet.cells.B3, "800");
    assert.equal(sheet.cells.A4, "East");
    assert.equal(sheet.cells.B4, "1200");

    // results and cells persist after reopening from disk
    const reopened = createWorkbookService(directory);
    const restored = await reopened.get(id);
    assert.equal(restored.sheets[0].cells.A2, "South");
    assert.equal(restored.sheets[0].cells.B2, "700");
    assert.equal(restored.sheets[0].cells.A4, "East");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sorting recomputes dependent formula results at the new positions", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    await service.updateCells(id, sheetId, {
      A1: "Region",
      B1: "Sales",
      C1: "Double",
      A2: "East",
      B2: "1200",
      C2: "=B2*2",
      A3: "North",
      B3: "800",
      C3: "=B3*2",
      A4: "South",
      B4: "700",
      C4: "=B4*2",
    });
    const sorted = await service.sortRange(id, sheetId, {
      start: "A1",
      end: "C4",
      column: "B",
      order: "ascending",
      hasHeader: true,
    });
    // South moved to row 2; its formula text moved with it, and results
    // recompute from the new positions on every read (B4 now holds East's 1200).
    assert.equal(sorted.sheets[0].cells.C2, "=B4*2");
    assert.equal(sorted.sheets[0].cells.A2, "South");
    assert.equal(sorted.sheets[0].results.C2, "2400");
    assert.equal(sorted.sheets[0].cells.C4, "=B2*2");
    assert.equal(sorted.sheets[0].results.C4, "1400");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sorting keeps the selection range, filter, and validation rules unchanged", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    await service.updateCells(id, sheetId, {
      A1: "Region",
      B1: "Sales",
      A2: "East",
      B2: "1200",
      A3: "North",
      B3: "800",
      A4: "South",
      B4: "700",
    });
    await service.updateFilter(id, sheetId, {
      start: "A1",
      end: "C6",
      columns: { A: { kind: "values", selected: ["East", "North", "South"] } },
    });
    await service.saveValidationRule(id, sheetId, {
      start: "A2",
      end: "A4",
      type: "dropdown",
      allowed: ["East", "North", "South"],
    });

    const sorted = await service.sortRange(id, sheetId, {
      start: "A1",
      end: "C6",
      column: "B",
      order: "descending",
      hasHeader: true,
    });
    const sheet = sorted.sheets[0];
    assert.deepEqual(sheet.filter, {
      start: "A1",
      end: "C6",
      columns: { A: { kind: "values", selected: ["East", "North", "South"] } },
    });
    assert.deepEqual(sheet.validationRules, [
      { id: sheet.validationRules[0].id, start: "A2", end: "A4", type: "dropdown", allowed: ["East", "North", "South"] },
    ]);
    // descending by Sales: East first, then North, then South
    assert.equal(sheet.cells.A2, "East");
    assert.equal(sheet.cells.A3, "North");
    assert.equal(sheet.cells.A4, "South");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed sort request keeps the original order", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    await service.updateCells(id, sheetId, {
      A1: "Region",
      B1: "Sales",
      A2: "East",
      B2: "1200",
      A3: "North",
      B3: "800",
    });
    await assert.rejects(
      () => service.sortRange(id, sheetId, { start: "A1", end: "B3", column: "D", order: "ascending", hasHeader: true }),
      (error) => error.status === 400 && error.message === "Sort column outside range",
    );
    await assert.rejects(
      () => service.sortRange(id, sheetId, { start: "A1", end: "B3", column: "A", order: "sideways", hasHeader: true }),
      (error) => error.status === 400 && error.message === "Invalid sort order",
    );
    const after = await service.get(id);
    assert.equal(after.sheets[0].cells.A2, "East");
    assert.equal(after.sheets[0].cells.A3, "North");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
