import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  EVO_NAMED_CREATE_ID,
  EVO_NAMED_CREATE_WORKSHEET_ID,
  EVO_NAMED_INVALID_ID,
  EVO_NAMED_UPDATE_ID,
  EVO_NAMED_UPDATE_WORKSHEET_ID,
  SEED_UPDATED_AT,
  createSeedState,
} from "../src/store/workbooks.mjs";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-named-"));
  const server = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir,
    baseUrl,
    async restart() {
      await new Promise((done) => server.close(done));
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
      await new Promise((done) => restarted.listen(0, "127.0.0.1", done));
      return {
        baseUrl: `http://127.0.0.1:${restarted.address().port}`,
        stop: () => new Promise((done) => restarted.close(done)),
      };
    },
    stop() {
      return new Promise((done) => server.close(done));
    },
  };
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function put(body) {
  return { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function getWorkbook(baseUrl, workbookId) {
  const response = await json(baseUrl, `/api/workbooks/${workbookId}`);
  assert.equal(response.status, 200);
  return response.body.workbook;
}

function namedRangeUrl(workbookId) {
  return `/api/workbooks/${workbookId}/named-ranges`;
}

function worksheetOf(workbook) {
  return workbook.worksheets.find((sheet) => sheet.name === "ForecastModel") ?? workbook.worksheets[0];
}

test("the seed pre-provisions the three named-range workbooks independently", () => {
  const state = createSeedState();
  const byId = (id) => state.workbooks.find((workbook) => workbook.id === id);

  const create = byId(EVO_NAMED_CREATE_ID);
  assert.equal(create.name, "EVO-N03-NAMED-CREATE");
  assert.equal(create.activeWorksheetId, EVO_NAMED_CREATE_WORKSHEET_ID);
  assert.deepEqual(create.worksheets[0].cells, { J3: "18", J4: "24", J5: "31" });
  assert.equal(create.worksheets[0].name, "ForecastModel");
  assert.equal(create.namedRanges, undefined);

  const invalid = byId(EVO_NAMED_INVALID_ID);
  assert.deepEqual(invalid.worksheets[0].cells, { K2: "6", K3: "14" });
  assert.equal(invalid.namedRanges, undefined);

  const update = byId(EVO_NAMED_UPDATE_ID);
  assert.equal(update.activeWorksheetId, EVO_NAMED_UPDATE_WORKSHEET_ID);
  assert.deepEqual(update.namedRanges, [{ name: "MarginBase", range: "ForecastModel!K2:K3" }]);
  assert.deepEqual(update.worksheets[0].cells, { K2: "5", K3: "8", K4: "12", M2: "=SUM(MarginBase)" });

  // Every scenario workbook is stamped before the baseline seed, so the home
  // page still lists `Q3 Sales` first.
  for (const workbook of state.workbooks) {
    if (!workbook.id.startsWith("wb-evo-")) continue;
    assert.ok(workbook.updatedAt <= SEED_UPDATED_AT);
  }
});

test("a saved name is stored with its sheet-qualified range and survives a restart", async () => {
  const app = await startApp();
  try {
    const saved = await json(app.baseUrl, namedRangeUrl(EVO_NAMED_CREATE_ID), put({
      name: "CapacityPlan",
      range: "ForecastModel!J3:J5",
    }));
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.workbook.namedRanges, [
      { name: "CapacityPlan", range: "ForecastModel!J3:J5" },
    ]);
    // Saving a name never touches the cells it refers to.
    assert.deepEqual(worksheetOf(saved.body.workbook).cells, { J3: "18", J4: "24", J5: "31" });

    const restarted = await app.restart();
    const reloaded = await getWorkbook(restarted.baseUrl, EVO_NAMED_CREATE_ID);
    assert.deepEqual(reloaded.namedRanges, [{ name: "CapacityPlan", range: "ForecastModel!J3:J5" }]);
    assert.deepEqual(worksheetOf(reloaded).cells, { J3: "18", J4: "24", J5: "31" });
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("a name is trimmed and its area is canonicalised", async () => {
  const app = await startApp();
  try {
    const saved = await json(app.baseUrl, namedRangeUrl(EVO_NAMED_CREATE_ID), put({
      name: "  Capacity Plan  ",
      range: " forecastmodel ! j5:j3 ",
    }));
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.workbook.namedRanges, [
      { name: "Capacity Plan", range: "ForecastModel!J3:J5" },
    ]);
  } finally {
    await app.stop();
  }
});

test("a name not starting with a letter is rejected with the exact message and stored nowhere", async () => {
  const app = await startApp();
  try {
    const rejected = await json(app.baseUrl, namedRangeUrl(EVO_NAMED_INVALID_ID), put({
      name: "1stBatch",
      range: "ForecastModel!K2:K3",
    }));
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Named range must start with a letter");

    const reloaded = await getWorkbook(app.baseUrl, EVO_NAMED_INVALID_ID);
    assert.equal(reloaded.namedRanges, undefined);
    assert.deepEqual(worksheetOf(reloaded).cells, { K2: "6", K3: "14" });

    const restarted = await app.restart();
    const afterRestart = await getWorkbook(restarted.baseUrl, EVO_NAMED_INVALID_ID);
    assert.equal(afterRestart.namedRanges, undefined);
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("an unknown worksheet or malformed area is rejected without storing anything", async () => {
  const app = await startApp();
  try {
    for (const range of ["Missing!K2:K3", "ForecastModel!K2:", "K2:K3", "ForecastModel!ZZZ"]) {
      const rejected = await json(app.baseUrl, namedRangeUrl(EVO_NAMED_CREATE_ID), put({
        name: "CapacityPlan",
        range,
      }));
      assert.equal(rejected.status, 400, range);
      assert.equal(rejected.body.error, "Invalid named range", range);
    }
    const reloaded = await getWorkbook(app.baseUrl, EVO_NAMED_CREATE_ID);
    assert.equal(reloaded.namedRanges, undefined);
  } finally {
    await app.stop();
  }
});

test("updating an existing name replaces its range and keeps the dependent formula", async () => {
  const app = await startApp();
  try {
    const before = await getWorkbook(app.baseUrl, EVO_NAMED_UPDATE_ID);
    assert.deepEqual(before.namedRanges, [{ name: "MarginBase", range: "ForecastModel!K2:K3" }]);

    const saved = await json(app.baseUrl, namedRangeUrl(EVO_NAMED_UPDATE_ID), put({
      name: "MarginBase",
      range: "ForecastModel!K2:K4",
    }));
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.workbook.namedRanges, [
      { name: "MarginBase", range: "ForecastModel!K2:K4" },
    ]);
    // The formula text is untouched; the new area supplies its operands.
    assert.equal(worksheetOf(saved.body.workbook).cells.M2, "=SUM(MarginBase)");
    assert.equal(worksheetOf(saved.body.workbook).cells.K4, "12");

    const restarted = await app.restart();
    const reloaded = await getWorkbook(restarted.baseUrl, EVO_NAMED_UPDATE_ID);
    assert.deepEqual(reloaded.namedRanges, [{ name: "MarginBase", range: "ForecastModel!K2:K4" }]);
    assert.equal(worksheetOf(reloaded).cells.M2, "=SUM(MarginBase)");
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("the stored state holds the saved names as written", async () => {
  const app = await startApp();
  try {
    await json(app.baseUrl, namedRangeUrl(EVO_NAMED_UPDATE_ID), put({
      name: "MarginBase",
      range: "ForecastModel!K2:K4",
    }));
    const raw = JSON.parse(await readFile(join(app.dataDir, "workbooks.json"), "utf8"));
    const stored = raw.workbooks.find((workbook) => workbook.id === EVO_NAMED_UPDATE_ID);
    assert.deepEqual(stored.namedRanges, [{ name: "MarginBase", range: "ForecastModel!K2:K4" }]);
  } finally {
    await app.stop();
  }
});
