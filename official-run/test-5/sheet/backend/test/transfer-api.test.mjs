import test from "node:test";
import assert from "node:assert/strict";

import { request, startApp } from "./support.mjs";

const WORKBOOK = "/api/workbooks/wb-q3-sales";
const SHEET1 = `${WORKBOOK}/worksheets/ws-q3-sheet1`;
const TRANSFER = `${SHEET1}/range-transfer`;

function sheetOf(workbook, id = "ws-q3-sheet1") {
  return workbook.worksheets.find((sheet) => sheet.id === id);
}

function transfer(baseUrl, body, path = TRANSFER) {
  return request(baseUrl, path, { method: "POST", body: JSON.stringify(body) });
}

function write(baseUrl, updates) {
  return request(baseUrl, `${SHEET1}/cells`, { method: "POST", body: JSON.stringify({ updates }) });
}

test("a copy keeps the source and writes the whole rectangle to the target", async () => {
  const app = await startApp();
  try {
    const copied = await transfer(app.baseUrl, {
      mode: "copy",
      source: { start: "A1", end: "B2" },
      target: { start: "D1", end: "E2" },
    });
    assert.equal(copied.status, 200);
    const sheet = sheetOf(copied.body.workbook);
    // A1:B2 is the Region/Sales header row plus East/1200, so the copy keeps that layout.
    assert.equal(sheet.values.D1, "Region");
    assert.equal(sheet.values.E1, "Sales");
    assert.equal(sheet.values.D2, "East");
    assert.equal(sheet.values.E2, "1200");
    // The source range and every cell outside both rectangles are untouched.
    assert.equal(sheet.cells.A1, "Region");
    assert.equal(sheet.cells.A2, "East");
    assert.equal(sheet.cells.B2, "1200");
    assert.equal(sheet.cells.C1, "Status");
    assert.equal(sheet.cells.C3, "Closed");
    assert.equal(Object.hasOwn(sheet.cells, "D3"), false);

    // The result survives a refresh/reopen.
    const reopened = await request(app.baseUrl, WORKBOOK);
    const persisted = sheetOf(reopened.body.workbook);
    assert.equal(persisted.cells.D1, "Region");
    assert.equal(persisted.cells.D2, "East");
    assert.equal(persisted.cells.E2, "1200");
    assert.equal(persisted.cells.A1, "Region");
    assert.equal(persisted.cells.B3, "800");
  } finally {
    await app.close();
  }
});

test("a cut writes the target and clears the source in the same write", async () => {
  const app = await startApp();
  try {
    const cut = await transfer(app.baseUrl, {
      mode: "cut",
      source: { start: "A2", end: "B2" },
      target: { start: "D5", end: "E5" },
    });
    assert.equal(cut.status, 200);
    const sheet = sheetOf(cut.body.workbook);
    assert.equal(sheet.values.D5, "East");
    assert.equal(sheet.values.E5, "1200");
    assert.equal(Object.hasOwn(sheet.cells, "A2"), false);
    assert.equal(Object.hasOwn(sheet.cells, "B2"), false);
    // Rows outside the moved rectangle keep their own values.
    assert.equal(sheet.cells.A3, "North");
    assert.equal(sheet.cells.B3, "800");

    const reopened = await request(app.baseUrl, WORKBOOK);
    const refreshed = sheetOf(reopened.body.workbook);
    assert.equal(Object.hasOwn(refreshed.cells, "A2"), false);
    assert.equal(refreshed.cells.D5, "East");
  } finally {
    await app.close();
  }
});

test("a copied formula keeps its layout, adjusts relative references and shows the result", async () => {
  const app = await startApp();
  try {
    await write(app.baseUrl, { A10: "=B10+1", B10: "5", A11: "=$B$10+A10" });
    const copied = await transfer(app.baseUrl, {
      mode: "copy",
      source: { start: "A10", end: "B11" },
      target: { start: "D10", end: "E11" },
    });
    assert.equal(copied.status, 200);
    const sheet = sheetOf(copied.body.workbook);
    // The formula bar reads the stored text: the adjusted original formula.
    assert.equal(sheet.cells.D10, "=E10+1");
    assert.equal(sheet.values.D10, "6");
    assert.equal(sheet.values.E10, "5");
    assert.equal(sheet.cells.D11, "=$B$10+D10");
    assert.equal(sheet.values.D11, "11");
    // Direct and indirect dependents of the copied source recalculate.
    assert.equal(sheet.values.A10, "6");
    assert.equal(sheet.values.A11, "11");
  } finally {
    await app.close();
  }
});

test("a validation rule on the target rejects the whole transfer with its message", async () => {
  const app = await startApp();
  try {
    await request(app.baseUrl, SHEET1, {
      method: "PATCH",
      body: JSON.stringify({ validations: [{ id: "qty", range: "D1:E2", type: "number-between", min: 0, max: 100 }] }),
    });
    const before = await request(app.baseUrl, WORKBOOK);

    const rejected = await transfer(app.baseUrl, {
      mode: "copy",
      source: { start: "A2", end: "B3" },
      target: { start: "D1", end: "E2" },
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Please enter a number from 0 to 100");

    const after = await request(app.baseUrl, WORKBOOK);
    assert.deepEqual(after.body.workbook, before.body.workbook);

    // A cut at the same target leaves the source in place as well.
    const cut = await transfer(app.baseUrl, {
      mode: "cut",
      source: { start: "A2", end: "B2" },
      target: { start: "D1", end: "E1" },
    });
    assert.equal(cut.status, 400);
    assert.equal(cut.body.error, "Please enter a number from 0 to 100");
    const unchanged = await request(app.baseUrl, WORKBOOK);
    assert.equal(sheetOf(unchanged.body.workbook).cells.A2, "East");
    assert.equal(sheetOf(unchanged.body.workbook).cells.B2, "1200");
  } finally {
    await app.close();
  }
});

test("rejects an unknown mode, a bad range and a target that leaves the grid", async () => {
  const app = await startApp();
  try {
    const mode = await transfer(app.baseUrl, {
      mode: "move",
      source: { start: "A1", end: "B2" },
      target: { start: "D1", end: "E2" },
    });
    assert.equal(mode.status, 400);
    assert.equal(mode.body.error, "Unknown transfer mode");

    const range = await transfer(app.baseUrl, {
      mode: "copy",
      source: { start: "??", end: "B2" },
      target: "D1",
    });
    assert.equal(range.status, 400);
    assert.equal(range.body.error, "Invalid range");

    const outside = await transfer(app.baseUrl, {
      mode: "copy",
      source: { start: "A1", end: "B2" },
      target: "T40",
    });
    assert.equal(outside.status, 400);
    assert.equal(outside.body.error, "Cell is outside the worksheet bounds");

    const missingSheet = await transfer(
      app.baseUrl,
      { mode: "copy", source: "A1", target: "D1" },
      `${WORKBOOK}/worksheets/nope/range-transfer`,
    );
    assert.equal(missingSheet.status, 404);

    const after = await request(app.baseUrl, WORKBOOK);
    assert.deepEqual(sheetOf(after.body.workbook).cells, {
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
  } finally {
    await app.close();
  }
});

test("a transfer of another worksheet does not touch the active one", async () => {
  const app = await startApp();
  try {
    const sheet2 = `${WORKBOOK}/worksheets/ws-q3-sheet2/range-transfer`;
    const copied = await transfer(
      app.baseUrl,
      { mode: "copy", source: { start: "A1", end: "A1" }, target: { start: "E5", end: "E5" } },
      sheet2,
    );
    assert.equal(copied.status, 200);
    const sheet1 = sheetOf(copied.body.workbook, "ws-q3-sheet1");
    assert.equal(Object.hasOwn(sheet1.cells, "E5"), false);
    assert.equal(sheet1.cells.A1, "Region");
  } finally {
    await app.close();
  }
});
