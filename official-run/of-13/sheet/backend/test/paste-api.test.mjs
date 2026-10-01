import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApiHandler } from "../src/api.mjs";
import { createWorkbookStore } from "../src/store.mjs";
import { parsePastedText } from "../src/domain/paste.mjs";

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
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-paste-"));
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

function paste(baseUrl, sheetId, payload) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${sheetId}/paste`, {
    method: "POST",
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

test("parses tab separated columns and newline separated rows", () => {
  assert.deepEqual(parsePastedText("East\t1200\nNorth\t800"), [
    ["East", "1200"],
    ["North", "800"],
  ]);
  assert.deepEqual(parsePastedText("a\tb\r\nc\td\r\n"), [
    ["a", "b"],
    ["c", "d"],
  ]);
  assert.deepEqual(parsePastedText("a\t\tb"), [["a", "", "b"]]);
  assert.deepEqual(parsePastedText(""), []);
});

test("applies the whole rectangle from the starting cell and persists it", async () => {
  const api = await startApi();
  try {
    const result = await paste(api.baseUrl, SHEET1, {
      start: "D1",
      text: "East\t1200\nNorth\t800",
    });
    assert.equal(result.status, 200);
    const sheet = sheetOf(result.body.workbook, SHEET1);
    assert.equal(sheet.cells.D1, "East");
    assert.equal(sheet.cells.E1, "1200");
    assert.equal(sheet.cells.D2, "North");
    assert.equal(sheet.cells.E2, "800");
    // Cells outside the pasted rectangle keep their original values.
    assert.equal(sheet.cells.A1, "Region");
    assert.equal(sheet.cells.A2, "East");
    assert.equal(sheet.cells.B2, "1200");

    const restarted = await createWorkbookStore(api.directory).read();
    const stored = sheetOf(restarted.workbooks[0], SHEET1);
    assert.equal(stored.cells.E2, "800");
  } finally {
    await api.close();
  }
});

test("preserves empty fields and clears the cells a short row leaves empty", async () => {
  const api = await startApi();
  try {
    await paste(api.baseUrl, SHEET1, { start: "D1", text: "x\ty\tz" });
    const narrowed = await paste(api.baseUrl, SHEET1, { start: "D1", text: "a\t\tc" });
    assert.equal(narrowed.status, 200);
    const sheet = sheetOf(narrowed.body.workbook, SHEET1);
    assert.equal(sheet.cells.D1, "a");
    assert.equal(sheet.cells.E1, undefined);
    assert.equal(sheet.cells.F1, "c");
  } finally {
    await api.close();
  }
});

test("overwrites formulas inside the target and recalculates related formulas", async () => {
  const api = await startApi();
  try {
    await paste(api.baseUrl, SHEET1, { start: "D1", text: "=A2&B2" });
    await paste(api.baseUrl, SHEET1, { start: "D1", text: "Item/Qty" });
    const sheet = sheetOf((await openWorkbook(api.baseUrl)).body.workbook, SHEET1);
    assert.equal(sheet.cells.D1, "Item/Qty");
    assert.equal(sheet.values.D1, "Item/Qty");

    // Formulas that depend on the pasted source cells follow the new values.
    await paste(api.baseUrl, SHEET1, { start: "A2", text: "4" });
    await paste(api.baseUrl, SHEET1, { start: "B2", text: "=A2*2" });
    let current = sheetOf((await openWorkbook(api.baseUrl)).body.workbook, SHEET1);
    assert.equal(current.values.B2, "8");

    await paste(api.baseUrl, SHEET1, { start: "C2", text: "=B2+A2" });
    current = sheetOf((await openWorkbook(api.baseUrl)).body.workbook, SHEET1);
    assert.equal(current.values.C2, "12");

    await paste(api.baseUrl, SHEET1, { start: "A2", text: "10" });
    current = sheetOf((await openWorkbook(api.baseUrl)).body.workbook, SHEET1);
    assert.equal(current.cells.B2, "=A2*2");
    assert.equal(current.values.B2, "20");
    assert.equal(current.values.C2, "30");
  } finally {
    await api.close();
  }
});

test("rejects a rectangle that does not fit in the worksheet without writing anything", async () => {
  const api = await startApi();
  try {
    const before = await openWorkbook(api.baseUrl);
    const rejected = await paste(api.baseUrl, SHEET1, {
      start: "Y1",
      text: "a\tb\tc",
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "The pasted range does not fit in the worksheet");

    const badStart = await paste(api.baseUrl, SHEET1, { start: "1A", text: "a" });
    assert.equal(badStart.status, 400);
    assert.equal(badStart.body.error, "Invalid cell address");

    const after = await openWorkbook(api.baseUrl);
    assert.deepEqual(after.body.workbook, before.body.workbook);
  } finally {
    await api.close();
  }
});

test("a rejected paste leaves every target cell with its original value", async () => {
  const api = await startApi();
  try {
    await api.store.update((state) => {
      const sheet = sheetOf(state.workbooks[0], SHEET1);
      sheet.cells.D1 = "10";
      sheet.cells.E1 = "20";
      sheet.cells.D2 = "30";
      sheet.cells.E2 = "40";
      sheet.validations = [
        { id: "rule-1", range: "D1:E2", type: "number-range", min: 0, max: 100 },
      ];
      return state;
    });

    const rejected = await paste(api.baseUrl, SHEET1, { start: "D1", text: "1\t2\n3\t101" });
    assert.equal(rejected.status, 400);
    // A 0-to-100 boundary rule uses the wording of the persisted boundary scenario.
    assert.equal(rejected.body.error, "Please enter a number from 0 to 100");

    const sheet = sheetOf((await openWorkbook(api.baseUrl)).body.workbook, SHEET1);
    assert.deepEqual(
      { D1: sheet.cells.D1, E1: sheet.cells.E1, D2: sheet.cells.D2, E2: sheet.cells.E2 },
      { D1: "10", E1: "20", D2: "30", E2: "40" },
    );

    const accepted = await paste(api.baseUrl, SHEET1, { start: "D1", text: "1\t2\n3\t4" });
    assert.equal(accepted.status, 200);
    const updated = sheetOf(accepted.body.workbook, SHEET1);
    assert.deepEqual(
      { D1: updated.cells.D1, E1: updated.cells.E1, D2: updated.cells.D2, E2: updated.cells.E2 },
      { D1: "1", E1: "2", D2: "3", E2: "4" },
    );
  } finally {
    await api.close();
  }
});

test("pasting stays inside the addressed worksheet and rejects unknown worksheets", async () => {
  const api = await startApi();
  try {
    const result = await paste(api.baseUrl, SHEET2, { start: "A1", text: "a\tb" });
    assert.equal(result.status, 200);
    const workbook = result.body.workbook;
    assert.deepEqual(sheetOf(workbook, SHEET1).cells, SEED_CELLS);
    assert.equal(sheetOf(workbook, SHEET2).cells.B1, "b");

    const missing = await paste(api.baseUrl, "missing-sheet", { start: "A1", text: "a" });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, "Worksheet not found");

    const wrongMethod = await callJson(
      api.baseUrl,
      `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}/paste`,
      { method: "GET" },
    );
    assert.equal(wrongMethod.status, 405);
  } finally {
    await api.close();
  }
});
