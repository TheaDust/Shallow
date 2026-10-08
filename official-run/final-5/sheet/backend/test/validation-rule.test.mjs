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

test("the numeric validation scenario pre-provisions its own rule with a custom message", async () => {
  const app = await startApp();
  try {
    const detail = "/api/workbooks/EVO-M05-VALIDATION-FORMULA";
    const base = `${detail}/worksheets/EVO-M05-VALIDATION-FORMULA--Thresholds`;
    const loaded = await json(app.baseUrl, detail);
    const worksheet = loaded.body.workbook.worksheets[0];
    assert.equal(worksheet.cells.J6, "37");
    assert.deepEqual(worksheet.validationRules, [
      { range: "J6", type: "number-range", min: 25, max: 75, message: "Capacity must be from 25 to 75" },
    ]);

    // Every entry path reports the custom message and keeps the last value.
    for (const write of [
      json(app.baseUrl, `${base}/cells`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coordinate: "J6", value: "88" }),
      }),
      json(app.baseUrl, `${base}/cells/batch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ start: "J6", rows: [["88"]] }),
      }),
    ]) {
      const rejected = await write;
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, "Capacity must be from 25 to 75");
    }

    const after = await json(app.baseUrl, detail);
    assert.equal(after.body.workbook.worksheets[0].cells.J6, "37");

    // The rule and its custom message survive a restart.
    await app.restart();
    const again = await json(app.baseUrl, `${base}/cells`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coordinate: "J6", value: "88" }),
    });
    assert.equal(again.status, 400);
    assert.equal(again.body.error, "Capacity must be from 25 to 75");

    const accepted = await json(app.baseUrl, `${base}/cells`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coordinate: "J6", value: "60" }),
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.workbook.worksheets[0].cells.J6, "60");
  } finally {
    await app.stop();
  }
});

test("a dropdown scenario rule reports its custom message and an updated message replaces the standard text", async () => {
  const app = await startApp();
  try {
    const gridBase = "/api/workbooks/EVO-M05-VALIDATION-GRID/worksheets/EVO-M05-VALIDATION-GRID--Thresholds";
    const loaded = await json(app.baseUrl, "/api/workbooks/EVO-M05-VALIDATION-GRID");
    assert.equal(loaded.body.workbook.worksheets[0].cells.K8, "Ready");
    assert.deepEqual(loaded.body.workbook.worksheets[0].validationRules, [
      {
        range: "K8",
        type: "dropdown",
        values: ["Ready", "Holding", "Released"],
        message: "Choose a queue state",
      },
    ]);
    const refused = await json(app.baseUrl, `${gridBase}/cells`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coordinate: "K8", value: "Paused" }),
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, "Choose a queue state");
    assert.equal(refused.body.workbook?.worksheets?.[0]?.cells?.K8, undefined);

    const editDetail = "/api/workbooks/EVO-M05-VALIDATION-EDIT";
    const editBase = `${editDetail}/worksheets/EVO-M05-VALIDATION-EDIT--Thresholds`;
    const updated = await put(app.baseUrl, `${editBase}/validation-rule`, {
      range: "L4",
      type: "number-range",
      min: 25,
      max: 75,
      message: "  Allocate between 25 and 75  ",
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.workbook.worksheets[0].validationRules, [
      { range: "L4", type: "number-range", min: 25, max: 75, message: "Allocate between 25 and 75" },
    ]);

    const rejected = await json(app.baseUrl, `${editBase}/cells`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coordinate: "L4", value: "24" }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Allocate between 25 and 75");

    // Clearing the message restores the standard wording.
    const cleared = await put(app.baseUrl, `${editBase}/validation-rule`, {
      range: "L4",
      type: "number-range",
      min: 25,
      max: 75,
      message: "",
    });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body.workbook.worksheets[0].validationRules, [
      { range: "L4", type: "number-range", min: 25, max: 75 },
    ]);
    const standard = await json(app.baseUrl, `${editBase}/cells`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coordinate: "L4", value: "24" }),
    });
    assert.equal(standard.status, 400);
    assert.equal(standard.body.error, "Please enter a number between 25 and 75");
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
