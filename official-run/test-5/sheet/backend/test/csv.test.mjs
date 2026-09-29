import test from "node:test";
import assert from "node:assert/strict";

import { CsvParseError, formatCsvField, parseCsv, toCsv } from "../src/lib/csv.mjs";

test("parses plain rows in original order and drops only the trailing line break", () => {
  assert.deepEqual(parseCsv("Region,Amount\nEast,1200\nNorth,800\n"), [
    ["Region", "Amount"],
    ["East", "1200"],
    ["North", "800"],
  ]);
  assert.deepEqual(parseCsv("Region,Amount\nEast,1200\nNorth,800"), [
    ["Region", "Amount"],
    ["East", "1200"],
    ["North", "800"],
  ]);
});

test("keeps empty fields, including trailing and interior ones", () => {
  assert.deepEqual(parseCsv("a,,c"), [["a", "", "c"]]);
  assert.deepEqual(parseCsv("a,"), [["a", ""]]);
  assert.deepEqual(parseCsv("a\n\nb"), [["a"], [""], ["b"]]);
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("\n"), [[""]]);
});

test("handles quoted commas, escaped quotes, embedded line breaks and UTF-8 text", () => {
  assert.deepEqual(parseCsv('"East, North",1200'), [["East, North", "1200"]]);
  assert.deepEqual(parseCsv('"say ""hi""",1'), [['say "hi"', "1"]]);
  assert.deepEqual(parseCsv('"line1\nline2",2'), [["line1\nline2", "2"]]);
  assert.deepEqual(parseCsv("地区,数量\r\n华东,1200\r\n"), [
    ["地区", "数量"],
    ["华东", "1200"],
  ]);
  assert.deepEqual(parseCsv("\uFEFF名称,值"), [["名称", "值"]]);
});

test("rejects a field that opens a quote without closing it", () => {
  assert.throws(() => parseCsv('a,"unterminated'), CsvParseError);
  assert.throws(() => parseCsv('"start,1\n2'), CsvParseError);
  assert.throws(() => parseCsv('"'), CsvParseError);
});

test("keeps a quote that is not at the start of a field as literal text", () => {
  assert.deepEqual(parseCsv('ab"cd,1'), [['ab"cd', "1"]]);
  assert.deepEqual(parseCsv('"a"b,1'), [["ab", "1"]]);
});

test("writes fields back with commas, quotes and line breaks escaped", () => {
  assert.equal(formatCsvField("Region"), "Region");
  assert.equal(formatCsvField(""), "");
  assert.equal(formatCsvField("East, North"), '"East, North"');
  assert.equal(formatCsvField('say "hi"'), '"say ""hi"""');
  assert.equal(formatCsvField("line1\nline2"), '"line1\nline2"');
  assert.equal(formatCsvField("line1\r\nline2"), '"line1\r\nline2"');
  assert.equal(formatCsvField("华东"), "华东");
});

test("serializes rows with empty fields preserved in place", () => {
  assert.equal(toCsv([["Region", ""], ["East", "1200"], ["North", "800"]]), "Region,\nEast,1200\nNorth,800");
  assert.equal(toCsv([]), "");
  assert.equal(toCsv([[]]), "");
});

test("round trips exported CSV back through the parser", () => {
  const rows = [["Region", "Note"], ["East, North", 'say "hi"'], ["华东", "line1\nline2"], ["South", ""]];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});
