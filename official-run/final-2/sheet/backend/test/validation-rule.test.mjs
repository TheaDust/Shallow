import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { SEED_WORKBOOK_ID, SEED_WORKSHEET_ID } from "../src/store/workbooks.mjs";

const BASE = `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}`;
const RULE_MESSAGE = "Please enter a number from 0 to 100";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-rule-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-rule-dist-"));
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

function put(baseUrl, path, payload) {
  return json(baseUrl, path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function del(baseUrl, path, payload) {
  return json(baseUrl, path, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function seedCells(baseUrl) {
  return json(baseUrl, `${BASE}/cells/batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ start: "A1", rows: [["Item", "Qty"], ["Pen", "4"]] }),
  });
}

test("a saved 0-to-100 rule rejects a paste with the required message and persists", async () => {
  const app = await startApp();
  try {
    assert.equal((await seedCells(app.baseUrl)).status, 200);
    const saved = await put(app.baseUrl, `${BASE}/validation-rule`, {
      range: "D1:E2",
      type: "number-range",
      min: 0,
      max: 100,
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.workbook.worksheets[0].validationRules, [
      { range: "D1:E2", type: "number-range", min: 0, max: 100 },
    ]);

    const rejected = await json(app.baseUrl, `${BASE}/cells/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ start: "D1", rows: [["East", "1200"], ["North", "800"]] }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, RULE_MESSAGE);

    // Nothing was written and the source range is untouched.
    const after = await json(app.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
    const cells = after.body.workbook.worksheets[0].cells;
    assert.equal(cells.D1, undefined);
    assert.equal(cells.E1, undefined);
    assert.equal(cells.D2, undefined);
    assert.equal(cells.E2, undefined);
    assert.equal(cells.A1, "Item");
    assert.equal(cells.B2, "4");

    // The rule survives a restart, so the constraint still applies.
    await app.restart();
    const stillRejected = await json(app.baseUrl, `${BASE}/cells`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coordinate: "D1", value: "101" }),
    });
    assert.equal(stillRejected.status, 400);
    assert.equal(stillRejected.body.error, RULE_MESSAGE);
  } finally {
    await app.stop();
  }
});

test("deleting a rule removes the constraint while keeping the cells", async () => {
  const app = await startApp();
  try {
    await put(app.baseUrl, `${BASE}/validation-rule`, { range: "D1", type: "number-range", min: 0, max: 100 });
    const removed = await del(app.baseUrl, `${BASE}/validation-rule`, { range: "D1" });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.workbook.worksheets[0].validationRules, undefined);

    const written = await json(app.baseUrl, `${BASE}/cells`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coordinate: "D1", value: "1200" }),
    });
    assert.equal(written.status, 200);
    assert.equal(written.body.workbook.worksheets[0].cells.D1, "1200");
  } finally {
    await app.stop();
  }
});

test("saving the same range replaces the rule and keeps other ranges", async () => {
  const app = await startApp();
  try {
    await put(app.baseUrl, `${BASE}/validation-rule`, { range: "D1", type: "number-range", min: 0, max: 100 });
    await put(app.baseUrl, `${BASE}/validation-rule`, { range: "E1", type: "number-range", min: 0, max: 50 });
    const replaced = await put(app.baseUrl, `${BASE}/validation-rule`, {
      range: "D1:D1",
      type: "number-range",
      min: 10,
      max: 20,
    });
    assert.equal(replaced.status, 200);
    const rules = replaced.body.workbook.worksheets[0].validationRules;
    assert.equal(rules.length, 2);
    assert.deepEqual(rules.find((rule) => rule.range === "D1"), { range: "D1", type: "number-range", min: 10, max: 20 });
    assert.deepEqual(rules.find((rule) => rule.range === "E1"), { range: "E1", type: "number-range", min: 0, max: 50 });

    const between = await json(app.baseUrl, `${BASE}/cells`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coordinate: "D1", value: "5" }),
    });
    assert.equal(between.status, 400);
    assert.equal(between.body.error, "Please enter a number between 10 and 20");
  } finally {
    await app.stop();
  }
});

test("a dropdown rule rejects values outside the allowed list", async () => {
  const app = await startApp();
  try {
    const saved = await put(app.baseUrl, `${BASE}/validation-rule`, {
      range: "C1:C2",
      type: "dropdown",
      values: [" Open ", "Closed", ""],
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.workbook.worksheets[0].validationRules, [
      { range: "C1:C2", type: "dropdown", values: ["Open", "Closed"] },
    ]);

    const rejected = await json(app.baseUrl, `${BASE}/cells`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coordinate: "C2", value: "Pending" }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Please select one of the following values: Open, Closed");
  } finally {
    await app.stop();
  }
});

test("malformed rules are rejected and leave the worksheet untouched", async () => {
  const app = await startApp();
  try {
    for (const payload of [
      { range: "nope", type: "number-range", min: 0, max: 100 },
      { range: "D1", type: "number-range", min: 100, max: 0 },
      { range: "D1", type: "number-range", min: 0 },
      { range: "D1", type: "dropdown", values: [] },
      { range: "D1", type: "unknown", min: 0, max: 100 },
    ]) {
      const response = await put(app.baseUrl, `${BASE}/validation-rule`, payload);
      assert.equal(response.status, 400, JSON.stringify(payload));
      assert.equal(response.body.error, "Invalid validation rule");
    }
    const detail = await json(app.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
    assert.equal(detail.body.workbook.worksheets[0].validationRules, undefined);
  } finally {
    await app.stop();
  }
});

const FORMULA_WORKBOOK = "/api/workbooks/wb-evo-m05-validation-formula";
const FORMULA_BASE = `${FORMULA_WORKBOOK}/worksheets/ws-evo-m05-validation-formula-thresholds`;
const GRID_WORKBOOK = "/api/workbooks/wb-evo-m05-validation-grid";
const GRID_BASE = `${GRID_WORKBOOK}/worksheets/ws-evo-m05-validation-grid-thresholds`;
const EDIT_WORKBOOK = "/api/workbooks/wb-evo-m05-validation-edit";
const EDIT_BASE = `${EDIT_WORKBOOK}/worksheets/ws-evo-m05-validation-edit-thresholds`;

function firstSheet(body) {
  return body.workbook.worksheets[0];
}

/** The stored worksheet of a workbook path, used to check a rejected write. */
async function storedSheet(baseUrl, workbookPath) {
  return firstSheet((await json(baseUrl, workbookPath)).body);
}

function patchCell(baseUrl, path, coordinate, value) {
  return json(baseUrl, `${path}/cells`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ coordinate, value }),
  });
}

test("pre-provisions the independent EVO-M05 validation workbooks", async () => {
  const app = await startApp();
  try {
    const formula = firstSheet((await json(app.baseUrl, FORMULA_WORKBOOK)).body);
    assert.equal(formula.name, "Thresholds");
    assert.deepEqual(formula.cells, { J6: "37" });
    assert.deepEqual(formula.validationRules, [
      { range: "J6", type: "number-range", min: 25, max: 75, errorMessage: "Capacity must be from 25 to 75" },
    ]);

    const grid = firstSheet((await json(app.baseUrl, GRID_WORKBOOK)).body);
    assert.deepEqual(grid.cells, { K8: "Ready" });
    assert.deepEqual(grid.validationRules, [
      {
        range: "K8",
        type: "dropdown",
        values: ["Ready", "Holding", "Released"],
        errorMessage: "Choose a queue state",
      },
    ]);

    const edit = firstSheet((await json(app.baseUrl, EDIT_WORKBOOK)).body);
    assert.deepEqual(edit.cells, { L4: "42" });
    assert.deepEqual(edit.validationRules, [
      { range: "L4", type: "number-range", min: 25, max: 75, errorMessage: "Capacity must be from 25 to 75" },
    ]);
  } finally {
    await app.stop();
  }
});

test("a custom error message replaces the standard text on every entry path and persists", async () => {
  const app = await startApp();
  try {
    // Single-cell write (grid editor and formula bar share this path).
    const rejected = await patchCell(app.baseUrl, FORMULA_BASE, "J6", "88");
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Capacity must be from 25 to 75");
    assert.equal((await storedSheet(app.baseUrl, FORMULA_WORKBOOK)).cells.J6, "37");

    // Bulk write (paste) reports the same custom text and writes nothing.
    const pasted = await json(app.baseUrl, `${FORMULA_BASE}/cells/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ start: "J5", rows: [["50"], ["88"]] }),
    });
    assert.equal(pasted.status, 400);
    assert.equal(pasted.body.error, "Capacity must be from 25 to 75");
    assert.equal((await storedSheet(app.baseUrl, FORMULA_WORKBOOK)).cells.J5, undefined);

    // Range move (cut and paste of an invalid value) is rejected the same way.
    const moved = await json(app.baseUrl, `${FORMULA_BASE}/range-transfer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "J6", rows: [["88"]], source: "A1" }),
    });
    assert.equal(moved.status, 400);
    assert.equal(moved.body.error, "Capacity must be from 25 to 75");

    // A dropdown rule reports its own custom message.
    const dropdown = await patchCell(app.baseUrl, GRID_BASE, "K8", "Paused");
    assert.equal(dropdown.status, 400);
    assert.equal(dropdown.body.error, "Choose a queue state");
    assert.equal((await storedSheet(app.baseUrl, GRID_WORKBOOK)).cells.K8, "Ready");

    await app.restart();
    const again = await patchCell(app.baseUrl, FORMULA_BASE, "J6", "88");
    assert.equal(again.status, 400);
    assert.equal(again.body.error, "Capacity must be from 25 to 75");
    assert.equal((await storedSheet(app.baseUrl, FORMULA_WORKBOOK)).cells.J6, "37");
  } finally {
    await app.stop();
  }
});

test("updating and clearing the custom error message takes effect immediately", async () => {
  const app = await startApp();
  try {
    const replaced = await put(app.baseUrl, `${EDIT_BASE}/validation-rule`, {
      range: "L4",
      type: "number-range",
      min: 25,
      max: 75,
      errorMessage: "  Allocate between 25 and 75  ",
    });
    assert.equal(replaced.status, 200);
    assert.deepEqual(firstSheet(replaced.body).validationRules, [
      { range: "L4", type: "number-range", min: 25, max: 75, errorMessage: "Allocate between 25 and 75" },
    ]);

    const rejected = await patchCell(app.baseUrl, EDIT_BASE, "L4", "24");
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Allocate between 25 and 75");
    assert.equal((await storedSheet(app.baseUrl, EDIT_WORKBOOK)).cells.L4, "42");

    await app.restart();
    const reopened = firstSheet((await json(app.baseUrl, EDIT_WORKBOOK)).body);
    assert.equal(reopened.validationRules[0].errorMessage, "Allocate between 25 and 75");

    // Clearing the field drops the custom text and the cell values stay put.
    const cleared = await put(app.baseUrl, `${EDIT_BASE}/validation-rule`, {
      range: "L4",
      type: "number-range",
      min: 25,
      max: 75,
      errorMessage: "   ",
    });
    assert.equal(cleared.status, 200);
    assert.deepEqual(firstSheet(cleared.body).validationRules, [
      { range: "L4", type: "number-range", min: 25, max: 75 },
    ]);
    const standard = await patchCell(app.baseUrl, EDIT_BASE, "L4", "24");
    assert.equal(standard.status, 400);
    assert.equal(standard.body.error, "Please enter a number between 25 and 75");
    assert.equal((await storedSheet(app.baseUrl, EDIT_WORKBOOK)).cells.L4, "42");
  } finally {
    await app.stop();
  }
});
