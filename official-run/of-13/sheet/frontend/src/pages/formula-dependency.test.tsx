/**
 * REQ-4-2-1 / REQ-4-1-2 in the workbook editor.
 *
 * Copying a formula rewrites its relative references for the target offset while keeping the
 * source formula and its result; a reference that would leave the grid shows `=#REF!` in the
 * formula bar and `#REF!` in the grid. A row/column structure change moves the referenced data
 * together with the formulas that read it, so the grid shows results consistent with the
 * current source values — after the change, after reopening and without touching the formulas
 * of another worksheet.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import type { WorksheetState } from "../domain/workbook";
import {
  SHEET1,
  SHEET2,
  WORKBOOK_ID,
  installFakeWorkbookApi,
  recalculated,
} from "../test/fake-workbook-api";

async function openEditor() {
  window.location.hash = `#/workbooks/${WORKBOOK_ID}`;
  const view = render(<App />);
  await screen.findByRole("grid", { name: "Worksheet grid" });
  return view;
}

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function cell(address: string) {
  return within(grid()).getByRole("gridcell", { name: address });
}

function formulaBar() {
  return screen.getByLabelText("Formula bar") as HTMLInputElement;
}

function sheetOf(api: ReturnType<typeof installFakeWorkbookApi>, sheetId: string): WorksheetState {
  const sheet = api.workbooks[0].sheets.find((entry) => entry.id === sheetId);
  if (!sheet) throw new Error(`missing worksheet ${sheetId}`);
  return sheet;
}

/** Writes cells into the double the way the server would answer the next read. */
function seedCells(
  api: ReturnType<typeof installFakeWorkbookApi>,
  sheetId: string,
  cells: Record<string, string>,
) {
  const sheet = sheetOf(api, sheetId);
  sheet.cells = { ...sheet.cells, ...cells };
  sheet.values = recalculated(sheet.cells);
}

async function openStructureCommand(header: "row" | "column", name: string, command: string) {
  const user = userEvent.setup();
  fireEvent.contextMenu(
    within(grid()).getByRole(header === "row" ? "rowheader" : "columnheader", { name }),
    { clientX: 12, clientY: 18 },
  );
  await user.click(screen.getByRole("menuitem", { name: command }));
}

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "#/";
});

describe("copied formulas and dependent recalculation", () => {
  it("adjusts the relative references of a copied formula and keeps the source and its result", async () => {
    const api = installFakeWorkbookApi();
    seedCells(api, SHEET2, { A2: "10", B2: "20", C2: "=A2+B2" });
    const user = userEvent.setup();
    const view = await openEditor();

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(cell("C2"));
    expect(cell("C2").textContent).toBe("30");
    expect(formulaBar().value).toBe("=A2+B2");

    // Copy the formula one row up: the relative references follow the target offset.
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await user.click(cell("C1"));
    await user.click(screen.getByRole("button", { name: "Paste" }));

    await waitFor(() => expect(cell("C1").textContent).toBe("5"));
    await user.click(cell("C1"));
    expect(formulaBar().value).toBe("=A1+B1");
    // The copied source keeps its own formula and result.
    await user.click(cell("C2"));
    expect(formulaBar().value).toBe("=A2+B2");
    expect(cell("C2").textContent).toBe("30");

    view.unmount();
    await openEditor();
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(cell("C1"));
    expect(formulaBar().value).toBe("=A1+B1");
    expect(cell("C1").textContent).toBe("5");
  });

  it("shows =#REF! and #REF! when a copied relative reference leaves the grid", async () => {
    const api = installFakeWorkbookApi();
    seedCells(api, SHEET2, { E2: "=A1" });
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(cell("E2"));
    expect(cell("E2").textContent).toBe("2");
    expect(formulaBar().value).toBe("=A1");

    // Copying one row up would ask for `A0`, so the reference cannot be preserved.
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await user.click(cell("E1"));
    await user.click(screen.getByRole("button", { name: "Paste" }));

    await waitFor(() => expect(cell("E1").textContent).toBe("#REF!"));
    await user.click(cell("E1"));
    expect(formulaBar().value).toBe("=#REF!");
    // The source keeps its own reference and result.
    await user.click(cell("E2"));
    expect(formulaBar().value).toBe("=A1");
    expect(cell("E2").textContent).toBe("2");
  });

  it("recalculates the dependent chain after a row insertion and keeps it after reopening", async () => {
    const api = installFakeWorkbookApi();
    seedCells(api, SHEET1, { D1: "=B2+B3" });
    const user = userEvent.setup();
    const view = await openEditor();

    await user.click(cell("D1"));
    expect(cell("D1").textContent).toBe("2000");
    expect(formulaBar().value).toBe("=B2+B3");

    await openStructureCommand("row", "1", "Insert 1 row above");

    // The record and the formula that reads it moved down together.
    await waitFor(() => expect(cell("D2").textContent).toBe("2000"));
    await user.click(cell("D2"));
    expect(formulaBar().value).toBe("=B3+B4");
    expect(cell("B3").textContent).toBe("1200");
    expect(cell("B4").textContent).toBe("800");
    // The other worksheet's formulas keep their own source values.
    const other = sheetOf(api, SHEET2);
    expect(other.cells.C1).toBe("=A1+B1");

    view.unmount();
    await openEditor();
    await user.click(cell("D2"));
    expect(cell("D2").textContent).toBe("2000");
    expect(formulaBar().value).toBe("=B3+B4");
  });

  it("shows #REF! after deleting a referenced row without disturbing unrelated formulas", async () => {
    const api = installFakeWorkbookApi();
    seedCells(api, SHEET2, { A3: "7", E1: "=A3*2" });
    const user = userEvent.setup();
    const view = await openEditor();

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(cell("E1"));
    expect(cell("E1").textContent).toBe("14");
    expect(formulaBar().value).toBe("=A3*2");

    await openStructureCommand("row", "3", "Delete row");

    await waitFor(() => expect(cell("E1").textContent).toBe("#REF!"));
    await user.click(cell("E1"));
    expect(formulaBar().value).toBe("=#REF!*2");
    // The chain that did not read the deleted row keeps its formula and its result.
    await user.click(cell("C1"));
    expect(formulaBar().value).toBe("=A1+B1");
    expect(cell("C1").textContent).toBe("5");

    view.unmount();
    await openEditor();
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(cell("E1"));
    expect(cell("E1").textContent).toBe("#REF!");
    expect(formulaBar().value).toBe("=#REF!*2");
  });

  it("shows #REF! for an A1 address with row 0 and replaces it once the formula is fixed", async () => {
    const api = installFakeWorkbookApi();
    const user = userEvent.setup();
    const view = await openEditor();

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(cell("D11"));
    await user.type(formulaBar(), "=A0");
    await user.keyboard("{Enter}");

    // Row 0 is an invalid reference: the grid shows the stable error value and the bar keeps
    // the text the user submitted; the seeded formulas keep their own results.
    await waitFor(() => expect(cell("D11").textContent).toBe("#REF!"));
    await user.click(cell("D11"));
    expect(formulaBar().value).toBe("=A0");
    expect(cell("C1").textContent).toBe("5");
    expect(cell("D1").textContent).toBe("10");

    view.unmount();
    const reopened = await openEditor();
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(cell("D11"));
    expect(cell("D11").textContent).toBe("#REF!");
    expect(formulaBar().value).toBe("=A0");
    expect(sheetOf(api, SHEET2).cells.D11).toBe("=A0");

    // A valid replacement shows the new result and no longer shows the error after a reopen.
    await user.clear(formulaBar());
    await user.type(formulaBar(), "=A1+1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(cell("D11").textContent).toBe("3"));
    expect(formulaBar().value).toBe("=A1+1");

    reopened.unmount();
    await openEditor();
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(cell("D11"));
    expect(cell("D11").textContent).toBe("3");
    expect(formulaBar().value).toBe("=A1+1");
  });

  it("moves the formulas of the shifted columns with an inserted column", async () => {
    const api = installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(cell("C1"));
    expect(formulaBar().value).toBe("=A1+B1");

    await openStructureCommand("column", "B", "Insert 1 column left");

    await waitFor(() => expect(cell("D1").textContent).toBe("5"));
    await user.click(cell("D1"));
    expect(formulaBar().value).toBe("=A1+C1");
    await user.click(cell("E1"));
    expect(formulaBar().value).toBe("=D1*2");
    expect(cell("E1").textContent).toBe("10");
  });
});
