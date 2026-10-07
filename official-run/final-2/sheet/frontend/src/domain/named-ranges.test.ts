import { describe, expect, test } from "vitest";

import { computeDisplayValues } from "./formula";
import { namedRangeEntries, parseNamedRangeReference } from "./named-ranges";

describe("parseNamedRangeReference", () => {
  test("splits a sheet-qualified area into its sheet and its coordinates", () => {
    expect(parseNamedRangeReference("ForecastModel!J3:J5")).toEqual({
      sheet: "ForecastModel",
      start: "J3",
      end: "J5",
    });
    expect(parseNamedRangeReference("ForecastModel!K2")).toEqual({
      sheet: "ForecastModel",
      start: "K2",
      end: "K2",
    });
    // Reversed corners and surrounding whitespace are canonicalised.
    expect(parseNamedRangeReference(" Forecast Model ! j5:j3 ")).toEqual({
      sheet: "Forecast Model",
      start: "J3",
      end: "J5",
    });
  });

  test("rejects text that is not a sheet-qualified A1 cell or area", () => {
    for (const value of [undefined, null, 7, "", "J3:J5", "ForecastModel!", "Missing!A0", "ForecastModel!A1:B2:C3"]) {
      expect(parseNamedRangeReference(value)).toBeNull();
    }
  });
});

describe("namedRangeEntries", () => {
  test("lists the saved names or nothing at all", () => {
    expect(namedRangeEntries(undefined)).toEqual([]);
    expect(namedRangeEntries([{ name: "MarginBase", range: "ForecastModel!K2:K3" }])).toHaveLength(1);
  });
});

describe("computeDisplayValues with named ranges", () => {
  const namedRanges = [
    { name: "CapacityPlan", range: "ForecastModel!J3:J5" },
    { name: "SingleValue", range: "ForecastModel!K2" },
  ];

  test("a saved name behaves as the range reference it stores", () => {
    const cells = { J3: "18", J4: "24", J5: "31", K2: "7", L3: "=SUM(CapacityPlan)", M2: "=SingleValue" };
    const values = computeDisplayValues(cells, { sheetName: "ForecastModel", namedRanges });
    expect(values.L3).toBe("73");
    expect(values.M2).toBe("7");
  });

  test("changing the stored area recalculates the dependent formulas", () => {
    const cells = { K2: "5", K3: "8", K4: "12", M2: "=SUM(MarginBase)" };
    const before = computeDisplayValues(cells, {
      sheetName: "ForecastModel",
      namedRanges: [{ name: "MarginBase", range: "ForecastModel!K2:K3" }],
    });
    const after = computeDisplayValues(cells, {
      sheetName: "ForecastModel",
      namedRanges: [{ name: "MarginBase", range: "ForecastModel!K2:K4" }],
    });
    expect(before.M2).toBe("13");
    expect(after.M2).toBe("25");
  });

  test("a name of another worksheet reads that worksheet's cells", () => {
    const values = computeDisplayValues(
      { L3: "=SUM(CapacityPlan)" },
      {
        sheetName: "Summary",
        namedRanges,
        worksheetCells: { ForecastModel: { J3: "18", J4: "24", J5: "31" }, Summary: { L3: "=SUM(CapacityPlan)" } },
      },
    );
    expect(values.L3).toBe("73");
  });

  test("an unresolvable name, a bare area and a circular name report errors", () => {
    expect(computeDisplayValues({ A1: "=SUM(Ghost)" }, { sheetName: "ForecastModel" }).A1).toBe("#NAME?");
    expect(computeDisplayValues({ A1: "=CapacityPlan" }, { sheetName: "ForecastModel", namedRanges }).A1).toBe(
      "#VALUE!",
    );
    const circular = computeDisplayValues(
      { A1: "=SUM(Loop)" },
      {
        sheetName: "ForecastModel",
        namedRanges: [{ name: "Loop", range: "Other!A1:A2" }],
        worksheetCells: { ForecastModel: { A1: "=SUM(Loop)" }, Other: { A1: "=SUM(Loop)" } },
      },
    );
    expect(circular.A1).toBe("#REF!");
  });

  test("a name that looks like a cell address still reads the cell", () => {
    // A1 is a cell of the sheet, so it is never a named range of the workbook.
    const values = computeDisplayValues(
      { A1: "5", B1: "=A1*2" },
      { sheetName: "ForecastModel", namedRanges: [{ name: "A1", range: "ForecastModel!K2:K3" }] },
    );
    expect(values.B1).toBe("10");
  });
});
