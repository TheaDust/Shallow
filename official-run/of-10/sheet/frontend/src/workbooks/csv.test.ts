import { describe, expect, it } from "vitest";

import { escapeCsvField, exportFileName, worksheetToCsv } from "./csv";
import type { WorksheetData } from "./types";

function sheet(cells: WorksheetData["cells"], extra: Partial<WorksheetData> = {}): WorksheetData {
  return { id: "ws_test", name: "Sheet1", rowCount: 50, columnCount: 26, cells, ...extra };
}

describe("worksheetToCsv", () => {
  it("exports the used range in the grid row/column order, keeping empty cells inside it", () => {
    const csv = worksheetToCsv(
      sheet({
        A1: { value: "Region" },
        A2: { value: "East" },
        B2: { value: "1200" },
        A3: { value: "North" },
        B3: { value: "800" },
      }),
    );

    expect(csv).toBe("Region,\nEast,1200\nNorth,800\n");
  });

  it("keeps entirely empty rows and columns that fall inside the used range", () => {
    const csv = worksheetToCsv(
      sheet({
        A1: { value: "x" },
        C1: { value: "z" },
        A3: { value: "y" },
      }),
    );

    expect(csv).toBe("x,,z\n,,\ny,,\n");
  });

  it("exports nothing for a worksheet without values", () => {
    expect(worksheetToCsv(sheet({}))).toBe("");
  });

  it("escapes commas, quotes and line breaks and keeps other text untouched", () => {
    expect(escapeCsvField("plain")).toBe("plain");
    expect(escapeCsvField("East, North")).toBe('"East, North"');
    expect(escapeCsvField('He said "yes"')).toBe('"He said ""yes"""');
    expect(escapeCsvField("line\nbreak")).toBe('"line\nbreak"');

    const csv = worksheetToCsv(
      sheet({
        A1: { value: "a,b" },
        B1: { value: 'q"q' },
        A2: { value: "multi\nline" },
      }),
    );
    expect(csv).toBe('"a,b","q""q"\n"multi\nline",\n');
  });

  it("reads the worksheet it is given, so a non-active worksheet keeps its own values", () => {
    const other = sheet({ A1: { value: "Other sheet" } }, { id: "ws_other", name: "Sheet2" });
    expect(worksheetToCsv(other)).toBe("Other sheet\n");
  });
});

describe("exportFileName", () => {
  it("builds a .csv file name from the workbook and active worksheet names", () => {
    expect(exportFileName("Q3 Sales", "Sheet1")).toBe("Q3 Sales - Sheet1.csv");
    expect(exportFileName("Q3 明细", "工作表1")).toBe("Q3 明细 - 工作表1.csv");
  });

  it("replaces characters that cannot appear in a file name and keeps a fallback", () => {
    expect(exportFileName("a/b:c", "Sheet1")).toBe("a_b_c - Sheet1.csv");
    expect(exportFileName("   ", "")).toBe("workbook - worksheet.csv");
  });
});
