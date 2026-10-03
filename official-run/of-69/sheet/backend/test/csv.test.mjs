import assert from "node:assert/strict";
import test from "node:test";

import {
  CsvError,
  INVALID_CSV_MESSAGE,
  formatCsvField,
  parseCsv,
  serializeCsv,
  suggestedCsvFilename,
  worksheetToCsv,
  worksheetUsedBounds,
} from "../src/lib/csv.mjs";

const worksheetOf = (cells, extra = {}) => ({
  id: "ws-1",
  name: "Sheet1",
  rowCount: 30,
  columnCount: 26,
  cells,
  selection: { anchor: "A1", focus: "A1" },
  ...extra,
});

test("parses rows in the original order with empty fields preserved", () => {
  assert.deepEqual(parseCsv("Region,Revenue\nEast,1200\nNorth,800"), [
    ["Region", "Revenue"],
    ["East", "1200"],
    ["North", "800"],
  ]);
  assert.deepEqual(parseCsv("a,,c"), [["a", "", "c"]]);
  assert.deepEqual(parseCsv(",,"), [["", "", ""]]);
  assert.deepEqual(parseCsv(""), []);
});

test("ignores a single trailing line break but keeps blank records in the middle", () => {
  assert.deepEqual(parseCsv("a,b\n"), [["a", "b"]]);
  assert.deepEqual(parseCsv("a,b\r\n"), [["a", "b"]]);
  assert.deepEqual(parseCsv("a,b\r\nc,d\r\n"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseCsv("a,b\n\nc,d"), [["a", "b"], [""], ["c", "d"]]);
});

test("supports quotes, escaped quote pairs and line breaks inside fields", () => {
  assert.deepEqual(parseCsv('"East, Inc",1200'), [["East, Inc", "1200"]]);
  assert.deepEqual(parseCsv('"He said ""hi""",x'), [['He said "hi"', "x"]]);
  assert.deepEqual(parseCsv('"line1\nline2",x'), [["line1\nline2", "x"]]);
  assert.deepEqual(parseCsv('"",x'), [["", "x"]]);
});

test("supports UTF-8 Chinese, English and numeric text and strips a byte order mark", () => {
  assert.deepEqual(parseCsv("\uFEFF区域,数值\n华东,1200"), [
    ["区域", "数值"],
    ["华东", "1200"],
  ]);
});

test("rejects a field that opens with a double quote and never closes it", () => {
  for (const input of ['Region,"East', 'a,"b\nc', '"']) {
    assert.throws(() => parseCsv(input), (error) => {
      assert.ok(error instanceof CsvError);
      assert.equal(error.message, INVALID_CSV_MESSAGE);
      return true;
    });
  }
});

test("quotes only the fields that need escaping", () => {
  assert.equal(formatCsvField("East"), "East");
  assert.equal(formatCsvField(""), "");
  assert.equal(formatCsvField("East, Inc"), '"East, Inc"');
  assert.equal(formatCsvField('He said "hi"'), '"He said ""hi"""');
  assert.equal(formatCsvField("line1\nline2"), '"line1\nline2"');
  assert.equal(serializeCsv([["a", "", "c"], ["x"]]), "a,,c\nx");
});

test("exports the used range with empty cells preserved and displayed values for formulas", () => {
  assert.equal(worksheetToCsv(worksheetOf({})), "");
  assert.equal(worksheetToCsv(worksheetOf({ A1: { value: "Region" } })), "Region");
  assert.equal(
    worksheetToCsv(
      worksheetOf({ A1: { value: "a" }, B1: { value: "" }, C1: { value: "c" }, A2: { value: "d" }, C2: { value: "f" } }),
    ),
    "a,,c\nd,,f",
  );
  assert.equal(
    worksheetToCsv(worksheetOf({ A1: { value: "East" }, A3: { value: 'He said "hi"' } })),
    'East\n\n"He said ""hi"""',
  );
  assert.equal(
    worksheetToCsv(worksheetOf({ A1: { value: "1200", formula: "=SUM(B1:B2)" } })),
    "1200",
  );
});

test("computes the used bounds from defined cells at least 1x1", () => {
  assert.deepEqual(worksheetUsedBounds(worksheetOf({})), { rows: 1, columns: 1 });
  assert.deepEqual(worksheetUsedBounds(worksheetOf({ C4: { value: "x" } })), { rows: 4, columns: 3 });
});

test("suggests a csv download name from the workbook and worksheet names", () => {
  assert.equal(suggestedCsvFilename("Q3 Sales", "Sheet1"), "Q3 Sales - Sheet1.csv");
  assert.equal(suggestedCsvFilename("销售/季度", "Sheet1"), "销售-季度 - Sheet1.csv");
  assert.equal(suggestedCsvFilename("", ""), "workbook - worksheet.csv");
});
