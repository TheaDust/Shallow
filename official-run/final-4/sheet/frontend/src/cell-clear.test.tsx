import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import type { Workbook } from "./domain/types";
import { installFakeApi, type FakeApi } from "./test/fake-api";

/** Stable ids of the pre-provisioned clear-with-Delete workbooks (see the backend seed). */
export const CLEAR_TEXT_WORKBOOK_ID = "EVO-M03-CLEAR-TEXT";
export const CLEAR_TEXT_WORKSHEET_ID = "ws-evo-m03-clear-text-staging";
export const CLEAR_FORMULA_WORKBOOK_ID = "EVO-M03-CLEAR-FORMULA";
export const CLEAR_FORMULA_WORKSHEET_ID = "ws-evo-m03-clear-formula-calculations";
export const CLEAR_RANGE_WORKBOOK_ID = "EVO-M03-CLEAR-RANGE";
export const CLEAR_RANGE_WORKSHEET_ID = "ws-evo-m03-clear-range-matrix";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

/** One pre-provisioned workbook whose visible name equals its stable id. */
function workbook(id: string, worksheetId: string, name: string, cells: Record<string, string>): Workbook {
  return {
    id,
    name: id,
    createdAt: "2026-09-05T08:35:00.000Z",
    updatedAt: "2026-09-06T08:35:00.000Z",
    activeWorksheetId: worksheetId,
    worksheets: [{ id: worksheetId, name, selection: { anchor: "A1", focus: "A1" }, cells }],
  };
}

function clearTextWorkbook(): Workbook {
  return workbook(CLEAR_TEXT_WORKBOOK_ID, CLEAR_TEXT_WORKSHEET_ID, "Staging", { H4: "obsolete tag" });
}

function clearFormulaWorkbook(): Workbook {
  return workbook(CLEAR_FORMULA_WORKBOOK_ID, CLEAR_FORMULA_WORKSHEET_ID, "Calculations", {
    B7: "13",
    C7: "=B7*5",
    D7: "=C7+2",
  });
}

function clearRangeWorkbook(): Workbook {
  return workbook(CLEAR_RANGE_WORKBOOK_ID, CLEAR_RANGE_WORKSHEET_ID, "Matrix", {
    H4: "Amber",
    I4: "Delta",
    H5: "Kite",
    I5: "Orchid",
  });
}

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function cell(name: string): HTMLElement {
  return screen.getByRole("gridcell", { name });
}

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
}

function batchUrl(workbookId: string, worksheetId: string): string {
  return `/api/workbooks/${workbookId}/worksheets/${worksheetId}/cells/batch`;
}

/** Opens one pre-provisioned workbook through its deep link. */
function openWorkbook(book: Workbook) {
  window.location.hash = `#/workbooks/${book.id}`;
  api = installFakeApi([book]);
  return render(<App />);
}

test("Delete clears the selected text cell and the formula bar stays empty after refresh", async () => {
  const user = userEvent.setup();
  const view = openWorkbook(clearTextWorkbook());
  await grid();

  await user.click(cell("H4"));
  expect(cell("H4").getAttribute("aria-selected")).toBe("true");
  expect(formulaBar().value).toBe("obsolete tag");

  await user.keyboard("{Delete}");

  expect(cell("H4").textContent).toBe("");
  expect(formulaBar().value).toBe("");
  // The cleared cell stays selected and the empty text is persisted.
  expect(cell("H4").getAttribute("aria-selected")).toBe("true");
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].cells.H4).toBeUndefined());
  await waitFor(() => expect(formulaBar().value).toBe(""));

  view.unmount();
  render(<App />);
  await grid();
  expect(cell("H4").textContent).toBe("");
  expect(api!.workbooks[0].worksheets[0].cells.H4).toBeUndefined();
  await user.click(cell("H4"));
  expect(formulaBar().value).toBe("");
});

test("Delete on a formula cell removes the formula and its dependent result recalculates", async () => {
  const user = userEvent.setup();
  const view = openWorkbook(clearFormulaWorkbook());
  await grid();

  await user.click(cell("C7"));
  expect(formulaBar().value).toBe("=B7*5");
  expect(cell("C7").textContent).toBe("65");
  expect(cell("D7").textContent).toBe("67");

  await user.keyboard("{Delete}");

  expect(cell("C7").textContent).toBe("");
  expect(formulaBar().value).toBe("");
  // The dependent formula keeps its own expression and now reads the empty cell.
  expect(cell("D7").textContent).toBe("2");
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].cells.C7).toBeUndefined());
  expect(api!.workbooks[0].worksheets[0].cells.D7).toBe("=C7+2");

  view.unmount();
  render(<App />);
  await grid();
  expect(cell("C7").textContent).toBe("");
  expect(cell("D7").textContent).toBe("2");
  await user.click(cell("D7"));
  expect(formulaBar().value).toBe("=C7+2");
});

test("Delete clears every cell of the selected rectangle and keeps the selection", async () => {
  const user = userEvent.setup();
  const view = openWorkbook(clearRangeWorkbook());
  await grid();

  fireEvent.mouseDown(cell("H4"));
  fireEvent.mouseOver(cell("I5"), { buttons: 1 });
  fireEvent.mouseUp(cell("I5"));
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].selection).toEqual({ anchor: "H4", focus: "I5" }));

  await user.keyboard("{Delete}");

  for (const name of ["H4", "I4", "H5", "I5"]) {
    expect(cell(name).textContent).toBe("");
    expect(cell(name).getAttribute("aria-selected")).toBe("true");
  }
  // Cells outside the rectangle keep their values.
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].cells.H4).toBeUndefined());
  expect(api!.workbooks[0].worksheets[0].cells).toEqual({});

  view.unmount();
  render(<App />);
  await grid();
  for (const name of ["H4", "I4", "H5", "I5"]) {
    expect(cell(name).textContent).toBe("");
  }
});

test("a failed clear reports an error and keeps the last successful values", async () => {
  const user = userEvent.setup();
  api = installFakeApi([
    { ...clearTextWorkbook() },
    { ...clearFormulaWorkbook() },
  ]);
  window.location.hash = `#/workbooks/${CLEAR_TEXT_WORKBOOK_ID}`;
  render(<App />);
  await grid();

  api.failOnce("POST", batchUrl(CLEAR_TEXT_WORKBOOK_ID, CLEAR_TEXT_WORKSHEET_ID));
  await user.click(cell("H4"));
  await user.keyboard("{Delete}");

  expect((await screen.findByRole("alert")).textContent).toBe("Server error");
  expect(cell("H4").textContent).toBe("obsolete tag");
  await waitFor(() => expect(formulaBar().value).toBe("obsolete tag"));
  expect(api.workbooks[0].worksheets[0].cells.H4).toBe("obsolete tag");

  // The same failure keeps a formula and its dependent result unchanged.
  window.location.hash = `#/workbooks/${CLEAR_FORMULA_WORKBOOK_ID}`;
  cleanup();
  render(<App />);
  await grid();
  api.failOnce("POST", batchUrl(CLEAR_FORMULA_WORKBOOK_ID, CLEAR_FORMULA_WORKSHEET_ID));
  await user.click(cell("C7"));
  await user.keyboard("{Delete}");

  expect((await screen.findByRole("alert")).textContent).toBe("Server error");
  expect(cell("C7").textContent).toBe("65");
  expect(cell("D7").textContent).toBe("67");
  await waitFor(() => expect(formulaBar().value).toBe("=B7*5"));
  expect(api.workbooks[1].worksheets[0].cells.C7).toBe("=B7*5");
});

test("Delete inside the formula bar edits its text instead of clearing the cell", async () => {
  const user = userEvent.setup();
  openWorkbook(clearTextWorkbook());
  await grid();

  await user.click(cell("H4"));
  await user.click(formulaBar());
  await user.keyboard("{Delete}");

  expect(cell("H4").textContent).toBe("obsolete tag");
  expect(api!.workbooks[0].worksheets[0].cells.H4).toBe("obsolete tag");
});
