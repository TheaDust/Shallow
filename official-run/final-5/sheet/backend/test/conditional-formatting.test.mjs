import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-format-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-format-dist-"));
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

function send(baseUrl, path, method, payload) {
  return json(baseUrl, path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("a saved numeric rule persists and the edit scenario pre-provisions rule 1", async () => {
  const app = await startApp();
  try {
    const editDetail = "/api/workbooks/EVO-N04-FORMAT-EDIT";
    const editBase = `${editDetail}/worksheets/EVO-N04-FORMAT-EDIT--Signals`;
    const preloaded = await json(app.baseUrl, editDetail);
    assert.equal(preloaded.body.workbook.worksheets[0].cells.L4, "28");
    assert.deepEqual(preloaded.body.workbook.worksheets[0].conditionalFormats, [
      { range: "L3:L5", condition: "Greater than", value: "20", style: "Red fill" },
    ]);

    const numberDetail = "/api/workbooks/EVO-N04-FORMAT-NUMBER";
    const numberBase = `${numberDetail}/worksheets/EVO-N04-FORMAT-NUMBER--Signals`;
    const saved = await send(app.baseUrl, `${numberBase}/conditional-formats`, "PUT", {
      range: "J4:J6",
      condition: "Greater than",
      value: "25",
      style: "Red fill",
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.workbook.worksheets[0].conditionalFormats, [
      { range: "J4:J6", condition: "Greater than", value: "25", style: "Red fill" },
    ]);

    await app.restart();
    const again = await json(app.baseUrl, numberDetail);
    assert.deepEqual(again.body.workbook.worksheets[0].conditionalFormats, [
      { range: "J4:J6", condition: "Greater than", value: "25", style: "Red fill" },
    ]);
    // The other scenario's rule is untouched by the restart.
    const other = await json(app.baseUrl, editDetail);
    assert.deepEqual(other.body.workbook.worksheets[0].conditionalFormats, [
      { range: "L3:L5", condition: "Greater than", value: "20", style: "Red fill" },
    ]);
  } finally {
    await app.stop();
  }
});

test("editing rule 1 replaces it in place and deleting removes it", async () => {
  const app = await startApp();
  try {
    const detail = "/api/workbooks/EVO-N04-FORMAT-EDIT";
    const base = `${detail}/worksheets/EVO-N04-FORMAT-EDIT--Signals`;

    const edited = await send(app.baseUrl, `${base}/conditional-formats`, "PUT", {
      index: 0,
      range: "L3:L5",
      condition: "Greater than",
      value: "20",
      style: "Green fill",
    });
    assert.equal(edited.status, 200);
    assert.deepEqual(edited.body.workbook.worksheets[0].conditionalFormats, [
      { range: "L3:L5", condition: "Greater than", value: "20", style: "Green fill" },
    ]);

    const removed = await send(app.baseUrl, `${base}/conditional-formats`, "DELETE", { index: 0 });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.workbook.worksheets[0].conditionalFormats, undefined);
    // Removal never touches the cells it used to colour.
    assert.equal(removed.body.workbook.worksheets[0].cells.L4, "28");

    await app.restart();
    const again = await json(app.baseUrl, detail);
    assert.equal(again.body.workbook.worksheets[0].conditionalFormats, undefined);
  } finally {
    await app.stop();
  }
});

test("a text-match rule is stored and malformed rules are rejected", async () => {
  const app = await startApp();
  try {
    const detail = "/api/workbooks/EVO-N04-FORMAT-TEXT";
    const base = `${detail}/worksheets/EVO-N04-FORMAT-TEXT--Signals`;
    const saved = await send(app.baseUrl, `${base}/conditional-formats`, "PUT", {
      range: "K4:K6",
      condition: "Text contains",
      value: "Watch",
      style: "Yellow fill",
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.workbook.worksheets[0].conditionalFormats, [
      { range: "K4:K6", condition: "Text contains", value: "Watch", style: "Yellow fill" },
    ]);

    for (const [payload, message] of [
      [{ range: "K4:K6", condition: "Text contains", value: "  ", style: "Red fill" }, "Please enter a value"],
      [{ range: "K4:K6", condition: "Text contains", value: "Watch", style: "Blue fill" }, "Invalid conditional formatting rule"],
      [{ range: "nope", condition: "Greater than", value: "25", style: "Red fill" }, "Invalid conditional formatting rule"],
      [{ range: "K4:K6", condition: "Greater than", value: "abc", style: "Red fill" }, "Please enter a number"],
    ]) {
      const response = await send(app.baseUrl, `${base}/conditional-formats`, "PUT", payload);
      assert.equal(response.status, 400, JSON.stringify(payload));
      assert.equal(response.body.error, message);
    }
    const unknownDelete = await send(app.baseUrl, `${base}/conditional-formats`, "DELETE", { index: 5 });
    assert.equal(unknownDelete.status, 400);

    // Only the one valid rule is stored.
    const after = await json(app.baseUrl, detail);
    assert.equal(after.body.workbook.worksheets[0].conditionalFormats.length, 1);
  } finally {
    await app.stop();
  }
});
