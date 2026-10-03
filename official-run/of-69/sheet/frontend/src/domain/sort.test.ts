import { describe, expect, it } from "vitest";

import { sortColumnOptions } from "./sort";
import { seededWorkbook, blankWorkbook } from "../test/fixtures";

describe("sortColumnOptions", () => {
  it("names one option per column after the header text of the selected range", () => {
    expect(sortColumnOptions(seededWorkbook.worksheets[0], "A1:C4")).toEqual([
      { column: 0, label: "Region" },
      { column: 1, label: "Sales" },
      { column: 2, label: "Status" },
    ]);
  });

  it("uses the column letter when a header cell is empty", () => {
    expect(sortColumnOptions(blankWorkbook.worksheets[0], "A1:B2")).toEqual([
      { column: 0, label: "A" },
      { column: 1, label: "B" },
    ]);
  });

  it("offers nothing for a text that is not a range", () => {
    expect(sortColumnOptions(seededWorkbook.worksheets[0], "A1")).toEqual([]);
    expect(sortColumnOptions(seededWorkbook.worksheets[0], "nope")).toEqual([]);
  });
});
