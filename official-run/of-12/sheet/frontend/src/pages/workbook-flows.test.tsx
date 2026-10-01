import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { installFakeBackend, SEED_UPDATED_AT } from "../test/fake-backend";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

function renderAt(hash: string) {
  window.location.hash = hash;
  const backend = installFakeBackend();
  const view = render(<App />);
  return { ...backend, view };
}

async function openSeededEditor() {
  const harness = renderAt("#/");
  const user = userEvent.setup();
  const link = await screen.findByRole("link", { name: "Q3 Sales" });
  await user.click(link);
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
  return { ...harness, user };
}

describe("workbook home page", () => {
  it("lists the seeded workbook with a link named after it and the last updated value", async () => {
    renderAt("#/");
    const link = await screen.findByRole("link", { name: "Q3 Sales" });
    expect(link.getAttribute("href")).toBe("#/workbooks/wb-q3-sales");
    expect(screen.getByText(`Last updated: ${SEED_UPDATED_AT}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "New blank workbook" })).toBeTruthy();
  });

  it("opens the same workbook record from the visible link", async () => {
    await openSeededEditor();
    expect(screen.getByText(`Last updated: ${SEED_UPDATED_AT}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rename workbook" })).toBeTruthy();
  });
});

describe("workbook editor structure", () => {
  it("exposes worksheet tabs, the worksheet grid and selected cells with ARIA state", async () => {
    await openSeededEditor();
    const tab = screen.getByRole("tab", { name: "Sheet1" });
    expect(tab.getAttribute("aria-selected")).toBe("true");

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(grid.getAttribute("aria-multiselectable")).toBe("true");

    const a1 = within(grid).getByRole("gridcell", { name: "A1" });
    expect(a1.textContent).toBe("Region");
    expect(a1.getAttribute("aria-selected")).toBe("true");
    expect(within(grid).getByRole("gridcell", { name: "B1" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "Region");
  });

  it("is reachable directly by URL and restores the same workbook after refresh", async () => {
    const backend = renderAt("#/workbooks/wb-q3-sales");
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(screen.queryByRole("heading", { level: 1, name: "Workbooks" })).toBeNull();

    cleanup();
    backend.install();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("spreadsheet data entry through visible controls", () => {
  it("commits values typed in the formula bar and inline cell editor and keeps them after refresh", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });

    // The seeded worksheet is already on screen.
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(within(grid).getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(within(grid).getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");
    expect(within(grid).getByRole("gridcell", { name: "A3" }).textContent).toBe("North");
    expect(within(grid).getByRole("gridcell", { name: "B3" }).textContent).toBe("800");

    await user.click(within(grid).getByRole("gridcell", { name: "A2" }));
    await user.clear(formulaBar);
    await user.type(formulaBar, "West{Enter}");
    expect(within(grid).getByRole("gridcell", { name: "A2" }).textContent).toBe("West");

    await user.click(within(grid).getByRole("gridcell", { name: "B3" }));
    await user.clear(formulaBar);
    await user.type(formulaBar, "900{Enter}");

    await user.dblClick(within(grid).getByRole("gridcell", { name: "A3" }));
    const inline = screen.getByRole("textbox", { name: "Edit A3" });
    await user.clear(inline);
    await user.type(inline, "Northeast{Enter}");

    expect(within(grid).getByRole("gridcell", { name: "A3" }).textContent).toBe("Northeast");
    expect(within(grid).getByRole("gridcell", { name: "B3" }).textContent).toBe("900");
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");

    cleanup();
    backend.install();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    const refreshedGrid = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(within(refreshedGrid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(within(refreshedGrid).getByRole("gridcell", { name: "A2" }).textContent).toBe("West");
    expect(within(refreshedGrid).getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");
    expect(within(refreshedGrid).getByRole("gridcell", { name: "A3" }).textContent).toBe("Northeast");
    expect(within(refreshedGrid).getByRole("gridcell", { name: "B3" }).textContent).toBe("900");
  });

  it("keeps the previous value in the grid and formula bar when a commit is rejected", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
    backend.failNextRequest((_method, path) => path.endsWith("/cells"), { error: "Cell could not be saved" });

    await user.click(within(grid).getByRole("gridcell", { name: "A2" }));
    await user.clear(formulaBar);
    await user.type(formulaBar, "West{Enter}");

    expect(await screen.findByText("Cell could not be saved")).toBeTruthy();
    expect(formulaBar.value).toBe("East");
    expect(within(grid).getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
  });
});

describe("rectangular selection", () => {
  it("marks cells inside the region selected and persists the region after refresh", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });

    await user.click(within(grid).getByRole("gridcell", { name: "A1" }));
    await user.keyboard("{Shift>}");
    await user.click(within(grid).getByRole("gridcell", { name: "B2" }));
    await user.keyboard("{/Shift}");

    for (const coordinate of ["A1", "B1", "A2", "B2"]) {
      expect(within(grid).getByRole("gridcell", { name: coordinate }).getAttribute("aria-selected")).toBe("true");
    }
    expect(within(grid).getByRole("gridcell", { name: "C1" }).getAttribute("aria-selected")).toBe("false");
    expect(within(grid).getByRole("gridcell", { name: "A3" }).getAttribute("aria-selected")).toBe("false");

    cleanup();
    backend.install();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    const refreshedGrid = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(within(refreshedGrid).getByRole("gridcell", { name: "A2" }).getAttribute("aria-selected")).toBe("true");
    expect(within(refreshedGrid).getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe("true");
    expect(within(refreshedGrid).getByRole("gridcell", { name: "A3" }).getAttribute("aria-selected")).toBe("false");
  });
});

describe("creating a blank workbook", () => {
  it("creates from the home page and opens a blank editor with Sheet1 active and A1 selected", async () => {
    const user = userEvent.setup();
    renderAt("#/");
    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));

    const nameInput = screen.getByRole("textbox", { name: "Workbook name" }) as HTMLInputElement;
    expect(nameInput.value).toBe("Untitled workbook");
    await user.clear(nameInput);
    await user.type(nameInput, "Budget 2026");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByRole("heading", { level: 1, name: "Budget 2026" });
    const tab = screen.getByRole("tab", { name: "Sheet1" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("");
    expect(screen.queryByRole("gridcell", { name: "A2", selected: true })).toBeNull();

    await user.click(screen.getByRole("link", { name: "Back to workbooks" }));
    const links = await screen.findAllByRole("link");
    const names = links.map((link) => link.textContent);
    expect(names).toContain("Budget 2026");
    expect(names).toContain("Q3 Sales");
  });

  it("rejects an empty workbook name without creating a record", async () => {
    const backend = renderAt("#/");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
    const nameInput = screen.getByRole("textbox", { name: "Workbook name" });
    await user.clear(nameInput);
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Workbook name cannot be empty")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "New workbook" })).toBeTruthy();
    expect(backend.state.workbooks).toHaveLength(1);
  });
});

describe("renaming a workbook", () => {
  it("renames from the editor and reflects the new name in the title and on the home page", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    await user.click(screen.getByRole("button", { name: "Rename workbook" }));

    const dialog = screen.getByRole("dialog", { name: "Rename workbook" });
    const nameInput = within(dialog).getByRole("textbox", { name: "Workbook name" }) as HTMLInputElement;
    expect(nameInput.value).toBe("Q3 Sales");

    await user.clear(nameInput);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("Workbook name cannot be empty")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Q3 Sales" })).toBeTruthy();
    expect(backend.state.workbooks[0].name).toBe("Q3 Sales");

    await user.type(nameInput, "  Q3 Sales 2026  ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales 2026" });
    expect(screen.queryByRole("dialog", { name: "Rename workbook" })).toBeNull();

    cleanup();
    backend.install();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales 2026" });

    await user.click(screen.getByRole("link", { name: "Back to workbooks" }));
    await screen.findByRole("link", { name: "Q3 Sales 2026" });
    expect(screen.queryByRole("link", { name: "Q3 Sales" })).toBeNull();
  });
});
