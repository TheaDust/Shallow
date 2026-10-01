/**
 * REQ-2-1-4 over the real HTTP API: `DELETE /api/workbooks/:id/sheets/:sheetId` removes one
 * worksheet together with its cells, formulas, filters, validation rules and pivot state, makes
 * an adjacent worksheet active, refuses to remove the last remaining worksheet and refuses to
 * remove a worksheet a pivot table still reads.
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

async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-worksheet-delete-"));
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
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function callJson(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function jsonInit(method, payload) {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) };
}

function openWorkbook(baseUrl, workbookId = WORKBOOK) {
  return callJson(baseUrl, `/api/workbooks/${workbookId}`);
}

function deleteSheet(baseUrl, sheetId, workbookId = WORKBOOK) {
  return callJson(baseUrl, `/api/workbooks/${workbookId}/sheets/${sheetId}`, { method: "DELETE" });
}

function addSheet(baseUrl) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets`, { method: "POST" });
}

function createPivot(baseUrl, sourceSheetId, sourceRange) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/pivots`, jsonInit("POST", { sourceSheetId, sourceRange }));
}

test("deletes one worksheet with its state and makes the adjacent one active", async () => {
  const api = await startApi();
  try {
    const before = await openWorkbook(api.baseUrl);
    assert.equal(before.body.workbook.activeSheetId, SHEET1);

    // The removed worksheet carries data, a filter and a validation rule.
    await callJson(
      api.baseUrl,
      `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}/filter`,
      jsonInit("PUT", { filter: { range: "A1:C4", columns: [{ column: "A", mode: "values", values: ["East"] }] } }),
    );
    await callJson(
      api.baseUrl,
      `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}/validations`,
      jsonInit("PUT", {
        validations: [{ range: "B2:B4", type: "number-range", min: 0, max: 100 }],
      }),
    );

    const removed = await deleteSheet(api.baseUrl, SHEET1);
    assert.equal(removed.status, 200);
    assert.deepEqual(
      removed.body.workbook.sheets.map((sheet) => sheet.name),
      ["Sheet2"],
    );
    // The remaining worksheet keeps its own cells, and nothing of the deleted one is left.
    assert.equal(removed.body.workbook.sheets[0].cells.C1, "=A1+B1");
    assert.equal(removed.body.workbook.sheets[0].filter, undefined);
    assert.equal(removed.body.workbook.sheets[0].validations, undefined);
    assert.equal(removed.body.workbook.activeSheetId, SHEET2);

    const persisted = await openWorkbook(api.baseUrl);
    assert.deepEqual(
      persisted.body.workbook.sheets.map((sheet) => sheet.name),
      ["Sheet2"],
    );
    assert.equal(persisted.body.workbook.activeSheetId, SHEET2);

    const restarted = await createWorkbookStore(api.directory).read();
    assert.deepEqual(
      restarted.workbooks[0].sheets.map((sheet) => sheet.name),
      ["Sheet2"],
    );
  } finally {
    await api.close();
  }
});

test("keeps the active worksheet when another worksheet is deleted", async () => {
  const api = await startApi();
  try {
    const removed = await deleteSheet(api.baseUrl, SHEET2);
    assert.equal(removed.status, 200);
    assert.deepEqual(
      removed.body.workbook.sheets.map((sheet) => sheet.name),
      ["Sheet1"],
    );
    assert.equal(removed.body.workbook.activeSheetId, SHEET1);
    assert.equal(removed.body.workbook.sheets[0].cells.A2, "East");
    assert.equal(removed.body.workbook.sheets[0].cells.B2, "1200");
  } finally {
    await api.close();
  }
});

test("activates the worksheet before the removed one when the last tab is deleted", async () => {
  const api = await startApi();
  try {
    const added = await addSheet(api.baseUrl);
    assert.equal(added.body.workbook.activeSheetId, added.body.worksheet.id);

    const removed = await deleteSheet(api.baseUrl, added.body.worksheet.id);
    assert.equal(removed.status, 200);
    assert.deepEqual(
      removed.body.workbook.sheets.map((sheet) => sheet.name),
      ["Sheet1", "Sheet2"],
    );
    assert.equal(removed.body.workbook.activeSheetId, SHEET2);
  } finally {
    await api.close();
  }
});

test("refuses to delete the last remaining worksheet without changing anything", async () => {
  const api = await startApi();
  try {
    const first = await deleteSheet(api.baseUrl, SHEET2);
    assert.equal(first.status, 200);
    const before = await openWorkbook(api.baseUrl);

    const rejected = await deleteSheet(api.baseUrl, SHEET1);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "A workbook must contain at least one worksheet");

    const after = await openWorkbook(api.baseUrl);
    assert.deepEqual(
      after.body.workbook.sheets.map((sheet) => sheet.name),
      ["Sheet1"],
    );
    assert.deepEqual(after.body.workbook.sheets[0].cells, before.body.workbook.sheets[0].cells);
  } finally {
    await api.close();
  }
});

test("refuses to delete a worksheet a pivot table still reads", async () => {
  const api = await startApi();
  try {
    const pivot = await createPivot(api.baseUrl, SHEET1, "A1:C4");
    assert.equal(pivot.status, 201);
    const pivotId = pivot.body.worksheet.id;
    await callJson(
      api.baseUrl,
      `/api/workbooks/${WORKBOOK}/sheets/${pivotId}/pivot`,
      jsonInit("PUT", { rowField: "Region", columnField: "", valueField: "Sales", method: "SUM" }),
    );

    const rejected = await deleteSheet(api.baseUrl, SHEET1);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Please delete or rebuild dependent pivot tables first");

    const after = await openWorkbook(api.baseUrl);
    assert.deepEqual(
      after.body.workbook.sheets.map((sheet) => sheet.name),
      ["Sheet1", "Sheet2", "Pivot1"],
    );
    assert.equal(after.body.workbook.sheets[0].cells.A2, "East");
    assert.equal(after.body.workbook.sheets[2].cells.A1, "Region");

    // Deleting the pivot-result worksheet removes the constraint on its source.
    const removed = await deleteSheet(api.baseUrl, pivotId);
    assert.equal(removed.status, 200);
    assert.deepEqual(
      removed.body.workbook.sheets.map((sheet) => sheet.name),
      ["Sheet1", "Sheet2"],
    );

    const source = await deleteSheet(api.baseUrl, SHEET1);
    assert.equal(source.status, 200);
    assert.deepEqual(
      source.body.workbook.sheets.map((sheet) => sheet.name),
      ["Sheet2"],
    );
  } finally {
    await api.close();
  }
});

test("reports missing workbooks and worksheets and rejects other methods", async () => {
  const api = await startApi();
  try {
    const missingWorkbook = await deleteSheet(api.baseUrl, SHEET1, "nope");
    assert.equal(missingWorkbook.status, 404);
    assert.equal(missingWorkbook.body.error, "Workbook not found");

    const missingSheet = await deleteSheet(api.baseUrl, "missing-sheet");
    assert.equal(missingSheet.status, 404);
    assert.equal(missingSheet.body.error, "Worksheet not found");

    const wrongMethod = await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}`, {
      method: "PUT",
    });
    assert.equal(wrongMethod.status, 405);

    const unchanged = await openWorkbook(api.baseUrl);
    assert.deepEqual(
      unchanged.body.workbook.sheets.map((sheet) => sheet.name),
      ["Sheet1", "Sheet2"],
    );
  } finally {
    await api.close();
  }
});
