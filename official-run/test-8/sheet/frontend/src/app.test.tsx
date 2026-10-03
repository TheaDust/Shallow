import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { createMockBackend, seedWorkbook } from "./test/mock-backend";

const SEED_UPDATED_AT = "Last updated: 2024-07-01T09:00:00.000Z";

let backend: ReturnType<typeof createMockBackend>;

beforeEach(() => {
  backend = createMockBackend([seedWorkbook()]);
  vi.stubGlobal("fetch", backend.fetchImpl);
  window.location.hash = "#/";
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("workbook home page", () => {
  it("lists each workbook with its last updated value and a link named after the workbook", async () => {
    render(<App />);

    const link = await screen.findByRole("link", { name: "Q3 Sales" });
    expect(link.getAttribute("href")).toBe("#/workbooks/workbook-q3-sales");
    expect(screen.getByText(SEED_UPDATED_AT)).not.toBeNull();
    expect(screen.getByRole("button", { name: "New blank workbook" })).not.toBeNull();
  });

  it("opens the editor for the clicked workbook and shows its seeded content", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Q3 Sales" })).not.toBeNull();
    expect(window.location.hash).toBe("#/workbooks/workbook-q3-sales");
    expect(screen.getByText(SEED_UPDATED_AT)).not.toBeNull();

    const tab = screen.getByRole("tab", { name: "Sheet1" });
    expect(tab.getAttribute("aria-selected")).toBe("true");

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(grid.getAttribute("aria-multiselectable")).toBe("true");

    const a1 = within(grid).getByRole("gridcell", { name: "A1" });
    expect(a1.textContent).toBe("Region");
    expect(a1.getAttribute("aria-selected")).toBe("true");
    expect(within(grid).getByRole("gridcell", { name: "B1" }).getAttribute("aria-selected")).toBe("false");
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("Region");
  });

  it("restores the same workbook when opened directly through its entry", async () => {
    window.location.hash = "#/workbooks/workbook-q3-sales";
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Q3 Sales" })).not.toBeNull();
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
  });
});

describe("workbook creation", () => {
  it("creates a blank workbook from the home page and opens it with Sheet1 active and A1 selected", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
    const createButton = await screen.findByRole("button", { name: "Create" });
    await user.type(screen.getByRole("textbox", { name: "Workbook name" }), "Fresh Book");
    await user.click(createButton);

    expect(await screen.findByRole("heading", { level: 1, name: "Fresh Book" })).not.toBeNull();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(1);
    expect(tabs[0].textContent).toBe("Sheet1");
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");

    const a1 = screen.getByRole("gridcell", { name: "A1" });
    expect(a1.getAttribute("aria-selected")).toBe("true");
    expect(a1.textContent).toBe("");

    await waitFor(() => expect(backend.workbooks).toHaveLength(2));
    expect(backend.workbooks[1].name).toBe("Fresh Book");
  });

  it("shows the new workbook on the home page after returning", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
    await user.type(await screen.findByRole("textbox", { name: "Workbook name" }), "Fresh Book");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByRole("heading", { level: 1, name: "Fresh Book" });

    window.location.hash = "#/";

    expect(await screen.findByRole("link", { name: "Fresh Book" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Q3 Sales" })).not.toBeNull();
  });
});

describe("workbook renaming", () => {
  it("prefills the current name, rejects an empty name and saves a trimmed name", async () => {
    window.location.hash = "#/workbooks/workbook-q3-sales";
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    await user.click(screen.getByRole("button", { name: "Rename workbook" }));

    const input = (await screen.findByRole("textbox", { name: "Workbook name" })) as HTMLInputElement;
    expect(input.value).toBe("Q3 Sales");

    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Workbook name cannot be empty")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Q3 Sales");

    await user.type(input, "  Q3 Sales Final  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Q3 Sales Final"),
    );
    expect(backend.workbooks[0].name).toBe("Q3 Sales Final");
  });

  it("shows the saved name on the home page link", async () => {
    window.location.hash = "#/workbooks/workbook-q3-sales";
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    await user.click(screen.getByRole("button", { name: "Rename workbook" }));
    const input = (await screen.findByRole("textbox", { name: "Workbook name" })) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "Q3 Sales Final");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Q3 Sales Final"));

    window.location.hash = "#/";
    expect(await screen.findByRole("link", { name: "Q3 Sales Final" })).not.toBeNull();
  });
});

describe("worksheet interaction", () => {
  it("moves the selection when another cell is clicked and persists it", async () => {
    window.location.hash = "#/workbooks/workbook-q3-sales";
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    await user.click(screen.getByRole("gridcell", { name: "B2" }));

    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe("true"),
    );
    expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("false");
    await waitFor(() =>
      expect(backend.workbooks[0].worksheets[0].selection.focus).toEqual({ row: 1, col: 1 }),
    );
  });
});
