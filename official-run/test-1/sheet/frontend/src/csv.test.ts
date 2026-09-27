import { describe, expect, it } from "vitest";
import { parseCsv, INVALID_CSV_MESSAGE, toCsvText, sheetToCsv, usedRange } from "./csv";
import type { Sheet } from "./types";

function sheet(partial: Partial<Sheet>): Sheet {
  return {
    id: "s1",
    name: "Sheet1",
    activeCell: "A1",
    cells: {},
    ...partial,
  };
}

describe("parseCsv", () => {
  it("parses rows and columns in original order preserving empty fields", () => {
    expect(parseCsv("Region,East,1200\nNorth,,800")).toEqual({
      rows: [
        ["Region", "East", "1200"],
        ["North", "", "800"],
      ],
    });
  });

  it("supports UTF-8 Chinese, English and numeric text", () => {
    expect(parseCsv("地区,销售\n华东,1200")).toEqual({
      rows: [
        ["地区", "销售"],
        ["华东", "1200"],
      ],
    });
  });

  it("handles commas in quotes, escaped quotes and line breaks within fields", () => {
    expect(parseCsv('"a,b","say ""hi""","l1\nl2"\nx,y,z')).toEqual({
      rows: [
        ["a,b", 'say "hi"', "l1\nl2"],
        ["x", "y", "z"],
      ],
    });
  });

  it("rejects a field that begins with a double quote but never closes", () => {
    expect(parseCsv('Region,"East\nNorth,1200')).toEqual({ error: INVALID_CSV_MESSAGE });
    expect(parseCsv('"abc')).toEqual({ error: INVALID_CSV_MESSAGE });
  });

  it("strips a UTF-8 BOM and ignores a trailing newline", () => {
    expect(parseCsv("\uFEFFa,b\n")).toEqual({ rows: [["a", "b"]] });
  });
});

describe("usedRange", () => {
  it("uses declared dimensions when present (imported sheets)", () => {
    const s = sheet({ rowCount: 3, columnCount: 4, cells: { A1: "x" } });
    expect(usedRange(s)).toEqual({ rows: 3, columns: 4 });
  });

  it("falls back to the bounding box of non-empty cells", () => {
    const s = sheet({ cells: { A1: "a", C3: "c" } });
    expect(usedRange(s)).toEqual({ rows: 3, columns: 3 });
    expect(usedRange(sheet({ cells: {} }))).toEqual({ rows: 0, columns: 0 });
  });
});

describe("sheetToCsv", () => {
  it("exports cells in row/column order preserving empty cells in the used range", () => {
    const s = sheet({
      rowCount: 2,
      columnCount: 3,
      cells: { A1: "Region", B1: "East", A2: "North", C2: "800" },
    });
    expect(sheetToCsv(s)).toBe("Region,East,\nNorth,,800");
  });

  it("quotes text containing commas, quotes or line breaks", () => {
    const s = sheet({
      rowCount: 1,
      columnCount: 2,
      cells: { A1: 'say "hi", now', B1: "line1\nline2" },
    });
    expect(sheetToCsv(s)).toBe('"say ""hi"", now","line1\nline2"');
  });

  it("exports a plain single cell for the seeded style of sheet", () => {
    expect(sheetToCsv(sheet({ cells: { A1: "Region" } }))).toBe("Region");
    expect(sheetToCsv(sheet({ cells: {} }))).toBe("");
  });
});

describe("toCsvText", () => {
  it("joins rows and escapes fields", () => {
    expect(toCsvText([["a", "b"], ["c,d", 'e"f']])).toBe('a,b\n"c,d","e""f"');
  });
});
