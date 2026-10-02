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
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-state-"));
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

function restore(baseUrl, sheetId, payload) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${sheetId}/state`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function openWorkbook(baseUrl) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}`);
}

function sheetOf(workbook, sheetId) {
  return workbook.sheets.find((sheet) => sheet.id === sheetId);
}

test("restoring a worksheet puts cells, structure and rules back and persists them", async () => {
  const api = await startApi();
  try {
    const result = await restore(api.baseUrl, SHEET1, {
      cells: { A1: "Region", A2: "East", B2: "1200" },
      rowCount: 51,
      columnCount: null,
      validations: [
        { id: "v1", range: "B2:B3", type: "number-range", min: 0, max: 100, message: "Keep it small" },
      ],
    });
    assert.equal(result.status, 200);
    const sheet = sheetOf(result.body.workbook, SHEET1);
    assert.deepEqual(sheet.cells, { A1: "Region", A2: "East", B2: "1200" });
    assert.equal(sheet.rowCount, 51);
    assert.equal(sheet.columnCount, undefined);
    assert.equal(sheet.validations.length, 1);
    assert.equal(sheet.validations[0].message, "Keep it small");
    assert.deepEqual(sheet.values, { A1: "Region", A2: "East", B2: "1200" });

    const reopened = await openWorkbook(api.baseUrl);
    assert.deepEqual(sheetOf(reopened.body.workbook, SHEET1).cells, sheet.cells);

    const restarted = await createWorkbookStore(api.directory).read();
    assert.equal(sheetOf(restarted.workbooks[0], SHEET1).rowCount, 51);
    assert.equal(sheetOf(restarted.workbooks[0], SHEET1).validations[0].range, "B2:B3");
  } finally {
    await api.close();
  }
});

test("a null grid size resets the stored size to the default", async () => {
  const api = await startApi();
  try {
    await api.store.update((state) => {
      const sheet = state.workbooks[0].sheets[0];
      sheet.rowCount = 60;
      sheet.columnCount = 30;
      return state;
    });

    const result = await restore(api.baseUrl, SHEET1, {
      cells: SEED_CELLS,
      rowCount: null,
      columnCount: null,
      validations: [],
    });
    assert.equal(result.status, 200);
    const sheet = sheetOf(result.body.workbook, SHEET1);
    assert.equal(sheet.rowCount, undefined);
    assert.equal(sheet.columnCount, undefined);
    assert.deepEqual(sheet.validations, []);

    const restarted = await createWorkbookStore(api.directory).read();
    assert.equal(sheetOf(restarted.workbooks[0], SHEET1).rowCount, undefined);
    assert.equal(sheetOf(restarted.workbooks[0], SHEET1).columnCount, undefined);
  } finally {
    await api.close();
  }
});

test("a restored grid keeps the stored selection inside the new bounds", async () => {
  const api = await startApi();
  try {
    await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selection: { start: "E4", end: "F5" } }),
    });

    const result = await restore(api.baseUrl, SHEET1, { cells: {}, rowCount: 3, columnCount: 3 });
    assert.equal(result.status, 200);
    assert.deepEqual(sheetOf(result.body.workbook, SHEET1).selection, {
      start: "C3",
      end: "C3",
    });
  } finally {
    await api.close();
  }
});

test("unusable states are rejected without touching the worksheet", async () => {
  const api = await startApi();
  try {
    const before = await openWorkbook(api.baseUrl);
    const cases = [
      { payload: undefined, error: "Invalid worksheet state" },
      { payload: { cells: [] }, error: "Invalid worksheet state" },
      { payload: { cells: { A1: 5 } }, error: "Invalid worksheet state" },
      { payload: { cells: { nope: "x" } }, error: "Invalid worksheet state" },
      { payload: { cells: { A51: "x" } }, error: "Invalid worksheet state" },
      { payload: { cells: { A1: "x" }, rowCount: 0 }, error: "Invalid row count" },
      { payload: { cells: { A1: "x" }, rowCount: 2.5 }, error: "Invalid row count" },
      { payload: { cells: { A1: "x" }, columnCount: -3 }, error: "Invalid column count" },
      { payload: { cells: { A1: "x" }, validations: "nope" }, error: "Invalid validation rules" },
      {
        payload: { cells: { A1: "x" }, validations: [{ id: "v", range: "bogus", type: "number-range", min: 0, max: 1 }] },
        error: "Invalid validation rules",
      },
    ];

    for (const entry of cases) {
      const rejected = await restore(api.baseUrl, SHEET1, entry.payload);
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, entry.error);
    }

    const missingSheet = await restore(api.baseUrl, "missing", { cells: {} });
    assert.equal(missingSheet.status, 404);
    assert.equal(missingSheet.body.error, "Worksheet not found");

    const missingWorkbook = await callJson(
      api.baseUrl,
      `/api/workbooks/nope/sheets/${SHEET1}/state`,
      { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ cells: {} }) },
    );
    assert.equal(missingWorkbook.status, 404);
    assert.equal(missingWorkbook.body.error, "Workbook not found");

    const wrongMethod = await callJson(
      api.baseUrl,
      `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}/state`,
      { method: "GET" },
    );
    assert.equal(wrongMethod.status, 405);

    const after = await openWorkbook(api.baseUrl);
    assert.deepEqual(after.body.workbook, before.body.workbook);
  } finally {
    await api.close();
  }
});

test("the state of one worksheet is restored without touching another worksheet", async () => {
  const api = await startApi();
  try {
    const result = await restore(api.baseUrl, "wb-q3-sales-sheet-2", {
      cells: { A1: "Sheet2 only" },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(sheetOf(result.body.workbook, SHEET1).cells, SEED_CELLS);
    assert.deepEqual(sheetOf(result.body.workbook, "wb-q3-sales-sheet-2").cells, {
      A1: "Sheet2 only",
    });
  } finally {
    await api.close();
  }
});
