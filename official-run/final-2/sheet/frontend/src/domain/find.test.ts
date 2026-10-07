import { expect, test } from "vitest";

import { findMatches, matchStatus, nextMatchIndex, replacedStatus } from "./find";

test("matches whole displayed values in reading order and honours the case flag", () => {
  const cells = { B1: "Cobalt", D1: "cobalt", B3: "Cobalt-7", D3: "Cobalt" };
  expect(findMatches(cells, "Cobalt", true).map((match) => match.coordinate)).toEqual(["B1", "D3"]);
  expect(findMatches(cells, "cobalt", false).map((match) => match.coordinate)).toEqual(["B1", "D1", "D3"]);
  // A partial value never matches, and an empty search text matches nothing.
  expect(findMatches(cells, "Cobalt-7", false).map((match) => match.coordinate)).toEqual(["B3"]);
  expect(findMatches(cells, "", false)).toEqual([]);
});

test("a formula cell matches through its calculated result", () => {
  const cells = { A1: "12", B1: "=A1*2", C1: "=B1" };
  expect(findMatches(cells, "24", true).map((match) => match.coordinate)).toEqual(["B1", "C1"]);
});

test("find next walks in reading order and wraps back to the first match", () => {
  const matches = findMatches({ B1: "x", D1: "x", B3: "x" }, "x", true);
  expect(matches.map((match) => match.coordinate)).toEqual(["B1", "D1", "B3"]);
  expect(nextMatchIndex(matches, "A1")).toBe(0);
  expect(nextMatchIndex(matches, "B1")).toBe(1);
  expect(nextMatchIndex(matches, "C1")).toBe(1);
  expect(nextMatchIndex(matches, "D1")).toBe(2);
  // Past the last match the search starts over from the first one.
  expect(nextMatchIndex(matches, "D3")).toBe(0);
  expect(nextMatchIndex(matches, "not-a-cell")).toBe(0);
});

test("status lines name the reached match and the number of replaced cells", () => {
  expect(matchStatus(2, 3)).toBe("Match 2 of 3");
  expect(replacedStatus(3)).toBe("Replaced 3 cells");
  expect(replacedStatus(1)).toBe("Replaced 1 cells");
});
