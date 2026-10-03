import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { installFetchStub, type StubRequest } from "../test/fetch-stub";
import { blankWorkbook, seededSummary } from "../test/fixtures";

function reset() {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
}

describe("create a blank workbook", () => {
  afterEach(reset);

  it("creates from the home page and opens the blank Sheet1 editor with A1 selected", async () => {
    const requests: StubRequest[] = [];
    installFetchStub((request) => {
      requests.push(request);
      if (request.url === "/api/workbooks" && request.method === "GET") {
        return { body: { workbooks: [seededSummary] } };
      }
      if (request.url === "/api/workbooks" && request.method === "POST") {
        return { status: 201, body: { workbook: blankWorkbook } };
      }
      if (request.url === "/api/workbooks/wb-created" && request.method === "GET") {
        return { body: { workbook: blankWorkbook } };
      }
      return { status: 404, body: { error: "Not found" } };
    });
    const user = userEvent.setup();
    window.location.hash = "#/";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
    await user.click(await screen.findByRole("button", { name: "Create" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Untitled workbook" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/workbooks/wb-created");
    expect(requests.filter((request) => request.method === "POST")).toEqual([
      { method: "POST", url: "/api/workbooks", body: { name: "" } },
    ]);

    const tab = screen.getByRole("tab", { name: "Sheet1" });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    const a1 = screen.getByRole("gridcell", { name: "A1" });
    expect(a1).toHaveAttribute("aria-selected", "true");
    expect(a1.textContent).toBe("");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("");
  });

  it("uses the entered name for the new workbook", async () => {
    const requests: StubRequest[] = [];
    installFetchStub((request) => {
      requests.push(request);
      if (request.url === "/api/workbooks" && request.method === "GET") {
        return { body: { workbooks: [seededSummary] } };
      }
      if (request.url === "/api/workbooks" && request.method === "POST") {
        return { status: 201, body: { workbook: { ...blankWorkbook, name: "Regional plan" } } };
      }
      if (request.url === "/api/workbooks/wb-created" && request.method === "GET") {
        return { body: { workbook: { ...blankWorkbook, name: "Regional plan" } } };
      }
      return { status: 404, body: { error: "Not found" } };
    });
    const user = userEvent.setup();
    window.location.hash = "#/new";
    render(<App />);

    await user.type(await screen.findByRole("textbox", { name: "Workbook name" }), "Regional plan");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Regional plan" })).toBeInTheDocument();
    expect(requests.find((request) => request.method === "POST")?.body).toEqual({ name: "Regional plan" });
  });

  it("stays retryable and shows an error when creation fails", async () => {
    installFetchStub((request) => {
      if (request.url === "/api/workbooks" && request.method === "GET") {
        return { body: { workbooks: [seededSummary] } };
      }
      if (request.url === "/api/workbooks" && request.method === "POST") {
        return { status: 500, body: { error: "Unable to create the workbook" } };
      }
      return { status: 404, body: { error: "Not found" } };
    });
    const user = userEvent.setup();
    window.location.hash = "#/new";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to create the workbook");
    expect(screen.getByRole("heading", { level: 1, name: "New workbook" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/new");
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();

    await user.click(screen.getByRole("link", { name: "Home" }));
    expect(await screen.findByRole("link", { name: "Q3 Sales" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Untitled workbook" })).toBeNull();
  });
});
