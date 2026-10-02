import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { installFakeBackend, seedWorkbook, type FakeBackend } from "./test/fake-backend";

const secondWorkbook = seedWorkbook({
  id: "other-book",
  name: "Other Book",
  updatedAt: "2026-08-01T08:00:00.000Z",
  activeWorksheetId: "other-book-sheet1",
  worksheets: [
    { id: "other-book-sheet1", name: "Sheet1", rowCount: 20, columnCount: 8, cells: { A1: "Other workbook data" } },
  ],
  selections: { "other-book-sheet1": { row: 0, col: 0 } },
});

describe("workbook home page", () => {
  let backend: FakeBackend;

  beforeEach(() => {
    backend = installFakeBackend([seedWorkbook(), secondWorkbook]);
    vi.stubGlobal("fetch", backend.fetch);
    window.location.hash = "";
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists each workbook with a name link and its last updated value", async () => {
    render(<App />);

    const link = await screen.findByRole("link", { name: "Q3 Sales" });
    expect(link.getAttribute("href")).toBe("#/workbooks/q3-sales");
    expect(screen.getByText("Last updated: 2026-09-29 09:15 UTC")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Other Book" })).toBeTruthy();
    expect(screen.getByText("Last updated: 2026-08-01 08:00 UTC")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New blank workbook" })).toBeTruthy();
  });

  it("opens the seeded workbook in the editor through the visible link", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Q3 Sales" })).toBeTruthy();
    expect(window.location.hash).toBe("#/workbooks/q3-sales");
    expect(screen.getByText("Last updated: 2026-09-29 09:15 UTC")).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    // Data from another workbook must never leak into the current grid.
    expect(screen.queryByText("Other workbook data")).toBeNull();
  });

  it("opens the editor directly from its own URL without visiting the home page", async () => {
    window.location.hash = "#/workbooks/q3-sales";
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Q3 Sales" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
  });

  it("creates a blank workbook from the creation page and lists it on the home page", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
    const nameInput = await screen.findByRole("textbox", { name: "Workbook name" });
    await user.type(nameInput, "Budget plan");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Budget plan" })).toBeTruthy();
    const editorHash = window.location.hash;
    expect(editorHash).toMatch(/^#\/workbooks\/budget-plan-[a-z0-9]+$/);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1"]);
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    const a1 = screen.getByRole("gridcell", { name: "A1" });
    expect(a1.getAttribute("aria-selected")).toBe("true");
    expect(a1.textContent).toBe("");

    await user.click(screen.getByRole("link", { name: "Workbooks" }));

    const link = await screen.findByRole("link", { name: "Budget plan" });
    expect(link.getAttribute("href")).toBe(editorHash);
    expect(screen.getByRole("link", { name: "Q3 Sales" })).toBeTruthy();
    expect(backend.workbooks.map((workbook) => workbook.name)).toEqual(["Q3 Sales", "Other Book", "Budget plan"]);
  });

  it("enters the editor URL before the create request settles so a refresh keeps the workbook", async () => {
    // Keep the create request in flight so the app cannot clean the URL up yet.
    const held = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if ((init.method ?? "GET").toUpperCase() === "POST") return new Promise<Response>(() => {});
      return backend.fetch(input, init);
    }) as typeof fetch;
    vi.stubGlobal("fetch", held);

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
    await user.type(await screen.findByRole("textbox", { name: "Workbook name" }), "Reload proof");
    await user.click(screen.getByRole("button", { name: "Create" }));

    // Submitting already moved the browser to the workbook URL (the request is still open).
    expect(window.location.hash).toMatch(/^#\/workbooks\/reload-proof-[a-z0-9]+\?new=1&name=Reload\+proof$/);
    expect(screen.getByRole("status").textContent).toBe("Creating workbook…");
  });

  it("creates the workbook when a pending creation URL is opened or refreshed", async () => {
    window.location.hash = "#/workbooks/fresh-book-9a1b2c?new=1&name=Fresh%20Book";
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Fresh Book" })).toBeTruthy();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1"]);
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");
    // The pending marker is dropped once the workbook exists.
    expect(window.location.hash).toBe("#/workbooks/fresh-book-9a1b2c");
    expect(backend.workbooks.map((workbook) => workbook.name)).toEqual(["Q3 Sales", "Other Book", "Fresh Book"]);
  });

  it("keeps the created workbook after a fresh page render", async () => {
    const user = userEvent.setup();
    const view = render(<App />);

    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
    await user.type(await screen.findByRole("textbox", { name: "Workbook name" }), "Budget plan");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByRole("heading", { level: 1, name: "Budget plan" });
    const editorHash = window.location.hash;

    view.unmount();
    window.location.hash = "";
    render(<App />);

    const link = await screen.findByRole("link", { name: "Budget plan" });
    expect(link.getAttribute("href")).toBe(editorHash);

    await user.click(link);
    expect(await screen.findByRole("heading", { level: 1, name: "Budget plan" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
  });

  it("shows an error without creating a record when creation fails", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
    backend.fetch = (async () => ({
      ok: false,
      status: 500,
      headers: { get: () => "application/json" },
      json: async () => ({ error: "Creation failed" }),
      text: async () => JSON.stringify({ error: "Creation failed" }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", backend.fetch);

    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
    expect(backend.workbooks).toHaveLength(2);
    expect(backend.workbooks.map((workbook) => workbook.name)).toEqual(["Q3 Sales", "Other Book"]);
  });

  it("imports a UTF-8 CSV into a new workbook from the Import CSV dialog", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Import CSV" }));
    expect(await screen.findByRole("dialog", { name: "Import CSV" })).toBeTruthy();
    const fileInput = screen.getByLabelText("CSV file");
    expect(fileInput).toHaveProperty("type", "file");

    const file = new File([
      '区域,备注\nEast,"1,200"\nNorth,"line1\nline2"',
    ], "sales data.csv", { type: "text/csv" });
    await user.upload(fileInput as HTMLInputElement, file);
    await user.click(screen.getByRole("button", { name: "Confirm import" }));

    expect(await screen.findByRole("heading", { level: 1, name: "sales data" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("区域");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("1,200");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toBe("line1\nline2");
    expect(window.location.hash).toBe("#/workbooks/sales-data");

    await user.click(screen.getByRole("link", { name: "Workbooks" }));
    expect(await screen.findByRole("link", { name: "sales data" })).toBeTruthy();
  });

  it("rejects invalid CSV without creating a workbook and keeps the dialog open", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Import CSV" }));
    const fileInput = screen.getByLabelText("CSV file");
    await user.upload(fileInput as HTMLInputElement, new File(['a,b\n"unterminated'], "broken.csv", { type: "text/csv" }));
    await user.click(screen.getByRole("button", { name: "Confirm import" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Invalid CSV file format. Import failed.",
    );
    expect(screen.getByRole("dialog", { name: "Import CSV" })).toBeTruthy();
    expect(window.location.hash).toBe("");
    expect(backend.workbooks.map((workbook) => workbook.name)).toEqual(["Q3 Sales", "Other Book"]);
    expect(screen.queryByRole("link", { name: "broken" })).toBeNull();
  });
});
