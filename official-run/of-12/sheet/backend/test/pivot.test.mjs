import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";
import { createInitialState } from "../src/lib/seed.mjs";

/** Starts the real request handler against a temporary state file. */
async function startApi(mutateState) {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-pivot-"));
  const statePath = join(directory, "workbooks.json");
  const state = createInitialState();
  if (mutateState) mutateState(state);
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

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
    api,
    async restart() {
      const restarted = createJsonStore(statePath, createInitialState());
      const newHandler = createRequestHandler({ store: restarted, staticRoot: join(directory, "no-dist") });
      const newServer = createServer(newHandler);
      await new Promise((resolve) => newServer.listen(0, "127.0.0.1", resolve));
      const { port: newPort } = newServer.address();
      return {
        get: async (path) => {
          const response = await fetch(`http://127.0.0.1:${newPort}${path}`);
          return { status: response.status, body: await response.json() };
        },
        close: async () => {
          newServer.closeAllConnections?.();
          await new Promise((resolve) => newServer.close(resolve));
        },
      };
    },
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const SHEET1 = "ws-q3-sales-sheet1";

function sheet(workbook, id) {
  return workbook.worksheets.find((item) => item.id === id);
}

const request = (api) => ({
  createPivot: (range) => api.api(`/api/workbooks/wb-q3-sales/worksheets/${SHEET1}/pivot`, {
    method: "POST",
    body: JSON.stringify({ range }),
  }),
  applyPivot: (worksheetId, settings) => api.api(`/api/workbooks/wb-q3-sales/worksheets/${worksheetId}/pivot`, {
    method: "PUT",
    body: JSON.stringify(settings),
  }),
  refreshPivot: (worksheetId) =>
    api.api(`/api/workbooks/wb-q3-sales/worksheets/${worksheetId}/pivot/refresh`, { method: "POST", body: "{}" }),
  deleteColumn: (column) => api.api(`/api/workbooks/wb-q3-sales/worksheets/${SHEET1}/columns`, {
    method: "POST",
    body: JSON.stringify({ action: "delete", column }),
  }),
  cell: (worksheetId, cell, value) => api.api("/api/workbooks/wb-q3-sales/cells", {
    method: "PUT",
    body: JSON.stringify({ worksheetId, cell, value }),
  }),
});

test("creates Pivot1 from the seeded range with the default summary and keeps the source intact", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const run = request(api);

  const created = await run.createPivot({ start: "A1", end: "C4" });
  assert.equal(created.status, 201);
  const workbook = created.body.workbook;
  assert.equal(workbook.worksheets.length, 3);
  const pivot = workbook.worksheets[2];
  assert.equal(pivot.name, "Pivot1");
  assert.equal(workbook.activeWorksheetId, pivot.id);
  assert.deepEqual(pivot.pivot, {
    source: { worksheetId: SHEET1, range: { start: "A1", end: "C4" } },
    rows: "Region",
    columns: null,
    values: "Sales",
    summarizeBy: "SUM",
  });
  assert.equal(pivot.cells.A1, "Region");
  assert.equal(pivot.cells.B1, "SUM of Sales");
  // Row groups follow the order of first appearance and the final row is the Grand Total.
  assert.deepEqual(
    ["A2", "B2", "A3", "B3", "A4", "B4", "A5", "B5"].map((coordinate) => pivot.cells[coordinate]),
    ["East", "1200", "North", "800", "South", "700", "Grand Total", "2700"],
  );
  // The source worksheet keeps every value and its order.
  const source = sheet(workbook, SHEET1);
  assert.equal(source.cells.A2, "East");
  assert.equal(source.cells.C4, "Open");
  assert.equal(source.pivot, null);

  const second = await run.createPivot({ start: "A1", end: "C4" });
  assert.equal(second.body.workbook.worksheets[3].name, "Pivot2");
});

test("apply replaces the summary: COUNT counts records, AVERAGE averages and a column field adds Grand Total columns", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const run = request(api);

  const created = await run.createPivot({ start: "A1", end: "C4" });
  const pivotId = created.body.workbook.worksheets[2].id;

  const counted = await run.applyPivot(pivotId, { rows: "Region", values: "Sales", summarizeBy: "COUNT" });
  assert.equal(counted.status, 200);
  const countCells = sheet(counted.body.workbook, pivotId).cells;
  assert.equal(countCells.B1, "COUNT of Sales");
  assert.equal(countCells.B2, "1");
  assert.equal(countCells.B5, "3");

  const averaged = await run.applyPivot(pivotId, { rows: "Region", values: "Sales", summarizeBy: "AVERAGE" });
  const averageCells = sheet(averaged.body.workbook, pivotId).cells;
  assert.equal(averageCells.B1, "AVERAGE of Sales");
  assert.equal(averageCells.B2, "1200");
  assert.equal(averageCells.B5, "900");

  const withColumns = await run.applyPivot(pivotId, {
    rows: "Region",
    columns: "Status",
    values: "Sales",
    summarizeBy: "SUM",
  });
  assert.equal(withColumns.status, 200);
  const columnsCells = sheet(withColumns.body.workbook, pivotId).cells;
  // A combination without any qualifying record summarizes to 0 for every method.
  assert.deepEqual(
    ["A1", "B1", "C1", "D1", "A2", "B2", "C2", "D2", "A5", "B5", "C5", "D5"].map((cell) => columnsCells[cell]),
    ["Region", "Open", "Closed", "Grand Total", "East", "1200", "0", "1200", "Grand Total", "1900", "800", "2700"],
  );

  // The configuration survives a re-read of the stored workbook.
  const refreshed = await run.refreshPivot(pivotId);
  assert.deepEqual(sheet(refreshed.body.workbook, pivotId).pivot.columns, "Status");
  assert.equal(sheet(refreshed.body.workbook, pivotId).cells.D5, "2700");
  assert.equal(sheet(refreshed.body.workbook, SHEET1).cells.B2, "1200");
});

test("COUNT reports 0 for a row/column combination without a qualifying record", async (t) => {
  const api = await startApi((state) => {
    const worksheet = state.workbooks[0].worksheets[0];
    worksheet.cells.A5 = "East";
    worksheet.cells.B5 = "100";
    worksheet.cells.C5 = "Closed";
  });
  t.after(api.close);
  const run = request(api);

  const created = await run.createPivot({ start: "A1", end: "C5" });
  const pivotId = created.body.workbook.worksheets[2].id;
  const applied = await run.applyPivot(pivotId, {
    rows: "Region",
    columns: "Status",
    values: "Sales",
    summarizeBy: "COUNT",
  });
  const cells = sheet(applied.body.workbook, pivotId).cells;
  // East has an Open and a Closed record, North has Closed only, South has Open only.
  assert.deepEqual(
    ["A2", "B2", "C2", "A3", "B3", "C3", "A4", "B4", "C4", "A5", "B5", "C5", "D5"].map((cell) => cells[cell]),
    ["East", "1", "1", "North", "0", "1", "South", "1", "0", "Grand Total", "2", "2", "4"],
  );
});

test("refreshes after the source moved and refuses a deleted field, keeping the last result", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const run = request(api);

  const created = await run.createPivot({ start: "A1", end: "C4" });
  const pivotId = created.body.workbook.worksheets[2].id;

  // Inserting a row above the source shifts the stored source range; the result stays untouched.
  await api.api(`/api/workbooks/wb-q3-sales/worksheets/${SHEET1}/rows`, {
    method: "POST",
    body: JSON.stringify({ action: "insert-above", row: 1 }),
  });
  const beforeRefresh = await api.api("/api/workbooks/wb-q3-sales");
  assert.deepEqual(sheet(beforeRefresh.body.workbook, pivotId).pivot.source.range, { start: "A2", end: "C5" });
  assert.equal(sheet(beforeRefresh.body.workbook, pivotId).cells.B5, "2700");

  const refreshed = await run.refreshPivot(pivotId);
  assert.equal(refreshed.status, 200);
  assert.equal(sheet(refreshed.body.workbook, pivotId).cells.A2, "East");

  // Deleting the value column removes a selected header: the refresh is refused, the old result and
  // both worksheets stay as they were.
  await run.deleteColumn("B");
  const refused = await run.refreshPivot(pivotId);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, "Pivot field is no longer available. Select a new field.");
  const after = await api.api("/api/workbooks/wb-q3-sales");
  assert.equal(sheet(after.body.workbook, pivotId).cells.B5, "2700");
  assert.equal(sheet(after.body.workbook, pivotId).cells.A2, "East");
  // Only the deleted column is gone: the records that stayed keep their rows and their values.
  assert.equal(sheet(after.body.workbook, SHEET1).cells.A2, "Region");
  assert.equal(sheet(after.body.workbook, SHEET1).cells.A3, "East");
  assert.equal(sheet(after.body.workbook, SHEET1).cells.B2, "Status");
});

test("refuses SUM and AVERAGE on a value field without parseable numbers", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const run = request(api);

  const created = await run.createPivot({ start: "A1", end: "C4" });
  const pivotId = created.body.workbook.worksheets[2].id;

  for (const method of ["SUM", "AVERAGE"]) {
    const refused = await run.applyPivot(pivotId, {
      rows: "Region",
      columns: null,
      values: "Status",
      summarizeBy: method,
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, "Value field requires numeric values");
  }
  const after = await api.api("/api/workbooks/wb-q3-sales");
  // The last successful result is preserved and the source worksheet is not modified.
  assert.equal(sheet(after.body.workbook, pivotId).cells.B1, "SUM of Sales");
  assert.equal(sheet(after.body.workbook, pivotId).cells.B5, "2700");
  assert.equal(sheet(after.body.workbook, SHEET1).cells.B2, "1200");

  // Counting a text column is fine: only non-empty records are counted.
  const counted = await run.applyPivot(pivotId, { rows: "Region", values: "Status", summarizeBy: "COUNT" });
  assert.equal(counted.status, 200);
  assert.equal(sheet(counted.body.workbook, pivotId).cells.B1, "COUNT of Status");
  assert.equal(sheet(counted.body.workbook, pivotId).cells.B5, "3");
});

test("keeps the pivot worksheet, its configuration and its result after a restart", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const run = request(api);

  const created = await run.createPivot({ start: "A1", end: "C4" });
  const pivotId = created.body.workbook.worksheets[2].id;
  await run.applyPivot(pivotId, { rows: "Region", columns: "Status", values: "Sales", summarizeBy: "AVERAGE" });

  const restarted = await api.restart();
  t.after(restarted.close);
  const reopened = await restarted.get("/api/workbooks/wb-q3-sales");
  const pivot = sheet(reopened.body.workbook, pivotId);
  assert.equal(pivot.name, "Pivot1");
  assert.equal(reopened.body.workbook.activeWorksheetId, pivotId);
  assert.equal(pivot.pivot.summarizeBy, "AVERAGE");
  assert.equal(pivot.pivot.columns, "Status");
  assert.equal(pivot.cells.B1, "Open");
  assert.equal(pivot.cells.D1, "Grand Total");
  assert.equal(pivot.cells.D5, "900");
  const source = sheet(reopened.body.workbook, SHEET1);
  assert.equal(source.cells.A2, "East");
  assert.equal(source.cells.A4, "South");
});

test("recomputes the summary from the current source values on refresh", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const run = request(api);

  const created = await run.createPivot({ start: "A1", end: "C4" });
  const pivotId = created.body.workbook.worksheets[2].id;

  // A later edit of the source is only reflected by an explicit refresh.
  await run.cell(SHEET1, "B3", "1000");
  const stale = await api.api("/api/workbooks/wb-q3-sales");
  assert.equal(sheet(stale.body.workbook, pivotId).cells.B5, "2700");

  const refreshed = await run.refreshPivot(pivotId);
  assert.equal(refreshed.status, 200);
  assert.equal(sheet(refreshed.body.workbook, pivotId).cells.B5, "2900");
  assert.equal(sheet(refreshed.body.workbook, SHEET1).cells.B3, "1000");
});
