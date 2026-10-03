import { describe, expect, it } from "vitest";

import { csvFileName, parseCsv, serializeCsv, worksheetToCsv } from "./csv";
import type { Worksheet } from "./types";

function worksheet(cells: Record<string, string>): Worksheet {
  return {
    id: "ws-1",
    name: "Sheet1",
    rowCount: 50,
    columnCount: 26,
    cells,
    selection: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
  };
}

describe("parseCsv", () => {
  it("keeps the original row/column order and empty fields", () => {
    expect(parseCsv("East,1200,North,800")).toEqual([["East", "1200", "North", "800"]]);
    expect(parseCsv("a,,\n")).toEqual([["a", "", ""]]);
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\uFEFFEast,1200")).toEqual([["East", "1200"]]);
  });

  it("handles quoted commas, escaped quotes and line breaks inside fields", () => {
    expect(parseCsv('"North, Inc.",1200\n"say ""hi""","multi\nline"\n')).toEqual([
      ["North, Inc.", "1200"],
      ['say "hi"', "multi\nline"],
    ]);
  });

  it("rejects a field that opens a quote without closing it", () => {
    expect(parseCsv('a,"unterminated\nb,c')).toBeNull();
    expect(parseCsv('"unterminated')).toBeNull();
    expect(parseCsv('a,b"c')).toEqual([["a", 'b"c']]);
  });
});

describe("worksheetToCsv", () => {
  it("exports the used range in grid order, keeping empty cells empty", () => {
    expect(worksheetToCsv(worksheet({ A1: "Region", C1: "North", A2: "1200", C2: "800" }))).toBe(
      "Region,,North\n1200,,800",
    );
  });

  it("escapes commas, quotes and line breaks", () => {
    expect(worksheetToCsv(worksheet({ A1: 'North, "East"', A2: "line\nbreak" }))).toBe(
      '"North, ""East"""\n"line\nbreak"',
    );
  });

  it("exports an empty worksheet as empty text", () => {
    expect(worksheetToCsv(worksheet({}))).toBe("");
  });

  it("round-trips its own output", () => {
    const cells = { A1: 'North, "East"', B1: "multi\nline", A2: "1200" };
    const text = worksheetToCsv(worksheet(cells));
    expect(parseCsv(text)).toEqual([
      ['North, "East"', "multi\nline"],
      ["1200", ""],
    ]);
  });

  it("serializes rows with a trailing empty field as an empty cell", () => {
    expect(serializeCsv([["a", ""]])).toBe("a,");
  });
});

describe("csvFileName", () => {
  it("always ends with .csv and identifies workbook and worksheet", () => {
    const name = csvFileName("Q3 Sales", "Sheet1");
    expect(name.endsWith(".csv")).toBe(true);
    expect(name).toContain("Q3 Sales");
    expect(name).toContain("Sheet1");
  });
});
