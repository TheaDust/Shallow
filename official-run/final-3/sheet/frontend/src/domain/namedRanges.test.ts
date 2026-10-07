import { describe, expect, test } from "vitest";

import {
  namedRangeNameError,
  namedRangeLookup,
  namedRangeText,
  parseNamedRangeRange,
} from "./namedRanges";
import type { Workbook } from "./types";

const workbook: Workbook = {
  id: "EVO-N03-NAMED-CREATE",
  name: "EVO-N03-NAMED-CREATE",
  createdAt: "2026-10-07T09:00:00.000Z",
  updatedAt: "2026-10-07T09:00:00.000Z",
  activeWorksheetId: "ws-forecast",
  namedRanges: [{ name: "CapacityPlan", worksheetId: "ws-forecast", range: "J3:J5" }],
  worksheets: [
    {
      id: "ws-forecast",
      name: "ForecastModel",
      cells: { J3: "18", J4: "24", J5: "31" },
    },
    { id: "ws-other", name: "Archive", cells: { B2: "9" } },
  ],
};

describe("namedRangeNameError", () => {
  test("accepts a name starting with a letter and rejects anything else", () => {
    expect(namedRangeNameError("CapacityPlan")).toBeNull();
    expect(namedRangeNameError(" marginBase ")).toBeNull();
    expect(namedRangeNameError("1stBatch")).toBe("Named range must start with a letter");
    expect(namedRangeNameError("_hidden")).toBe("Named range must start with a letter");
    expect(namedRangeNameError("")).toBe("Named range must start with a letter");
  });
});

describe("parseNamedRangeRange", () => {
  test("qualifies a range with its worksheet, defaulting to the active one", () => {
    expect(parseNamedRangeRange("ForecastModel!J3:J5", workbook, "ws-other")).toEqual({
      worksheetId: "ws-forecast",
      range: "J3:J5",
    });
    expect(parseNamedRangeRange("B2", workbook, "ws-other")).toEqual({
      worksheetId: "ws-other",
      range: "B2",
    });
    // A reversed area is stored in canonical order.
    expect(parseNamedRangeRange("forecastmodel!J5:J3", workbook, "ws-forecast")).toEqual({
      worksheetId: "ws-forecast",
      range: "J3:J5",
    });
  });

  test("rejects an unknown worksheet or a malformed area", () => {
    expect(parseNamedRangeRange("Missing!J3:J5", workbook, "ws-forecast")).toBeNull();
    expect(parseNamedRangeRange("ForecastModel!J3:", workbook, "ws-forecast")).toBeNull();
    expect(parseNamedRangeRange("", workbook, "ws-forecast")).toBeNull();
  });
});

describe("namedRangeText and namedRangeLookup", () => {
  test("shows the worksheet's current name and resolves the stored area", () => {
    expect(namedRangeText(workbook.namedRanges![0], workbook)).toBe("ForecastModel!J3:J5");
    const lookup = namedRangeLookup(workbook);
    expect(lookup("capacityplan")).toEqual({
      coordinates: ["J3", "J4", "J5"],
      cells: workbook.worksheets[0].cells,
    });
    expect(lookup("Unknown")).toBeNull();
  });

  test("resolves to the cells of the worksheet the range belongs to", () => {
    const otherSheetWorkbook: Workbook = {
      ...workbook,
      namedRanges: [{ name: "ArchiveTotal", worksheetId: "ws-other", range: "B2:B3" }],
    };
    const lookup = namedRangeLookup(otherSheetWorkbook);
    expect(lookup("ArchiveTotal")).toEqual({
      coordinates: ["B2", "B3"],
      cells: otherSheetWorkbook.worksheets[1].cells,
    });
  });
});
