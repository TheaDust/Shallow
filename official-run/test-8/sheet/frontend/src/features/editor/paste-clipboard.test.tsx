import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { createMockBackend, seedWorkbook } from "../../test/mock-backend";
import type { ValidationRule } from "../../domain/types";

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

async function openEditor() {
  window.location.hash = "#/workbooks/workbook-q3-sales";
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
  return { user, view };
}

function grid(): HTMLElement {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function gridCell(name: string): HTMLElement {
  return within(grid()).getByRole("gridcell", { name });
}

function worksheet(index = 0) {
  return backend.workbooks[0].worksheets[index];
}

function pasteEvent(text: string) {
  return { clipboardData: { getData: () => text } };
}

async function selectCell(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(gridCell(name));
  await waitFor(() => expect(gridCell(name).getAttribute("aria-selected")).toBe("true"));
}

describe("pasting a clipboard table", () => {
  it("applies the whole rectangle from Ctrl+V, keeps empty fields and only overwrites the target", async () => {
    const { user } = await openEditor();
    await selectCell(user, "D1");

    fireEvent.paste(gridCell("D1"), pasteEvent("East\t1200\n\t800"));

    await waitFor(() => expect(gridCell("D1").textContent).toBe("East"));
    expect(gridCell("E1").textContent).toBe("1200");
    expect(gridCell("D2").textContent).toBe("");
    expect(gridCell("E2").textContent).toBe("800");

    // Cells outside the rectangle keep the seeded values.
    expect(gridCell("A1").textContent).toBe("Region");
    expect(gridCell("B2").textContent).toBe("1200");
    expect(gridCell("A3").textContent).toBe("North");

    await waitFor(() => expect(worksheet().cells.D1).toBe("East"));
    expect(worksheet().cells.E1).toBe("1200");
    expect(worksheet().cells.E2).toBe("800");
  });

  it("overwrites formulas inside the target and leaves the source state intact after reopen", async () => {
    const { user, view } = await openEditor();

    await selectCell(user, "D1");
    await user.type(screen.getByRole("textbox", { name: "Formula bar" }), "=B2+B3");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(gridCell("D1").textContent).toBe("2000"));

    await selectCell(user, "D2");
    fireEvent.paste(gridCell("D2"), pasteEvent("500"));

    await waitFor(() => expect(gridCell("D2").textContent).toBe("500"));
    expect(gridCell("D1").textContent).toBe("2000");
    expect(gridCell("A1").textContent).toBe("Region");

    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(gridCell("D2").textContent).toBe("500");
    expect(gridCell("D1").textContent).toBe("2000");
    expect(gridCell("B2").textContent).toBe("1200");
  });

  it("recalculates a dependent formula when the paste replaces the formula it reads", async () => {
    const { user } = await openEditor();

    // D1 starts as a formula and F1 reads it directly.
    await user.click(gridCell("D1"));
    await user.clear(screen.getByRole("textbox", { name: "Formula bar" }));
    await user.type(screen.getByRole("textbox", { name: "Formula bar" }), "=B2+B3");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(gridCell("D1").textContent).toBe("2000"));

    await user.click(gridCell("F1"));
    await user.clear(screen.getByRole("textbox", { name: "Formula bar" }));
    await user.type(screen.getByRole("textbox", { name: "Formula bar" }), "=D1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(gridCell("F1").textContent).toBe("2000"));

    // The paste replaces D1's formula with text; the dependent cell follows.
    await selectCell(user, "D1");
    fireEvent.paste(gridCell("D1"), pasteEvent("East\t1200\nNorth\t800"));

    await waitFor(() => expect(gridCell("D1").textContent).toBe("East"));
    expect(gridCell("E1").textContent).toBe("1200");
    expect(gridCell("F1").textContent).toBe("East");
    expect(gridCell("D2").textContent).toBe("North");
    expect(gridCell("E2").textContent).toBe("800");
    await waitFor(() => expect(worksheet().cells.F1).toBe("=D1"));
    expect(worksheet().cells.D1).toBe("East");
  });

  it("pastes the external clipboard through the cell context menu Paste command", async () => {
    const { user } = await openEditor();
    const readText = vi.fn().mockResolvedValue("East\t1200\nNorth\t800");
    Object.defineProperty(navigator, "clipboard", {
      value: { readText },
      configurable: true,
    });

    fireEvent.contextMenu(gridCell("D1"));
    const menu = await screen.findByRole("menu", { name: "Cell D1 menu" });
    await user.click(within(menu).getByRole("menuitem", { name: "Paste" }));

    await waitFor(() => expect(gridCell("D1").textContent).toBe("East"));
    expect(readText).toHaveBeenCalled();
    expect(gridCell("E1").textContent).toBe("1200");
    expect(gridCell("D2").textContent).toBe("North");
    expect(gridCell("E2").textContent).toBe("800");
    await waitFor(() => expect(worksheet().cells.E2).toBe("800"));
  });

  it("reports a clipboard that cannot be read", async () => {
    const { user } = await openEditor();
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    });

    fireEvent.contextMenu(gridCell("D1"));
    const menu = await screen.findByRole("menu", { name: "Cell D1 menu" });
    await user.click(within(menu).getByRole("menuitem", { name: "Paste" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/clipboard/i);
    expect(gridCell("D1").textContent).toBe("");
    expect(worksheet().cells.D1).toBeUndefined();
  });

  it("rejects the whole paste when a 0-to-100 rule covers a target cell and keeps every value", async () => {
    backend.workbooks[0].worksheets[0].validations = [
      {
        id: "rule-e1",
        type: "numeric",
        min: 0,
        max: 100,
        range: { minRow: 0, maxRow: 0, minCol: 4, maxCol: 4 },
      },
    ] satisfies ValidationRule[];
    const { user } = await openEditor();
    await selectCell(user, "D1");

    fireEvent.paste(gridCell("D1"), pasteEvent("East\t1200\nNorth\t800"));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Please enter a number from 0 to 100"),
    );
    // No partial record: every target cell keeps its original (empty) value.
    expect(gridCell("D1").textContent).toBe("");
    expect(gridCell("E1").textContent).toBe("");
    expect(gridCell("D2").textContent).toBe("");
    expect(gridCell("E2").textContent).toBe("");
    expect(worksheet().cells.D1).toBeUndefined();
    expect(worksheet().cells.A2).toBe("East");
    expect(worksheet().cells.B2).toBe("1200");

    // A pasted value inside the rule still applies.
    fireEvent.paste(gridCell("D1"), pasteEvent("East\t100"));
    await waitFor(() => expect(gridCell("E1").textContent).toBe("100"));
    expect(gridCell("D1").textContent).toBe("East");
  });

  it("leaves the grid untouched when the clipboard holds no fields", async () => {
    const { user } = await openEditor();
    await selectCell(user, "D1");

    fireEvent.paste(gridCell("D1"), pasteEvent(""));

    expect(gridCell("D1").textContent).toBe("");
    expect(worksheet().cells.D1).toBeUndefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the formula bar's own paste behaviour while it has focus", async () => {
    const { user } = await openEditor();
    await selectCell(user, "D1");
    const bar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.click(bar);

    fireEvent.paste(bar, pasteEvent("East\t1200\nNorth\t800"));

    expect(gridCell("D1").textContent).toBe("");
    expect(worksheet().cells.D1).toBeUndefined();
  });
});
