import { describe, expect, it } from "vitest";

import { suggestedExportFilename, worksheetExportUrl } from "./csv-export";

describe("csv export helpers", () => {
  it("builds a same-origin export url for one worksheet", () => {
    expect(worksheetExportUrl("wb-q3-sales", "ws-q3-sales-sheet1")).toBe(
      "/api/workbooks/wb-q3-sales/export.csv?worksheetId=ws-q3-sales-sheet1",
    );
    expect(worksheetExportUrl("wb a/b", "ws 1")).toBe("/api/workbooks/wb%20a%2Fb/export.csv?worksheetId=ws%201");
  });

  it("suggests a download name that ends with .csv", () => {
    expect(suggestedExportFilename("Q3 Sales", "Sheet1")).toBe("Q3 Sales - Sheet1.csv");
    expect(suggestedExportFilename("销售/季度", "Sheet1")).toBe("销售-季度 - Sheet1.csv");
    expect(suggestedExportFilename("", "")).toBe("workbook - worksheet.csv");
  });
});
