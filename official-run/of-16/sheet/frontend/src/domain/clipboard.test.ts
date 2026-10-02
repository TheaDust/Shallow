import { describe, expect, it } from "vitest";

import { parseClipboardTable, tableToCellPatch } from "./clipboard";

describe("clipboard table parsing", () => {
  it("splits tab-separated columns and newline-separated rows", () => {
    expect(parseClipboardTable("East\t1200\nNorth\t800")).toEqual([
      ["East", "1200"],
      ["North", "800"],
    ]);
  });

  it("keeps empty fields including leading, middle and trailing ones", () => {
    expect(parseClipboardTable("\t1200\t\n800\t\t")).toEqual([
      ["", "1200", ""],
      ["800", "", ""],
    ]);
  });

  it("accepts CRLF and a single trailing line break without adding a row", () => {
    expect(parseClipboardTable("East\t1200\r\nNorth\t800\r\n")).toEqual([
      ["East", "1200"],
      ["North", "800"],
    ]);
    expect(parseClipboardTable("")).toEqual([]);
  });
});

describe("clipboard table to cell patch", () => {
  it("maps the rectangle from the starting cell and clears empty fields", () => {
    const patch = tableToCellPatch(
      { row: 0, col: 3 },
      [
        ["East", "1200"],
        ["North", ""],
      ],
    );
    expect(patch).toEqual({ D1: "East", E1: "1200", D2: "North", E2: null });
  });
});
