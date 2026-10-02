import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createSeedState, createWorkbookService } from "../src/domain/workbooks.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

async function startApp() {
  const dataDirectory = await mkdtemp(join(tmpdir(), "shallowcode-api-data-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-api-static-"));
  await writeFile(join(staticRoot, "index.html"), "<!doctype html><main>app shell</main>", "utf8");
  const store = createJsonStore(join(dataDirectory, "workbooks.json"), createSeedState());
  const handler = createRequestHandler({ service: createWorkbookService(store), staticRoot });
  const server = createServer((request, response) => void handler(request, response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("stores the filter and the validation rules of a worksheet over HTTP", async () => {
  const app = await startApp();
  try {
    const sheet1 = (await (await fetch(`${app.baseUrl}/api/workbooks/q3-sales`)).json()).workbook.worksheets[0].id;
    const rulesUrl = `${app.baseUrl}/api/workbooks/q3-sales/worksheets/${sheet1}`;

    const filter = await fetch(`${rulesUrl}/filter`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filter: { range: "A1:C4", rules: [{ header: "Region", type: "values", values: ["East"] }] },
      }),
    });
    assert.equal(filter.status, 200);
    assert.deepEqual((await filter.json()).workbook.worksheets[0].filter, {
      range: "A1:C4",
      rules: [{ header: "Region", type: "values", values: ["East"] }],
    });

    const cleared = await fetch(`${rulesUrl}/filter`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filter: null }),
    });
    assert.equal(cleared.status, 200);
    assert.equal((await cleared.json()).workbook.worksheets[0].filter, undefined);

    const saved = await fetch(`${rulesUrl}/validations`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ validations: [{ range: "B2:B3", type: "number-between", min: 0, max: 100 }] }),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).workbook.worksheets[0].validations, [
      { range: "B2:B3", type: "number-between", min: 0, max: 100 },
    ]);

    const rejected = await fetch(`${rulesUrl}/cells`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cells: { B3: "101" } }),
    });
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), { error: "Please enter a number from 0 to 100" });

    const invalidRules = await fetch(`${rulesUrl}/validations`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ validations: [{ range: "B2:B3", type: "unknown" }] }),
    });
    assert.equal(invalidRules.status, 400);

    const unknownSheet = await fetch(`${app.baseUrl}/api/workbooks/q3-sales/worksheets/nope/filter`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filter: null }),
    });
    assert.equal(unknownSheet.status, 404);

    const wrongMethod = await fetch(`${rulesUrl}/validations`);
    assert.equal(wrongMethod.status, 404);
  } finally {
    await app.stop();
  }
});

test("serves health, static shell and the seeded workbook list", async () => {
  const app = await startApp();
  try {
    const health = await fetch(`${app.baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
    assert.deepEqual(await (await fetch(`${app.baseUrl}/api/health`)).json(), { ok: true });

    const shell = await fetch(`${app.baseUrl}/`);
    assert.equal(shell.status, 200);
    assert.match(shell.headers.get("content-type"), /text\/html/);

    const list = await (await fetch(`${app.baseUrl}/api/workbooks`)).json();
    assert.deepEqual(list.workbooks.map((workbook) => workbook.name), ["Q3 Sales"]);

    const workbook = await (await fetch(`${app.baseUrl}/api/workbooks/q3-sales`)).json();
    assert.equal(workbook.workbook.worksheets[0].cells.A1, "Region");
  } finally {
    await app.stop();
  }
});

test("creates and renames workbooks over HTTP with validation errors", async () => {
  const app = await startApp();
  try {
    const created = await fetch(`${app.baseUrl}/api/workbooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Budget plan" }),
    });
    assert.equal(created.status, 201);
    const { workbook } = await created.json();
    assert.equal(workbook.name, "Budget plan");
    assert.deepEqual(workbook.worksheets.map((worksheet) => worksheet.name), ["Sheet1"]);

    const renamed = await fetch(`${app.baseUrl}/api/workbooks/${workbook.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  Q4 Forecast " }),
    });
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json()).workbook.name, "Q4 Forecast");

    const invalid = await fetch(`${app.baseUrl}/api/workbooks/${workbook.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "Workbook name cannot be empty" });

    const after = await (await fetch(`${app.baseUrl}/api/workbooks/${workbook.id}`)).json();
    assert.equal(after.workbook.name, "Q4 Forecast");
  } finally {
    await app.stop();
  }
});

test("adds and renames worksheets over HTTP with validation errors", async () => {
  const app = await startApp();
  try {
    const added = await fetch(`${app.baseUrl}/api/workbooks/q3-sales/worksheets`, { method: "POST" });
    assert.equal(added.status, 201);
    const created = (await added.json()).workbook;
    assert.deepEqual(created.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2", "Sheet3"]);
    assert.equal(created.activeWorksheetId, created.worksheets[2].id);
    assert.deepEqual(created.worksheets[0].cells.A1, "Region");

    const sheet2 = created.worksheets[1].id;
    const renamed = await fetch(`${app.baseUrl}/api/workbooks/q3-sales/worksheets/${sheet2}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  Region data " }),
    });
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json()).workbook.worksheets[1].name, "Region data");

    const empty = await fetch(`${app.baseUrl}/api/workbooks/q3-sales/worksheets/${sheet2}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    assert.equal(empty.status, 400);
    assert.deepEqual(await empty.json(), { error: "Worksheet name cannot be empty" });

    const duplicate = await fetch(`${app.baseUrl}/api/workbooks/q3-sales/worksheets/${sheet2}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Sheet1" }),
    });
    assert.equal(duplicate.status, 400);
    assert.deepEqual(await duplicate.json(), { error: "Worksheet name already exists" });

    const after = await (await fetch(`${app.baseUrl}/api/workbooks/q3-sales`)).json();
    assert.deepEqual(after.workbook.worksheets.map((worksheet) => worksheet.name), [
      "Sheet1",
      "Region data",
      "Sheet3",
    ]);
    assert.deepEqual(after.workbook.worksheets[0].cells, {
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

    const missingWorksheet = await fetch(`${app.baseUrl}/api/workbooks/q3-sales/worksheets/nope`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Anything" }),
    });
    assert.equal(missingWorksheet.status, 404);
  } finally {
    await app.stop();
  }
});

test("changes row and column structure over HTTP and reports invalid targets", async () => {
  const app = await startApp();
  try {
    const sheet1 = (await (await fetch(`${app.baseUrl}/api/workbooks/q3-sales`)).json()).workbook.worksheets[0].id;

    const inserted = await fetch(`${app.baseUrl}/api/workbooks/q3-sales/worksheets/${sheet1}/rows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "insert-above", index: 1 }),
    });
    assert.equal(inserted.status, 200);
    const afterInsert = (await inserted.json()).workbook;
    assert.equal(afterInsert.worksheets[0].cells.A3, "East");
    assert.equal(afterInsert.worksheets[0].cells.B3, "1200");
    assert.equal(afterInsert.worksheets[0].cells.A2, undefined);
    assert.deepEqual(afterInsert.worksheets[1].cells, {
      A1: "2",
      B1: "3",
      C1: "=A1+B1",
      D1: "=C1*2",
    });

    const deletedColumn = await fetch(`${app.baseUrl}/api/workbooks/q3-sales/worksheets/${sheet1}/columns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete", index: 0 }),
    });
    assert.equal(deletedColumn.status, 200);
    const afterColumn = (await deletedColumn.json()).workbook;
    assert.deepEqual(afterColumn.worksheets[0].cells, {
      A1: "Sales",
      B1: "Status",
      A3: "1200",
      B3: "Open",
      A4: "800",
      B4: "Closed",
      A5: "700",
      B5: "Open",
    });

    const invalidAction = await fetch(`${app.baseUrl}/api/workbooks/q3-sales/worksheets/${sheet1}/rows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "insert-somewhere", index: 0 }),
    });
    assert.equal(invalidAction.status, 400);
    assert.equal((await invalidAction.json()).error, "Unknown row action");

    const invalidIndex = await fetch(`${app.baseUrl}/api/workbooks/q3-sales/worksheets/${sheet1}/columns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete", index: 999 }),
    });
    assert.equal(invalidIndex.status, 400);

    const missingWorksheet = await fetch(`${app.baseUrl}/api/workbooks/q3-sales/worksheets/nope/rows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete", index: 0 }),
    });
    assert.equal(missingWorksheet.status, 404);

    const wrongMethod = await fetch(`${app.baseUrl}/api/workbooks/q3-sales/worksheets/${sheet1}/rows`);
    assert.equal(wrongMethod.status, 404);

    const persisted = (await (await fetch(`${app.baseUrl}/api/workbooks/q3-sales`)).json()).workbook;
    assert.deepEqual(persisted.worksheets[0].cells, afterColumn.worksheets[0].cells);
  } finally {
    await app.stop();
  }
});

test("stores state and cell updates and returns 404 for unknown resources", async () => {
  const app = await startApp();
  try {
    const sheet2 = (await (await fetch(`${app.baseUrl}/api/workbooks/q3-sales`)).json()).workbook.worksheets[1].id;

    const stateResponse = await fetch(`${app.baseUrl}/api/workbooks/q3-sales/state`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activeWorksheetId: sheet2, selection: { worksheetId: sheet2, anchor: { row: 2, col: 1 }, focus: { row: 2, col: 1 } } }),
    });
    assert.equal(stateResponse.status, 200);
    const state = (await stateResponse.json()).workbook;
    assert.equal(state.activeWorksheetId, sheet2);
    assert.deepEqual(state.selections[sheet2], { anchor: { row: 2, col: 1 }, focus: { row: 2, col: 1 } });

    const cellsResponse = await fetch(
      `${app.baseUrl}/api/workbooks/q3-sales/worksheets/${sheet2}/cells`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cells: { C3: "42" } }),
      },
    );
    assert.equal(cellsResponse.status, 200);
    assert.equal((await cellsResponse.json()).workbook.worksheets[1].cells.C3, "42");

    const missingWorkbook = await fetch(`${app.baseUrl}/api/workbooks/unknown`);
    assert.equal(missingWorkbook.status, 404);
    const missingApi = await fetch(`${app.baseUrl}/api/unknown`);
    assert.equal(missingApi.status, 404);
    const missingAsset = await fetch(`${app.baseUrl}/favicon.ico`);
    assert.equal(missingAsset.status, 404);
    const missingPage = await fetch(`${app.baseUrl}/definitely-not-here`);
    assert.equal(missingPage.status, 404);
  } finally {
    await app.stop();
  }
});
