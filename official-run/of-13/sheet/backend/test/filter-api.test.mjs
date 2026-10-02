/**
 * REQ-5-1-2: creating, applying and clearing a filter view of the seeded data region.
 *
 * The filter is a stored definition (`range` + per-column values/condition) and every response
 * derives `hiddenRows` from it, so a hidden row keeps its cells and its display value: CSV
 * export and pivot sources still see the whole region.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApiHandler } from "../src/api.mjs";
import { createWorkbookStore } from "../src/store.mjs";

const WORKBOOK = "wb-q3-sales";
const SHEET1 = "wb-q3-sales-sheet-1";
const SHEET2 = "wb-q3-sales-sheet-2";

const SEED_CELLS = {
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
};

async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-filter-"));
  const store = createWorkbookStore(directory);
  const handleApi = createApiHandler({ store });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    void handleApi(request, response, url);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no address");
  return {
    directory,
    store,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function callJson(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function openWorkbook(baseUrl) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}`);
}

function sheetOf(workbook, sheetId) {
  return workbook.sheets.find((sheet) => sheet.id === sheetId);
}

function sendFilter(baseUrl, sheetId, filter) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${sheetId}/filter`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filter }),
  });
}

function structureCall(baseUrl, sheetId, kind, payload) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${sheetId}/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const DATA_REGION = "A1:C4";

test("a value filter hides exactly the nonmatching rows and keeps their data", async () => {
  const api = await startApi();
  try {
    const saved = await sendFilter(api.baseUrl, SHEET1, {
      range: DATA_REGION,
      columns: [{ column: "A", mode: "values", values: ["East", "South"] }],
    });
    assert.equal(saved.status, 200);
    const sheet = sheetOf(saved.body.workbook, SHEET1);
    assert.deepEqual(sheet.filter, {
      range: "A1:C4",
      columns: [{ column: "A", mode: "values", values: ["East", "South"] }],
    });
    // Only the North row is hidden; nothing was deleted or reordered.
    assert.deepEqual(sheet.hiddenRows, [3]);
    assert.deepEqual(sheet.cells, SEED_CELLS);
    assert.equal(sheet.values.A3, "North");
    assert.equal(sheet.values.B3, "800");
    // The other worksheet is untouched and has no hidden row.
    const other = sheetOf(saved.body.workbook, SHEET2);
    assert.deepEqual(other.hiddenRows, []);
    assert.equal(other.cells.A1, "2");

    const reopened = await openWorkbook(api.baseUrl);
    assert.deepEqual(sheetOf(reopened.body.workbook, SHEET1).hiddenRows, [3]);
  } finally {
    await api.close();
  }
});

test("conditions of different columns are combined with AND", async () => {
  const api = await startApi();
  try {
    const saved = await sendFilter(api.baseUrl, SHEET1, {
      range: DATA_REGION,
      columns: [
        { column: "A", mode: "condition", condition: "text-contains", value: "th" },
        { column: "B", mode: "condition", condition: "greater-than", value: "750" },
      ],
    });
    assert.equal(saved.status, 200);
    // North matches both; East fails the text condition and South the numeric one.
    assert.deepEqual(sheetOf(saved.body.workbook, SHEET1).hiddenRows, [2, 4]);
  } finally {
    await api.close();
  }
});

test("is-empty and is-not-empty read the displayed text of a column", async () => {
  const api = await startApi();
  try {
    const empty = await sendFilter(api.baseUrl, SHEET1, {
      range: DATA_REGION,
      columns: [{ column: "C", mode: "condition", condition: "is-empty" }],
    });
    assert.deepEqual(sheetOf(empty.body.workbook, SHEET1).hiddenRows, [2, 3, 4]);

    const filled = await sendFilter(api.baseUrl, SHEET1, {
      range: DATA_REGION,
      columns: [{ column: "C", mode: "condition", condition: "is-not-empty" }],
    });
    assert.deepEqual(sheetOf(filled.body.workbook, SHEET1).hiddenRows, []);
  } finally {
    await api.close();
  }
});

test("a before condition hides rows whose date is not earlier than the value", async () => {
  const api = await startApi();
  try {
    await api.store.update((state) => {
      const sheet = state.workbooks[0].sheets[0];
      sheet.cells.C2 = "2026-01-05";
      sheet.cells.C3 = "2026-03-01";
      sheet.cells.C4 = "2026-02-20";
      return state;
    });

    const saved = await sendFilter(api.baseUrl, SHEET1, {
      range: DATA_REGION,
      columns: [{ column: "C", mode: "condition", condition: "before", value: "2026-02-15" }],
    });
    // Only the 2026-01-05 row is earlier than the boundary.
    assert.deepEqual(sheetOf(saved.body.workbook, SHEET1).hiddenRows, [3, 4]);
  } finally {
    await api.close();
  }
});

test("an unusable filter is rejected without changing the worksheet", async () => {
  const api = await startApi();
  try {
    const before = await openWorkbook(api.baseUrl);
    const cases = [
      { range: "nope", columns: [] },
      { range: "A1:C4", columns: "A" },
      { range: "A1:C4", columns: [{ column: "Z", mode: "values", values: [] }] },
      { range: "A1:C4", columns: [{ column: "A", mode: "condition", condition: "starts-with" }] },
      { range: "A1:C4", columns: [{ column: "A", mode: "values" }] },
    ];
    for (const payload of cases) {
      const rejected = await sendFilter(api.baseUrl, SHEET1, payload);
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, "Invalid filter");
    }
    const missing = await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/sheets/nope/filter`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filter: null }),
    });
    assert.equal(missing.status, 404);

    const after = await openWorkbook(api.baseUrl);
    assert.deepEqual(after.body.workbook, before.body.workbook);
  } finally {
    await api.close();
  }
});

test("clearing a filter shows every row again and survives a store restart", async () => {
  const api = await startApi();
  try {
    await sendFilter(api.baseUrl, SHEET1, {
      range: DATA_REGION,
      columns: [{ column: "A", mode: "values", values: ["North"] }],
    });

    const cleared = await sendFilter(api.baseUrl, SHEET1, null);
    assert.equal(cleared.status, 200);
    const sheet = sheetOf(cleared.body.workbook, SHEET1);
    assert.equal(sheet.filter, undefined);
    assert.deepEqual(sheet.hiddenRows, []);
    assert.deepEqual(sheet.cells, SEED_CELLS);

    const restarted = await createWorkbookStore(api.directory).read();
    assert.deepEqual(sheetOf(restarted.workbooks[0], SHEET1).cells, SEED_CELLS);
    assert.equal(sheetOf(restarted.workbooks[0], SHEET1).filter, undefined);
  } finally {
    await api.close();
  }
});

test("a filter is kept for the addressed worksheet only and persists with it", async () => {
  const api = await startApi();
  try {
    await sendFilter(api.baseUrl, SHEET1, {
      range: DATA_REGION,
      columns: [{ column: "B", mode: "condition", condition: "greater-than", value: "1000" }],
    });

    const restarted = await createWorkbookStore(api.directory).read();
    assert.deepEqual(sheetOf(restarted.workbooks[0], SHEET1).filter, {
      range: "A1:C4",
      columns: [{ column: "B", mode: "condition", condition: "greater-than", value: "1000" }],
    });
    assert.equal(sheetOf(restarted.workbooks[0], SHEET2).filter, undefined);

    const reopened = await openWorkbook(api.baseUrl);
    assert.deepEqual(sheetOf(reopened.body.workbook, SHEET1).hiddenRows, [3, 4]);
    assert.deepEqual(sheetOf(reopened.body.workbook, SHEET2).hiddenRows, []);
  } finally {
    await api.close();
  }
});

test("the filter range and its columns move with row and column changes", async () => {
  const api = await startApi();
  try {
    await sendFilter(api.baseUrl, SHEET1, {
      range: DATA_REGION,
      columns: [{ column: "A", mode: "values", values: ["East"] }],
    });

    const inserted = await structureCall(api.baseUrl, SHEET1, "rows", {
      action: "insert-above",
      row: 2,
    });
    assert.equal(inserted.status, 200);
    const shifted = sheetOf(inserted.body.workbook, SHEET1);
    assert.equal(shifted.filter.range, "A1:C5");
    // East moved to row 3; the blank row and the North/South rows are not "East".
    assert.deepEqual(shifted.hiddenRows, [2, 4, 5]);

    const widened = await structureCall(api.baseUrl, SHEET1, "columns", {
      action: "insert-left",
      column: 1,
    });
    assert.equal(widened.status, 200);
    const moved = sheetOf(widened.body.workbook, SHEET1);
    assert.equal(moved.filter.range, "B1:D5");
    assert.deepEqual(moved.filter.columns, [{ column: "B", mode: "values", values: ["East"] }]);
    assert.deepEqual(moved.hiddenRows, [2, 4, 5]);

    await sendFilter(api.baseUrl, SHEET2, {
      range: "A1:D1",
      columns: [{ column: "B", mode: "values", values: ["x"] }],
    });
    const removed = await structureCall(api.baseUrl, SHEET2, "columns", {
      action: "delete",
      column: 2,
    });
    assert.equal(removed.status, 200);
    const shrunk = sheetOf(removed.body.workbook, SHEET2);
    assert.equal(shrunk.filter.range, "A1:C1");
    // The constrained column disappeared with the deleted band, so nothing is hidden any more.
    assert.deepEqual(shrunk.filter.columns, []);
    assert.deepEqual(shrunk.hiddenRows, []);
  } finally {
    await api.close();
  }
});

test("the filter endpoint only accepts PUT", async () => {
  const api = await startApi();
  try {
    const rejected = await callJson(
      api.baseUrl,
      `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}/filter`,
      { method: "GET" },
    );
    assert.equal(rejected.status, 405);
  } finally {
    await api.close();
  }
});
