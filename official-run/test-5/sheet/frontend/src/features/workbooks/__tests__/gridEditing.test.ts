import { describe, expect, it } from "vitest";

import { cellEditorLabel, cellMenuLabel, parseClipboardTable, tableToCellUpdates } from "../gridEditing";
import { selectionFromWorksheet, sameSelection, selectionStart } from "../selection";

describe("clipboard tables", () => {
  it("splits tab-separated columns and newline-separated rows", () => {
    expect(parseClipboardTable("East\t1200\nNorth\t800")).toEqual([
      ["East", "1200"],
      ["North", "800"],
    ]);
  });

  it("treats the last newline as a row terminator and keeps empty fields", () => {
    expect(parseClipboardTable("East\t1200\nNorth\t800\n")).toEqual([
      ["East", "1200"],
      ["North", "800"],
    ]);
    expect(parseClipboardTable("East\t\t800")).toEqual([["East", "", "800"]]);
    expect(parseClipboardTable("a\r\nb\rc")).toEqual([["a"], ["b"], ["c"]]);
    expect(parseClipboardTable("")).toEqual([]);
  });

  it("places the table with its first cell at the starting cell", () => {
    expect(tableToCellUpdates("D1", [["East", "1200"], ["North", "800"]])).toEqual({
      D1: "East",
      E1: "1200",
      D2: "North",
      E2: "800",
    });
    expect(tableToCellUpdates("E3", [["x", "y"]])).toEqual({ E3: "x", F3: "y" });
    expect(tableToCellUpdates("nope", [["x"]])).toBeNull();
    expect(tableToCellUpdates("D1", [])).toBeNull();
  });

  it("names the inline text box and the cell menu after the coordinate", () => {
    expect(cellEditorLabel("D1")).toBe("Edit D1");
    expect(cellMenuLabel("D1")).toBe("Cell D1 menu");
  });
});

describe("stored selections", () => {
  it("restores the complete rectangle and falls back to the single active cell", () => {
    expect(selectionFromWorksheet({ activeCell: "B2", selectionFocus: "C3" })).toEqual({ anchor: "B2", focus: "C3" });
    expect(selectionFromWorksheet({ activeCell: "B2" })).toEqual({ anchor: "B2", focus: "B2" });
    expect(selectionFromWorksheet({})).toEqual({ anchor: "A1", focus: "A1" });
  });

  it("compares rectangles by both corners and names their top-left corner", () => {
    expect(sameSelection({ anchor: "A1", focus: "A1" }, { anchor: "A1", focus: "A1" })).toBe(true);
    expect(sameSelection({ anchor: "A1", focus: "A1" }, { anchor: "A1", focus: "B2" })).toBe(false);
    expect(selectionStart({ anchor: "C3", focus: "B2" })).toBe("B2");
    expect(selectionStart({ anchor: "D4", focus: "D4" })).toBe("D4");
  });
});
