import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

const REPLACE_ALL_ID = "EVO-N02-REPLACE-ALL";
const CASE_ID = "EVO-N02-CASE-SENSITIVE";
const WORKSHEET = "Narrative";

async function startApp(dataDir) {
  if (!dataDir) dataDir = await mkdtemp(join(tmpdir(), "shallowcode-cell-updates-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-cell-updates-dist-"));
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

function send(baseUrl, path, payload) {
  return json(baseUrl, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

function updatesUrl(workbookId, worksheetName = WORKSHEET) {
  return `/api/workbooks/${workbookId}/worksheets/${workbookId}--${worksheetName}/cells/updates`;
}

function worksheetOf(workbook, name = WORKSHEET) {
  return workbook.worksheets.find((worksheet) => worksheet.name === name);
}

test("writes individual cells in one atomic request and keeps them after a restart", async () => {
  const app = await startApp();
  try {
    const response = await send(app.baseUrl, updatesUrl(REPLACE_ALL_ID), {
      updates: [
        { coordinate: "F3", value: "Indigo" },
        { coordinate: "F6", value: "Indigo" },
        { coordinate: "F9", value: "Indigo" },
      ],
    });
    assert.equal(response.status, 200);
    const cells = worksheetOf(response.body.workbook).cells;
    assert.equal(cells.F3, "Indigo");
    assert.equal(cells.F6, "Indigo");
    assert.equal(cells.F9, "Indigo");
    // A cell that was not part of the request keeps its value.
    assert.equal(cells.F12, "Copper");

    await app.restart();
    const reloaded = await json(app.baseUrl, `/api/workbooks/${REPLACE_ALL_ID}`);
    assert.deepEqual(worksheetOf(reloaded.body.workbook).cells, {
      F3: "Indigo",
      F6: "Indigo",
      F9: "Indigo",
      F12: "Copper",
    });
  } finally {
    await app.stop();
  }
});

test("accepts lower-case coordinates and clears a cell written as empty text", async () => {
  const app = await startApp();
  try {
    const written = await send(app.baseUrl, updatesUrl(CASE_ID), {
      updates: [{ coordinate: "g3", value: "Azure" }],
    });
    assert.equal(written.status, 200);
    assert.deepEqual(worksheetOf(written.body.workbook).cells, {
      G3: "Azure",
      G4: "cobalt",
      G5: "Cobalt-7",
    });

    const cleared = await send(app.baseUrl, updatesUrl(CASE_ID), { updates: [{ coordinate: "G4", value: "" }] });
    assert.equal(cleared.status, 200);
    assert.equal(worksheetOf(cleared.body.workbook).cells.G4, undefined);
    assert.equal(worksheetOf(cleared.body.workbook).cells.G5, "Cobalt-7");
  } finally {
    await app.stop();
  }
});

test("rejects a malformed request and a rejected validation target without writing any cell", async () => {
  const app = await startApp();
  try {
    const badPayloads = [
      {},
      { updates: [] },
      { updates: [{ coordinate: "F3" }] },
      { updates: [{ coordinate: "F3", value: 7 }] },
      { updates: [{ coordinate: "not-a-cell", value: "Indigo" }] },
    ];
    for (const payload of badPayloads) {
      const rejected = await send(app.baseUrl, updatesUrl(REPLACE_ALL_ID), payload);
      assert.equal(rejected.status, 400, JSON.stringify(payload));
    }
    const untouched = await json(app.baseUrl, `/api/workbooks/${REPLACE_ALL_ID}`);
    assert.equal(worksheetOf(untouched.body.workbook).cells.F3, "Cobalt");

    // One rejected target rejects the whole write: no cell of the request changes.
    const rule = await json(app.baseUrl, `/api/workbooks/${CASE_ID}/worksheets/${CASE_ID}--${WORKSHEET}/validation-rule`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ range: "G4", type: "dropdown", values: ["cobalt", "Cobalt"] }),
    });
    assert.equal(rule.status, 200);
    const blocked = await send(app.baseUrl, updatesUrl(CASE_ID), {
      updates: [
        { coordinate: "G3", value: "Azure" },
        { coordinate: "G4", value: "Azure" },
      ],
    });
    assert.equal(blocked.status, 400);
    const stored = await json(app.baseUrl, `/api/workbooks/${CASE_ID}`);
    assert.equal(worksheetOf(stored.body.workbook).cells.G3, "Cobalt");
    assert.equal(worksheetOf(stored.body.workbook).cells.G4, "cobalt");

    const unknownWorksheet = await send(app.baseUrl, updatesUrl(CASE_ID, "Missing"), {
      updates: [{ coordinate: "G3", value: "Azure" }],
    });
    assert.equal(unknownWorksheet.status, 400);
    const unknownWorkbook = await send(app.baseUrl, "/api/workbooks/missing/worksheets/x/cells/updates", {
      updates: [{ coordinate: "A1", value: "x" }],
    });
    assert.equal(unknownWorkbook.status, 404);
  } finally {
    await app.stop();
  }
});
