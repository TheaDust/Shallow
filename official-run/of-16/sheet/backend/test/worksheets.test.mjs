import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSeedState, createWorkbookService } from "../src/domain/workbooks.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

async function makeService() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-worksheets-"));
  const file = join(directory, "workbooks.json");
  const store = createJsonStore(file, createSeedState());
  return { service: createWorkbookService(store), file };
}

const SEED_CELLS = {
  A1: "Region", B1: "Sales", C1: "Status",
  A2: "East", B2: "1200", C2: "Open",
  A3: "North", B3: "800", C3: "Closed",
  A4: "South", B4: "700", C4: "Open",
};

test("adding a worksheet uses the first unused SheetN name and keeps the others", async () => {
  const { service } = await makeService();

  const added = await service.addWorksheet("q3-sales");
  assert.deepEqual(added.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2", "Sheet3"]);

  const newWorksheet = added.worksheets[2];
  assert.deepEqual(newWorksheet.cells, {});
  assert.equal(added.activeWorksheetId, newWorksheet.id);
  assert.deepEqual(added.selections[newWorksheet.id], {
    anchor: { row: 0, col: 0 },
    focus: { row: 0, col: 0 },
  });

  // Existing worksheets keep their names, order, data and used rectangle.
  assert.deepEqual(added.worksheets[0].cells, SEED_CELLS);
  assert.deepEqual(added.worksheets[1].cells, { A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2" });

  const second = await service.addWorksheet("q3-sales");
  assert.deepEqual(second.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2", "Sheet3", "Sheet4"]);
});

test("a freed SheetN name is reused and non-Sheet names are ignored", async () => {
  const { service } = await makeService();

  await service.renameWorksheet("q3-sales", "q3-sales-sheet2", "Revenue");
  const added = await service.addWorksheet("q3-sales");
  assert.deepEqual(added.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Revenue", "Sheet2"]);
});

test("the added worksheet and its active state survive a store reload", async () => {
  const { service, file } = await makeService();

  const added = await service.addWorksheet("q3-sales");
  const reloaded = createWorkbookService(createJsonStore(file, createSeedState()));
  const persisted = await reloaded.get("q3-sales");
  assert.deepEqual(persisted.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2", "Sheet3"]);
  assert.equal(persisted.activeWorksheetId, added.worksheets[2].id);
  assert.deepEqual(persisted.worksheets[0].cells, SEED_CELLS);
});

test("renaming a worksheet trims the name, persists it and keeps the grid", async () => {
  const { service, file } = await makeService();
  const before = await service.get("q3-sales");

  const renamed = await service.renameWorksheet("q3-sales", "q3-sales-sheet2", "  Region data  ");
  assert.equal(renamed.worksheets[1].name, "Region data");
  assert.notEqual(renamed.updatedAt, before.updatedAt);
  assert.deepEqual(renamed.worksheets[0].cells, SEED_CELLS);
  assert.equal(renamed.activeWorksheetId, "q3-sales-sheet1");

  const reloaded = createWorkbookService(createJsonStore(file, createSeedState()));
  assert.equal((await reloaded.get("q3-sales")).worksheets[1].name, "Region data");
});

test("an empty or duplicate worksheet name is rejected without touching the record", async () => {
  const { service, file } = await makeService();

  await assert.rejects(
    () => service.renameWorksheet("q3-sales", "q3-sales-sheet1", "   "),
    (error) => error.status === 400 && /Worksheet name cannot be empty/.test(error.message),
  );
  await assert.rejects(
    () => service.renameWorksheet("q3-sales", "q3-sales-sheet1", "Sheet2"),
    (error) => error.status === 400 && /Worksheet name already exists/.test(error.message),
  );
  await assert.rejects(
    () => service.renameWorksheet("q3-sales", "q3-sales-sheet1", " sheet2 "),
    (error) => error.status === 400 && /Worksheet name already exists/.test(error.message),
  );

  // No write happened yet, so the failing renames left the seeded store absent/untouched.
  const persistedBefore = await service.get("q3-sales");
  assert.deepEqual(persistedBefore.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2"]);

  // Keeping its own name (with padding) is not a duplicate.
  const kept = await service.renameWorksheet("q3-sales", "q3-sales-sheet1", " Sheet1 ");
  assert.equal(kept.worksheets[0].name, "Sheet1");

  // A successful rename writes the store; the failing ones above did not change it.
  await service.renameWorksheet("q3-sales", "q3-sales-sheet2", "Revenue");
  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(persisted.workbooks[0].worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Revenue"]);
});

test("worksheet create and rename report not found for unknown targets", async () => {
  const { service } = await makeService();

  await assert.rejects(() => service.addWorksheet("nope"), (error) => error.status === 404);
  await assert.rejects(
    () => service.renameWorksheet("q3-sales", "nope", "Revenue"),
    (error) => error.status === 404,
  );
});

test("deleting a worksheet removes its tab and state and persists the removal", async () => {
  const { service, file } = await makeService();

  // Sheet2 carries its own validation rule and filter view; both disappear with it.
  await service.replaceValidations("q3-sales", "q3-sales-sheet2", {
    validations: [{ range: "A1:B2", type: "list", values: ["a", "b"] }],
  });
  await service.setFilter("q3-sales", "q3-sales-sheet2", { filter: { range: "A1:B2", rules: [] } });

  const deleted = await service.deleteWorksheet("q3-sales", "q3-sales-sheet2");
  assert.deepEqual(deleted.worksheets.map((worksheet) => worksheet.name), ["Sheet1"]);
  // Sheet1 was the active worksheet, so it stays active with its data intact.
  assert.equal(deleted.activeWorksheetId, "q3-sales-sheet1");
  assert.deepEqual(deleted.worksheets[0].cells, SEED_CELLS);
  assert.equal(deleted.selections["q3-sales-sheet2"], undefined);

  const reloaded = createWorkbookService(createJsonStore(file, createSeedState()));
  const persisted = await reloaded.get("q3-sales");
  assert.deepEqual(persisted.worksheets.map((worksheet) => worksheet.name), ["Sheet1"]);
  assert.equal(persisted.selections["q3-sales-sheet2"], undefined);
});

test("deleting the active worksheet activates an adjacent one", async () => {
  const { service } = await makeService();

  // The first worksheet is active: its neighbour slides into the slot.
  const firstDeleted = await service.deleteWorksheet("q3-sales", "q3-sales-sheet1");
  assert.deepEqual(firstDeleted.worksheets.map((worksheet) => worksheet.name), ["Sheet2"]);
  assert.equal(firstDeleted.activeWorksheetId, "q3-sales-sheet2");

  // With three worksheets, removing the active middle one activates the next one.
  await service.addWorksheet("q3-sales");
  const added = await service.addWorksheet("q3-sales");
  assert.equal(added.worksheets.length, 3);
  const middle = added.worksheets[1];
  await service.updateState("q3-sales", { activeWorksheetId: middle.id });
  const middleDeleted = await service.deleteWorksheet("q3-sales", middle.id);
  assert.deepEqual(
    middleDeleted.worksheets.map((worksheet) => worksheet.id),
    [added.worksheets[0].id, added.worksheets[2].id],
  );
  assert.equal(middleDeleted.activeWorksheetId, added.worksheets[2].id);
});

test("the last worksheet cannot be deleted and a rejected deletion keeps the record", async () => {
  const { service, file } = await makeService();

  await service.deleteWorksheet("q3-sales", "q3-sales-sheet2");
  const before = JSON.stringify(await service.get("q3-sales"));

  await assert.rejects(
    () => service.deleteWorksheet("q3-sales", "q3-sales-sheet1"),
    (error) => error.status === 400 && error.message === "A workbook must contain at least one worksheet",
  );
  assert.equal(JSON.stringify(await service.get("q3-sales")), before);

  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(persisted.workbooks[0].worksheets.map((worksheet) => worksheet.name), ["Sheet1"]);
  assert.equal(persisted.workbooks[0].activeWorksheetId, "q3-sales-sheet1");
});

test("a worksheet a pivot table still reads cannot be deleted until the pivot is removed", async () => {
  const { service } = await makeService();

  const withPivot = await service.createPivot("q3-sales", { sourceWorksheetId: "q3-sales-sheet1", range: "A1:C4" });
  const pivot = withPivot.worksheets[2];
  assert.equal(pivot.name, "Pivot1");
  const configured = await service.configurePivot("q3-sales", pivot.id, {
    rowField: "Region",
    columnField: "",
    valueField: "Sales",
    summarizeBy: "SUM",
  });
  const pivotCells = { ...configured.worksheets[2].cells };

  await assert.rejects(
    () => service.deleteWorksheet("q3-sales", "q3-sales-sheet1"),
    (error) => error.status === 400 && error.message === "Please delete or rebuild dependent pivot tables first",
  );
  // Both worksheets keep their data and the last successful summary.
  const afterRejection = await service.get("q3-sales");
  assert.deepEqual(afterRejection.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2", "Pivot1"]);
  assert.deepEqual(afterRejection.worksheets[0].cells, SEED_CELLS);
  assert.deepEqual(afterRejection.worksheets[2].cells, pivotCells);

  // Removing the pivot result frees its source worksheet.
  const withoutPivot = await service.deleteWorksheet("q3-sales", pivot.id);
  assert.deepEqual(withoutPivot.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2"]);
  const sourceDeleted = await service.deleteWorksheet("q3-sales", "q3-sales-sheet1");
  assert.deepEqual(sourceDeleted.worksheets.map((worksheet) => worksheet.name), ["Sheet2"]);
});

test("deleting an unknown worksheet reports not found without touching the record", async () => {
  const { service } = await makeService();

  await assert.rejects(
    () => service.deleteWorksheet("q3-sales", "nope"),
    (error) => error.status === 404,
  );
  await assert.rejects(() => service.deleteWorksheet("nope", "q3-sales-sheet1"), (error) => error.status === 404);
  const unchanged = await service.get("q3-sales");
  assert.deepEqual(unchanged.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2"]);
});
