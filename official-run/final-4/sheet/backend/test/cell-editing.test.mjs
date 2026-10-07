import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  EVO_CLEAR_FORMULA_WORKBOOK_ID,
  EVO_CLEAR_FORMULA_WORKSHEET_ID,
  EVO_CLEAR_RANGE_WORKBOOK_ID,
  EVO_CLEAR_RANGE_WORKSHEET_ID,
  EVO_CLEAR_TEXT_WORKBOOK_ID,
  EVO_CLEAR_TEXT_WORKSHEET_ID,
  SEED_SECOND_WORKSHEET_ID,
  SEED_WORKBOOK_ID,
  SEED_WORKSHEET_ID,
  createSeedState,
} from "../src/store/workbooks.mjs";

async function startApp(prepare) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-cell-"));
  if (prepare) await prepare(dataDir);
  const server = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir,
    baseUrl,
    async stop() {
      await new Promise((done) => server.close(done));
    },
    async restart() {
      await new Promise((done) => server.close(done));
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
      await new Promise((done) => restarted.listen(0, "127.0.0.1", done));
      return { baseUrl: `http://127.0.0.1:${restarted.address().port}`, stop: () => new Promise((d) => restarted.close(d)) };
    },
  };
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function send(body) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function patch(body) {
  return { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function getWorkbook(baseUrl) {
  return (await json(baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`)).body.workbook;
}

function batchUrl(worksheetId = SEED_WORKSHEET_ID) {
  return `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${worksheetId}/cells/batch`;
}

function selectionUrl(worksheetId = SEED_WORKSHEET_ID) {
  return `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${worksheetId}/selection`;
}

test("a bulk paste fills the rectangle and persists after restart", async () => {
  const app = await startApp();
  const result = await json(app.baseUrl, batchUrl(), send({ start: "D1", rows: [["East", "1200"], ["North", "800"]] }));
  assert.equal(result.status, 200);
  assert.equal(result.body.workbook.worksheets[0].cells.D1, "East");
  assert.equal(result.body.workbook.worksheets[0].cells.E2, "800");

  const restarted = await app.restart();
  const workbook = await getWorkbook(restarted.baseUrl);
  assert.equal(workbook.worksheets[0].cells.D2, "North");
  assert.equal(workbook.worksheets[0].cells.E1, "1200");
  await restarted.stop();
});

test("a paste preserves empty fields, clears targets and leaves neighbours alone", async () => {
  const app = await startApp();
  await json(app.baseUrl, batchUrl(), send({ start: "D1", rows: [["a", "b"], ["c", "d"]] }));
  const result = await json(app.baseUrl, batchUrl(), send({ start: "D1", rows: [["X", ""], ["", "Y"]] }));
  assert.equal(result.status, 200);
  const cells = result.body.workbook.worksheets[0].cells;
  assert.equal(cells.D1, "X");
  assert.equal(cells.E2, "Y");
  assert.equal(cells.E1, undefined);
  assert.equal(cells.D2, undefined);
  assert.equal(cells.C1, "Status");
  assert.equal(cells.F1, undefined);
  await app.stop();
});

test("a malformed paste is rejected and changes nothing", async () => {
  const app = await startApp();
  const before = await getWorkbook(app.baseUrl);
  const bad = await json(app.baseUrl, batchUrl(), send({ start: "nope", rows: [["a"]] }));
  assert.equal(bad.status, 400);
  const badRows = await json(app.baseUrl, batchUrl(), send({ start: "D1", rows: [["ok", 5]] }));
  assert.equal(badRows.status, 400);
  const after = await getWorkbook(app.baseUrl);
  assert.deepEqual(after.worksheets[0].cells, before.worksheets[0].cells);
  await app.stop();
});

test("each worksheet persists its own selection rectangle across restart", async () => {
  const app = await startApp();
  const first = await json(app.baseUrl, selectionUrl(), patch({ anchor: "B2", focus: "C3" }));
  assert.equal(first.status, 200);
  const second = await json(app.baseUrl, selectionUrl(SEED_SECOND_WORKSHEET_ID), patch({ anchor: "D4", focus: "D4" }));
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.workbook.worksheets[0].selection, { anchor: "B2", focus: "C3" });

  const invalid = await json(app.baseUrl, selectionUrl(), patch({ anchor: "1", focus: "B2" }));
  assert.equal(invalid.status, 400);

  const restarted = await app.restart();
  const workbook = await getWorkbook(restarted.baseUrl);
  assert.deepEqual(workbook.worksheets[0].selection, { anchor: "B2", focus: "C3" });
  assert.deepEqual(workbook.worksheets[1].selection, { anchor: "D4", focus: "D4" });
  await restarted.stop();
});

test("pre-provisions the clear-with-Delete workbooks with their worksheet and cells", async () => {
  const app = await startApp();
  const text = await json(app.baseUrl, `/api/workbooks/${EVO_CLEAR_TEXT_WORKBOOK_ID}`);
  assert.equal(text.status, 200);
  assert.equal(text.body.workbook.name, EVO_CLEAR_TEXT_WORKBOOK_ID);
  assert.equal(text.body.workbook.activeWorksheetId, EVO_CLEAR_TEXT_WORKSHEET_ID);
  assert.equal(text.body.workbook.worksheets[0].name, "Staging");
  assert.equal(text.body.workbook.worksheets[0].cells.H4, "obsolete tag");

  const formula = await json(app.baseUrl, `/api/workbooks/${EVO_CLEAR_FORMULA_WORKBOOK_ID}`);
  assert.equal(formula.body.workbook.worksheets[0].name, "Calculations");
  assert.deepEqual(formula.body.workbook.worksheets[0].cells, { B7: "13", C7: "=B7*5", D7: "=C7+2" });

  const range = await json(app.baseUrl, `/api/workbooks/${EVO_CLEAR_RANGE_WORKBOOK_ID}`);
  assert.equal(range.body.workbook.activeWorksheetId, EVO_CLEAR_RANGE_WORKSHEET_ID);
  assert.equal(range.body.workbook.worksheets[0].name, "Matrix");
  assert.equal(range.body.workbook.worksheets[0].cells.H4, "Amber");
  assert.equal(range.body.workbook.worksheets[0].cells.I4, "Delta");
  assert.equal(range.body.workbook.worksheets[0].cells.H5, "Kite");
  assert.equal(range.body.workbook.worksheets[0].cells.I5, "Orchid");

  const list = await json(app.baseUrl, "/api/workbooks");
  const ids = list.body.workbooks.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "seeding must not duplicate workbooks");
  await app.stop();
});

test("clearing a cell or a rectangle over the batch endpoint persists after a restart", async () => {
  const app = await startApp();
  const clearedText = await json(
    app.baseUrl,
    `/api/workbooks/${EVO_CLEAR_TEXT_WORKBOOK_ID}/worksheets/${EVO_CLEAR_TEXT_WORKSHEET_ID}/cells/batch`,
    send({ start: "H4", rows: [[""]] }),
  );
  assert.equal(clearedText.status, 200);
  assert.equal(clearedText.body.workbook.worksheets[0].cells.H4, undefined);

  // Clearing a formula drops its original expression; a dependent formula keeps
  // its own expression and now reads the cleared (empty) source cell.
  const clearedFormula = await json(
    app.baseUrl,
    `/api/workbooks/${EVO_CLEAR_FORMULA_WORKBOOK_ID}/worksheets/${EVO_CLEAR_FORMULA_WORKSHEET_ID}/cells/batch`,
    send({ start: "C7", rows: [[""]] }),
  );
  assert.equal(clearedFormula.status, 200);
  assert.deepEqual(clearedFormula.body.workbook.worksheets[0].cells, { B7: "13", D7: "=C7+2" });

  const clearedRange = await json(
    app.baseUrl,
    `/api/workbooks/${EVO_CLEAR_RANGE_WORKBOOK_ID}/worksheets/${EVO_CLEAR_RANGE_WORKSHEET_ID}/cells/batch`,
    send({ start: "H4", rows: [["", ""], ["", ""]] }),
  );
  assert.equal(clearedRange.status, 200);
  assert.deepEqual(clearedRange.body.workbook.worksheets[0].cells, {});

  const restarted = await app.restart();
  const text = await json(restarted.baseUrl, `/api/workbooks/${EVO_CLEAR_TEXT_WORKBOOK_ID}`);
  assert.equal(text.body.workbook.worksheets[0].cells.H4, undefined);
  const formula = await json(restarted.baseUrl, `/api/workbooks/${EVO_CLEAR_FORMULA_WORKBOOK_ID}`);
  assert.deepEqual(formula.body.workbook.worksheets[0].cells, { B7: "13", D7: "=C7+2" });
  const range = await json(restarted.baseUrl, `/api/workbooks/${EVO_CLEAR_RANGE_WORKBOOK_ID}`);
  assert.deepEqual(range.body.workbook.worksheets[0].cells, {});
  await restarted.stop();
  await app.stop();
});

test("upgrades an older store with the missing clear-with-Delete workbooks only once", async () => {
  // A store written before this round: the baseline workbook plus the earlier
  // rounds' pre-provisioned workbooks, but none of the M03 clear scenarios.
  const legacy = createSeedState();
  const clearIds = [EVO_CLEAR_TEXT_WORKBOOK_ID, EVO_CLEAR_FORMULA_WORKBOOK_ID, EVO_CLEAR_RANGE_WORKBOOK_ID];
  legacy.workbooks = legacy.workbooks.filter((workbook) => !clearIds.includes(workbook.id));
  legacy.workbooks[0].worksheets[0].cells.A1 = "Region edited";
  legacy.workbooks.push({
    id: "user-workbook-1",
    name: "My own workbook",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:05:00.000Z",
    activeWorksheetId: "user-worksheet-1",
    worksheets: [{ id: "user-worksheet-1", name: "Sheet1", selection: { anchor: "A1", focus: "A1" }, cells: {} }],
  });

  const app = await startApp(async (dataDir) => {
    await writeFile(join(dataDir, "workbooks.json"), JSON.stringify(legacy, null, 2), "utf8");
  });
  const first = await json(app.baseUrl, "/api/workbooks");
  const ids = first.body.workbooks.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const expected of clearIds) assert.ok(ids.includes(expected), `upgrade must add ${expected}`);
  assert.ok(ids.includes("user-workbook-1"));

  const upgraded = await json(app.baseUrl, `/api/workbooks/${EVO_CLEAR_FORMULA_WORKBOOK_ID}`);
  assert.deepEqual(upgraded.body.workbook.worksheets[0].cells, { B7: "13", C7: "=B7*5", D7: "=C7+2" });

  const restarted = await app.restart();
  const second = await json(restarted.baseUrl, "/api/workbooks");
  const secondIds = second.body.workbooks.map((entry) => entry.id);
  assert.equal(new Set(secondIds).size, secondIds.length);
  assert.equal(secondIds.length, ids.length);
  const baseline = await json(restarted.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
  assert.equal(baseline.body.workbook.worksheets[0].cells.A1, "Region edited");
  await restarted.stop();
  await app.stop();
});

test("a 0-to-100 numeric rule rejects a paste with the required message and keeps every value", async () => {
  const app = await startApp(async (dataDir) => {
    const state = createSeedState();
    state.workbooks[0].worksheets[0].validationRules = [
      { range: "B3", type: "number-range", min: 0, max: 100 },
    ];
    await writeFile(join(dataDir, "workbooks.json"), JSON.stringify(state, null, 2));
  });
  const before = await getWorkbook(app.baseUrl);

  // A later cell in the rectangle is the invalid one: nothing is written.
  const spread = await json(app.baseUrl, batchUrl(), send({ start: "B2", rows: [["55"], ["101"]] }));
  assert.equal(spread.status, 400);
  assert.equal(spread.body.error, "Please enter a number from 0 to 100");

  const single = await json(
    app.baseUrl,
    `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}/cells`,
    patch({ coordinate: "B3", value: "101" }),
  );
  assert.equal(single.status, 400);
  assert.equal(single.body.error, "Please enter a number from 0 to 100");

  const after = await getWorkbook(app.baseUrl);
  assert.deepEqual(after.worksheets[0].cells, before.worksheets[0].cells);

  const accepted = await json(app.baseUrl, batchUrl(), send({ start: "B3", rows: [["50"]] }));
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.workbook.worksheets[0].cells.B3, "50");
  await app.stop();
});
