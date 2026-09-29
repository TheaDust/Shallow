import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../../App";
import { SEED_UPDATED_TEXT, stubFetch, summaryFixture, workbookFixture } from "./helpers";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  window.location.hash = "";
});

describe("application routing", () => {
  it("opens the workbook entry directly in a fresh session and keeps the same last updated value", async () => {
    const user = userEvent.setup();
    const { calls } = stubFetch((request) => {
      if (request.method === "GET" && request.path === "/api/workbooks") {
        return { body: { workbooks: [summaryFixture()] } };
      }
      if (request.method === "GET" && request.path === "/api/workbooks/wb-q3-sales") {
        return { body: { workbook: workbookFixture() } };
      }
      return undefined;
    });
    render(<App />);

    const link = await screen.findByRole("link", { name: "Q3 Sales" });
    const homeUpdated = screen.getByText(`Last updated: ${SEED_UPDATED_TEXT}`).textContent;
    expect(window.location.hash).toBe("");

    await user.click(link);

    expect(await screen.findByRole("heading", { name: "Q3 Sales" })).toBeTruthy();
    expect(screen.getByText(homeUpdated ?? "")).toBeTruthy();
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(calls.some((call) => call.path === "/api/workbooks/wb-q3-sales")).toBe(true);
  });

  it("restores the exact workbook entry from the address without visiting the home page", async () => {
    window.location.hash = "#/workbooks/wb-q3-sales";
    const { calls } = stubFetch((request) =>
      request.method === "GET" && request.path === "/api/workbooks/wb-q3-sales"
        ? { body: { workbook: workbookFixture() } }
        : undefined,
    );
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Q3 Sales" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    expect(calls.some((call) => call.path === "/api/workbooks" && call.method === "GET")).toBe(false);
  });

  it("falls back to the workbook home page for an unknown entry", async () => {
    window.location.hash = "#/not-a-page";
    stubFetch((request) =>
      request.method === "GET" && request.path === "/api/workbooks"
        ? { body: { workbooks: [summaryFixture()] } }
        : undefined,
    );
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Workbooks" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Q3 Sales" })).toBeTruthy();
  });

  it("returns to the home page with the updated record after leaving the editor", async () => {
    const user = userEvent.setup();
    stubFetch((request) => {
      if (request.method === "GET" && request.path === "/api/workbooks/wb-new") {
        return { body: { workbook: workbookFixture({ id: "wb-new", name: "Budget" }) } };
      }
      if (request.method === "GET" && request.path === "/api/workbooks") {
        return { body: { workbooks: [summaryFixture({ id: "wb-new", name: "Budget" })] } };
      }
      return undefined;
    });
    window.location.hash = "#/workbooks/wb-new";
    render(<App />);

    await screen.findByRole("heading", { name: "Budget" });
    await user.click(screen.getByRole("link", { name: "All workbooks" }));

    expect(await screen.findByRole("link", { name: "Budget" })).toBeTruthy();
    expect(screen.queryByRole("grid")).toBeNull();
  });
});
