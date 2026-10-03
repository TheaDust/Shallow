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

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
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

async function copyThroughMenu(
  user: ReturnType<typeof userEvent.setup>,
  coordinate: string,
  command: "Copy" | "Cut",
) {
  fireEvent.contextMenu(gridCell(coordinate));
  const menu = await screen.findByRole("menu", { name: `Cell ${coordinate} menu` });
  await user.click(within(menu).getByRole("menuitem", { name: command }));
}

async function openCellMenu(user: ReturnType<typeof userEvent.setup>, coordinate: string) {
  fireEvent.contextMenu(gridCell(coordinate));
  return screen.findByRole("menu", { name: `Cell ${coordinate} menu` });
}

describe("copying, cutting and pasting a range", () => {
  it("copies a dragged range to the target cell and leaves the source and the rest of the sheet", async () => {
    const { user } = await openEditor();

    await dragRange(user, "A1", "B2");
    await copyThroughMenu(user, "A2", "Copy");
    await user.click(gridCell("D1"));
    await user.keyboard("{Control>}v{/Control}");

    await waitFor(() => expect(gridCell("D1").textContent).toBe("Region"));
    expect(gridCell("E1").textContent).toBe("Sales");
    expect(gridCell("D2").textContent).toBe("East");
    expect(gridCell("E2").textContent).toBe("1200");

    // The copy source and everything outside the two ranges is untouched.
    expect(gridCell("A1").textContent).toBe("Region");
    expect(gridCell("B2").textContent).toBe("1200");
    expect(gridCell("C1").textContent).toBe("Status");
    expect(gridCell("F1").textContent).toBe("");
    expect(worksheet().cells.A1).toBe("Region");
    expect(worksheet().cells.E2).toBe("1200");
    expect(worksheet().cells.C1).toBe("Status");
    expect(worksheet().cells.F1).toBeUndefined();
  });

  it("pastes the copied range through the cell menu command and persists it after reopening", async () => {
    const { user, view } = await openEditor();

    await dragRange(user, "A2", "B3");
    await copyThroughMenu(user, "A2", "Copy");
    await user.click(gridCell("D4"));
    const menu = await openCellMenu(user, "D4");
    await user.click(within(menu).getByRole("menuitem", { name: "Paste" }));

    await waitFor(() => expect(gridCell("D4").textContent).toBe("East"));
    expect(gridCell("E4").textContent).toBe("1200");
    expect(gridCell("D5").textContent).toBe("North");
    expect(gridCell("E5").textContent).toBe("800");

    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(gridCell("D4").textContent).toBe("East");
    expect(gridCell("E5").textContent).toBe("800");
    expect(gridCell("A2").textContent).toBe("East");
    expect(worksheet().cells.D4).toBe("East");
  });

  it("moves the cut range and clears the source only once the target holds it", async () => {
    const { user, view } = await openEditor();

    await dragRange(user, "A1", "B2");
    await copyThroughMenu(user, "A1", "Cut");
    await user.click(gridCell("D1"));
    await user.keyboard("{Control>}v{/Control}");

    await waitFor(() => expect(gridCell("D1").textContent).toBe("Region"));
    expect(gridCell("E1").textContent).toBe("Sales");
    expect(gridCell("D2").textContent).toBe("East");
    expect(gridCell("E2").textContent).toBe("1200");
    expect(gridCell("A1").textContent).toBe("");
    expect(gridCell("B1").textContent).toBe("");
    expect(gridCell("A2").textContent).toBe("");
    expect(gridCell("B2").textContent).toBe("");
    // A column outside the cut range keeps its values.
    expect(gridCell("C1").textContent).toBe("Status");

    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(gridCell("A1").textContent).toBe("");
    expect(gridCell("D1").textContent).toBe("Region");
    expect(worksheet().cells.A1).toBeUndefined();
    expect(worksheet().cells.E2).toBe("1200");
  });

  it("adjusts relative references by the offset and keeps absolute ones", async () => {
    const { user } = await openEditor();

    await user.click(gridCell("F1"));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "=B2+B4");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(gridCell("F1").textContent).toBe("1900"));

    await user.click(gridCell("F1"));
    await copyThroughMenu(user, "F1", "Copy");
    await user.click(gridCell("F2"));
    await user.keyboard("{Control>}v{/Control}");

    // The copied formula moves one row down: B2 -> B3, B4 -> B5.
    await waitFor(() => expect(worksheet().cells.F2).toBe("=B3+B5"));
    expect(gridCell("F2").textContent).toBe("800");
    expect(gridCell("F1").textContent).toBe("1900");
    await user.click(gridCell("F2"));
    await waitFor(() => expect(formulaBar().value).toBe("=B3+B5"));
    expect(worksheet().cells.F1).toBe("=B2+B4");
  });

  it("keeps the text result when a copied formula points at a text cell", async () => {
    const { user } = await openEditor();

    await user.click(gridCell("F1"));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "=A1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(gridCell("F1").textContent).toBe("Region"));

    await user.click(gridCell("F1"));
    await copyThroughMenu(user, "F1", "Copy");
    await user.click(gridCell("F2"));
    await user.keyboard("{Control>}v{/Control}");

    // One row down the relative reference moves from A1 to A2 ("East").
    await waitFor(() => expect(worksheet().cells.F2).toBe("=A2"));
    expect(gridCell("F2").textContent).toBe("East");
    await user.click(gridCell("F2"));
    await waitFor(() => expect(formulaBar().value).toBe("=A2"));
    expect(gridCell("F1").textContent).toBe("Region");

    // An absolute reference keeps pointing at the same text after the copy.
    await user.click(gridCell("F3"));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "=$A$1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(gridCell("F3").textContent).toBe("Region"));

    await user.click(gridCell("F3"));
    await copyThroughMenu(user, "F3", "Copy");
    await user.click(gridCell("F4"));
    await user.keyboard("{Control>}v{/Control}");

    await waitFor(() => expect(worksheet().cells.F4).toBe("=$A$1"));
    expect(gridCell("F4").textContent).toBe("Region");
  });

  it("shows #REF! in the grid and the formula bar when an offset leaves the sheet", async () => {
    const { user, view } = await openEditor();

    await user.click(gridCell("C1"));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "=B3");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(gridCell("C1").textContent).toBe("800"));

    await copyThroughMenu(user, "C1", "Copy");
    // A1 is two columns left and one row up: A2 has no room above the sheet.
    await user.click(gridCell("A1"));
    await user.keyboard("{Control>}v{/Control}");

    await waitFor(() => expect(gridCell("A1").textContent).toBe("#REF!"));
    expect(worksheet().cells.A1).toBe("=#REF!");
    await user.click(gridCell("A1"));
    await waitFor(() => expect(formulaBar().value).toBe("=#REF!"));
    // The source formula and its result are left untouched.
    expect(gridCell("C1").textContent).toBe("800");
    expect(worksheet().cells.C1).toBe("=B3");

    // The broken target and the intact source both survive a reopen.
    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(gridCell("A1").textContent).toBe("#REF!");
    expect(gridCell("C1").textContent).toBe("800");
    await userEvent.setup().click(gridCell("A1"));
    await waitFor(() => expect(formulaBar().value).toBe("=#REF!"));
    expect(worksheet().cells.C1).toBe("=B3");
  });

  it("persists the adjusted relative and unchanged absolute references after reopening", async () => {
    const { user, view } = await openEditor();

    await user.click(gridCell("F1"));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "=$B$2+B2");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(gridCell("F1").textContent).toBe("2400"));

    await copyThroughMenu(user, "F1", "Copy");
    await user.click(gridCell("F2"));
    await user.keyboard("{Control>}v{/Control}");

    // One row down the relative `B2` becomes `B3` while `$B$2` stays put.
    await waitFor(() => expect(worksheet().cells.F2).toBe("=$B$2+B3"));
    expect(gridCell("F2").textContent).toBe("2000");
    expect(gridCell("F1").textContent).toBe("2400");

    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(gridCell("F1").textContent).toBe("2400");
    expect(gridCell("F2").textContent).toBe("2000");
    await userEvent.setup().click(gridCell("F2"));
    await waitFor(() => expect(formulaBar().value).toBe("=$B$2+B3"));
    expect(worksheet().cells.F1).toBe("=$B$2+B2");
  });

  it("keeps every cell when a 0-to-100 rule rejects the target", async () => {
    backend.workbooks[0].worksheets[0].validations = [
      {
        id: "rule-e1",
        type: "numeric",
        min: 0,
        max: 100,
        range: { minRow: 0, maxRow: 1, minCol: 4, maxCol: 4 },
      },
    ] satisfies ValidationRule[];
    const { user } = await openEditor();

    await dragRange(user, "A1", "B2");
    await copyThroughMenu(user, "A1", "Cut");
    await user.click(gridCell("D1"));
    await user.keyboard("{Control>}v{/Control}");

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Please enter a number from 0 to 100"),
    );
    // Neither side of the move changed and no value was dropped silently.
    expect(gridCell("A1").textContent).toBe("Region");
    expect(gridCell("B2").textContent).toBe("1200");
    expect(gridCell("D1").textContent).toBe("");
    expect(gridCell("E2").textContent).toBe("");
    expect(worksheet().cells.A1).toBe("Region");
    expect(worksheet().cells.D1).toBeUndefined();
  });

  it("does not transfer a range across worksheets", async () => {
    const { user } = await openEditor();

    await user.click(gridCell("A1"));
    await copyThroughMenu(user, "A1", "Copy");
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await waitFor(() => expect(gridCell("A1").getAttribute("aria-selected")).toBe("true"));

    await user.click(gridCell("D1"));
    await user.keyboard("{Control>}v{/Control}");

    expect(screen.queryByRole("alert")).toBeNull();
    expect(worksheet(1).cells.D1).toBeUndefined();
  });
});
