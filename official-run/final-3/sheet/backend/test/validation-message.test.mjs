import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

const FORMULA_ID = "EVO-M05-VALIDATION-FORMULA";
const GRID_ID = "EVO-M05-VALIDATION-GRID";
const EDIT_ID = "EVO-M05-VALIDATION-EDIT";

const CAPACITY_MESSAGE = "Capacity must be from 25 to 75";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-validation-message-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-validation-message-dist-"));
  await writeFile(join(staticRoot, "index.html"), "<!doctype html>", "utf8");
  await mkdir(join(staticRoot, "assets"), { recursive: true });
  let server;
  const app = {
    dataDir,
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

async function activeWorksheet(app, id) {
  const detail = await json(app.baseUrl, `/api/workbooks/${encodeURIComponent(id)}`);
  const workbook = detail.body.workbook;
  return {
    workbook,
    worksheet: workbook.worksheets.find((worksheet) => worksheet.id === workbook.activeWorksheetId),
    base: `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(workbook.activeWorksheetId)}`,
  };
}

test("pre-provisions the validation workbooks with their rules, messages and values", async () => {
  const app = await startApp();
  try {
    const formula = await activeWorksheet(app, FORMULA_ID);
    assert.equal(formula.worksheet.name, "Thresholds");
    assert.equal(formula.worksheet.cells.J6, "37");
    assert.deepEqual(formula.worksheet.validationRules, [
      { range: "J6", type: "number-range", min: 25, max: 75, errorMessage: CAPACITY_MESSAGE },
    ]);

    const grid = await activeWorksheet(app, GRID_ID);
    assert.equal(grid.worksheet.name, "Thresholds");
    assert.equal(grid.worksheet.cells.K8, "Ready");
    assert.deepEqual(grid.worksheet.validationRules, [
      {
        range: "K8",
        type: "dropdown",
        values: ["Ready", "Holding", "Released"],
        errorMessage: "Choose a queue state",
      },
    ]);

    const edit = await activeWorksheet(app, EDIT_ID);
    assert.equal(edit.worksheet.name, "Thresholds");
    assert.equal(edit.worksheet.cells.L4, "42");
    assert.deepEqual(edit.worksheet.validationRules, [
      { range: "L4", type: "number-range", min: 25, max: 75, errorMessage: CAPACITY_MESSAGE },
    ]);
  } finally {
    await app.stop();
  }
});

test("a custom number message replaces the standard wording on every write path", async () => {
  const app = await startApp();
  try {
    const { base } = await activeWorksheet(app, FORMULA_ID);

    // Grid editor and formula bar both write one cell.
    const single = await send(app.baseUrl, "PATCH", `${base}/cells`, { coordinate: "J6", value: "88" });
    assert.equal(single.status, 400);
    assert.equal(single.body.error, CAPACITY_MESSAGE);
    assert.equal((await activeWorksheet(app, FORMULA_ID)).worksheet.cells.J6, "37");

    // A paste into the rule range is rejected as a whole: no target keeps a value.
    const paste = await send(app.baseUrl, "POST", `${base}/cells/batch`, {
      start: "J6",
      rows: [["88", "5"]],
    });
    assert.equal(paste.status, 400);
    assert.equal(paste.body.error, CAPACITY_MESSAGE);
    const afterPaste = (await activeWorksheet(app, FORMULA_ID)).worksheet;
    assert.equal(afterPaste.cells.J6, "37");
    assert.equal(afterPaste.cells.K6, undefined);

    // A range move onto the constrained cell is rejected with the same message.
    const transfer = await send(app.baseUrl, "POST", `${base}/range-transfer`, {
      target: "J6",
      rows: [["88"]],
    });
    assert.equal(transfer.status, 400);
    assert.equal(transfer.body.error, CAPACITY_MESSAGE);
    assert.equal((await activeWorksheet(app, FORMULA_ID)).worksheet.cells.J6, "37");

    await app.restart();
    const reopened = (await activeWorksheet(app, FORMULA_ID)).worksheet;
    assert.equal(reopened.cells.J6, "37");
    const still = await send(app.baseUrl, "PATCH", `${base}/cells`, { coordinate: "J6", value: "88" });
    assert.equal(still.status, 400);
    assert.equal(still.body.error, CAPACITY_MESSAGE);
  } finally {
    await app.stop();
  }
});

test("a custom dropdown message replaces the standard wording", async () => {
  const app = await startApp();
  try {
    const { base } = await activeWorksheet(app, GRID_ID);
    const rejected = await send(app.baseUrl, "PATCH", `${base}/cells`, { coordinate: "K8", value: "Paused" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Choose a queue state");
    assert.equal((await activeWorksheet(app, GRID_ID)).worksheet.cells.K8, "Ready");

    const allowed = await send(app.baseUrl, "PATCH", `${base}/cells`, { coordinate: "K8", value: "Holding" });
    assert.equal(allowed.status, 200);
    assert.equal((await activeWorksheet(app, GRID_ID)).worksheet.cells.K8, "Holding");
  } finally {
    await app.stop();
  }
});

test("updating or clearing a rule's error message takes effect immediately and persists", async () => {
  const app = await startApp();
  try {
    const { base } = await activeWorksheet(app, EDIT_ID);
    const updated = await send(app.baseUrl, "PUT", `${base}/validation-rule`, {
      range: "L4",
      type: "number-range",
      min: 25,
      max: 75,
      errorMessage: "  Allocate between 25 and 75  ",
    });
    assert.equal(updated.status, 200);
    const worksheet = updated.body.workbook.worksheets.find((entry) => entry.id === updated.body.workbook.activeWorksheetId);
    assert.deepEqual(worksheet.validationRules, [
      { range: "L4", type: "number-range", min: 25, max: 75, errorMessage: "Allocate between 25 and 75" },
    ]);
    assert.equal(worksheet.cells.L4, "42");

    const rejected = await send(app.baseUrl, "PATCH", `${base}/cells`, { coordinate: "L4", value: "24" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Allocate between 25 and 75");
    assert.equal((await activeWorksheet(app, EDIT_ID)).worksheet.cells.L4, "42");

    await app.restart();
    const reopened = (await activeWorksheet(app, EDIT_ID)).worksheet;
    assert.equal(reopened.validationRules[0].errorMessage, "Allocate between 25 and 75");

    // Clearing the message brings the standard wording back.
    const cleared = await send(app.baseUrl, "PUT", `${base}/validation-rule`, {
      range: "L4",
      type: "number-range",
      min: 25,
      max: 75,
      errorMessage: "   ",
    });
    assert.equal(cleared.status, 200);
    const clearedSheet = cleared.body.workbook.worksheets.find(
      (entry) => entry.id === cleared.body.workbook.activeWorksheetId,
    );
    assert.deepEqual(clearedSheet.validationRules, [{ range: "L4", type: "number-range", min: 25, max: 75 }]);

    const standard = await send(app.baseUrl, "PATCH", `${base}/cells`, { coordinate: "L4", value: "24" });
    assert.equal(standard.status, 400);
    assert.equal(standard.body.error, "Please enter a number between 25 and 75");
  } finally {
    await app.stop();
  }
});
