import test from "node:test";
import assert from "node:assert/strict";

import { request, requestRaw, startApp } from "./support.mjs";

const WORKBOOK = "/api/workbooks/wb-q3-sales";
const SHEET1 = `${WORKBOOK}/worksheets/ws-q3-sheet1`;
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

function patchFilter(baseUrl, filter, path = SHEET1) {
  return request(baseUrl, path, { method: "PATCH", body: JSON.stringify({ filter }) });
}

function createDataFilter(baseUrl, columns, path = SHEET1) {
  return patchFilter(baseUrl, { range: { start: "A1", end: "C6" }, columns }, path);
}

function patchValidations(baseUrl, validations, path = SHEET1) {
  return request(baseUrl, path, { method: "PATCH", body: JSON.stringify({ validations }) });
}

function writeCells(baseUrl, updates, path = `${SHEET1}/cells`) {
  return request(baseUrl, path, { method: "POST", body: JSON.stringify({ updates }) });
}

test("a value filter hides only the nonmatching records and survives a reopen", async () => {
  const app = await startApp();
  try {
    const created = await createDataFilter(app.baseUrl, {
      A: { kind: "values", values: ["East", "South"] },
    });
    assert.equal(created.status, 200);
    const sheet = sheet1(created.body.workbook);
    assert.deepEqual(sheet.filter, {
      range: { start: "A1", end: "C6" },
      columns: { A: { kind: "values", values: ["East", "South"] } },
    });
    // Only visibility changes: the hidden record keeps its values and position.
    assert.deepEqual(sheet.hiddenRows, [3, 5, 6]);
    assert.deepEqual(sheet.cells, SEED_CELLS);
    assert.equal(sheet.values.A3, "North");
    assert.deepEqual(created.body.workbook.worksheets[1].hiddenRows, []);

    const reopened = await request(app.baseUrl, WORKBOOK);
    const persisted = sheet1(reopened.body.workbook);
    assert.deepEqual(persisted.filter, sheet.filter);
    assert.deepEqual(persisted.hiddenRows, [3, 5, 6]);
    assert.deepEqual(persisted.cells, SEED_CELLS);
  } finally {
    await app.close();
  }
});

test("conditions of different columns are combined with AND and stay per worksheet", async () => {
  const app = await startApp();
  try {
    const created = await createDataFilter(app.baseUrl, {
      B: { kind: "condition", operator: "greater-than", value: "1000" },
      C: { kind: "condition", operator: "is-not-empty", value: "" },
    });
    assert.equal(created.status, 200);
    assert.deepEqual(sheet1(created.body.workbook).hiddenRows, [3, 4, 5, 6]);

    const sheet2 = `${WORKBOOK}/worksheets/ws-q3-sheet2`;
    const other = await createDataFilter(app.baseUrl, {}, sheet2);
    assert.equal(other.status, 200);
    assert.deepEqual(sheet1(other.body.workbook).filter.columns, {
      B: { kind: "condition", operator: "greater-than", value: "1000" },
      C: { kind: "condition", operator: "is-not-empty", value: "" },
    });
    const otherSheet = other.body.workbook.worksheets.find((sheet) => sheet.id === "ws-q3-sheet2");
    assert.deepEqual(otherSheet.filter, { range: { start: "A1", end: "C6" }, columns: {} });
    assert.deepEqual(otherSheet.hiddenRows, []);
  } finally {
    await app.close();
  }
});

test("exporting and reading the grid keep every hidden record", async () => {
  const app = await startApp();
  try {
    await createDataFilter(app.baseUrl, { C: { kind: "values", values: ["Closed"] } });
    const filtered = await request(app.baseUrl, WORKBOOK);
    assert.deepEqual(sheet1(filtered.body.workbook).hiddenRows, [2, 4, 5, 6]);

    const exported = await requestRaw(app.baseUrl, `${SHEET1}/export`);
    assert.equal(exported.status, 200);
    assert.equal(
      exported.text,
      "Region,Sales,Status\nEast,1200,Open\nNorth,800,Closed\nSouth,700,Open",
    );
  } finally {
    await app.close();
  }
});

test("clear filter brings every record back in its original order and values", async () => {
  const app = await startApp();
  try {
    await createDataFilter(app.baseUrl, { A: { kind: "values", values: ["East"] } });
    const cleared = await patchFilter(app.baseUrl, null);
    assert.equal(cleared.status, 200);
    const sheet = sheet1(cleared.body.workbook);
    assert.equal(sheet.filter, null);
    assert.deepEqual(sheet.hiddenRows, []);
    assert.deepEqual(sheet.cells, SEED_CELLS);
    assert.deepEqual(sheet.values.A2, "East");
    assert.deepEqual(sheet.values.A4, "South");

    const reopened = await request(app.baseUrl, WORKBOOK);
    assert.equal(sheet1(reopened.body.workbook).filter, null);
    assert.deepEqual(sheet1(reopened.body.workbook).hiddenRows, []);
  } finally {
    await app.close();
  }
});

test("a filter the server cannot enforce is rejected without touching the stored one", async () => {
  const app = await startApp();
  try {
    await createDataFilter(app.baseUrl, { A: { kind: "values", values: ["East"] } });

    const outsideRange = await createDataFilter(app.baseUrl, {
      D: { kind: "values", values: ["East"] },
    });
    assert.equal(outsideRange.status, 400);
    assert.equal(outsideRange.body.error, "Invalid filter");

    const unknownOperator = await createDataFilter(app.baseUrl, {
      A: { kind: "condition", operator: "equals", value: "East" },
    });
    assert.equal(unknownOperator.status, 400);
    assert.equal(unknownOperator.body.error, "Invalid filter");

    const missingValue = await createDataFilter(app.baseUrl, {
      A: { kind: "condition", operator: "text-contains", value: " " },
    });
    assert.equal(missingValue.status, 400);

    const after = await request(app.baseUrl, WORKBOOK);
    assert.deepEqual(sheet1(after.body.workbook).filter, {
      range: { start: "A1", end: "C6" },
      columns: { A: { kind: "values", values: ["East"] } },
    });
    assert.deepEqual(sheet1(after.body.workbook).cells, SEED_CELLS);
  } finally {
    await app.close();
  }
});

test("row and column changes move the filtered region together with its data", async () => {
  const app = await startApp();
  try {
    await createDataFilter(app.baseUrl, { B: { kind: "condition", operator: "greater-than", value: "1000" } });

    const rowInserted = await request(app.baseUrl, `${SHEET1}/rows`, {
      method: "POST",
      body: JSON.stringify({ op: "insert-row-above", row: 1 }),
    });
    assert.equal(rowInserted.status, 200);
    const afterRow = sheet1(rowInserted.body.workbook);
    assert.deepEqual(afterRow.filter.range, { start: "A2", end: "C7" });
    assert.deepEqual(Object.keys(afterRow.filter.columns), ["B"]);
    assert.deepEqual(afterRow.hiddenRows, [4, 5, 6, 7]);

    const columnDeleted = await request(app.baseUrl, `${SHEET1}/columns`, {
      method: "POST",
      body: JSON.stringify({ op: "delete-column", column: 1 }),
    });
    assert.equal(columnDeleted.status, 200);
    const afterColumn = sheet1(columnDeleted.body.workbook);
    assert.deepEqual(afterColumn.filter.range, { start: "A2", end: "B7" });
    assert.deepEqual(Object.keys(afterColumn.filter.columns), ["A"]);
    assert.deepEqual(afterColumn.hiddenRows, [4, 5, 6, 7]);
  } finally {
    await app.close();
  }
});

test("undo restores the filter view of the previous step", async () => {
  const app = await startApp();
  try {
    await createDataFilter(app.baseUrl, { A: { kind: "values", values: ["East"] } });
    const undone = await request(app.baseUrl, `${WORKBOOK}/undo`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert.equal(undone.status, 200);
    assert.equal(sheet1(undone.body.workbook).filter, null);
    assert.deepEqual(sheet1(undone.body.workbook).hiddenRows, []);

    const redone = await request(app.baseUrl, `${WORKBOOK}/redo`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert.deepEqual(sheet1(redone.body.workbook).hiddenRows, [3, 4, 5, 6]);
  } finally {
    await app.close();
  }
});

test("a dropdown rule rejects other input through grid writes and pastes", async () => {
  const app = await startApp();
  try {
    const saved = await patchValidations(app.baseUrl, [
      { id: "rule-1", range: "A2:A4", type: "dropdown", values: ["East", "North", "South"] },
    ]);
    assert.equal(saved.status, 200);
    const sheet = sheet1(saved.body.workbook);
    assert.deepEqual(sheet.validations, [
      {
        id: "rule-1",
        range: { start: "A2", end: "A4" },
        type: "dropdown",
        values: ["East", "North", "South"],
        message: "Please select one of the following values: East, North, South",
      },
    ]);
    // Existing valid values stay untouched.
    assert.deepEqual(sheet.cells, SEED_CELLS);

    const rejected = await writeCells(app.baseUrl, { A3: "West" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Please select one of the following values: East, North, South");

    const pasted = await writeCells(app.baseUrl, { A3: "West", B3: "900" });
    assert.equal(pasted.status, 400);
    const after = await request(app.baseUrl, WORKBOOK);
    assert.equal(sheet1(after.body.workbook).cells.A3, "North");
    assert.equal(sheet1(after.body.workbook).cells.B3, "800");

    const accepted = await writeCells(app.baseUrl, { A3: "South" });
    assert.equal(accepted.status, 200);
    assert.equal(sheet1(accepted.body.workbook).cells.A3, "South");

    const cleared = await writeCells(app.baseUrl, { A3: "" });
    assert.equal(cleared.status, 200);
    assert.equal(sheet1(cleared.body.workbook).validations.length, 1);
  } finally {
    await app.close();
  }
});

test("a numeric range rule created with its own message rejects an out-of-range value", async () => {
  const app = await startApp();
  try {
    const saved = await patchValidations(app.baseUrl, [
      {
        id: "rule-1",
        range: "B2:B4",
        type: "number-between",
        min: 0,
        max: 100,
        message: "Please enter a number between 0 and 100",
      },
    ]);
    assert.equal(saved.status, 200);

    const rejected = await writeCells(app.baseUrl, { B3: "101" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Please enter a number between 0 and 100");

    const accepted = await writeCells(app.baseUrl, { B3: "100" });
    assert.equal(accepted.status, 200);
    assert.equal(sheet1(accepted.body.workbook).cells.B3, "100");
  } finally {
    await app.close();
  }
});
