import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  EVO_FORMAT_EDIT_ID,
  EVO_FORMAT_EDIT_WORKSHEET_ID,
  EVO_FORMAT_NUMBER_ID,
  EVO_FORMAT_NUMBER_WORKSHEET_ID,
  EVO_FORMAT_TEXT_ID,
  EVO_FORMAT_TEXT_WORKSHEET_ID,
  createSeedState,
} from "../src/store/workbooks.mjs";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-conditional-"));
  const server = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    baseUrl,
    async restart() {
      await new Promise((done) => server.close(done));
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
      await new Promise((done) => restarted.listen(0, "127.0.0.1", done));
      return {
        baseUrl: `http://127.0.0.1:${restarted.address().port}`,
        stop: () => new Promise((done) => restarted.close(done)),
      };
    },
    stop() {
      return new Promise((done) => server.close(done));
    },
  };
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function send(method, body) {
  return body === undefined
    ? { method, headers: { "content-type": "application/json" } }
    : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function rulesUrl(workbookId, worksheetId) {
  return `/api/workbooks/${workbookId}/worksheets/${worksheetId}/conditional-rules`;
}

async function getWorkbook(baseUrl, workbookId) {
  const response = await json(baseUrl, `/api/workbooks/${workbookId}`);
  assert.equal(response.status, 200);
  return response.body.workbook;
}

function sheetOf(workbook, name) {
  return workbook.worksheets.find((sheet) => sheet.name === name) ?? workbook.worksheets[0];
}

test("the seed pre-provisions the three conditional formatting workbooks", () => {
  const state = createSeedState();
  const byId = (id) => state.workbooks.find((workbook) => workbook.id === id);

  const number = byId(EVO_FORMAT_NUMBER_ID);
  assert.equal(number.name, "EVO-N04-FORMAT-NUMBER");
  assert.equal(number.activeWorksheetId, EVO_FORMAT_NUMBER_WORKSHEET_ID);
  assert.deepEqual(number.worksheets[0].cells, { J4: "11", J5: "29", J6: "46" });
  assert.equal(number.worksheets[0].conditionalRules, undefined);

  const text = byId(EVO_FORMAT_TEXT_ID);
  assert.equal(text.activeWorksheetId, EVO_FORMAT_TEXT_WORKSHEET_ID);
  assert.deepEqual(text.worksheets[0].cells, { K4: "Watch", K5: "Stable", K6: "Elevated" });

  const edit = byId(EVO_FORMAT_EDIT_ID);
  assert.equal(edit.activeWorksheetId, EVO_FORMAT_EDIT_WORKSHEET_ID);
  assert.deepEqual(edit.worksheets[0].cells, { L3: "16", L4: "28", L5: "39" });
  assert.deepEqual(edit.worksheets[0].conditionalRules, [
    { range: "L3:L5", condition: "greater-than", value: "20", style: "red-fill" },
  ]);
});

test("a rule is appended and survives a restart without touching the cells", async () => {
  const app = await startApp();
  try {
    const created = await json(app.baseUrl, rulesUrl(EVO_FORMAT_NUMBER_ID, EVO_FORMAT_NUMBER_WORKSHEET_ID), send("POST", {
      range: "J4:J6",
      condition: "greater-than",
      value: "25",
      style: "red-fill",
    }));
    assert.equal(created.status, 201);
    assert.deepEqual(sheetOf(created.body.workbook, "Signals").conditionalRules, [
      { range: "J4:J6", condition: "greater-than", value: "25", style: "red-fill" },
    ]);
    assert.deepEqual(sheetOf(created.body.workbook, "Signals").cells, { J4: "11", J5: "29", J6: "46" });

    const restarted = await app.restart();
    const reloaded = await getWorkbook(restarted.baseUrl, EVO_FORMAT_NUMBER_ID);
    assert.deepEqual(sheetOf(reloaded, "Signals").conditionalRules, [
      { range: "J4:J6", condition: "greater-than", value: "25", style: "red-fill" },
    ]);
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("a text rule keeps its condition and value as written", async () => {
  const app = await startApp();
  try {
    const created = await json(app.baseUrl, rulesUrl(EVO_FORMAT_TEXT_ID, EVO_FORMAT_TEXT_WORKSHEET_ID), send("POST", {
      range: "K4:K6",
      condition: "text-contains",
      value: "  Watch  ",
      style: "yellow-fill",
    }));
    assert.equal(created.status, 201);
    assert.deepEqual(sheetOf(created.body.workbook, "Signals").conditionalRules, [
      { range: "K4:K6", condition: "text-contains", value: "Watch", style: "yellow-fill" },
    ]);
  } finally {
    await app.stop();
  }
});

test("rule 1 is replaced by index, keeping a single rule per replacement", async () => {
  const app = await startApp();
  try {
    const replaced = await json(
      app.baseUrl,
      rulesUrl(EVO_FORMAT_EDIT_ID, EVO_FORMAT_EDIT_WORKSHEET_ID),
      send("PUT", { index: 0, range: "L3:L5", condition: "greater-than", value: "20", style: "green-fill" }),
    );
    assert.equal(replaced.status, 200);
    assert.deepEqual(sheetOf(replaced.body.workbook, "Signals").conditionalRules, [
      { range: "L3:L5", condition: "greater-than", value: "20", style: "green-fill" },
    ]);
    assert.deepEqual(sheetOf(replaced.body.workbook, "Signals").cells, { L3: "16", L4: "28", L5: "39" });

    const restarted = await app.restart();
    const reloaded = await getWorkbook(restarted.baseUrl, EVO_FORMAT_EDIT_ID);
    assert.deepEqual(sheetOf(reloaded, "Signals").conditionalRules, [
      { range: "L3:L5", condition: "greater-than", value: "20", style: "green-fill" },
    ]);
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("deleting rule 1 removes every fill rule and persists", async () => {
  const app = await startApp();
  try {
    const deleted = await json(
      app.baseUrl,
      rulesUrl(EVO_FORMAT_EDIT_ID, EVO_FORMAT_EDIT_WORKSHEET_ID),
      send("DELETE", { index: 0 }),
    );
    assert.equal(deleted.status, 200);
    assert.equal(sheetOf(deleted.body.workbook, "Signals").conditionalRules, undefined);
    assert.deepEqual(sheetOf(deleted.body.workbook, "Signals").cells, { L3: "16", L4: "28", L5: "39" });

    const restarted = await app.restart();
    const reloaded = await getWorkbook(restarted.baseUrl, EVO_FORMAT_EDIT_ID);
    assert.equal(sheetOf(reloaded, "Signals").conditionalRules, undefined);
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("an incomplete or unknown rule is rejected without changing the stored rules", async () => {
  const app = await startApp();
  try {
    const payloads = [
      { range: "J4:J6", condition: "greater-than", value: "", style: "red-fill" },
      { range: "J4:J6", condition: "greater-than", value: "25", style: "blue-fill" },
      { range: "J4:J6", condition: "equals", value: "25", style: "red-fill" },
      { range: "nonsense", condition: "greater-than", value: "25", style: "red-fill" },
    ];
    for (const payload of payloads) {
      const rejected = await json(
        app.baseUrl,
        rulesUrl(EVO_FORMAT_NUMBER_ID, EVO_FORMAT_NUMBER_WORKSHEET_ID),
        send("POST", payload),
      );
      assert.equal(rejected.status, 400, JSON.stringify(payload));
      assert.equal(rejected.body.error, "Invalid conditional formatting rule", JSON.stringify(payload));
    }
    // An index outside the stored list is rejected as well.
    const missing = await json(
      app.baseUrl,
      rulesUrl(EVO_FORMAT_NUMBER_ID, EVO_FORMAT_NUMBER_WORKSHEET_ID),
      send("PUT", { index: 3, range: "J4:J6", condition: "greater-than", value: "25", style: "red-fill" }),
    );
    assert.equal(missing.status, 400);
    const removed = await json(
      app.baseUrl,
      rulesUrl(EVO_FORMAT_NUMBER_ID, EVO_FORMAT_NUMBER_WORKSHEET_ID),
      send("DELETE", { index: 0 }),
    );
    assert.equal(removed.status, 400);

    const reloaded = await getWorkbook(app.baseUrl, EVO_FORMAT_NUMBER_ID);
    assert.equal(sheetOf(reloaded, "Signals").conditionalRules, undefined);
  } finally {
    await app.stop();
  }
});

test("a row insertion moves the rule range with the cells it paints", async () => {
  const app = await startApp();
  try {
    const changed = await json(
      app.baseUrl,
      `/api/workbooks/${EVO_FORMAT_EDIT_ID}/worksheets/${EVO_FORMAT_EDIT_WORKSHEET_ID}/structure`,
      send("POST", { axis: "row", mode: "insert-before", index: 3 }),
    );
    assert.equal(changed.status, 200);
    const worksheet = sheetOf(changed.body.workbook, "Signals");
    assert.deepEqual(worksheet.conditionalRules, [
      { range: "L4:L6", condition: "greater-than", value: "20", style: "red-fill" },
    ]);
    assert.equal(worksheet.cells.L4, "16");
    assert.equal(worksheet.cells.L5, "28");
    assert.equal(worksheet.cells.L6, "39");
  } finally {
    await app.stop();
  }
});
