import { beforeEach, describe, expect, it } from "vitest";

import {
  canRedo,
  canUndo,
  clearHistory,
  clearRedo,
  popRedo,
  popUndo,
  pushRedo,
  pushUndo,
  snapshotSheet,
  type HistoryEntry,
} from "./history";
import type { Worksheet } from "./types";

function entry(value: string): HistoryEntry {
  return {
    sheetId: "ws-1",
    before: { cells: { A1: { value } } },
    after: { cells: { A1: { value: `${value}-after` } } },
  };
}

const sheet: Worksheet = {
  id: "ws-1",
  name: "Sheet1",
  cells: { A1: { value: "Item" }, B1: { value: "5", formula: "=1+4" } },
  validationRules: [{ id: "r1", type: "dropdown", allowedValues: ["East", "North"], range: { start: { row: 1, column: 1 }, end: { row: 1, column: 1 } } }],
  pivot: {
    sourceSheetId: "ws-1",
    sourceRange: { start: { row: 1, column: 1 }, end: { row: 2, column: 2 } },
    rowField: "Region",
    rowFieldColumn: 1,
    columnField: null,
    columnFieldColumn: null,
    valueField: "Sales",
    valueFieldColumn: 2,
    summarizeBy: "SUM",
  },
};

describe("history registry", () => {
  beforeEach(() => {
    clearHistory("wb-a");
    clearHistory("wb-b");
  });

  it("snapshots cells, formulas, rules and pivot without sharing references", () => {
    const snapshot = snapshotSheet(sheet);
    expect(snapshot.cells.B1).toEqual({ value: "5", formula: "=1+4" });
    expect(snapshot.validationRules).toHaveLength(1);
    expect(snapshot.pivot?.sourceRange).toEqual({ start: { row: 1, column: 1 }, end: { row: 2, column: 2 } });

    // Mutating the captured snapshot must not affect the original sheet.
    snapshot.cells.A1 = { value: "Changed" };
    snapshot.validationRules?.pop();
    expect(sheet.cells.A1.value).toBe("Item");
    expect(sheet.validationRules).toHaveLength(1);
  });

  it("undo pops in reverse order and redo reapplies the same entries", () => {
    pushUndo("wb-a", entry("1"));
    pushUndo("wb-a", entry("2"));
    expect(canUndo("wb-a")).toBe(true);
    expect(popUndo("wb-a")?.before.cells.A1.value).toBe("2");
    expect(popUndo("wb-a")?.before.cells.A1.value).toBe("1");
    expect(popUndo("wb-a")).toBeNull();
    expect(canUndo("wb-a")).toBe(false);
    expect(canRedo("wb-a")).toBe(false);

    pushUndo("wb-a", entry("1"));
    const undone = popUndo("wb-a");
    expect(undone?.after.cells.A1.value).toBe("1-after");
    pushRedo("wb-a", undone as HistoryEntry);
    expect(canRedo("wb-a")).toBe(true);
    expect(popRedo("wb-a")?.after.cells.A1.value).toBe("1-after");
  });

  it("a new modification clears the redo branch", () => {
    pushUndo("wb-a", entry("1"));
    pushRedo("wb-a", entry("2"));
    expect(canRedo("wb-a")).toBe(true);
    clearRedo("wb-a");
    expect(canRedo("wb-a")).toBe(false);
    expect(canUndo("wb-a")).toBe(true);
  });

  it("keeps history separate between workbooks", () => {
    pushUndo("wb-a", entry("1"));
    expect(canUndo("wb-a")).toBe(true);
    expect(canUndo("wb-b")).toBe(false);
    expect(popUndo("wb-b")).toBeNull();
    pushUndo("wb-b", entry("2"));
    expect(canUndo("wb-b")).toBe(true);
    expect(popUndo("wb-a")?.before.cells.A1.value).toBe("1");
    expect(popUndo("wb-b")?.before.cells.A1.value).toBe("2");
  });
});
