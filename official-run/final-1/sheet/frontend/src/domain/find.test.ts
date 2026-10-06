import { describe, expect, test } from "vitest";

import { findMatches, nextMatchIndex, replaceUpdates } from "./find";

const DISPLAY = {
  A1: "Cobalt",
  B4: "cobalt",
  C7: "Cobalt-7",
  D9: "Copper",
  E11: "Cobalt",
};

describe("find and replace matching", () => {
  test("matches only cells whose whole displayed value equals the text", () => {
    expect(findMatches(DISPLAY, "Cobalt", false).map((match) => match.coordinate)).toEqual(["A1", "B4", "E11"]);
    // A longer value such as `Cobalt-7` is not a match of `Cobalt`.
    expect(findMatches(DISPLAY, "Cobalt-7", false).map((match) => match.coordinate)).toEqual(["C7"]);
  });

  test("compares case-sensitively only while Match case is on", () => {
    expect(findMatches(DISPLAY, "Cobalt", true).map((match) => match.coordinate)).toEqual(["A1", "E11"]);
    expect(findMatches(DISPLAY, "cobalt", false).map((match) => match.coordinate)).toEqual(["A1", "B4", "E11"]);
    expect(findMatches(DISPLAY, "cobalt", true).map((match) => match.coordinate)).toEqual(["B4"]);
  });

  test("returns matches in grid order and nothing for an empty search", () => {
    expect(findMatches(DISPLAY, "Cobalt", false)).toEqual([
      { coordinate: "A1", row: 1, column: 1 },
      { coordinate: "B4", row: 4, column: 2 },
      { coordinate: "E11", row: 11, column: 5 },
    ]);
    expect(findMatches(DISPLAY, "", false)).toEqual([]);
    expect(findMatches(DISPLAY, "Missing", false)).toEqual([]);
  });

  test("walks to the next match in grid order and wraps around", () => {
    const matches = findMatches(DISPLAY, "Cobalt", false);
    expect(nextMatchIndex(matches, { row: 1, column: 1 })).toBe(1);
    expect(nextMatchIndex(matches, { row: 4, column: 2 })).toBe(2);
    // After the last match the search continues at the first one.
    expect(nextMatchIndex(matches, { row: 11, column: 5 })).toBe(0);
    expect(nextMatchIndex(matches, null)).toBe(0);
    expect(nextMatchIndex([], { row: 1, column: 1 })).toBe(-1);
  });

  test("builds one write per match for Replace all", () => {
    expect(replaceUpdates(findMatches(DISPLAY, "Cobalt", true), "Azure")).toEqual([
      { coordinate: "A1", value: "Azure" },
      { coordinate: "E11", value: "Azure" },
    ]);
  });
});
