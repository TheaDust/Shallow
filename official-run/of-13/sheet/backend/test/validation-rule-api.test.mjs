/**
 * REQ-5-2-1: saving, enforcing, modifying and deleting data-validation rules of a range.
 *
 * A rule is stored on the worksheet (`range`, `type`, `min`/`max` or `values`), so it survives
 * a restart; every write path of the server (single cell, bulk paste, range move) checks the
 * same `domain/validation.mjs` and refuses the whole operation when any target is invalid.
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
const SHEET1 = "wb-q3-sales-sheet-1";
const SHEET2 = "wb-q3-sales-sheet-2";

async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-rules-"));
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
  return { status: response.status, body: await response.json() };
}

function openWorkbook(baseUrl) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}`);
}

function sheetOf(workbook, sheetId) {
  return workbook.sheets.find((sheet) => sheet.id === sheetId);
}

function saveRules(baseUrl, sheetId, validations) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${sheetId}/validations`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ validations }),
  });
}

function putCell(baseUrl, sheetId, address, value) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${sheetId}/cells/${address}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });
}

function paste(baseUrl, sheetId, start, text) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${sheetId}/paste`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ start, text }),
  });
}

function transfer(baseUrl, sheetId, source, target, mode) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${sheetId}/range-transfer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, target, mode }),
  });
}

const DROPDOWN_MESSAGE = "Please select one of the following values: Open, Closed";
const BOUNDARY_MESSAGE = "Please enter a number from 0 to 100";

test("a dropdown rule trims its allowed values and rejects every other write", async () => {
  const api = await startApi();
  try {
    const saved = await saveRules(api.baseUrl, SHEET1, [
      { id: "r1", range: "C2:C4", type: "dropdown", values: [" Open ", "Closed", "Open"] },
    ]);
    assert.equal(saved.status, 200);
    const rule = sheetOf(saved.body.workbook, SHEET1).validations[0];
    assert.deepEqual(rule.values, ["Open", "Closed"]);
    assert.equal(rule.range, "C2:C4");

    const allowed = await putCell(api.baseUrl, SHEET1, "C2", "Open");
    assert.equal(allowed.status, 200);

    const rejected = await putCell(api.baseUrl, SHEET1, "C3", "Pending");
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, DROPDOWN_MESSAGE);
    const afterCell = sheetOf((await openWorkbook(api.baseUrl)).body.workbook, SHEET1);
    assert.equal(afterCell.cells.C3, "Closed");
    assert.equal(afterCell.cells.C4, "Open");

    // A bulk paste into the rule is refused as a whole, not cell by cell.
    const pasted = await paste(api.baseUrl, SHEET1, "C2", "Pending\nOpen");
    assert.equal(pasted.status, 400);
    assert.equal(pasted.body.error, DROPDOWN_MESSAGE);
    const afterPaste = sheetOf((await openWorkbook(api.baseUrl)).body.workbook, SHEET1);
    assert.equal(afterPaste.cells.C2, "Open");
    assert.equal(afterPaste.cells.C3, "Closed");

    // Moving a value into the constrained range is refused with the same message.
    const moved = await transfer(api.baseUrl, SHEET1, { start: "B2" }, { start: "C2" }, "copy");
    assert.equal(moved.status, 400);
    assert.equal(moved.body.error, DROPDOWN_MESSAGE);
    const afterMove = sheetOf((await openWorkbook(api.baseUrl)).body.workbook, SHEET1);
    assert.equal(afterMove.cells.B2, "1200");
    assert.equal(afterMove.cells.C2, "Open");

    // A blank value is always accepted, like an empty cell.
    const cleared = await putCell(api.baseUrl, SHEET1, "C2", "");
    assert.equal(cleared.status, 200);
  } finally {
    await api.close();
  }
});

test("a 0-to-100 number range rule is inclusive and uses the boundary wording", async () => {
  const api = await startApi();
  try {
    const saved = await saveRules(api.baseUrl, SHEET1, [
      { id: "r1", range: "B2:B3", type: "number-range", min: 0, max: 100 },
    ]);
    assert.equal(saved.status, 200);
    // Saving a rule leaves the existing values of its range untouched, even out-of-range ones.
    const stored = sheetOf(saved.body.workbook, SHEET1);
    assert.equal(stored.cells.B2, "1200");
    assert.equal(stored.cells.B3, "800");
    assert.equal(stored.validations[0].min, 0);
    assert.equal(stored.validations[0].max, 100);

    const lower = await putCell(api.baseUrl, SHEET1, "B2", "0");
    assert.equal(lower.status, 200);
    const upper = await putCell(api.baseUrl, SHEET1, "B2", "100");
    assert.equal(upper.status, 200);

    const rejected = await putCell(api.baseUrl, SHEET1, "B3", "101");
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, BOUNDARY_MESSAGE);

    const pasted = await paste(api.baseUrl, SHEET1, "B2", "1\t2\n101\t4");
    assert.equal(pasted.status, 400);
    assert.equal(pasted.body.error, BOUNDARY_MESSAGE);
    const afterPaste = sheetOf((await openWorkbook(api.baseUrl)).body.workbook, SHEET1);
    assert.deepEqual(
      { B2: afterPaste.cells.B2, C2: afterPaste.cells.C2, B3: afterPaste.cells.B3, C3: afterPaste.cells.C3 },
      { B2: "100", C2: "Open", B3: "800", C3: "Closed" },
    );

    // The rule travels with the cells it constrains when rows are inserted above them.
    const inserted = await callJson(
      api.baseUrl,
      `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}/rows`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "insert-above", row: 2 }),
      },
    );
    assert.equal(inserted.status, 200);
    const shifted = sheetOf(inserted.body.workbook, SHEET1);
    assert.equal(shifted.validations[0].range, "B3:B4");
    const stillRejected = await putCell(api.baseUrl, SHEET1, "B4", "101");
    assert.equal(stillRejected.status, 400);
    assert.equal(stillRejected.body.error, BOUNDARY_MESSAGE);
    const nowFree = await putCell(api.baseUrl, SHEET1, "B2", "101");
    assert.equal(nowFree.status, 200);
  } finally {
    await api.close();
  }
});

test("other bounds keep the between wording", async () => {
  const api = await startApi();
  try {
    await saveRules(api.baseUrl, SHEET1, [
      { id: "r1", range: "B2", type: "number-range", min: 1, max: 10 },
    ]);
    const rejected = await putCell(api.baseUrl, SHEET1, "B2", "11");
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Please enter a number between 1 and 10");
    const accepted = await putCell(api.baseUrl, SHEET1, "B2", "10");
    assert.equal(accepted.status, 200);
  } finally {
    await api.close();
  }
});

test("a rule can be modified and deleted, and both survive a restart", async () => {
  const api = await startApi();
  try {
    await saveRules(api.baseUrl, SHEET1, [
      { id: "r1", range: "B2:B3", type: "number-range", min: 0, max: 100 },
    ]);

    // Saving the same id replaces the rule; the new range is effective immediately.
    const modified = await saveRules(api.baseUrl, SHEET1, [
      { id: "r1", range: "B2", type: "number-range", min: 1, max: 10 },
    ]);
    assert.equal(modified.status, 200);
    const rules = sheetOf(modified.body.workbook, SHEET1).validations;
    assert.equal(rules.length, 1);
    assert.equal(rules[0].range, "B2");

    const previouslyConstrained = await putCell(api.baseUrl, SHEET1, "B3", "9999");
    assert.equal(previouslyConstrained.status, 200);

    const restarted = await createWorkbookStore(api.directory).read();
    assert.equal(sheetOf(restarted.workbooks[0], SHEET1).validations[0].range, "B2");

    const deleted = await saveRules(api.baseUrl, SHEET1, []);
    assert.equal(deleted.status, 200);
    assert.deepEqual(sheetOf(deleted.body.workbook, SHEET1).validations, []);
    const free = await putCell(api.baseUrl, SHEET1, "B2", "777");
    assert.equal(free.status, 200);

    const afterRestart = await createWorkbookStore(api.directory).read();
    assert.deepEqual(sheetOf(afterRestart.workbooks[0], SHEET1).validations, []);
    assert.equal(sheetOf(afterRestart.workbooks[0], SHEET2).validations, undefined);
  } finally {
    await api.close();
  }
});

test("unusable rule lists are rejected without touching the stored rules", async () => {
  const api = await startApi();
  try {
    await saveRules(api.baseUrl, SHEET1, [
      { id: "r1", range: "B2", type: "dropdown", values: ["East", "North"] },
    ]);
    const before = await openWorkbook(api.baseUrl);

    const cases = [
      { validations: "nope" },
      { validations: [{ id: "x", range: "nope", type: "dropdown", values: ["a"] }] },
      { validations: [{ id: "x", range: "B2", type: "dropdown", values: [] }] },
      { validations: [{ id: "x", range: "B2", type: "dropdown", values: ["   "] }] },
      { validations: [{ id: "x", range: "B2", type: "number-range", min: 0 }] },
      { validations: [{ id: "x", range: "B2", type: "unknown" }] },
    ];
    for (const payload of cases) {
      const rejected = await saveRules(api.baseUrl, SHEET1, payload.validations);
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, "Invalid validation rules");
    }

    const after = await openWorkbook(api.baseUrl);
    assert.deepEqual(after.body.workbook, before.body.workbook);
  } finally {
    await api.close();
  }
});
