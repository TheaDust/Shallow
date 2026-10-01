/**
 * REQ-4-1-1 / REQ-4-2-2 in the workbook editor: the grid shows the result calculated from the
 * current source values while the `Formula bar` keeps the expression the user submitted, an
 * error cell keeps its original formula and can be changed back into a valid formula, and both
 * survive reopening the workbook. Values always come from the server (`values` of the worksheet),
 * which the API double mirrors.
 */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import type { WorksheetState } from "../domain/workbook";
import {
  SHEET1,
  SHEET2,
  WORKBOOK_ID,
  installFakeWorkbookApi,
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

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "#/";
});

describe("calculated results, the Formula bar and formula errors", () => {
  it("shows the seeded formula results in the grid and the submitted formula in the Formula bar", async () => {
    installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(cell("A1").textContent).toBe("2");
    expect(cell("C1").textContent).toBe("5");
    expect(cell("D1").textContent).toBe("10");

    await user.click(cell("C1"));
    expect(formulaBar().value).toBe("=A1+B1");
    await user.click(cell("D1"));
    expect(formulaBar().value).toBe("=C1*2");
  });

  it("shows the aggregate result in the grid and the expression in the Formula bar", async () => {
    const api = installFakeWorkbookApi();
    // The server computes `=SUM(B2:B3)` from the seeded 1200 and 800; the double serves that value.
    const sheet = sheetOf(api, SHEET1);
    sheet.cells.D1 = "=SUM(B2:B3)";
    sheet.values = { ...sheet.values, D1: "2000" };

    const user = userEvent.setup();
    await openEditor();

    await user.click(cell("D1"));
    expect(cell("D1").textContent).toBe("2000");
    expect(formulaBar().value).toBe("=SUM(B2:B3)");
  });

  it("recalculates the seeded chain after a source edit and keeps it after reopening", async () => {
    const api = installFakeWorkbookApi();
    const user = userEvent.setup();
    const view = await openEditor();

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(cell("B1"));
    expect(formulaBar().value).toBe("3");
    await user.clear(formulaBar());
    await user.type(formulaBar(), "5");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(cell("C1").textContent).toBe("7"));
    expect(cell("D1").textContent).toBe("14");
    const commit = api.calls.find((call) => call.method === "PUT");
    expect(commit?.path).toBe(`/api/workbooks/${WORKBOOK_ID}/sheets/${SHEET2}/cells/B1`);
    expect(commit?.body).toEqual({ value: "5" });

    // Reopening the workbook restores the expression and the result it produces today.
    view.unmount();
    await openEditor();
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(cell("C1"));
    expect(formulaBar().value).toBe("=A1+B1");
    expect(cell("C1").textContent).toBe("7");
    expect(cell("D1").textContent).toBe("14");
  });

  it("keeps the formula of an error cell, leaves other cells alone and updates its dependents after a fix", async () => {
    const api = installFakeWorkbookApi();
    const sheet = sheetOf(api, SHEET2);
    // The server would answer with these values: C1 errors, its dependent D1 carries the error,
    // and the unrelated E1 is calculated normally.
    sheet.cells = { ...sheet.cells, C1: "=1/0", D1: "=C1*2", E1: "=A1+B1" };
    sheet.values = { A1: "2", B1: "3", C1: "#DIV/0!", D1: "#DIV/0!", E1: "5" };

    const user = userEvent.setup();
    const view = await openEditor();
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));

    await user.click(cell("C1"));
    expect(cell("C1").textContent).toBe("#DIV/0!");
    expect(formulaBar().value).toBe("=1/0");

    // The error cell neither blocks the neighbouring cells nor their results.
    await user.click(cell("E1"));
    expect(cell("E1").textContent).toBe("5");
    expect(formulaBar().value).toBe("=A1+B1");
    expect(cell("D1").textContent).toBe("#DIV/0!");

    await user.click(cell("C1"));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "=A1+B1");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(cell("C1").textContent).toBe("5"));
    expect(formulaBar().value).toBe("=A1+B1");
    expect(cell("D1").textContent).toBe("10");
    expect(cell("E1").textContent).toBe("5");

    // After a fresh page load the new result and its dependents are shown and the error is gone.
    view.unmount();
    await openEditor();
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(cell("C1"));
    expect(cell("C1").textContent).toBe("5");
    expect(cell("D1").textContent).toBe("10");
    expect(formulaBar().value).toBe("=A1+B1");
  });
});
