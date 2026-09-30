import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { SEED_SECOND_WORKSHEET_ID, SEED_WORKBOOK_ID, SEED_WORKSHEET_ID } from "../src/lib/seed.mjs";
import { createWorkbookRepository } from "../src/lib/workbook-store.mjs";

async function startTestServer() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-worksheets-"));
  const repository = createWorkbookRepository(directory);
  const server = createServer(createApp(repository));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function getWorkbook(base, id = SEED_WORKBOOK_ID) {
  const response = await fetch(`${base}/api/workbooks/${id}`);
  return (await response.json()).workbook;
}

function jsonRequest(base, path, method, payload) {
  return fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

const sheetPath = (workbookId = SEED_WORKBOOK_ID, worksheetId = SEED_WORKSHEET_ID) =>
  `/api/workbooks/${workbookId}/worksheets/${worksheetId}`;

const addWorksheet = (base, workbookId = SEED_WORKBOOK_ID) =>
  jsonRequest(base, `/api/workbooks/${workbookId}/worksheets`, "POST");

const renameWorksheet = (base, worksheetId, name, workbookId = SEED_WORKBOOK_ID) =>
  jsonRequest(base, sheetPath(workbookId, worksheetId), "PATCH", { name });

const deleteWorksheet = (base, worksheetId, workbookId = SEED_WORKBOOK_ID) =>
  jsonRequest(base, sheetPath(workbookId, worksheetId), "DELETE");

test("seeds the Q3 Sales workbook with Sheet1 holding the range and a blank Sheet2", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const workbook = await getWorkbook(server.base);
  assert.deepEqual(
    workbook.worksheets.map((worksheet) => worksheet.name),
    ["Sheet1", "Sheet2"],
  );
  assert.equal(workbook.activeWorksheetId, SEED_WORKSHEET_ID);
  assert.equal(workbook.worksheets[0].cells.A2.value, "East");
  assert.equal(workbook.worksheets[0].cells.B2.value, "1200");
  assert.equal(workbook.worksheets[0].cells.A3.value, "North");
  assert.equal(workbook.worksheets[0].cells.B3.value, "800");

  const second = workbook.worksheets[1];
  assert.equal(second.id, SEED_SECOND_WORKSHEET_ID);
  assert.deepEqual(second.cells, {});
  assert.deepEqual(second.validations, []);
  assert.equal(second.filter ?? null, null);
});

test("creates the next SheetN worksheet, blank, active and persisted", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await addWorksheet(server.base);
  assert.equal(created.status, 201);
  const workbook = (await created.json()).workbook;
  assert.deepEqual(
    workbook.worksheets.map((worksheet) => worksheet.name),
    ["Sheet1", "Sheet2", "Sheet3"],
  );
  const added = workbook.worksheets[2];
  assert.deepEqual(added.cells, {});
  assert.equal(workbook.activeWorksheetId, added.id);
  assert.equal(added.selection.anchor.row, 1);
  assert.equal(added.selection.anchor.column, 1);
  // The existing worksheets keep their data and structure.
  assert.equal(workbook.worksheets[0].cells.A1.value, "Region");
  assert.equal(workbook.worksheets[1].name, "Sheet2");

  const reopened = await getWorkbook(server.base);
  assert.deepEqual(
    reopened.worksheets.map((worksheet) => worksheet.name),
    ["Sheet1", "Sheet2", "Sheet3"],
  );
  assert.equal(reopened.activeWorksheetId, added.id);
});

test("fills the first unused SheetN when the seeded names leave a gap", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  // Sheet2 is renamed away, so Sheet2 becomes the first unused name again.
  const renamed = await renameWorksheet(server.base, SEED_SECOND_WORKSHEET_ID, "Data");
  assert.equal(renamed.status, 200);

  const created = await addWorksheet(server.base);
  const workbook = (await created.json()).workbook;
  assert.deepEqual(
    workbook.worksheets.map((worksheet) => worksheet.name),
    ["Sheet1", "Data", "Sheet2"],
  );
});

test("starts the numbering at Sheet1 in a workbook with no SheetN name", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await jsonRequest(server.base, "/api/workbooks", "POST", { name: "Fresh" });
  const workbook = (await created.json()).workbook;
  assert.deepEqual(
    workbook.worksheets.map((worksheet) => worksheet.name),
    ["Sheet1"],
  );

  const added = await addWorksheet(server.base, workbook.id);
  const next = (await added.json()).workbook;
  assert.deepEqual(
    next.worksheets.map((worksheet) => worksheet.name),
    ["Sheet1", "Sheet2"],
  );
});

test("a new worksheet inherits neither data, filter views, validation rules nor selections", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const filter = await jsonRequest(server.base, `${sheetPath()}/filter`, "PUT", {
    region: { top: 1, bottom: 4, left: 1, right: 3 },
    columns: [{ column: 3, kind: "values", selected: ["Open"] }],
  });
  assert.equal(filter.status, 200);
  const rule = await jsonRequest(server.base, `${sheetPath()}/validations`, "PUT", {
    range: "B2:B4",
    type: "numberRange",
    min: 0,
    max: 100,
  });
  assert.equal(rule.status, 200);
  const selection = await jsonRequest(server.base, sheetPath(), "PATCH", {
    selection: { anchor: { row: 2, column: 2 }, focus: { row: 4, column: 2 } },
  });
  assert.equal(selection.status, 200);

  const created = await addWorksheet(server.base);
  const workbook = (await created.json()).workbook;
  const added = workbook.worksheets[2];
  assert.deepEqual(added.cells, {});
  assert.deepEqual(added.validations, []);
  assert.equal(added.filter ?? null, null);
  assert.deepEqual(added.selection, { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } });

  // The source worksheet still owns its data, rule and filter view.
  const source = workbook.worksheets[0];
  assert.equal(source.cells.A2.value, "East");
  assert.equal(source.filter.columns[0].selected[0], "Open");
  assert.equal(source.validations.length, 1);
});

test("writes to a new worksheet without touching the other worksheets", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const { workbook } = await (await addWorksheet(server.base)).json();
  const added = workbook.worksheets[2];

  const written = await jsonRequest(
    server.base,
    `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${added.id}/cells/A1`,
    "PUT",
    { value: "New sheet" },
  );
  assert.equal(written.status, 200);

  const stored = await getWorkbook(server.base);
  assert.equal(stored.worksheets[2].cells.A1.value, "New sheet");
  assert.equal(stored.worksheets[0].cells.A1.value, "Region");
  assert.equal(stored.worksheets[1].cells.A1, undefined);
});

test("renames a worksheet, trims the name and keeps it after reopening", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const response = await renameWorksheet(server.base, SEED_WORKSHEET_ID, "  Q3 Regions  ");
  assert.equal(response.status, 200);
  const workbook = (await response.json()).workbook;
  assert.deepEqual(
    workbook.worksheets.map((worksheet) => worksheet.name),
    ["Q3 Regions", "Sheet2"],
  );
  assert.equal(workbook.activeWorksheetId, SEED_WORKSHEET_ID);
  assert.equal(workbook.worksheets[0].cells.A2.value, "East");

  const reopened = await getWorkbook(server.base);
  assert.equal(reopened.worksheets[0].name, "Q3 Regions");
});

test("rejects an empty worksheet name and keeps the stored name", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  for (const name of ["", "   ", null]) {
    const response = await renameWorksheet(server.base, SEED_SECOND_WORKSHEET_ID, name);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "Worksheet name cannot be empty");
  }

  const reopened = await getWorkbook(server.base);
  assert.equal(reopened.worksheets[1].name, "Sheet2");
});

test("rejects a worksheet name already used in the same workbook", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const response = await renameWorksheet(server.base, SEED_SECOND_WORKSHEET_ID, "Sheet1");
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Worksheet name already exists");

  const spaced = await renameWorksheet(server.base, SEED_SECOND_WORKSHEET_ID, "  sheet1 ");
  assert.equal(spaced.status, 400);
  assert.equal((await spaced.json()).error, "Worksheet name already exists");

  const reopened = await getWorkbook(server.base);
  assert.deepEqual(
    reopened.worksheets.map((worksheet) => worksheet.name),
    ["Sheet1", "Sheet2"],
  );
});

test("accepts renaming a worksheet to its own name", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const response = await renameWorksheet(server.base, SEED_SECOND_WORKSHEET_ID, "Sheet2");
  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).workbook.worksheets.map((worksheet) => worksheet.name),
    ["Sheet1", "Sheet2"],
  );
});

test("answers 404 for worksheet operations of an unknown workbook", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await addWorksheet(server.base, "wb_missing");
  assert.equal(created.status, 404);

  const renamed = await jsonRequest(
    server.base,
    "/api/workbooks/wb_missing/worksheets/ws_missing",
    "PATCH",
    { name: "Sheet1" },
  );
  assert.equal(renamed.status, 404);
});

test("renaming an unknown worksheet of a known workbook answers 404", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const response = await renameWorksheet(server.base, "ws_missing", "Other");
  assert.equal(response.status, 404);
});

test("keeps the selection endpoint working next to the rename payload", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const response = await jsonRequest(server.base, sheetPath(SEED_WORKBOOK_ID, SEED_SECOND_WORKSHEET_ID), "PATCH", {
    selection: { anchor: { row: 3, column: 2 }, focus: { row: 3, column: 2 } },
  });
  assert.equal(response.status, 200);
  const workbook = (await response.json()).workbook;
  assert.deepEqual(workbook.worksheets[1].selection, {
    anchor: { row: 3, column: 2 },
    focus: { row: 3, column: 2 },
  });
  assert.equal(workbook.worksheets[1].name, "Sheet2");
});

test("deletes the active worksheet with its data and activates an adjacent one", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  await jsonRequest(server.base, `${sheetPath(SEED_WORKBOOK_ID, SEED_SECOND_WORKSHEET_ID)}/cells/A1`, "PUT", {
    value: "Only here",
  });
  await jsonRequest(server.base, `${sheetPath(SEED_WORKBOOK_ID, SEED_SECOND_WORKSHEET_ID)}/validations`, "PUT", {
    range: "A1:A2",
    type: "numberRange",
    min: 0,
    max: 10,
  });
  await jsonRequest(server.base, `/api/workbooks/${SEED_WORKBOOK_ID}`, "PATCH", {
    activeWorksheetId: SEED_SECOND_WORKSHEET_ID,
  });

  const deleted = await deleteWorksheet(server.base, SEED_SECOND_WORKSHEET_ID);
  assert.equal(deleted.status, 200);
  const payload = await deleted.json();
  assert.deepEqual(
    payload.workbook.worksheets.map((worksheet) => worksheet.name),
    ["Sheet1"],
  );
  assert.equal(payload.workbook.activeWorksheetId, SEED_WORKSHEET_ID);
  assert.equal(payload.workbook.worksheets[0].cells.A2.value, "East");
  // The history of the removed worksheet is dropped with it.
  assert.equal(payload.canUndo, false);

  const reopened = await getWorkbook(server.base);
  assert.deepEqual(
    reopened.worksheets.map((worksheet) => worksheet.name),
    ["Sheet1"],
  );
  assert.equal(reopened.activeWorksheetId, SEED_WORKSHEET_ID);
});

test("deletes an inactive worksheet without changing the active worksheet", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const deleted = await deleteWorksheet(server.base, SEED_SECOND_WORKSHEET_ID);
  assert.equal(deleted.status, 200);
  const workbook = (await deleted.json()).workbook;
  assert.deepEqual(
    workbook.worksheets.map((worksheet) => worksheet.name),
    ["Sheet1"],
  );
  assert.equal(workbook.activeWorksheetId, SEED_WORKSHEET_ID);
});

test("refuses to delete the last worksheet of the workbook", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  assert.equal((await deleteWorksheet(server.base, SEED_SECOND_WORKSHEET_ID)).status, 200);
  const refused = await deleteWorksheet(server.base, SEED_WORKSHEET_ID);
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).error, "A workbook must contain at least one worksheet");

  const stored = await getWorkbook(server.base);
  assert.deepEqual(
    stored.worksheets.map((worksheet) => worksheet.name),
    ["Sheet1"],
  );
  assert.equal(stored.worksheets[0].cells.A2.value, "East");
});

test("refuses to delete a worksheet a pivot table still reads and releases it afterwards", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const pivot = await jsonRequest(server.base, `/api/workbooks/${SEED_WORKBOOK_ID}/pivots`, "POST", {
    sourceWorksheetId: SEED_WORKSHEET_ID,
    sourceRange: "A1:C4",
  });
  assert.equal(pivot.status, 201);
  const pivotId = (await pivot.json()).workbook.worksheets[2].id;
  const applied = await jsonRequest(server.base, `${sheetPath(SEED_WORKBOOK_ID, pivotId)}/pivot`, "PUT", {
    rows: "Region",
    values: "Sales",
    summarizeBy: "SUM",
  });
  assert.equal(applied.status, 200);

  const before = await getWorkbook(server.base);
  const sourceCells = JSON.stringify(before.worksheets[0].cells);
  const pivotCells = JSON.stringify(before.worksheets[2].cells);

  const refused = await deleteWorksheet(server.base, SEED_WORKSHEET_ID);
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).error, "Please delete or rebuild dependent pivot tables first");

  const stored = await getWorkbook(server.base);
  assert.deepEqual(
    stored.worksheets.map((worksheet) => worksheet.name),
    ["Sheet1", "Sheet2", "Pivot1"],
  );
  assert.equal(JSON.stringify(stored.worksheets[0].cells), sourceCells);
  assert.equal(JSON.stringify(stored.worksheets[2].cells), pivotCells);

  // Deleting the pivot result releases the source worksheet.
  assert.equal((await deleteWorksheet(server.base, pivotId)).status, 200);
  const released = await deleteWorksheet(server.base, SEED_WORKSHEET_ID);
  assert.equal(released.status, 200);
  const after = (await released.json()).workbook;
  assert.deepEqual(
    after.worksheets.map((worksheet) => worksheet.name),
    ["Sheet2"],
  );
  assert.equal(after.activeWorksheetId, SEED_SECOND_WORKSHEET_ID);
});

test("answers 404 when deleting a worksheet of an unknown workbook or an unknown worksheet", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  assert.equal((await deleteWorksheet(server.base, "ws_missing")).status, 404);
  assert.equal((await deleteWorksheet(server.base, SEED_WORKSHEET_ID, "wb_missing")).status, 404);

  const stored = await getWorkbook(server.base);
  assert.deepEqual(
    stored.worksheets.map((worksheet) => worksheet.name),
    ["Sheet1", "Sheet2"],
  );
});
