import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { SEED_WORKBOOK_ID, SEED_WORKSHEET_ID } from "../src/store/workbooks.mjs";

/** Pre-provisioned workbooks of REQ-5-2-1, one per scenario. */
const FORMULA = "wb-evo-m05-validation-formula";
const FORMULA_SHEET = "ws-evo-m05-validation-formula-thresholds";
const GRID = "wb-evo-m05-validation-grid";
const GRID_SHEET = "ws-evo-m05-validation-grid-thresholds";
const EDIT = "wb-evo-m05-validation-edit";
const EDIT_SHEET = "ws-evo-m05-validation-edit-thresholds";

const NUMERIC_MESSAGE = "Capacity must be from 25 to 75";
const DROPDOWN_MESSAGE = "Choose a queue state";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-validation-message-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-validation-message-dist-"));
  await writeFile(join(staticRoot, "index.html"), "<!doctype html>", "utf8");
  await mkdir(join(staticRoot, "assets"), { recursive: true });
  let server;
  const app = {
    dataDir,
    staticRoot,
    baseUrl: "",
    async listen() {
      server = createServer(createRequestHandler({ dataDir, staticRoot }));
      await new Promise((done) => server.listen(0, "127.0.0.1", done));
      app.baseUrl = `http://127.0.0.1:${server.address().port}`;
      return app.baseUrl;
    },
    async stop() {
      if (!server) return;
      const closing = server;
      server = undefined;
      await new Promise((done) => closing.close(done));
    },
    async restart() {
      await app.stop();
      return app.listen();
    },
  };
  await app.listen();
  return app;
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function send(baseUrl, method, path, payload) {
  return json(baseUrl, path, {
    method,
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

function getWorkbook(baseUrl, id) {
  return json(baseUrl, `/api/workbooks/${id}`).then((response) => response.body.workbook);
}

function worksheetOf(workbook, worksheetId) {
  return workbook.worksheets.find((worksheet) => worksheet.id === worksheetId);
}

test("the pre-provisioned validation workbooks carry their cell, rule and message", async () => {
  const app = await startApp();
  try {
    const formula = await getWorkbook(app.baseUrl, FORMULA);
    const formulaSheet = worksheetOf(formula, FORMULA_SHEET);
    assert.equal(formulaSheet.name, "Thresholds");
    assert.equal(formulaSheet.cells.J6, "37");
    assert.deepEqual(formulaSheet.selection, { anchor: "J6", focus: "J6" });
    assert.deepEqual(formulaSheet.validationRules, [
      { range: "J6", type: "number-range", min: 25, max: 75, message: NUMERIC_MESSAGE },
    ]);

    const grid = worksheetOf(await getWorkbook(app.baseUrl, GRID), GRID_SHEET);
    assert.equal(grid.cells.K8, "Ready");
    assert.deepEqual(grid.validationRules, [
      { range: "K8", type: "dropdown", values: ["Ready", "Holding", "Released"], message: DROPDOWN_MESSAGE },
    ]);

    const edit = worksheetOf(await getWorkbook(app.baseUrl, EDIT), EDIT_SHEET);
    assert.equal(edit.cells.L4, "42");
    assert.equal(edit.validationRules[0].message, NUMERIC_MESSAGE);
  } finally {
    await app.stop();
  }
});

test("a custom numeric message replaces the standard one on every entry path and persists", async () => {
  const app = await startApp();
  const base = `/api/workbooks/${FORMULA}/worksheets/${FORMULA_SHEET}`;
  try {
    const rejected = await send(app.baseUrl, "PATCH", `${base}/cells`, { coordinate: "J6", value: "88" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, NUMERIC_MESSAGE);
    // The rejected value is not stored: the cell keeps its last value.
    assert.equal(worksheetOf(await getWorkbook(app.baseUrl, FORMULA), FORMULA_SHEET).cells.J6, "37");

    // A bulk write (paste) is rejected as a whole with the same message.
    const pasted = await send(app.baseUrl, "POST", `${base}/cells/batch`, { start: "J6", rows: [["88"]] });
    assert.equal(pasted.status, 400);
    assert.equal(pasted.body.error, NUMERIC_MESSAGE);

    // A move onto the constrained cell is rejected too and keeps both ranges.
    const moved = await send(app.baseUrl, "POST", `${base}/range-transfer`, {
      target: "J6",
      rows: [["99"]],
      source: "J8",
    });
    assert.equal(moved.status, 400);
    assert.equal(moved.body.error, NUMERIC_MESSAGE);

    await app.restart();
    const after = worksheetOf(await getWorkbook(app.baseUrl, FORMULA), FORMULA_SHEET);
    assert.equal(after.cells.J6, "37");
    const stillRejected = await send(app.baseUrl, "PATCH", `${base}/cells`, { coordinate: "J6", value: "88" });
    assert.equal(stillRejected.status, 400);
    assert.equal(stillRejected.body.error, NUMERIC_MESSAGE);
  } finally {
    await app.stop();
  }
});

test("a custom dropdown message replaces the standard value list and persists", async () => {
  const app = await startApp();
  const base = `/api/workbooks/${GRID}/worksheets/${GRID_SHEET}`;
  try {
    const rejected = await send(app.baseUrl, "PATCH", `${base}/cells`, { coordinate: "K8", value: "Paused" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, DROPDOWN_MESSAGE);

    await app.restart();
    const after = worksheetOf(await getWorkbook(app.baseUrl, GRID), GRID_SHEET);
    assert.equal(after.cells.K8, "Ready");
    const again = await send(app.baseUrl, "PATCH", `${base}/cells`, { coordinate: "K8", value: "Paused" });
    assert.equal(again.status, 400);
    assert.equal(again.body.error, DROPDOWN_MESSAGE);
    // An allowed value still goes through.
    const allowed = await send(app.baseUrl, "PATCH", `${base}/cells`, { coordinate: "K8", value: "Holding" });
    assert.equal(allowed.status, 200);
  } finally {
    await app.stop();
  }
});

test("updating and clearing the message takes effect immediately", async () => {
  const app = await startApp();
  const base = `/api/workbooks/${EDIT}/worksheets/${EDIT_SHEET}`;
  try {
    const updated = await send(app.baseUrl, "PUT", `${base}/validation-rule`, {
      range: "L4",
      type: "number-range",
      min: 25,
      max: 75,
      message: "Allocate between 25 and 75",
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(worksheetOf(updated.body.workbook, EDIT_SHEET).validationRules, [
      { range: "L4", type: "number-range", min: 25, max: 75, message: "Allocate between 25 and 75" },
    ]);
    const rejected = await send(app.baseUrl, "PATCH", `${base}/cells`, { coordinate: "L4", value: "24" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Allocate between 25 and 75");

    await app.restart();
    const reopened = worksheetOf(await getWorkbook(app.baseUrl, EDIT), EDIT_SHEET);
    assert.equal(reopened.cells.L4, "42");
    assert.equal(reopened.validationRules[0].message, "Allocate between 25 and 75");

    // Clearing the field brings the standard wording back.
    const cleared = await send(app.baseUrl, "PUT", `${base}/validation-rule`, {
      range: "L4",
      type: "number-range",
      min: 25,
      max: 75,
      message: "   ",
    });
    assert.equal(cleared.status, 200);
    assert.equal(worksheetOf(cleared.body.workbook, EDIT_SHEET).validationRules[0].message, undefined);
    const standard = await send(app.baseUrl, "PATCH", `${base}/cells`, { coordinate: "L4", value: "24" });
    assert.equal(standard.status, 400);
    assert.equal(standard.body.error, "Please enter a number between 25 and 75");
  } finally {
    await app.stop();
  }
});

test("rules without a message keep the standard wording of the baseline workbook", async () => {
  const app = await startApp();
  const base = `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}`;
  try {
    await send(app.baseUrl, "PUT", `${base}/validation-rule`, { range: "D1", type: "number-range", min: 0, max: 100 });
    const rejected = await send(app.baseUrl, "PATCH", `${base}/cells`, { coordinate: "D1", value: "101" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Please enter a number from 0 to 100");

    const dropdown = await send(app.baseUrl, "PUT", `${base}/validation-rule`, {
      range: "C1",
      type: "dropdown",
      values: ["Open", "Closed"],
    });
    assert.equal(dropdown.status, 200);
    const outside = await send(app.baseUrl, "PATCH", `${base}/cells`, { coordinate: "C1", value: "Pending" });
    assert.equal(outside.status, 400);
    assert.equal(outside.body.error, "Please select one of the following values: Open, Closed");
  } finally {
    await app.stop();
  }
});
