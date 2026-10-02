import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";
import { createInitialState } from "../src/lib/seed.mjs";

const WORKBOOK = "wb-q3-sales";
const SHEET1 = "ws-q3-sales-sheet1";
const SHEET2 = "ws-q3-sales-sheet2";
const SEED_TIMESTAMP = "2026-01-15T09:30:00.000Z";

async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-worksheets-"));
  const statePath = join(directory, "workbooks.json");
  const store = createJsonStore(statePath, createInitialState());
  const handler = createRequestHandler({ store, staticRoot: join(directory, "no-dist") });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const api = async (path, init = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      method: init.method ?? "GET",
      headers: init.body ? { "content-type": "application/json" } : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  return {
    directory,
    statePath,
    api,
    async restart() {
      const restarted = createJsonStore(statePath, createInitialState());
      const newHandler = createRequestHandler({ store: restarted, staticRoot: join(directory, "no-dist") });
      const newServer = createServer(newHandler);
      await new Promise((resolve) => newServer.listen(0, "127.0.0.1", resolve));
      return { port: newServer.address().port, close: () => close(newServer) };
    },
    close: () => close(server),
  };
}

async function close(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

async function reopen(api) {
  const restarted = await api.restart();
  const workbook = await fetch(`http://127.0.0.1:${restarted.port}/api/workbooks/${WORKBOOK}`)
    .then((response) => response.json())
    .then((body) => body.workbook);
  return { workbook, close: restarted.close };
}

function addWorksheet(api) {
  return api.api(`/api/workbooks/${WORKBOOK}/worksheets`, { method: "POST", body: JSON.stringify({}) });
}

function renameWorksheet(api, worksheetId, name) {
  return api.api(`/api/workbooks/${WORKBOOK}/worksheets/${worksheetId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

function deleteWorksheet(api, worksheetId) {
  return api.api(`/api/workbooks/${WORKBOOK}/worksheets/${worksheetId}`, { method: "DELETE" });
}

function createPivot(api, worksheetId, range) {
  return api.api(`/api/workbooks/${WORKBOOK}/worksheets/${worksheetId}/pivot`, {
    method: "POST",
    body: JSON.stringify({ range }),
  });
}

test("adds a blank Sheet3 to the seeded workbook and makes it the active worksheet", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const added = await addWorksheet(api);
  assert.equal(added.status, 201);
  const workbook = added.body.workbook;
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Sheet1", "Sheet2", "Sheet3"]);

  const [sheet1, sheet2, sheet3] = workbook.worksheets;
  assert.equal(sheet1.id, SHEET1);
  assert.equal(sheet2.id, SHEET2);
  // The existing worksheets keep their values; only the new tab is active.
  assert.equal(sheet1.cells.A2, "East");
  assert.equal(sheet1.cells.B3, "800");
  assert.deepEqual(sheet2.cells, {});
  assert.deepEqual(sheet3.cells, {});
  assert.deepEqual(sheet3.selection, { anchor: "A1", focus: "A1" });
  assert.equal(sheet3.rowCount, 30);
  assert.equal(sheet3.columnCount, 26);
  assert.deepEqual(sheet3.validations, []);
  assert.deepEqual(sheet3.filters, []);
  assert.equal(sheet3.pivot, null);
  assert.equal(workbook.activeWorksheetId, sheet3.id);
  assert.notEqual(workbook.updatedAt, SEED_TIMESTAMP);

  const { workbook: reopened, close } = await reopen(api);
  t.after(close);
  assert.deepEqual(reopened.worksheets.map((sheet) => sheet.name), ["Sheet1", "Sheet2", "Sheet3"]);
  assert.equal(reopened.activeWorksheetId, sheet3.id);
  assert.equal(reopened.worksheets[0].cells.A2, "East");
});

test("allocates the first unused SheetN name and never copies another worksheet's state", async (t) => {
  const api = await startApi();
  t.after(api.close);

  // A validation rule and a filter on Sheet1 must not travel to the added worksheet.
  await api.api(`/api/workbooks/${WORKBOOK}/worksheets/${SHEET1}/validations`, {
    method: "POST",
    body: JSON.stringify({ type: "dropdown", range: { start: "A2", end: "A4" }, values: "East,North" }),
  });
  await api.api(`/api/workbooks/${WORKBOOK}/worksheets/${SHEET1}/filters`, {
    method: "POST",
    body: JSON.stringify({ range: { start: "A1", end: "C4" } }),
  });

  const renamed = await renameWorksheet(api, SHEET2, "Notes");
  assert.equal(renamed.status, 200);
  assert.deepEqual(renamed.body.workbook.worksheets.map((sheet) => sheet.name), ["Sheet1", "Notes"]);

  const added = await addWorksheet(api);
  assert.equal(added.status, 201);
  assert.deepEqual(added.body.workbook.worksheets.map((sheet) => sheet.name), ["Sheet1", "Notes", "Sheet2"]);
  const created = added.body.workbook.worksheets[2];
  assert.deepEqual(created.cells, {});
  assert.deepEqual(created.validations, []);
  assert.deepEqual(created.filters, []);
});

test("trims the new worksheet name and rejects an empty one", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const renamed = await renameWorksheet(api, SHEET2, "  Q3 details  ");
  assert.equal(renamed.status, 200);
  assert.deepEqual(renamed.body.workbook.worksheets.map((sheet) => sheet.name), ["Sheet1", "Q3 details"]);
  assert.notEqual(renamed.body.workbook.updatedAt, SEED_TIMESTAMP);

  for (const name of ["", "   "]) {
    const rejected = await renameWorksheet(api, SHEET2, name);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Worksheet name cannot be empty");
  }

  const reopened = await reopen(api);
  t.after(reopened.close);
  assert.deepEqual(reopened.workbook.worksheets.map((sheet) => sheet.name), ["Sheet1", "Q3 details"]);
});

test("rejects a duplicate worksheet name without touching either worksheet", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const rejected = await renameWorksheet(api, SHEET2, "Sheet1");
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, "Worksheet name already exists");

  // Keeping its own name is not a duplicate.
  const kept = await renameWorksheet(api, SHEET2, " Sheet2 ");
  assert.equal(kept.status, 200);
  assert.deepEqual(kept.body.workbook.worksheets.map((sheet) => sheet.name), ["Sheet1", "Sheet2"]);

  const reopened = await reopen(api);
  t.after(reopened.close);
  assert.deepEqual(reopened.workbook.worksheets.map((sheet) => sheet.name), ["Sheet1", "Sheet2"]);
  assert.equal(reopened.workbook.worksheets[0].cells.A2, "East");
});

test("renames a worksheet whose grid, rules and filter stay attached to it", async (t) => {
  const api = await startApi();
  t.after(api.close);

  await api.api(`/api/workbooks/${WORKBOOK}/worksheets/${SHEET1}/validations`, {
    method: "POST",
    body: JSON.stringify({ type: "dropdown", range: { start: "A2", end: "A4" }, values: "East,North" }),
  });
  await api.api(`/api/workbooks/${WORKBOOK}/worksheets/${SHEET1}/filters`, {
    method: "POST",
    body: JSON.stringify({ range: { start: "A1", end: "C4" } }),
  });

  const renamed = await renameWorksheet(api, SHEET1, "Sales");
  assert.equal(renamed.status, 200);
  const sheet = renamed.body.workbook.worksheets[0];
  assert.equal(sheet.name, "Sales");
  assert.equal(sheet.cells.A2, "East");
  assert.equal(sheet.validations.length, 1);
  assert.equal(sheet.validations[0].values.join(","), "East,North");
  assert.equal(sheet.filters.length, 1);
  // The other worksheet is untouched.
  assert.deepEqual(renamed.body.workbook.worksheets[1].cells, {});
  assert.equal(renamed.body.workbook.worksheets[1].name, "Sheet2");

  const stored = JSON.parse(await readFile(api.statePath, "utf8"));
  assert.equal(stored.workbooks[0].worksheets[0].name, "Sales");

  const { workbook: reopened, close } = await reopen(api);
  t.after(close);
  assert.deepEqual(reopened.worksheets.map((sheet) => sheet.name), ["Sales", "Sheet2"]);
  assert.equal(reopened.worksheets[0].cells.B2, "1200");
  assert.equal(reopened.worksheets[0].validations[0].values.join(","), "East,North");
  assert.equal(reopened.worksheets[0].filters.length, 1);
});

test("answers unknown worksheets and keeps the process serving", async (t) => {
  const api = await startApi();
  t.after(api.close);

  assert.equal((await renameWorksheet(api, "ws-missing", "Anything")).status, 404);
  assert.equal((await addWorksheet(api)).status, 201);
  assert.equal((await api.api(`/api/workbooks/missing/worksheets`, { method: "POST", body: "{}" })).status, 404);
  assert.equal((await api.api("/health")).status, 200);

  const reopened = await api.api(`/api/workbooks/${WORKBOOK}`);
  assert.deepEqual(reopened.body.workbook.worksheets.map((sheet) => sheet.name), ["Sheet1", "Sheet2", "Sheet3"]);
});

test("deletes a worksheet with its data and makes its neighbor the active one", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const removed = await deleteWorksheet(api, SHEET2);
  assert.equal(removed.status, 200);
  const workbook = removed.body.workbook;
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Sheet1"]);
  assert.equal(workbook.activeWorksheetId, SHEET1);
  // The remaining worksheet keeps every value and its own rules.
  assert.equal(workbook.worksheets[0].cells.A2, "East");
  assert.equal(workbook.worksheets[0].cells.B3, "800");
  assert.notEqual(workbook.updatedAt, SEED_TIMESTAMP);

  const { workbook: reopened, close } = await reopen(api);
  t.after(close);
  assert.deepEqual(reopened.worksheets.map((sheet) => sheet.name), ["Sheet1"]);
  assert.equal(reopened.worksheets[0].cells.A4, "South");
});

test("deletes the target's grid, rules, filters and pivot result and keeps the other worksheets", async (t) => {
  const api = await startApi();
  t.after(api.close);

  await api.api(`/api/workbooks/${WORKBOOK}/cells`, {
    method: "PUT",
    body: JSON.stringify({ worksheetId: SHEET2, cell: "A1", value: "Notes" }),
  });
  await api.api(`/api/workbooks/${WORKBOOK}/worksheets/${SHEET2}/validations`, {
    method: "POST",
    body: JSON.stringify({ type: "dropdown", range: { start: "A2", end: "A4" }, values: "East,North" }),
  });
  await api.api(`/api/workbooks/${WORKBOOK}/worksheets/${SHEET2}/filters`, {
    method: "POST",
    body: JSON.stringify({ range: { start: "A1", end: "A4" } }),
  });

  const before = await api.api(`/api/workbooks/${WORKBOOK}`);
  const target = before.body.workbook.worksheets.find((sheet) => sheet.id === SHEET2);
  assert.equal(target.cells.A1, "Notes");
  assert.equal(target.validations.length, 1);
  assert.equal(target.filters.length, 1);

  const removed = await deleteWorksheet(api, SHEET2);
  assert.equal(removed.status, 200);
  const workbook = removed.body.workbook;
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Sheet1"]);
  assert.equal(workbook.worksheets[0].cells.A1, "Region");
  assert.deepEqual(workbook.worksheets[0].validations, []);
  assert.deepEqual(workbook.worksheets[0].filters, []);

  const { workbook: reopened, close } = await reopen(api);
  t.after(close);
  assert.deepEqual(reopened.worksheets.map((sheet) => sheet.name), ["Sheet1"]);
  assert.equal(reopened.worksheets[0].cells.A1, "Region");
});

test("refuses to delete the last remaining worksheet", async (t) => {
  const api = await startApi();
  t.after(api.close);

  assert.equal((await deleteWorksheet(api, SHEET2)).status, 200);
  const refused = await deleteWorksheet(api, SHEET1);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, "A workbook must contain at least one worksheet");

  const stored = await api.api(`/api/workbooks/${WORKBOOK}`);
  assert.deepEqual(stored.body.workbook.worksheets.map((sheet) => sheet.name), ["Sheet1"]);
  assert.equal(stored.body.workbook.worksheets[0].cells.A3, "North");

  const { workbook: reopened, close } = await reopen(api);
  t.after(close);
  assert.equal(reopened.worksheets.length, 1);
  assert.equal(reopened.worksheets[0].cells.B2, "1200");
});

test("refuses to delete a pivot source until its pivot result is gone", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const pivot = await createPivot(api, SHEET1, { start: "A1", end: "C4" });
  assert.equal(pivot.status, 201);
  const pivotWorksheet = pivot.body.workbook.worksheets.find((sheet) => sheet.name === "Pivot1");
  assert.ok(pivotWorksheet);

  const refused = await deleteWorksheet(api, SHEET1);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, "Please delete or rebuild dependent pivot tables first");

  // Both the source and the pivot result are unchanged.
  const unchanged = await api.api(`/api/workbooks/${WORKBOOK}`);
  assert.deepEqual(unchanged.body.workbook.worksheets.map((sheet) => sheet.name), ["Sheet1", "Sheet2", "Pivot1"]);
  const source = unchanged.body.workbook.worksheets.find((sheet) => sheet.id === SHEET1);
  assert.equal(source.cells.A2, "East");
  const result = unchanged.body.workbook.worksheets.find((sheet) => sheet.id === pivotWorksheet.id);
  assert.equal(result.cells.A1, "Region");
  assert.equal(result.cells.B1, "SUM of Sales");

  // Deleting the pivot result frees its source worksheet.
  assert.equal((await deleteWorksheet(api, pivotWorksheet.id)).status, 200);
  const freed = await deleteWorksheet(api, SHEET1);
  assert.equal(freed.status, 200);
  assert.deepEqual(freed.body.workbook.worksheets.map((sheet) => sheet.name), ["Sheet2"]);

  const { workbook: reopened, close } = await reopen(api);
  t.after(close);
  assert.deepEqual(reopened.worksheets.map((sheet) => sheet.name), ["Sheet2"]);
});

test("answers an unknown worksheet with 404 and keeps the workbook intact", async (t) => {
  const api = await startApi();
  t.after(api.close);

  assert.equal((await deleteWorksheet(api, "ws-missing")).status, 404);
  assert.equal((await api.api(`/api/workbooks/missing/worksheets/${SHEET2}`, { method: "DELETE" })).status, 404);

  const stored = await api.api(`/api/workbooks/${WORKBOOK}`);
  assert.deepEqual(stored.body.workbook.worksheets.map((sheet) => sheet.name), ["Sheet1", "Sheet2"]);
});
