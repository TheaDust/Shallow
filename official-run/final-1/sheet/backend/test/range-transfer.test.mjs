import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  SEED_SECOND_WORKSHEET_ID,
  SEED_WORKBOOK_ID,
  SEED_WORKSHEET_ID,
  createSeedState,
} from "../src/store/workbooks.mjs";

async function startApp(prepare) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-transfer-"));
  if (prepare) await prepare(dataDir);
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

function send(body) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function put(body) {
  return { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function getWorkbook(baseUrl) {
  return (await json(baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`)).body.workbook;
}

function transferUrl(worksheetId = SEED_WORKSHEET_ID) {
  return `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${worksheetId}/range-transfer`;
}

function stateUrl(worksheetId = SEED_WORKSHEET_ID) {
  return `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${worksheetId}/state`;
}

const COPY_ROWS = [
  ["Region", "Sales"],
  ["East", "1200"],
];

test("a copy transfer writes the target, keeps the source and persists after restart", async () => {
  const app = await startApp();
  const result = await json(app.baseUrl, transferUrl(), send({ target: "D1", rows: COPY_ROWS }));
  assert.equal(result.status, 200);
  const cells = result.body.workbook.worksheets[0].cells;
  assert.equal(cells.D1, "Region");
  assert.equal(cells.E1, "Sales");
  assert.equal(cells.D2, "East");
  assert.equal(cells.E2, "1200");
  // The source range and every other cell are untouched.
  assert.equal(cells.A1, "Region");
  assert.equal(cells.B2, "1200");
  assert.equal(cells.C3, "Closed");
  assert.equal(cells.D3, undefined);
  assert.equal(cells.F1, undefined);

  const restarted = await app.restart();
  const workbook = await getWorkbook(restarted.baseUrl);
  assert.equal(workbook.worksheets[0].cells.D2, "East");
  assert.equal(workbook.worksheets[0].cells.E2, "1200");
  assert.equal(workbook.worksheets[0].cells.A1, "Region");
  await restarted.stop();
});

test("a cut transfer clears the source cells outside the target and persists", async () => {
  const app = await startApp();
  const result = await json(app.baseUrl, transferUrl(), send({ target: "D1", rows: COPY_ROWS, source: "A1:B2" }));
  assert.equal(result.status, 200);
  const cells = result.body.workbook.worksheets[0].cells;
  assert.equal(cells.D1, "Region");
  assert.equal(cells.E2, "1200");
  assert.equal(cells.A1, undefined);
  assert.equal(cells.B1, undefined);
  assert.equal(cells.A2, undefined);
  assert.equal(cells.B2, undefined);
  // Columns outside the source range keep their values.
  assert.equal(cells.C1, "Status");
  assert.equal(cells.C2, "Open");

  const restarted = await app.restart();
  const workbook = await getWorkbook(restarted.baseUrl);
  assert.equal(workbook.worksheets[0].cells.D1, "Region");
  assert.equal(workbook.worksheets[0].cells.A2, undefined);
  await restarted.stop();
});

test("a cut transfer that overlaps its target keeps the moved values", async () => {
  const app = await startApp();
  const result = await json(app.baseUrl, transferUrl(), send({ target: "B1", rows: COPY_ROWS, source: "A1:B2" }));
  assert.equal(result.status, 200);
  const cells = result.body.workbook.worksheets[0].cells;
  assert.equal(cells.B1, "Region");
  assert.equal(cells.C1, "Sales");
  assert.equal(cells.B2, "East");
  assert.equal(cells.C2, "1200");
  // Only the source cells the target did not cover are cleared.
  assert.equal(cells.A1, undefined);
  assert.equal(cells.A2, undefined);
  assert.equal(cells.A3, "North");
  await app.stop();
});

test("a rejected transfer keeps the source and the target unchanged", async () => {
  const app = await startApp(async (dataDir) => {
    const state = createSeedState();
    state.workbooks[0].worksheets[0].validationRules = [{ range: "B3", type: "number-range", min: 0, max: 100 }];
    await writeFile(join(dataDir, "workbooks.json"), JSON.stringify(state, null, 2));
  });
  const before = await getWorkbook(app.baseUrl);
  const result = await json(app.baseUrl, transferUrl(), send({ target: "B2", rows: COPY_ROWS, source: "A1:B2" }));
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "Please enter a number from 0 to 100");
  const after = await getWorkbook(app.baseUrl);
  assert.deepEqual(after.worksheets[0].cells, before.worksheets[0].cells);

  const accepted = await json(app.baseUrl, transferUrl(), send({ target: "D1", rows: [["50"]] }));
  assert.equal(accepted.status, 200);
  await app.stop();
});

test("a malformed transfer is rejected without touching the grid", async () => {
  const app = await startApp();
  const before = await getWorkbook(app.baseUrl);
  for (const body of [
    { target: "nope", rows: [["a"]] },
    { target: "D1", rows: [] },
    { target: "D1", rows: [["a", 5]] },
    { target: "D1", rows: [["a"]], source: "1:2" },
  ]) {
    const result = await json(app.baseUrl, transferUrl(), send(body));
    assert.equal(result.status, 400);
  }
  const unknownSheet = await json(
    app.baseUrl,
    transferUrl("missing-worksheet"),
    send({ target: "D1", rows: [["a"]] }),
  );
  assert.equal(unknownSheet.status, 400);
  const after = await getWorkbook(app.baseUrl);
  assert.deepEqual(after.worksheets[0].cells, before.worksheets[0].cells);
  await app.stop();
});

test("a restored worksheet state replaces the cells and persists after restart", async () => {
  const app = await startApp();
  const result = await json(app.baseUrl, stateUrl(), put({ cells: { D1: "=B2+B3", E1: "1200" } }));
  assert.equal(result.status, 200);
  const cells = result.body.workbook.worksheets[0].cells;
  assert.deepEqual(Object.keys(cells).sort(), ["D1", "E1"]);
  assert.equal(cells.D1, "=B2+B3");
  // The other worksheet is untouched.
  assert.deepEqual(result.body.workbook.worksheets[1].cells, {});

  const restarted = await app.restart();
  const workbook = await getWorkbook(restarted.baseUrl);
  assert.deepEqual(Object.keys(workbook.worksheets[0].cells).sort(), ["D1", "E1"]);
  await restarted.stop();
});

test("a restored state rejects a malformed payload", async () => {
  const app = await startApp();
  const before = await getWorkbook(app.baseUrl);
  const bad = await json(app.baseUrl, stateUrl(), put({ cells: { A1: 7 } }));
  assert.equal(bad.status, 400);
  const empty = await json(app.baseUrl, stateUrl(), put({}));
  assert.equal(empty.status, 400);
  const after = await getWorkbook(app.baseUrl);
  assert.deepEqual(after.worksheets[0].cells, before.worksheets[0].cells);
  await app.stop();
});

test("a transfer on one worksheet never modifies another worksheet", async () => {
  const app = await startApp();
  const before = await getWorkbook(app.baseUrl);
  const result = await json(
    app.baseUrl,
    transferUrl(SEED_SECOND_WORKSHEET_ID),
    send({ target: "A1", rows: [["moved"]] }),
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.workbook.worksheets[1].cells.A1, "moved");
  assert.deepEqual(result.body.workbook.worksheets[0].cells, before.worksheets[0].cells);
  await app.stop();
});
