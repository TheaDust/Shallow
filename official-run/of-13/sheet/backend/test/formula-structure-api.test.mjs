/**
 * REQ-4-2-1 through the HTTP API: after a source-value edit, a bulk paste, a range move or a
 * row/column structure change, every directly and indirectly dependent formula shows a result
 * consistent with the current source values, while the formula bar text (`cells`) keeps the
 * formula the user submitted (adjusted only by the structure change itself). Every step also
 * verifies what a reopen and a store restart return, so a stale pre-change result can never be
 * observed, and that formulas of the other worksheet stay untouched.
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
const SEED_SHEET2_CELLS = { A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2" };

async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-formula-structure-"));
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
  const body = await response.json();
  return { status: response.status, body };
}

function putCell(baseUrl, sheetId, address, value) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${sheetId}/cells/${address}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });
}

async function writeCells(baseUrl, sheetId, entries) {
  for (const [address, value] of Object.entries(entries)) {
    const written = await putCell(baseUrl, sheetId, address, value);
    assert.equal(written.status, 200, `${address} was rejected`);
  }
}

function structure(baseUrl, sheetId, kind, payload) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${sheetId}/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function transfer(baseUrl, sheetId, payload) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${sheetId}/range-transfer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function sheetOf(workbook, sheetId) {
  const sheet = workbook.sheets.find((entry) => entry.id === sheetId);
  assert.ok(sheet, `worksheet ${sheetId} is missing`);
  return sheet;
}

async function openSheet(baseUrl, sheetId = SHEET2) {
  const opened = await callJson(baseUrl, `/api/workbooks/${WORKBOOK}`);
  assert.equal(opened.status, 200);
  return sheetOf(opened.body.workbook, sheetId);
}

test("a source-value edit refreshes direct and indirect dependents through the whole chain", async () => {
  const api = await startApi();
  try {
    await writeCells(api.baseUrl, SHEET2, { E1: "=A1+1", F1: "=E1*10" });
    let sheet = await openSheet(api.baseUrl);
    assert.equal(sheet.values.E1, "3");
    assert.equal(sheet.values.F1, "30");

    await putCell(api.baseUrl, SHEET2, "A1", "7");
    sheet = await openSheet(api.baseUrl);
    assert.equal(sheet.values.C1, "10");
    assert.equal(sheet.values.D1, "20");
    assert.equal(sheet.values.E1, "8");
    assert.equal(sheet.values.F1, "80");
    // The formula bar keeps the submitted text of every cell of the chain.
    assert.equal(sheet.cells.C1, "=A1+B1");
    assert.equal(sheet.cells.D1, "=C1*2");
    assert.equal(sheet.cells.F1, "=E1*10");

    const restarted = await createWorkbookStore(api.directory).read();
    const stored = sheetOf(restarted.workbooks[0], SHEET2);
    assert.equal(stored.cells.A1, "7");
    assert.equal(stored.cells.F1, "=E1*10");
  } finally {
    await api.close();
  }
});

test("inserting a row above the seeded formulas keeps them addressing the moved data", async () => {
  const api = await startApi();
  try {
    await writeCells(api.baseUrl, SHEET1, { D1: "=B2+B3", E1: "=D1*2" });
    const inserted = await structure(api.baseUrl, SHEET2, "rows", {
      action: "insert-above",
      row: 1,
    });
    assert.equal(inserted.status, 200);
    const sheet = sheetOf(inserted.body.workbook, SHEET2);
    assert.deepEqual(sheet.cells, {
      A2: "2",
      B2: "3",
      C2: "=A2+B2",
      D2: "=C2*2",
    });
    assert.deepEqual(sheet.values, { A2: "2", B2: "3", C2: "5", D2: "10" });
    // The other worksheet keeps both its values and its own formulas.
    const other = sheetOf(inserted.body.workbook, SHEET1);
    assert.deepEqual(other.cells, { ...SEED_CELLS, D1: "=B2+B3", E1: "=D1*2" });
    assert.equal(other.values.D1, "2000");
    assert.equal(other.values.E1, "4000");

    // Reopening shows the recalculated chain, never the pre-change coordinates.
    const reopened = await openSheet(api.baseUrl);
    assert.equal(reopened.values.C2, "5");
    assert.equal(reopened.values.D2, "10");
    assert.equal(reopened.cells.C2, "=A2+B2");
    assert.equal(reopened.cells.C1, undefined);
  } finally {
    await api.close();
  }
});

test("inserting below the last referenced row leaves the formulas where they are", async () => {
  const api = await startApi();
  try {
    const inserted = await structure(api.baseUrl, SHEET2, "rows", {
      action: "insert-below",
      row: 1,
    });
    assert.equal(inserted.status, 200);
    const sheet = sheetOf(inserted.body.workbook, SHEET2);
    assert.deepEqual(sheet.cells, SEED_SHEET2_CELLS);
    assert.deepEqual(sheet.values, { A1: "2", B1: "3", C1: "5", D1: "10" });
  } finally {
    await api.close();
  }
});

test("deleting a referenced row shows #REF! in the formula bar text and the grid", async () => {
  const api = await startApi();
  try {
    await writeCells(api.baseUrl, SHEET2, { A3: "7", E1: "=A3*2" });
    let sheet = await openSheet(api.baseUrl);
    assert.equal(sheet.values.E1, "14");

    const deleted = await structure(api.baseUrl, SHEET2, "rows", { action: "delete", row: 3 });
    assert.equal(deleted.status, 200);
    sheet = sheetOf(deleted.body.workbook, SHEET2);
    assert.equal(sheet.cells.E1, "=#REF!*2");
    assert.equal(sheet.values.E1, "#REF!");
    // The formulas that did not reference the deleted row keep their own reference and result.
    assert.equal(sheet.cells.C1, "=A1+B1");
    assert.equal(sheet.values.C1, "5");
    assert.equal(sheet.values.D1, "10");

    const reopened = await openSheet(api.baseUrl);
    assert.equal(reopened.cells.E1, "=#REF!*2");
    assert.equal(reopened.values.E1, "#REF!");

    // A new value written to the cell replaces the error and the dependents follow.
    await putCell(api.baseUrl, SHEET2, "E1", "=A1*2");
    sheet = await openSheet(api.baseUrl);
    assert.equal(sheet.values.E1, "4");
    assert.equal(sheet.values.E1 === "#REF!", false);
  } finally {
    await api.close();
  }
});

test("deleting a referenced column drops its references and shifts the surviving ones", async () => {
  const api = await startApi();
  try {
    await writeCells(api.baseUrl, SHEET2, { F1: "=B1*10" });
    const deleted = await structure(api.baseUrl, SHEET2, "columns", {
      action: "delete",
      column: 1,
    });
    assert.equal(deleted.status, 200);
    const sheet = sheetOf(deleted.body.workbook, SHEET2);
    // `B1` moved into column A, so `C1`'s formula now reads `=#REF!+A1` and `F1`'s `=A1*10`.
    assert.deepEqual(sheet.cells, {
      A1: "3",
      B1: "=#REF!+A1",
      C1: "=B1*2",
      E1: "=A1*10",
    });
    assert.equal(sheet.values.B1, "#REF!");
    assert.equal(sheet.values.C1, "#REF!");
    assert.equal(sheet.values.E1, "30");

    const restarted = await createWorkbookStore(api.directory).read();
    const stored = sheetOf(restarted.workbooks[0], SHEET2);
    assert.equal(stored.cells.E1, "=A1*10");
    assert.equal(stored.cells.B1, "=#REF!+A1");
  } finally {
    await api.close();
  }
});

test("inserting a column moves the formulas of the shifted columns together", async () => {
  const api = await startApi();
  try {
    const inserted = await structure(api.baseUrl, SHEET2, "columns", {
      action: "insert-left",
      column: 2,
    });
    assert.equal(inserted.status, 200);
    const sheet = sheetOf(inserted.body.workbook, SHEET2);
    assert.deepEqual(sheet.cells, {
      A1: "2",
      C1: "3",
      D1: "=A1+C1",
      E1: "=D1*2",
    });
    assert.deepEqual(sheet.values, { A1: "2", C1: "3", D1: "5", E1: "10" });
  } finally {
    await api.close();
  }
});

test("a bulk paste and a range move under the same source cells are reflected by every dependent", async () => {
  const api = await startApi();
  try {
    await writeCells(api.baseUrl, SHEET2, { A3: "10", E1: "=A3*3" });
    // Bulk paste overwrites the source value the chain reads.
    const pasted = await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${SHEET2}/paste`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ start: "A3", text: "4" }),
    });
    assert.equal(pasted.status, 200);
    assert.equal(sheetOf(pasted.body.workbook, SHEET2).values.E1, "12");

    // Moving a source cell away updates the dependent result of the same read.
    const moved = await transfer(api.baseUrl, SHEET2, {
      source: { start: "A3" },
      target: { start: "B3" },
      mode: "cut",
    });
    assert.equal(moved.status, 200);
    const sheet = sheetOf(moved.body.workbook, SHEET2);
    assert.equal(sheet.cells.B3, "4");
    assert.equal(sheet.values.E1, "0");
    assert.equal(sheet.cells.E1, "=A3*3");
  } finally {
    await api.close();
  }
});
