import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { SEED_WORKBOOK_ID, SEED_WORKSHEET_ID } from "../src/lib/seed.mjs";
import { createWorkbookRepository } from "../src/lib/workbook-store.mjs";

/**
 * REQ-4-1-1 and REQ-4-2-2 through the HTTP API: the text a user submits keeps its original formula
 * and answers with the calculated `display` or the documented error value. The evaluation seed of
 * these requirements (`A1=2`, `B1=3`, `=A1+B1`, `=C1*2`) conflicts with the shared `A1=Region`
 * record, so the tests build it through the public cell writes. A second repository over the same
 * data directory stands for reopening the workbook, which recalculates every result from the
 * stored source values.
 */
async function startTestServer() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-formula-"));
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

function putCell(base, cellId, value, worksheetId = SEED_WORKSHEET_ID, workbookId = SEED_WORKBOOK_ID) {
  return fetch(`${base}/api/workbooks/${workbookId}/worksheets/${worksheetId}/cells/${cellId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });
}

test("calculates expressions and aggregate functions and keeps them after reopening", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  assert.equal((await putCell(server.base, "A1", "2")).status, 200);
  await putCell(server.base, "B1", "3");

  const sum = await putCell(server.base, "C1", "=A1+B1");
  const sheet = (await sum.json()).workbook.worksheets[0];
  assert.equal(sheet.cells.C1.value, "=A1+B1");
  assert.equal(sheet.cells.C1.display, "5");

  const chained = await putCell(server.base, "D1", "=C1*2");
  assert.equal((await chained.json()).workbook.worksheets[0].cells.D1.display, "10");

  // The aggregate range holds A1=2, A2=4, A3=6, a text cell and a blank cell.
  await putCell(server.base, "A2", "4");
  await putCell(server.base, "A3", "6");
  await putCell(server.base, "A4", "text");
  await putCell(server.base, "B2", "=SUM(A1:A5)");
  await putCell(server.base, "B3", "=AVERAGE(A1:A5)");
  await putCell(server.base, "B4", "=COUNT(A1:A5)");
  await putCell(server.base, "B5", "=MIN(A1:A5)");
  const max = await putCell(server.base, "B6", "=MAX(A1:A5)");
  const aggregates = (await max.json()).workbook.worksheets[0];
  assert.equal(aggregates.cells.B2.display, "12");
  assert.equal(aggregates.cells.B3.display, "4");
  assert.equal(aggregates.cells.B4.display, "3");
  assert.equal(aggregates.cells.B5.display, "2");
  assert.equal(aggregates.cells.B6.display, "6");

  const lower = await putCell(server.base, "B7", "=sum(a1:a5)");
  assert.equal((await lower.json()).workbook.worksheets[0].cells.B7.display, "12");
  const parenthesized = await putCell(server.base, "B8", "=(A1+B1)/2");
  assert.equal((await parenthesized.json()).workbook.worksheets[0].cells.B8.display, "2.5");

  const reopened = createWorkbookRepository(server.directory);
  const stored = (await reopened.get(SEED_WORKBOOK_ID)).worksheets[0];
  assert.equal(stored.cells.A1.value, "2");
  assert.equal(stored.cells.A4.value, "text");
  assert.equal(stored.cells.C1.value, "=A1+B1");
  assert.equal(stored.cells.C1.display, "5");
  assert.equal(stored.cells.D1.value, "=C1*2");
  assert.equal(stored.cells.D1.display, "10");
  assert.equal(stored.cells.B2.display, "12");
  assert.equal(stored.cells.B3.display, "4");
  assert.equal(stored.cells.B7.display, "12");
  assert.equal(stored.cells.B8.display, "2.5");
});

test("shows the documented error values, isolates them and recovers when the formula is fixed", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const broken = await putCell(server.base, "D1", "=1/0");
  assert.equal((await broken.json()).workbook.worksheets[0].cells.D1.display, "#DIV/0!");
  assert.equal((await putCell(server.base, "D2", "=NOSUCH(1)")).status, 200);
  await putCell(server.base, "D3", "=1+");
  await putCell(server.base, "D4", "=ZZZ1");
  await putCell(server.base, "D5", "=D6+1");
  await putCell(server.base, "D6", "=D5+1");
  const dependent = await putCell(server.base, "E1", "=D1*2");

  const sheet = (await dependent.json()).workbook.worksheets[0];
  assert.equal(sheet.cells.D2.display, "#NAME?");
  assert.equal(sheet.cells.D3.display, "#ERROR!");
  assert.equal(sheet.cells.D4.display, "#REF!");
  assert.equal(sheet.cells.D5.display, "#REF!");
  assert.equal(sheet.cells.D6.display, "#REF!");
  assert.equal(sheet.cells.E1.display, "#DIV/0!");

  // An error cell blocks neither another cell nor a later edit of the same worksheet.
  const unrelated = await putCell(server.base, "E2", "=B2+B3");
  const withUnrelated = (await unrelated.json()).workbook.worksheets[0];
  assert.equal(withUnrelated.cells.E2.display, "2000");
  assert.equal(withUnrelated.cells.B2.display, "1200");

  const reloaded = (await getWorkbook(server.base)).worksheets[0];
  assert.equal(reloaded.cells.D1.value, "=1/0");
  assert.equal(reloaded.cells.D1.display, "#DIV/0!");
  assert.equal(reloaded.cells.D3.value, "=1+");
  assert.equal(reloaded.cells.E1.value, "=D1*2");
  assert.equal(reloaded.cells.E1.display, "#DIV/0!");

  // A valid formula replaces the error and updates its dependents, also after reopening.
  const fixed = await putCell(server.base, "D1", "=B2+B3");
  const fixedSheet = (await fixed.json()).workbook.worksheets[0];
  assert.equal(fixedSheet.cells.D1.value, "=B2+B3");
  assert.equal(fixedSheet.cells.D1.display, "2000");
  assert.equal(fixedSheet.cells.E1.display, "4000");

  const reopened = createWorkbookRepository(server.directory);
  const stored = (await reopened.get(SEED_WORKBOOK_ID)).worksheets[0];
  assert.equal(stored.cells.D1.value, "=B2+B3");
  assert.equal(stored.cells.D1.display, "2000");
  assert.equal(stored.cells.E1.display, "4000");
  assert.equal(stored.cells.D2.display, "#NAME?");
});
