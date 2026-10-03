import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

const SEED_WORKBOOK_ID = "workbook-q3-sales";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-worksheets-"));
  const { handler } = createApp({ dataDir });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    dataDir,
    async call(path, init) {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      return { status: response.status, body };
    },
    async workbook(id) {
      const detail = await this.call(`/api/workbooks/${id}`);
      return detail.body.workbook;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function worksheetNames(workbook) {
  return workbook.worksheets.map((entry) => entry.name);
}

test("adds the first unused SheetN worksheet and makes it active and blank", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const before = await app.workbook(SEED_WORKBOOK_ID);
  const sourceCells = { ...before.worksheets[0].cells };

  const created = await app.call(`/api/workbooks/${SEED_WORKBOOK_ID}/worksheets`, {
    method: "POST",
    body: "{}",
  });
  assert.equal(created.status, 201);
  const workbook = created.body.workbook;
  assert.deepEqual(worksheetNames(workbook), ["Sheet1", "Sheet2", "Sheet3"]);

  const added = workbook.worksheets[2];
  assert.deepEqual(added.cells, {});
  assert.deepEqual(added.selection, { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } });
  assert.ok(added.rowCount > 0 && added.columnCount > 0);
  assert.equal(workbook.activeWorksheetId, added.id);

  assert.deepEqual(workbook.worksheets[0].cells, sourceCells);

  const reloaded = await app.workbook(SEED_WORKBOOK_ID);
  assert.deepEqual(worksheetNames(reloaded), ["Sheet1", "Sheet2", "Sheet3"]);
  assert.equal(reloaded.activeWorksheetId, added.id);
});

test("uses Sheet2 for a workbook that only has Sheet1 and fills name gaps", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const blank = await app.call("/api/workbooks", { method: "POST", body: "{}" });
  const blankId = blank.body.workbook.id;
  const second = await app.call(`/api/workbooks/${blankId}/worksheets`, { method: "POST", body: "{}" });
  assert.deepEqual(worksheetNames(second.body.workbook), ["Sheet1", "Sheet2"]);

  const third = await app.call(`/api/workbooks/${blankId}/worksheets`, { method: "POST", body: "{}" });
  assert.deepEqual(worksheetNames(third.body.workbook), ["Sheet1", "Sheet2", "Sheet3"]);

  const sheet2 = third.body.workbook.worksheets[1];
  const renamed = await app.call(`/api/workbooks/${blankId}/worksheets/${sheet2.id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "Data" }),
  });
  assert.equal(renamed.status, 200);

  const reused = await app.call(`/api/workbooks/${blankId}/worksheets`, { method: "POST", body: "{}" });
  assert.deepEqual(worksheetNames(reused.body.workbook), ["Sheet1", "Data", "Sheet3", "Sheet2"]);
});

test("renames a worksheet by trimming the name and persists it", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const before = await app.workbook(SEED_WORKBOOK_ID);
  const sheet2 = before.worksheets[1];

  const renamed = await app.call(`/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${sheet2.id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "  Quarterly Detail  " }),
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.worksheet.name, "Quarterly Detail");
  assert.equal(renamed.body.workbook.worksheets[1].name, "Quarterly Detail");
  assert.deepEqual(renamed.body.workbook.worksheets[1].cells, {});

  const reopened = createApp({ dataDir: app.dataDir });
  const server = createServer((request, response) => void reopened.handler(request, response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/workbooks/${SEED_WORKBOOK_ID}`);
    const body = await response.json();
    assert.deepEqual(worksheetNames(body.workbook), ["Sheet1", "Quarterly Detail"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("keeps a worksheet's own name and rejects empty or duplicate names", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const before = await app.workbook(SEED_WORKBOOK_ID);
  const sheet1 = before.worksheets[0];
  const endpoint = `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${sheet1.id}`;

  const same = await app.call(endpoint, { method: "PATCH", body: JSON.stringify({ name: "Sheet1" }) });
  assert.equal(same.status, 200);
  assert.equal(same.body.worksheet.name, "Sheet1");

  const empty = await app.call(endpoint, { method: "PATCH", body: JSON.stringify({ name: "   " }) });
  assert.equal(empty.status, 422);
  assert.equal(empty.body.error, "Worksheet name cannot be empty");

  const duplicate = await app.call(endpoint, { method: "PATCH", body: JSON.stringify({ name: "Sheet2" }) });
  assert.equal(duplicate.status, 422);
  assert.equal(duplicate.body.error, "Worksheet name already exists");

  const reloaded = await app.workbook(SEED_WORKBOOK_ID);
  assert.deepEqual(worksheetNames(reloaded), ["Sheet1", "Sheet2"]);
  assert.equal(reloaded.worksheets[0].cells.A2, "East");
});

test("returns 404 for worksheet operations on unknown workbooks or worksheets", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const missingWorkbook = await app.call("/api/workbooks/missing/worksheets", {
    method: "POST",
    body: "{}",
  });
  assert.equal(missingWorkbook.status, 404);

  const missingWorksheet = await app.call(
    `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/missing`,
    { method: "PATCH", body: JSON.stringify({ name: "Data" }) },
  );
  assert.equal(missingWorksheet.status, 404);

  const wrongMethod = await app.call(`/api/workbooks/${SEED_WORKBOOK_ID}/worksheets`);
  assert.equal(wrongMethod.status, 405);
});

test("deletes a worksheet, activates an adjacent one and persists the deletion", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const before = await app.workbook(SEED_WORKBOOK_ID);
  const [sheet1, sheet2] = before.worksheets;

  const removed = await app.call(`/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${sheet2.id}`, {
    method: "DELETE",
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(worksheetNames(removed.body.workbook), ["Sheet1"]);
  assert.equal(removed.body.workbook.activeWorksheetId, sheet1.id);
  assert.equal(removed.body.workbook.worksheets[0].cells.A2, "East");

  const reloaded = await app.workbook(SEED_WORKBOOK_ID);
  assert.deepEqual(worksheetNames(reloaded), ["Sheet1"]);
  assert.equal(reloaded.activeWorksheetId, sheet1.id);
  assert.equal(reloaded.worksheets[0].cells.B2, "1200");
});

async function createPivotWorkbook(app) {
  const before = await app.workbook(SEED_WORKBOOK_ID);
  const source = before.worksheets[0];
  const created = await app.call(`/api/workbooks/${SEED_WORKBOOK_ID}/pivots`, {
    method: "POST",
    body: JSON.stringify({
      action: "create",
      sourceWorksheetId: source.id,
      range: { minRow: 0, maxRow: 3, minCol: 0, maxCol: 2 },
    }),
  });
  assert.equal(created.status, 201);
  return created.body.workbook;
}

test("rejects deleting a pivot-table source worksheet and keeps both worksheets", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const withPivot = await createPivotWorkbook(app);
  const source = withPivot.worksheets[0];
  const pivotSheet = withPivot.worksheets[2];
  assert.equal(pivotSheet.name, "Pivot1");
  const pivotCells = { ...pivotSheet.cells };

  const rejected = await app.call(
    `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${source.id}`,
    { method: "DELETE" },
  );
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error, "Please delete or rebuild dependent pivot tables first");

  const reloaded = await app.workbook(SEED_WORKBOOK_ID);
  assert.deepEqual(worksheetNames(reloaded), ["Sheet1", "Sheet2", "Pivot1"]);
  assert.equal(reloaded.worksheets[0].cells.A2, "East");
  assert.deepEqual(reloaded.worksheets[2].cells, pivotCells);
  assert.equal(reloaded.pivots.length, 1);
});

test("deletes a pivot result worksheet and frees its source worksheet", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const withPivot = await createPivotWorkbook(app);
  const source = withPivot.worksheets[0];
  const pivotSheet = withPivot.worksheets[2];

  const removedPivot = await app.call(
    `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${pivotSheet.id}`,
    { method: "DELETE" },
  );
  assert.equal(removedPivot.status, 200);
  assert.deepEqual(worksheetNames(removedPivot.body.workbook), ["Sheet1", "Sheet2"]);
  assert.deepEqual(removedPivot.body.workbook.pivots, []);

  const removedSource = await app.call(
    `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${source.id}`,
    { method: "DELETE" },
  );
  assert.equal(removedSource.status, 200);
  assert.deepEqual(worksheetNames(removedSource.body.workbook), ["Sheet2"]);
  assert.equal(removedSource.body.workbook.activeWorksheetId, withPivot.worksheets[1].id);
});

test("rejects deleting the last remaining worksheet", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const blank = await app.call("/api/workbooks", { method: "POST", body: "{}" });
  const workbookId = blank.body.workbook.id;
  const only = blank.body.workbook.worksheets[0];

  const rejected = await app.call(`/api/workbooks/${workbookId}/worksheets/${only.id}`, {
    method: "DELETE",
  });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error, "A workbook must contain at least one worksheet");

  const reloaded = await app.workbook(workbookId);
  assert.equal(reloaded.worksheets.length, 1);
  assert.equal(reloaded.activeWorksheetId, only.id);
});

test("returns 404 when deleting an unknown worksheet", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const missing = await app.call(
    `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/missing`,
    { method: "DELETE" },
  );
  assert.equal(missing.status, 404);

  const reloaded = await app.workbook(SEED_WORKBOOK_ID);
  assert.deepEqual(worksheetNames(reloaded), ["Sheet1", "Sheet2"]);
});

test("keeps worksheet grids independent across a reload", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const before = await app.workbook(SEED_WORKBOOK_ID);
  const [sheet1, sheet2] = before.worksheets;
  assert.equal(sheet1.cells.A2, "East");
  assert.deepEqual(sheet2.cells, {});

  await app.call(`/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${sheet2.id}`, {
    method: "PATCH",
    body: JSON.stringify({ selection: { anchor: { row: 3, col: 2 }, focus: { row: 3, col: 2 } } }),
  });

  const reloaded = await app.workbook(SEED_WORKBOOK_ID);
  assert.equal(reloaded.worksheets[0].cells.A2, "East");
  assert.deepEqual(reloaded.worksheets[0].selection, { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } });
  assert.deepEqual(reloaded.worksheets[1].cells, {});
  assert.deepEqual(reloaded.worksheets[1].selection, { anchor: { row: 3, col: 2 }, focus: { row: 3, col: 2 } });
});
