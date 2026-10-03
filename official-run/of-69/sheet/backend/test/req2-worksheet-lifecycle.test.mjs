import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LAST_WORKSHEET_MESSAGE,
  PIVOT_DEPENDENT_MESSAGE,
  WORKBOOK_NOT_FOUND_MESSAGE,
  WORKSHEET_NOT_FOUND_MESSAGE,
  WorkbookError,
  createWorkbookService,
} from "../src/lib/workbooks.mjs";

async function createService(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-worksheet-lifecycle-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    directory,
    service: createWorkbookService({ filePath: join(directory, "workbooks.json"), ...options }),
  };
}

async function rejects(fn, message) {
  let error;
  try {
    await fn();
  } catch (cause) {
    error = cause;
  }
  assert.ok(error instanceof WorkbookError, `expected WorkbookError, got ${error}`);
  assert.equal(error.message, message);
  return error;
}

test("switching the active worksheet persists without touching either worksheet", async (t) => {
  const { service } = await createService(t);

  const switched = await service.update("wb-q3-sales", { activeWorksheetId: "ws-q3-sales-sheet2" });
  assert.equal(switched.activeWorksheetId, "ws-q3-sales-sheet2");
  assert.equal(switched.worksheets[0].cells.A2.value, "East");
  assert.deepEqual(switched.worksheets[1].cells, {});

  // A reopen reads the last active worksheet back, with each worksheet's own content.
  const reopened = await service.get("wb-q3-sales");
  assert.equal(reopened.activeWorksheetId, "ws-q3-sales-sheet2");
  assert.equal(reopened.worksheets[0].cells.B2.value, "1200");
  assert.equal(reopened.worksheets[1].cells.A1, undefined);

  await rejects(
    () => service.update("wb-q3-sales", { activeWorksheetId: "ws-missing" }),
    WORKSHEET_NOT_FOUND_MESSAGE,
  );
});

test("deletes a non-active worksheet and keeps the active tab", async (t) => {
  const { service } = await createService(t);

  const updated = await service.deleteWorksheet("wb-q3-sales", "ws-q3-sales-sheet2");
  assert.deepEqual(updated.worksheets.map((worksheet) => worksheet.name), ["Sheet1"]);
  assert.equal(updated.activeWorksheetId, "ws-q3-sales-sheet1");
  assert.equal(updated.worksheets[0].cells.A2.value, "East");

  const reopened = await service.get("wb-q3-sales");
  assert.deepEqual(reopened.worksheets.map((worksheet) => worksheet.name), ["Sheet1"]);
  assert.equal(reopened.worksheets[0].cells.A3.value, "North");
});

test("deletes the active worksheet and activates its next neighbour", async (t) => {
  const { service } = await createService(t, { now: () => "2026-10-03T12:00:00.000Z" });

  const updated = await service.deleteWorksheet("wb-q3-sales", "ws-q3-sales-sheet1");
  assert.deepEqual(updated.worksheets.map((worksheet) => worksheet.name), ["Sheet2"]);
  assert.equal(updated.activeWorksheetId, "ws-q3-sales-sheet2");
  assert.equal(updated.updatedAt, "2026-10-03T12:00:00.000Z");
  // The removed worksheet's data no longer appears anywhere.
  assert.deepEqual(updated.worksheets[0].cells, {});
});

test("deletes the last worksheet only when more than one remains", async (t) => {
  const { service } = await createService(t);

  await service.deleteWorksheet("wb-q3-sales", "ws-q3-sales-sheet2");
  await rejects(
    () => service.deleteWorksheet("wb-q3-sales", "ws-q3-sales-sheet1"),
    LAST_WORKSHEET_MESSAGE,
  );

  const unchanged = await service.get("wb-q3-sales");
  assert.deepEqual(unchanged.worksheets.map((worksheet) => worksheet.name), ["Sheet1"]);
  assert.equal(unchanged.worksheets[0].cells.A2.value, "East");
});

test("rejects deleting a worksheet that still feeds a pivot table", async (t) => {
  const { service } = await createService(t);

  const withPivot = await service.createPivotTable("wb-q3-sales", {
    sourceWorksheetId: "ws-q3-sales-sheet1",
    range: "A1:C4",
  });
  const pivot = withPivot.worksheets.find((worksheet) => worksheet.name === "Pivot1");
  assert.ok(pivot);
  assert.equal(withPivot.activeWorksheetId, pivot.id);

  await rejects(
    () => service.deleteWorksheet("wb-q3-sales", "ws-q3-sales-sheet1"),
    PIVOT_DEPENDENT_MESSAGE,
  );

  // Both worksheets and the pivot result are untouched by the rejected deletion.
  const unchanged = await service.get("wb-q3-sales");
  assert.deepEqual(unchanged.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2", "Pivot1"]);
  assert.equal(unchanged.worksheets[0].cells.A2.value, "East");
  assert.equal(unchanged.worksheets[0].cells.B4.value, "700");
});

test("deleting a pivot-result worksheet frees its source for deletion", async (t) => {
  const { service } = await createService(t);

  const withPivot = await service.createPivotTable("wb-q3-sales", {
    sourceWorksheetId: "ws-q3-sales-sheet1",
    range: "A1:C4",
  });
  const pivot = withPivot.worksheets.find((worksheet) => worksheet.name === "Pivot1");

  const withoutPivot = await service.deleteWorksheet("wb-q3-sales", pivot.id);
  assert.deepEqual(withoutPivot.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2"]);
  // The deleted tab was last, so its previous neighbour stays active.
  assert.equal(withoutPivot.activeWorksheetId, "ws-q3-sales-sheet2");

  // The source is no longer constrained once the dependent pivot is gone.
  const final = await service.deleteWorksheet("wb-q3-sales", "ws-q3-sales-sheet1");
  assert.deepEqual(final.worksheets.map((worksheet) => worksheet.name), ["Sheet2"]);
});

test("reports missing workbooks and worksheets without changing stored state", async (t) => {
  const { service } = await createService(t);

  await rejects(() => service.deleteWorksheet("wb-missing", "ws-q3-sales-sheet1"), WORKBOOK_NOT_FOUND_MESSAGE);
  await rejects(() => service.deleteWorksheet("wb-q3-sales", "ws-missing"), WORKSHEET_NOT_FOUND_MESSAGE);

  const unchanged = await service.get("wb-q3-sales");
  assert.deepEqual(unchanged.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2"]);
});
