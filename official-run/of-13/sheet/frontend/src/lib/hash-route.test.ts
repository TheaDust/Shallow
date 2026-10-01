import { describe, expect, it } from "vitest";

import { makeHash, parseHashLocation } from "./hash-route";

describe("hash route utilities", () => {
  it("normalizes an empty location to the root", () => {
    expect(parseHashLocation("").path).toBe("/");
  });

  it("preserves a stable path and query", () => {
    const location = parseHashLocation("#/items/42?tab=activity");
    expect(location.path).toBe("/items/42");
    expect(location.search.get("tab")).toBe("activity");
    expect(makeHash(location.path, location.search)).toBe("#/items/42?tab=activity");
  });
});
