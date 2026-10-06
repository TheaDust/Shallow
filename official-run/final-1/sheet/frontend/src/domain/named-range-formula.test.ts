import { describe, expect, test } from "vitest";

import { computeDisplayValues } from "./formula";

describe("computeDisplayValues with named ranges", () => {
  const namedRanges = [
    { id: "nr-1", name: "CapacityPlan", range: "ForecastModel!J3:J5" },
    { id: "nr-2", name: "MarginBase", range: "K2:K3" },
  ];

  test("a saved name aggregates the cells of its range", () => {
    const cells = { J3: "18", J4: "24", J5: "31", L3: "=SUM(CapacityPlan)" };
    const values = computeDisplayValues(cells, { namedRanges, sheetName: "ForecastModel" });
    expect(values.L3).toBe("73");
  });

  test("a name without a worksheet qualifier resolves on the current sheet", () => {
    const cells = { K2: "5", K3: "8", K4: "12", M2: "=SUM(MarginBase)", M3: "=SUM(MarginBase)+K4" };
    const values = computeDisplayValues(cells, { namedRanges });
    expect(values.M2).toBe("13");
    expect(values.M3).toBe("25");
    // A changed range recalculates the dependent formula immediately.
    expect(
      computeDisplayValues(cells, {
        namedRanges: [{ id: "nr-2", name: "MarginBase", range: "K2:K4" }],
      }).M2,
    ).toBe("25");
  });

  test("a qualified name reads the cells of the worksheet it points at", () => {
    const values = computeDisplayValues(
      { A1: "=SUM(Plan)" },
      {
        namedRanges: [{ id: "nr-3", name: "Plan", range: "Budget!B2:B3" }],
        sheets: { Model: { A1: "=SUM(Plan)" }, Budget: { B2: "4", B3: "6" } },
        sheetName: "Model",
      },
    );
    expect(values.A1).toBe("10");
  });

  test("names are resolved without regard to letter case and stay unknown otherwise", () => {
    const cells = { J3: "18", L3: "=sum(capacityplan)", L4: "=SUM(UnknownName)" };
    const values = computeDisplayValues(cells, { namedRanges, sheetName: "ForecastModel" });
    expect(values.L3).toBe("18");
    expect(values.L4).toBe("#NAME?");
  });

  test("a formula that used a name before the name existed keeps its name error", () => {
    expect(computeDisplayValues({ L3: "=SUM(CapacityPlan)" }).L3).toBe("#NAME?");
  });
});
