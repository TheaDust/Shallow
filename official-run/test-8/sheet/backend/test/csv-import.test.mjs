import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { INVALID_CSV_MESSAGE, parseCsv } from "../src/domain/csv.mjs";
import { workbookNameFromFileName } from "../src/domain/workbook-model.mjs";

async function startApp(dataDir) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-csv-")));
  const { handler } = createApp({ dataDir: dir });
  const server = createServer((request, response) => void handler(request, response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    dataDir: dir,
    async call(path, init) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    async raw(path) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      return { status: response.status, body: await response.text() };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function importCsv(app, fileName, content) {
  return app.call("/api/workbooks/import", {
    method: "POST",
    body: JSON.stringify({ fileName, content }),
  });
}

test("parseCsv keeps original order, empty fields and quoted content", () => {
  const parsed = parseCsv('Region,East,"North, Inc."\r\n1200,,"He said ""hi"""\n');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.rows, [
    ["Region", "East", "North, Inc."],
    ["1200", "", 'He said "hi"'],
  ]);

  assert.deepEqual(parseCsv("East,1200,North,800").rows, [["East", "1200", "North", "800"]]);
  assert.deepEqual(parseCsv("a,b").rows, [["a", "b"]]);
  assert.deepEqual(parseCsv("a,b\n").rows, [["a", "b"]]);
  assert.deepEqual(parseCsv("a,,\n").rows, [["a", "", ""]]);
  assert.deepEqual(parseCsv(",a").rows, [["", "a"]]);
  assert.deepEqual(parseCsv("").rows, []);
  assert.deepEqual(parseCsv("\uFEFFRegion,East").rows, [["Region", "East"]]);
});

test("parseCsv keeps line breaks inside quoted fields and UTF-8 text", () => {
  const parsed = parseCsv('"multi\nline",中文,42\n');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.rows, [["multi\nline", "中文", "42"]]);

  const crlf = parseCsv('"a\r\nb",c\n');
  assert.deepEqual(crlf.rows, [["a\nb", "c"]]);
});

test("parseCsv rejects a field that opens a quote without closing it", () => {
  assert.equal(parseCsv('a,"unterminated\nb,c').ok, false);
  assert.equal(parseCsv('"unterminated').ok, false);
  assert.equal(parseCsv('a,b"c').ok, true);
});

test("workbookNameFromFileName drops the final .csv extension", () => {
  assert.equal(workbookNameFromFileName("Q3 Sales.csv"), "Q3 Sales");
  assert.equal(workbookNameFromFileName("report.CSV"), "report");
  assert.equal(workbookNameFromFileName("  data  .csv  "), "data");
  assert.equal(workbookNameFromFileName("sales.csv.csv"), "sales.csv");
  assert.equal(workbookNameFromFileName("no-extension"), "no-extension");
  assert.equal(workbookNameFromFileName(""), "Untitled spreadsheet");
});

test("import creates a workbook from the CSV file name and keeps every row and column", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const imported = await importCsv(
    app,
    "Q3 Sales Import.csv",
    'Region,East,"North, Inc."\r\n1200,,"He said ""hi"""\n"multi\nline",中文,42\n',
  );
  assert.equal(imported.status, 201);
  const workbook = imported.body.workbook;
  assert.equal(workbook.name, "Q3 Sales Import");
  assert.equal(workbook.worksheets.length, 1);

  const worksheet = workbook.worksheets[0];
  assert.equal(worksheet.name, "Sheet1");
  assert.equal(workbook.activeWorksheetId, worksheet.id);
  // The first row stays ordinary data, never a header.
  assert.deepEqual(worksheet.cells, {
    A1: "Region",
    B1: "East",
    C1: "North, Inc.",
    A2: "1200",
    C2: 'He said "hi"',
    A3: "multi\nline",
    B3: "中文",
    C3: "42",
  });
  assert.ok(worksheet.rowCount >= 3);
  assert.ok(worksheet.columnCount >= 3);

  const list = await app.call("/api/workbooks");
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.workbooks.map((entry) => entry.name).sort(),
    ["Q3 Sales", "Q3 Sales Import"],
  );
});

test("import keeps the seed workbook untouched and persists the imported rows", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const imported = await importCsv(app, "north-800.csv", "East,1200\nNorth,800\n");
  assert.equal(imported.status, 201);

  const reopened = await startApp(app.dataDir);
  t.after(() => reopened.close());

  const seed = await reopened.call("/api/workbooks/workbook-q3-sales");
  assert.equal(seed.status, 200);
  assert.equal(seed.body.workbook.name, "Q3 Sales");
  assert.equal(seed.body.workbook.worksheets[0].cells.A1, "Region");

  const stored = await reopened.call(`/api/workbooks/${imported.body.workbook.id}`);
  assert.equal(stored.status, 200);
  assert.equal(stored.body.workbook.name, "north-800");
  assert.deepEqual(stored.body.workbook.worksheets[0].cells, {
    A1: "East",
    B1: "1200",
    A2: "North",
    B2: "800",
  });
  assert.equal(stored.body.workbook.activeWorksheetId, stored.body.workbook.worksheets[0].id);
});

test("invalid CSV is rejected with the contract message and creates nothing", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const rejected = await importCsv(app, "broken.csv", 'Region,East\n"unterminated,1200\n');
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error, INVALID_CSV_MESSAGE);

  const list = await app.call("/api/workbooks");
  assert.equal(list.body.workbooks.length, 1);
  assert.equal(list.body.workbooks[0].name, "Q3 Sales");
  assert.ok(!list.body.workbooks.some((entry) => entry.name === "broken"));

  // The rejected attempt left no trace in storage.
  const reopened = await startApp(app.dataDir);
  t.after(() => reopened.close());
  const after = await reopened.call("/api/workbooks");
  assert.equal(after.body.workbooks.length, 1);
});

test("import rejects a missing body content without creating a workbook", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const rejected = await app.call("/api/workbooks/import", {
    method: "POST",
    body: JSON.stringify({ fileName: "empty.csv" }),
  });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error, INVALID_CSV_MESSAGE);

  const list = await app.call("/api/workbooks");
  assert.equal(list.body.workbooks.length, 1);
});

test("an empty CSV file imports as a workbook with no cells", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const imported = await importCsv(app, "nothing.csv", "");
  assert.equal(imported.status, 201);
  assert.deepEqual(imported.body.workbook.worksheets[0].cells, {});
  assert.equal(imported.body.workbook.name, "nothing");
});

test("the import route rejects other methods and unknown API paths stay 404", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  assert.equal((await app.call("/api/workbooks/import")).status, 405);
  assert.equal((await app.raw("/api/unknown")).status, 404);
  assert.equal((await app.raw("/index.html")).status, 200);
});
