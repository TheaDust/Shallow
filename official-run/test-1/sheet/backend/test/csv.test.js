import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, INVALID_CSV_MESSAGE } from "../src/csv.js";
import { columnLabel, cellCoordinate } from "../src/coords.js";

test("parses plain rows in original order", () => {
  assert.deepEqual(parseCsv("Region,East,1200\nNorth,800,West"), {
    rows: [
      ["Region", "East", "1200"],
      ["North", "800", "West"],
    ],
  });
});

test("preserves empty fields including leading, middle and trailing ones", () => {
  assert.deepEqual(parseCsv("a,,c,"), { rows: [["a", "", "c", ""]] });
  assert.deepEqual(parseCsv(",b"), { rows: [["", "b"]] });
});

test("supports UTF-8 Chinese, English and numeric text", () => {
  assert.deepEqual(parseCsv("地区,销售\n华东,1200\n华北,800"), {
    rows: [
      ["地区", "销售"],
      ["华东", "1200"],
      ["华北", "800"],
    ],
  });
});

test("handles commas enclosed in double quotes", () => {
  assert.deepEqual(parseCsv('"a,b",c'), { rows: [["a,b", "c"]] });
});

test("handles escaped pairs of double quotes", () => {
  assert.deepEqual(parseCsv('"a""b",c'), { rows: [['a"b', "c"]] });
  assert.deepEqual(parseCsv('"say ""hi""",x'), { rows: [['say "hi"', "x"]] });
});

test("handles line breaks within quoted fields", () => {
  assert.deepEqual(parseCsv('"line1\nline2",x\ny,z'), {
    rows: [
      ["line1\nline2", "x"],
      ["y", "z"],
    ],
  });
});

test("handles CRLF and lone CR row separators", () => {
  assert.deepEqual(parseCsv("a,b\r\nc,d"), {
    rows: [
      ["a", "b"],
      ["c", "d"],
    ],
  });
  assert.deepEqual(parseCsv("a,b\rc,d"), {
    rows: [
      ["a", "b"],
      ["c", "d"],
    ],
  });
});

test("a quoted field that never closes is invalid", () => {
  const r = parseCsv('Region,"East\nNorth,1200');
  assert.ok("error" in r);
  assert.equal(r.error, INVALID_CSV_MESSAGE);
  assert.deepEqual(parseCsv('"abc'), { error: INVALID_CSV_MESSAGE });
  assert.deepEqual(parseCsv('a,"b,c'), { error: INVALID_CSV_MESSAGE });
});

test("strips a UTF-8 BOM from the first field", () => {
  assert.deepEqual(parseCsv("\uFEFFa,b"), { rows: [["a", "b"]] });
});

test("a trailing newline does not create an extra empty row", () => {
  assert.deepEqual(parseCsv("a,b\n"), { rows: [["a", "b"]] });
  assert.deepEqual(parseCsv("a,b\r\n"), { rows: [["a", "b"]] });
});

test("empty input produces no rows; a blank line is one empty field", () => {
  assert.deepEqual(parseCsv(""), { rows: [] });
  assert.deepEqual(parseCsv("\n"), { rows: [[""]] });
});

test("coordinate helpers map columns and rows to A1-style coordinates", () => {
  assert.equal(columnLabel(0), "A");
  assert.equal(columnLabel(25), "Z");
  assert.equal(columnLabel(26), "AA");
  assert.equal(cellCoordinate(0, 0), "A1");
  assert.equal(cellCoordinate(2, 4), "C5");
  assert.equal(cellCoordinate(27, 9), "AB10");
});
