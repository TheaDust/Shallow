import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApiHandler } from "../src/api.mjs";
import { cellsFromRows, parseCsv, workbookNameFromFileName } from "../src/domain/csv.mjs";
import { createWorkbookStore } from "../src/store.mjs";

const INVALID_MESSAGE = "Invalid CSV file format. Import failed.";

async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-csv-"));
  const store = createWorkbookStore(directory);
  const handleApi = createApiHandler({ store });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    void handleApi(request, response, url);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no address");
  return {
    directory,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function callJson(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  return { status: response.status, body };
}

function importCsv(baseUrl, payload) {
  return callJson(baseUrl, "/api/workbooks/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function rowsOf(text) {
  const parsed = parseCsv(text);
  assert.equal(parsed.ok, true, `expected ${JSON.stringify(text)} to parse`);
  return parsed.rows;
}

test("parses rows, columns and empty fields in the original order", () => {
  assert.deepEqual(rowsOf("East,1200,North,800"), [["East", "1200", "North", "800"]]);
  assert.deepEqual(rowsOf("Region,East\n1200,North"), [
    ["Region", "East"],
    ["1200", "North"],
  ]);
  assert.deepEqual(rowsOf("a,,c"), [["a", "", "c"]]);
  assert.deepEqual(rowsOf(",,"), [["", "", ""]]);
});

test("accepts a trailing line break in either form and keeps no extra empty row", () => {
  assert.deepEqual(rowsOf("a,b\n"), [["a", "b"]]);
  assert.deepEqual(rowsOf("a,b"), [["a", "b"]]);
  assert.deepEqual(rowsOf("a,b\r\nc,d\r\n"), [
    ["a", "b"],
    ["c", "d"],
  ]);
  assert.deepEqual(rowsOf("a,b\r\nc,d"), [
    ["a", "b"],
    ["c", "d"],
  ]);
  assert.deepEqual(rowsOf(""), []);
});

test("keeps quoted commas, escaped quotes and line breaks inside fields", () => {
  assert.deepEqual(rowsOf('"East, North",1200'), [["East, North", "1200"]]);
  assert.deepEqual(rowsOf('"say ""hi""",ok'), [['say "hi"', "ok"]]);
  assert.deepEqual(rowsOf('"line1\nline2",next'), [["line1\nline2", "next"]]);
  assert.deepEqual(rowsOf('"",empty'), [["", "empty"]]);
});

test("preserves UTF-8 Chinese, English and numeric text verbatim", () => {
  const parsed = rowsOf("区域,销售额\n华东,1200\nNorth,800");
  assert.deepEqual(parsed, [
    ["区域", "销售额"],
    ["华东", "1200"],
    ["North", "800"],
  ]);
  assert.deepEqual(cellsFromRows(parsed), {
    A1: "区域",
    B1: "销售额",
    A2: "华东",
    B2: "1200",
    A3: "North",
    B3: "800",
  });
});

test("rejects a field that opens a quote without closing it", () => {
  for (const text of ['"East,1200', 'a,"unclosed', '"multi\nline', 'ok,"a""b']) {
    const parsed = parseCsv(text);
    assert.equal(parsed.ok, false, `expected ${JSON.stringify(text)} to be rejected`);
  }
});

test("derives the workbook name from the file name without the final .csv extension", () => {
  assert.equal(workbookNameFromFileName("Q3 Sales.csv", "Untitled spreadsheet"), "Q3 Sales");
  assert.equal(workbookNameFromFileName("report.CSV", "Untitled spreadsheet"), "report");
  assert.equal(workbookNameFromFileName("archive.csv.csv", "Untitled spreadsheet"), "archive.csv");
  assert.equal(workbookNameFromFileName("", "Untitled spreadsheet"), "Untitled spreadsheet");
});

test("imports a CSV file as a workbook that survives a store restart", async () => {
  const api = await startApi();
  try {
    const imported = await importCsv(api.baseUrl, {
      fileName: "Q4 Sales.csv",
      content: "区域,销售额\n华东,1200\nNorth,800\n",
    });
    assert.equal(imported.status, 201);
    const workbook = imported.body.workbook;
    assert.equal(workbook.name, "Q4 Sales");
    assert.equal(workbook.sheets.length, 1);
    assert.equal(workbook.sheets[0].name, "Sheet1");
    assert.equal(workbook.activeSheetId, workbook.sheets[0].id);
    assert.deepEqual(workbook.sheets[0].cells, {
      A1: "区域",
      B1: "销售额",
      A2: "华东",
      B2: "1200",
      A3: "North",
      B3: "800",
    });

    const list = await callJson(api.baseUrl, "/api/workbooks");
    assert.deepEqual(
      list.body.workbooks.map((entry) => entry.name).sort(),
      ["Q3 Sales", "Q4 Sales"],
    );

    const restarted = createWorkbookStore(api.directory);
    const persisted = await restarted.read();
    const stored = persisted.workbooks.find((entry) => entry.id === workbook.id);
    assert.ok(stored, "imported workbook must be persisted");
    assert.deepEqual(stored.sheets[0].cells, workbook.sheets[0].cells);

    const reopened = await callJson(api.baseUrl, `/api/workbooks/${workbook.id}`);
    assert.deepEqual(reopened.body.workbook.sheets[0].cells, workbook.sheets[0].cells);
  } finally {
    await api.close();
  }
});

test("keeps quoted multi-line fields through the import API", async () => {
  const api = await startApi();
  try {
    const imported = await importCsv(api.baseUrl, {
      fileName: "notes.csv",
      content: '"Region, East","say ""hi"""\n"line1\nline2",800',
    });
    assert.equal(imported.status, 201);
    const cells = imported.body.workbook.sheets[0].cells;
    assert.equal(imported.body.workbook.name, "notes");
    assert.deepEqual(cells, {
      A1: "Region, East",
      B1: 'say "hi"',
      A2: "line1\nline2",
      B2: "800",
    });
  } finally {
    await api.close();
  }
});

test("rejects an invalid CSV file without creating a workbook", async () => {
  const api = await startApi();
  try {
    const rejected = await importCsv(api.baseUrl, {
      fileName: "Broken.csv",
      content: '"East,1200',
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, INVALID_MESSAGE);

    const missingContent = await importCsv(api.baseUrl, { fileName: "Empty.csv" });
    assert.equal(missingContent.status, 400);
    assert.equal(missingContent.body.error, INVALID_MESSAGE);

    const list = await callJson(api.baseUrl, "/api/workbooks");
    assert.deepEqual(list.body.workbooks.map((entry) => entry.name), ["Q3 Sales"]);

    const seeded = await callJson(api.baseUrl, "/api/workbooks/wb-q3-sales");
    assert.equal(seeded.body.workbook.sheets[0].cells.A1, "Region");
    assert.deepEqual(
      seeded.body.workbook.sheets.map((sheet) => sheet.name),
      ["Sheet1", "Sheet2"],
    );
  } finally {
    await api.close();
  }
});

test("exposes the import endpoint only for POST", async () => {
  const api = await startApi();
  try {
    const response = await callJson(api.baseUrl, "/api/workbooks/import");
    assert.equal(response.status, 405);
  } finally {
    await api.close();
  }
});
