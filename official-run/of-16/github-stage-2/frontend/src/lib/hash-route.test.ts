import { describe, expect, it } from "vitest";

import { makeHash, matchPath, parseHashLocation } from "./hash-route";

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

describe("path matching", () => {
  it("extracts the parameters of a nested route", () => {
    expect(matchPath("/organizations/:slug/repositories/:name", "/organizations/acme-demo/repositories/acme-docs"))
      .toEqual({ slug: "acme-demo", name: "acme-docs" });
    expect(matchPath("/organizations/:slug", "/organizations/acme-demo")).toEqual({ slug: "acme-demo" });
  });

  it("rejects a different depth or a different literal segment", () => {
    expect(matchPath("/organizations/:slug/repositories/:name", "/organizations/acme-demo")).toBeNull();
    expect(matchPath("/organizations/:slug", "/settings/password")).toBeNull();
  });
});
