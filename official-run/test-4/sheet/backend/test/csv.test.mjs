import assert from "node:assert/strict";
import test from "node:test";

import { CsvError, parseCsv, serializeCsv } from "../src/lib/csv.mjs";

test("parses simple rows preserving order", () => {
  assert.deepEqual(parseCsv("a,b,c\nd,e,f\n"), [
    ["a", "b", "c"],
    ["d", "e", "f"],
  ]);
});

test("preserves empty fields", () => {
  assert.deepEqual(parseCsv("a,,c\n,,\n"), [
    ["a", "", "c"],
    ["", "", ""],
  ]);
});

test("supports UTF-8 Chinese, English and numeric text", () => {
  assert.deepEqual(parseCsv("区域,Region\n华东,1200\n华北,800\n"), [
    ["区域", "Region"],
    ["华东", "1200"],
    ["华北", "800"],
  ]);
});

test("handles commas inside double quotes", () => {
  assert.deepEqual(parseCsv('a,"b,c",d\n'), [["a", "b,c", "d"]]);
});

test("handles escaped pairs of double quotes", () => {
  assert.deepEqual(parseCsv('a,"say ""hi""",c\n'), [["a", 'say "hi"', "c"]]);
});

test("handles line breaks inside quoted fields", () => {
  assert.deepEqual(parseCsv('a,"line1\nline2",c\r\n'), [["a", "line1\nline2", "c"]]);
});

test("handles CRLF row endings", () => {
  assert.deepEqual(parseCsv("a,b\r\nc,d\r\n"), [
    ["a", "b"],
    ["c", "d"],
  ]);
});

test("rejects a field that starts with a quote without a closing quote", () => {
  assert.throws(() => parseCsv('a,"unclosed,c\n'), CsvError);
  assert.throws(() => parseCsv('"unclosed'), CsvError);
});

test("rejects non-string input", () => {
  assert.throws(() => parseCsv(undefined), CsvError);
});

test("empty and whitespace-only input produce no rows", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("   \n  "), []);
});

test("keeps a quoted field with only an escaped quote invalid at end", () => {
  assert.throws(() => parseCsv('"a""'), CsvError);
});

test("serializes simple rows preserving order", () => {
  assert.equal(serializeCsv([["a", "b", "c"], ["d", "e", "f"]]), "a,b,c\r\nd,e,f\r\n");
});

test("serialized output round-trips through parseCsv", () => {
  const rows = [
    ["Region", "Amount"],
    ["East", "1200"],
    ["North", "800"],
  ];
  assert.deepEqual(parseCsv(serializeCsv(rows)), rows);
});

test("serializes empty fields within the used range", () => {
  assert.equal(serializeCsv([["a", "", "c"], ["", "", ""]]), "a,,c\r\n,,\r\n");
  assert.equal(serializeCsv([[""]]), "\r\n");
});

test("quotes and escapes commas, quotes and line breaks", () => {
  assert.equal(serializeCsv([["Sales, Q3", "say \"hi\"", "line1\nline2", "cr\rlf"]]), '"Sales, Q3","say ""hi""","line1\nline2","cr\rlf"\r\n');
});

test("keeps UTF-8 Chinese text intact", () => {
  assert.equal(serializeCsv([[ "区域", "华东" ]]), "区域,华东\r\n");
});

test("serializeCsv rejects non-array input", () => {
  assert.throws(() => serializeCsv(undefined), CsvError);
  assert.throws(() => serializeCsv("a,b"), CsvError);
});
