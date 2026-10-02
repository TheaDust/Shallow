import { describe, expect, it } from "vitest";

import { escapeCsvField, worksheetCsvFileName, worksheetToCsv, worksheetUsedRange } from "./csv";

describe("escapeCsvField", () => {
  it("leaves ordinary text untouched", () => {
    expect(escapeCsvField("Region")).toBe("Region");
    expect(escapeCsvField("")).toBe("");
  });

  it("quotes commas, double quotes and line breaks", () => {
    expect(escapeCsvField("North, South")).toBe('"North, South"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("worksheetToCsv", () => {
  it("exports rows and columns in grid order and keeps empty cells inside the used range", () => {
    const csv = worksheetToCsv({ cells: { A1: "Region", C1: "Qty", A2: "East", C2: "1200" } });
    expect(csv).toBe("Region,,Qty\nEast,,1200");
  });

  it("escapes values that contain commas, quotes or line breaks", () => {
    const csv = worksheetToCsv({ cells: { A1: 'North, "South"', B1: "line1\nline2" } });
    expect(csv).toBe('"North, ""South""","line1\nline2"');
  });

  it("exports an empty worksheet as empty text", () => {
    expect(worksheetToCsv({ cells: {} })).toBe("");
  });

  it("exports the calculated result of a formula cell instead of its expression", () => {
    const csv = worksheetToCsv({ cells: { A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2", E1: "=1/0" } });
    expect(csv).toBe("2,3,5,10,#DIV/0!");
  });

  it("reports the used range of a sparse worksheet", () => {
    expect(worksheetUsedRange({})).toEqual({ rows: 0, columns: 0 });
    expect(worksheetUsedRange({ A1: "x", B3: "y" })).toEqual({ rows: 3, columns: 2 });
    expect(worksheetUsedRange({ B2: "" })).toEqual({ rows: 0, columns: 0 });
  });
});

describe("worksheetCsvFileName", () => {
  it("suggests a file name ending with .csv", () => {
    expect(worksheetCsvFileName("Q3 Sales", "Sheet1")).toBe("Q3 Sales - Sheet1.csv");
    expect(worksheetCsvFileName("A/B", "Sheet1").endsWith(".csv")).toBe(true);
  });
});
