import { describe, expect, it } from "vitest";

import { parseClipboardTable } from "./clipboard";

describe("parseClipboardTable", () => {
  it("splits tab separated columns and newline separated rows", () => {
    expect(parseClipboardTable("East\t1200\nNorth\t800")).toEqual([
      ["East", "1200"],
      ["North", "800"],
    ]);
  });

  it("keeps empty fields inside the rectangle", () => {
    expect(parseClipboardTable("East\t\n\t800")).toEqual([
      ["East", ""],
      ["", "800"],
    ]);
  });

  it("treats a trailing line break as the end of the last row", () => {
    expect(parseClipboardTable("East\t1200\nNorth\t800\n")).toEqual([
      ["East", "1200"],
      ["North", "800"],
    ]);
  });

  it("accepts Windows and classic Mac line breaks", () => {
    expect(parseClipboardTable("a\tb\r\nc\td\r")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("parses a single value into a one cell table and ignores empty text", () => {
    expect(parseClipboardTable("East")).toEqual([["East"]]);
    expect(parseClipboardTable("")).toEqual([]);
    expect(parseClipboardTable("\n")).toEqual([]);
  });
});
