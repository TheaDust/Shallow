import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { installFakeBackend } from "../test/fake-backend";
import type { SelectionRange } from "../lib/spreadsheet";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

type Harness = ReturnType<typeof installFakeBackend>;

function renderAt(hash: string) {
  window.location.hash = hash;
  const backend = installFakeBackend();
  const view = render(<App />);
  return { ...backend, view };
}

async function openSeededEditor() {
  const harness = renderAt("#/");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
  return { ...harness, user };
}

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function cell(coordinate: string) {
  return within(grid()).getByRole("gridcell", { name: coordinate });
}

function selectedState(coordinate: string) {
  return cell(coordinate).getAttribute("aria-selected");
}

function storedSelection(backend: Harness, worksheetId: string): SelectionRange {
  for (const workbook of backend.state.workbooks) {
    const worksheet = workbook.worksheets.find((sheet) => sheet.id === worksheetId);
    if (worksheet) return worksheet.selection;
  }
  throw new Error(`Unknown worksheet ${worksheetId}`);
}

/** Re-renders the application from a fresh mount against the same (persisted) backend state. */
function reopenEditor(backend: Harness) {
  cleanup();
  backend.install();
  window.location.hash = "#/workbooks/wb-q3-sales";
  render(<App />);
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

/** Replaces the async clipboard with a deterministic stand-in. */
function useClipboard(readText: (() => Promise<string>) | undefined) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: readText ? { readText } : undefined });
}

describe("selecting a rectangular cell range", () => {
  it("drags from one corner to the opposite cell and marks exactly that rectangle selected", async () => {
    await openSeededEditor();
    expect(grid().getAttribute("aria-multiselectable")).toBe("true");

    fireEvent.mouseDown(cell("D1"), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(cell("E2"), { clientX: 90, clientY: 60 });
    fireEvent.mouseUp(cell("E2"));

    for (const coordinate of ["D1", "E1", "D2", "E2"]) {
      expect(selectedState(coordinate)).toBe("true");
    }
    // Cells outside the rectangle stay unselected: no implicit expansion to adjacent data.
    for (const coordinate of ["C1", "C2", "D3", "E3", "F2", "A2"]) {
      expect(selectedState(coordinate)).toBe("false");
    }
  });

  it("persists the complete rectangle, restores it after refresh and keeps each worksheet's own", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    fireEvent.mouseDown(cell("A1"), { button: 0 });
    fireEvent.mouseMove(cell("B2"));
    fireEvent.mouseUp(cell("B2"));
    await waitFor(() =>
      expect(storedSelection(backend, "ws-q3-sales-sheet1")).toEqual({ anchor: "A1", focus: "B2" }));

    // Another worksheet keeps its own rectangle and never overwrites the first one.
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(await within(grid()).findByRole("gridcell", { name: "C3" }));
    await waitFor(() =>
      expect(storedSelection(backend, "ws-q3-sales-sheet2")).toEqual({ anchor: "C3", focus: "C3" }));
    expect(storedSelection(backend, "ws-q3-sales-sheet1")).toEqual({ anchor: "A1", focus: "B2" });

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await screen.findByRole("gridcell", { name: "A1" });
    expect(selectedState("A1")).toBe("true");
    expect(selectedState("B2")).toBe("true");
    expect(selectedState("C3")).toBe("false");

    // Refreshing restores the full rectangle, not just its top-left corner.
    await reopenEditor(backend);
    for (const coordinate of ["A1", "B1", "A2", "B2"]) {
      expect(selectedState(coordinate)).toBe("true");
    }
    for (const coordinate of ["B3", "C1", "A3", "C2"]) {
      expect(selectedState(coordinate)).toBe("false");
    }
  });

  it("replaces the previous selection when another cell is selected", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    fireEvent.mouseDown(cell("A1"), { button: 0 });
    fireEvent.mouseMove(cell("B2"));
    fireEvent.mouseUp(cell("B2"));
    await waitFor(() => expect(selectedState("B2")).toBe("true"));

    await user.click(within(grid()).getByRole("gridcell", { name: "C4" }));
    await waitFor(() => expect(selectedState("C4")).toBe("true"));
    for (const coordinate of ["A1", "B1", "A2", "B2"]) {
      expect(selectedState(coordinate)).toBe("false");
    }
    expect(storedSelection(backend, "ws-q3-sales-sheet1")).toEqual({ anchor: "C4", focus: "C4" });
  });
});

describe("pasting two-dimensional table data", () => {
  function pasteEvent(text: string) {
    return { clipboardData: { getData: (type: string) => (type === "text/plain" ? text : "") } };
  }

  it("pastes the whole external clipboard rectangle through Ctrl+V and keeps it after refresh", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.click(within(grid()).getByRole("gridcell", { name: "D1" }));
    fireEvent.paste(grid(), pasteEvent("East\t1200\nNorth\t800"));

    await waitFor(() => expect(cell("E2").textContent).toBe("800"));
    expect(cell("D1").textContent).toBe("East");
    expect(cell("E1").textContent).toBe("1200");
    expect(cell("D2").textContent).toBe("North");
    // Overwrites only the target rectangle: the seeded range keeps its values.
    expect(cell("A1").textContent).toBe("Region");
    expect(cell("B2").textContent).toBe("1200");
    expect(cell("D3").textContent).toBe("");

    await reopenEditor(backend);
    expect(cell("D1").textContent).toBe("East");
    expect(cell("E1").textContent).toBe("1200");
    expect(cell("D2").textContent).toBe("North");
    expect(cell("E2").textContent).toBe("800");
    expect(cell("A2").textContent).toBe("East");
  });

  it("preserves empty pasted fields and clears only their target cells", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.click(within(grid()).getByRole("gridcell", { name: "A2" }));
    fireEvent.paste(grid(), pasteEvent("West\t"));
    await waitFor(() => expect(cell("A2").textContent).toBe("West"));
    expect(cell("B2").textContent).toBe("");
    expect(cell("A1").textContent).toBe("Region");
    expect(cell("B1").textContent).toBe("Sales");
  });

  it("offers Paste as a menuitem of the grid context menu and pastes the clipboard content", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    useClipboard(async () => "East\t1200\nNorth\t800");

    fireEvent.contextMenu(cell("D1"));
    const menu = await screen.findByRole("menu");
    const pasteItem = within(menu).getByRole("menuitem", { name: "Paste" });
    await user.click(pasteItem);

    await waitFor(() => expect(cell("E2").textContent).toBe("800"));
    expect(cell("D1").textContent).toBe("East");
    expect(cell("A1").textContent).toBe("Region");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows the rejection message and keeps every target cell when a paste is refused", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    backend.failNextRequest((_method, path) => path.endsWith("/paste"), {
      status: 400,
      error: "Please enter a number from 0 to 100",
    });

    await user.click(within(grid()).getByRole("gridcell", { name: "D1" }));
    fireEvent.paste(grid(), pasteEvent("East\t1200\nNorth\t800"));

    expect(await screen.findByText("Please enter a number from 0 to 100")).toBeTruthy();
    expect(cell("D1").textContent).toBe("");
    expect(cell("E1").textContent).toBe("");
    expect(cell("D2").textContent).toBe("");
    expect(cell("E2").textContent).toBe("");
    expect(cell("A1").textContent).toBe("Region");
    expect(cell("B2").textContent).toBe("1200");
  });

  it("reports an unreadable clipboard instead of pasting nothing", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    useClipboard(undefined);

    fireEvent.contextMenu(cell("D1"));
    await user.click(await screen.findByRole("menuitem", { name: "Paste" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(cell("D1").textContent).toBe("");
  });
});

describe("direct data entry through the grid", () => {
  it("edits a cell by typing on it and commits with Enter", async () => {
    await openSeededEditor();
    const user = userEvent.setup();

    await user.click(cell("C5"));
    await user.keyboard("Hello{Enter}");

    expect(cell("C5").textContent).toBe("Hello");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "Hello");
  });

  it("shows a formula's result in the grid and its original formula in the formula bar", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    const formulaBar = () => screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;

    await user.click(cell("D1"));
    await user.type(formulaBar(), "=B2*2{Enter}");

    await waitFor(() => expect(cell("D1").textContent).toBe("2400"));
    expect(formulaBar().value).toBe("=B2*2");

    // The inline editor of a formula cell starts from the submitted formula, not its result.
    await user.dblClick(cell("D1"));
    const inline = screen.getByRole("textbox", { name: "Edit D1" }) as HTMLInputElement;
    expect(inline.value).toBe("=B2*2");
    await user.keyboard("{Escape}");

    // A committed source change recalculates the dependent result.
    await user.click(cell("B2"));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "4{Enter}");
    await waitFor(() => expect(cell("D1").textContent).toBe("8"));

    // Result, formula text and the source value all survive a refresh.
    await reopenEditor(backend);
    expect(cell("B2").textContent).toBe("4");
    await waitFor(() => expect(cell("D1").textContent).toBe("8"));
    await user.click(cell("D1"));
    expect(formulaBar().value).toBe("=B2*2");
  });

  it("cancels an uncommitted inline edit and formula bar edit with Escape", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.dblClick(cell("A2"));
    const inline = screen.getByRole("textbox", { name: "Edit A2" });
    await user.clear(inline);
    await user.type(inline, "West{Escape}");

    expect(screen.queryByRole("textbox", { name: "Edit A2" })).toBeNull();
    expect(cell("A2").textContent).toBe("East");

    await user.click(cell("A3"));
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
    await user.clear(formulaBar);
    await user.type(formulaBar, "South{Escape}");

    expect(formulaBar.value).toBe("North");
    expect(cell("A3").textContent).toBe("North");
    expect(storedSelection(backend, "ws-q3-sales-sheet1")).toEqual({ anchor: "A3", focus: "A3" });
  });
});
