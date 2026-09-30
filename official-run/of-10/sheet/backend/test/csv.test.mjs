import assert from "node:assert/strict";
import test from "node:test";

import { CsvFormatError, INVALID_CSV_MESSAGE, parseCsv } from "../src/lib/csv.mjs";
import { workbookNameFromFileName } from "../src/lib/workbook-store.mjs";

test("keeps row and column order and preserves empty fields", () => {
  assert.deepEqual(parseCsv("a,b,c\nd,,f"), [
    ["a", "b", "c"],
    ["d", "", "f"],
  ]);
  assert.deepEqual(parseCsv("x,,,\n"), [["x", "", "", ""]]);
});

test("supports quoted commas, escaped quotes and line breaks inside fields", () => {
  assert.deepEqual(parseCsv('"East, 1",1200\n'), [["East, 1", "1200"]]);
  assert.deepEqual(parseCsv('"He said ""hi""",2\n'), [['He said "hi"', "2"]]);
  assert.deepEqual(parseCsv('"line1\nline2",3\n'), [["line1\nline2", "3"]]);
  assert.deepEqual(parseCsv('"a","b"\r\n"c","d"\r\n'), [["a", "b"], ["c", "d"]]);
});

test("keeps UTF-8 text and numeric text unchanged", () => {
  assert.deepEqual(parseCsv("地区,销量\n华东,1200\n"), [["地区", "销量"], ["华东", "1200"]]);
  assert.deepEqual(parseCsv("007,1.50\n"), [["007", "1.50"]]);
});

test("ignores a trailing line break but keeps interior empty rows", () => {
  assert.deepEqual(parseCsv("a\nb\n"), [["a"], ["b"]]);
  assert.deepEqual(parseCsv("a\nb"), [["a"], ["b"]]);
  assert.deepEqual(parseCsv("a\n\nb"), [["a"], [""], ["b"]]);
  assert.deepEqual(parseCsv(""), []);
});

test("strips a leading byte order mark", () => {
  assert.deepEqual(parseCsv("\uFEFFa,b\n"), [["a", "b"]]);
});

test("rejects an unclosed quoted field", () => {
  assert.throws(() => parseCsv('a,"unclosed\n'), (error) => {
    assert.ok(error instanceof CsvFormatError);
    assert.equal(error.message, INVALID_CSV_MESSAGE);
    return true;
  });
  assert.throws(() => parseCsv('"unclosed'), CsvFormatError);
  assert.throws(() => parseCsv('"closed"junk'), CsvFormatError);
  assert.throws(() => parseCsv(42), CsvFormatError);
});

test("derives the workbook name from the file name", () => {
  assert.equal(workbookNameFromFileName("Q3 Sales.csv"), "Q3 Sales");
  assert.equal(workbookNameFromFileName("report.final.CSV"), "report.final");
  assert.equal(workbookNameFromFileName("notes.txt"), "notes.txt");
  assert.equal(workbookNameFromFileName(""), "Imported workbook");
});
