import { describe, expect, it } from "vitest";

import { sameSnapshot, snapshotKey, snapshotWorksheet } from "./history";
import type { Worksheet } from "./workbook";

function sheet(overrides: Partial<Worksheet> = {}): Worksheet {
  return {
    id: "ws",
    name: "Sheet1",
    rowCount: 50,
    columnCount: 26,
    usedRows: 2,
    usedCols: 2,
    cells: { A1: "Region", A2: "East" },
    ...overrides,
  };
}

describe("worksheet history snapshots", () => {
  it("captures cells, used rectangle, grid size and rule ranges", () => {
    const snapshot = snapshotWorksheet(sheet({
      validations: [{ range: "D1:E2", type: "number-between", min: 0, max: 100 }],
    }));
    expect(snapshot).toEqual({
      rowCount: 50,
      columnCount: 26,
      usedRows: 2,
      usedCols: 2,
      cells: { A1: "Region", A2: "East" },
      validations: [{ range: "D1:E2", type: "number-between", min: 0, max: 100 }],
    });
    // The snapshot owns its cells: a later worksheet write must not leak into it.
    const worksheet = sheet();
    const captured = snapshotWorksheet(worksheet);
    worksheet.cells.A3 = "North";
    expect(captured.cells.A3).toBeUndefined();
  });

  it("compares snapshots by content, not by cell insertion order", () => {
    const left = snapshotWorksheet(sheet());
    const right = snapshotWorksheet(sheet({ cells: { A2: "East", A1: "Region" } }));
    expect(sameSnapshot(left, right)).toBe(true);
    expect(snapshotKey(left)).toBe(snapshotKey(right));

    expect(sameSnapshot(left, snapshotWorksheet(sheet({ cells: { A1: "Region" } })))).toBe(false);
    expect(sameSnapshot(left, snapshotWorksheet(sheet({ usedRows: 3 })))).toBe(false);
    expect(sameSnapshot(left, snapshotWorksheet(sheet({ rowCount: 51 })))).toBe(false);
  });

  it("treats an absent rule list and an empty one as different states", () => {
    const without = snapshotWorksheet(sheet());
    const empty = snapshotWorksheet(sheet({ validations: [] }));
    expect(sameSnapshot(without, empty)).toBe(false);
  });
});
