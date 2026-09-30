import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { SEED_WORKBOOK_ID, SEED_WORKSHEET_ID } from "../src/lib/seed.mjs";
import { createWorkbookRepository } from "../src/lib/workbook-store.mjs";

async function startTestServer() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-structure-"));
  const repository = createWorkbookRepository(directory);
  const server = createServer(createApp(repository));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    directory,
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

function structure(base, payload, sheetId = SEED_WORKSHEET_ID) {
  return jsonRequest(base, `${sheetPath(SEED_WORKBOOK_ID, sheetId)}/structure`, "POST", payload);
}

function putCell(base, cellId, value, sheetId = SEED_WORKSHEET_ID) {
  return jsonRequest(base, `${sheetPath(SEED_WORKBOOK_ID, sheetId)}/cells/${cellId}`, "PUT", { value });
}

function values(sheet, ...cellIds) {
  return cellIds.map((cellId) => sheet.cells[cellId]?.value ?? "");
}

test("inserting a row above shifts the records, the formulas and the rules down together", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  assert.equal((await putCell(server.base, "E2", "=B2+1")).status, 200);
  assert.equal((await putCell(server.base, "E3", "=B3*2")).status, 200);
  const ruled = await jsonRequest(server.base, `${sheetPath()}/validations`, "PUT", {
    range: "B2:B3",
    type: "numberRange",
    min: 0,
    max: 100,
    message: "Please enter a number from 0 to 100",
  });
  assert.equal(ruled.status, 200);
  assert.equal(
    (
      await jsonRequest(server.base, `${sheetPath()}/filter`, "PUT", {
        region: "A1:C4",
        columns: [{ column: 1, kind: "values", selected: ["East"] }],
      })
    ).status,
    200,
  );

  const inserted = await structure(server.base, {
    axis: "row",
    op: "insert",
    index: 2,
    side: "before",
  });
  assert.equal(inserted.status, 200);
  const sheet = (await inserted.json()).workbook.worksheets[0];

  // The blank row appears above the target and every following record moves down by one.
  assert.deepEqual(values(sheet, "A1", "B1", "C1"), ["Region", "Sales", "Status"]);
  assert.deepEqual(values(sheet, "A2", "B2", "C2"), ["", "", ""]);
  assert.deepEqual(values(sheet, "A3", "B3", "C3"), ["East", "1200", "Open"]);
  assert.deepEqual(values(sheet, "A4", "B4", "C4"), ["North", "800", "Closed"]);
  assert.deepEqual(values(sheet, "A5", "B5", "C5"), ["South", "700", "Open"]);
  assert.equal(sheet.rowCount, 51);

  // Formulas keep their original text with the adjusted references and a correct result.
  assert.equal(sheet.cells.E3.value, "=B3+1");
  assert.equal(sheet.cells.E3.display, "1201");
  assert.equal(sheet.cells.E4.value, "=B4*2");
  assert.equal(sheet.cells.E4.display, "1600");

  // The validation rule moved down with its rows and kept its own message.
  assert.deepEqual(sheet.validations[0].range, { top: 3, bottom: 4, left: 2, right: 2 });
  assert.equal(sheet.validations[0].message, "Please enter a number from 0 to 100");
  assert.equal(sheet.validations[0].type, "numberRange");
  assert.equal(sheet.validations[0].min, 0);
  assert.equal(sheet.validations[0].max, 100);

  // The filter keeps covering the records, now one row taller.
  assert.deepEqual(sheet.filter.region, { top: 1, bottom: 5, left: 1, right: 3 });
  assert.deepEqual(sheet.filter.columns, [{ column: 1, kind: "values", selected: ["East"] }]);

  // The other worksheet and its structure stay untouched.
  const other = (await getWorkbook(server.base)).worksheets[1];
  assert.deepEqual(other.cells, {});
  assert.equal(other.rowCount, 50);
});

test("inserting a row below keeps the target row and moves the records after it", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const inserted = await structure(server.base, { axis: "row", op: "insert", index: 3, side: "after" });
  assert.equal(inserted.status, 200);
  const sheet = (await inserted.json()).workbook.worksheets[0];

  assert.deepEqual(values(sheet, "A3", "B3"), ["North", "800"]);
  assert.deepEqual(values(sheet, "A4", "B4"), ["", ""]);
  assert.deepEqual(values(sheet, "A5", "B5"), ["South", "700"]);
  assert.equal(sheet.rowCount, 51);
});

test("deleting a row shifts the rows below up, removes its rule and shows #REF! for its references", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  assert.equal((await putCell(server.base, "E1", "=B2*2")).status, 200);
  assert.equal((await putCell(server.base, "E4", "=B4+5")).status, 200);
  const ruled = await jsonRequest(server.base, `${sheetPath()}/validations`, "PUT", {
    range: "B2:B3",
    type: "numberRange",
    min: 0,
    max: 100,
    message: "Please enter a number from 0 to 100",
  });
  assert.equal(ruled.status, 200);
  assert.equal(
    (
      await jsonRequest(server.base, `${sheetPath()}/filter`, "PUT", {
        region: "A1:C4",
        columns: [{ column: 2, kind: "condition", condition: "greaterThan", value: "900" }],
      })
    ).status,
    200,
  );

  const deleted = await structure(server.base, { axis: "row", op: "delete", index: 2 });
  assert.equal(deleted.status, 200);
  const sheet = (await deleted.json()).workbook.worksheets[0];

  assert.deepEqual(values(sheet, "A2", "B2", "C2"), ["North", "800", "Closed"]);
  assert.deepEqual(values(sheet, "A3", "B3", "C3"), ["South", "700", "Open"]);
  assert.deepEqual(values(sheet, "A4", "B4", "C4"), ["", "", ""]);

  // A reference to the removed row cannot be preserved; a reference below it follows the shift.
  assert.equal(sheet.cells.E1.value, "=#REF!*2");
  assert.equal(sheet.cells.E1.display, "#REF!");
  assert.equal(sheet.cells.E3.value, "=B3+5");
  assert.equal(sheet.cells.E3.display, "705");
  assert.equal(sheet.cells.E4, undefined);

  // The rule lost the deleted row: B2:B3 becomes B2 only.
  assert.deepEqual(sheet.validations[0].range, { top: 2, bottom: 2, left: 2, right: 2 });
  assert.deepEqual(sheet.filter.region, { top: 1, bottom: 3, left: 1, right: 3 });
  assert.deepEqual(sheet.filter.columns, [{ column: 2, kind: "condition", condition: "greaterThan", value: "900" }]);

  // The rule that covered the deleted row lost it: B2:B3 keeps only B2, so B3 is free again.
  const accepted = await putCell(server.base, "B3", "5000");
  assert.equal(accepted.status, 200);
  assert.equal((await putCell(server.base, "B2", "5000")).status, 400);
});

test("deleting the only row of a rule removes the rule", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const ruled = await jsonRequest(server.base, `${sheetPath()}/validations`, "PUT", {
    range: "B3:B3",
    type: "numberRange",
    min: 0,
    max: 100,
    message: "Please enter a number from 0 to 100",
  });
  assert.equal(ruled.status, 200);

  const deleted = await structure(server.base, { axis: "row", op: "delete", index: 3 });
  assert.equal(deleted.status, 200);
  assert.deepEqual((await deleted.json()).workbook.worksheets[0].validations, []);
  assert.equal((await putCell(server.base, "B4", "5000")).status, 200);
});

test("a shifted 0-to-100 rule rejects an out-of-range value with its own message", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  await jsonRequest(server.base, `${sheetPath()}/validations`, "PUT", {
    range: "B2:B2",
    type: "numberRange",
    min: 0,
    max: 100,
    message: "Please enter a number from 0 to 100",
  });
  const inserted = await structure(server.base, { axis: "row", op: "insert", index: 1, side: "before" });
  assert.equal(inserted.status, 200);

  const rejected = await putCell(server.base, "B3", "101");
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, "Please enter a number from 0 to 100");
  assert.equal((await getWorkbook(server.base)).worksheets[0].cells.B3.value, "1200");
  assert.equal((await putCell(server.base, "B4", "101")).status, 200);
});

test("inserting a column left shifts the data, the formulas and the rules right", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  assert.equal((await putCell(server.base, "E1", "=B2+B3")).status, 200);
  assert.equal(
    (
      await jsonRequest(server.base, `${sheetPath()}/validations`, "PUT", {
        range: "B2:C3",
        type: "dropdown",
        allowedValues: ["1200", "800"],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await jsonRequest(server.base, `${sheetPath()}/filter`, "PUT", {
        region: "A1:C4",
        columns: [{ column: 3, kind: "condition", condition: "isNotEmpty", value: "" }],
      })
    ).status,
    200,
  );

  const inserted = await structure(server.base, { axis: "column", op: "insert", index: 2, side: "before" });
  assert.equal(inserted.status, 200);
  const sheet = (await inserted.json()).workbook.worksheets[0];

  assert.deepEqual(values(sheet, "A1", "B1", "C1", "D1"), ["Region", "", "Sales", "Status"]);
  assert.deepEqual(values(sheet, "A2", "B2", "C2", "D2"), ["East", "", "1200", "Open"]);
  assert.deepEqual(values(sheet, "A4", "B4", "C4", "D4"), ["South", "", "700", "Open"]);
  assert.equal(sheet.columnCount, 27);

  assert.equal(sheet.cells.F1.value, "=C2+C3");
  assert.equal(sheet.cells.F1.display, "2000");
  assert.deepEqual(sheet.validations[0].range, { top: 2, bottom: 3, left: 3, right: 4 });
  assert.deepEqual(sheet.filter.region, { top: 1, bottom: 4, left: 1, right: 4 });
  assert.deepEqual(sheet.filter.columns, [{ column: 4, kind: "condition", condition: "isNotEmpty", value: "" }]);
});

test("deleting a column keeps the data outside it, removes its rule and shows #REF! for direct references", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  assert.equal((await putCell(server.base, "E1", "=B2*2")).status, 200);
  assert.equal((await putCell(server.base, "E2", "=C2&\"!\"")).status, 200);
  assert.equal(
    (
      await jsonRequest(server.base, `${sheetPath()}/validations`, "PUT", {
        range: "B2:B4",
        type: "numberRange",
        min: 0,
        max: 5000,
      })
    ).status,
    200,
  );

  const deleted = await structure(server.base, { axis: "column", op: "delete", index: 2 });
  assert.equal(deleted.status, 200);
  const sheet = (await deleted.json()).workbook.worksheets[0];

  assert.deepEqual(values(sheet, "A2", "B2", "C2"), ["East", "Open", ""]);
  assert.deepEqual(values(sheet, "A4", "B4"), ["South", "Open"]);
  assert.equal(sheet.cells.D1.value, "=#REF!*2");
  assert.equal(sheet.cells.D1.display, "#REF!");
  assert.equal(sheet.cells.D2.value, "=B2&\"!\"");
  assert.equal(sheet.cells.D2.display, "Open!");
  assert.deepEqual(sheet.validations, []);
  // Data on the other worksheet of the workbook is not affected.
  assert.deepEqual((await getWorkbook(server.base)).worksheets[1].cells, {});
});

test("inserting a column right of the last column grows the worksheet once", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const inserted = await structure(server.base, { axis: "column", op: "insert", index: 26, side: "after" });
  assert.equal(inserted.status, 200);
  const sheet = (await inserted.json()).workbook.worksheets[0];
  assert.equal(sheet.columnCount, 27);
  assert.deepEqual(values(sheet, "A2", "B2"), ["East", "1200"]);

  const again = await structure(server.base, { axis: "column", op: "insert", index: 27, side: "after" });
  assert.equal((await again.json()).workbook.worksheets[0].columnCount, 28);
});

test("keeps the structural change after reopening the workbook", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  assert.equal((await structure(server.base, { axis: "row", op: "insert", index: 1, side: "before" })).status, 200);
  assert.equal((await structure(server.base, { axis: "column", op: "delete", index: 3 })).status, 200);

  const reopened = await getWorkbook(server.base);
  const sheet = reopened.worksheets[0];
  assert.deepEqual(values(sheet, "A1", "B1", "C1"), ["", "", ""]);
  assert.deepEqual(values(sheet, "A2", "B2", "C2"), ["Region", "Sales", ""]);
  assert.deepEqual(values(sheet, "A3", "B3", "C3"), ["East", "1200", ""]);
  assert.equal(sheet.rowCount, 51);
  assert.equal(sheet.columnCount, 26);
});

test("a rejected structure change is reported and leaves the stored structure untouched", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const before = JSON.stringify(await getWorkbook(server.base));

  const tooHigh = await structure(server.base, { axis: "row", op: "insert", index: 51, side: "before" });
  assert.equal(tooHigh.status, 400);
  assert.equal((await tooHigh.json()).error, "The row is outside the worksheet");

  const zero = await structure(server.base, { axis: "row", op: "delete", index: 0 });
  assert.equal(zero.status, 400);

  const badColumn = await structure(server.base, { axis: "column", op: "delete", index: 27 });
  assert.equal(badColumn.status, 400);
  assert.equal((await badColumn.json()).error, "The column is outside the worksheet");

  const unknownOp = await structure(server.base, { axis: "row", op: "shift", index: 2 });
  assert.equal(unknownOp.status, 400);

  const unknownAxis = await structure(server.base, { axis: "diagonal", op: "insert", index: 2 });
  assert.equal(unknownAxis.status, 400);

  const unknownSheet = await structure(
    server.base,
    { axis: "row", op: "insert", index: 2 },
    "ws_missing",
  );
  assert.equal(unknownSheet.status, 404);

  assert.equal(JSON.stringify(await getWorkbook(server.base)), before);
  assert.equal((await jsonRequest(server.base, `${sheetPath()}/structure`, "GET")).status, 405);
  assert.equal((await structure(server.base, { axis: "row", op: "insert", index: 2, side: "before" })).status, 200);
});
