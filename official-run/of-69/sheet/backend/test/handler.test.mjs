import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/handler.mjs";
import { createWorkbookService } from "../src/lib/workbooks.mjs";

async function startApp(t) {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-handler-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const staticRoot = join(directory, "dist");
  await mkdir(staticRoot, { recursive: true });
  await writeFile(join(staticRoot, "index.html"), "<!doctype html><div id=\"root\"></div>");

  const service = createWorkbookService({ filePath: join(directory, "workbooks.json") });
  const server = createServer(createRequestHandler({ service, staticRoot }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

test("imports CSV over HTTP and exports the active worksheet without changing it", async (t) => {
  const base = await startApp(t);

  const imported = await json(await fetch(`${base}/api/workbooks/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName: "regional sales.csv", content: 'Region,Revenue\nEast,1200\nNorth,800' }),
  }));
  assert.equal(imported.status, 201);
  assert.equal(imported.body.workbook.name, "regional sales");
  assert.equal(imported.body.workbook.worksheets[0].name, "Sheet1");
  assert.equal(imported.body.workbook.worksheets[0].cells.B3.value, "800");
  const importedId = imported.body.workbook.id;
  const worksheetId = imported.body.workbook.worksheets[0].id;

  const rejected = await json(await fetch(`${base}/api/workbooks/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName: "broken.csv", content: 'Region,"East' }),
  }));
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, "Invalid CSV file format. Import failed.");

  const list = await json(await fetch(`${base}/api/workbooks`));
  assert.deepEqual(list.body.workbooks.map((summary) => summary.name).sort(), ["Q3 Sales", "regional sales"]);

  const exported = await fetch(`${base}/api/workbooks/${importedId}/export.csv`);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-type"), /^text\/csv/);
  assert.match(exported.headers.get("content-disposition"), /attachment/);
  assert.match(exported.headers.get("content-disposition"), /regional%20sales%20-%20Sheet1\.csv/);
  assert.equal(await exported.text(), "Region,Revenue\nEast,1200\nNorth,800");

  const seededExport = await fetch(`${base}/api/workbooks/wb-q3-sales/export.csv?worksheetId=ws-q3-sales-sheet1`);
  assert.equal(seededExport.status, 200);
  assert.equal(await seededExport.text(), "Region,Sales,Status\nEast,1200,Open\nNorth,800,Closed\nSouth,700,Open");

  const untouched = await json(await fetch(`${base}/api/workbooks/${importedId}`));
  assert.deepEqual(untouched.body.workbook, imported.body.workbook);
  assert.equal(untouched.body.workbook.activeWorksheetId, worksheetId);

  const missingWorkbook = await fetch(`${base}/api/workbooks/nope/export.csv`);
  assert.equal(missingWorkbook.status, 404);
  const missingWorksheet = await fetch(`${base}/api/workbooks/${importedId}/export.csv?worksheetId=ws-nope`);
  assert.equal(missingWorksheet.status, 404);
  const stillAlive = await json(await fetch(`${base}/api/health`));
  assert.deepEqual(stillAlive.body, { ok: true });
});

test("adds and renames worksheets over HTTP without partial state", async (t) => {
  const base = await startApp(t);
  const headers = { "content-type": "application/json" };

  const added = await json(await fetch(`${base}/api/workbooks/wb-q3-sales/worksheets`, { method: "POST" }));
  assert.equal(added.status, 201);
  assert.deepEqual(added.body.workbook.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2", "Sheet3"]);
  const newWorksheet = added.body.workbook.worksheets[2];
  assert.equal(added.body.workbook.activeWorksheetId, newWorksheet.id);
  assert.deepEqual(newWorksheet.cells, {});
  assert.deepEqual(newWorksheet.selection, { anchor: "A1", focus: "A1" });
  assert.equal(added.body.workbook.worksheets[0].cells.A2.value, "East");

  const renamed = await json(await fetch(`${base}/api/workbooks/wb-q3-sales/worksheets/${newWorksheet.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ name: "  Summary  " }),
  }));
  assert.equal(renamed.status, 200);
  assert.deepEqual(renamed.body.workbook.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2", "Summary"]);

  const duplicate = await json(await fetch(`${base}/api/workbooks/wb-q3-sales/worksheets/${newWorksheet.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ name: "Sheet1" }),
  }));
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.error, "Worksheet name already exists");

  const emptyName = await json(await fetch(`${base}/api/workbooks/wb-q3-sales/worksheets/${newWorksheet.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ name: "   " }),
  }));
  assert.equal(emptyName.status, 400);
  assert.equal(emptyName.body.error, "Worksheet name cannot be empty");

  const afterFailures = await json(await fetch(`${base}/api/workbooks/wb-q3-sales`));
  assert.deepEqual(
    afterFailures.body.workbook.worksheets.map((worksheet) => worksheet.name),
    ["Sheet1", "Sheet2", "Summary"],
  );
  assert.equal(afterFailures.body.workbook.worksheets[0].cells.B3.value, "800");

  const missingWorksheet = await json(await fetch(`${base}/api/workbooks/wb-q3-sales/worksheets/ws-nope`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ name: "Nope" }),
  }));
  assert.equal(missingWorksheet.status, 404);
  const missingWorkbook = await json(await fetch(`${base}/api/workbooks/nope/worksheets`, { method: "POST" }));
  assert.equal(missingWorkbook.status, 404);
  const wrongMethod = await fetch(`${base}/api/workbooks/wb-q3-sales/worksheets`);
  assert.equal(wrongMethod.status, 404);

  const stillAlive = await json(await fetch(`${base}/health`));
  assert.deepEqual(stillAlive.body, { ok: true });
});

test("deletes worksheets over HTTP and blocks the last worksheet and pivot sources", async (t) => {
  const base = await startApp(t);
  const headers = { "content-type": "application/json" };

  const created = await json(await fetch(`${base}/api/workbooks/wb-q3-sales/pivots`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sourceWorksheetId: "ws-q3-sales-sheet1", range: "A1:C4" }),
  }));
  assert.equal(created.status, 201);
  const pivot = created.body.workbook.worksheets.find((worksheet) => worksheet.name === "Pivot1");
  assert.ok(pivot);

  const blocked = await json(await fetch(`${base}/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet1`, {
    method: "DELETE",
  }));
  assert.equal(blocked.status, 400);
  assert.equal(blocked.body.error, "Please delete or rebuild dependent pivot tables first");

  const removedPivot = await json(await fetch(`${base}/api/workbooks/wb-q3-sales/worksheets/${pivot.id}`, {
    method: "DELETE",
  }));
  assert.equal(removedPivot.status, 200);
  assert.deepEqual(removedPivot.body.workbook.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2"]);
  // The removed pivot tab was last, so its previous neighbour takes over as active.
  assert.equal(removedPivot.body.workbook.activeWorksheetId, "ws-q3-sales-sheet2");

  const removedSource = await json(await fetch(`${base}/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet1`, {
    method: "DELETE",
  }));
  assert.equal(removedSource.status, 200);
  assert.deepEqual(removedSource.body.workbook.worksheets.map((worksheet) => worksheet.name), ["Sheet2"]);

  const removedLast = await json(await fetch(`${base}/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet2`, {
    method: "DELETE",
  }));
  assert.equal(removedLast.status, 400);
  assert.equal(removedLast.body.error, "A workbook must contain at least one worksheet");

  const reopened = await json(await fetch(`${base}/api/workbooks/wb-q3-sales`));
  assert.deepEqual(reopened.body.workbook.worksheets.map((worksheet) => worksheet.name), ["Sheet2"]);
  assert.equal(reopened.body.workbook.activeWorksheetId, "ws-q3-sales-sheet2");
  assert.equal(reopened.body.workbook.worksheets[0].cells.A1, undefined);

  const missing = await json(await fetch(`${base}/api/workbooks/wb-q3-sales/worksheets/ws-nope`, {
    method: "DELETE",
  }));
  assert.equal(missing.status, 404);
});

test("changes row and column structure over HTTP and keeps rejected requests out of storage", async (t) => {
  const base = await startApp(t);
  const headers = { "content-type": "application/json" };
  const rowsUrl = `${base}/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet1/rows`;
  const columnsUrl = `${base}/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet1/columns`;

  const inserted = await json(await fetch(rowsUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "insert-below", index: 1 }),
  }));
  assert.equal(inserted.status, 200);
  assert.equal(inserted.body.workbook.worksheets[0].rowCount, 31);
  assert.equal(inserted.body.workbook.worksheets[0].cells.A3, undefined);
  assert.equal(inserted.body.workbook.worksheets[0].cells.A4.value, "North");
  assert.equal(inserted.body.workbook.worksheets[1].rowCount, 30);

  const column = await json(await fetch(columnsUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "delete", index: 0 }),
  }));
  assert.equal(column.status, 200);
  assert.equal(column.body.workbook.worksheets[0].columnCount, 25);
  assert.equal(column.body.workbook.worksheets[0].cells.A1.value, "Sales");
  assert.equal(column.body.workbook.worksheets[0].cells.A4.value, "800");

  const badAction = await json(await fetch(rowsUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "insert-left", index: 0 }),
  }));
  assert.equal(badAction.status, 400);
  assert.equal(badAction.body.error, "Unable to update the row or column structure");

  const badIndex = await json(await fetch(rowsUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "delete", index: 31 }),
  }));
  assert.equal(badIndex.status, 400);
  assert.equal(badIndex.body.error, "Invalid row or column index");

  const missingWorksheet = await json(await fetch(`${base}/api/workbooks/wb-q3-sales/worksheets/ws-nope/rows`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "delete", index: 0 }),
  }));
  assert.equal(missingWorksheet.status, 404);
  const wrongMethod = await fetch(rowsUrl);
  assert.equal(wrongMethod.status, 404);

  const afterFailures = await json(await fetch(`${base}/api/workbooks/wb-q3-sales`));
  assert.equal(afterFailures.body.workbook.worksheets[0].rowCount, 31);
  assert.equal(afterFailures.body.workbook.worksheets[0].columnCount, 25);
  assert.equal(afterFailures.body.workbook.worksheets[0].cells.A3, undefined);
  assert.equal(afterFailures.body.workbook.worksheets[0].cells.A4.value, "800");

  const stillAlive = await json(await fetch(`${base}/health`));
  assert.deepEqual(stillAlive.body, { ok: true });
});

test("writes cells and the selection over HTTP and keeps rejected writes out of storage", async (t) => {
  const base = await startApp(t);
  const headers = { "content-type": "application/json" };
  const cellsUrl = `${base}/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet1/cells`;
  const selectionUrl = `${base}/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet1/selection`;

  const written = await json(await fetch(cellsUrl, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      updates: [
        { name: "D1", input: "East" },
        { name: "E1", input: "1200" },
        { name: "C1", input: "=E1*2" },
      ],
      selection: { anchor: "D1", focus: "E2" },
    }),
  }));
  assert.equal(written.status, 200);
  const sheet = written.body.workbook.worksheets[0];
  assert.equal(sheet.cells.D1.value, "East");
  assert.equal(sheet.cells.E1.value, "1200");
  assert.equal(sheet.cells.C1.value, "2400");
  assert.equal(sheet.cells.C1.formula, "=E1*2");
  assert.deepEqual(sheet.selection, { anchor: "D1", focus: "E2" });

  const badCell = await json(await fetch(cellsUrl, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ updates: [{ name: "nope", input: "1" }] }),
  }));
  assert.equal(badCell.status, 400);
  assert.equal(badCell.body.error, "Invalid cell reference");

  const badSelection = await json(await fetch(selectionUrl, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ anchor: "A1", focus: "AA99" }),
  }));
  assert.equal(badSelection.status, 400);
  assert.equal(badSelection.body.error, "Invalid cell selection");

  const wrongMethod = await fetch(cellsUrl);
  assert.equal(wrongMethod.status, 404);
  const missingWorksheet = await json(await fetch(
    `${base}/api/workbooks/wb-q3-sales/worksheets/ws-nope/cells`,
    { method: "PATCH", headers, body: JSON.stringify({ updates: [{ name: "D1", input: "1" }] }) },
  ));
  assert.equal(missingWorksheet.status, 404);

  const afterFailures = await json(await fetch(`${base}/api/workbooks/wb-q3-sales`));
  const stored = afterFailures.body.workbook.worksheets[0];
  assert.equal(stored.cells.C1.value, "2400", "a rejected write keeps the calculated result");
  assert.equal(stored.cells.A1.value, "Region");
  assert.deepEqual(stored.selection, { anchor: "D1", focus: "E2" });

  const stillAlive = await json(await fetch(`${base}/health`));
  assert.deepEqual(stillAlive.body, { ok: true });
});

test("serves health, workbook API and static entry without crashing", async (t) => {
  const base = await startApp(t);

  const health = await json(await fetch(`${base}/health`));
  assert.deepEqual(health, { status: 200, body: { ok: true } });
  const apiHealth = await json(await fetch(`${base}/api/health`));
  assert.deepEqual(apiHealth, { status: 200, body: { ok: true } });

  const list = await json(await fetch(`${base}/api/workbooks`));
  assert.equal(list.status, 200);
  assert.equal(list.body.workbooks.length, 1);
  assert.equal(list.body.workbooks[0].name, "Q3 Sales");

  const opened = await json(await fetch(`${base}/api/workbooks/wb-q3-sales`));
  assert.equal(opened.status, 200);
  assert.equal(opened.body.workbook.worksheets[0].cells.A1.value, "Region");

  const created = await json(await fetch(`${base}/api/workbooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Fresh" }),
  }));
  assert.equal(created.status, 201);
  assert.equal(created.body.workbook.name, "Fresh");
  const createdId = created.body.workbook.id;

  const renamed = await json(await fetch(`${base}/api/workbooks/${createdId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "  Renamed  " }),
  }));
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.workbook.name, "Renamed");

  const rejected = await json(await fetch(`${base}/api/workbooks/${createdId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "   " }),
  }));
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, "Workbook name cannot be empty");
  const unchanged = await json(await fetch(`${base}/api/workbooks/${createdId}`));
  assert.equal(unchanged.body.workbook.name, "Renamed");

  const missing = await json(await fetch(`${base}/api/workbooks/nope`));
  assert.equal(missing.status, 404);
  const unknownApi = await json(await fetch(`${base}/api/unknown`));
  assert.equal(unknownApi.status, 404);
  const favicon = await json(await fetch(`${base}/favicon.ico`));
  assert.equal(favicon.status, 404);
  const invalidJson = await json(await fetch(`${base}/api/workbooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{oops",
  }));
  assert.equal(invalidJson.status, 400);

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="root"/);

  const stillAlive = await json(await fetch(`${base}/health`));
  assert.equal(stillAlive.status, 200);
});

test("stores filter views and validation rules over HTTP", async (t) => {
  const base = await startApp(t);
  const headers = { "content-type": "application/json" };
  const sheetUrl = `${base}/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet1`;

  const created = await json(await fetch(`${sheetUrl}/filter`, {
    method: "POST",
    headers,
    body: JSON.stringify({ range: "A1:C4", rules: [] }),
  }));
  assert.equal(created.status, 200);
  assert.deepEqual(created.body.workbook.worksheets[0].filter, { range: "A1:C4", rules: [] });

  const ruled = await json(await fetch(`${sheetUrl}/filter`, {
    method: "POST",
    headers,
    body: JSON.stringify({ range: "A1:C4", rules: [{ column: 0, mode: "values", values: ["East"] }] }),
  }));
  assert.equal(ruled.status, 200);
  assert.deepEqual(ruled.body.workbook.worksheets[0].filter.rules, [
    { column: 0, mode: "values", values: ["East"] },
  ]);

  const badRange = await json(await fetch(`${sheetUrl}/filter`, {
    method: "POST",
    headers,
    body: JSON.stringify({ range: "nope", rules: [] }),
  }));
  assert.equal(badRange.status, 400);

  const rule = await json(await fetch(`${sheetUrl}/validations`, {
    method: "POST",
    headers,
    body: JSON.stringify({ range: "B2:B3", type: "number", min: 0, max: 100 }),
  }));
  assert.equal(rule.status, 200);
  assert.deepEqual(rule.body.workbook.worksheets[0].validations, [
    { range: "B2:B3", type: "number", min: 0, max: 100 },
  ]);

  const rejected = await json(await fetch(`${sheetUrl}/cells`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ updates: [{ name: "B3", input: "101" }] }),
  }));
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, "Please enter a number from 0 to 100");

  const removed = await json(await fetch(`${sheetUrl}/validations?range=B2%3AB3`, { method: "DELETE" }));
  assert.equal(removed.status, 200);
  assert.equal(removed.body.workbook.worksheets[0].validations, undefined);

  const cleared = await json(await fetch(`${sheetUrl}/filter`, { method: "DELETE" }));
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.workbook.worksheets[0].filter, undefined);

  const unsupported = await json(await fetch(`${sheetUrl}/filter`, { method: "PUT" }));
  assert.equal(unsupported.status, 404);
});
