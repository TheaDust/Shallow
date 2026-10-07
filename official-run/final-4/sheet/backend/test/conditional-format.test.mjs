import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  EVO_FORMAT_EDIT_RULE_ID,
  EVO_FORMAT_EDIT_WORKBOOK_ID,
  EVO_FORMAT_EDIT_WORKSHEET_ID,
  EVO_FORMAT_NUMBER_WORKBOOK_ID,
  EVO_FORMAT_NUMBER_WORKSHEET_ID,
  EVO_FORMAT_TEXT_WORKBOOK_ID,
  EVO_FORMAT_TEXT_WORKSHEET_ID,
} from "../src/store/workbooks.mjs";

const NUMBER_BASE = `/api/workbooks/${EVO_FORMAT_NUMBER_WORKBOOK_ID}/worksheets/${EVO_FORMAT_NUMBER_WORKSHEET_ID}`;
const TEXT_BASE = `/api/workbooks/${EVO_FORMAT_TEXT_WORKBOOK_ID}/worksheets/${EVO_FORMAT_TEXT_WORKSHEET_ID}`;
const EDIT_BASE = `/api/workbooks/${EVO_FORMAT_EDIT_WORKBOOK_ID}/worksheets/${EVO_FORMAT_EDIT_WORKSHEET_ID}`;
const INVALID_MESSAGE = "Invalid conditional formatting rule";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-conditional-format-"));
  const server = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    dataDir,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async stop() {
      await new Promise((done) => server.close(done));
    },
    async restart() {
      await new Promise((done) => server.close(done));
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
      await new Promise((done) => restarted.listen(0, "127.0.0.1", done));
      return {
        baseUrl: `http://127.0.0.1:${restarted.address().port}`,
        stop: () => new Promise((done) => restarted.close(done)),
      };
    },
  };
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function send(method, body) {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function worksheetOf(baseUrl, workbookId, worksheetId) {
  const detail = await json(baseUrl, `/api/workbooks/${workbookId}`);
  return detail.body.workbook.worksheets.find((worksheet) => worksheet.id === worksheetId);
}

test("a saved numeric rule is stored, leaves the cells untouched and survives a restart", async () => {
  const app = await startApp();
  try {
    const created = await json(
      app.baseUrl,
      `${NUMBER_BASE}/conditional-formats`,
      send("POST", { range: "J4:J6", condition: "Greater than", value: " 25 ", style: "Red fill" }),
    );
    assert.equal(created.status, 201);
    const worksheet = created.body.workbook.worksheets.find((entry) => entry.id === EVO_FORMAT_NUMBER_WORKSHEET_ID);
    assert.equal(worksheet.conditionalFormats.length, 1);
    assert.equal(worksheet.conditionalFormats[0].range, "J4:J6");
    assert.equal(worksheet.conditionalFormats[0].condition, "Greater than");
    assert.equal(worksheet.conditionalFormats[0].value, "25");
    assert.equal(worksheet.conditionalFormats[0].style, "Red fill");
    // A rule only describes an appearance: no cell value changed.
    assert.deepEqual(worksheet.cells, { J4: "11", J5: "29", J6: "46" });

    const restarted = await app.restart();
    const persisted = await worksheetOf(
      restarted.baseUrl,
      EVO_FORMAT_NUMBER_WORKBOOK_ID,
      EVO_FORMAT_NUMBER_WORKSHEET_ID,
    );
    assert.equal(persisted.conditionalFormats.length, 1);
    assert.equal(persisted.conditionalFormats[0].style, "Red fill");
    await restarted.stop();

    // A second start of the same store neither duplicates the rule nor the seed.
    const again = await app.restart();
    const repeated = await worksheetOf(again.baseUrl, EVO_FORMAT_NUMBER_WORKBOOK_ID, EVO_FORMAT_NUMBER_WORKSHEET_ID);
    assert.equal(repeated.conditionalFormats.length, 1);
    await again.stop();
  } finally {
    await app.stop();
  }
});

test("a text rule is accepted and an incomplete payload is rejected without storing anything", async () => {
  const app = await startApp();
  try {
    const text = await json(
      app.baseUrl,
      `${TEXT_BASE}/conditional-formats`,
      send("POST", { range: "K4:K6", condition: "Text contains", value: "Watch", style: "Yellow fill" }),
    );
    assert.equal(text.status, 201);

    const cases = [
      { range: "K4:K6", condition: "Contains", value: "Watch", style: "Yellow fill" },
      { range: "K4:K6", condition: "Text contains", value: "   ", style: "Yellow fill" },
      { range: "K4:K6", condition: "Text contains", value: "Watch", style: "Blue fill" },
      { range: "not a range", condition: "Text contains", value: "Watch", style: "Yellow fill" },
    ];
    for (const payload of cases) {
      const rejected = await json(app.baseUrl, `${TEXT_BASE}/conditional-formats`, send("POST", payload));
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, INVALID_MESSAGE);
    }
    const worksheet = await worksheetOf(app.baseUrl, EVO_FORMAT_TEXT_WORKBOOK_ID, EVO_FORMAT_TEXT_WORKSHEET_ID);
    assert.equal(worksheet.conditionalFormats.length, 1);
    assert.equal(worksheet.conditionalFormats[0].style, "Yellow fill");
    assert.equal(worksheet.cells.K4, "Watch");
  } finally {
    await app.stop();
  }
});

test("the pre-provisioned rule is replaced in place and can be deleted", async () => {
  const app = await startApp();
  try {
    const seeded = await worksheetOf(app.baseUrl, EVO_FORMAT_EDIT_WORKBOOK_ID, EVO_FORMAT_EDIT_WORKSHEET_ID);
    assert.equal(seeded.conditionalFormats.length, 1);
    assert.equal(seeded.conditionalFormats[0].range, "L3:L5");
    assert.equal(seeded.conditionalFormats[0].condition, "Greater than");
    assert.equal(seeded.conditionalFormats[0].value, "20");
    assert.equal(seeded.conditionalFormats[0].style, "Red fill");

    const edited = await json(
      app.baseUrl,
      `${EDIT_BASE}/conditional-formats`,
      send("PUT", {
        id: EVO_FORMAT_EDIT_RULE_ID,
        range: "L3:L5",
        condition: "Greater than",
        value: "20",
        style: "Green fill",
      }),
    );
    assert.equal(edited.status, 200);
    const replaced = edited.body.workbook.worksheets.find((entry) => entry.id === EVO_FORMAT_EDIT_WORKSHEET_ID);
    assert.equal(replaced.conditionalFormats.length, 1);
    assert.equal(replaced.conditionalFormats[0].id, EVO_FORMAT_EDIT_RULE_ID);
    assert.equal(replaced.conditionalFormats[0].style, "Green fill");
    assert.deepEqual(replaced.cells, { L3: "16", L4: "28", L5: "39" });

    const unknown = await json(
      app.baseUrl,
      `${EDIT_BASE}/conditional-formats`,
      send("PUT", { id: "cf-missing", range: "L3:L5", condition: "Greater than", value: "20", style: "Green fill" }),
    );
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error, "Unknown conditional formatting rule");

    const deleted = await json(
      app.baseUrl,
      `${EDIT_BASE}/conditional-formats`,
      send("DELETE", { id: EVO_FORMAT_EDIT_RULE_ID }),
    );
    assert.equal(deleted.status, 200);
    const cleared = deleted.body.workbook.worksheets.find((entry) => entry.id === EVO_FORMAT_EDIT_WORKSHEET_ID);
    assert.equal(cleared.conditionalFormats, undefined);
    assert.deepEqual(cleared.cells, { L3: "16", L4: "28", L5: "39" });

    const restarted = await app.restart();
    const persisted = await worksheetOf(restarted.baseUrl, EVO_FORMAT_EDIT_WORKBOOK_ID, EVO_FORMAT_EDIT_WORKSHEET_ID);
    assert.equal(persisted.conditionalFormats, undefined);
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("a row or column change moves a rule's target range with its cells", async () => {
  const app = await startApp();
  try {
    const inserted = await json(
      app.baseUrl,
      `${EDIT_BASE}/structure`,
      send("POST", { axis: "column", mode: "insert-before", index: 12 }),
    );
    assert.equal(inserted.status, 200);
    const moved = inserted.body.workbook.worksheets.find((entry) => entry.id === EVO_FORMAT_EDIT_WORKSHEET_ID);
    assert.equal(moved.conditionalFormats[0].range, "M3:M5");
    assert.equal(moved.conditionalFormats[0].style, "Red fill");

    // Deleting the whole covered row range drops the rule with the cells.
    for (const index of [5, 4, 3]) {
      const deleted = await json(
        app.baseUrl,
        `${EDIT_BASE}/structure`,
        send("POST", { axis: "row", mode: "delete", index }),
      );
      assert.equal(deleted.status, 200);
    }
    const cleared = await worksheetOf(app.baseUrl, EVO_FORMAT_EDIT_WORKBOOK_ID, EVO_FORMAT_EDIT_WORKSHEET_ID);
    assert.equal(cleared.conditionalFormats, undefined);
  } finally {
    await app.stop();
  }
});

test("an unknown worksheet is rejected and no rule is stored", async () => {
  const app = await startApp();
  try {
    const rejected = await json(
      app.baseUrl,
      `/api/workbooks/${EVO_FORMAT_NUMBER_WORKBOOK_ID}/worksheets/ws-missing/conditional-formats`,
      send("POST", { range: "J4:J6", condition: "Greater than", value: "25", style: "Red fill" }),
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Unknown worksheet");
    const worksheet = await worksheetOf(
      app.baseUrl,
      EVO_FORMAT_NUMBER_WORKBOOK_ID,
      EVO_FORMAT_NUMBER_WORKSHEET_ID,
    );
    assert.equal(worksheet.conditionalFormats, undefined);
  } finally {
    await app.stop();
  }
});
