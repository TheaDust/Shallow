import { describe, expect, it } from "vitest";

import { csvEscape, csvFileName, worksheetToCsv, worksheetUsedExtent } from "./csv";
import { seedWorkbook } from "../test/fake-backend";

describe("CSV export serialization", () => {
  it("writes the used rectangle in grid row/column order with empty fields preserved", () => {
    const worksheet = {
      id: "s1",
      name: "Sheet1",
      rowCount: 50,
      columnCount: 26,
      usedRows: 3,
      usedCols: 3,
      cells: { A1: "Region", C1: "Total", A2: "East", B2: "1200", A3: "North", B3: "800" },
    };
    expect(worksheetToCsv(worksheet)).toBe("Region,,Total\nEast,1200,\nNorth,800,");
  });

  it("escapes commas, double quotes and line breaks", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(worksheetToCsv({
      id: "s1",
      name: "Sheet1",
      rowCount: 50,
      columnCount: 26,
      usedRows: 1,
      usedCols: 3,
      cells: { A1: "a,b", B1: 'say "hi"', C1: "line1\nline2" },
    })).toBe('"a,b","say ""hi""","line1\nline2"');
  });

  it("exports the displayed value of every cell and keeps trailing empty fields", () => {
    const worksheet = {
      id: "s1",
      name: "Sheet1",
      rowCount: 50,
      columnCount: 26,
      usedRows: 2,
      usedCols: 3,
      cells: { A1: "10", B1: "20", C1: "30", A2: "=SUM(A1:C1)", B2: "40", C2: "" },
    };
    expect(worksheetToCsv(worksheet)).toBe("10,20,30\n=SUM(A1:C1),40,");
  });

  it("derives the used extent from the persisted extent and the non-empty cells", () => {
    expect(worksheetUsedExtent(seedWorkbook().worksheets[0])).toEqual({ rows: 4, cols: 3 });
    expect(worksheetUsedExtent({
      id: "s1", name: "Sheet1", rowCount: 50, columnCount: 26, cells: { C5: "x" },
    })).toEqual({ rows: 5, cols: 3 });
    expect(worksheetUsedExtent({
      id: "s1", name: "Sheet1", rowCount: 50, columnCount: 26, cells: {},
    })).toEqual({ rows: 0, cols: 0 });
  });

  it("renders nothing for an unused worksheet and suggests a .csv file name", () => {
    expect(worksheetToCsv({
      id: "s1", name: "Sheet1", rowCount: 50, columnCount: 26, cells: {},
    })).toBe("");
    expect(csvFileName("Q3 Sales")).toBe("Q3 Sales.csv");
    expect(csvFileName("budget/plan")).toBe("budget-plan.csv");
    expect(csvFileName("already.csv")).toBe("already.csv");
  });
});
