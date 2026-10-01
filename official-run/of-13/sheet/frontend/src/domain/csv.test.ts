import { describe, expect, it } from "vitest";

import { csvFileName, formatCsvField, worksheetToCsv, worksheetUsedRange } from "./csv";
import type { WorksheetState } from "./workbook";

function sheet(cells: Record<string, string>): WorksheetState {
  return { id: "sheet-1", name: "Sheet1", cells };
}

describe("worksheetUsedRange", () => {
  it("is the rectangle from A1 to the last non-empty cell", () => {
    expect(worksheetUsedRange(sheet({ A1: "Region", C3: "x" }))).toEqual({ rowCount: 3, columnCount: 3 });
  });

  it("ignores empty values and handles an empty worksheet", () => {
    expect(worksheetUsedRange(sheet({}))).toEqual({ rowCount: 0, columnCount: 0 });
    expect(worksheetUsedRange(sheet({ B4: "" }))).toEqual({ rowCount: 0, columnCount: 0 });
    expect(worksheetUsedRange(undefined)).toEqual({ rowCount: 0, columnCount: 0 });
  });
});

describe("formatCsvField", () => {
  it("only quotes fields that need escaping", () => {
    expect(formatCsvField("Region")).toBe("Region");
    expect(formatCsvField("1200")).toBe("1200");
    expect(formatCsvField("East, North")).toBe('"East, North"');
    expect(formatCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(formatCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(formatCsvField("")).toBe("");
  });
});

describe("worksheetToCsv", () => {
  it("exports the used range in grid order, keeping empty cells", () => {
    const csv = worksheetToCsv(sheet({ A1: "Region", B1: "East", A2: "1200", B2: "North", C1: "800" }));
    expect(csv).toBe("Region,East,800\n1200,North,");
  });

  it("exports UTF-8 text and escaped values unchanged in order", () => {
    const csv = worksheetToCsv(
      sheet({ A1: "区域", B1: 'say "hi"', A2: "华东, 南区", B2: "line1\nline2" }),
    );
    expect(csv).toBe('区域,"say ""hi"""\n"华东, 南区","line1\nline2"');
  });

  it("exports a single cell workbook and an empty worksheet", () => {
    expect(worksheetToCsv(sheet({ A1: "Region" }))).toBe("Region");
    expect(worksheetToCsv(sheet({}))).toBe("");
  });
});

describe("csvFileName", () => {
  it("suggests a name ending with .csv", () => {
    expect(csvFileName("Q3 Sales")).toBe("Q3 Sales.csv");
    expect(csvFileName("  ")).toBe("worksheet.csv");
    expect(csvFileName('bad/name:*"')).toBe("bad_name___.csv");
  });
});
