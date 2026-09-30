import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fakeApi";

/**
 * REQ-4-1-1 and REQ-4-2-2 through the visible controls: a formula is submitted through the text box
 * labelled "Formula bar", the grid shows the calculated result (or the documented error value) and
 * the formula bar keeps the original expression, both after reopening the workbook.
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

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
}

function cell(grid: HTMLElement, cellId: string): HTMLElement {
  return within(grid).getByRole("gridcell", { name: cellId });
}

function textOf(grid: HTMLElement, cellId: string): string | null {
  return cell(grid, cellId).textContent;
}

/** Selects a cell and submits text through the formula bar, like the user does. */
async function typeInFormulaBar(grid: HTMLElement, cellId: string, text: string): Promise<void> {
  await user.click(cell(grid, cellId));
  const bar = formulaBar();
  await user.clear(bar);
  await user.type(bar, `${text}{Enter}`);
}

async function reopenWorkbook(): Promise<HTMLElement> {
  cleanup();
  renderApp();
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

describe("entering formulas through the formula bar", () => {
  it("shows the calculated result in the grid and the original formula in the formula bar, from either entry point", async () => {
    const grid = await openSeedWorkbook();

    await typeInFormulaBar(grid, "D1", "=B2+B3");
    await waitFor(() => expect(sheet().cells.D1?.value).toBe("=B2+B3"));
    expect(textOf(grid, "D1")).toBe("2000");
    expect(formulaBar().value).toBe("=B2+B3");

    await typeInFormulaBar(grid, "E1", "=D1*2");
    await waitFor(() => expect(textOf(grid, "E1")).toBe("4000"));

    // A formula can also be submitted through the grid's inline text box.
    await user.dblClick(cell(grid, "D2"));
    await user.type(within(grid).getByRole("textbox", { name: "Edit D2" }), "=SUM(B2:B4){Enter}");
    await waitFor(() => expect(textOf(grid, "D2")).toBe("2700"));

    // Editing a source cell recalculates the directly and indirectly dependent formulas.
    await user.dblClick(cell(grid, "B3"));
    const editor = within(grid).getByRole("textbox", { name: "Edit B3" });
    await user.clear(editor);
    await user.type(editor, "900{Enter}");
    await waitFor(() => expect(textOf(grid, "D1")).toBe("2100"));
    expect(textOf(grid, "E1")).toBe("4200");
    expect(textOf(grid, "D2")).toBe("2800");

    const reopened = await reopenWorkbook();
    expect(textOf(reopened, "D1")).toBe("2100");
    expect(textOf(reopened, "E1")).toBe("4200");
    expect(textOf(reopened, "D2")).toBe("2800");
    await user.click(cell(reopened, "D1"));
    expect(formulaBar().value).toBe("=B2+B3");
    await user.click(cell(reopened, "D2"));
    expect(formulaBar().value).toBe("=SUM(B2:B4)");
    expect(sheet().cells.E1?.value).toBe("=D1*2");
  });

  it("calculates SUM, AVERAGE, COUNT, MIN and MAX case insensitively over a contiguous range", async () => {
    const grid = await openSeedWorkbook();
    // B2:B6 holds 1200, 800, 700, a text value and a blank cell.
    await typeInFormulaBar(grid, "B5", "closed");

    await typeInFormulaBar(grid, "D1", "=sum(B2:B6)");
    await typeInFormulaBar(grid, "D2", "=AVERAGE(B2:B6)");
    await typeInFormulaBar(grid, "D3", "=count(B2:B6)");
    await typeInFormulaBar(grid, "D4", "=MIN(B2:B6)");
    await typeInFormulaBar(grid, "D5", "=MAX(B2:B6)");
    await waitFor(() => expect(sheet().cells.D5?.value).toBe("=MAX(B2:B6)"));

    expect(textOf(grid, "D1")).toBe("2700");
    expect(textOf(grid, "D2")).toBe("900");
    expect(textOf(grid, "D3")).toBe("3");
    expect(textOf(grid, "D4")).toBe("700");
    expect(textOf(grid, "D5")).toBe("1200");
    expect(formulaBar().value).toBe("=MAX(B2:B6)");

    const reopened = await reopenWorkbook();
    expect(textOf(reopened, "D1")).toBe("2700");
    expect(textOf(reopened, "D2")).toBe("900");
    expect(textOf(reopened, "D3")).toBe("3");
  });

  it("shows the documented error values while keeping their original formulas and the unrelated results", async () => {
    const grid = await openSeedWorkbook();

    await typeInFormulaBar(grid, "D1", "=1/0");
    await typeInFormulaBar(grid, "D2", "=NOSUCH(1)");
    await typeInFormulaBar(grid, "D3", "=1+");
    await typeInFormulaBar(grid, "D4", "=ZZZ1");
    await typeInFormulaBar(grid, "D5", "=D6+1");
    await typeInFormulaBar(grid, "D6", "=D5+1");
    await typeInFormulaBar(grid, "E1", "=B2+B3");
    await waitFor(() => expect(sheet().cells.E1?.display).toBe("2000"));

    expect(textOf(grid, "D1")).toBe("#DIV/0!");
    expect(textOf(grid, "D2")).toBe("#NAME?");
    expect(textOf(grid, "D3")).toBe("#ERROR!");
    expect(textOf(grid, "D4")).toBe("#REF!");
    expect(textOf(grid, "D5")).toBe("#REF!");
    expect(textOf(grid, "D6")).toBe("#REF!");
    expect(textOf(grid, "E1")).toBe("2000");

    await user.click(cell(grid, "D1"));
    expect(formulaBar().value).toBe("=1/0");

    const reopened = await reopenWorkbook();
    expect(textOf(reopened, "D1")).toBe("#DIV/0!");
    expect(textOf(reopened, "D3")).toBe("#ERROR!");
    expect(textOf(reopened, "E1")).toBe("2000");
    await user.click(cell(reopened, "E1"));
    expect(formulaBar().value).toBe("=B2+B3");
  });

  it("replaces an error with the new result and updates its dependents once the formula is fixed", async () => {
    const grid = await openSeedWorkbook();

    await typeInFormulaBar(grid, "D1", "=1/0");
    await typeInFormulaBar(grid, "D2", "=D1*2");
    await waitFor(() => expect(textOf(grid, "D2")).toBe("#DIV/0!"));

    await user.click(cell(grid, "D1"));
    expect(formulaBar().value).toBe("=1/0");

    await typeInFormulaBar(grid, "D1", "=B2+B3");
    await waitFor(() => expect(textOf(grid, "D1")).toBe("2000"));
    expect(textOf(grid, "D2")).toBe("4000");
    expect(formulaBar().value).toBe("=B2+B3");
    expect(sheet().cells.D1?.value).toBe("=B2+B3");

    const reopened = await reopenWorkbook();
    expect(textOf(reopened, "D1")).toBe("2000");
    expect(textOf(reopened, "D2")).toBe("4000");
    expect(within(reopened).queryByText("#DIV/0!")).toBeNull();
  });
});
