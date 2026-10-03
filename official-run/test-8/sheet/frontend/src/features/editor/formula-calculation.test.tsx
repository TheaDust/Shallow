import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { createMockBackend, seedWorkbook } from "../../test/mock-backend";

/**
 * REQ-4-1-1 / REQ-4-2-1 through the editor: formulas typed through the formula
 * bar and the grid, the result in the grid, the original expression in the
 * formula bar, and the recalculation of directly and indirectly dependent
 * formulas after a source edit, a bulk paste and a range move.
 */

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

/** Selects a cell and commits `text` through the labelled formula bar. */
async function enterInFormulaBar(
  user: ReturnType<typeof userEvent.setup>,
  coordinate: string,
  text: string,
) {
  await user.click(gridCell(coordinate));
  await waitFor(() => expect(gridCell(coordinate).getAttribute("aria-selected")).toBe("true"));
  const input = formulaBar();
  await user.clear(input);
  await user.type(input, text);
  await user.keyboard("{Enter}");
}

describe("basic expressions and aggregate functions", () => {
  it("calculates entries made through the formula bar and the grid and keeps the original expression", async () => {
    const { user, view } = await openEditor();

    await enterInFormulaBar(user, "D1", "=(B2+B3)/2");
    await waitFor(() => expect(gridCell("D1").textContent).toBe("1000"));

    await enterInFormulaBar(user, "D2", "=SUM(B2:B4)");
    await waitFor(() => expect(gridCell("D2").textContent).toBe("2700"));

    await enterInFormulaBar(user, "D3", "=AVERAGE(B2:B4)");
    await waitFor(() => expect(gridCell("D3").textContent).toBe("900"));

    await enterInFormulaBar(user, "D4", "=COUNT(B2:B4)");
    await waitFor(() => expect(gridCell("D4").textContent).toBe("3"));

    await enterInFormulaBar(user, "D5", "=MIN(B2:B4)");
    await waitFor(() => expect(gridCell("D5").textContent).toBe("700"));

    await enterInFormulaBar(user, "D6", "=MAX(B2:B4)");
    await waitFor(() => expect(gridCell("D6").textContent).toBe("1200"));

    // Function names are case-insensitive; the typed expression is what is stored.
    await enterInFormulaBar(user, "E1", "=sum(b2:b4)");
    await waitFor(() => expect(gridCell("E1").textContent).toBe("2700"));
    expect(worksheet().cells.E1).toBe("=sum(b2:b4)");

    // A grid-sourced edit calculates the same way.
    await user.dblClick(gridCell("E2"));
    const editor = await screen.findByRole("textbox", { name: "Edit E2" });
    await user.type(editor, "=B2*2");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(gridCell("E2").textContent).toBe("2400"));

    // Selecting a formula cell shows its original expression, not its result.
    await user.click(gridCell("D2"));
    await waitFor(() => expect(formulaBar().value).toBe("=SUM(B2:B4)"));
    await user.click(gridCell("E1"));
    await waitFor(() => expect(formulaBar().value).toBe("=sum(b2:b4)"));

    // Results and original expressions both survive a reopen.
    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(gridCell("D1").textContent).toBe("1000");
    expect(gridCell("D2").textContent).toBe("2700");
    expect(gridCell("D3").textContent).toBe("900");
    expect(gridCell("D4").textContent).toBe("3");
    expect(gridCell("D5").textContent).toBe("700");
    expect(gridCell("D6").textContent).toBe("1200");
    expect(gridCell("E1").textContent).toBe("2700");
    expect(gridCell("E2").textContent).toBe("2400");
    await userEvent.setup().click(gridCell("E1"));
    expect(formulaBar().value).toBe("=sum(b2:b4)");
    expect(worksheet().cells.D2).toBe("=SUM(B2:B4)");
  });

  it("uses only numeric cells and never treats blanks as zero", async () => {
    const { user } = await openEditor();

    // B5 and B6 are empty, so they are ignored instead of added as zero.
    await enterInFormulaBar(user, "D1", "=SUM(B2:B6)");
    await waitFor(() => expect(gridCell("D1").textContent).toBe("2700"));
    await enterInFormulaBar(user, "D2", "=AVERAGE(B2:B6)");
    await waitFor(() => expect(gridCell("D2").textContent).toBe("900"));
    await enterInFormulaBar(user, "D3", "=COUNT(B2:B6)");
    await waitFor(() => expect(gridCell("D3").textContent).toBe("3"));

    // A2:A4 hold text only: nothing numeric to sum, count or compare.
    await enterInFormulaBar(user, "E1", "=COUNT(A2:A4)");
    await waitFor(() => expect(gridCell("E1").textContent).toBe("0"));
    await enterInFormulaBar(user, "E2", "=SUM(A2:A4)");
    await waitFor(() => expect(gridCell("E2").textContent).toBe("0"));
    await enterInFormulaBar(user, "E3", "=MIN(B5:B6)");
    await waitFor(() => expect(gridCell("E3").textContent).toBe("0"));
  });
});

describe("dependency recalculation", () => {
  it("recalculates direct and indirect dependents after a source edit and persists them", async () => {
    const { user, view } = await openEditor();
    await enterInFormulaBar(user, "D1", "=B2+B3");
    await waitFor(() => expect(gridCell("D1").textContent).toBe("2000"));
    await enterInFormulaBar(user, "E1", "=D1*2");
    await waitFor(() => expect(gridCell("E1").textContent).toBe("4000"));

    // Editing the source through the grid's inline editor updates the whole chain.
    await user.dblClick(gridCell("B2"));
    const editor = await screen.findByRole("textbox", { name: "Edit B2" });
    await user.clear(editor);
    await user.type(editor, "100");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(gridCell("B2").textContent).toBe("100"));
    await waitFor(() => expect(gridCell("D1").textContent).toBe("900"));
    expect(gridCell("E1").textContent).toBe("1800");
    expect(worksheet().cells.D1).toBe("=B2+B3");

    // Each formula bar keeps showing its original expression.
    await user.click(gridCell("D1"));
    await waitFor(() => expect(formulaBar().value).toBe("=B2+B3"));
    await user.click(gridCell("E1"));
    await waitFor(() => expect(formulaBar().value).toBe("=D1*2"));

    // A reopen shows the new results, never the pre-change ones.
    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(gridCell("B2").textContent).toBe("100");
    expect(gridCell("D1").textContent).toBe("900");
    expect(gridCell("E1").textContent).toBe("1800");

    // The other worksheet has no formula following these sources.
    await userEvent.setup().click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(gridCell("D1").textContent).toBe("");
    expect(worksheet(1).cells.D1).toBeUndefined();
  });

  it("recalculates dependents after a bulk paste and a range move", async () => {
    const { user } = await openEditor();
    await enterInFormulaBar(user, "D1", "=B2+B3");
    await waitFor(() => expect(gridCell("D1").textContent).toBe("2000"));

    // A two-dimensional Ctrl+V paste over B2:C2 replaces the source values.
    await user.click(gridCell("B2"));
    await waitFor(() => expect(gridCell("B2").getAttribute("aria-selected")).toBe("true"));
    fireEvent.paste(gridCell("B2"), { clipboardData: { getData: () => "500\t600" } });
    await waitFor(() => expect(gridCell("B2").textContent).toBe("500"));
    expect(gridCell("C2").textContent).toBe("600");
    await waitFor(() => expect(gridCell("D1").textContent).toBe("1300"));
    expect(worksheet().cells.D1).toBe("=B2+B3");

    // Cutting the source cell away moves it, so the dependent formula recalculates.
    fireEvent.contextMenu(gridCell("B2"));
    const menu = await screen.findByRole("menu", { name: "Cell B2 menu" });
    await user.click(within(menu).getByRole("menuitem", { name: "Cut" }));
    await user.click(gridCell("B6"));
    await waitFor(() => expect(gridCell("B6").getAttribute("aria-selected")).toBe("true"));
    await user.keyboard("{Control>}v{/Control}");
    await waitFor(() => expect(gridCell("B6").textContent).toBe("500"));
    await waitFor(() => expect(gridCell("B2").textContent).toBe(""));
    await waitFor(() => expect(gridCell("D1").textContent).toBe("800"));
    expect(worksheet().cells.B6).toBe("500");
    expect(worksheet().cells.B2).toBeUndefined();
  });

  it("isolates error cells from unrelated formulas and keeps every expression after reopen", async () => {
    const { user, view } = await openEditor();
    await enterInFormulaBar(user, "D1", "=1/0");
    await waitFor(() => expect(gridCell("D1").textContent).toBe("#DIV/0!"));
    await enterInFormulaBar(user, "D2", "=NOSUCH(1)");
    await waitFor(() => expect(gridCell("D2").textContent).toBe("#NAME?"));
    await enterInFormulaBar(user, "D3", "=1+");
    await waitFor(() => expect(gridCell("D3").textContent).toBe("#ERROR!"));
    await enterInFormulaBar(user, "D4", "=D4+1");
    await waitFor(() => expect(gridCell("D4").textContent).toBe("#REF!"));
    await enterInFormulaBar(user, "E1", "=B2*2");
    await waitFor(() => expect(gridCell("E1").textContent).toBe("2400"));

    await user.click(gridCell("D1"));
    await waitFor(() => expect(formulaBar().value).toBe("=1/0"));

    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(gridCell("D1").textContent).toBe("#DIV/0!");
    expect(gridCell("D2").textContent).toBe("#NAME?");
    expect(gridCell("D3").textContent).toBe("#ERROR!");
    expect(gridCell("E1").textContent).toBe("2400");
    expect(worksheet().cells.D1).toBe("=1/0");
  });

  it("shows every error value with its original formula after reopening", async () => {
    const { user, view } = await openEditor();
    await enterInFormulaBar(user, "D1", "=1/0");
    await waitFor(() => expect(gridCell("D1").textContent).toBe("#DIV/0!"));
    await enterInFormulaBar(user, "D2", "=NOSUCH(1)");
    await waitFor(() => expect(gridCell("D2").textContent).toBe("#NAME?"));
    await enterInFormulaBar(user, "D3", "=1+");
    await waitFor(() => expect(gridCell("D3").textContent).toBe("#ERROR!"));
    // An indirect circular reference reports #REF! on every cell of the cycle.
    await enterInFormulaBar(user, "D5", "=E5+1");
    await waitFor(() => expect(gridCell("D5").textContent).toBe("1"));
    await enterInFormulaBar(user, "E5", "=D5+1");
    await waitFor(() => expect(gridCell("E5").textContent).toBe("#REF!"));
    expect(gridCell("D5").textContent).toBe("#REF!");

    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(gridCell("D1").textContent).toBe("#DIV/0!");
    expect(gridCell("D2").textContent).toBe("#NAME?");
    expect(gridCell("D3").textContent).toBe("#ERROR!");
    expect(gridCell("D5").textContent).toBe("#REF!");
    expect(gridCell("E5").textContent).toBe("#REF!");

    // Selecting each error cell after the reopen shows the expression the user entered.
    const bar = () => formulaBar();
    await userEvent.setup().click(gridCell("D1"));
    await waitFor(() => expect(bar().value).toBe("=1/0"));
    await userEvent.setup().click(gridCell("D2"));
    await waitFor(() => expect(bar().value).toBe("=NOSUCH(1)"));
    await userEvent.setup().click(gridCell("D3"));
    await waitFor(() => expect(bar().value).toBe("=1+"));
    await userEvent.setup().click(gridCell("D5"));
    await waitFor(() => expect(bar().value).toBe("=E5+1"));
  });

  it("fixes an error cell through the formula bar and updates its dependents after refresh", async () => {
    const { user, view } = await openEditor();
    await enterInFormulaBar(user, "D1", "=1/0");
    await waitFor(() => expect(gridCell("D1").textContent).toBe("#DIV/0!"));
    await enterInFormulaBar(user, "E1", "=D1*2");
    await waitFor(() => expect(gridCell("E1").textContent).toBe("#DIV/0!"));

    // The error cell is editable: a valid formula replaces it and the dependents recalculate.
    await enterInFormulaBar(user, "D1", "=B2+B3");
    await waitFor(() => expect(gridCell("D1").textContent).toBe("2000"));
    expect(gridCell("E1").textContent).toBe("4000");
    await user.click(gridCell("D1"));
    await waitFor(() => expect(formulaBar().value).toBe("=B2+B3"));

    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(gridCell("D1").textContent).toBe("2000");
    expect(gridCell("E1").textContent).toBe("4000");
    expect(screen.queryByText("#DIV/0!")).toBeNull();
    await userEvent.setup().click(gridCell("D1"));
    await waitFor(() => expect(formulaBar().value).toBe("=B2+B3"));
    expect(worksheet().cells.D1).toBe("=B2+B3");
  });
});
