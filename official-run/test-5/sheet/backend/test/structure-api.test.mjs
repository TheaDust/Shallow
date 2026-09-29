import test from "node:test";
import assert from "node:assert/strict";

import { createJsonStore } from "../src/lib/json-store.mjs";
import { createSeedState } from "../src/domain/workbooks.mjs";
import { request, startApp } from "./support.mjs";

const WORKBOOK = "/api/workbooks/wb-q3-sales";
const SHEET1 = `${WORKBOOK}/worksheets/ws-q3-sheet1`;

/** Seeded data region A1:C6: headers plus the three Q3 records. */
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

function sheet1(workbook) {
  return workbook.worksheets.find((sheet) => sheet.id === "ws-q3-sheet1");
}

/** Copy of the seed cells without the coordinates a test replaces. */
function withoutSeedCells(coordinates) {
  return Object.fromEntries(Object.entries(SEED_CELLS).filter(([key]) => !coordinates.includes(key)));
}

test("inserting a row below shifts the following records of the active worksheet only", async () => {
  const app = await startApp();
  try {
    const response = await request(app.baseUrl, `${SHEET1}/rows`, {
      method: "POST",
      body: JSON.stringify({ op: "insert-row-below", row: 2 }),
    });
    assert.equal(response.status, 200);
    const sheet = sheet1(response.body.workbook);
    assert.deepEqual(sheet.cells, {
      ...withoutSeedCells(["A3", "B3", "C3"]),
      A4: "North",
      B4: "800",
      C4: "Closed",
      A5: "South",
      B5: "700",
      C5: "Open",
    });
    assert.deepEqual(response.body.workbook.worksheets[1].cells, {});

    const reopened = await request(app.baseUrl, WORKBOOK);
    assert.deepEqual(sheet1(reopened.body.workbook).cells, sheet.cells);

    const restarted = createJsonStore(app.storePath, createSeedState());
    const persisted = await restarted.read();
    assert.deepEqual(persisted.workbooks[0].worksheets[0].cells, sheet.cells);
  } finally {
    await app.close();
  }
});

test("inserting a row above moves the target row and the formulas that follow it", async () => {
  const app = await startApp();
  try {
    const store = createJsonStore(app.storePath, createSeedState());
    await store.update((draft) => {
      draft.workbooks[0].worksheets[0].cells.E1 = "=SUM(A2:B3)";
      draft.workbooks[0].worksheets[0].cells.A5 = "=B2";
    });

    const response = await request(app.baseUrl, `${SHEET1}/rows`, {
      method: "POST",
      body: JSON.stringify({ op: "insert-row-above", row: 2 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(sheet1(response.body.workbook).cells, {
      ...withoutSeedCells(["A2", "B2", "C2", "A3", "B3", "C3"]),
      A3: "East",
      B3: "1200",
      C3: "Open",
      A4: "North",
      B4: "800",
      C4: "Closed",
      A5: "South",
      B5: "700",
      C5: "Open",
      E1: "=SUM(A3:B4)",
      A6: "=B3",
    });
  } finally {
    await app.close();
  }
});

test("deleting a row drops the target record and pulls the next ones up", async () => {
  const app = await startApp();
  try {
    const response = await request(app.baseUrl, `${SHEET1}/rows`, {
      method: "POST",
      body: JSON.stringify({ op: "delete-row", row: 2 }),
    });
    assert.equal(response.status, 200);
    const sheet = sheet1(response.body.workbook);
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

    const reopened = await request(app.baseUrl, WORKBOOK);
    assert.deepEqual(sheet1(reopened.body.workbook).cells, sheet.cells);
  } finally {
    await app.close();
  }
});

test("column operations accept a column letter and keep the untouched columns", async () => {
  const app = await startApp();
  try {
    const inserted = await request(app.baseUrl, `${SHEET1}/columns`, {
      method: "POST",
      body: JSON.stringify({ op: "insert-column-left", column: "B" }),
    });
    assert.equal(inserted.status, 200);
    assert.deepEqual(sheet1(inserted.body.workbook).cells, {
      A1: "Region",
      C1: "Sales",
      D1: "Status",
      A2: "East",
      C2: "1200",
      D2: "Open",
      A3: "North",
      C3: "800",
      D3: "Closed",
      A4: "South",
      C4: "700",
      D4: "Open",
    });

    const deleted = await request(app.baseUrl, `${SHEET1}/columns`, {
      method: "POST",
      body: JSON.stringify({ op: "delete-column", column: 1 }),
    });
    assert.equal(deleted.status, 200);
    assert.deepEqual(sheet1(deleted.body.workbook).cells, {
      B1: "Sales",
      C1: "Status",
      B2: "1200",
      C2: "Open",
      B3: "800",
      C3: "Closed",
      B4: "700",
      C4: "Open",
    });
    assert.deepEqual(deleted.body.workbook.worksheets[1].cells, {});
  } finally {
    await app.close();
  }
});

test("rejected structure requests keep the stored worksheet unchanged", async () => {
  const app = await startApp();
  try {
    const original = sheet1((await request(app.baseUrl, WORKBOOK)).body.workbook).cells;

    const unknownOp = await request(app.baseUrl, `${SHEET1}/rows`, {
      method: "POST",
      body: JSON.stringify({ op: "insert-row", row: 2 }),
    });
    assert.equal(unknownOp.status, 400);
    assert.equal(unknownOp.body.error, "Unknown row operation");

    const badRow = await request(app.baseUrl, `${SHEET1}/rows`, {
      method: "POST",
      body: JSON.stringify({ op: "delete-row", row: 0 }),
    });
    assert.equal(badRow.status, 400);
    assert.equal(badRow.body.error, "Invalid row number");

    const badColumn = await request(app.baseUrl, `${SHEET1}/columns`, {
      method: "POST",
      body: JSON.stringify({ op: "delete-column", column: 21 }),
    });
    assert.equal(badColumn.status, 400);
    assert.equal(badColumn.body.error, "Invalid column");

    const missingSheet = await request(app.baseUrl, `${WORKBOOK}/worksheets/ws-missing/rows`, {
      method: "POST",
      body: JSON.stringify({ op: "delete-row", row: 1 }),
    });
    assert.equal(missingSheet.status, 404);

    const after = await request(app.baseUrl, WORKBOOK);
    assert.deepEqual(sheet1(after.body.workbook).cells, original);
  } finally {
    await app.close();
  }
});
