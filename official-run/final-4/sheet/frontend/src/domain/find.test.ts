import { describe, expect, test } from "vitest";

import { findMatches, nextMatchIndex, replacementUpdates } from "./find";

const NARRATIVE = {
  E4: "Cobalt",
  E7: "Cobalt",
  E11: "Cobalt",
  D4: "Batch",
  F12: "Copper",
};

describe("findMatches", () => {
  test("matches the whole displayed value and reads the grid row by row", () => {
    expect(findMatches(NARRATIVE, "Cobalt", { matchCase: false })).toEqual(["E4", "E7", "E11"]);
  });

  test("ignores a cell that only contains the query", () => {
    expect(findMatches({ G3: "Cobalt", G4: "cobalt", G5: "Cobalt-7" }, "Cobalt", { matchCase: false })).toEqual([
      "G3",
      "G4",
    ]);
    expect(findMatches({ G3: "Cobalt", G4: "cobalt", G5: "Cobalt-7" }, "Cobalt", { matchCase: true })).toEqual(["G3"]);
  });

  test("matches nothing for an empty query", () => {
    expect(findMatches(NARRATIVE, "", { matchCase: false })).toEqual([]);
  });
});

describe("nextMatchIndex", () => {
  const matches = ["E4", "E7", "E11"];

  test("walks forward from the current cell and wraps around at the end", () => {
    expect(nextMatchIndex(matches, "A1")).toBe(0);
    expect(nextMatchIndex(matches, "E4")).toBe(1);
    expect(nextMatchIndex(matches, "E7")).toBe(2);
    expect(nextMatchIndex(matches, "E11")).toBe(0);
    expect(nextMatchIndex(matches, "E12")).toBe(0);
  });

  test("reports no match index for an empty match list", () => {
    expect(nextMatchIndex([], "A1")).toBe(-1);
  });
});

describe("replacementUpdates", () => {
  test("rewrites every matching cell and leaves the others alone", () => {
    expect(replacementUpdates(NARRATIVE, "Cobalt", "Indigo", { matchCase: false })).toEqual([
      { coordinate: "E4", value: "Indigo" },
      { coordinate: "E7", value: "Indigo" },
      { coordinate: "E11", value: "Indigo" },
    ]);
  });
});
