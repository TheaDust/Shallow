import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSeedState, createWorkbookService } from "../src/domain/workbooks.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

async function makeService() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-cells-"));
  const file = join(directory, "workbooks.json");
  const store = createJsonStore(file, createSeedState());
  return { service: createWorkbookService(store), file, store };
}

test("a cell batch writes every coordinate of the rectangle and clears empty fields", async () => {
  const { service, file } = await makeService();
  const sheet1 = (await service.get("q3-sales")).worksheets[0].id;

  const updated = await service.updateCells("q3-sales", sheet1, {
    D1: "East",
    E1: "1200",
    D2: "North",
    E2: "800",
    C3: "",
  });
  const cells = updated.worksheets[0].cells;
  assert.equal(cells.D1, "East");
  assert.equal(cells.E1, "1200");
  assert.equal(cells.D2, "North");
  assert.equal(cells.E2, "800");
  // The seeded rectangle outside the target stays untouched and the empty
  // field is not stored as a value.
  assert.equal(cells.A1, "Region");
  assert.equal(cells.B2, "1200");
  assert.equal(cells.C3, undefined);

  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.equal(persisted.workbooks[0].worksheets[0].cells.E2, "800");
});

test("a batch over formula sources stores only the inputs, so results cannot go stale", async () => {
  const { service, file } = await makeService();
  const sheet2 = (await service.get("q3-sales")).worksheets[1].id;

  // The sources of `=A1+B1` / `=C1*2` change in one batch (REQ-4-2-1).
  await service.updateCells("q3-sales", sheet2, { A1: "10", B1: "4" });

  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(persisted.workbooks[0].worksheets[1].cells, {
    A1: "10",
    B1: "4",
    C1: "=A1+B1",
    D1: "=C1*2",
  });

  // A reload serves the current sources plus the untouched expressions, which
  // is what the grid recalculates from; no pre-change result is stored.
  const reloaded = createWorkbookService(createJsonStore(file, createSeedState()));
  const worksheet = (await reloaded.get("q3-sales")).worksheets[1];
  assert.equal(worksheet.cells.C1, "=A1+B1");
  assert.equal(worksheet.cells.D1, "=C1*2");
  assert.deepEqual(worksheet.cells.A1, "10");
});

test("an invalid coordinate rejects the complete batch and keeps every target cell", async () => {
  const { service, store } = await makeService();
  const sheet1 = (await service.get("q3-sales")).worksheets[0].id;

  await assert.rejects(
    () => service.updateCells("q3-sales", sheet1, { D1: "East", E1: "1200", "1A": "boom" }),
    /Invalid cell reference: 1A/,
  );

  const persisted = await store.read();
  assert.equal(persisted.workbooks[0].worksheets[0].cells.D1, undefined);
  assert.equal(persisted.workbooks[0].worksheets[0].cells.E1, undefined);
});

test("a rejecting 0-to-100 rule blocks the batch with the rule message", async () => {
  const { service, store } = await makeService();
  const sheet1 = (await service.get("q3-sales")).worksheets[0].id;
  await store.update((draft) => {
    draft.workbooks[0].worksheets[0].validations = [
      { range: "D1:E2", type: "number-between", min: 0, max: 100 },
    ];
    return draft;
  });

  // A batch with one out-of-range value must not write any of its cells.
  await assert.rejects(
    () => service.updateCells("q3-sales", sheet1, { D1: "40", E1: "800" }),
    /Please enter a number from 0 to 100/,
  );
  const after = await service.get("q3-sales");
  assert.equal(after.worksheets[0].cells.D1, undefined);
  assert.equal(after.worksheets[0].cells.E1, undefined);

  // Values inside the rule still write normally.
  const updated = await service.updateCells("q3-sales", sheet1, { D1: "40", E1: "80" });
  assert.equal(updated.worksheets[0].cells.D1, "40");
  assert.equal(updated.worksheets[0].cells.E1, "80");
});

test("clearing a cell keeps the used rectangle so later reads stay consistent", async () => {
  const { service } = await makeService();
  const sheet1 = (await service.get("q3-sales")).worksheets[0].id;

  const updated = await service.updateCells("q3-sales", sheet1, { B2: null });
  assert.equal(updated.worksheets[0].cells.B2, undefined);
  assert.equal(updated.worksheets[0].cells.A2, "East");
  assert.ok(updated.worksheets[0].usedRows >= 2);
  assert.ok(updated.worksheets[0].usedCols >= 2);
});
