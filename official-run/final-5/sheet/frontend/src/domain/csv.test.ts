import { describe, expect, test } from "vitest";

import { INVALID_CSV_MESSAGE, InvalidCsvError, parseCsv, worksheetToCsv } from "./csv";

describe("parseCsv", () => {
  test("splits rows and columns in order and preserves empty fields", () => {
    expect(parseCsv("a,b,c\n1,,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
    expect(parseCsv("a,,")).toEqual([["a", "", ""]]);
    expect(parseCsv("")).toEqual([]);
  });

  test("supports UTF-8 Chinese, English and numeric text verbatim", () => {
    expect(parseCsv("地区,销量\n华东,1200\nNorth,800")).toEqual([
      ["地区", "销量"],
      ["华东", "1200"],
      ["North", "800"],
    ]);
  });

  test("keeps commas inside double quotes and unescapes doubled quotes", () => {
    expect(parseCsv('"East, Ltd",1200')).toEqual([["East, Ltd", "1200"]]);
    expect(parseCsv('"say ""hi""",1')).toEqual([['say "hi"', "1"]]);
    expect(parseCsv('"","x"')).toEqual([["", "x"]]);
  });

  test("keeps line breaks that appear inside quoted fields", () => {
    expect(parseCsv('"line one\nline two",2')).toEqual([["line one\nline two", "2"]]);
    expect(parseCsv('"a\r\nb",c')).toEqual([["a\r\nb", "c"]]);
  });

  test("accepts CRLF and CR record separators", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsv("a,b\rc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  test("rejects a field that opens a double quote it never closes", () => {
    expect(() => parseCsv('a,"unterminated')).toThrow(InvalidCsvError);
    try {
      parseCsv('"no closing');
    } catch (error) {
      expect((error as Error).message).toBe(INVALID_CSV_MESSAGE);
    }
  });
});

describe("worksheetToCsv", () => {
  test("emits the used range in row/column order with empty fields kept", () => {
    expect(worksheetToCsv({ cells: { A1: "Region", B1: "Sales", A2: "East", C2: "" } })).toBe(
      "Region,Sales,\nEast,,",
    );
  });

  test("quotes and escapes commas, quotes and line breaks", () => {
    const csv = worksheetToCsv({ cells: { A1: 'a,b', B1: 'say "hi"', C1: "line1\nline2" } });
    expect(csv).toBe('"a,b","say ""hi""","line1\nline2"');
  });

  test("round-trips through parseCsv and returns empty text for a blank worksheet", () => {
    const cells = { A1: "East, Ltd", B1: 'He said "go"', C1: "multi\nline" };
    expect(parseCsv(worksheetToCsv({ cells }))).toEqual([["East, Ltd", 'He said "go"', "multi\nline"]]);
    expect(worksheetToCsv({ cells: {} })).toBe("");
  });
});
