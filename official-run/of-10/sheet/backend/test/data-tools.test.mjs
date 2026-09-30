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
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-data-tools-"));
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

function putCell(base, cellId, value, sheetId = SEED_WORKSHEET_ID) {
  return jsonRequest(base, `${sheetPath()}/cells/${cellId}`, "PUT", { value });
}

test("seeds the evaluation range with headers and three records", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const sheet = (await getWorkbook(server.base)).worksheets[0];
  assert.equal(sheet.cells.A1.value, "Region");
  assert.equal(sheet.cells.B1.value, "Sales");
  assert.equal(sheet.cells.C1.value, "Status");
  assert.equal(sheet.cells.A2.value, "East");
  assert.equal(sheet.cells.B2.value, "1200");
  assert.equal(sheet.cells.C2.value, "Open");
  assert.equal(sheet.cells.A3.value, "North");
  assert.equal(sheet.cells.C3.value, "Closed");
  assert.equal(sheet.cells.A4.value, "South");
  assert.equal(sheet.cells.B4.value, "700");
  assert.equal(sheet.cells.C4.value, "Open");
  assert.equal(sheet.filter, null);
  assert.deepEqual(sheet.validations, []);
});

test("stores a filter view per worksheet and keeps it after reload without touching updatedAt", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const before = await getWorkbook(server.base);
  const saved = await jsonRequest(server.base, `${sheetPath()}/filter`, "PUT", {
    region: { top: 1, bottom: 4, left: 1, right: 3 },
    columns: [
      { column: 3, kind: "values", selected: ["Open"] },
      { column: 2, kind: "condition", condition: "greaterThan", value: " 900 " },
    ],
  });
  assert.equal(saved.status, 200);
  const workbook = (await saved.json()).workbook;
  assert.equal(workbook.updatedAt, before.updatedAt);
  assert.deepEqual(workbook.worksheets[0].filter, {
    region: { top: 1, bottom: 4, left: 1, right: 3 },
    columns: [
      { column: 2, kind: "condition", condition: "greaterThan", value: "900" },
      { column: 3, kind: "values", selected: ["Open"] },
    ],
  });

  const reloaded = await getWorkbook(server.base);
  assert.deepEqual(reloaded.worksheets[0].filter, workbook.worksheets[0].filter);

  const cleared = await jsonRequest(server.base, `${sheetPath()}/filter`, "DELETE");
  assert.equal(cleared.status, 200);
  assert.equal((await cleared.json()).workbook.worksheets[0].filter, null);
  assert.equal((await getWorkbook(server.base)).worksheets[0].filter, null);
});

test("rejects malformed filter payloads and stores nothing", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const before = JSON.stringify(await getWorkbook(server.base));

  const noRegion = await jsonRequest(server.base, `${sheetPath()}/filter`, "PUT", {
    columns: [{ column: 1, kind: "values", selected: ["East"] }],
  });
  assert.equal(noRegion.status, 400);

  const outsideRegion = await jsonRequest(server.base, `${sheetPath()}/filter`, "PUT", {
    region: "A1:C4",
    columns: [{ column: 9, kind: "values", selected: ["East"] }],
  });
  assert.equal(outsideRegion.status, 400);

  const unknownCondition = await jsonRequest(server.base, `${sheetPath()}/filter`, "PUT", {
    region: "A1:C4",
    columns: [{ column: 1, kind: "condition", condition: "StartsWith", value: "E" }],
  });
  assert.equal(unknownCondition.status, 400);

  const unknownSheet = await jsonRequest(
    server.base,
    `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/ws_missing/filter`,
    "PUT",
    { region: "A1:C4", columns: [] },
  );
  assert.equal(unknownSheet.status, 404);

  assert.equal(JSON.stringify(await getWorkbook(server.base)), before);
});

test("drops the sorted condition value of the empty conditions and keeps a rectangle region", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const saved = await jsonRequest(server.base, `${sheetPath()}/filter`, "PUT", {
    region: "A1:C4",
    columns: [
      { column: 3, kind: "condition", condition: "isNotEmpty", value: "ignored" },
      { column: 1, kind: "condition", condition: "isEmpty", value: "" },
    ],
  });
  assert.equal(saved.status, 200);
  const filter = (await saved.json()).workbook.worksheets[0].filter;
  assert.deepEqual(filter.region, { top: 1, bottom: 4, left: 1, right: 3 });
  assert.deepEqual(filter.columns, [
    { column: 1, kind: "condition", condition: "isEmpty", value: "" },
    { column: 3, kind: "condition", condition: "isNotEmpty", value: "" },
  ]);
});

test("saves a validation rule for an object range and enforces it on writes, pastes and moves", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const saved = await jsonRequest(server.base, `${sheetPath()}/validations`, "PUT", {
    range: { top: 3, bottom: 3, left: 2, right: 2 },
    type: "numberRange",
    min: 0,
    max: 100,
    message: "Please enter a number from 0 to 100",
  });
  assert.equal(saved.status, 200);
  const rule = (await saved.json()).workbook.worksheets[0].validations[0];
  assert.deepEqual(rule.range, { top: 3, bottom: 3, left: 2, right: 2 });

  const rejected = await putCell(server.base, "B3", "101");
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, "Please enter a number from 0 to 100");
  assert.equal((await getWorkbook(server.base)).worksheets[0].cells.B3.value, "800");

  const rejectedPaste = await jsonRequest(server.base, `${sheetPath()}/paste`, "POST", {
    cell: "A3",
    values: [["West", "101"]],
  });
  assert.equal(rejectedPaste.status, 400);
  assert.equal((await rejectedPaste.json()).error, "Please enter a number from 0 to 100");
  assert.equal((await getWorkbook(server.base)).worksheets[0].cells.A3.value, "North");

  const rejectedMove = await jsonRequest(server.base, `${sheetPath()}/transfer`, "POST", {
    mode: "copy",
    source: { top: 2, bottom: 2, left: 2, right: 2 },
    target: "B3",
  });
  assert.equal(rejectedMove.status, 400);
  assert.equal((await rejectedMove.json()).error, "Please enter a number from 0 to 100");

  const accepted = await putCell(server.base, "B3", "100");
  assert.equal(accepted.status, 200);
});

test("uses a dropdown rule message and removes the rule with the delete endpoint", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const saved = await jsonRequest(server.base, `${sheetPath()}/validations`, "PUT", {
    range: "C2:C4",
    type: "dropdown",
    allowedValues: [" Open ", "Closed", "", "Open"],
  });
  assert.equal(saved.status, 200);
  const rule = (await saved.json()).workbook.worksheets[0].validations[0];
  assert.deepEqual(rule.allowedValues, ["Open", "Closed"]);

  const rejected = await putCell(server.base, "C4", "Pending");
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, "Please select one of the following values: Open, Closed");
  assert.equal((await getWorkbook(server.base)).worksheets[0].cells.C4.value, "Open");

  const removed = await jsonRequest(server.base, `${sheetPath()}/validations/${rule.id}`, "DELETE");
  assert.equal(removed.status, 200);
  assert.deepEqual((await removed.json()).workbook.worksheets[0].validations, []);
  assert.equal((await getWorkbook(server.base)).worksheets[0].cells.C4.value, "Open");

  const nowAccepted = await putCell(server.base, "C4", "Pending");
  assert.equal(nowAccepted.status, 200);
  assert.equal((await getWorkbook(server.base)).worksheets[0].cells.C4.value, "Pending");
});
