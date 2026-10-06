import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

/** Pre-provisioned workbooks of REQ-7-2-1, one per scenario. */
const NUMBER = "wb-evo-n04-format-number";
const NUMBER_SHEET = "ws-evo-n04-format-number-signals";
const TEXT = "wb-evo-n04-format-text";
const TEXT_SHEET = "ws-evo-n04-format-text-signals";
const EDIT = "wb-evo-n04-format-edit";
const EDIT_SHEET = "ws-evo-n04-format-edit-signals";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-conditional-format-"));
  const server = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir,
    baseUrl,
    async stop() {
      await new Promise((done) => server.close(done));
    },
    /** Reopens the same data directory, as a browser refresh does. */
    async restart() {
      await new Promise((done) => server.close(done));
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
      await new Promise((done) => restarted.listen(0, "127.0.0.1", done));
      const url = `http://127.0.0.1:${restarted.address().port}`;
      return {
        baseUrl: url,
        stop: () => new Promise((done) => restarted.close(done)),
      };
    },
  };
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

function rulesOf(workbook, worksheetId) {
  return (worksheetOf(workbook, worksheetId).conditionalFormats ?? []).map((rule) => ({
    range: rule.range,
    condition: rule.condition,
    value: rule.value,
    style: rule.style,
  }));
}

test("the pre-provisioned formatting workbooks carry their cells and seeded rule", async () => {
  const app = await startApp();
  try {
    const number = worksheetOf(await getWorkbook(app.baseUrl, NUMBER), NUMBER_SHEET);
    assert.equal(number.name, "Signals");
    assert.deepEqual([number.cells.J4, number.cells.J5, number.cells.J6], ["11", "29", "46"]);
    assert.equal(number.conditionalFormats, undefined);

    const text = worksheetOf(await getWorkbook(app.baseUrl, TEXT), TEXT_SHEET);
    assert.deepEqual([text.cells.K4, text.cells.K5, text.cells.K6], ["Watch", "Stable", "Elevated"]);
    assert.equal(text.conditionalFormats, undefined);

    const edit = await getWorkbook(app.baseUrl, EDIT);
    assert.deepEqual(rulesOf(edit, EDIT_SHEET), [
      { range: "L3:L5", condition: "Greater than", value: "20", style: "Red fill" },
    ]);
  } finally {
    await app.stop();
  }
});

test("a saved rule and its fill survive a refresh, and deleting it removes the effect", async () => {
  const app = await startApp();
  const base = `/api/workbooks/${NUMBER}/worksheets/${NUMBER_SHEET}`;
  try {
    const saved = await send(app.baseUrl, "PUT", `${base}/conditional-format`, {
      range: "j4:j6",
      condition: "Greater than",
      value: " 25 ",
      style: "Red fill",
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(rulesOf(saved.body.workbook, NUMBER_SHEET), [
      { range: "J4:J6", condition: "Greater than", value: "25", style: "Red fill" },
    ]);
    const ruleId = saved.body.workbook.worksheets[0].conditionalFormats[0].id;

    const refreshed = await app.restart();
    const afterRestart = await getWorkbook(refreshed.baseUrl, NUMBER);
    assert.deepEqual(rulesOf(afterRestart, NUMBER_SHEET), [
      { range: "J4:J6", condition: "Greater than", value: "25", style: "Red fill" },
    ]);

    const deleted = await send(refreshed.baseUrl, "DELETE", `${base}/conditional-format`, { id: ruleId });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.workbook.worksheets[0].conditionalFormats, undefined);
    // The cells themselves are never touched by a rule or its removal.
    assert.deepEqual(
      [deleted.body.workbook.worksheets[0].cells.J4, deleted.body.workbook.worksheets[0].cells.J5],
      ["11", "29"],
    );
    await refreshed.stop();
  } finally {
    await app.stop();
  }
});

test("editing a stored rule replaces exactly that rule of the same worksheet", async () => {
  const app = await startApp();
  const base = `/api/workbooks/${EDIT}/worksheets/${EDIT_SHEET}`;
  try {
    const stored = (await getWorkbook(app.baseUrl, EDIT)).worksheets[0].conditionalFormats[0];
    const edited = await send(app.baseUrl, "PUT", `${base}/conditional-format`, {
      id: stored.id,
      range: "L3:L5",
      condition: "Greater than",
      value: "20",
      style: "Green fill",
    });
    assert.equal(edited.status, 200);
    const rules = edited.body.workbook.worksheets[0].conditionalFormats;
    assert.equal(rules.length, 1);
    assert.equal(rules[0].id, stored.id);
    assert.equal(rules[0].style, "Green fill");

    // A text rule is stored next to it without replacing the edited one, and a
    // row inserted above the range moves the rule with its cells.
    const added = await send(app.baseUrl, "PUT", `${base}/conditional-format`, {
      range: "L3:L3",
      condition: "Text contains",
      value: "Watch",
      style: "Yellow fill",
    });
    assert.equal(added.status, 200);
    assert.equal(added.body.workbook.worksheets[0].conditionalFormats.length, 2);

    const shifted = await send(app.baseUrl, "POST", `/api/workbooks/${EDIT}/worksheets/${EDIT_SHEET}/structure`, {
      axis: "row",
      mode: "insert-before",
      index: 3,
    });
    assert.equal(shifted.status, 200);
    assert.deepEqual(
      shifted.body.workbook.worksheets[0].conditionalFormats.map((rule) => rule.range),
      ["L4:L6", "L4"],
    );
  } finally {
    await app.stop();
  }
});

test("a malformed rule payload is rejected and leaves the stored rules unchanged", async () => {
  const app = await startApp();
  const base = `/api/workbooks/${TEXT}/worksheets/${TEXT_SHEET}`;
  try {
    const cases = [
      { range: "K4:", condition: "Greater than", value: "25", style: "Red fill" },
      { range: "K4:K6", condition: "Equals", value: "25", style: "Red fill" },
      { range: "K4:K6", condition: "Greater than", value: "   ", style: "Red fill" },
      { range: "K4:K6", condition: "Greater than", value: "25", style: "Blue fill" },
    ];
    for (const payload of cases) {
      const rejected = await send(app.baseUrl, "PUT", `${base}/conditional-format`, payload);
      assert.equal(rejected.status, 400);
    }
    assert.equal((await getWorkbook(app.baseUrl, TEXT)).worksheets[0].conditionalFormats, undefined);

    const accepted = await send(app.baseUrl, "PUT", `${base}/conditional-format`, {
      range: "K4:K6",
      condition: "Text contains",
      value: "Watch",
      style: "Yellow fill",
    });
    assert.equal(accepted.status, 200);
    const id = accepted.body.workbook.worksheets[0].conditionalFormats[0].id;
    const missing = await send(app.baseUrl, "DELETE", `${base}/conditional-format`, { id: "cf-missing" });
    assert.equal(missing.status, 400);
    const stillThere = await send(app.baseUrl, "PUT", `${base}/conditional-format`, {
      id: "cf-missing",
      range: "K4:K6",
      condition: "Text contains",
      value: "Watch",
      style: "Yellow fill",
    });
    assert.equal(stillThere.status, 400);
    assert.deepEqual(rulesOf(await getWorkbook(app.baseUrl, TEXT), TEXT_SHEET), [
      { range: "K4:K6", condition: "Text contains", value: "Watch", style: "Yellow fill" },
    ]);
    assert.equal(id.length > 0, true);
  } finally {
    await app.stop();
  }
});
