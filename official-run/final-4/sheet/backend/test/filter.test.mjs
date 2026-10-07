import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { SEED_WORKBOOK_ID, SEED_WORKSHEET_ID } from "../src/store/workbooks.mjs";

const BASE = `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}`;
const DETAIL = `/api/workbooks/${SEED_WORKBOOK_ID}`;

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-filter-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-filter-dist-"));
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

function send(baseUrl, method, path, payload) {
  return json(baseUrl, path, {
    method,
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

function worksheetOf(body) {
  return body.workbook.worksheets.find((worksheet) => worksheet.id === SEED_WORKSHEET_ID);
}

const SAMPLE_FILTER = {
  range: "A1:C4",
  columns: [
    { column: 1, header: "Region", mode: "values", values: ["East", "South"] },
    { column: 2, header: "Sales", mode: "condition", condition: "Greater than", value: "800" },
  ],
};

test("saving a filter keeps the source cells and survives a restart", async () => {
  const app = await startApp();
  try {
    const before = worksheetOf((await json(app.baseUrl, DETAIL)).body);
    const saved = await send(app.baseUrl, "PUT", `${BASE}/filter`, { filter: SAMPLE_FILTER });
    assert.equal(saved.status, 200);
    assert.deepEqual(worksheetOf(saved.body).filter, SAMPLE_FILTER);
    // A filter is a view: the underlying records and their order are untouched.
    assert.deepEqual(worksheetOf(saved.body).cells, before.cells);

    await app.restart();
    const reopened = worksheetOf((await json(app.baseUrl, DETAIL)).body);
    assert.deepEqual(reopened.filter, SAMPLE_FILTER);
    assert.deepEqual(reopened.cells, before.cells);
  } finally {
    await app.stop();
  }
});

test("clearing a filter removes the view and leaves every record in place", async () => {
  const app = await startApp();
  try {
    const before = worksheetOf((await json(app.baseUrl, DETAIL)).body);
    await send(app.baseUrl, "PUT", `${BASE}/filter`, { filter: SAMPLE_FILTER });
    const cleared = await send(app.baseUrl, "DELETE", `${BASE}/filter`);
    assert.equal(cleared.status, 200);
    assert.equal(worksheetOf(cleared.body).filter, undefined);
    assert.deepEqual(worksheetOf(cleared.body).cells, before.cells);

    await app.restart();
    assert.equal(worksheetOf((await json(app.baseUrl, DETAIL)).body).filter, undefined);
  } finally {
    await app.stop();
  }
});

test("a filter of one worksheet never affects another worksheet", async () => {
  const app = await startApp();
  try {
    await send(app.baseUrl, "PUT", `${BASE}/filter`, { filter: SAMPLE_FILTER });
    const detail = (await json(app.baseUrl, DETAIL)).body;
    const second = detail.workbook.worksheets.find((worksheet) => worksheet.id !== SEED_WORKSHEET_ID);
    assert.equal(second.filter, undefined);
    assert.deepEqual(second.cells, {});
  } finally {
    await app.stop();
  }
});

test("malformed filters are rejected and leave the stored view untouched", async () => {
  const app = await startApp();
  try {
    await send(app.baseUrl, "PUT", `${BASE}/filter`, { filter: SAMPLE_FILTER });
    for (const payload of [
      { filter: null },
      { filter: { range: "nope", columns: [] } },
      { filter: { range: "A1:C4", columns: "no" } },
      { filter: { range: "A1:C4", columns: [{ column: 0, header: "Region", mode: "values", values: [] }] } },
      { filter: { range: "A1:C4", columns: [{ column: 1, header: "Region", mode: "sort" }] } },
      { filter: { range: "A1:C4", columns: [{ column: 1, header: "Region", mode: "condition", condition: "Equals" }] } },
    ]) {
      const response = await send(app.baseUrl, "PUT", `${BASE}/filter`, payload);
      assert.equal(response.status, 400, JSON.stringify(payload));
      assert.equal(response.body.error, "Invalid filter");
    }
    assert.deepEqual(worksheetOf((await json(app.baseUrl, DETAIL)).body).filter, SAMPLE_FILTER);
  } finally {
    await app.stop();
  }
});

test("row and column changes move validation rules and the filter view with their cells", async () => {
  const app = await startApp();
  try {
    await send(app.baseUrl, "PUT", `${BASE}/validation-rule`, {
      range: "A2:B2",
      type: "number-range",
      min: 0,
      max: 100,
    });
    await send(app.baseUrl, "PUT", `${BASE}/filter`, { filter: SAMPLE_FILTER });

    // Inserting a row above row 2 pushes the constrained cells down one line.
    const inserted = await send(app.baseUrl, "POST", `${BASE}/structure`, {
      axis: "row",
      mode: "insert-before",
      index: 2,
    });
    assert.equal(inserted.status, 200);
    const afterInsert = worksheetOf(inserted.body);
    assert.deepEqual(afterInsert.validationRules, [
      { range: "A3:B3", type: "number-range", min: 0, max: 100 },
    ]);
    assert.equal(afterInsert.filter.range, "A1:C5");

    // Inserting a column left of column 1 moves the filter's columns with it.
    const widened = await send(app.baseUrl, "POST", `${BASE}/structure`, {
      axis: "column",
      mode: "insert-before",
      index: 1,
    });
    const afterColumn = worksheetOf(widened.body);
    assert.equal(afterColumn.filter.range, "B1:D5");
    assert.deepEqual(
      afterColumn.filter.columns.map((column) => column.column),
      [2, 3],
    );
    assert.deepEqual(afterColumn.validationRules, [
      { range: "B3:C3", type: "number-range", min: 0, max: 100 },
    ]);

    // The rule still rejects an out-of-range value on its moved cells.
    const rejected = await send(app.baseUrl, "PATCH", `${BASE}/cells`, { coordinate: "B3", value: "101" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Please enter a number from 0 to 100");

    // Deleting the row a rule covers exactly drops the now-meaningless rule.
    const deleted = await send(app.baseUrl, "POST", `${BASE}/structure`, {
      axis: "row",
      mode: "delete",
      index: 3,
    });
    assert.equal(deleted.status, 200);
    assert.equal(worksheetOf(deleted.body).validationRules, undefined);
  } finally {
    await app.stop();
  }
});
