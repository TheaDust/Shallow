import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { SEED_WORKBOOK_ID, SEED_WORKSHEET_ID } from "../src/lib/seed.mjs";
import { compareCellText } from "../src/lib/sort.mjs";
import { createWorkbookRepository } from "../src/lib/workbook-store.mjs";

async function startTestServer() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-sort-"));
  const repository = createWorkbookRepository(directory);
  const server = createServer(createApp(repository));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function getWorkbook(base, id = SEED_WORKBOOK_ID) {
  const response = await fetch(`${base}/api/workbooks/${id}`);
  return (await response.json()).workbook;
}

function jsonRequest(base, path, method, payload) {
  return fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

const sheetPath = (workbookId = SEED_WORKBOOK_ID, worksheetId = SEED_WORKSHEET_ID) =>
  `/api/workbooks/${workbookId}/worksheets/${worksheetId}`;

function putCell(base, cellId, value) {
  return jsonRequest(base, `${sheetPath()}/cells/${cellId}`, "PUT", { value });
}

function sort(base, payload) {
  return jsonRequest(base, `${sheetPath()}/sort`, "POST", payload);
}

/** The records of a range as `[A, B, C]` rows, read from the stored worksheet. */
function rowsOf(sheet, top, bottom, left, right) {
  const rows = [];
  for (let row = top; row <= bottom; row += 1) {
    const record = [];
    for (let column = left; column <= right; column += 1) {
      const id = `${String.fromCharCode(64 + column)}${row}`;
      record.push(sheet.cells[id]?.value ?? "");
    }
    rows.push(record);
  }
  return rows;
}

test("compares numbers, dates and text by their own type", () => {
  assert.equal(compareCellText("700", "1200"), -1);
  assert.equal(compareCellText("1200", "700"), 1);
  assert.equal(compareCellText("10", "9"), 1);
  assert.equal(compareCellText("2025-12-31", "2026-01-05"), -1);
  assert.equal(compareCellText("East", "north"), -1);
  assert.equal(compareCellText("South", "South"), 0);
});

test("sorts the seeded range by a numeric column and keeps the header row on top", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const response = await sort(server.base, {
    range: "A1:C4",
    column: 2,
    order: "ascending",
    hasHeader: true,
  });
  assert.equal(response.status, 200);
  const workbook = (await response.json()).workbook;
  const sheet = workbook.worksheets[0];
  assert.deepEqual(rowsOf(sheet, 1, 4, 1, 3), [
    ["Region", "Sales", "Status"],
    ["South", "700", "Open"],
    ["North", "800", "Closed"],
    ["East", "1200", "Open"],
  ]);

  const reloaded = await getWorkbook(server.base);
  assert.deepEqual(rowsOf(reloaded.worksheets[0], 1, 4, 1, 3), rowsOf(sheet, 1, 4, 1, 3));

  // The second worksheet keeps its own blank state: a sort never leaves its worksheet.
  assert.deepEqual(reloaded.worksheets[1].cells, {});
});

test("sorts descending, keeps equal keys stable and puts blank keys last", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  assert.equal((await putCell(server.base, "A5", "West")).status, 200);
  assert.equal((await putCell(server.base, "B5", "800")).status, 200);
  assert.equal((await putCell(server.base, "C5", "Open")).status, 200);

  // A1:C6 includes two blank rows: they follow the records in both directions.
  const descending = await sort(server.base, {
    range: "A1:C6",
    column: 2,
    order: "descending",
    hasHeader: true,
  });
  assert.equal(descending.status, 200);
  const sheet = (await descending.json()).workbook.worksheets[0];
  assert.deepEqual(rowsOf(sheet, 1, 6, 1, 3), [
    ["Region", "Sales", "Status"],
    ["East", "1200", "Open"],
    ["North", "800", "Closed"],
    ["West", "800", "Open"],
    ["South", "700", "Open"],
    ["", "", ""],
  ]);

  // East and North hold the same text, so the third column still decides nothing: the records with
  // equal keys keep the relative order they had before the sort.
  const ascending = await sort(server.base, {
    range: "A1:C5",
    column: 2,
    order: "ascending",
    hasHeader: true,
  });
  assert.equal(ascending.status, 200);
  const again = (await ascending.json()).workbook.worksheets[0];
  assert.deepEqual(rowsOf(again, 2, 5, 1, 3), [
    ["South", "700", "Open"],
    ["North", "800", "Closed"],
    ["West", "800", "Open"],
    ["East", "1200", "Open"],
  ]);
});

test("sorts text by its own order and dates as dates", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const rows = [
    ["Item", "Date"],
    ["Pen", "2026-01-05"],
    ["Book", "2025-12-31"],
    ["Cup", "2026-02-01"],
    ["Lamp", "2024-06-01"],
  ];
  for (let index = 0; index < rows.length; index += 1) {
    await putCell(server.base, `E${index + 1}`, rows[index][0]);
    await putCell(server.base, `F${index + 1}`, rows[index][1]);
  }

  const byDate = await sort(server.base, { range: "E1:F5", column: 6, order: "ascending", hasHeader: true });
  assert.equal(byDate.status, 200);
  const sheet = (await byDate.json()).workbook.worksheets[0];
  assert.deepEqual(rowsOf(sheet, 2, 5, 5, 6), [
    ["Lamp", "2024-06-01"],
    ["Book", "2025-12-31"],
    ["Pen", "2026-01-05"],
    ["Cup", "2026-02-01"],
  ]);

  const byItem = await sort(server.base, { range: "E1:F5", column: 5, order: "descending", hasHeader: true });
  assert.equal(byItem.status, 200);
  const textSorted = (await byItem.json()).workbook.worksheets[0];
  assert.deepEqual(rowsOf(textSorted, 2, 5, 5, 5), [["Pen"], ["Lamp"], ["Cup"], ["Book"]]);
});

test("sorts without a header row and leaves cells outside the range untouched", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const sorted = await sort(server.base, { range: "A1:B4", column: 1, order: "ascending", hasHeader: false });
  assert.equal(sorted.status, 200);
  const sheet = (await sorted.json()).workbook.worksheets[0];
  // Without a header row the first row takes part, so the header text sorts among the records.
  assert.deepEqual(rowsOf(sheet, 1, 4, 1, 1), [["East"], ["North"], ["Region"], ["South"]]);
  // Only the columns of the sorted range move, so the column right of it keeps its records.
  assert.deepEqual(rowsOf(sheet, 1, 4, 3, 3), [["Status"], ["Open"], ["Closed"], ["Open"]]);
});

test("keeps the rules, the filter view and the selection of the sorted range", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  await jsonRequest(server.base, `${sheetPath()}/validations`, "PUT", {
    range: "B2:B4",
    type: "numberRange",
    min: 0,
    max: 2000,
  });
  await jsonRequest(server.base, `${sheetPath()}/filter`, "PUT", {
    region: "A1:C4",
    columns: [{ column: 3, kind: "values", selected: ["Open"] }],
  });
  await jsonRequest(server.base, `${sheetPath()}`, "PATCH", {
    selection: { anchor: { row: 1, column: 1 }, focus: { row: 4, column: 3 } },
  });

  const response = await sort(server.base, { range: "A1:C4", column: 3, order: "ascending", hasHeader: true });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const sheet = payload.workbook.worksheets[0];
  assert.equal(sheet.validations.length, 1);
  assert.deepEqual(sheet.validations[0].range, { top: 2, bottom: 4, left: 2, right: 2 });
  assert.deepEqual(sheet.filter, {
    region: { top: 1, bottom: 4, left: 1, right: 3 },
    columns: [{ column: 3, kind: "values", selected: ["Open"] }],
  });
  assert.deepEqual(sheet.selection, { anchor: { row: 1, column: 1 }, focus: { row: 4, column: 3 } });
  assert.deepEqual(rowsOf(sheet, 2, 4, 3, 3), [["Closed"], ["Open"], ["Open"]]);

  // The rule still constrains the cells it covers after the sort.
  const rejected = await putCell(server.base, "B2", "5000");
  assert.equal(rejected.status, 400);
});

test("moves a formula with its row and follows the references of the sorted range", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  assert.equal((await putCell(server.base, "C2", "=B2*2")).status, 200);
  assert.equal((await putCell(server.base, "E1", "=B2*2")).status, 200);

  const response = await sort(server.base, { range: "A1:C4", column: 2, order: "ascending", hasHeader: true });
  assert.equal(response.status, 200);
  const sheet = (await response.json()).workbook.worksheets[0];
  // East's record moved from row 2 to row 4, and the reference moved with it.
  assert.equal(sheet.cells.A4.value, "East");
  assert.equal(sheet.cells.C4.value, "=B4*2");
  assert.equal(sheet.cells.C4.display, "2400");
  // A formula outside the range keeps its references.
  assert.equal(sheet.cells.E1.value, "=B2*2");
  assert.equal(sheet.cells.E1.display, "1400");
});

test("records the sorted order in the session history and undoes it as one change", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const sorted = await sort(server.base, { range: "A1:C4", column: 2, order: "ascending", hasHeader: true });
  assert.equal(sorted.status, 200);
  assert.equal((await sorted.json()).canUndo, true);

  const undone = await jsonRequest(server.base, `/api/workbooks/${SEED_WORKBOOK_ID}/undo`, "POST");
  assert.equal(undone.status, 200);
  const sheet = (await undone.json()).workbook.worksheets[0];
  assert.deepEqual(rowsOf(sheet, 2, 4, 1, 1), [["East"], ["North"], ["South"]]);
  assert.equal((await getWorkbook(server.base)).worksheets[0].cells.A2.value, "East");
});

test("refuses a malformed range, a column outside it and an unknown order without changing the range", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const before = JSON.stringify(await getWorkbook(server.base));

  const badRange = await sort(server.base, { range: "nope", column: 2, order: "ascending", hasHeader: true });
  assert.equal(badRange.status, 400);

  const outside = await sort(server.base, { range: "A1:C4", column: 9, order: "ascending", hasHeader: true });
  assert.equal(outside.status, 400);
  assert.equal((await outside.json()).error, "The sorted column is outside the selected range");

  const unknownOrder = await sort(server.base, { range: "A1:C4", column: 2, order: "sideways", hasHeader: true });
  assert.equal(unknownOrder.status, 400);
  assert.equal((await unknownOrder.json()).error, "Unknown sort order");

  const unknownSheet = await jsonRequest(
    server.base,
    `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/ws_missing/sort`,
    "POST",
    { range: "A1:C4", column: 2, order: "ascending", hasHeader: true },
  );
  assert.equal(unknownSheet.status, 404);

  assert.equal(JSON.stringify(await getWorkbook(server.base)), before);
});
