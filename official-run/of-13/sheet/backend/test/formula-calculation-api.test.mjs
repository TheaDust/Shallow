/**
 * REQ-4-1-1 / REQ-4-2-2 through the HTTP API: expressions and aggregate functions entered
 * through the cell endpoint, the seeded formula sample, dependency recalculation, the stable
 * error values, error isolation and fixing an error cell in place. Every step also verifies
 * the persisted state, because the raw submitted text is the single source of truth and the
 * displayed value is derived from it on every read.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApiHandler } from "../src/api.mjs";
import { createWorkbookStore } from "../src/store.mjs";

const WORKBOOK = "wb-q3-sales";
const SHEET2 = "wb-q3-sales-sheet-2";

async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-formulas-"));
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

async function writeCells(baseUrl, sheetId, entries) {
  for (const [address, value] of Object.entries(entries)) {
    const written = await putCell(baseUrl, sheetId, address, value);
    assert.equal(written.status, 200, `${address} was rejected`);
  }
}

function sheetOf(workbook, sheetId) {
  const sheet = workbook.sheets.find((entry) => entry.id === sheetId);
  assert.ok(sheet, `worksheet ${sheetId} is missing`);
  return sheet;
}

async function openSheet(baseUrl, sheetId = SHEET2) {
  const opened = await callJson(baseUrl, `/api/workbooks/${WORKBOOK}`);
  assert.equal(opened.status, 200);
  return sheetOf(opened.body.workbook, sheetId);
}

test("the seeded formulas show their results and keep the submitted formulas after a restart", async () => {
  const api = await startApi();
  try {
    const sheet = await openSheet(api.baseUrl);
    assert.deepEqual(sheet.cells, { A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2" });
    assert.deepEqual(sheet.values, { A1: "2", B1: "3", C1: "5", D1: "10" });

    const restarted = await createWorkbookStore(api.directory).read();
    const stored = sheetOf(restarted.workbooks[0], SHEET2);
    assert.deepEqual(stored.cells, { A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2" });
  } finally {
    await api.close();
  }
});

test("evaluates expressions and aggregate functions, ignoring blanks and text", async () => {
  const api = await startApi();
  try {
    // A2 stays empty on purpose: blanks are skipped instead of counted as zero.
    await writeCells(api.baseUrl, SHEET2, {
      A3: "4",
      A4: "5",
      B3: "text",
      E1: "=2+3*4",
      E2: "=(2+3)*4",
      E3: "=10-2-3",
      E4: "=12/4/3",
      E5: "=-3+1",
      F1: "=SUM(A1:A4)",
      F2: "=average(A3:A4)",
      F3: "=COUNT(A1:A4)",
      F4: "=min(A1:A4)",
      F5: "=MAX(A1:A4)",
      F6: "=SUM(A1:A2)+MAX(A3:A4)",
      F7: "=SUM(A1:A2,B3:B4)",
      F8: "=SUM(B3:B4)",
    });

    const sheet = await openSheet(api.baseUrl);
    assert.deepEqual(
      Object.fromEntries(
        ["E1", "E2", "E3", "E4", "E5", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"].map(
          (address) => [address, sheet.values[address]],
        ),
      ),
      {
        E1: "14",
        E2: "20",
        E3: "5",
        E4: "1",
        E5: "-2",
        F1: "11",
        F2: "4.5",
        F3: "3",
        F4: "2",
        F5: "5",
        F6: "7",
        F7: "2",
        F8: "0",
      },
    );
    // The submitted expression stays the formula bar text after a reopen.
    assert.equal(sheet.cells.F2, "=average(A3:A4)");
    assert.equal(sheet.cells.F1, "=SUM(A1:A4)");
  } finally {
    await api.close();
  }
});

test("recalculates dependents when a source value changes and keeps the seeded chain", async () => {
  const api = await startApi();
  try {
    await putCell(api.baseUrl, SHEET2, "A1", "7");
    let sheet = await openSheet(api.baseUrl);
    assert.equal(sheet.values.C1, "10");
    assert.equal(sheet.values.D1, "20");

    await putCell(api.baseUrl, SHEET2, "B1", "1");
    sheet = await openSheet(api.baseUrl);
    assert.equal(sheet.cells.C1, "=A1+B1");
    assert.equal(sheet.values.C1, "8");
    assert.equal(sheet.values.D1, "16");

    const restarted = await createWorkbookStore(api.directory).read();
    const stored = sheetOf(restarted.workbooks[0], SHEET2);
    assert.equal(stored.cells.C1, "=A1+B1");
    assert.equal(stored.cells.A1, "7");
  } finally {
    await api.close();
  }
});

test("an A1-shaped address with an impossible row is an isolated invalid reference", async () => {
  const api = await startApi();
  try {
    await writeCells(api.baseUrl, SHEET2, { D11: "=A0", E11: "=D11+1" });

    let sheet = await openSheet(api.baseUrl);
    // The invalid reference shows the stable error value, the bar keeps the submitted text,
    // and the error only reaches the formula that depends on it.
    assert.equal(sheet.values.D11, "#REF!");
    assert.equal(sheet.cells.D11, "=A0");
    assert.equal(sheet.values.E11, "#REF!");
    assert.equal(sheet.values.C1, "5");
    assert.equal(sheet.values.D1, "10");

    const restarted = await createWorkbookStore(api.directory).read();
    const stored = sheetOf(restarted.workbooks[0], SHEET2);
    assert.equal(stored.cells.D11, "=A0");

    // Replacing it with a valid formula shows the new result and clears the error chain.
    await putCell(api.baseUrl, SHEET2, "D11", "=A1+1");
    sheet = await openSheet(api.baseUrl);
    assert.equal(sheet.cells.D11, "=A1+1");
    assert.equal(sheet.values.D11, "3");
    assert.equal(sheet.values.E11, "4");

    const reopened = await openSheet(api.baseUrl);
    assert.equal(reopened.values.D11, "3");
    assert.notEqual(reopened.values.D11, "#REF!");
    assert.equal(reopened.values.E11, "4");
  } finally {
    await api.close();
  }
});

test("shows the stable error values, isolates them and fixes an error cell in place", async () => {
  const api = await startApi();
  try {
    await writeCells(api.baseUrl, SHEET2, {
      E1: "=1/0",
      E2: "=ZZ1",
      E3: "=NOPE(1)",
      E4: "=1+",
      E5: "=E5+1",
      E6: "=E5",
      E7: "=A1+B1",
      E8: "=E3*2",
    });

    let sheet = await openSheet(api.baseUrl);
    assert.deepEqual(
      Object.fromEntries(
        ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"].map((a) => [a, sheet.values[a]]),
      ),
      {
        E1: "#DIV/0!",
        E2: "#REF!",
        E3: "#NAME?",
        E4: "#ERROR!",
        E5: "#REF!",
        E6: "#REF!",
        E7: "5",
        E8: "#NAME?",
      },
    );
    // Every error cell keeps the formula the user submitted.
    assert.equal(sheet.cells.E3, "=NOPE(1)");
    assert.equal(sheet.cells.E4, "=1+");

    // Changing the error cell to a valid formula replaces its value and updates its dependents.
    await putCell(api.baseUrl, SHEET2, "E3", "=A1+1");
    sheet = await openSheet(api.baseUrl);
    assert.equal(sheet.cells.E3, "=A1+1");
    assert.equal(sheet.values.E3, "3");
    assert.equal(sheet.values.E8, "6");
    assert.equal(sheet.values.E7, "5");
    assert.equal(sheet.values.E1, "#DIV/0!");

    const reopened = await openSheet(api.baseUrl);
    assert.equal(reopened.values.E3, "3");
    assert.notEqual(reopened.values.E3, "#NAME?");
    assert.equal(reopened.values.E8, "6");
  } finally {
    await api.close();
  }
});
