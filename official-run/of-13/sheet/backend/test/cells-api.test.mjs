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
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-cells-"));
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

function openWorkbook(baseUrl, workbookId = WORKBOOK) {
  return callJson(baseUrl, `/api/workbooks/${workbookId}`);
}

function sheetOf(workbook, sheetId) {
  return workbook.sheets.find((sheet) => sheet.id === sheetId);
}

test("commits a value through the cell endpoint and shows it in grid and formula bar", async () => {
  const api = await startApi();
  try {
    const written = await putCell(api.baseUrl, SHEET1, "D1", "East");
    assert.equal(written.status, 200);
    const sheet = sheetOf(written.body.workbook, SHEET1);
    assert.equal(sheet.cells.D1, "East");
    assert.equal(sheet.values.D1, "East");

    const reopened = await openWorkbook(api.baseUrl);
    assert.equal(sheetOf(reopened.body.workbook, SHEET1).cells.D1, "East");

    const restarted = await createWorkbookStore(api.directory).read();
    assert.equal(sheetOf(restarted.workbooks[0], SHEET1).cells.D1, "East");
  } finally {
    await api.close();
  }
});

test("keeps ordinary text, numeric-looking text and date text exactly as submitted", async () => {
  const api = await startApi();
  try {
    const values = [
      ["A1", "Item/Qty"],
      ["A2", "Pen/4"],
      ["B1", "true"],
      ["B2", "2026-03-14"],
      ["C1", "0012"],
    ];
    for (const [address, value] of values) {
      const written = await putCell(api.baseUrl, SHEET1, address, value);
      assert.equal(written.status, 200);
    }
    const sheet = sheetOf((await openWorkbook(api.baseUrl)).body.workbook, SHEET1);
    for (const [address, value] of values) {
      assert.equal(sheet.cells[address], value);
      assert.equal(sheet.values[address], value);
    }
  } finally {
    await api.close();
  }
});

test("stores the original formula and computes directly and indirectly dependent results", async () => {
  const api = await startApi();
  try {
    await putCell(api.baseUrl, SHEET1, "D1", "=A1+B1");
    const first = await putCell(api.baseUrl, SHEET1, "E1", "=D1*2");
    const source = await putCell(api.baseUrl, SHEET1, "A1", "2");
    const second = await putCell(api.baseUrl, SHEET1, "B1", "3");
    assert.equal(second.status, 200);
    assert.equal(source.status, 200);
    assert.equal(first.status, 200);

    // The stored text is still the submitted formula; the grid value is the result.
    let sheet = sheetOf((await openWorkbook(api.baseUrl)).body.workbook, SHEET1);
    assert.equal(sheet.cells.D1, "=A1+B1");
    assert.equal(sheet.values.D1, "5");
    assert.equal(sheet.cells.E1, "=D1*2");
    assert.equal(sheet.values.E1, "10");

    // Committing a new source value recalculates every dependent formula.
    await putCell(api.baseUrl, SHEET1, "A1", "5");
    sheet = sheetOf((await openWorkbook(api.baseUrl)).body.workbook, SHEET1);
    assert.equal(sheet.values.D1, "8");
    assert.equal(sheet.values.E1, "16");

    const restarted = await createWorkbookStore(api.directory).read();
    const stored = sheetOf(restarted.workbooks[0], SHEET1);
    assert.equal(stored.cells.D1, "=A1+B1");
  } finally {
    await api.close();
  }
});

test("keeps stable visible error values for failing formulas", async () => {
  const api = await startApi();
  try {
    const results = {
      A1: ["=1/0", "#DIV/0!"],
      B1: ["=ZZ1", "#REF!"],
      C1: ["=NOPE(1)", "#NAME?"],
      D1: ["=1+", "#ERROR!"],
      E1: ["=E1+1", "#REF!"],
    };
    for (const [address, [formula]] of Object.entries(results)) {
      const written = await putCell(api.baseUrl, SHEET1, address, formula);
      assert.equal(written.status, 200);
    }
    const sheet = sheetOf((await openWorkbook(api.baseUrl)).body.workbook, SHEET1);
    for (const [address, [formula, display]] of Object.entries(results)) {
      assert.equal(sheet.cells[address], formula);
      assert.equal(sheet.values[address], display);
    }
  } finally {
    await api.close();
  }
});

test("rejects an invalid address or a non-string value without touching the worksheet", async () => {
  const api = await startApi();
  try {
    const before = await openWorkbook(api.baseUrl);
    for (const address of ["1A", "A0", "AA1", "A100", "hello"]) {
      const rejected = await putCell(api.baseUrl, SHEET1, address, "x");
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, "Invalid cell address");
    }
    const badValue = await putCell(api.baseUrl, SHEET1, "A1", 42);
    assert.equal(badValue.status, 400);
    assert.equal(badValue.body.error, "Invalid cell value");

    const missingSheet = await putCell(api.baseUrl, "missing-sheet", "A1", "x");
    assert.equal(missingSheet.status, 404);
    assert.equal(missingSheet.body.error, "Worksheet not found");

    const wrongMethod = await callJson(
      api.baseUrl,
      `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}/cells/A1`,
      { method: "GET" },
    );
    assert.equal(wrongMethod.status, 405);

    const after = await openWorkbook(api.baseUrl);
    assert.deepEqual(after.body.workbook, before.body.workbook);
  } finally {
    await api.close();
  }
});

test("a validation rule rejects a commit in place and keeps the last successful value", async () => {
  const api = await startApi();
  try {
    await api.store.update((state) => {
      const sheet = sheetOf(state.workbooks[0], SHEET1);
      sheet.validations = [
        {
          id: "rule-1",
          range: "D1:E2",
          type: "number-range",
          min: 0,
          max: 100,
          message: "Please enter a number from 0 to 100",
        },
      ];
      return state;
    });

    const accepted = await putCell(api.baseUrl, SHEET1, "D1", "50");
    assert.equal(accepted.status, 200);
    const rejected = await putCell(api.baseUrl, SHEET1, "D1", "101");
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Please enter a number from 0 to 100");

    const sheet = sheetOf((await openWorkbook(api.baseUrl)).body.workbook, SHEET1);
    assert.equal(sheet.cells.D1, "50");
    assert.equal(sheet.values.D1, "50");
    assert.deepEqual(sheet.validations, [
      {
        id: "rule-1",
        range: "D1:E2",
        type: "number-range",
        min: 0,
        max: 100,
        message: "Please enter a number from 0 to 100",
      },
    ]);
  } finally {
    await api.close();
  }
});

test("writes only into the addressed worksheet", async () => {
  const api = await startApi();
  try {
    await putCell(api.baseUrl, SHEET2, "A1", "Only here");
    const workbook = (await openWorkbook(api.baseUrl)).body.workbook;
    assert.deepEqual(sheetOf(workbook, SHEET1).cells, {
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
    });
    assert.equal(sheetOf(workbook, SHEET2).cells.A1, "Only here");
    assert.equal(sheetOf(workbook, SHEET2).values.A1, "Only here");
  } finally {
    await api.close();
  }
});
