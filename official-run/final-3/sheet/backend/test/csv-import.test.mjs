import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { EVOLUTION_WORKBOOK_SEEDS } from "../src/store/evolution-seed.mjs";

/** The baseline workbook plus every pre-provisioned workbook of the requirements. */
const SEED_WORKBOOK_COUNT = EVOLUTION_WORKBOOK_SEEDS.length + 1;

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-import-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-dist-"));
  await mkdir(join(staticRoot, "assets"), { recursive: true });
  await writeFile(join(staticRoot, "index.html"), "<!doctype html><div id=\"root\"></div>", "utf8");

  const server = createServer(createRequestHandler({ dataDir, staticRoot }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    dataDir,
    staticRoot,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async stop() {
      await new Promise((done) => server.close(done));
    },
    async restart() {
      await new Promise((done) => server.close(done));
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot }));
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

function postImport(baseUrl, payload) {
  return json(baseUrl, "/api/workbooks/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("imports CSV rows into Sheet1 of a workbook named after the file", async () => {
  const app = await startApp();
  try {
    const rows = [
      ["地区", "销量", ""],
      ["华东", "1200", "East, Ltd"],
      ["North", "800", 'say "hi"'],
    ];
    const imported = await postImport(app.baseUrl, { fileName: "Q4 Sales.csv", rows });
    assert.equal(imported.status, 201);
    const workbook = imported.body.workbook;
    assert.equal(workbook.name, "Q4 Sales");
    assert.equal(workbook.worksheets.length, 1);
    assert.equal(workbook.worksheets[0].name, "Sheet1");
    assert.equal(workbook.activeWorksheetId, workbook.worksheets[0].id);
    assert.deepEqual(workbook.worksheets[0].cells, {
      A1: "地区", B1: "销量", C1: "",
      A2: "华东", B2: "1200", C2: "East, Ltd",
      A3: "North", B3: "800", C3: 'say "hi"',
    });

    const restarted = await app.restart();
    try {
      const list = await json(restarted.baseUrl, "/api/workbooks");
      assert.ok(list.body.workbooks.some((entry) => entry.name === "Q4 Sales"));
      const detail = await json(restarted.baseUrl, `/api/workbooks/${workbook.id}`);
      assert.equal(detail.body.workbook.worksheets[0].cells.A2, "华东");
      assert.equal(detail.body.workbook.worksheets[0].cells.C3, 'say "hi"');
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("strips a case-insensitive .csv extension and keeps other dots", async () => {
  const app = await startApp();
  try {
    const upper = await postImport(app.baseUrl, { fileName: "Report.CSV", rows: [["x"]] });
    assert.equal(upper.body.workbook.name, "Report");
    const dotted = await postImport(app.baseUrl, { fileName: "2026.Q3.csv", rows: [["x"]] });
    assert.equal(dotted.body.workbook.name, "2026.Q3");
  } finally {
    await app.stop();
  }
});

test("preserves row/column order and empty fields from the parsed rows", async () => {
  const app = await startApp();
  try {
    const imported = await postImport(app.baseUrl, { fileName: "sheet.csv", rows: [["a", "", "c"], []] });
    const cells = imported.body.workbook.worksheets[0].cells;
    assert.deepEqual(Object.keys(cells), ["A1", "B1", "C1"]);
    assert.equal(cells.B1, "");
  } finally {
    await app.stop();
  }
});

test("rejects malformed rows with the CSV error and leaves no workbook behind", async () => {
  const app = await startApp();
  try {
    const rejected = await postImport(app.baseUrl, { fileName: "bad.csv", rows: "not rows" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Invalid CSV file format. Import failed.");

    const wrongType = await postImport(app.baseUrl, { fileName: "bad.csv", rows: [["ok", 2]] });
    assert.equal(wrongType.status, 400);
    assert.equal(wrongType.body.error, "Invalid CSV file format. Import failed.");

    const list = await json(app.baseUrl, "/api/workbooks");
    assert.equal(list.body.workbooks.length, SEED_WORKBOOK_COUNT);
    assert.ok(!list.body.workbooks.some((entry) => entry.name === "bad"));
  } finally {
    await app.stop();
  }
});

test("creates an empty Sheet1 for an empty import and keeps the seed workbook", async () => {
  const app = await startApp();
  try {
    const imported = await postImport(app.baseUrl, { fileName: "empty.csv", rows: [] });
    assert.equal(imported.status, 201);
    assert.equal(imported.body.workbook.name, "empty");
    assert.deepEqual(imported.body.workbook.worksheets[0].cells, {});
    const list = await json(app.baseUrl, "/api/workbooks");
    assert.equal(list.body.workbooks.length, SEED_WORKBOOK_COUNT + 1);
  } finally {
    await app.stop();
  }
});
