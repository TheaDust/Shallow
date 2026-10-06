import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import { SEED_WORKBOOK_ID, installFakeApi, type FakeApi } from "./test/fake-api";

let api: FakeApi | undefined;

beforeEach(() => {
  window.location.hash = `#/workbooks/${SEED_WORKBOOK_ID}`;
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function cellsOf(workbookIndex = 0, worksheetIndex = 0) {
  return api!.workbooks[workbookIndex].worksheets[worksheetIndex].cells;
}

function cellText(name: string): string {
  return screen.getByRole("gridcell", { name }).textContent ?? "";
}

async function cell(name: string) {
  await grid();
  return screen.getByRole("gridcell", { name });
}

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
}

/** Enters a formula in the formula bar of the currently selected cell. */
async function enterFormula(user: ReturnType<typeof userEvent.setup>, formula: string) {
  const bar = formulaBar();
  await user.clear(bar);
  await user.type(bar, `${formula}{Enter}`);
}

async function selectCell(user: ReturnType<typeof userEvent.setup>, name: string) {
  await grid();
  await user.click(screen.getByRole("gridcell", { name }));
}

function pasteEvent(text: string): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  return event;
}

test("an error formula shows a stable code and its original text, and fixing it recalculates dependents", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  await selectCell(user, "D1");
  await enterFormula(user, "=1/0");
  await selectCell(user, "E1");
  await enterFormula(user, "=D1+1");
  await selectCell(user, "F1");
  await enterFormula(user, "=B2*2");

  await waitFor(() => expect(cellText("D1")).toBe("#DIV/0!"));
  // The error propagates to the dependent formula but not to the unrelated one.
  expect(cellText("E1")).toBe("#DIV/0!");
  expect(cellText("F1")).toBe("2400");
  // The bar keeps the expression the user submitted, not the error code.
  await selectCell(user, "D1");
  expect(formulaBar().value).toBe("=1/0");

  // The error value and the original expression both persist after a reload.
  view.unmount();
  render(<App />);
  await grid();
  await waitFor(() => expect(cellText("D1")).toBe("#DIV/0!"));
  expect(cellText("E1")).toBe("#DIV/0!");
  await selectCell(user, "D1");
  expect(formulaBar().value).toBe("=1/0");

  // A valid replacement clears the error, updates dependents and persists.
  await enterFormula(user, "=B2/2");
  await waitFor(() => expect(cellText("D1")).toBe("600"));
  expect(formulaBar().value).toBe("=B2/2");
  expect(cellText("E1")).toBe("601");
  expect(cellText("F1")).toBe("2400");
  expect(cellsOf().D1).toBe("=B2/2");

  cleanup();
  render(<App />);
  await grid();
  await waitFor(() => expect(cellText("D1")).toBe("600"));
  expect(cellText("E1")).toBe("601");
});

test("an unsupported function and an invalid reference marker show their codes with the original text", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  await selectCell(user, "D1");
  await enterFormula(user, "=TOTAL(B2:B4)");
  await selectCell(user, "D2");
  await enterFormula(user, "=#REF!");

  await waitFor(() => expect(cellText("D1")).toBe("#NAME?"));
  expect(cellText("D2")).toBe("#REF!");
  await selectCell(user, "D1");
  expect(formulaBar().value).toBe("=TOTAL(B2:B4)");
});

test("typing an out-of-range reference shows #REF! and keeps the original expression after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  // A cell address with row 0 is an invalid reference, not an unknown name.
  await user.dblClick(await cell("F1"));
  const editor = screen.getByRole("textbox", { name: "Edit F1" });
  await user.clear(editor);
  await user.type(editor, "=A0{Enter}");

  await waitFor(() => expect(cellText("F1")).toBe("#REF!"));
  // The bar keeps the expression the user submitted, not the error code.
  await selectCell(user, "F1");
  expect(formulaBar().value).toBe("=A0");

  // The stored expression is the user's text, and both persist after a reload.
  expect(cellsOf().F1).toBe("=A0");
  view.unmount();
  render(<App />);
  await grid();
  await waitFor(() => expect(cellText("F1")).toBe("#REF!"));
  await selectCell(user, "F1");
  expect(formulaBar().value).toBe("=A0");
});

test("copying a formula whose relative reference leaves the grid shows #REF! in the grid and the bar", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  // C1 holds a bare relative reference to A1, so it shows the referenced text.
  await user.dblClick(await cell("C1"));
  const editor = screen.getByRole("textbox", { name: "Edit C1" });
  await user.clear(editor);
  await user.type(editor, "=A1{Enter}");
  await waitFor(() => expect(cellText("C1")).toBe("Region"));

  // Copying it one column to the left pushes A1 off the grid.
  await user.click(screen.getByRole("gridcell", { name: "C1" }));
  await user.click(screen.getByRole("button", { name: "Copy" }));
  await user.click(screen.getByRole("gridcell", { name: "B1" }));
  await user.click(screen.getByRole("button", { name: "Paste" }));

  await waitFor(() => expect(cellsOf().B1).toBe("=#REF!"));
  expect(screen.getByRole("gridcell", { name: "B1" }).textContent).toBe("#REF!");
  expect(formulaBar().value).toBe("=#REF!");
  // The source formula and its result stay unchanged.
  expect(cellsOf().C1).toBe("=A1");
  expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toBe("Region");

  // The adjusted formula and error persist after a refresh.
  cleanup();
  render(<App />);
  await grid();
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "B1" }).textContent).toBe("#REF!"));
  await user.click(screen.getByRole("gridcell", { name: "B1" }));
  expect(formulaBar().value).toBe("=#REF!");
});

test("a formula entered in the formula bar shows its result and survives a reload", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  await selectCell(user, "B5");
  await enterFormula(user, "=SUM(B2:B4)");

  await waitFor(() => expect(cellText("B5")).toBe("2700"));
  // The bar keeps the expression the user submitted, not the result.
  expect(formulaBar().value).toBe("=SUM(B2:B4)");

  // Refreshing reloads the worksheet from the server: the expression and the
  // result recalculated from the current source values stay visible.
  view.unmount();
  render(<App />);
  await grid();
  await waitFor(() => expect(cellText("B5")).toBe("2700"));
  await selectCell(user, "B5");
  expect(formulaBar().value).toBe("=SUM(B2:B4)");
  expect(api!.workbooks[0].worksheets[0].cells.B5).toBe("=SUM(B2:B4)");
});

test("aggregate functions cover a contiguous range and ignore blank and text cells", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  // B2:B4 hold numbers, B5:B7 are blank and A2:A4 are text.
  await selectCell(user, "D1");
  await enterFormula(user, "=sum(b2:b4)");
  await selectCell(user, "D2");
  await enterFormula(user, "=AVERAGE(B2:B4)");
  await selectCell(user, "D3");
  await enterFormula(user, "=COUNT(A2:B7)");
  await selectCell(user, "D4");
  await enterFormula(user, "=MIN(B2:B4)");
  await selectCell(user, "D5");
  await enterFormula(user, "=MAX(B2:B4)");

  await waitFor(() => expect(cellText("D1")).toBe("2700"));
  expect(cellText("D2")).toBe("900");
  // COUNT counts the three numeric cells only, so the text cells and the
  // blanks in the range are never treated as zero.
  expect(cellText("D3")).toBe("3");
  expect(cellText("D4")).toBe("700");
  expect(cellText("D5")).toBe("1200");

  // Selecting a formula cell shows the original expression in the bar.
  await selectCell(user, "D3");
  expect(formulaBar().value).toBe("=COUNT(A2:B7)");
});

test("editing a source value recalculates direct and indirect dependents and persists", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  await selectCell(user, "D1");
  await enterFormula(user, "=B2+B3");
  await selectCell(user, "E1");
  await enterFormula(user, "=D1*2");
  await waitFor(() => expect(cellText("D1")).toBe("2000"));
  expect(cellText("E1")).toBe("4000");

  await selectCell(user, "B3");
  await enterFormula(user, "900");

  await waitFor(() => expect(cellText("D1")).toBe("2100"));
  expect(cellText("E1")).toBe("4200");
  await selectCell(user, "D1");
  expect(formulaBar().value).toBe("=B2+B3");

  view.unmount();
  render(<App />);
  await grid();
  await waitFor(() => expect(cellText("D1")).toBe("2100"));
  expect(cellText("E1")).toBe("4200");
});

test("bulk pasting over source cells recalculates dependent formulas", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  await selectCell(user, "D1");
  await enterFormula(user, "=B2+B3");
  await waitFor(() => expect(cellText("D1")).toBe("2000"));

  await selectCell(user, "B2");
  fireEvent(window, pasteEvent("500\n600"));

  await waitFor(() => expect(cellText("B2")).toBe("500"));
  expect(cellText("B3")).toBe("600");
  expect(cellText("D1")).toBe("1100");
  expect(api!.workbooks[0].worksheets[0].cells.D1).toBe("=B2+B3");
});

test("an error cell does not affect unrelated cells and other worksheets stay unchanged", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  await selectCell(user, "D1");
  await enterFormula(user, "=1/0");
  await selectCell(user, "E1");
  await enterFormula(user, "=B2");
  await waitFor(() => expect(cellText("D1")).toBe("#DIV/0!"));
  expect(cellText("E1")).toBe("1200");
  await selectCell(user, "E1");
  expect(formulaBar().value).toBe("=B2");

  // A formula on another worksheet that references nothing on Sheet1 keeps the
  // same result after Sheet1's source values change.
  await user.click(screen.getByRole("tab", { name: "Sheet2" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true"));
  await selectCell(user, "A1");
  await enterFormula(user, "=2*3");
  await waitFor(() => expect(cellText("A1")).toBe("6"));

  await user.click(screen.getByRole("tab", { name: "Sheet1" }));
  await selectCell(user, "B2");
  await enterFormula(user, "2500");
  await waitFor(() => expect(cellText("B2")).toBe("2500"));
  expect(cellText("E1")).toBe("2500");
  expect(cellText("D1")).toBe("#DIV/0!");

  await user.click(screen.getByRole("tab", { name: "Sheet2" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true"));
  expect(cellText("A1")).toBe("6");
  expect(api!.workbooks[0].worksheets[1].cells.A1).toBe("=2*3");
});
