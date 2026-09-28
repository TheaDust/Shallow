import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ApiError, createWorkbookService } from "../src/lib/workbooks.mjs";
import { computePivotCells, parsePivotNumber, shiftPivotRange } from "../src/lib/pivot.mjs";

async function freshService() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-pivot-"));
  const service = createWorkbookService(directory);
  return { service, directory };
}

async function seededWorkbook(service) {
  const list = await service.list();
  const id = list[0].id;
  const workbook = await service.get(id);
  return { id, workbook, sheetId: workbook.activeSheetId };
}

function pivotCells(result) {
  return result.sheets.find((sheet) => sheet.pivot).cells;
}

test("computePivotCells aggregates SUM without a column field in first-appearance order", () => {
  const source = {
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
  };
  const outcome = computePivotCells(
    source,
    {},
    { start: "A1", end: "C6" },
    { rowField: "Region", columnField: null, valueField: "Sales", summarizeBy: "SUM" },
  );
  assert.equal(outcome.error, null);
  assert.deepEqual(outcome.cells, {
    A1: "Region",
    B1: "SUM of Sales",
    A2: "East",
    B2: "1200",
    A3: "North",
    B3: "800",
    A4: "South",
    B4: "700",
    A5: "Grand Total",
    B5: "2700",
  });
});

test("computePivotCells supports COUNT and AVERAGE aggregation", () => {
  const source = {
    A1: "Region",
    B1: "Sales",
    A2: "East",
    B2: "1200",
    A3: "North",
    B3: "800",
    A4: "South",
    B4: "700",
  };
  const count = computePivotCells(
    source,
    {},
    { start: "A1", end: "B4" },
    { rowField: "Region", columnField: null, valueField: "Sales", summarizeBy: "COUNT" },
  );
  assert.deepEqual(count.cells.B2, "1");
  assert.deepEqual(count.cells.B5, "3");

  const average = computePivotCells(
    source,
    {},
    { start: "A1", end: "B4" },
    { rowField: "Region", columnField: null, valueField: "Sales", summarizeBy: "AVERAGE" },
  );
  assert.deepEqual(average.cells.B2, "1200");
  assert.deepEqual(average.cells.B5, "900");
});

test("computePivotCells with a column field arranges columns by first appearance with Grand Total and COUNT zero cells", () => {
  const source = {
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
  };
  const count = computePivotCells(
    source,
    {},
    { start: "A1", end: "C6" },
    { rowField: "Region", columnField: "Status", valueField: "Sales", summarizeBy: "COUNT" },
  );
  assert.equal(count.error, null);
  assert.deepEqual(count.cells, {
    A1: "Region",
    B1: "Open",
    C1: "Closed",
    D1: "Grand Total",
    A2: "East",
    B2: "1",
    C2: "0",
    D2: "1",
    A3: "North",
    B3: "0",
    C3: "1",
    D3: "1",
    A4: "South",
    B4: "1",
    C4: "0",
    D4: "1",
    A5: "Grand Total",
    B5: "2",
    C5: "1",
    D5: "3",
  });

  const sum = computePivotCells(
    source,
    {},
    { start: "A1", end: "C6" },
    { rowField: "Region", columnField: "Status", valueField: "Sales", summarizeBy: "SUM" },
  );
  assert.equal(sum.cells.B2, "1200");
  assert.equal(sum.cells.C2, "0");
  assert.equal(sum.cells.D2, "1200");
  assert.equal(sum.cells.B5, "1900"); // Open: East 1200 + South 700
  assert.equal(sum.cells.C5, "800");
  assert.equal(sum.cells.D5, "2700");
});

test("computePivotCells reports a missing field and requires numeric values", () => {
  const source = { A1: "Region", B1: "Sales", A2: "East", B2: "1200" };
  const missing = computePivotCells(
    source,
    {},
    { start: "A1", end: "B2" },
    { rowField: "Missing", columnField: null, valueField: "Sales", summarizeBy: "SUM" },
  );
  assert.equal(missing.cells, null);
  assert.equal(missing.error, "Pivot field is no longer available. Select a new field.");

  const nonNumeric = computePivotCells(
    { A1: "Region", B1: "Sales", A2: "East", B2: "Open" },
    {},
    { start: "A1", end: "B2" },
    { rowField: "Region", columnField: null, valueField: "Sales", summarizeBy: "SUM" },
  );
  assert.equal(nonNumeric.cells, null);
  assert.equal(nonNumeric.error, "Value field requires numeric values");

  // COUNT never fails on nonnumeric content
  const count = computePivotCells(
    { A1: "Region", B1: "Sales", A2: "East", B2: "Open", A3: "North", B3: "" },
    {},
    { start: "A1", end: "B3" },
    { rowField: "Region", columnField: null, valueField: "Sales", summarizeBy: "COUNT" },
  );
  assert.equal(count.error, null);
  assert.equal(count.cells.B2, "1");
  assert.equal(count.cells.B4, "1");
});

test("parsePivotNumber accepts numbers and rejects empty/nonnumeric text", () => {
  assert.equal(parsePivotNumber("1200"), 1200);
  assert.equal(parsePivotNumber("  -3.5 "), -3.5);
  assert.equal(parsePivotNumber(""), null);
  assert.equal(parsePivotNumber("Open"), null);
  assert.equal(parsePivotNumber(undefined), null);
});

test("shiftPivotRange follows cell movement for inserts and deletes", () => {
  const range = { start: "A1", end: "C6" };
  assert.deepEqual(shiftPivotRange(range, { axis: "row", insert: 1 }), {
    start: "A2",
    end: "C7",
  });
  assert.deepEqual(shiftPivotRange(range, { axis: "row", insert: 4 }), {
    start: "A1",
    end: "C7",
  });
  assert.deepEqual(shiftPivotRange(range, { axis: "row", insert: 9 }), range);
  assert.deepEqual(shiftPivotRange(range, { axis: "row", delete: 2 }), {
    start: "A1",
    end: "C5",
  });
  assert.deepEqual(shiftPivotRange(range, { axis: "row", delete: 8 }), range);
  assert.deepEqual(shiftPivotRange(range, { axis: "column", insert: 0 }), {
    start: "B1",
    end: "D6",
  });
  assert.deepEqual(shiftPivotRange(range, { axis: "column", insert: 1 }), {
    start: "A1",
    end: "D6",
  });
  assert.deepEqual(shiftPivotRange(range, { axis: "column", delete: 0 }), {
    start: "A1",
    end: "B6",
  });
  assert.deepEqual(shiftPivotRange(range, { axis: "column", delete: 2 }), {
    start: "A1",
    end: "B6",
  });
});

test("creates Pivot1 and applies a SUM layout that persists after reopen", async () => {
  const { service, directory } = await freshService();
  try {
    const { id, workbook, sheetId } = await seededWorkbook(service);
    const created = await service.createPivotTable(id, sheetId, { start: "A1", end: "C6" });
    const pivotSheet = created.sheets.find((sheet) => sheet.pivot);
    assert.equal(pivotSheet.name, "Pivot1");
    assert.deepEqual(pivotSheet.cells, {});
    assert.equal(created.activeSheetId, pivotSheet.id);
    assert.deepEqual(pivotSheet.pivot.sourceRange, { start: "A1", end: "C6" });
    assert.equal(pivotSheet.pivot.rowField, null);

    const applied = await service.applyPivotConfig(id, pivotSheet.id, {
      rowField: "Region",
      columnField: null,
      valueField: "Sales",
      summarizeBy: "SUM",
    });
    const cells = pivotCells(applied);
    assert.equal(cells.A1, "Region");
    assert.equal(cells.B1, "SUM of Sales");
    assert.equal(cells.A5, "Grand Total");
    assert.equal(cells.B5, "2700");

    // the source worksheet is untouched
    const source = applied.sheets.find((sheet) => !sheet.pivot);
    assert.equal(source.cells.A2, "East");
    assert.equal(source.cells.C2, "Open");

    // reopening restores the same pivot worksheet, layout and results
    const reopened = createWorkbookService(directory);
    const restored = await reopened.get(id);
    const restoredPivot = restored.sheets.find((sheet) => sheet.pivot);
    assert.equal(restoredPivot.name, "Pivot1");
    assert.equal(restoredPivot.pivot.rowField, "Region");
    assert.equal(restoredPivot.pivot.valueField, "Sales");
    assert.equal(restoredPivot.pivot.summarizeBy, "SUM");
    assert.equal(restoredPivot.cells.B5, "2700");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the next pivot uses the first unused PivotN name", async () => {
  const { service, directory } = await freshService();
  try {
    const { id, sheetId } = await seededWorkbook(service);
    await service.createPivotTable(id, sheetId, { start: "A1", end: "C4" });
    const second = await service.createPivotTable(id, sheetId, { start: "A1", end: "C4" });
    const pivotSheets = second.sheets.filter((sheet) => sheet.pivot);
    assert.deepEqual(pivotSheets.map((sheet) => sheet.name), ["Pivot1", "Pivot2"]);
    assert.equal(second.activeSheetId, pivotSheets[1].id);

    // a regular worksheet occupying the next PivotN name is skipped too
    const workbook = await service.get(id);
    await service.renameSheet(id, workbook.sheets[1].id, "Pivot3");
    const third = await service.createPivotTable(id, sheetId, { start: "A1", end: "C4" });
    const names = third.sheets.filter((sheet) => sheet.pivot).map((sheet) => sheet.name);
    assert.deepEqual(names, ["Pivot1", "Pivot2", "Pivot4"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refresh recomputes from the current source and preserves results on failure", async () => {
  const { service, directory } = await freshService();
  try {
    const { id, sheetId } = await seededWorkbook(service);
    const created = await service.createPivotTable(id, sheetId, { start: "A1", end: "C6" });
    const pivotId = created.sheets.find((sheet) => sheet.pivot).id;
    await service.applyPivotConfig(id, pivotId, {
      rowField: "Region",
      columnField: null,
      valueField: "Sales",
      summarizeBy: "SUM",
    });

    // source value changes; results stay until refresh
    await service.updateCells(id, sheetId, { B2: "1500" });
    const stale = await service.get(id);
    assert.equal(pivotCells(stale).B5, "2700");
    const refreshed = await service.refreshPivot(id, pivotId);
    assert.equal(pivotCells(refreshed).B5, "3000"); // 1500 + 800 + 700
    assert.equal(pivotCells(refreshed).B2, "1500");

    // deleting the row-field header makes refresh fail and preserves both
    await service.deleteColumn(id, sheetId, 1);
    const afterDelete = await service.get(id);
    const pivotAfter = afterDelete.sheets.find((sheet) => sheet.pivot);
    assert.equal(pivotAfter.pivot.sourceRange.start, "A1"); // adjusted range
    await assert.rejects(
      () => service.refreshPivot(id, pivotId),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 400);
        assert.equal(error.message, "Pivot field is no longer available. Select a new field.");
        return true;
      },
    );
    const preserved = await service.get(id);
    assert.equal(pivotCells(preserved).B5, "3000"); // last successful result kept
    const source = preserved.sheets.find((sheet) => !sheet.pivot);
    assert.equal(source.cells.A1, "Sales"); // Region header was deleted
    assert.equal(source.cells.B4, "Open");
    assert.ok(!Object.values(source.cells).includes("Region"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("row insertion into the source range shifts the pivot range and refresh uses it", async () => {
  const { service, directory } = await freshService();
  try {
    const { id, sheetId } = await seededWorkbook(service);
    const created = await service.createPivotTable(id, sheetId, { start: "A1", end: "C6" });
    const pivotId = created.sheets.find((sheet) => sheet.pivot).id;
    await service.applyPivotConfig(id, pivotId, {
      rowField: "Region",
      columnField: null,
      valueField: "Sales",
      summarizeBy: "SUM",
    });

    await service.insertRow(id, sheetId, 5, "above");
    const afterInsert = await service.get(id);
    const pivot = afterInsert.sheets.find((sheet) => sheet.pivot);
    assert.deepEqual(pivot.pivot.sourceRange, { start: "A1", end: "C7" });
    assert.equal(pivot.cells.B5, "2700"); // result unchanged until refresh

    const refreshed = await service.refreshPivot(id, pivotId);
    assert.equal(pivotCells(refreshed).B5, "2700"); // blank inserted row adds nothing
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("applying a nonnumeric value field with SUM preserves the previous result", async () => {
  const { service, directory } = await freshService();
  try {
    const { id, sheetId } = await seededWorkbook(service);
    const created = await service.createPivotTable(id, sheetId, { start: "A1", end: "C6" });
    const pivotId = created.sheets.find((sheet) => sheet.pivot).id;
    await service.applyPivotConfig(id, pivotId, {
      rowField: "Region",
      columnField: null,
      valueField: "Sales",
      summarizeBy: "SUM",
    });
    await assert.rejects(
      () =>
        service.applyPivotConfig(id, pivotId, {
          rowField: "Region",
          columnField: null,
          valueField: "Status",
          summarizeBy: "SUM",
        }),
      (error) => {
        assert.equal(error.message, "Value field requires numeric values");
        return true;
      },
    );
    const after = await service.get(id);
    const pivot = after.sheets.find((sheet) => sheet.pivot);
    assert.equal(pivot.cells.B5, "2700"); // old result preserved
    assert.equal(pivot.pivot.valueField, "Sales"); // config unchanged
    const source = after.sheets.find((sheet) => !sheet.pivot);
    assert.equal(source.cells.C2, "Open"); // source worksheet not modified
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("apply rejects missing row/value fields and non-pivot sheets", async () => {
  const { service, directory } = await freshService();
  try {
    const { id, workbook, sheetId } = await seededWorkbook(service);
    const created = await service.createPivotTable(id, sheetId, { start: "A1", end: "C6" });
    const pivotId = created.sheets.find((sheet) => sheet.pivot).id;
    await assert.rejects(
      () => service.applyPivotConfig(id, pivotId, { rowField: "", valueField: "", summarizeBy: "SUM" }),
      (error) => {
        assert.equal(error.message, "Row and value fields are required");
        return true;
      },
    );
    await assert.rejects(
      () => service.applyPivotConfig(id, sheetId, { rowField: "Region", valueField: "Sales", summarizeBy: "SUM" }),
      (error) => {
        assert.equal(error.message, "Not a pivot worksheet");
        return true;
      },
    );
    assert.equal((await service.get(id)).sheets.length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
