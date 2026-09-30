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
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-transfer-"));
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

async function getSheet(base, id = SEED_WORKBOOK_ID) {
  const response = await fetch(`${base}/api/workbooks/${id}`);
  const workbook = (await response.json()).workbook;
  return workbook.worksheets.find((worksheet) => worksheet.id === SEED_WORKSHEET_ID);
}

function putCell(base, cellId, value, sheetId = SEED_WORKSHEET_ID) {
  return fetch(`${base}/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${sheetId}/cells/${cellId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });
}

function saveValidation(base, payload, sheetId = SEED_WORKSHEET_ID) {
  return fetch(`${base}/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${sheetId}/validations`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function transfer(base, payload, sheetId = SEED_WORKSHEET_ID, workbookId = SEED_WORKBOOK_ID) {
  return fetch(`${base}/api/workbooks/${workbookId}/worksheets/${sheetId}/transfer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const region = (top, left, bottom, right) => ({ top, bottom, left, right });

test("copies a rectangle into the target and rewrites relative references of copied formulas", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  await putCell(server.base, "D1", "=B2+$B$2");
  await putCell(server.base, "D2", "5");

  const response = await transfer(server.base, {
    mode: "copy",
    source: region(1, 4, 1, 4),
    target: "F1",
  });
  assert.equal(response.status, 200);
  const sheet = (await response.json()).workbook.worksheets[0];

  // The relative reference follows the target, the absolute part does not.
  assert.equal(sheet.cells.F1.value, "=D2+$B$2");
  assert.equal(sheet.cells.F1.display, "1205");
  // The source and every cell outside the two rectangles keep their content.
  assert.equal(sheet.cells.D1.value, "=B2+$B$2");
  assert.equal(sheet.cells.D1.display, "2400");
  assert.equal(sheet.cells.A1.value, "Region");
  assert.equal(sheet.cells.B3.value, "800");
  assert.equal(sheet.cells.G1, undefined);

  await putCell(server.base, "D2", "7");
  const recalculated = await getSheet(server.base);
  assert.equal(recalculated.cells.F1.display, "1207");
  assert.equal(recalculated.cells.F1.value, "=D2+$B$2");
});

/**
 * REQ-4-1-2 / REQ-4-2-1: a copied formula keeps its source, follows the target offset and keeps the
 * dependents of both rectangles consistent with the current source values, also after reopening.
 */
test("keeps a copied formula, its source and its dependents consistent after reopening", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  await putCell(server.base, "A1", "2");
  await putCell(server.base, "B1", "3");
  await putCell(server.base, "C1", "=A1+$B$1");
  await putCell(server.base, "D1", "=C1*2");

  const copied = await transfer(server.base, { mode: "copy", source: region(1, 3, 1, 3), target: "E1" });
  assert.equal(copied.status, 200);
  const sheet = (await copied.json()).workbook.worksheets[0];

  // The relative reference follows the offset, the absolute part stays, and the source is untouched.
  assert.equal(sheet.cells.E1.value, "=C1+$B$1");
  assert.equal(sheet.cells.E1.display, "8");
  assert.equal(sheet.cells.C1.value, "=A1+$B$1");
  assert.equal(sheet.cells.C1.display, "5");
  assert.equal(sheet.cells.D1.display, "10");

  // A source edit in the dependency chain reaches the copy as well.
  await putCell(server.base, "A1", "5");
  const recalculated = await getSheet(server.base);
  assert.equal(recalculated.cells.C1.value, "=A1+$B$1");
  assert.equal(recalculated.cells.C1.display, "8");
  assert.equal(recalculated.cells.D1.display, "16");
  assert.equal(recalculated.cells.E1.value, "=C1+$B$1");
  assert.equal(recalculated.cells.E1.display, "11");

  const reopened = createWorkbookRepository(server.directory);
  const stored = (await reopened.get(SEED_WORKBOOK_ID)).worksheets[0];
  assert.equal(stored.cells.C1.value, "=A1+$B$1");
  assert.equal(stored.cells.C1.display, "8");
  assert.equal(stored.cells.E1.value, "=C1+$B$1");
  assert.equal(stored.cells.E1.display, "11");
  assert.equal(stored.cells.D1.display, "16");
});

test("shows =#REF! for a copy whose offset moves a relative reference outside the sheet", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  await putCell(server.base, "A1", "2");
  await putCell(server.base, "B1", "3");
  await putCell(server.base, "C2", "=A1+B1");

  const copied = await transfer(server.base, { mode: "copy", source: region(2, 3, 2, 3), target: "A2" });
  assert.equal(copied.status, 200);
  const sheet = (await copied.json()).workbook.worksheets[0];

  assert.equal(sheet.cells.A2.value, "=#REF!");
  assert.equal(sheet.cells.A2.display, "#REF!");
  // The source keeps its own formula and result.
  assert.equal(sheet.cells.C2.value, "=A1+B1");
  assert.equal(sheet.cells.C2.display, "5");

  const reopened = createWorkbookRepository(server.directory);
  const stored = (await reopened.get(SEED_WORKBOOK_ID)).worksheets[0];
  assert.equal(stored.cells.A2.value, "=#REF!");
  assert.equal(stored.cells.A2.display, "#REF!");
  assert.equal(stored.cells.C2.value, "=A1+B1");
  assert.equal(stored.cells.C2.display, "5");
});

test("copies the whole two dimensional layout, including empty cells and values", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  await putCell(server.base, "E1", "kept");
  // The copied rectangle has an empty cell in B1 so the target field is cleared by the copy.
  await putCell(server.base, "B1", "");
  const response = await transfer(server.base, {
    mode: "copy",
    source: region(1, 1, 2, 2),
    target: "D1",
  });
  assert.equal(response.status, 200);
  const sheet = (await response.json()).workbook.worksheets[0];

  assert.equal(sheet.cells.D1.value, "Region");
  assert.equal(sheet.cells.E1, undefined);
  assert.equal(sheet.cells.D2.value, "East");
  assert.equal(sheet.cells.E2.value, "1200");
  assert.equal(sheet.cells.A1.value, "Region");
  assert.equal(sheet.cells.A2.value, "East");
  assert.equal(sheet.cells.B2.value, "1200");

  const reloaded = await getSheet(server.base);
  assert.equal(reloaded.cells.D1.value, "Region");
  assert.equal(reloaded.cells.D1.display, "Region");
  assert.equal(reloaded.cells.E2.value, "1200");
  assert.equal(reloaded.cells.E1, undefined);
  assert.equal(reloaded.cells.A1.value, "Region");
});

test("moves a cut rectangle and clears its source cells in the same update", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const response = await transfer(server.base, {
    mode: "cut",
    source: region(2, 2, 3, 2),
    target: "D1",
  });
  assert.equal(response.status, 200);
  const sheet = (await response.json()).workbook.worksheets[0];

  assert.equal(sheet.cells.D1.value, "1200");
  assert.equal(sheet.cells.D2.value, "800");
  assert.equal(sheet.cells.B2, undefined);
  assert.equal(sheet.cells.B3, undefined);
  assert.equal(sheet.cells.A2.value, "East");
  assert.equal(sheet.cells.A3.value, "North");

  const reloaded = await getSheet(server.base);
  assert.equal(reloaded.cells.D1.value, "1200");
  assert.equal(reloaded.cells.D2.value, "800");
  assert.equal(reloaded.cells.B2, undefined);
  assert.equal(reloaded.cells.B3, undefined);
});

test("keeps the cells a cut target rectangle itself covers and moves formulas unchanged", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  await putCell(server.base, "A1", "=B3+1");
  const response = await transfer(server.base, {
    mode: "cut",
    source: region(1, 1, 2, 2),
    target: "B2",
  });
  assert.equal(response.status, 200);
  const sheet = (await response.json()).workbook.worksheets[0];

  // B2 is covered by the target rectangle, so it keeps the moved value of A1.
  assert.equal(sheet.cells.B2.value, "=B3+1");
  assert.equal(sheet.cells.C2.value, "Sales");
  assert.equal(sheet.cells.B3.value, "East");
  assert.equal(sheet.cells.C3.value, "1200");
  assert.equal(sheet.cells.A1, undefined);
  assert.equal(sheet.cells.B1, undefined);
  assert.equal(sheet.cells.A2, undefined);
});

test("rejects the whole transfer when a 0-to-100 rule refuses a target value", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  await saveValidation(server.base, {
    range: "D1:E2",
    type: "numberRange",
    min: 0,
    max: 100,
    message: "Please enter a number from 0 to 100",
  });
  const before = JSON.stringify(await getSheet(server.base));

  const copied = await transfer(server.base, { mode: "copy", source: region(1, 1, 2, 2), target: "D1" });
  assert.equal(copied.status, 400);
  assert.equal((await copied.json()).error, "Please enter a number from 0 to 100");
  assert.equal(JSON.stringify(await getSheet(server.base)), before);

  const cut = await transfer(server.base, { mode: "cut", source: region(1, 1, 2, 2), target: "D1" });
  assert.equal(cut.status, 400);
  assert.equal((await cut.json()).error, "Please enter a number from 0 to 100");
  // A refused cut keeps the source range as well.
  const unchanged = await getSheet(server.base);
  assert.equal(unchanged.cells.A1.value, "Region");
  assert.equal(unchanged.cells.B2.value, "1200");
  assert.equal(unchanged.cells.D1, undefined);
  assert.equal(unchanged.cells.E2, undefined);
});

test("rejects malformed transfers and unknown worksheets without changing stored data", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const before = JSON.stringify(await getSheet(server.base));

  const unknownMode = await transfer(server.base, { mode: "move", source: region(1, 1, 1, 1), target: "D1" });
  assert.equal(unknownMode.status, 400);
  assert.equal((await unknownMode.json()).error, "Unknown range operation");

  const badSource = await transfer(server.base, { mode: "copy", source: region(2, 1, 1, 1), target: "D1" });
  assert.equal(badSource.status, 400);

  const badTarget = await transfer(server.base, { mode: "copy", source: region(1, 1, 1, 1), target: "??" });
  assert.equal(badTarget.status, 400);
  assert.equal((await badTarget.json()).error, "Invalid target cell");

  const unknownSheet = await transfer(
    server.base,
    { mode: "copy", source: region(1, 1, 1, 1), target: "D1" },
    "ws_missing",
  );
  assert.equal(unknownSheet.status, 404);

  const unknownWorkbook = await transfer(
    server.base,
    { mode: "copy", source: region(1, 1, 1, 1), target: "D1" },
    SEED_WORKSHEET_ID,
    "wb_missing",
  );
  assert.equal(unknownWorkbook.status, 404);

  assert.equal(JSON.stringify(await getSheet(server.base)), before);
});
