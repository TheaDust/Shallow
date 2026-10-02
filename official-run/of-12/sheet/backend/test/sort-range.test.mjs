import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";
import { createInitialState } from "../src/lib/seed.mjs";
import { planRangeSort } from "../src/lib/sort-range.mjs";

/** Starts the real request handler against a temporary state file. */
async function startApi(mutateState) {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-sort-"));
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
const SHEET2 = "ws-q3-sales-sheet2";

function sheet1(workbook) {
  return workbook.worksheets.find((sheet) => sheet.id === SHEET1);
}

function column(workbook, letter, rows = [2, 3, 4]) {
  return rows.map((row) => sheet1(workbook).cells[`${letter}${row}`]);
}

function request(api) {
  return {
    sort: (body) => api.api(`/api/workbooks/wb-q3-sales/worksheets/${SHEET1}/sort-range`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    cell: (cell, value) => api.api("/api/workbooks/wb-q3-sales/cells", {
      method: "PUT",
      body: JSON.stringify({ worksheetId: SHEET1, cell, value }),
    }),
    get: () => api.api("/api/workbooks/wb-q3-sales"),
  };
}

test("sorts the seeded range by a column, keeps the declared header row and persists the order", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const run = request(api);

  const sorted = await run.sort({
    range: { start: "A1", end: "C4" },
    column: "B",
    order: "ascending",
    hasHeaderRow: true,
  });
  assert.equal(sorted.status, 200);
  const cells = sheet1(sorted.body.workbook).cells;
  // The header row stays, the records keep each other's company and are ordered by Sales.
  assert.equal(cells.A1, "Region");
  assert.equal(cells.B1, "Sales");
  assert.equal(cells.C1, "Status");
  assert.deepEqual(column(sorted.body.workbook, "A"), ["South", "North", "East"]);
  assert.deepEqual(column(sorted.body.workbook, "B"), ["700", "800", "1200"]);
  assert.deepEqual(column(sorted.body.workbook, "C"), ["Open", "Closed", "Open"]);

  const restarted = await api.restart();
  t.after(restarted.close);
  const reopened = await restarted.get("/api/workbooks/wb-q3-sales");
  assert.deepEqual(column(reopened.body.workbook, "A"), ["South", "North", "East"]);
  assert.equal(sheet1(reopened.body.workbook).cells.B4, "1200");
});

test("sorts descending, compares numbers numerically and keeps equal keys in their original order", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const run = request(api);

  const descending = await run.sort({
    range: { start: "A1", end: "C4" },
    column: "B",
    order: "descending",
    hasHeaderRow: true,
  });
  assert.equal(descending.status, 200);
  assert.deepEqual(column(descending.body.workbook, "B"), ["1200", "800", "700"]);
  // 1200 > 800 numerically, even though "1200" < "800" as text.
  assert.deepEqual(column(descending.body.workbook, "A"), ["East", "North", "South"]);

  const ascending = await run.sort({
    range: { start: "A1", end: "C4" },
    column: "B",
    order: "ascending",
    hasHeaderRow: true,
  });
  assert.deepEqual(column(ascending.body.workbook, "B"), ["700", "800", "1200"]);

  // The two `Open` records keep their relative (current) order after a sort by Status.
  const byStatus = await run.sort({
    range: { start: "A1", end: "C4" },
    column: "C",
    order: "ascending",
    hasHeaderRow: true,
  });
  assert.deepEqual(column(byStatus.body.workbook, "C"), ["Closed", "Open", "Open"]);
  assert.deepEqual(column(byStatus.body.workbook, "A"), ["North", "South", "East"]);
});

test("declares the header row only when asked and never touches data outside the selection", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const run = request(api);

  // A cell and a row outside the sorted range.
  await run.cell("E1", "Keep");
  await run.cell("A6", "Note");

  const sorted = await run.sort({
    range: { start: "A1", end: "C4" },
    column: "A",
    order: "descending",
    hasHeaderRow: false,
  });
  assert.equal(sorted.status, 200);
  const cells = sheet1(sorted.body.workbook).cells;
  // Without a declared header the first row of the range takes part in the sort.
  assert.deepEqual([cells.A1, cells.A2, cells.A3, cells.A4], ["South", "Region", "North", "East"]);
  assert.equal(cells.B1, "700");
  assert.equal(cells.B2, "Sales");
  assert.equal(cells.A5, undefined);
  assert.equal(cells.E1, "Keep");
  assert.equal(cells.A6, "Note");
  assert.equal(cells.B3, "800");
});

test("compares parseable dates chronologically and leaves the other worksheet alone", async (t) => {
  const api = await startApi((state) => {
    const sheet = state.workbooks[0].worksheets.find((item) => item.id === SHEET1);
    sheet.cells = {
      A1: "When", B1: "Amount", C1: "Label",
      A2: "2026-03-05", B2: "1", C2: "later",
      A3: "2026-01-02", B3: "2", C3: "earlier",
      A4: "2025-12-31", B4: "3", C4: "oldest",
    };
    state.workbooks[0].worksheets.find((item) => item.id === SHEET2).cells = { A1: "Untouched" };
  });
  t.after(api.close);
  const run = request(api);

  const sorted = await run.sort({
    range: { start: "A1", end: "C4" },
    column: "A",
    order: "ascending",
    hasHeaderRow: true,
  });
  assert.equal(sorted.status, 200);
  assert.deepEqual(column(sorted.body.workbook, "C"), ["oldest", "earlier", "later"]);
  assert.equal(sheet1(sorted.body.workbook).cells.A1, "When");

  const other = sorted.body.workbook.worksheets.find((sheet) => sheet.id === SHEET2);
  assert.deepEqual(other.cells, { A1: "Untouched" });
});

test("moves a whole record with its formula and refuses an invalid column without writing", async (t) => {
  const api = await startApi((state) => {
    const sheet = state.workbooks[0].worksheets.find((item) => item.id === SHEET1);
    sheet.cells = {
      A1: "Region", B1: "Sales", C1: "Total",
      A2: "East", B2: "300", C2: "=B2*2",
      A3: "North", B3: "100", C3: "=B3*2",
      A4: "South", B4: "200", C4: "=B4*2",
    };
  });
  t.after(api.close);
  const run = request(api);

  const refused = await run.sort({
    range: { start: "A1", end: "C4" },
    column: "H",
    order: "ascending",
    hasHeaderRow: true,
  });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, "Invalid sort column");
  const unchanged = await run.get();
  assert.deepEqual(column(unchanged.body.workbook, "A"), ["East", "North", "South"]);
  assert.equal(sheet1(unchanged.body.workbook).cells.C2, "=B2*2");

  const badOrder = await run.sort({
    range: { start: "A1", end: "C4" },
    column: "B",
    order: "sideways",
    hasHeaderRow: true,
  });
  assert.equal(badOrder.status, 400);
  assert.equal(badOrder.body.error, "Unsupported sort order");

  const badRange = await run.sort({
    range: { start: "nope", end: "C4" },
    column: "B",
    order: "ascending",
    hasHeaderRow: true,
  });
  assert.equal(badRange.status, 400);
  assert.equal(badRange.body.error, "Invalid range");

  const sorted = await run.sort({
    range: { start: "A1", end: "C4" },
    column: "B",
    order: "ascending",
    hasHeaderRow: true,
  });
  assert.equal(sorted.status, 200);
  const cells = sheet1(sorted.body.workbook).cells;
  // North/100 moved from row 3 to row 2, so its formula follows the row offset.
  assert.deepEqual(column(sorted.body.workbook, "A"), ["North", "South", "East"]);
  assert.equal(cells.C2, "=B2*2");
  assert.equal(cells.C3, "=B3*2");
  assert.equal(cells.C4, "=B4*2");
});

test("sorts a range outside the seeded data one column at a time without expanding it", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const run = request(api);

  // A separate block in D1:E4, sorted on its own; the seeded range keeps its order.
  await run.cell("D1", "Item");
  await run.cell("E1", "Qty");
  await run.cell("D2", "Pen");
  await run.cell("E2", "4");
  await run.cell("D3", "Ink");
  await run.cell("E3", "9");
  await run.cell("D4", "Pad");
  await run.cell("E4", "1");

  const sorted = await run.sort({
    range: { start: "D1", end: "E4" },
    column: "E",
    order: "ascending",
    hasHeaderRow: true,
  });
  assert.equal(sorted.status, 200);
  const cells = sheet1(sorted.body.workbook).cells;
  assert.deepEqual([cells.D2, cells.D3, cells.D4], ["Pad", "Pen", "Ink"]);
  assert.deepEqual([cells.E2, cells.E3, cells.E4], ["1", "4", "9"]);
  // The seeded records were not part of the selection, so they keep their order and values.
  assert.deepEqual(column(sorted.body.workbook, "A"), ["East", "North", "South"]);
});

test("keeps the plan pure: the caller sees the new map while the old one is unchanged", () => {
  const cells = { A1: "n", A2: "b", A3: "a" };
  const sorted = planRangeSort(cells, {
    range: { start: "A2", end: "A3" },
    column: "A",
    order: "ascending",
    hasHeaderRow: false,
  });
  assert.deepEqual(sorted, { A1: "n", A2: "a", A3: "b" });
  assert.deepEqual(cells, { A1: "n", A2: "b", A3: "a" });
  assert.equal(planRangeSort(cells, { range: { start: "A1", end: "A3" }, column: "B", order: "ascending" }), null);
  assert.equal(planRangeSort(cells, { range: { start: "bad", end: "A3" }, column: "A", order: "ascending" }), null);
});
