import { expect, test } from "vitest";

import {
  adjustFormulaText,
  adjustRows,
  areaOfRegion,
  formatClipboardText,
  parseClipboardText,
  rectangleCells,
  rowsFromRegion,
} from "./clipboard";

test("parses tab-separated columns and newline-separated rows", () => {
  expect(parseClipboardText("East\t1200\nNorth\t800")).toEqual([
    ["East", "1200"],
    ["North", "800"],
  ]);
});

test("preserves empty fields and tolerates CRLF plus one trailing newline", () => {
  expect(parseClipboardText("X\t\r\n\tY\r\n")).toEqual([
    ["X", ""],
    ["", "Y"],
  ]);
});

test("maps the parsed matrix onto a rectangle starting at the target cell", () => {
  expect(rectangleCells("D1", parseClipboardText("East\t1200\nNorth\t800"))).toEqual([
    { coordinate: "D1", value: "East" },
    { coordinate: "E1", value: "1200" },
    { coordinate: "D2", value: "North" },
    { coordinate: "E2", value: "800" },
  ]);
});

test("keeps empty fields so the paste can overwrite them", () => {
  expect(rectangleCells("B2", [["", "4"]])).toEqual([
    { coordinate: "B2", value: "" },
    { coordinate: "C2", value: "4" },
  ]);
});

test("reads a rectangle of raw cell texts and describes its area", () => {
  const cells = { A1: "Region", B1: "Sales", A2: "East", B2: "1200" };
  expect(rowsFromRegion(cells, { top: 1, left: 1, bottom: 2, right: 2 })).toEqual([
    ["Region", "Sales"],
    ["East", "1200"],
  ]);
  expect(rowsFromRegion(cells, { top: 3, left: 5, bottom: 3, right: 5 })).toEqual([[""]]);
  expect(areaOfRegion({ top: 1, left: 1, bottom: 2, right: 2 })).toBe("A1:B2");
  expect(areaOfRegion({ top: 4, left: 4, bottom: 4, right: 4 })).toBe("D4");
});

test("formats a matrix back into tab-separated clipboard text", () => {
  expect(formatClipboardText([["a", "b"], ["c", ""]])).toBe("a\tb\nc\t");
});

test("shifts relative references and keeps absolute ones when copying a formula", () => {
  expect(adjustFormulaText("=B2+B3", 1, 0)).toBe("=B3+B4");
  expect(adjustFormulaText("=B2+B3", 0, 2)).toBe("=D2+D3");
  expect(adjustFormulaText("=$B$2+B$3+$B4", 1, 1)).toBe("=$B$2+C$3+$B5");
  expect(adjustFormulaText("=SUM(A1:B2)*2", 2, 3)).toBe("=SUM(D3:E4)*2");
  expect(adjustFormulaText("=SUM(A1:B2)", 0, 0)).toBe("=SUM(A1:B2)");
  expect(adjustFormulaText("plain text", 1, 1)).toBe("plain text");
  // A reference pushed above row 1 or left of column A becomes a reference error.
  expect(adjustFormulaText("=A1+1", -1, 0)).toBe("=#REF!+1");
  expect(adjustFormulaText("=A1+1", 0, -1)).toBe("=#REF!+1");
  // A number's exponent is not mistaken for a reference.
  expect(adjustFormulaText("=1E5+B2", 1, 0)).toBe("=1E5+B3");
});

test("adjusts only formula cells of a copied matrix", () => {
  expect(adjustRows([["=B2", "4"], ["x", "=SUM(A1:A2)"]], 1, 0)).toEqual([
    ["=B3", "4"],
    ["x", "=SUM(A2:A3)"],
  ]);
});
