import { describe, expect, it } from "vitest";

import {
  clearClipboardBuffer,
  getClipboardBuffer,
  parsePasteText,
  serializePasteText,
  setClipboardBuffer,
  setLastExternalText,
  getLastExternalText,
} from "./clipboard";

describe("clipboard domain", () => {
  it("parses tab/newline text into rows and columns, preserving empty fields", () => {
    expect(parsePasteText("East\t1200\nNorth\t800")).toEqual([
      ["East", "1200"],
      ["North", "800"],
    ]);
    expect(parsePasteText("a\t\tb\nc\n")).toEqual([
      ["a", "", "b"],
      ["c"],
    ]);
    expect(parsePasteText("")).toEqual([]);
  });

  it("serializes rows back to tab/newline text", () => {
    expect(serializePasteText([["East", "1200"], ["North", "800"]])).toBe("East\t1200\nNorth\t800");
  });

  it("stores the internal clipboard buffer and last external text", () => {
    clearClipboardBuffer();
    expect(getClipboardBuffer()).toBeNull();
    setClipboardBuffer({ sheetId: "s1", source: { start: { row: 1, column: 1 }, end: { row: 2, column: 2 } }, mode: "copy" });
    expect(getClipboardBuffer()?.sheetId).toBe("s1");
    clearClipboardBuffer();
    expect(getClipboardBuffer()).toBeNull();

    setLastExternalText("East\t1200");
    expect(getLastExternalText()).toBe("East\t1200");
    setLastExternalText(null);
    expect(getLastExternalText()).toBeNull();
  });
});
