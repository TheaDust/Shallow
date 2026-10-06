import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

/** Pre-provisioned workbooks of REQ-7-1-1, one per scenario. */
const CREATE = "wb-evo-n03-named-create";
const CREATE_SHEET = "ws-evo-n03-named-create-forecast-model";
const INVALID = "wb-evo-n03-named-invalid";
const INVALID_SHEET = "ws-evo-n03-named-invalid-forecast-model";
const UPDATE = "wb-evo-n03-named-update";
const UPDATE_SHEET = "ws-evo-n03-named-update-forecast-model";

const INVALID_NAME_MESSAGE = "Named range must start with a letter";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-named-ranges-"));
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

test("the pre-provisioned named-range workbooks carry their cells and saved name", async () => {
  const app = await startApp();
  try {
    const create = await getWorkbook(app.baseUrl, CREATE);
    const createSheet = worksheetOf(create, CREATE_SHEET);
    assert.equal(createSheet.name, "ForecastModel");
    assert.deepEqual([createSheet.cells.J3, createSheet.cells.J4, createSheet.cells.J5], ["18", "24", "31"]);
    assert.equal(createSheet.cells.L3, undefined);
    assert.equal(create.namedRanges, undefined);

    const invalid = await getWorkbook(app.baseUrl, INVALID);
    const invalidSheet = worksheetOf(invalid, INVALID_SHEET);
    assert.equal(invalidSheet.name, "ForecastModel");
    assert.deepEqual([invalidSheet.cells.K2, invalidSheet.cells.K3], ["6", "14"]);

    const update = await getWorkbook(app.baseUrl, UPDATE);
    const updateSheet = worksheetOf(update, UPDATE_SHEET);
    assert.equal(updateSheet.name, "ForecastModel");
    assert.deepEqual([updateSheet.cells.K2, updateSheet.cells.K3, updateSheet.cells.K4], ["5", "8", "12"]);
    assert.equal(updateSheet.cells.M2, "=SUM(MarginBase)");
    assert.deepEqual(
      update.namedRanges.map((entry) => ({ name: entry.name, range: entry.range })),
      [{ name: "MarginBase", range: "ForecastModel!K2:K3" }],
    );
  } finally {
    await app.stop();
  }
});

test("a saved name persists, keeps its identity when edited and follows a row change", async () => {
  const app = await startApp();
  const base = `/api/workbooks/${CREATE}`;
  try {
    const saved = await send(app.baseUrl, "PUT", `${base}/named-ranges`, {
      name: "  CapacityPlan  ",
      range: "forecastmodel!j3:j5",
    });
    assert.equal(saved.status, 200);
    const entry = saved.body.workbook.namedRanges[0];
    assert.equal(entry.name, "CapacityPlan");
    assert.equal(entry.range, "forecastmodel!J3:J5");

    // The name is unique inside the workbook without regard to letter case: a
    // second save of the same name updates that entry instead of duplicating it.
    const renamed = await send(app.baseUrl, "PUT", `${base}/named-ranges`, {
      name: "capacityplan",
      range: "J3:J5",
    });
    assert.equal(renamed.body.workbook.namedRanges.length, 1);
    assert.equal(renamed.body.workbook.namedRanges[0].id, entry.id);
    assert.equal(renamed.body.workbook.namedRanges[0].range, "J3:J5");

    // Inserting a row above the range moves it with its cells.
    const shifted = await send(app.baseUrl, "POST", `/api/workbooks/${CREATE}/worksheets/${CREATE_SHEET}/structure`, {
      axis: "row",
      mode: "insert-before",
      index: 3,
    });
    assert.equal(shifted.status, 200);
    assert.equal(shifted.body.workbook.namedRanges[0].range, "J4:J6");

    const refreshed = await app.restart();
    try {
      const reloaded = await getWorkbook(refreshed.baseUrl, CREATE);
      assert.equal(reloaded.namedRanges[0].range, "J4:J6");
    } finally {
      await refreshed.stop();
    }
  } finally {
    await app.stop();
  }
});

test("a name that does not start with a letter is rejected and stores nothing", async () => {
  const app = await startApp();
  const base = `/api/workbooks/${INVALID}`;
  try {
    for (const name of ["1stBatch", "", "  "]) {
      const rejected = await send(app.baseUrl, "PUT", `${base}/named-ranges`, {
        name,
        range: "ForecastModel!K2:K3",
      });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, INVALID_NAME_MESSAGE);
    }
    // A malformed range is rejected as well, and both failures left no entry.
    const badRange = await send(app.baseUrl, "PUT", `${base}/named-ranges`, {
      name: "BatchPlan",
      range: "K2:",
    });
    assert.equal(badRange.status, 400);

    const reloaded = await getWorkbook(app.baseUrl, INVALID);
    assert.equal(reloaded.namedRanges, undefined);
    assert.deepEqual([worksheetOf(reloaded, INVALID_SHEET).cells.K2, worksheetOf(reloaded, INVALID_SHEET).cells.K3], [
      "6",
      "14",
    ]);

    // A valid name is still accepted on the same workbook.
    const accepted = await send(app.baseUrl, "PUT", `${base}/named-ranges`, {
      name: "BatchPlan",
      range: "ForecastModel!K2:K3",
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.workbook.namedRanges[0].name, "BatchPlan");
  } finally {
    await app.stop();
  }
});

test("editing a stored name replaces its range and rejects renaming onto another entry", async () => {
  const app = await startApp();
  const base = `/api/workbooks/${UPDATE}`;
  try {
    const stored = (await getWorkbook(app.baseUrl, UPDATE)).namedRanges[0];
    const edited = await send(app.baseUrl, "PUT", `${base}/named-ranges`, {
      id: stored.id,
      name: "MarginBase",
      range: "ForecastModel!K2:K4",
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.workbook.namedRanges.length, 1);
    assert.equal(edited.body.workbook.namedRanges[0].id, stored.id);
    assert.equal(edited.body.workbook.namedRanges[0].range, "ForecastModel!K2:K4");

    // The dependent formula keeps its expression; the cells are untouched.
    const worksheet = worksheetOf(edited.body.workbook, UPDATE_SHEET);
    assert.equal(worksheet.cells.M2, "=SUM(MarginBase)");
    assert.equal(worksheet.cells.K4, "12");

    const added = await send(app.baseUrl, "PUT", `${base}/named-ranges`, { name: "YearBase", range: "K2:K2" });
    assert.equal(added.status, 200);
    const duplicate = await send(app.baseUrl, "PUT", `${base}/named-ranges`, {
      id: added.body.workbook.namedRanges[1].id,
      name: "MarginBase",
      range: "K3:K3",
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.error, "Named range name already exists");
    assert.equal((await getWorkbook(app.baseUrl, UPDATE)).namedRanges[1].name, "YearBase");
  } finally {
    await app.stop();
  }
});
