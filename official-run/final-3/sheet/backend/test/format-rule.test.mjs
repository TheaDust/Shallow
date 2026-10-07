import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

const NUMBER_ID = "EVO-N04-FORMAT-NUMBER";
const TEXT_ID = "EVO-N04-FORMAT-TEXT";
const EDIT_ID = "EVO-N04-FORMAT-EDIT";

async function startApp(dataDir) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-format-")));
  const server = createServer(createRequestHandler({ dataDir: dir, staticRoot: dir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir: dir,
    baseUrl,
    async stop() {
      await new Promise((done) => server.close(done));
    },
  };
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function send(method, body) {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) };
}

function workbookOf(baseUrl, id) {
  return json(baseUrl, `/api/workbooks/${encodeURIComponent(id)}`);
}

async function worksheetOf(baseUrl, id) {
  const detail = await workbookOf(baseUrl, id);
  const workbook = detail.body.workbook;
  return workbook.worksheets.find((worksheet) => worksheet.id === workbook.activeWorksheetId);
}

function formatRuleUrl(workbookId, worksheetId) {
  return `/api/workbooks/${workbookId}/worksheets/${worksheetId}/format-rule`;
}

test("a saved rule keeps cell text untouched and persists after a restart", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, NUMBER_ID);
    const saved = await json(
      app.baseUrl,
      formatRuleUrl(NUMBER_ID, worksheet.id),
      send("PUT", { range: "J4:J6", condition: "greater-than", value: "25", style: "red" }),
    );
    assert.equal(saved.status, 200);
    const stored = saved.body.workbook.worksheets.find((candidate) => candidate.id === worksheet.id);
    assert.deepEqual(stored.formatRules, [
      { range: "J4:J6", condition: "greater-than", value: "25", style: "red" },
    ]);
    // The rule only describes a fill: every stored value stays as it was.
    assert.deepEqual(stored.cells, { J4: "11", J5: "29", J6: "46" });
  } finally {
    await app.stop();
  }

  const restarted = await startApp(app.dataDir);
  try {
    const worksheet = await worksheetOf(restarted.baseUrl, NUMBER_ID);
    assert.deepEqual(worksheet.formatRules, [
      { range: "J4:J6", condition: "greater-than", value: "25", style: "red" },
    ]);
  } finally {
    await restarted.stop();
  }
});

test("a text rule is stored with its condition, value and style", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, TEXT_ID);
    const saved = await json(
      app.baseUrl,
      formatRuleUrl(TEXT_ID, worksheet.id),
      send("PUT", { range: "K4:K6", condition: "text-contains", value: "Watch", style: "yellow" }),
    );
    assert.equal(saved.status, 200);
    const stored = saved.body.workbook.worksheets.find((candidate) => candidate.id === worksheet.id);
    assert.deepEqual(stored.formatRules, [
      { range: "K4:K6", condition: "text-contains", value: "Watch", style: "yellow" },
    ]);
  } finally {
    await app.stop();
  }
});

test("the seeded rule is editable in place and deletable", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, EDIT_ID);
    assert.deepEqual(worksheet.formatRules, [
      { range: "L3:L5", condition: "greater-than", value: "20", style: "red" },
    ]);

    // Editing rule 1 replaces it without changing its target range.
    const edited = await json(
      app.baseUrl,
      formatRuleUrl(EDIT_ID, worksheet.id),
      send("PUT", { index: 0, range: "L3:L5", condition: "greater-than", value: "20", style: "green" }),
    );
    assert.equal(edited.status, 200);
    assert.deepEqual(edited.body.workbook.worksheets[0].formatRules, [
      { range: "L3:L5", condition: "greater-than", value: "20", style: "green" },
    ]);

    const deleted = await json(
      app.baseUrl,
      formatRuleUrl(EDIT_ID, worksheet.id),
      send("DELETE", { index: 0 }),
    );
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.workbook.worksheets[0].formatRules, undefined);
  } finally {
    await app.stop();
  }

  const restarted = await startApp(app.dataDir);
  try {
    const worksheet = await worksheetOf(restarted.baseUrl, EDIT_ID);
    assert.equal(worksheet.formatRules, undefined);
  } finally {
    await restarted.stop();
  }
});

test("an invalid rule is rejected and leaves the stored rules unchanged", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, EDIT_ID);
    const badCondition = await json(
      app.baseUrl,
      formatRuleUrl(EDIT_ID, worksheet.id),
      send("PUT", { range: "L3:L5", condition: "equals", value: "20", style: "red" }),
    );
    assert.equal(badCondition.status, 400);

    const badStyle = await json(
      app.baseUrl,
      formatRuleUrl(EDIT_ID, worksheet.id),
      send("PUT", { range: "L3:L5", condition: "greater-than", value: "20", style: "blue" }),
    );
    assert.equal(badStyle.status, 400);

    const noValue = await json(
      app.baseUrl,
      formatRuleUrl(EDIT_ID, worksheet.id),
      send("PUT", { range: "L3:L5", condition: "greater-than", value: "  ", style: "red" }),
    );
    assert.equal(noValue.status, 400);
    assert.equal(noValue.body.error, "Please enter a value");

    const unknownIndex = await json(
      app.baseUrl,
      formatRuleUrl(EDIT_ID, worksheet.id),
      send("DELETE", { index: 3 }),
    );
    assert.equal(unknownIndex.status, 400);

    const stored = await worksheetOf(app.baseUrl, EDIT_ID);
    assert.deepEqual(stored.formatRules, [
      { range: "L3:L5", condition: "greater-than", value: "20", style: "red" },
    ]);
  } finally {
    await app.stop();
  }
});

test("a row change moves the rule range with its cells", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, EDIT_ID);
    const inserted = await json(
      app.baseUrl,
      `/api/workbooks/${EDIT_ID}/worksheets/${worksheet.id}/structure`,
      send("POST", { axis: "row", mode: "insert-before", index: 1 }),
    );
    assert.equal(inserted.status, 200);
    assert.deepEqual(inserted.body.workbook.worksheets[0].formatRules, [
      { range: "L4:L6", condition: "greater-than", value: "20", style: "red" },
    ]);
    assert.equal(inserted.body.workbook.worksheets[0].cells.L4, "16");
  } finally {
    await app.stop();
  }
});
