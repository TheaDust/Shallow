import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApiHandler } from "../src/api.mjs";
import { createWorkbookStore } from "../src/store.mjs";
import { DEFAULT_ROW_COUNT, applyRowOperation } from "../src/domain/structure.mjs";

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
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-structure-"));
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

function post(baseUrl, sheetId, kind, payload) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${sheetId}/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function openWorkbook(baseUrl, workbookId = WORKBOOK) {
  return callJson(baseUrl, `/api/workbooks/${workbookId}`);
}

function putCell(baseUrl, sheetId, address, value) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${sheetId}/cells/${address}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });
}

function sheetOf(workbook, sheetId) {
  return workbook.sheets.find((sheet) => sheet.id === sheetId);
}

test("inserting rows above and below moves the target band down and keeps other worksheets", async () => {
  const api = await startApi();
  try {
    const above = await post(api.baseUrl, SHEET1, "rows", { action: "insert-above", row: 2 });
    assert.equal(above.status, 200);
    const shifted = sheetOf(above.body.workbook, SHEET1);
    assert.deepEqual(shifted.cells, {
      A1: "Region",
      B1: "Sales",
      C1: "Status",
      A3: "East",
      B3: "1200",
      C3: "Open",
      A4: "North",
      B4: "800",
      C4: "Closed",
      A5: "South",
      B5: "700",
      C5: "Open",
    });
    assert.equal(shifted.rowCount, DEFAULT_ROW_COUNT + 1);
    assert.deepEqual(sheetOf(above.body.workbook, SHEET2).cells, SEED_SHEET2_CELLS);

    const below = await post(api.baseUrl, SHEET1, "rows", { action: "insert-below", row: 1 });
    assert.equal(below.status, 200);
    assert.deepEqual(sheetOf(below.body.workbook, SHEET1).cells, {
      A1: "Region",
      B1: "Sales",
      C1: "Status",
      A4: "East",
      B4: "1200",
      C4: "Open",
      A5: "North",
      B5: "800",
      C5: "Closed",
      A6: "South",
      B6: "700",
      C6: "Open",
    });

    const reopened = await openWorkbook(api.baseUrl);
    assert.deepEqual(
      sheetOf(reopened.body.workbook, SHEET1).cells,
      sheetOf(below.body.workbook, SHEET1).cells,
    );

    const restarted = await createWorkbookStore(api.directory).read();
    assert.deepEqual(sheetOf(restarted.workbooks[0], SHEET1).cells, {
      A1: "Region",
      B1: "Sales",
      C1: "Status",
      A4: "East",
      B4: "1200",
      C4: "Open",
      A5: "North",
      B5: "800",
      C5: "Closed",
      A6: "South",
      B6: "700",
      C6: "Open",
    });
    assert.deepEqual(sheetOf(restarted.workbooks[0], SHEET2).cells, SEED_SHEET2_CELLS);
  } finally {
    await api.close();
  }
});

test("deleting a row pulls the following rows up and drops the deleted row", async () => {
  const api = await startApi();
  try {
    const deleted = await post(api.baseUrl, SHEET1, "rows", { action: "delete", row: 2 });
    assert.equal(deleted.status, 200);
    const sheet = sheetOf(deleted.body.workbook, SHEET1);
    assert.deepEqual(sheet.cells, {
      A1: "Region",
      B1: "Sales",
      C1: "Status",
      A2: "North",
      B2: "800",
      C2: "Closed",
      A3: "South",
      B3: "700",
      C3: "Open",
    });
    assert.equal(sheet.rowCount, undefined);

    const persisted = await openWorkbook(api.baseUrl);
    assert.deepEqual(sheetOf(persisted.body.workbook, SHEET1).cells, {
      A1: "Region",
      B1: "Sales",
      C1: "Status",
      A2: "North",
      B2: "800",
      C2: "Closed",
      A3: "South",
      B3: "700",
      C3: "Open",
    });
    assert.equal(persisted.body.workbook.updatedAt !== "2026-03-14T09:32:00.000Z", true);
  } finally {
    await api.close();
  }
});

test("inserting and deleting columns moves whole columns and leaves other data untouched", async () => {
  const api = await startApi();
  try {
    const inserted = await post(api.baseUrl, SHEET1, "columns", { action: "insert-left", column: 2 });
    assert.equal(inserted.status, 200);
    const widened = sheetOf(inserted.body.workbook, SHEET1);
    assert.deepEqual(widened.cells, {
      A1: "Region",
      A2: "East",
      A3: "North",
      A4: "South",
      C1: "Sales",
      D1: "Status",
      C2: "1200",
      D2: "Open",
      C3: "800",
      D3: "Closed",
      C4: "700",
      D4: "Open",
    });
    assert.equal(widened.columnCount, 27);

    // Deleting the leftmost column drops its cells and pulls the following columns left.
    const removed = await post(api.baseUrl, SHEET1, "columns", { action: "delete", column: 1 });
    assert.equal(removed.status, 200);
    assert.deepEqual(sheetOf(removed.body.workbook, SHEET1).cells, {
      B1: "Sales",
      C1: "Status",
      B2: "1200",
      C2: "Open",
      B3: "800",
      C3: "Closed",
      B4: "700",
      C4: "Open",
    });
    assert.deepEqual(sheetOf(removed.body.workbook, SHEET2).cells, SEED_SHEET2_CELLS);

    const restarted = await createWorkbookStore(api.directory).read();
    assert.deepEqual(sheetOf(restarted.workbooks[0], SHEET1).cells, {
      B1: "Sales",
      C1: "Status",
      B2: "1200",
      C2: "Open",
      B3: "800",
      C3: "Closed",
      B4: "700",
      C4: "Open",
    });
  } finally {
    await api.close();
  }
});

test("structure changes stay inside the addressed worksheet", async () => {
  const api = await startApi();
  try {
    const result = await post(api.baseUrl, SHEET2, "columns", { action: "insert-right", column: 1 });
    assert.equal(result.status, 200);
    assert.deepEqual(sheetOf(result.body.workbook, SHEET1).cells, SEED_CELLS);
    // The addressed worksheet shifts its own band and rewrites the references that pointed into
    // it, so the formulas still address the same data; the seeded Sheet1 above stays untouched.
    const shifted = sheetOf(result.body.workbook, SHEET2);
    assert.deepEqual(shifted.cells, {
      A1: "2",
      C1: "3",
      D1: "=A1+C1",
      E1: "=D1*2",
    });
    assert.deepEqual(shifted.values, { A1: "2", C1: "3", D1: "5", E1: "10" });
    assert.equal(shifted.columnCount, 27);
    assert.equal(sheetOf(result.body.workbook, SHEET1).columnCount, undefined);
  } finally {
    await api.close();
  }
});

test("rejects invalid row and column operations without touching the grid", async () => {
  const api = await startApi();
  try {
    const before = await openWorkbook(api.baseUrl);

    const cases = [
      { kind: "rows", payload: { action: "insert-above", row: 0 }, error: "Invalid row number" },
      { kind: "rows", payload: { action: "insert-above", row: 51 }, error: "Invalid row number" },
      { kind: "rows", payload: { action: "insert-above", row: "2" }, error: "Invalid row number" },
      { kind: "rows", payload: { action: "insert-below" }, error: "Invalid row number" },
      { kind: "rows", payload: { action: "shift", row: 1 }, error: "Unknown row operation" },
      {
        kind: "columns",
        payload: { action: "insert-left", column: 0 },
        error: "Invalid column number",
      },
      {
        kind: "columns",
        payload: { action: "insert-left", column: 27 },
        error: "Invalid column number",
      },
      { kind: "columns", payload: { action: "delete", column: 1.5 }, error: "Invalid column number" },
      { kind: "columns", payload: { action: "remove", column: 1 }, error: "Unknown column operation" },
    ];

    for (const entry of cases) {
      const rejected = await post(api.baseUrl, SHEET1, entry.kind, entry.payload);
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, entry.error);
    }

    const missingSheet = await post(api.baseUrl, "missing-sheet", "rows", {
      action: "delete",
      row: 1,
    });
    assert.equal(missingSheet.status, 404);
    assert.equal(missingSheet.body.error, "Worksheet not found");

    const missingWorkbook = await callJson(
      api.baseUrl,
      `/api/workbooks/nope/sheets/${SHEET1}/rows`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", row: 1 }),
      },
    );
    assert.equal(missingWorkbook.status, 404);
    assert.equal(missingWorkbook.body.error, "Workbook not found");

    const wrongMethod = await callJson(
      api.baseUrl,
      `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}/rows`,
      { method: "GET" },
    );
    assert.equal(wrongMethod.status, 405);

    const after = await openWorkbook(api.baseUrl);
    assert.deepEqual(after.body.workbook, before.body.workbook);
  } finally {
    await api.close();
  }
});

test("validation rules shift with the band and disappear with a deleted row", async () => {
  const api = await startApi();
  try {
    await api.store.update((state) => {
      const sheet = state.workbooks[0].sheets[0];
      sheet.validations = [
        {
          id: "v1",
          range: "D2:E2",
          type: "number-range",
          min: 0,
          max: 100,
          message: "Please enter a number from 0 to 100",
        },
        {
          id: "v2",
          range: "B3",
          type: "number-range",
          min: 0,
          max: 100,
          message: "Please enter a number from 0 to 100",
        },
      ];
      return state;
    });

    const inserted = await post(api.baseUrl, SHEET1, "rows", { action: "insert-above", row: 2 });
    assert.equal(inserted.status, 200);
    assert.deepEqual(
      sheetOf(inserted.body.workbook, SHEET1).validations.map((rule) => rule.range),
      ["D3:E3", "B4"],
    );

    // The shifted rule still covers the record it was attached to…
    const rejected = await putCell(api.baseUrl, SHEET1, "D3", "150");
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Please enter a number from 0 to 100");
    // …while the row the record left behind is no longer covered.
    const accepted = await putCell(api.baseUrl, SHEET1, "D2", "150");
    assert.equal(accepted.status, 200);

    const deleted = await post(api.baseUrl, SHEET1, "rows", { action: "delete", row: 3 });
    assert.equal(deleted.status, 200);
    assert.deepEqual(
      sheetOf(deleted.body.workbook, SHEET1).validations.map((rule) => rule.range),
      ["B3"],
    );
  } finally {
    await api.close();
  }
});

test("inserting on the last row of the grid keeps the shifted value", () => {
  const sheet = { id: "s", name: "Sheet1", cells: { A50: "bottom" } };
  const result = applyRowOperation(sheet, { action: "insert-above", row: 50 });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(sheet.cells, { A51: "bottom" });
  assert.equal(sheet.rowCount, DEFAULT_ROW_COUNT + 1);
});
