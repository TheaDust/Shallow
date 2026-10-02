/**
 * REQ-5-3-1 over the real HTTP API: creating the `Pivot1` worksheet from a source range,
 * applying the fields and method, refreshing after the source changed, and the two refusals
 * that must preserve the last successful summary and the source worksheet.
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
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-pivot-"));
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
    store,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function callJson(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });
  return { status: response.status, body: await response.json() };
}

function sheetOf(workbook, id) {
  return workbook.sheets.find((sheet) => sheet.id === id);
}

async function openWorkbook(baseUrl) {
  const { body } = await callJson(baseUrl, `/api/workbooks/${WORKBOOK}`);
  return body.workbook;
}

test("creating a pivot table adds the first unused PivotN worksheet and leaves the source alone", async () => {
  const api = await startApi();
  try {
    const created = await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/pivots`, {
      method: "POST",
      body: JSON.stringify({ sourceSheetId: SHEET1, sourceRange: "A1:C4" }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.worksheet.name, "Pivot1");
    assert.deepEqual(created.body.worksheet.pivot, {
      sourceSheetId: SHEET1,
      sourceRange: "A1:C4",
      rowField: "",
      columnField: "",
      valueField: "",
      method: "SUM",
    });
    assert.equal(created.body.workbook.activeSheetId, created.body.worksheet.id);
    assert.deepEqual(sheetOf(created.body.workbook, SHEET1).cells, SEED_CELLS);

    const second = await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/pivots`, {
      method: "POST",
      body: JSON.stringify({ sourceSheetId: SHEET1, sourceRange: "A1:C4" }),
    });
    assert.equal(second.body.worksheet.name, "Pivot2");

    // An unusable range is refused without creating anything.
    const refused = await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/pivots`, {
      method: "POST",
      body: JSON.stringify({ sourceSheetId: SHEET1, sourceRange: "nope" }),
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, "Invalid pivot source range");
    const after = await openWorkbook(api.baseUrl);
    assert.deepEqual(after.sheets.map((sheet) => sheet.name), ["Sheet1", "Sheet2", "Pivot1", "Pivot2"]);
  } finally {
    await api.close();
  }
});

test("Apply stores the summary and Refresh recomputes it from the current source data", async () => {
  const api = await startApi();
  try {
    const created = await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/pivots`, {
      method: "POST",
      body: JSON.stringify({ sourceSheetId: SHEET1, sourceRange: "A1:C4" }),
    });
    const pivotId = created.body.worksheet.id;

    const applied = await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${pivotId}/pivot`, {
      method: "PUT",
      body: JSON.stringify({ rowField: "Region", columnField: "", valueField: "Sales", method: "SUM" }),
    });
    assert.equal(applied.status, 200);
    const pivot = sheetOf(applied.body.workbook, pivotId);
    assert.deepEqual(pivot.cells, {
      A1: "Region",
      B1: "SUM of Sales",
      A2: "East",
      B2: "1200",
      A3: "North",
      B3: "800",
      A4: "South",
      B4: "700",
      A5: "Grand Total",
      B5: "2700",
    });
    assert.deepEqual(pivot.values.B2, "1200");
    // The source worksheet did not change while the summary was computed.
    assert.deepEqual(sheetOf(applied.body.workbook, SHEET1).cells, SEED_CELLS);

    // A source edit does not move the stored summary before the explicit refresh.
    await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}/cells/B2`, {
      method: "PUT",
      body: JSON.stringify({ value: "1500" }),
    });
    const stale = await openWorkbook(api.baseUrl);
    assert.equal(sheetOf(stale, pivotId).cells.B2, "1200");

    const refreshed = await callJson(
      api.baseUrl,
      `/api/workbooks/${WORKBOOK}/sheets/${pivotId}/pivot/refresh`,
      { method: "POST" },
    );
    assert.equal(refreshed.status, 200);
    const updated = sheetOf(refreshed.body.workbook, pivotId);
    assert.equal(updated.cells.B2, "1500");
    assert.equal(updated.cells.B5, "3000");
    assert.equal(sheetOf(refreshed.body.workbook, SHEET1).cells.B2, "1500");
  } finally {
    await api.close();
  }
});

test("a deleted source header refuses Apply and refresh while preserving the last summary", async () => {
  const api = await startApi();
  try {
    const created = await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/pivots`, {
      method: "POST",
      body: JSON.stringify({ sourceSheetId: SHEET1, sourceRange: "A1:C4" }),
    });
    const pivotId = created.body.worksheet.id;
    const applied = await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${pivotId}/pivot`, {
      method: "PUT",
      body: JSON.stringify({ rowField: "Region", columnField: "", valueField: "Sales", method: "SUM" }),
    });
    const before = sheetOf(applied.body.workbook, pivotId).cells;

    // Deleting the header column removes the field the pivot was configured with.
    const deleted = await callJson(
      api.baseUrl,
      `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}/columns`,
      { method: "POST", body: JSON.stringify({ action: "delete", column: 1 }) },
    );
    assert.equal(deleted.status, 200);
    assert.equal(sheetOf(deleted.body.workbook, pivotId).pivot.sourceRange, "A1:B4");
    assert.deepEqual(sheetOf(deleted.body.workbook, pivotId).cells, before);

    const refreshed = await callJson(
      api.baseUrl,
      `/api/workbooks/${WORKBOOK}/sheets/${pivotId}/pivot/refresh`,
      { method: "POST" },
    );
    assert.equal(refreshed.status, 400);
    assert.equal(refreshed.body.error, "Pivot field is no longer available. Select a new field.");

    const after = await openWorkbook(api.baseUrl);
    assert.deepEqual(sheetOf(after, pivotId).cells, before);
    assert.equal(sheetOf(after, SHEET1).cells.A1, "Sales");
  } finally {
    await api.close();
  }
});

test("a value field without parseable numbers refuses SUM and keeps the old result", async () => {
  const api = await startApi();
  try {
    const created = await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/pivots`, {
      method: "POST",
      body: JSON.stringify({ sourceSheetId: SHEET1, sourceRange: "A1:C4" }),
    });
    const pivotId = created.body.worksheet.id;
    const applied = await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${pivotId}/pivot`, {
      method: "PUT",
      body: JSON.stringify({ rowField: "Region", columnField: "", valueField: "Sales", method: "SUM" }),
    });
    const before = sheetOf(applied.body.workbook, pivotId).cells;

    for (const row of [2, 3, 4]) {
      await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}/cells/B${row}`, {
        method: "PUT",
        body: JSON.stringify({ value: "unknown" }),
      });
    }
    const refused = await callJson(
      api.baseUrl,
      `/api/workbooks/${WORKBOOK}/sheets/${pivotId}/pivot/refresh`,
      { method: "POST" },
    );
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, "Value field requires numeric values");

    // COUNT accepts the same nonnumeric column.
    const counted = await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${pivotId}/pivot`, {
      method: "PUT",
      body: JSON.stringify({ rowField: "Region", columnField: "", valueField: "Sales", method: "COUNT" }),
    });
    assert.equal(counted.status, 200);
    const pivot = sheetOf(counted.body.workbook, pivotId);
    assert.notDeepEqual(pivot.cells, before);
    assert.deepEqual(pivot.cells, {
      A1: "Region",
      B1: "COUNT of Sales",
      A2: "East",
      B2: "1",
      A3: "North",
      B3: "1",
      A4: "South",
      B4: "1",
      A5: "Grand Total",
      B5: "3",
    });
  } finally {
    await api.close();
  }
});
