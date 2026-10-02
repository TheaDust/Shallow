import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createSeedState, createWorkbookService } from "../src/domain/workbooks.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

async function makeService() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-sort-"));
  const file = join(directory, "workbooks.json");
  const store = createJsonStore(file, createSeedState());
  return { service: createWorkbookService(store), file };
}

const SHEET1 = "q3-sales-sheet1";

test("sorts the selected range by a numeric column and keeps the header row", async () => {
  const { service, file } = await makeService();

  const updated = await service.sortRange("q3-sales", SHEET1, {
    range: "A1:C4",
    column: 1,
    order: "ascending",
    hasHeaderRow: true,
  });

  assert.deepEqual(updated.worksheets[0].cells, {
    A1: "Region", B1: "Sales", C1: "Status",
    A2: "South", B2: "700", C2: "Open",
    A3: "North", B3: "800", C3: "Closed",
    A4: "East", B4: "1200", C4: "Open",
  });
  // The header row stayed in place and every record moved as a whole row.
  assert.equal(updated.worksheets[0].cells.A1, "Region");

  const reloaded = createWorkbookService(createJsonStore(file, createSeedState()));
  assert.deepEqual((await reloaded.get("q3-sales")).worksheets[0].cells, updated.worksheets[0].cells);
});

test("descending order reverses the key comparison and text sorts by its own type", async () => {
  const { service } = await makeService();
  const { service: textService } = await makeService();

  const descending = await service.sortRange("q3-sales", SHEET1, {
    range: "A1:C4",
    column: "Sales",
    order: "descending",
    hasHeaderRow: true,
  });
  assert.deepEqual([descending.worksheets[0].cells.A2, descending.worksheets[0].cells.A3, descending.worksheets[0].cells.A4],
    ["East", "North", "South"]);

  const text = await textService.sortRange("q3-sales", SHEET1, {
    range: "A1:C4",
    column: 0,
    order: "ascending",
    hasHeaderRow: true,
  });
  assert.deepEqual([text.worksheets[0].cells.A2, text.worksheets[0].cells.A3, text.worksheets[0].cells.A4],
    ["East", "North", "South"]);
});

test("equal sort keys keep their original relative order", async () => {
  const { service } = await makeService();
  await service.updateCells("q3-sales", SHEET1, { B3: "1200" });

  const updated = await service.sortRange("q3-sales", SHEET1, {
    range: "A1:C4",
    column: 1,
    order: "ascending",
    hasHeaderRow: true,
  });
  // South (700) first; the two 1200 rows stay in their source order: East then North.
  assert.deepEqual([updated.worksheets[0].cells.A2, updated.worksheets[0].cells.A3, updated.worksheets[0].cells.A4],
    ["South", "East", "North"]);
  assert.equal(updated.worksheets[0].cells.B3, "1200");
});

test("a parseable date column sorts chronologically, not as text", async () => {
  const { service } = await makeService();
  await service.updateCells("q3-sales", SHEET1, {
    A2: "2026-09-01",
    A3: "2026-07-15",
    A4: "2026-08-20",
  });

  const updated = await service.sortRange("q3-sales", SHEET1, {
    range: "A1:C4",
    column: 0,
    order: "ascending",
    hasHeaderRow: true,
  });
  assert.deepEqual([updated.worksheets[0].cells.A2, updated.worksheets[0].cells.A3, updated.worksheets[0].cells.A4],
    ["2026-07-15", "2026-08-20", "2026-09-01"]);
  // The whole record moved with its key column.
  assert.equal(updated.worksheets[0].cells.C4, "Open");
});

test("sorting one rectangle leaves adjacent data and other worksheets unchanged", async () => {
  const { service } = await makeService();
  await service.updateCells("q3-sales", SHEET1, {
    A5: "Total",
    B5: "2700",
    C2: "Alpha",
    C3: "Beta",
    C4: "Gamma",
  });

  const updated = await service.sortRange("q3-sales", SHEET1, {
    range: "A2:B4",
    column: 0,
    order: "descending",
    hasHeaderRow: false,
  });

  // Only the two selected columns moved, and only inside the selected rows.
  assert.deepEqual(updated.worksheets[0].cells.A2, "South");
  assert.deepEqual(updated.worksheets[0].cells.B2, "700");
  assert.deepEqual(updated.worksheets[0].cells.A4, "East");
  assert.deepEqual(updated.worksheets[0].cells.B4, "1200");
  assert.deepEqual(
    [updated.worksheets[0].cells.C2, updated.worksheets[0].cells.C3, updated.worksheets[0].cells.C4],
    ["Alpha", "Beta", "Gamma"],
  );
  assert.equal(updated.worksheets[0].cells.A5, "Total");
  assert.equal(updated.worksheets[0].cells.B5, "2700");
  // The other worksheet of the same workbook is untouched.
  assert.deepEqual(updated.worksheets[1].cells, { A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2" });
});

test("formulas travel with their record as their original text", async () => {
  const { service } = await makeService();
  await service.updateCells("q3-sales", SHEET1, { D2: "=B2*2" });

  const updated = await service.sortRange("q3-sales", SHEET1, {
    range: "A1:D4",
    column: 1,
    order: "ascending",
    hasHeaderRow: true,
  });
  // The East record (Sales 1200) is last now and its formula moved with it.
  assert.equal(updated.worksheets[0].cells.A4, "East");
  assert.equal(updated.worksheets[0].cells.D4, "=B2*2");
  assert.equal(updated.worksheets[0].cells.D2, undefined);
});

test("sorting keeps the stored filter and validation rules of the range", async () => {
  const { service } = await makeService();
  await service.setFilter("q3-sales", SHEET1, {
    filter: { range: "A1:C4", rules: [{ header: "Status", type: "values", values: ["Open"] }] },
  });
  await service.replaceValidations("q3-sales", SHEET1, {
    validations: [{ range: "B2:B4", type: "number-between", min: 0, max: 1000 }],
  });

  const updated = await service.sortRange("q3-sales", SHEET1, {
    range: "A1:C4",
    column: 1,
    order: "ascending",
    hasHeaderRow: true,
  });
  assert.deepEqual(updated.worksheets[0].filter, {
    range: "A1:C4",
    rules: [{ header: "Status", type: "values", values: ["Open"] }],
  });
  assert.deepEqual(updated.worksheets[0].validations, [
    { range: "B2:B4", type: "number-between", min: 0, max: 1000 },
  ]);
  // A moved value is not re-checked: existing values never invalidate a sort.
  assert.equal(updated.worksheets[0].cells.B2, "700");
});

test("a rejected sort leaves the grid in its original order", async () => {
  const { service } = await makeService();
  const original = (await service.get("q3-sales")).worksheets[0].cells;

  const failures = [
    { range: "nonsense", column: 1, order: "ascending" },
    { range: "A1:C4", column: 1, order: "sideways" },
    { range: "A1:C4", column: 9, order: "ascending" },
    { range: "A1:C4", column: "Nope", order: "ascending" },
    { range: "A1:C1", column: 0, order: "ascending", hasHeaderRow: true },
  ];
  for (const request of failures) {
    await assert.rejects(
      () => service.sortRange("q3-sales", SHEET1, request),
      (error) => error.status === 400,
      `expected 400 for ${JSON.stringify(request)}`,
    );
  }
  await assert.rejects(
    () => service.sortRange("q3-sales", "nope", { range: "A1:C4", column: 1, order: "ascending" }),
    (error) => error.status === 404,
  );

  assert.deepEqual((await service.get("q3-sales")).worksheets[0].cells, original);
});

test("serves sorting over HTTP and reports a rejected request as 400", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "shallowcode-sort-http-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-sort-static-"));
  await writeFile(join(staticRoot, "index.html"), "<!doctype html><main>app shell</main>", "utf8");
  const store = createJsonStore(join(dataDirectory, "workbooks.json"), createSeedState());
  const handler = createRequestHandler({ service: createWorkbookService(store), staticRoot });
  const server = createServer((request, response) => void handler(request, response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const url = `${baseUrl}/api/workbooks/q3-sales/worksheets/${SHEET1}/sort`;

  try {
    const sorted = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ range: "A1:C4", column: 1, order: "ascending", hasHeaderRow: true }),
    });
    assert.equal(sorted.status, 200);
    assert.deepEqual((await sorted.json()).workbook.worksheets[0].cells.A2, "South");

    const rejected = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ range: "A1:C4", column: 1, order: "upside-down" }),
    });
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), { error: "Unknown sort order: upside-down" });

    // The rejected request kept the order of the successful sort.
    const workbook = await (await fetch(`${baseUrl}/api/workbooks/q3-sales`)).json();
    assert.equal(workbook.workbook.worksheets[0].cells.A2, "South");
    assert.equal(workbook.workbook.worksheets[0].cells.A4, "East");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
