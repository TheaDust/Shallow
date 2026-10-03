import { describe, expect, it } from "vitest";

import { hasClipboardTable, parseClipboardTable } from "./paste";

describe("parseClipboardTable", () => {
  it("splits columns on tabs and rows on line breaks", () => {
    expect(parseClipboardTable("East\t1200\nNorth\t800")).toEqual([
      ["East", "1200"],
      ["North", "800"],
    ]);
  });

  it("preserves empty fields inside the rectangle", () => {
    expect(parseClipboardTable("East\t\tNorth\n\t800\t")).toEqual([
      ["East", "", "North"],
      ["", "800", ""],
    ]);
  });

  it("ignores a single trailing line break", () => {
    expect(parseClipboardTable("East\t1200\n")).toEqual([["East", "1200"]]);
    expect(parseClipboardTable("East\t1200")).toEqual([["East", "1200"]]);
  });

  it("normalizes CRLF line breaks", () => {
    expect(parseClipboardTable("East\t1200\r\nNorth\t800\r\n")).toEqual([
      ["East", "1200"],
      ["North", "800"],
    ]);
  });

  it("returns no rows for empty text", () => {
    expect(parseClipboardTable("")).toEqual([]);
    expect(hasClipboardTable([])).toBe(false);
    expect(hasClipboardTable(parseClipboardTable("East"))).toBe(true);
  });
});
