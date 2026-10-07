import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  EVO_NAMED_CREATE_WORKBOOK_ID,
  EVO_NAMED_CREATE_WORKSHEET_ID,
  EVO_NAMED_INVALID_WORKBOOK_ID,
  EVO_NAMED_UPDATE_RANGE_ID,
  EVO_NAMED_UPDATE_WORKBOOK_ID,
  EVO_NAMED_UPDATE_WORKSHEET_ID,
  SEED_WORKBOOK_ID,
  createSeedState,
} from "../src/store/workbooks.mjs";

const NAME_MESSAGE = "Named range must start with a letter";
const CREATE_BASE = `/api/workbooks/${EVO_NAMED_CREATE_WORKBOOK_ID}`;
const UPDATE_BASE = `/api/workbooks/${EVO_NAMED_UPDATE_WORKBOOK_ID}`;
const UPDATE_WORKSHEET = `${UPDATE_BASE}/worksheets/${EVO_NAMED_UPDATE_WORKSHEET_ID}`;

async function startApp(prepare) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-named-range-"));
  if (prepare) await prepare(dataDir);
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

async function workbookOf(baseUrl, workbookId) {
  const detail = await json(baseUrl, `/api/workbooks/${workbookId}`);
  return detail.body.workbook;
}

test("a created named range is stored with its sheet reference and survives a restart", async () => {
  const app = await startApp();
  try {
    const created = await json(
      app.baseUrl,
      `${CREATE_BASE}/named-ranges`,
      send("POST", { name: " CapacityPlan ", range: "ForecastModel!J3:J5" }),
    );
    assert.equal(created.status, 201);
    const ranges = created.body.workbook.namedRanges;
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0].name, "CapacityPlan");
    assert.equal(ranges[0].range, "ForecastModel!J3:J5");
    // The seeded cells of the scenario are untouched by saving a name.
    assert.equal(created.body.workbook.worksheets[0].cells.J3, "18");
    assert.equal(created.body.workbook.worksheets[0].cells.L3, undefined);

    const restarted = await app.restart();
    const persisted = await workbookOf(restarted.baseUrl, EVO_NAMED_CREATE_WORKBOOK_ID);
    assert.deepEqual(
      persisted.namedRanges.map((entry) => [entry.name, entry.range]),
      [["CapacityPlan", "ForecastModel!J3:J5"]],
    );
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("an absolute reference is stored canonically and an unqualified one keeps no sheet", async () => {
  const app = await startApp();
  try {
    const absolute = await json(
      app.baseUrl,
      `${CREATE_BASE}/named-ranges`,
      send("POST", { name: "CapacityPlan", range: "ForecastModel!$J$3:$J$5" }),
    );
    assert.equal(absolute.status, 201);
    assert.equal(absolute.body.workbook.namedRanges[0].range, "ForecastModel!J3:J5");

    const local = await json(app.baseUrl, `${CREATE_BASE}/named-ranges`, send("POST", { name: "Local", range: "b5:a1" }));
    assert.equal(local.status, 201);
    assert.deepEqual(
      local.body.workbook.namedRanges.map((entry) => entry.range),
      ["ForecastModel!J3:J5", "A1:B5"],
    );
  } finally {
    await app.stop();
  }
});

test("a name that does not start with a letter is rejected and nothing is stored", async () => {
  const app = await startApp();
  try {
    const rejected = await json(
      app.baseUrl,
      `/api/workbooks/${EVO_NAMED_INVALID_WORKBOOK_ID}/named-ranges`,
      send("POST", { name: "1stBatch", range: "ForecastModel!K2:K3" }),
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, NAME_MESSAGE);

    const otherWorkbook = await json(
      app.baseUrl,
      `${CREATE_BASE}/named-ranges`,
      send("POST", { name: "1stBatch", range: "ForecastModel!K2:K3" }),
    );
    assert.equal(otherWorkbook.status, 400);
    assert.equal(otherWorkbook.body.error, NAME_MESSAGE);

    const empty = await json(app.baseUrl, `${CREATE_BASE}/named-ranges`, send("POST", { name: "   ", range: "J3:J5" }));
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, NAME_MESSAGE);

    const badRange = await json(
      app.baseUrl,
      `${CREATE_BASE}/named-ranges`,
      send("POST", { name: "CapacityPlan", range: "not a range" }),
    );
    assert.equal(badRange.status, 400);
    assert.equal(badRange.body.error, "Named range reference must be a valid range");

    // Nothing was stored for either workbook, not even a partially written name.
    assert.equal((await workbookOf(app.baseUrl, EVO_NAMED_CREATE_WORKBOOK_ID)).namedRanges, undefined);
    assert.equal((await workbookOf(app.baseUrl, EVO_NAMED_INVALID_WORKBOOK_ID)).namedRanges, undefined);

    const restarted = await app.restart();
    assert.equal((await workbookOf(restarted.baseUrl, EVO_NAMED_INVALID_WORKBOOK_ID)).namedRanges, undefined);
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("a duplicate name is rejected without changing the stored range", async () => {
  const app = await startApp();
  try {
    const first = await json(
      app.baseUrl,
      `${CREATE_BASE}/named-ranges`,
      send("POST", { name: "CapacityPlan", range: "J3:J5" }),
    );
    assert.equal(first.status, 201);

    const duplicate = await json(
      app.baseUrl,
      `${CREATE_BASE}/named-ranges`,
      send("POST", { name: "capacityplan", range: "K2:K3" }),
    );
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.error, "Named range name already exists");
    const after = await workbookOf(app.baseUrl, EVO_NAMED_CREATE_WORKBOOK_ID);
    assert.equal(after.namedRanges.length, 1);
    assert.equal(after.namedRanges[0].range, "J3:J5");
  } finally {
    await app.stop();
  }
});

test("the pre-provisioned MarginBase name is updated in place and persisted", async () => {
  const app = await startApp();
  try {
    const seeded = await workbookOf(app.baseUrl, EVO_NAMED_UPDATE_WORKBOOK_ID);
    assert.equal(seeded.namedRanges.length, 1);
    assert.equal(seeded.namedRanges[0].name, "MarginBase");
    assert.equal(seeded.namedRanges[0].range, "ForecastModel!K2:K3");
    assert.equal(seeded.worksheets[0].cells.M2, "=SUM(MarginBase)");
    assert.equal(seeded.worksheets[0].cells.K2, "5");
    assert.equal(seeded.worksheets[0].cells.K3, "8");
    assert.equal(seeded.worksheets[0].cells.K4, "12");

    const updated = await json(
      app.baseUrl,
      `${UPDATE_BASE}/named-ranges`,
      send("PUT", { id: EVO_NAMED_UPDATE_RANGE_ID, name: "MarginBase", range: "ForecastModel!K2:K4" }),
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.workbook.namedRanges.length, 1);
    assert.equal(updated.body.workbook.namedRanges[0].id, EVO_NAMED_UPDATE_RANGE_ID);
    assert.equal(updated.body.workbook.namedRanges[0].range, "ForecastModel!K2:K4");
    // The dependent formula keeps its original text; only the name moved.
    assert.equal(updated.body.workbook.worksheets[0].cells.M2, "=SUM(MarginBase)");

    const unknown = await json(app.baseUrl, `${UPDATE_BASE}/named-ranges`, send("PUT", { id: "nr-missing", name: "X", range: "K2:K3" }));
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error, "Unknown named range");

    const restarted = await app.restart();
    const persisted = await workbookOf(restarted.baseUrl, EVO_NAMED_UPDATE_WORKBOOK_ID);
    assert.equal(persisted.namedRanges[0].range, "ForecastModel!K2:K4");
    assert.equal(persisted.worksheets[0].cells.M2, "=SUM(MarginBase)");
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("a removed named range is deleted atomically and an unknown id is rejected", async () => {
  const app = await startApp();
  try {
    const removed = await json(app.baseUrl, `${UPDATE_BASE}/named-ranges`, send("DELETE", { id: EVO_NAMED_UPDATE_RANGE_ID }));
    assert.equal(removed.status, 200);
    assert.equal(removed.body.workbook.namedRanges, undefined);

    const again = await json(app.baseUrl, `${UPDATE_BASE}/named-ranges`, send("DELETE", { id: EVO_NAMED_UPDATE_RANGE_ID }));
    assert.equal(again.status, 400);
    assert.equal(again.body.error, "Unknown named range");
    assert.equal((await workbookOf(app.baseUrl, EVO_NAMED_UPDATE_WORKBOOK_ID)).worksheets[0].cells.M2, "=SUM(MarginBase)");
  } finally {
    await app.stop();
  }
});

test("row and column changes move the referenced area of the matching worksheet", async () => {
  const app = await startApp();
  try {
    // Inserting a column left of L moves `L3:L5` to `M3:M5`.
    const inserted = await json(
      app.baseUrl,
      `${CREATE_BASE}/named-ranges`,
      send("POST", { name: "CapacityPlan", range: "ForecastModel!J3:J5" }),
    );
    assert.equal(inserted.status, 201);
    const structure = await json(
      app.baseUrl,
      `${CREATE_BASE}/worksheets/${EVO_NAMED_CREATE_WORKSHEET_ID}/structure`,
      send("POST", { axis: "column", mode: "insert-before", index: 10 }),
    );
    assert.equal(structure.status, 200);
    assert.equal(structure.body.workbook.namedRanges[0].range, "ForecastModel!K3:K5");

    // Deleting the covered row collapses the area of the update scenario.
    const deleted = await json(
      app.baseUrl,
      `${UPDATE_WORKSHEET}/structure`,
      send("POST", { axis: "row", mode: "delete", index: 3 }),
    );
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.workbook.namedRanges[0].range, "ForecastModel!K2");

    // A name of another worksheet keeps its own coordinates.
    const other = await json(
      app.baseUrl,
      `${UPDATE_BASE}/named-ranges`,
      send("POST", { name: "OtherSheet", range: "Elsewhere!A1:B2" }),
    );
    assert.equal(other.status, 201);
    const shifted = await json(
      app.baseUrl,
      `${UPDATE_WORKSHEET}/structure`,
      send("POST", { axis: "row", mode: "insert-before", index: 1 }),
    );
    assert.equal(shifted.status, 200);
    const ranges = shifted.body.workbook.namedRanges;
    assert.deepEqual(
      ranges.map((entry) => [entry.name, entry.range]),
      [
        ["MarginBase", "ForecastModel!K3"],
        ["OtherSheet", "Elsewhere!A1:B2"],
      ],
    );
  } finally {
    await app.stop();
  }
});

test("an existing store gains the new pre-provisioned workbooks once and keeps user changes", async () => {
  const app = await startApp(async (dataDir) => {
    // An older store: the baseline seed plus a renamed workbook and a user cell.
    const state = createSeedState();
    state.workbooks = state.workbooks.filter((workbook) => workbook.id === SEED_WORKBOOK_ID);
    state.workbooks[0].name = "Renamed by user";
    state.workbooks[0].worksheets[0].cells.Z9 = "user value";
    await writeFile(join(dataDir, "workbooks.json"), JSON.stringify(state), "utf8");
  });
  try {
    const upgraded = await workbookOf(app.baseUrl, EVO_NAMED_UPDATE_WORKBOOK_ID);
    assert.equal(upgraded.worksheets[0].cells.M2, "=SUM(MarginBase)");
    assert.equal(upgraded.namedRanges[0].name, "MarginBase");
    const renamed = await workbookOf(app.baseUrl, SEED_WORKBOOK_ID);
    assert.equal(renamed.name, "Renamed by user");
    assert.equal(renamed.worksheets[0].cells.Z9, "user value");

    const restarted = await app.restart();
    const detail = await json(restarted.baseUrl, "/api/workbooks");
    const ids = detail.body.workbooks.map((workbook) => workbook.id);
    assert.equal(ids.filter((id) => id === EVO_NAMED_UPDATE_WORKBOOK_ID).length, 1);
    assert.equal(ids.filter((id) => id === EVO_NAMED_CREATE_WORKBOOK_ID).length, 1);
    const stored = JSON.parse(await readFile(join(app.dataDir, "workbooks.json"), "utf8"));
    assert.equal(stored.workbooks.filter((workbook) => workbook.id === EVO_NAMED_UPDATE_WORKBOOK_ID).length, 1);
    assert.equal(stored.workbooks.find((workbook) => workbook.id === SEED_WORKBOOK_ID).name, "Renamed by user");
    await restarted.stop();
  } finally {
    await app.stop();
  }
});
