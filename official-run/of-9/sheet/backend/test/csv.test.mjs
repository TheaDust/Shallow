import assert from "node:assert/strict";
import test from "node:test";

import { CsvError, parseCsv, serializeCsv } from "../src/lib/csv.mjs";

test("parses basic CSV rows and columns in order", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,2,3"), [["a", "b", "c"], ["1", "2", "3"]]);
});

test("preserves empty fields", () => {
  assert.deepEqual(parseCsv("a,,c"), [["a", "", "c"]]);
  assert.deepEqual(parseCsv("a,b\n,,c"), [["a", "b"], ["", "", "c"]]);
});

test("handles commas enclosed in double quotes", () => {
  assert.deepEqual(parseCsv('"East, West",1200'), [["East, West", "1200"]]);
});

test("handles escaped pairs of double quotes", () => {
  assert.deepEqual(parseCsv('"say ""hi""",x'), [['say "hi"', "x"]]);
});

test("handles line breaks within quoted fields", () => {
  assert.deepEqual(parseCsv('"line1\nline2",b'), [["line1\nline2", "b"]]);
});

test("supports UTF-8 Chinese text", () => {
  assert.deepEqual(parseCsv("名称,数量\n苹果,3"), [["名称", "数量"], ["苹果", "3"]]);
});

test("handles CRLF line endings and a trailing newline without an extra row", () => {
  assert.deepEqual(parseCsv("a,b\r\nc,d\r\n"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseCsv("a,b\n"), [["a", "b"]]);
});

test("rejects a field that begins with a quote but has no closing quote", () => {
  assert.throws(() => parseCsv('a,"b'), (error) => {
    assert.ok(error instanceof CsvError);
    assert.equal(error.message, "Invalid CSV file format. Import failed.");
    return true;
  });
  assert.throws(() => parseCsv('"unclosed'), (error) => {
    assert.equal(error.message, "Invalid CSV file format. Import failed.");
    return true;
  });
});

test("parses an empty input as no rows and a blank line as one empty field", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("\n"), [[""]]);
});

test("serializes plain fields without quotes", () => {
  assert.equal(serializeCsv([["a", "b"]]), "a,b\r\n");
});

test("serializes fields containing commas, quotes or line breaks with quoting", () => {
  assert.equal(serializeCsv([["East, West", 'say "hi"', "line1\nline2"]]), '"East, West","say ""hi""","line1\nline2"\r\n');
});

test("serialize then parse round-trips complex content", () => {
  const rows = [["Region", "Value"], ['East, "main"', "line\nbreak"], ["", "tail"]];
  assert.deepEqual(parseCsv(serializeCsv(rows)), rows);
});
