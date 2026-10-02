import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSeedState, createWorkbookService } from "../src/domain/workbooks.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

async function makeService() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-filter-"));
  const file = join(directory, "workbooks.json");
  const store = createJsonStore(file, createSeedState());
  return { service: createWorkbookService(store), file };
}

const SHEET1 = "q3-sales-sheet1";
const SHEET2 = "q3-sales-sheet2";

test("a value filter is stored per worksheet and hides nothing by itself", async () => {
  const { service, file } = await makeService();

  const updated = await service.setFilter("q3-sales", SHEET1, {
    filter: { range: "A1:C4", rules: [{ header: "Region", type: "values", values: ["East"] }] },
  });
  assert.deepEqual(updated.worksheets[0].filter, {
    range: "A1:C4",
    rules: [{ header: "Region", type: "values", values: ["East"] }],
  });
  // The filter is a view: every source record keeps its value and coordinates.
  assert.equal(updated.worksheets[0].cells.A3, "North");
  assert.equal(updated.worksheets[0].cells.B4, "700");
  // Other worksheets stay untouched.
  assert.equal(updated.worksheets[1].filter, undefined);

  const reloaded = createWorkbookService(createJsonStore(file, createSeedState()));
  assert.deepEqual((await reloaded.get("q3-sales")).worksheets[0].filter, updated.worksheets[0].filter);
  assert.equal(JSON.parse(await readFile(file, "utf8")).workbooks[0].worksheets[1].filter, undefined);
});

test("a condition filter keeps its value only for the comparing conditions", async () => {
  const { service } = await makeService();

  const updated = await service.setFilter("q3-sales", SHEET1, {
    filter: {
      range: "A1:C4",
      rules: [
        { header: "Sales", type: "condition", condition: "greater-than", value: "1000" },
        { header: "Status", type: "condition", condition: "is-empty" },
      ],
    },
  });
  assert.deepEqual(updated.worksheets[0].filter.rules, [
    { header: "Sales", type: "condition", condition: "greater-than", value: "1000" },
    { header: "Status", type: "condition", condition: "is-empty" },
  ]);
});

test("clearing a filter removes it and keeps the source records", async () => {
  const { service, file } = await makeService();
  await service.setFilter("q3-sales", SHEET1, {
    filter: { range: "A1:C4", rules: [{ header: "Region", type: "values", values: ["East"] }] },
  });

  const cleared = await service.setFilter("q3-sales", SHEET1, { filter: null });
  assert.equal(cleared.worksheets[0].filter, undefined);
  assert.deepEqual(cleared.worksheets[0].cells, {
    A1: "Region", B1: "Sales", C1: "Status",
    A2: "East", B2: "1200", C2: "Open",
    A3: "North", B3: "800", C3: "Closed",
    A4: "South", B4: "700", C4: "Open",
  });

  const reloaded = createWorkbookService(createJsonStore(file, createSeedState()));
  assert.equal((await reloaded.get("q3-sales")).worksheets[0].filter, undefined);
});

test("a malformed filter payload leaves the stored filter untouched", async () => {
  const { service } = await makeService();
  await service.setFilter("q3-sales", SHEET1, {
    filter: { range: "A1:C4", rules: [{ header: "Region", type: "values", values: ["East"] }] },
  });

  await assert.rejects(
    () => service.setFilter("q3-sales", SHEET1, {
      filter: { range: "A1:C4", rules: [{ header: "Region", type: "condition", condition: "sounds-like" }] },
    }),
    (error) => error.status === 400 && /Unknown filter condition/.test(error.message),
  );
  await assert.rejects(
    () => service.setFilter("q3-sales", SHEET1, { filter: { range: "nonsense", rules: [] } }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    () => service.setFilter("q3-sales", SHEET1, {
      filter: { range: "A1:C4", rules: [{ header: "", type: "values", values: [] }] },
    }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    () => service.setFilter("nope", SHEET1, { filter: null }),
    (error) => error.status === 404,
  );

  const stored = await service.get("q3-sales");
  assert.deepEqual(stored.worksheets[0].filter, {
    range: "A1:C4",
    rules: [{ header: "Region", type: "values", values: ["East"] }],
  });
});

test("row and column changes keep the filter region aligned with its cells", async () => {
  const { service } = await makeService();
  await service.setFilter("q3-sales", SHEET1, {
    filter: { range: "A1:C4", rules: [{ header: "Status", type: "values", values: ["Open"] }] },
  });

  const inserted = await service.changeStructure("q3-sales", SHEET1, "row", {
    action: "insert-above",
    index: 2,
  });
  assert.equal(inserted.worksheets[0].filter.range, "A1:C5");

  const column = await service.changeStructure("q3-sales", SHEET1, "column", {
    action: "insert-left",
    index: 1,
  });
  assert.equal(column.worksheets[0].filter.range, "A1:D5");

  const deleted = await service.changeStructure("q3-sales", SHEET1, "row", {
    action: "delete",
    index: 2,
  });
  assert.equal(deleted.worksheets[0].filter.range, "A1:D4");
});

test("a filter covering a single row disappears when that row is deleted", async () => {
  const { service } = await makeService();
  await service.changeStructure("q3-sales", SHEET2, "row", { action: "delete", index: 0 });
  await service.setFilter("q3-sales", SHEET2, { filter: { range: "A1:C1", rules: [] } });

  const deleted = await service.changeStructure("q3-sales", SHEET2, "row", { action: "delete", index: 0 });
  assert.equal(deleted.worksheets[1].filter, undefined);
});
