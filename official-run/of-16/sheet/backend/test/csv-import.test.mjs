import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { CsvFormatError, parseCsv, workbookNameFromFileName } from "../src/domain/csv.mjs";
import { createSeedState, createWorkbookService } from "../src/domain/workbooks.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

const INVALID_MESSAGE = "Invalid CSV file format. Import failed.";

function createMemoryStore(initial) {
  let state = structuredClone(initial);
  return {
    async read() {
      return structuredClone(state);
    },
    async update(mutator) {
      const draft = structuredClone(state);
      const returned = await mutator(draft);
      state = returned === undefined ? draft : returned;
      return structuredClone(state);
    },
  };
}

async function startApp() {
  const dataDirectory = await mkdtemp(join(tmpdir(), "shallowcode-csv-data-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-csv-static-"));
  await writeFile(join(staticRoot, "index.html"), "<!doctype html><main>app shell</main>", "utf8");
  const store = createJsonStore(join(dataDirectory, "workbooks.json"), createSeedState());
  const handler = createRequestHandler({ service: createWorkbookService(store), staticRoot });
  const server = createServer((request, response) => void handler(request, response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("parses plain rows in their original row and column order", () => {
  assert.deepEqual(parseCsv("Region,East\n1200,North"), [
    ["Region", "East"],
    ["1200", "North"],
  ]);
});

test("preserves empty fields, including leading and trailing ones", () => {
  assert.deepEqual(parseCsv("a,,c\n,x,\n,"), [
    ["a", "", "c"],
    ["", "x", ""],
    ["", ""],
  ]);
});

test("handles quoted commas, escaped double quotes and embedded line breaks", () => {
  assert.deepEqual(parseCsv('"East, ""North"", 1200","line1\nline2"\n"say ""hi"""'), [
    ['East, "North", 1200', "line1\nline2"],
    ['say "hi"'],
  ]);
});

test("supports UTF-8 Chinese, English and numeric text, CRLF and a final line break", () => {
  assert.deepEqual(parseCsv("区域,数量\r\n东部,1200\r\n"), [
    ["区域", "数量"],
    ["东部", "1200"],
  ]);
  assert.deepEqual(parseCsv("a,b\n"), [["a", "b"]]);
  assert.deepEqual(parseCsv("\uFEFFa,b"), [["a", "b"]]);
});

test("rejects a field that opens with a double quote but never closes", () => {
  for (const invalid of ['"abc', 'ok,fine\n"broken,x', '"a""b']) {
    assert.throws(() => parseCsv(invalid), (error) => {
      assert.ok(error instanceof CsvFormatError);
      assert.equal(error.message, INVALID_MESSAGE);
      return true;
    });
  }
  assert.throws(() => parseCsv("a,b\n\"unclosed,1\n"), CsvFormatError);
});

test("derives the workbook name from the file name", () => {
  assert.equal(workbookNameFromFileName("sales data.csv"), "sales data");
  assert.equal(workbookNameFromFileName("REPORT.CSV"), "REPORT");
  assert.equal(workbookNameFromFileName("archive"), "archive");
  assert.equal(workbookNameFromFileName("/tmp/exports/q3.csv"), "q3");
});

test("importCsv creates Sheet1 with the complete grid and keeps it after a reload", async () => {
  const service = createWorkbookService(createMemoryStore(createSeedState()));
  const workbook = await service.importCsv({
    fileName: "sales data.csv",
    content: 'Region,Notes\nEast,"1,200"\nNorth,"line1\nline2"',
  });

  assert.equal(workbook.name, "sales data");
  assert.deepEqual(workbook.worksheets.map((worksheet) => worksheet.name), ["Sheet1"]);
  assert.equal(workbook.activeWorksheetId, workbook.worksheets[0].id);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.cells.A1, "Region");
  assert.equal(sheet.cells.B2, "1,200");
  assert.equal(sheet.cells.B3, "line1\nline2");
  assert.equal(sheet.usedRows, 3);
  assert.equal(sheet.usedCols, 2);
  assert.equal(sheet.rowCount >= 3, true);

  const reread = await service.get(workbook.id);
  assert.deepEqual(reread.worksheets[0].cells, sheet.cells);
  assert.deepEqual((await service.list()).map((entry) => entry.name), ["Q3 Sales", "sales data"]);
});

test("importCsv keeps empty fields and extends the grid for wider input", async () => {
  const service = createWorkbookService(createMemoryStore(createSeedState()));
  const workbook = await service.importCsv({ fileName: "gaps.csv", content: "a,,c\n\n,,\n" });
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.cells.A1, "a");
  assert.equal(sheet.cells.C1, "c");
  assert.equal(sheet.cells.B1, undefined);
  assert.equal(sheet.usedRows, 3);
  assert.equal(sheet.usedCols, 3);

  const wide = await service.importCsv({ fileName: "wide.csv", content: `h1,h2,h3\nx,y,z` });
  assert.equal(wide.worksheets[0].usedCols, 3);
});

test("importCsv rejects invalid CSV without touching the store", async () => {
  const service = createWorkbookService(createMemoryStore(createSeedState()));
  await assert.rejects(
    () => service.importCsv({ fileName: "broken.csv", content: 'a,b\n"unterminated' }),
    (error) => {
      assert.equal(error.message, INVALID_MESSAGE);
      assert.equal(error.status, 400);
      return true;
    },
  );
  const list = await service.list();
  assert.deepEqual(list.map((entry) => entry.name), ["Q3 Sales"]);
  assert.deepEqual((await service.get("q3-sales")).worksheets[0].cells.A1, "Region");
});

test("POST /api/workbooks/import creates a workbook and rejects invalid CSV over HTTP", async () => {
  const app = await startApp();
  try {
    const response = await fetch(`${app.baseUrl}/api/workbooks/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: "exports.csv", content: "Region,East\n1200,North" }),
    });
    assert.equal(response.status, 201);
    const { workbook } = await response.json();
    assert.equal(workbook.name, "exports");
    assert.equal(workbook.worksheets[0].name, "Sheet1");
    assert.equal(workbook.worksheets[0].cells.A1, "Region");
    assert.equal(workbook.worksheets[0].cells.B2, "North");

    const listed = await (await fetch(`${app.baseUrl}/api/workbooks`)).json();
    assert.deepEqual(listed.workbooks.map((entry) => entry.name), ["Q3 Sales", "exports"]);

    const invalid = await fetch(`${app.baseUrl}/api/workbooks/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: "broken.csv", content: '"unterminated,1' }),
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: INVALID_MESSAGE });

    const afterInvalid = await (await fetch(`${app.baseUrl}/api/workbooks`)).json();
    assert.deepEqual(afterInvalid.workbooks.map((entry) => entry.name), ["Q3 Sales", "exports"]);

    const missing = await fetch(`${app.baseUrl}/api/workbooks/import`);
    assert.equal(missing.status, 404);
  } finally {
    await app.stop();
  }
});
