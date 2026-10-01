import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { makeHash, parseHashLocation, useHashLocation } from "./hash-route";

function RouteProbe() {
  const { path, search } = useHashLocation();
  return createElement("p", null, `${path}|${search.get("updated") ?? ""}`);
}

afterEach(() => {
  cleanup();
  window.location.hash = "#/";
});

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

describe("hash links", () => {
  it("switches the rendered view in the same task as the activation", () => {
    window.location.hash = "#/";
    render(
      createElement(
        "div",
        null,
        createElement(RouteProbe),
        createElement("a", { href: "#/forgot-password" }, "Forgot password"),
      ),
    );
    expect(screen.getByText("/|")).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Forgot password" }));

    expect(window.location.hash).toBe("#/forgot-password");
    expect(screen.getByText("/forgot-password|")).toBeTruthy();
  });

  it("keeps the current view for modified activations", () => {
    window.location.hash = "#/";
    render(createElement("a", { href: "#/register" }, "Create an account"));

    fireEvent.click(screen.getByRole("link", { name: "Create an account" }), { ctrlKey: true });

    expect(window.location.hash).toBe("#/");
  });
});
