import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_WORKBOOK_NAME,
  WORKBOOK_NAME_EMPTY_MESSAGE,
  WORKSHEET_NAME_EMPTY_MESSAGE,
  WORKSHEET_NAME_EXISTS_MESSAGE,
  WorkbookError,
  createWorkbookService,
  nextWorksheetName,
} from "../src/lib/workbooks.mjs";
import { INVALID_CSV_MESSAGE } from "../src/lib/csv.mjs";

async function createService(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-workbooks-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, service: createWorkbookService({ filePath: join(directory, "workbooks.json"), ...options }) };
}

test("seeds the Q3 Sales workbook with Sheet1, Sheet2 and the seeded rows", async (t) => {
  const { service } = await createService(t);

  const summaries = await service.list();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].name, "Q3 Sales");
  assert.ok(summaries[0].updatedAt);

  const workbook = await service.get("wb-q3-sales");
  assert.equal(workbook.name, "Q3 Sales");
  assert.equal(workbook.activeWorksheetId, workbook.worksheets[0].id);
  assert.deepEqual(workbook.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2"]);
  assert.equal(workbook.worksheets[0].cells.A1.value, "Region");
  assert.equal(workbook.worksheets[0].cells.A2.value, "East");
  assert.equal(workbook.worksheets[0].cells.B2.value, "1200");
  assert.equal(workbook.worksheets[0].cells.A3.value, "North");
  assert.equal(workbook.worksheets[0].cells.B3.value, "800");
  assert.deepEqual(workbook.worksheets[1].cells, {});
  assert.deepEqual(workbook.worksheets[0].selection, { anchor: "A1", focus: "A1" });
  assert.deepEqual(workbook.worksheets[1].selection, { anchor: "A1", focus: "A1" });
  assert.equal(await service.get("missing"), null);
});

test("creates a blank workbook with Sheet1 active and A1 selected", async (t) => {
  const { service } = await createService(t, { now: () => "2026-10-03T10:00:00.000Z" });

  const workbook = await service.create({});
  assert.equal(workbook.name, DEFAULT_WORKBOOK_NAME);
  assert.equal(workbook.worksheets.length, 1);
  assert.equal(workbook.worksheets[0].name, "Sheet1");
  assert.deepEqual(workbook.worksheets[0].cells, {});
  assert.deepEqual(workbook.worksheets[0].selection, { anchor: "A1", focus: "A1" });
  assert.equal(workbook.activeWorksheetId, workbook.worksheets[0].id);
  assert.equal(workbook.updatedAt, "2026-10-03T10:00:00.000Z");

  const trimmed = await service.create({ name: "  Regional Plan  " });
  assert.equal(trimmed.name, "Regional Plan");

  const blank = await service.create({ name: "   " });
  assert.equal(blank.name, DEFAULT_WORKBOOK_NAME);

  const summaries = await service.list();
  assert.equal(summaries.length, 4);
  const ids = summaries.map((summary) => summary.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("wb-q3-sales"));
});

test("renames a workbook, trims spaces and rejects an empty name without changing state", async (t) => {
  const timestamps = ["2026-10-03T11:00:00.000Z", "2026-10-03T12:00:00.000Z"];
  const { service } = await createService(t, { now: () => timestamps.shift() ?? "2026-10-03T13:00:00.000Z" });

  const renamed = await service.update("wb-q3-sales", { name: "  Q3 Sales 2026  " });
  assert.equal(renamed.name, "Q3 Sales 2026");
  assert.equal(renamed.updatedAt, "2026-10-03T11:00:00.000Z");

  let thrown;
  try {
    await service.update("wb-q3-sales", { name: "   " });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof WorkbookError);
  assert.equal(thrown.message, WORKBOOK_NAME_EMPTY_MESSAGE);
  assert.equal(thrown.status, 400);

  const afterFailure = await service.get("wb-q3-sales");
  assert.equal(afterFailure.name, "Q3 Sales 2026");
  assert.equal(afterFailure.updatedAt, "2026-10-03T11:00:00.000Z");

  await assert.rejects(() => service.update("missing", { name: "Nope" }), (error) => error.status === 404);
  await assert.rejects(
    () => service.update("wb-q3-sales", { activeWorksheetId: "ws-missing" }),
    (error) => error.status === 404,
  );
});

test("imports a CSV file as a new workbook named after the file, without touching the seed", async (t) => {
  const { directory, service } = await createService(t, { now: () => "2026-10-03T10:30:00.000Z" });

  const workbook = await service.importCsv({
    fileName: "sales-report.csv",
    content: 'Region,Revenue\nEast,"1,200"\nNorth,800',
  });

  assert.equal(workbook.name, "sales-report");
  assert.equal(workbook.updatedAt, "2026-10-03T10:30:00.000Z");
  assert.equal(workbook.worksheets.length, 1);
  const worksheet = workbook.worksheets[0];
  assert.equal(worksheet.name, "Sheet1");
  assert.equal(workbook.activeWorksheetId, worksheet.id);
  assert.deepEqual(worksheet.selection, { anchor: "A1", focus: "A1" });
  assert.equal(worksheet.cells.A1.value, "Region");
  assert.equal(worksheet.cells.A2.value, "East");
  assert.equal(worksheet.cells.B2.value, "1,200");
  assert.equal(worksheet.cells.A3.value, "North");
  assert.equal(worksheet.cells.B3.value, "800");
  assert.ok(worksheet.rowCount >= 3);
  assert.ok(worksheet.columnCount >= 2);

  const reopened = createWorkbookService({ filePath: join(directory, "workbooks.json") });
  const persisted = await reopened.get(workbook.id);
  assert.equal(persisted.worksheets[0].cells.A3.value, "North");
  assert.ok((await reopened.list()).some((summary) => summary.name === "sales-report"));

  const seeded = await reopened.get("wb-q3-sales");
  assert.equal(seeded.worksheets[0].cells.A1.value, "Region");
  assert.equal(seeded.worksheets[0].cells.A2.value, "East");
  assert.equal(seeded.updatedAt, "2026-10-01T08:00:00.000Z");
});

test("derives the imported workbook name from the final .csv extension", async (t) => {
  const { service } = await createService(t);

  assert.equal((await service.importCsv({ fileName: "Quarterly Report.CSV", content: "a" })).name, "Quarterly Report");
  assert.equal((await service.importCsv({ fileName: ".csv", content: "a" })).name, DEFAULT_WORKBOOK_NAME);
  assert.equal((await service.importCsv({ fileName: "data", content: "a" })).name, "data");
});

test("rejects invalid CSV without creating a workbook or partial state", async (t) => {
  const { directory, service } = await createService(t);

  await assert.rejects(
    () => service.importCsv({ fileName: "broken.csv", content: 'Region,"East' }),
    (error) => {
      assert.ok(error instanceof WorkbookError);
      assert.equal(error.status, 400);
      assert.equal(error.message, INVALID_CSV_MESSAGE);
      return true;
    },
  );
  await assert.rejects(() => service.importCsv({ fileName: "broken.csv" }), (error) => error.status === 400);

  const summaries = await service.list();
  assert.deepEqual(summaries.map((summary) => summary.name), ["Q3 Sales"]);

  const reopened = createWorkbookService({ filePath: join(directory, "workbooks.json") });
  assert.deepEqual((await reopened.list()).map((summary) => summary.name), ["Q3 Sales"]);
  const seeded = await reopened.get("wb-q3-sales");
  assert.equal(seeded.worksheets[0].cells.A1.value, "Region");
  assert.equal(seeded.worksheets.length, 2);
});

test("exports one worksheet as CSV without changing workbook state", async (t) => {
  const { service } = await createService(t);

  const seeded = await service.exportCsv("wb-q3-sales");
  assert.equal(seeded.csv, "Region,Sales,Status\nEast,1200,Open\nNorth,800,Closed\nSouth,700,Open");
  assert.equal(seeded.worksheet.name, "Sheet1");

  const seededSheet2 = await service.exportCsv("wb-q3-sales", "ws-q3-sales-sheet2");
  assert.equal(seededSheet2.csv, "");
  assert.equal(seededSheet2.worksheet.name, "Sheet2");

  const imported = await service.importCsv({
    fileName: "pipeline.csv",
    content: 'Region,Revenue,\nEast,"1,200",\nNorth,800,',
  });
  const exported = await service.exportCsv(imported.id, imported.worksheets[0].id);
  assert.equal(exported.csv, 'Region,Revenue,\nEast,"1,200",\nNorth,800,');

  const afterExport = await service.get(imported.id);
  assert.deepEqual(afterExport, imported);

  await assert.rejects(() => service.exportCsv("missing"), (error) => error.status === 404);
  await assert.rejects(() => service.exportCsv(imported.id, "ws-missing"), (error) => error.status === 404);
});

test("persists workbook changes across service instances and keeps the seed stable", async (t) => {
  const { directory, service } = await createService(t);
  await service.update("wb-q3-sales", { name: "Q3 Sales 2026" });
  const created = await service.create({ name: "Imported" });

  const reopened = createWorkbookService({ filePath: join(directory, "workbooks.json") });
  const names = (await reopened.list()).map((summary) => summary.name);
  assert.ok(names.includes("Q3 Sales 2026"));
  assert.ok(names.includes("Imported"));
  assert.ok(!names.includes("Q3 Sales"));

  const persisted = await reopened.get(created.id);
  assert.equal(persisted.name, "Imported");
  assert.equal(persisted.worksheets[0].name, "Sheet1");

  const seeded = await reopened.get("wb-q3-sales");
  assert.equal(seeded.worksheets[0].cells.A1.value, "Region");
  assert.equal(seeded.worksheets[0].cells.A2.value, "East");
  assert.deepEqual(seeded.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2"]);
});

test("adds a blank worksheet named after the first unused SheetN and makes it active", async (t) => {
  const timestamps = ["2026-10-03T11:00:00.000Z", "2026-10-03T12:00:00.000Z"];
  const { directory, service } = await createService(t, { now: () => timestamps.shift() ?? "2026-10-03T13:00:00.000Z" });

  const updated = await service.addWorksheet("wb-q3-sales");
  assert.deepEqual(updated.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2", "Sheet3"]);
  assert.equal(updated.updatedAt, "2026-10-03T11:00:00.000Z");

  const added = updated.worksheets[2];
  assert.equal(updated.activeWorksheetId, added.id);
  assert.deepEqual(added.cells, {});
  assert.deepEqual(added.selection, { anchor: "A1", focus: "A1" });
  assert.equal(added.rowCount, 30);
  assert.equal(added.columnCount, 26);
  assert.equal(Object.hasOwn(added, "filters"), false);
  assert.equal(Object.hasOwn(added, "validations"), false);
  assert.equal(Object.hasOwn(added, "pivot"), false);

  // Existing worksheets keep their data and order.
  assert.equal(updated.worksheets[0].cells.A2.value, "East");
  assert.equal(updated.worksheets[0].cells.B3.value, "800");
  assert.equal(updated.worksheets[0].name, "Sheet1");

  const reopened = createWorkbookService({ filePath: join(directory, "workbooks.json") });
  const persisted = await reopened.get("wb-q3-sales");
  assert.deepEqual(persisted.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2", "Sheet3"]);
  assert.equal(persisted.activeWorksheetId, added.id);

  // Adding again fills the next free positive-integer name.
  const again = await service.addWorksheet("wb-q3-sales");
  assert.deepEqual(again.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2", "Sheet3", "Sheet4"]);

  await assert.rejects(() => service.addWorksheet("missing"), (error) => error.status === 404);
  assert.equal(nextWorksheetName([{ name: "Sheet2" }, { name: "Sheet1" }, { name: "Sheet4" }]), "Sheet3");
  assert.equal(nextWorksheetName([]), "Sheet1");
});

test("renames a worksheet, trims spaces and keeps the previous name on empty or duplicate input", async (t) => {
  const timestamps = ["2026-10-03T11:00:00.000Z", "2026-10-03T12:00:00.000Z"];
  const { directory, service } = await createService(t, { now: () => timestamps.shift() ?? "2026-10-03T13:00:00.000Z" });

  const renamed = await service.renameWorksheet("wb-q3-sales", "ws-q3-sales-sheet2", "  Summary  ");
  assert.deepEqual(renamed.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Summary"]);
  assert.equal(renamed.updatedAt, "2026-10-03T11:00:00.000Z");
  assert.equal(renamed.worksheets[0].cells.A2.value, "East");

  // Renaming a worksheet to its own current name is not a duplicate.
  const same = await service.renameWorksheet("wb-q3-sales", "ws-q3-sales-sheet2", "Summary");
  assert.deepEqual(same.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Summary"]);

  for (const [input, message] of [
    ["   ", WORKSHEET_NAME_EMPTY_MESSAGE],
    ["Sheet1", WORKSHEET_NAME_EXISTS_MESSAGE],
  ]) {
    await assert.rejects(
      () => service.renameWorksheet("wb-q3-sales", "ws-q3-sales-sheet2", input),
      (error) => {
        assert.ok(error instanceof WorkbookError);
        assert.equal(error.status, 400);
        assert.equal(error.message, message);
        return true;
      },
    );
  }

  const afterFailure = await service.get("wb-q3-sales");
  assert.deepEqual(afterFailure.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Summary"]);
  assert.equal(afterFailure.updatedAt, "2026-10-03T12:00:00.000Z");
  assert.equal(afterFailure.worksheets[0].cells.A2.value, "East");

  const reopened = createWorkbookService({ filePath: join(directory, "workbooks.json") });
  assert.deepEqual(
    (await reopened.get("wb-q3-sales")).worksheets.map((worksheet) => worksheet.name),
    ["Sheet1", "Summary"],
  );

  await assert.rejects(
    () => service.renameWorksheet("wb-q3-sales", "ws-missing", "Nope"),
    (error) => error.status === 404,
  );
  await assert.rejects(
    () => service.renameWorksheet("missing", "ws-q3-sales-sheet1", "Nope"),
    (error) => error.status === 404,
  );
});
