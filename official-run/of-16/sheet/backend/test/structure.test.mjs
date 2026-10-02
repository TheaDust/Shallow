import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSeedState, createWorkbookService } from "../src/domain/workbooks.mjs";
import { adjustCellReferences, shiftCellValue, shiftWorksheetStructure } from "../src/domain/structure.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

async function makeService() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-structure-"));
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
/** Formula seed of the same workbook (REQ-4): Sheet2 carries `=A1+B1`/`=C1*2`. */
const SHEET2_CELLS = { A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2" };
const SHEET1 = "q3-sales-sheet1";

test("inserting a row above the target moves the row and later rows down", async () => {
  const { service, file } = await makeService();
  const before = await service.get("q3-sales");

  const updated = await service.changeStructure("q3-sales", SHEET1, "row", {
    action: "insert-above",
    index: 1,
  });

  assert.equal(updated.worksheets[0].cells.A1, "Region");
  assert.equal(updated.worksheets[0].cells.A2, undefined);
  assert.equal(updated.worksheets[0].cells.A3, "East");
  assert.equal(updated.worksheets[0].cells.B3, "1200");
  assert.equal(updated.worksheets[0].cells.A4, "North");
  assert.equal(updated.worksheets[0].cells.B4, "800");
  // The other worksheet and the grid size stay unchanged.
  assert.deepEqual(updated.worksheets[1].cells, SHEET2_CELLS);
  assert.equal(updated.worksheets[0].rowCount, before.worksheets[0].rowCount);
  assert.notEqual(updated.updatedAt, before.updatedAt);

  const reloaded = createWorkbookService(createJsonStore(file, createSeedState()));
  assert.deepEqual((await reloaded.get("q3-sales")).worksheets[0].cells, updated.worksheets[0].cells);
});

test("inserting a row below the target keeps the target and pushes later rows down", async () => {
  const { service } = await makeService();

  const updated = await service.changeStructure("q3-sales", SHEET1, "row", {
    action: "insert-below",
    index: 0,
  });

  assert.equal(updated.worksheets[0].cells.A1, "Region");
  assert.equal(updated.worksheets[0].cells.A2, undefined);
  assert.equal(updated.worksheets[0].cells.A3, "East");
  assert.equal(updated.worksheets[0].cells.A4, "North");
});

test("deleting a row removes only the target row and shifts the rest up", async () => {
  const { service, file } = await makeService();

  const updated = await service.changeStructure("q3-sales", SHEET1, "row", { action: "delete", index: 1 });

  assert.deepEqual(updated.worksheets[0].cells, {
    A1: "Region", B1: "Sales", C1: "Status",
    A2: "North", B2: "800", C2: "Closed",
    A3: "South", B3: "700", C3: "Open",
  });
  assert.deepEqual(updated.worksheets[1].cells, SHEET2_CELLS);

  const reloaded = createWorkbookService(createJsonStore(file, createSeedState()));
  assert.deepEqual((await reloaded.get("q3-sales")).worksheets[0].cells, {
    A1: "Region", B1: "Sales", C1: "Status",
    A2: "North", B2: "800", C2: "Closed",
    A3: "South", B3: "700", C3: "Open",
  });
});

test("inserting a row below the last row of the grid grows the visible row count", async () => {
  const { service } = await makeService();
  const worksheet = (await service.get("q3-sales")).worksheets[0];

  const updated = await service.changeStructure("q3-sales", SHEET1, "row", {
    action: "insert-below",
    index: worksheet.rowCount - 1,
  });

  assert.equal(updated.worksheets[0].rowCount, worksheet.rowCount + 1);
  assert.equal(updated.worksheets[0].cells.A1, "Region");
});

test("a row insert adjusts formula references and a delete makes them explicit errors", async () => {
  const { service } = await makeService();
  await service.updateCells("q3-sales", SHEET1, { D1: "=B2*2" });

  const inserted = await service.changeStructure("q3-sales", SHEET1, "row", {
    action: "insert-above",
    index: 1,
  });
  assert.equal(inserted.worksheets[0].cells.D1, "=B3*2");
  assert.equal(inserted.worksheets[0].cells.A3, "East");
  assert.equal(inserted.worksheets[0].cells.B3, "1200");

  const deleted = await service.changeStructure("q3-sales", SHEET1, "row", { action: "delete", index: 2 });
  assert.equal(deleted.worksheets[0].cells.D1, "=#REF!*2");
  assert.equal(deleted.worksheets[0].cells.A2, undefined);
  assert.equal(deleted.worksheets[0].cells.A3, "North");
  assert.deepEqual(deleted.worksheets[1].cells, SHEET2_CELLS);
});

test("inserting a column shifts cells right and deleting one pulls the rest left", async () => {
  const left = await makeService();
  const inserted = await left.service.changeStructure("q3-sales", SHEET1, "column", {
    action: "insert-left",
    index: 1,
  });
  assert.equal(inserted.worksheets[0].cells.A1, "Region");
  assert.equal(inserted.worksheets[0].cells.B2, undefined);
  assert.equal(inserted.worksheets[0].cells.C2, "1200");
  assert.equal(inserted.worksheets[0].cells.C3, "800");
  assert.equal(inserted.worksheets[0].cells.C4, "700");
  assert.equal(inserted.worksheets[0].usedCols, 4);
  assert.deepEqual(inserted.worksheets[1].cells, SHEET2_CELLS);

  const right = await makeService();
  const afterRight = await right.service.changeStructure("q3-sales", SHEET1, "column", {
    action: "insert-right",
    index: 0,
  });
  assert.equal(afterRight.worksheets[0].cells.A1, "Region");
  assert.equal(afterRight.worksheets[0].cells.B2, undefined);
  assert.equal(afterRight.worksheets[0].cells.C2, "1200");
  assert.equal(afterRight.worksheets[0].cells.C3, "800");

  const deletion = await makeService();
  const deleted = await deletion.service.changeStructure("q3-sales", SHEET1, "column", {
    action: "delete",
    index: 1,
  });
  assert.deepEqual(deleted.worksheets[0].cells, {
    A1: "Region", B1: "Status",
    A2: "East", B2: "Open",
    A3: "North", B3: "Closed",
    A4: "South", B4: "Open",
  });
  assert.equal(deleted.worksheets[0].usedCols, 2);

  const reloaded = createWorkbookService(createJsonStore(deletion.file, createSeedState()));
  assert.deepEqual((await reloaded.get("q3-sales")).worksheets[0].cells, deleted.worksheets[0].cells);
});

test("a moved column keeps a formula pointing at it and a deleted column shows #REF!", async () => {
  const moved = await makeService();
  await moved.service.updateCells("q3-sales", SHEET1, { D1: "=B2+1" });
  const inserted = await moved.service.changeStructure("q3-sales", SHEET1, "column", {
    action: "insert-left",
    index: 0,
  });
  assert.equal(inserted.worksheets[0].cells.E1, "=C2+1");

  const cleaned = await moved.service.changeStructure("q3-sales", SHEET1, "column", {
    action: "delete",
    index: 1,
  });
  // The blank column added above is removed again; the reference follows 1200.
  assert.deepEqual(cleaned.worksheets[0].cells, {
    B1: "Sales", C1: "Status", B2: "1200", C2: "Open",
    B3: "800", C3: "Closed", B4: "700", C4: "Open",
    D1: "=B2+1",
  });

  const removed = await makeService();
  await removed.service.updateCells("q3-sales", SHEET1, { D1: "=B2+1" });
  const deleted = await removed.service.changeStructure("q3-sales", SHEET1, "column", {
    action: "delete",
    index: 1,
  });
  assert.equal(deleted.worksheets[0].cells.C1, "=#REF!+1");
  assert.equal(deleted.worksheets[0].cells.D1, undefined);
});

test("an unknown action or an out-of-range index is rejected without touching the store", async () => {
  const { service, file } = await makeService();
  const before = (await service.get("q3-sales")).worksheets[0];

  await assert.rejects(
    () => service.changeStructure("q3-sales", SHEET1, "row", { action: "insert-somewhere", index: 0 }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    () => service.changeStructure("q3-sales", SHEET1, "row", { action: "delete", index: -1 }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    () => service.changeStructure("q3-sales", SHEET1, "row", { action: "delete", index: before.rowCount }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    () => service.changeStructure("q3-sales", SHEET1, "column", { action: "delete", index: 1.5 }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    () => service.changeStructure("q3-sales", "nope", "row", { action: "delete", index: 0 }),
    (error) => error.status === 404,
  );
  await assert.rejects(
    () => service.changeStructure("nope", SHEET1, "row", { action: "delete", index: 0 }),
    (error) => error.status === 404,
  );

  // A successful write after the rejected calls proves the sheet still holds the seed.
  await service.rename("q3-sales", "Q3 Sales");
  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(persisted.workbooks[0].worksheets[0].cells, SEED_CELLS);
  assert.deepEqual((await service.get("q3-sales")).worksheets[0].cells, SEED_CELLS);
});

test("a formula reference rewrite covers ranges, absolute markers and functions", async () => {
  assert.equal(adjustCellReferences("=SUM(A1:A3)", "row", 0, "insert"), "=SUM(A2:A4)");
  assert.equal(adjustCellReferences("=SUM(A1:A3)", "row", 1, "insert"), "=SUM(A1:A4)");
  assert.equal(adjustCellReferences("=SUM(A2:A4)", "row", 1, "delete"), "=SUM(A2:A3)");
  assert.equal(adjustCellReferences("=SUM(A2:A2)", "row", 1, "delete"), "=SUM(#REF!)");
  assert.equal(adjustCellReferences("=$A$1+$B1", "row", 0, "insert"), "=$A$2+$B2");
  assert.equal(adjustCellReferences("=LOG10(A1)+1", "row", 0, "insert"), "=LOG10(A2)+1");
  assert.equal(adjustCellReferences("=C1", "column", 2, "delete"), "=#REF!");
  assert.equal(adjustCellReferences("=C1", "column", 0, "delete"), "=B1");
  assert.equal(shiftCellValue("plain text A1", "row", 0, "insert"), "plain text A1");
  assert.equal(shiftCellValue("A1", "row", 0, "insert"), "A1");
  assert.equal(shiftCellValue("=A1", "row", 0, "insert"), "=A2");
  assert.deepEqual(
    shiftWorksheetStructure({ cells: {}, rowCount: 50, columnCount: 26 }, "row", "delete", 0).cells,
    {},
  );
});
