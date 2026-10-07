import { expect, test } from "vitest";

import { cellMatches, matchCoordinates, matchNumber, nextMatchCoordinate } from "./find";

test("a cell matches only when its whole text equals the find text", () => {
  expect(cellMatches("Cobalt", { find: "Cobalt", matchCase: false })).toBe(true);
  expect(cellMatches("Cobalt-7", { find: "Cobalt", matchCase: false })).toBe(false);
  expect(cellMatches("Cobalt ", { find: "Cobalt", matchCase: false })).toBe(false);
  expect(cellMatches("", { find: "", matchCase: false })).toBe(false);
  expect(cellMatches(undefined, { find: "Cobalt", matchCase: false })).toBe(false);
});

test("Match case switches the comparison between exact and case-insensitive", () => {
  expect(cellMatches("cobalt", { find: "Cobalt", matchCase: false })).toBe(true);
  expect(cellMatches("cobalt", { find: "Cobalt", matchCase: true })).toBe(false);
  expect(cellMatches("Cobalt", { find: "Cobalt", matchCase: true })).toBe(true);
});

test("matches are listed in row-major order", () => {
  const cells = { E11: "Cobalt", E4: "Cobalt", E7: "Cobalt", A1: "Other" };
  expect(matchCoordinates(cells, { find: "Cobalt", matchCase: false })).toEqual(["E4", "E7", "E11"]);
  expect(matchNumber(["E4", "E7", "E11"], "E7")).toBe(2);
});

test("Find next continues after the current cell and wraps around", () => {
  const matches = ["E4", "E7", "E11"];
  expect(nextMatchCoordinate(matches, "A1")).toBe("E4");
  expect(nextMatchCoordinate(matches, "E4")).toBe("E7");
  expect(nextMatchCoordinate(matches, "E7")).toBe("E11");
  expect(nextMatchCoordinate(matches, "E11")).toBe("E4");
  expect(nextMatchCoordinate(matches, "F12")).toBe("E4");
  expect(nextMatchCoordinate([], "A1")).toBeNull();
});
