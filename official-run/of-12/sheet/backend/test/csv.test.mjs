import assert from "node:assert/strict";
import test from "node:test";

import { parseCsv, workbookNameFromFileName, INVALID_CSV_MESSAGE } from "../src/lib/csv.mjs";

test("parses rows and columns in their original order", () => {
  assert.deepEqual(parseCsv("Region,East\n1200,North\n800,"), [
    ["Region", "East"],
    ["1200", "North"],
    ["800", ""],
  ]);
});

test("keeps empty fields and ignores the final line break", () => {
  assert.deepEqual(parseCsv("a,,b\n,,\n"), [
    ["a", "", "b"],
    ["", "", ""],
  ]);
  assert.deepEqual(parseCsv(""), []);
});

test("handles commas, escaped quotes and line breaks inside quoted fields", () => {
  assert.deepEqual(parseCsv('"East, North",1200\n'), [["East, North", "1200"]]);
  assert.deepEqual(parseCsv('"say ""hi""",1\n'), [['say "hi"', "1"]]);
  assert.deepEqual(parseCsv('"line1\nline2","1200"\n'), [["line1\nline2", "1200"]]);
  assert.deepEqual(parseCsv('"first\r\nsecond",x\n'), [["first\nsecond", "x"]]);
  assert.deepEqual(parseCsv('""\n'), [[""]]);
});

test("supports UTF-8 text and a leading byte order mark", () => {
  assert.deepEqual(parseCsv("\ufeff区域,销量\n华东,1200\n"), [["区域", "销量"], ["华东", "1200"]]);
});

test("keeps a quote that does not start the field", () => {
  assert.deepEqual(parseCsv('5" nail,x\n'), [['5" nail', "x"]]);
});

test("rejects a field that opens a quote without closing it", () => {
  for (const text of ['bad,"unterminated\n', '"abc', 'a,b\nc,"d"x\n']) {
    assert.throws(() => parseCsv(text), (error) => error.message === INVALID_CSV_MESSAGE, `expected rejection: ${text}`);
  }
});

test("derives the workbook name from the file name", () => {
  assert.equal(workbookNameFromFileName("q3-report.csv"), "q3-report");
  assert.equal(workbookNameFromFileName("C:\\temp\\Sales.csv"), "Sales");
  assert.equal(workbookNameFromFileName("report.CSV"), "report");
  assert.equal(workbookNameFromFileName("archive.csv.csv"), "archive.csv");
  assert.equal(workbookNameFromFileName("no-extension"), "no-extension");
});
