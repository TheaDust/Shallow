import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbookEditorPage } from "../WorkbookEditorPage";
import { stubFetch, workbookFixture } from "./helpers";
import type { WorkbookData, WorksheetData } from "../types";

const EDITOR = "/api/workbooks/wb-q3-sales";
const SHEET1 = `${EDITOR}/worksheets/ws-q3-sheet1`;

/**
 * Fixture whose stored raw text (formulas) differs from the displayed values.
 * The displayed values are the ones the real server derives; the engine itself
 * is covered by `backend/test/formula.test.mjs` and `formula-api.test.mjs`.
 */
function sheetWithValues(cells: Record<string, string>, values: Record<string, string>): WorkbookData {
  const sheet: WorksheetData = {
    id: "ws-q3-sheet1",
    name: "Sheet1",
    activeCell: "A1",
    selectionFocus: "A1",
    cells,
    values,
    validations: [],
  };
  const blank: WorksheetData = {
    id: "ws-q3-sheet2",
    name: "Sheet2",
    activeCell: "A1",
    selectionFocus: "A1",
    cells: {},
    values: {},
    validations: [],
  };
  return workbookFixture({ worksheets: [sheet, blank] });
}

type Answer = (current: WorkbookData, updates: Record<string, string>) => WorkbookData;

/**
 * Editor stub that keeps serving the latest successful state: a cell write
 * answers with the workbook the real server would return, so the grid and the
 * formula bar only change from the server answer.
 */
function stubEditor(seed: WorkbookData, answer?: Answer) {
  let current = seed;
  const { calls } = stubFetch((request) => {
    if (request.method === "GET" && request.path === EDITOR) {
      return { body: { workbook: current } };
    }
    if (request.method === "PATCH" && request.path === SHEET1) {
      const patch = request.body ?? {};
      current = {
        ...current,
        worksheets: current.worksheets.map((sheet) =>
          sheet.id === "ws-q3-sheet1"
            ? {
              ...sheet,
              activeCell: patch.activeCell ?? sheet.activeCell,
              selectionFocus: patch.selectionFocus ?? sheet.selectionFocus,
            }
            : sheet),
      };
      return { body: { workbook: current } };
    }
    if (request.method === "POST" && request.path === `${SHEET1}/cells`) {
      if (answer) current = answer(current, request.body?.updates ?? {});
      return { body: { workbook: current } };
    }
    return undefined;
  });
  return { calls };
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

/** Types `text` into the Formula bar of the selected cell and commits it. */
async function enterInCell(user: ReturnType<typeof userEvent.setup>, address: string, text: string) {
  await user.click(cell(address));
  await user.clear(formulaBar());
  await user.type(formulaBar(), `${text}{Enter}`);
}

/** Reopens the editor page, the way a refresh does. */
async function reopen() {
  cleanup();
  render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
  await screen.findByRole("heading", { name: "Q3 Sales" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.location.hash = "#/workbooks/wb-q3-sales";
});

describe("formula calculation in the grid and the Formula bar", () => {
  it("shows the result of an entered expression in the grid and the expression itself in the Formula bar", async () => {
    const user = userEvent.setup();
    // The seeded workbook keeps `Region` in A1, so the formula state is entered
    // through the public cell path: A1=2, B1=3, C1==A1+B1, D1==C1*2.
    const answer: Answer = (current, updates) => {
      const cells = { ...current.worksheets[0].cells, ...updates };
      const values: Record<string, string> = { ...cells };
      if (cells.C1 === "=A1+B1") values.C1 = String(Number(cells.A1 || 0) + Number(cells.B1 || 0));
      if (cells.D1 === "=C1*2") values.D1 = String(Number(values.C1 || 0) * 2);
      return sheetWithValues(cells, values);
    };
    const { calls } = stubEditor(workbookFixture(), answer);
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    await enterInCell(user, "A1", "2");
    await enterInCell(user, "B1", "3");
    await enterInCell(user, "C1", "=A1+B1");
    await enterInCell(user, "D1", "=C1*2");

    await waitFor(() => expect(cell("D1").textContent).toBe("10"));
    expect(cell("A1").textContent).toBe("2");
    expect(cell("B1").textContent).toBe("3");
    expect(cell("C1").textContent).toBe("5");
    expect(calls.some((call) => call.body?.updates?.C1 === "=A1+B1")).toBe(true);

    // Selecting a formula cell shows the submitted expression, not the result.
    await user.click(cell("C1"));
    expect(formulaBar().value).toBe("=A1+B1");
    expect(cell("C1").textContent).toBe("5");
    await user.click(cell("D1"));
    expect(formulaBar().value).toBe("=C1*2");

    // A refresh reopens the stored expressions with the same results.
    await reopen();
    expect(cell("C1").textContent).toBe("5");
    expect(cell("D1").textContent).toBe("10");
    await user.click(cell("C1"));
    expect(formulaBar().value).toBe("=A1+B1");
  });

  it("keeps an error value in the grid with its expression, and clears it after a valid formula", async () => {
    const user = userEvent.setup();
    const answer: Answer = (current, updates) => {
      const cells = { ...current.worksheets[0].cells, ...updates };
      const values: Record<string, string> = { ...cells };
      if (cells.B1 === "=1/A1") {
        values.B1 = "#DIV/0!";
        values.D1 = "#DIV/0!";
      } else if (cells.B1 === "=A1+1") {
        values.B1 = String(Number(cells.A1 || 0) + 1);
        values.D1 = String(Number(values.B1) * 2);
      }
      return sheetWithValues(cells, values);
    };
    const seed = sheetWithValues({ A1: "0", B1: "=1/A1", D1: "=B1*2" }, { A1: "0", B1: "#DIV/0!", D1: "#DIV/0!" });
    const { calls } = stubEditor(seed, answer);
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    expect(cell("B1").textContent).toBe("#DIV/0!");
    expect(cell("D1").textContent).toBe("#DIV/0!");
    await user.click(cell("B1"));
    expect(formulaBar().value).toBe("=1/A1");

    // An error cell does not block editing or recalculating other cells.
    await enterInCell(user, "A2", "North");
    await waitFor(() => expect(cell("A2").textContent).toBe("North"));
    expect(cell("B1").textContent).toBe("#DIV/0!");
    await enterInCell(user, "E1", "=A2");
    expect(calls.some((call) => call.body?.updates?.A2 === "North")).toBe(true);

    // Correcting the formula replaces the error value and updates dependents.
    await enterInCell(user, "B1", "=A1+1");
    await waitFor(() => expect(cell("B1").textContent).toBe("1"));
    expect(cell("D1").textContent).toBe("2");
    await user.click(cell("B1"));
    expect(formulaBar().value).toBe("=A1+1");

    // The error no longer appears after a refresh.
    await reopen();
    expect(cell("B1").textContent).toBe("1");
    expect(cell("D1").textContent).toBe("2");
    expect(within(grid()).queryByText("#DIV/0!")).toBeNull();
    await user.click(cell("B1"));
    expect(formulaBar().value).toBe("=A1+1");
  });

  it("keeps the error and the last successful expression when a commit is rejected", async () => {
    const user = userEvent.setup();
    const seed = sheetWithValues({ A1: "0", B1: "=1/A1" }, { A1: "0", B1: "#DIV/0!" });
    stubFetch((request) => {
      if (request.method === "GET" && request.path === EDITOR) return { body: { workbook: seed } };
      if (request.method === "PATCH" && request.path === SHEET1) return { body: { workbook: seed } };
      if (request.method === "POST" && request.path === `${SHEET1}/cells`) {
        return { status: 400, body: { error: "Invalid cell value" } };
      }
      return undefined;
    });
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    await user.click(cell("B1"));
    expect(formulaBar().value).toBe("=1/A1");
    await user.clear(formulaBar());
    await user.type(formulaBar(), "=1/A1+{Enter}");

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Invalid cell value"));
    expect(cell("B1").textContent).toBe("#DIV/0!");
    expect(formulaBar().value).toBe("=1/A1");
  });
});
