import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  dataDir,
  dataFile,
  loadData,
  saveData,
  seedData,
  listWorkbooks,
  getWorkbook,
  createWorkbook,
  renameWorkbook,
  addSheet,
  renameSheet,
  modifyRows,
  modifyColumns,
  setCellValue,
  setSelection,
  firstUnusedSheetName,
  importCsvWorkbook,
  workbookNameFromFileName,
  DEFAULT_WORKBOOK_NAME,
} from "../src/store.js";

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sheet-store-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("seeds the store with Q3 Sales / Sheet1+Sheet2 / A1:B2 Item/Qty and Pen/4 when empty", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  assert.equal(data.workbooks.length, 1);
  const wb = data.workbooks[0];
  assert.equal(wb.name, "Q3 Sales");
  assert.equal(wb.sheets.length, 2);
  assert.equal(wb.sheets[0].name, "Sheet1");
  assert.deepEqual(wb.sheets[0].cells, {
    A1: "Item",
    B1: "Qty",
    A2: "Pen",
    B2: "4",
  });
  assert.deepEqual(wb.sheets[0].selection, { current: "A1", end: "A1" });
  assert.equal(wb.sheets[1].name, "Sheet2");
  assert.deepEqual(wb.sheets[1].cells, {});
  assert.equal(wb.activeSheetId, wb.sheets[0].id);
  assert.equal(wb.sheets[0].activeCell, "A1");
  // persisted on disk
  const raw = await fs.readFile(dataFile(), "utf8");
  assert.ok(JSON.parse(raw).workbooks[0].name === "Q3 Sales");
});

test("keeps saved modifications and does not reseed when data exists", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  data.workbooks[0].name = "Renamed";
  await saveData(data);
  const reloaded = await loadData();
  assert.equal(reloaded.workbooks[0].name, "Renamed");
});

test("listWorkbooks returns summaries ordered by updatedAt desc", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  await loadData(); // seeds the store first
  await new Promise((resolve) => setTimeout(resolve, 5)); // ensure distinct timestamps
  const created = await createWorkbook("  Second  ");
  assert.equal(created.name, "Second");
  const list = await listWorkbooks();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, created.id);
  assert.deepEqual(Object.keys(list[0]).sort(), ["id", "name", "updatedAt"]);
});

test("getWorkbook returns null for unknown id", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  await loadData();
  assert.equal(await getWorkbook("nope"), null);
});

test("createWorkbook makes a blank workbook with Sheet1 active and A1 selected", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const wb = await createWorkbook();
  assert.equal(wb.name, DEFAULT_WORKBOOK_NAME);
  assert.equal(wb.sheets.length, 1);
  assert.equal(wb.sheets[0].name, "Sheet1");
  assert.deepEqual(wb.sheets[0].cells, {});
  assert.equal(wb.sheets[0].activeCell, "A1");
  assert.equal(wb.activeSheetId, wb.sheets[0].id);
  // persists
  const reloaded = await getWorkbook(wb.id);
  assert.equal(reloaded.sheets[0].name, "Sheet1");
});

test("rename trims whitespace and persists the new name", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const result = await renameWorkbook(wb.id, "  FY26 Sales  ");
  assert.equal(result.error, undefined);
  assert.equal(result.workbook.name, "FY26 Sales");
  const reloaded = await getWorkbook(wb.id);
  assert.equal(reloaded.name, "FY26 Sales");
});

test("rename rejects an empty (or whitespace-only) name", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  for (const bad of ["", "   ", "\t "]) {
    const result = await renameWorkbook(wb.id, bad);
    assert.ok(result.error);
    assert.equal(result.error.code, "EMPTY_NAME");
    assert.equal(result.error.message, "Workbook name cannot be empty");
  }
  // original name unchanged and persisted
  assert.equal((await getWorkbook(wb.id)).name, "Q3 Sales");
});

test("firstUnusedSheetName picks the first unused SheetN in order", () => {
  assert.equal(firstUnusedSheetName([]), "Sheet1");
  assert.equal(firstUnusedSheetName([{ name: "Sheet1" }]), "Sheet2");
  assert.equal(firstUnusedSheetName([{ name: "Sheet1" }, { name: "Sheet2" }]), "Sheet3");
  assert.equal(firstUnusedSheetName([{ name: "Sheet1" }, { name: "Sheet3" }]), "Sheet2");
  assert.equal(firstUnusedSheetName([{ name: "sheet1" }, { name: "Data" }]), "Sheet2");
  assert.equal(firstUnusedSheetName([{ name: "Data" }]), "Sheet1");
});

test("addSheet appends a blank active sheet with the first unused SheetN name", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const before = wb.sheets.length;
  const result = await addSheet(wb.id);
  assert.equal(result.error, undefined);
  assert.equal(result.workbook.sheets.length, before + 1);
  const added = result.workbook.sheets[result.workbook.sheets.length - 1];
  assert.equal(added.name, "Sheet3");
  assert.deepEqual(added.cells, {});
  assert.equal(added.activeCell, "A1");
  assert.equal(result.workbook.activeSheetId, added.id);
  // existing sheets and their data are unchanged
  assert.equal(result.workbook.sheets[0].name, "Sheet1");
  assert.deepEqual(result.workbook.sheets[0].cells, {
    A1: "Item",
    B1: "Qty",
    A2: "Pen",
    B2: "4",
  });
  // persists after reload
  const reloaded = await getWorkbook(wb.id);
  assert.equal(reloaded.sheets.length, before + 1);
  assert.equal(reloaded.sheets[reloaded.sheets.length - 1].name, "Sheet3");
  assert.equal(reloaded.activeSheetId, added.id);
});

test("addSheet on a workbook with only Sheet1 creates Sheet2", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const wb = await createWorkbook("Fresh");
  assert.equal(wb.sheets.length, 1);
  assert.equal(wb.sheets[0].name, "Sheet1");
  const result = await addSheet(wb.id);
  assert.equal(result.error, undefined);
  assert.equal(result.workbook.sheets[1].name, "Sheet2");
});

test("addSheet of an unknown workbook reports NOT_FOUND", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  await loadData();
  const result = await addSheet("missing");
  assert.equal(result.error.code, "NOT_FOUND");
});

test("renameSheet trims and persists the new worksheet name", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const sheet = wb.sheets[1];
  assert.equal(sheet.name, "Sheet2");
  const result = await renameSheet(wb.id, sheet.id, "  Data  ");
  assert.equal(result.error, undefined);
  assert.equal(result.workbook.sheets[1].name, "Data");
  // tab bar order and other sheets unchanged
  assert.equal(result.workbook.sheets[0].name, "Sheet1");
  const reloaded = await getWorkbook(wb.id);
  assert.equal(reloaded.sheets[1].name, "Data");
  assert.equal(reloaded.sheets.length, 2);
});

test("renameSheet rejects empty names with the exact message", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  for (const bad of ["", "   "]) {
    const result = await renameSheet(wb.id, wb.sheets[1].id, bad);
    assert.ok(result.error);
    assert.equal(result.error.code, "EMPTY_NAME");
    assert.equal(result.error.message, "Worksheet name cannot be empty");
  }
  assert.equal((await getWorkbook(wb.id)).sheets[1].name, "Sheet2");
});

test("renameSheet rejects duplicate names within the workbook", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const result = await renameSheet(wb.id, wb.sheets[1].id, "Sheet1");
  assert.ok(result.error);
  assert.equal(result.error.code, "DUPLICATE_SHEET_NAME");
  assert.equal(result.error.message, "Worksheet name already exists");
  // duplicate check is case-insensitive
  const lower = await renameSheet(wb.id, wb.sheets[1].id, "sheet1");
  assert.ok(lower.error);
  // original name remains unchanged and persisted
  assert.equal((await getWorkbook(wb.id)).sheets[1].name, "Sheet2");
});

test("renameSheet allows keeping the current name and reports NOT_FOUND for bad ids", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const same = await renameSheet(wb.id, wb.sheets[1].id, "  Sheet2  ");
  assert.equal(same.error, undefined);
  assert.equal(same.workbook.sheets[1].name, "Sheet2");
  const missingWb = await renameSheet("missing", wb.sheets[1].id, "X");
  assert.equal(missingWb.error.code, "NOT_FOUND");
  const missingSheet = await renameSheet(wb.id, "missing", "X");
  assert.equal(missingSheet.error.code, "NOT_FOUND");
});

test("rename of unknown workbook reports NOT_FOUND", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  await loadData();
  const result = await renameWorkbook("missing", "X");
  assert.equal(result.error.code, "NOT_FOUND");
});

test("modifyRows inserts a blank row above and shifts all later rows down", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const sheet = wb.sheets[0];
  const result = await modifyRows(wb.id, sheet.id, "insert-above", 2);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.workbook.sheets[0].cells, {
    A1: "Item",
    B1: "Qty",
    A3: "Pen",
    B3: "4",
  });
  // other worksheets are unchanged
  assert.deepEqual(result.workbook.sheets[1].cells, {});
  // persists after reopening
  const reopened = await getWorkbook(wb.id);
  assert.deepEqual(reopened.sheets[0].cells, result.workbook.sheets[0].cells);
});

test("modifyRows inserts a blank row below the target row", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const result = await modifyRows(wb.id, wb.sheets[0].id, "insert-below", 2);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.workbook.sheets[0].cells, {
    A1: "Item",
    B1: "Qty",
    A2: "Pen",
    B2: "4",
  });
});

test("modifyRows deletes the target row and shifts later rows up", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const result = await modifyRows(wb.id, wb.sheets[0].id, "delete", 2);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.workbook.sheets[0].cells, {
    A1: "Item",
    B1: "Qty",
  });
  const reopened = await getWorkbook(wb.id);
  assert.deepEqual(reopened.sheets[0].cells, { A1: "Item", B1: "Qty" });
});

test("modifyRows updates rowCount when rows move beyond the previous bounds", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  wb.sheets[0].cells.A50 = "bottom";
  await saveData(data);
  const result = await modifyRows(wb.id, wb.sheets[0].id, "insert-above", 50);
  assert.equal(result.error, undefined);
  assert.equal(result.workbook.sheets[0].cells.A51, "bottom");
  assert.equal(result.workbook.sheets[0].cells.A50, undefined);
  assert.equal(result.workbook.sheets[0].rowCount, 51);
});

test("modifyRows rejects invalid actions and row numbers without changing the sheet", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const before = JSON.stringify(data);
  for (const bad of [
    ["bogus", 2],
    ["insert-above", 0],
    ["insert-above", -1],
    ["insert-above", 1.5],
    ["insert-above", "x"],
    ["insert-above", undefined],
  ]) {
    const result = await modifyRows(wb.id, wb.sheets[0].id, bad[0], bad[1]);
    assert.ok(result.error);
    const after = await loadData();
    assert.equal(JSON.stringify(after), before, "state must not change on failure");
  }
});

test("modifyRows reports NOT_FOUND for unknown workbook or sheet", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const missingWb = await modifyRows("missing", wb.sheets[0].id, "insert-above", 1);
  assert.equal(missingWb.error.code, "NOT_FOUND");
  const missingSheet = await modifyRows(wb.id, "missing", "insert-above", 1);
  assert.equal(missingSheet.error.code, "NOT_FOUND");
});

test("modifyRows adjusts formula text and the active cell together with the shift", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  wb.sheets[0].cells.C4 = "=SUM(B2:B3)";
  wb.sheets[0].activeCell = "C4";
  await saveData(data);
  const result = await modifyRows(wb.id, wb.sheets[0].id, "insert-above", 2);
  assert.equal(result.error, undefined);
  assert.equal(result.workbook.sheets[0].cells.C5, "=SUM(B3:B4)");
  assert.equal(result.workbook.sheets[0].activeCell, "C5");
  const reopened = await getWorkbook(wb.id);
  assert.equal(reopened.sheets[0].cells.C5, "=SUM(B3:B4)");
});

test("modifyColumns inserts a blank column to the left and shifts data right", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const result = await modifyColumns(wb.id, wb.sheets[0].id, "insert-left", 2);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.workbook.sheets[0].cells, {
    A1: "Item",
    C1: "Qty",
    A2: "Pen",
    C2: "4",
  });
  // other worksheets are unchanged
  assert.deepEqual(result.workbook.sheets[1].cells, {});
  // persists after reopening
  const reopened = await getWorkbook(wb.id);
  assert.deepEqual(reopened.sheets[0].cells, result.workbook.sheets[0].cells);
});

test("modifyColumns inserts a blank column to the right of the target column", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const result = await modifyColumns(wb.id, wb.sheets[0].id, "insert-right", 2);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.workbook.sheets[0].cells, {
    A1: "Item",
    B1: "Qty",
    A2: "Pen",
    B2: "4",
  });
});

test("modifyColumns deletes the target column and shifts later columns left", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  // deleting column B removes the values that lived in column B (Qty/4)
  const result = await modifyColumns(wb.id, wb.sheets[0].id, "delete", 2);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.workbook.sheets[0].cells, {
    A1: "Item",
    A2: "Pen",
  });
  const reopened = await getWorkbook(wb.id);
  assert.deepEqual(reopened.sheets[0].cells, result.workbook.sheets[0].cells);
});

test("modifyColumns shifts data from a later column left into the deleted column's place", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  wb.sheets[0].cells.C4 = "moved";
  await saveData(data);
  const result = await modifyColumns(wb.id, wb.sheets[0].id, "delete", 2);
  assert.equal(result.error, undefined);
  assert.equal(result.workbook.sheets[0].cells.B4, "moved");
  assert.equal(result.workbook.sheets[0].cells.C4, undefined);
});

test("modifyColumns removes cells of the deleted column and preserves data outside it", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const result = await modifyColumns(wb.id, wb.sheets[0].id, "delete", 1);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.workbook.sheets[0].cells, { A1: "Qty", A2: "4" });
});

test("modifyColumns updates columnCount when columns move beyond the previous bounds", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  wb.sheets[0].cells.H1 = "right";
  await saveData(data);
  const result = await modifyColumns(wb.id, wb.sheets[0].id, "insert-left", 8);
  assert.equal(result.error, undefined);
  assert.equal(result.workbook.sheets[0].cells.I1, "right");
  assert.equal(result.workbook.sheets[0].cells.H1, undefined);
  assert.equal(result.workbook.sheets[0].columnCount, 9);
});

test("modifyColumns rejects invalid actions and column numbers without changing the sheet", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const before = JSON.stringify(data);
  for (const bad of [
    ["bogus", 2],
    ["insert-left", 0],
    ["insert-left", -1],
    ["insert-left", 1.5],
    ["insert-left", "x"],
    ["insert-left", undefined],
  ]) {
    const result = await modifyColumns(wb.id, wb.sheets[0].id, bad[0], bad[1]);
    assert.ok(result.error);
    const after = await loadData();
    assert.equal(JSON.stringify(after), before, "state must not change on failure");
  }
});

test("modifyColumns reports NOT_FOUND for unknown workbook or sheet", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const missingWb = await modifyColumns("missing", wb.sheets[0].id, "insert-left", 1);
  assert.equal(missingWb.error.code, "NOT_FOUND");
  const missingSheet = await modifyColumns(wb.id, "missing", "insert-left", 1);
  assert.equal(missingSheet.error.code, "NOT_FOUND");
});

test("modifyColumns adjusts formula text and the active cell together with the shift", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  wb.sheets[0].cells.D4 = "=SUM(B2:C2)";
  wb.sheets[0].activeCell = "D4";
  await saveData(data);
  const result = await modifyColumns(wb.id, wb.sheets[0].id, "insert-left", 2);
  assert.equal(result.error, undefined);
  assert.equal(result.workbook.sheets[0].cells.E4, "=SUM(C2:D2)");
  assert.equal(result.workbook.sheets[0].activeCell, "E4");
  const reopened = await getWorkbook(wb.id);
  assert.equal(reopened.sheets[0].cells.E4, "=SUM(C2:D2)");
});

test("modifyColumns turns direct references to a deleted column into #REF!", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  wb.sheets[0].cells.C5 = "=B2";
  await saveData(data);
  const result = await modifyColumns(wb.id, wb.sheets[0].id, "delete", 2);
  assert.equal(result.error, undefined);
  assert.equal(result.workbook.sheets[0].cells.B5, "=#REF!");
  assert.equal(result.workbook.sheets[0].cells.B2, undefined);
  assert.equal(result.workbook.sheets[0].cells.A1, "Item");
  assert.equal(result.workbook.sheets[0].cells.A2, "Pen");
});

test("setCellValue stores the value, updates the selection and updatedAt, and persists", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const sheet = wb.sheets[0];
  const before = wb.updatedAt;
  const result = await setCellValue(wb.id, sheet.id, "d1", "East");
  assert.equal(result.error, undefined);
  assert.equal(result.workbook.sheets[0].cells.D1, "East");
  assert.equal(result.workbook.sheets[0].activeCell, "D1");
  assert.deepEqual(result.workbook.sheets[0].selection, { current: "D1", end: "D1" });
  assert.ok(result.workbook.updatedAt >= before);
  const reopened = await getWorkbook(wb.id);
  assert.equal(reopened.sheets[0].cells.D1, "East");
  assert.deepEqual(reopened.sheets[0].selection, { current: "D1", end: "D1" });
});

test("setCellValue stores formula text verbatim and clears a cell with an empty value", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const sheet = wb.sheets[0];
  const formula = await setCellValue(wb.id, sheet.id, "C1", "=A1+B1");
  assert.equal(formula.workbook.sheets[0].cells.C1, "=A1+B1");
  const cleared = await setCellValue(wb.id, sheet.id, "C1", "");
  assert.equal(cleared.workbook.sheets[0].cells.C1, undefined);
  assert.equal((await getWorkbook(wb.id)).sheets[0].cells.C1, undefined);
});

test("setCellValue rejects bad coordinates/values and unknown ids without writing", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const before = JSON.stringify(data);
  const badCoord = await setCellValue(wb.id, wb.sheets[0].id, "1A", "x");
  assert.equal(badCoord.error.code, "INVALID_COORD");
  const badValue = await setCellValue(wb.id, wb.sheets[0].id, "A1", 42);
  assert.equal(badValue.error.code, "INVALID_VALUE");
  const missingWb = await setCellValue("missing", wb.sheets[0].id, "A1", "x");
  assert.equal(missingWb.error.code, "NOT_FOUND");
  const missingSheet = await setCellValue(wb.id, "missing", "A1", "x");
  assert.equal(missingSheet.error.code, "NOT_FOUND");
  const after = await loadData();
  assert.equal(JSON.stringify(after), before, "state must not change on failure");
});

test("setSelection persists the complete rectangle per worksheet and keeps updatedAt", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const before = wb.updatedAt;
  const result = await setSelection(wb.id, wb.sheets[0].id, "A1", "C3");
  assert.equal(result.error, undefined);
  assert.deepEqual(result.workbook.sheets[0].selection, { current: "A1", end: "C3" });
  assert.equal(result.workbook.sheets[0].activeCell, "A1");
  assert.equal(result.workbook.updatedAt, before, "selecting must not change updatedAt");
  // the other worksheet keeps its own selection
  assert.deepEqual(result.workbook.sheets[1].selection, { current: "A1", end: "A1" });
  const reopened = await getWorkbook(wb.id);
  assert.deepEqual(reopened.sheets[0].selection, { current: "A1", end: "C3" });
  assert.deepEqual(reopened.sheets[1].selection, { current: "A1", end: "A1" });
});

test("setSelection rejects invalid coordinates and unknown ids without writing", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const data = await loadData();
  const wb = data.workbooks[0];
  const before = JSON.stringify(data);
  const bad = await setSelection(wb.id, wb.sheets[0].id, "A1", "nope");
  assert.equal(bad.error.code, "INVALID_COORD");
  const missingWb = await setSelection("missing", wb.sheets[0].id, "A1", "B1");
  assert.equal(missingWb.error.code, "NOT_FOUND");
  const missingSheet = await setSelection(wb.id, "missing", "A1", "B1");
  assert.equal(missingSheet.error.code, "NOT_FOUND");
  const after = await loadData();
  assert.equal(JSON.stringify(after), before, "state must not change on failure");
});

test("seed shape matches the documented contract", () => {
  const seeded = seedData();
  assert.equal(seeded.version, 1);
  assert.equal(seeded.workbooks[0].id, "wb-q3-sales");
  assert.ok(dataDir().length > 0);
});

test("workbookNameFromFileName removes the final .csv extension only", () => {
  assert.equal(workbookNameFromFileName("data.csv"), "data");
  assert.equal(workbookNameFromFileName("my.file.CSV"), "my.file");
  assert.equal(workbookNameFromFileName("noext"), "noext");
  assert.equal(workbookNameFromFileName("  data.csv  "), "data");
  assert.equal(workbookNameFromFileName(""), "Imported workbook");
});

test("importCsvWorkbook stores full rows/columns with empty fields preserved", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  const { workbook } = await importCsvWorkbook("report.csv", 'Region,East,"1,200"\nNorth,,800');
  assert.equal(workbook.name, "report");
  assert.equal(workbook.sheets[0].name, "Sheet1");
  assert.equal(workbook.sheets[0].rowCount, 2);
  assert.equal(workbook.sheets[0].columnCount, 3);
  assert.deepEqual(workbook.sheets[0].cells, { A1: "Region", B1: "East", C1: "1,200", A2: "North", C2: "800" });
  // persists and reopens with the same content
  const reopened = await getWorkbook(workbook.id);
  assert.deepEqual(reopened.sheets[0].cells, workbook.sheets[0].cells);
  assert.equal(reopened.sheets[0].rowCount, 2);
});

test("importCsvWorkbook rejects invalid CSV without writing a record", async (t) => {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  await loadData();
  const result = await importCsvWorkbook("bad.csv", 'a,"b');
  assert.ok(result.error);
  assert.equal(result.error.code, "INVALID_CSV");
  assert.equal(result.error.message, "Invalid CSV file format. Import failed.");
  const list = await listWorkbooks();
  assert.equal(list.length, 1);
  assert.ok(!list.some((w) => w.name === "bad"));
});
