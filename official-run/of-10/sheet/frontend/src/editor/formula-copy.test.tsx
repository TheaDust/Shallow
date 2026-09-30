import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fakeApi";

/**
 * REQ-4-1-2 and REQ-4-2-1 through the visible controls: formulas are submitted through the text box
 * labelled "Formula bar" (REQ-3-1-1), copied with Ctrl+C and pasted with Ctrl+V (REQ-3-2-1), and the
 * target shows the adjusted original formula in the formula bar next to the result of the new
 * references. The evaluation seed of these requirements (`A1=2`, `B1=3`, `=A1+B1`, `=C1*2`) conflicts
 * with the shared `A1=Region` record of the workbook seed, so each test builds it through the visible
 * formula bar - the same preparation a user has.
 */

let api: FakeApi;
let user: ReturnType<typeof userEvent.setup>;

function renderApp() {
  return render(<App />);
}

beforeEach(() => {
  api = createFakeApi();
  vi.stubGlobal("fetch", api.fetch);
  window.location.hash = "#/";
  user = userEvent.setup();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openSeedWorkbook() {
  renderApp();
  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
  await screen.findByRole("heading", { name: "Q3 Sales" });
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

/** Reads the state of the seeded worksheet the fake server keeps. */
function sheet() {
  return api.state.workbooks[0].worksheets[0];
}

function cell(grid: HTMLElement, cellId: string): HTMLElement {
  return within(grid).getByRole("gridcell", { name: cellId });
}

function textOf(grid: HTMLElement, cellId: string): string | null {
  return cell(grid, cellId).textContent;
}

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
}

/** Selects a cell and submits text through the formula bar, like the user does. */
async function typeInFormulaBar(grid: HTMLElement, cellId: string, text: string): Promise<void> {
  await user.click(cell(grid, cellId));
  const bar = formulaBar();
  await user.clear(bar);
  await user.type(bar, `${text}{Enter}`);
}

/** Takes the current selection with Ctrl+C and answers with the text put on the system clipboard. */
function copySelection(grid: HTMLElement) {
  const setData = vi.fn();
  fireEvent.copy(grid, { clipboardData: { setData } });
  return setData;
}

function pasteSelection(grid: HTMLElement) {
  fireEvent.keyDown(grid, { key: "v", ctrlKey: true });
}

async function reopenWorkbook(): Promise<HTMLElement> {
  cleanup();
  renderApp();
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

async function openColumnMenu(grid: HTMLElement, label: string) {
  fireEvent.contextMenu(within(grid).getByRole("columnheader", { name: label }), {
    clientX: 120,
    clientY: 40,
  });
  return screen.findByRole("menu", { name: `Column ${label} menu` });
}

/** The evaluation state of REQ-4-1-2 built with the visible formula bar. */
async function prepareFormulaCells(grid: HTMLElement): Promise<void> {
  await typeInFormulaBar(grid, "A1", "2");
  await typeInFormulaBar(grid, "B1", "3");
  await typeInFormulaBar(grid, "C1", "=A1+$B$1");
  await typeInFormulaBar(grid, "D1", "=C1*2");
  await waitFor(() => expect(textOf(grid, "D1")).toBe("10"));
  expect(textOf(grid, "C1")).toBe("5");
}

describe("copying a formula cell", () => {
  it("adjusts the target references by the offset, keeps its source and recalculates the dependents", async () => {
    const grid = await openSeedWorkbook();
    await prepareFormulaCells(grid);

    await user.click(cell(grid, "C1"));
    expect(copySelection(grid)).toHaveBeenCalledWith("text/plain", "=A1+$B$1");
    await user.click(cell(grid, "E1"));
    pasteSelection(grid);

    // The relative reference follows the offset of the target, the absolute part stays.
    await waitFor(() => expect(sheet().cells.E1?.value).toBe("=C1+$B$1"));
    expect(textOf(grid, "E1")).toBe("8");
    expect(formulaBar().value).toBe("=C1+$B$1");

    // The source cell and the cells outside the two rectangles keep their formula and result.
    expect(sheet().cells.C1?.value).toBe("=A1+$B$1");
    await user.click(cell(grid, "C1"));
    expect(formulaBar().value).toBe("=A1+$B$1");
    expect(textOf(grid, "C1")).toBe("5");
    expect(textOf(grid, "D1")).toBe("10");
    expect(textOf(grid, "A1")).toBe("2");

    // Both formulas and results survive reopening the workbook.
    const reopened = await reopenWorkbook();
    expect(textOf(reopened, "C1")).toBe("5");
    expect(textOf(reopened, "D1")).toBe("10");
    expect(textOf(reopened, "E1")).toBe("8");
    await user.click(cell(reopened, "E1"));
    expect(formulaBar().value).toBe("=C1+$B$1");

    // Editing a source value updates the directly and indirectly dependent formulas, the copy included.
    await typeInFormulaBar(reopened, "A1", "5");
    await waitFor(() => expect(textOf(reopened, "C1")).toBe("8"));
    expect(textOf(reopened, "D1")).toBe("16");
    expect(textOf(reopened, "E1")).toBe("11");
    await user.click(cell(reopened, "E1"));
    expect(formulaBar().value).toBe("=C1+$B$1");
  });

  it("shows =#REF! when the copy offset moves a relative reference outside the worksheet", async () => {
    const grid = await openSeedWorkbook();
    await prepareFormulaCells(grid);

    // C1 sits in column C: pasting it into column A moves both relative references off the sheet.
    await user.click(cell(grid, "C1"));
    copySelection(grid);
    await user.click(cell(grid, "A2"));
    pasteSelection(grid);

    await waitFor(() => expect(sheet().cells.A2?.value).toBe("=#REF!"));
    expect(textOf(grid, "A2")).toBe("#REF!");
    expect(formulaBar().value).toBe("=#REF!");
    // The source formula and its result are untouched, and so is the unrelated formula next to it.
    expect(sheet().cells.C1?.value).toBe("=A1+$B$1");
    expect(textOf(grid, "C1")).toBe("5");
    expect(textOf(grid, "D1")).toBe("10");

    const reopened = await reopenWorkbook();
    expect(textOf(reopened, "A2")).toBe("#REF!");
    await user.click(cell(reopened, "A2"));
    expect(formulaBar().value).toBe("=#REF!");
    expect(textOf(reopened, "C1")).toBe("5");
    expect(textOf(reopened, "D1")).toBe("10");
  });

  it("recalculates the dependents after a bulk paste and after a column structure change", async () => {
    const grid = await openSeedWorkbook();
    await prepareFormulaCells(grid);

    // A pasted rectangle overwrites both source cells of the formula chain.
    await user.click(cell(grid, "A1"));
    fireEvent.paste(grid, { clipboardData: { getData: () => "5\t7" } });
    await waitFor(() => expect(sheet().cells.B1?.value).toBe("7"));
    expect(textOf(grid, "C1")).toBe("12");
    expect(textOf(grid, "D1")).toBe("24");
    await user.click(cell(grid, "C1"));
    expect(formulaBar().value).toBe("=A1+$B$1");

    // Inserting a column left of A moves the sources and their formulas together.
    const menu = await openColumnMenu(grid, "A");
    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 column left" }));
    await waitFor(() => expect(sheet().cells.D1?.value).toBe("=B1+$C$1"));
    expect(textOf(grid, "B1")).toBe("5");
    expect(textOf(grid, "C1")).toBe("7");
    expect(textOf(grid, "D1")).toBe("12");
    expect(sheet().cells.E1?.value).toBe("=D1*2");
    expect(textOf(grid, "E1")).toBe("24");
    await user.click(cell(grid, "D1"));
    expect(formulaBar().value).toBe("=B1+$C$1");

    // The recalculated results survive a refresh.
    const reopened = await reopenWorkbook();
    expect(textOf(reopened, "B1")).toBe("5");
    expect(textOf(reopened, "D1")).toBe("12");
    expect(textOf(reopened, "E1")).toBe("24");
    await user.click(cell(reopened, "D1"));
    expect(formulaBar().value).toBe("=B1+$C$1");
  });
});
