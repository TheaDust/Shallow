import { describe, expect, it } from "vitest";

import { shiftFormulaByOffset } from "./references";

/** The default grid size the mock backend works with. */
const GRID = { rowCount: 12, columnCount: 8 };

describe("shiftFormulaByOffset", () => {
  it("moves relative references by the offset and keeps absolute ones", () => {
    expect(shiftFormulaByOffset("=B2", 1, 1, GRID)).toBe("=C3");
    expect(shiftFormulaByOffset("=$B2", 1, 1, GRID)).toBe("=$B3");
    expect(shiftFormulaByOffset("=B$2", 1, 1, GRID)).toBe("=C$2");
    expect(shiftFormulaByOffset("=$B$2", 1, 1, GRID)).toBe("=$B$2");
    expect(shiftFormulaByOffset("=SUM(A1:B2)", 2, 0, GRID)).toBe("=SUM(A3:B4)");
  });

  it("keeps string literals, ordinary text and a zero offset untouched", () => {
    expect(shiftFormulaByOffset('="A1"&B1', 1, 0, GRID)).toBe('="A1"&B2');
    expect(shiftFormulaByOffset("Region", 1, 1, GRID)).toBe("Region");
    expect(shiftFormulaByOffset("=B2", 0, 0, GRID)).toBe("=B2");
  });

  it("replaces a reference the offset pushes outside the grid", () => {
    expect(shiftFormulaByOffset("=A1", -1, 0, GRID)).toBe("=#REF!");
    expect(shiftFormulaByOffset("=SUM(A1:B2)", 0, 7, GRID)).toBe("=SUM(#REF!)");
  });
});
