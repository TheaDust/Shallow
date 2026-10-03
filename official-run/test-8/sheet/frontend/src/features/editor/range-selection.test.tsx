import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { createMockBackend, seedWorkbook } from "../../test/mock-backend";
import type { CellSelection } from "../../domain/types";

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

function selectedState(...names: string[]): string[] {
  return names.map((name) => gridCell(name).getAttribute("aria-selected") ?? "missing");
}

function worksheet(index = 0) {
  return backend.workbooks[0].worksheets[index];
}

async function dragRange(user: ReturnType<typeof userEvent.setup>, from: string, to: string) {
  await user.pointer([
    { keys: "[MouseLeft>]", target: gridCell(from) },
    { target: gridCell(to) },
    { keys: "[/MouseLeft]" },
  ]);
}

describe("grid selection state", () => {
  it("exposes the grid as a multi-selectable grid and marks the rectangle", async () => {
    await openEditor();
    expect(grid().getAttribute("aria-multiselectable")).toBe("true");
    expect(selectedState("A1", "B1", "A2", "B2")).toEqual(["true", "false", "false", "false"]);
  });

  it("replaces the previous selection when another cell is clicked", async () => {
    const { user } = await openEditor();

    await user.click(gridCell("D2"));

    await waitFor(() => expect(selectedState("D2")).toEqual(["true"]));
    expect(selectedState("A1", "C2", "E2")).toEqual(["false", "false", "false"]);
    await waitFor(() =>
      expect(worksheet().selection).toEqual({
        anchor: { row: 1, col: 3 },
        focus: { row: 1, col: 3 },
      }),
    );
  });

  it("selects a rectangle by dragging between two corners and persists the whole rectangle", async () => {
    const { user, view } = await openEditor();

    await dragRange(user, "D1", "E2");

    await waitFor(() =>
      expect(selectedState("D1", "E1", "D2", "E2")).toEqual(["true", "true", "true", "true"]),
    );
    expect(selectedState("C1", "C2", "F1", "D3")).toEqual(["false", "false", "false", "false"]);
    await waitFor(() =>
      expect(worksheet().selection).toEqual({
        anchor: { row: 0, col: 3 },
        focus: { row: 1, col: 4 },
      }),
    );

    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });

    expect(selectedState("D1", "E1", "D2", "E2")).toEqual(["true", "true", "true", "true"]);
    expect(selectedState("A1", "F2")).toEqual(["false", "false"]);
  });

  it("keeps each worksheet's own rectangle when switching tabs", async () => {
    const { user, view } = await openEditor();

    await dragRange(user, "D1", "E2");
    await waitFor(() =>
      expect(worksheet(0).selection).toEqual({
        anchor: { row: 0, col: 3 },
        focus: { row: 1, col: 4 },
      }),
    );

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await waitFor(() => expect(selectedState("A1")).toEqual(["true"]));
    await user.click(gridCell("B2"));
    await waitFor(() =>
      expect(worksheet(1).selection).toEqual({
        anchor: { row: 1, col: 1 },
        focus: { row: 1, col: 1 },
      }),
    );

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(selectedState("D1", "E2")).toEqual(["true", "true"]));
    expect(selectedState("B2")).toEqual(["false"]);

    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(selectedState("D1", "E1", "D2", "E2")).toEqual(["true", "true", "true", "true"]);
    expect(worksheet(1).selection).toEqual({
      anchor: { row: 1, col: 1 },
      focus: { row: 1, col: 1 },
    });
  });

  it("selects exactly the dragged rectangle without expanding into adjacent data", async () => {
    const { user } = await openEditor();

    await dragRange(user, "A1", "A2");

    await waitFor(() => expect(selectedState("A1", "A2")).toEqual(["true", "true"]));
    // B1/B2 hold seeded data but stay outside the requested rectangle.
    expect(selectedState("B1", "B2", "A3")).toEqual(["false", "false", "false"]);
    await waitFor(() =>
      expect(worksheet().selection).toEqual({
        anchor: { row: 0, col: 0 },
        focus: { row: 1, col: 0 },
      }),
    );
  });

  it("moves and extends the selection with the arrow keys", async () => {
    const { user } = await openEditor();
    await user.click(gridCell("D1"));

    await user.keyboard("{ArrowDown}{Shift>}{ArrowRight}{/Shift}");

    await waitFor(() => {
      const selection: CellSelection = worksheet().selection;
      expect(selection.anchor).toEqual({ row: 1, col: 3 });
      expect(selection.focus).toEqual({ row: 1, col: 4 });
    });
    expect(selectedState("D2", "E2")).toEqual(["true", "true"]);
    expect(selectedState("D1", "E3")).toEqual(["false", "false"]);
  });
});

describe("cell context menu", () => {
  it("opens on a cell and keeps the structure menus working", async () => {
    const { user } = await openEditor();

    fireEvent.contextMenu(gridCell("D1"));
    const menu = await screen.findByRole("menu", { name: "Cell D1 menu" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Copy", "Cut", "Paste"]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    const header = within(grid()).getByRole("rowheader", { name: "1" });
    fireEvent.contextMenu(header);
    const rowMenu = await screen.findByRole("menu", { name: "Row 1 menu" });
    expect(within(rowMenu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Insert 1 row above",
      "Insert 1 row below",
      "Delete row",
    ]);
  });
});
