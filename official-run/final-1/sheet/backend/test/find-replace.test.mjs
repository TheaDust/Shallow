import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

/** Pre-provisioned workbook/worksheet identity of each find-and-replace scenario. */
const FIND_NEXT = { workbook: "wb-evo-n02-find-next", worksheet: "ws-evo-n02-find-next-narrative" };
const REPLACE_ALL = { workbook: "wb-evo-n02-replace-all", worksheet: "ws-evo-n02-replace-all-narrative" };
const CASE_SENSITIVE = { workbook: "wb-evo-n02-case-sensitive", worksheet: "ws-evo-n02-case-sensitive-narrative" };

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-replace-"));
  const server = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir,
    baseUrl,
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

function post(body) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function replaceUrl({ workbook, worksheet }) {
  return `/api/workbooks/${workbook}/worksheets/${worksheet}/cells/replace`;
}

function ruleUrl({ workbook, worksheet }) {
  return `/api/workbooks/${workbook}/worksheets/${worksheet}/validation-rule`;
}

async function getWorkbook(baseUrl, id) {
  return (await json(baseUrl, `/api/workbooks/${id}`)).body.workbook;
}

test("pre-provisions one Narrative workbook per find-and-replace scenario", async () => {
  const app = await startApp();
  try {
    const findNext = await getWorkbook(app.baseUrl, FIND_NEXT.workbook);
    assert.equal(findNext.name, "EVO-N02-FIND-NEXT");
    assert.equal(findNext.activeWorksheetId, FIND_NEXT.worksheet);
    assert.equal(findNext.worksheets[0].name, "Narrative");
    assert.deepEqual(findNext.worksheets[0].cells, { E4: "Cobalt", E7: "Cobalt", E11: "Cobalt" });

    const replaceAll = await getWorkbook(app.baseUrl, REPLACE_ALL.workbook);
    assert.equal(replaceAll.name, "EVO-N02-REPLACE-ALL");
    assert.equal(replaceAll.worksheets[0].name, "Narrative");
    assert.deepEqual(replaceAll.worksheets[0].cells, { F3: "Cobalt", F6: "Cobalt", F9: "Cobalt", F12: "Copper" });

    const caseSensitive = await getWorkbook(app.baseUrl, CASE_SENSITIVE.workbook);
    assert.equal(caseSensitive.name, "EVO-N02-CASE-SENSITIVE");
    assert.equal(caseSensitive.worksheets[0].name, "Narrative");
    assert.deepEqual(caseSensitive.worksheets[0].cells, { G3: "Cobalt", G4: "cobalt", G5: "Cobalt-7" });
  } finally {
    await app.stop();
  }
});

test("replacing a list of cells writes them all in one request and survives a restart", async () => {
  const app = await startApp();
  try {
    // The front end sends exactly the cells it matched; a non-matching cell is
    // never part of the payload, so `Copper` keeps its value.
    const replaced = await json(
      app.baseUrl,
      replaceUrl(REPLACE_ALL),
      post({
        updates: [
          { coordinate: "F3", value: "Indigo" },
          { coordinate: "F6", value: "Indigo" },
          { coordinate: "F9", value: "Indigo" },
        ],
      }),
    );
    assert.equal(replaced.status, 200);
    assert.deepEqual(replaced.body.workbook.worksheets[0].cells, {
      F3: "Indigo",
      F6: "Indigo",
      F9: "Indigo",
      F12: "Copper",
    });

    const restarted = await app.restart();
    try {
      const workbook = await getWorkbook(restarted.baseUrl, REPLACE_ALL.workbook);
      assert.deepEqual(workbook.worksheets[0].cells, {
        F3: "Indigo",
        F6: "Indigo",
        F9: "Indigo",
        F12: "Copper",
      });
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("a replacement rejected by a validation rule changes no cell at all", async () => {
  const app = await startApp();
  try {
    const rule = await json(
      app.baseUrl,
      ruleUrl(FIND_NEXT),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ range: "E7", type: "dropdown", values: ["Cobalt", "Holding"] }),
      },
    );
    assert.equal(rule.status, 200);

    const rejected = await json(
      app.baseUrl,
      replaceUrl(FIND_NEXT),
      post({
        updates: [
          { coordinate: "E4", value: "Indigo" },
          { coordinate: "E7", value: "Indigo" },
        ],
      }),
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Please select one of the following values: Cobalt, Holding");

    // The whole write is atomic: the first, valid target keeps its old value too.
    const workbook = await getWorkbook(app.baseUrl, FIND_NEXT.workbook);
    assert.deepEqual(workbook.worksheets[0].cells, { E4: "Cobalt", E7: "Cobalt", E11: "Cobalt" });
  } finally {
    await app.stop();
  }
});

test("a malformed replacement payload is rejected", async () => {
  const app = await startApp();
  try {
    for (const [body, message] of [
      [{ updates: [] }, "Invalid cell replacement"],
      [{ updates: [{ coordinate: "E4", value: 7 }] }, "Invalid cell replacement"],
      [{}, "Invalid cell replacement"],
      // A coordinate that is not A1 notation is reported as an unknown cell.
      [{ updates: [{ coordinate: "??", value: "x" }] }, "Unknown cell reference"],
    ]) {
      const rejected = await json(app.baseUrl, replaceUrl(FIND_NEXT), post(body));
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, message);
    }
    const unknown = await json(app.baseUrl, replaceUrl({ workbook: "wb-missing", worksheet: "ws-missing" }), post({ updates: [{ coordinate: "A1", value: "x" }] }));
    assert.equal(unknown.status, 404);
  } finally {
    await app.stop();
  }
});
