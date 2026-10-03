import { describe, expect, it } from "vitest";

import { clipboardUpdates, parseClipboardTable } from "./clipboard";

describe("clipboard table parsing", () => {
  it("splits tab separated columns and newline separated rows", () => {
    expect(parseClipboardTable("East\t1200\nNorth\t800")).toEqual([
      ["East", "1200"],
      ["North", "800"],
    ]);
  });

  it("drops one trailing newline and normalises CRLF", () => {
    expect(parseClipboardTable("East\t1200\r\nNorth\t800\r\n")).toEqual([
      ["East", "1200"],
      ["North", "800"],
    ]);
  });

  it("preserves empty fields and pads shorter rows", () => {
    expect(parseClipboardTable("a\t\tb")).toEqual([["a", "", "b"]]);
    expect(parseClipboardTable("a\tb\nc")).toEqual([
      ["a", "b"],
      ["c", ""],
    ]);
    expect(parseClipboardTable("")).toEqual([]);
  });

  it("maps the rectangle onto coordinates starting at the given cell", () => {
    expect(clipboardUpdates("East\t1200\nNorth\t800", "B2")).toEqual([
      { name: "B2", input: "East" },
      { name: "C2", input: "1200" },
      { name: "B3", input: "North" },
      { name: "C3", input: "800" },
    ]);
  });

  it("writes a single value and reports when there is nothing to paste", () => {
    expect(clipboardUpdates("East", "D1")).toEqual([{ name: "D1", input: "East" }]);
    expect(clipboardUpdates("", "D1")).toBeNull();
    expect(clipboardUpdates("East", "not-a-cell")).toBeNull();
  });
});
