import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbookEditorPage } from "../WorkbookEditorPage";
import { stubFetch, workbookFixture } from "./helpers";
import type { WorkbookData, WorksheetData } from "../types";

const EDITOR = "/api/workbooks/wb-q3-sales";
const SHEET1 = `${EDITOR}/worksheets/ws-q3-sheet1`;

/**
 * REQ-4-1-2 seen from the browser: the transfer request the grid sends carries
 * the source and target rectangle, and the answer decides the display — the
 * Formula bar of the pasted cell shows the raw expression the server stored
 * (with its references already offset) while the grid shows its result.
 * The reference arithmetic itself runs on the server and is covered by
 * `backend/test/formula-recalc-api.test.mjs`.
 */
function sheetWith(cells: Record<string, string>, values: Record<string, string>): WorkbookData {
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

/** Editor stub whose range-transfer answer is the workbook a copy would return. */
function stubCopyServer(seed: WorkbookData, answer: (current: WorkbookData) => WorkbookData) {
  let current = seed;
  const { calls } = stubFetch((request) => {
    if (request.method === "GET" && request.path === EDITOR) return { body: { workbook: current } };
    if (request.method === "PATCH" && request.path === SHEET1) return { body: { workbook: current } };
    if (request.method === "POST" && request.path === `${SHEET1}/range-transfer`) {
      current = answer(current);
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

async function openEditor() {
  render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
  await screen.findByRole("heading", { name: "Q3 Sales" });
}

/** Copies the selected cell and pastes it at `target` through the grid. */
async function copyTo(user: ReturnType<typeof userEvent.setup>, target: string) {
  fireEvent.keyDown(document, { key: "c", ctrlKey: true });
  await user.click(cell(target));
  fireEvent.paste(grid());
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  window.location.hash = "#/workbooks/wb-q3-sales";
});

describe("copying a formula to another cell", () => {
  it("shows the offset expression of the pasted cell in the Formula bar and its result in the grid", async () => {
    const user = userEvent.setup();
    const seed = sheetWith(
      { A5: "2", B5: "3", C5: "=A5+B5", A6: "4", B6: "6" },
      { A5: "2", B5: "3", C5: "5", A6: "4", B6: "6" },
    );
    // The server offsets `=A5+B5` by the target row and recalculates it.
    const { calls } = stubCopyServer(seed, () => sheetWith(
      { A5: "2", B5: "3", C5: "=A5+B5", A6: "4", B6: "6", C6: "=A6+B6" },
      { A5: "2", B5: "3", C5: "5", A6: "4", B6: "6", C6: "10" },
    ));
    await openEditor();

    await user.click(cell("C5"));
    await copyTo(user, "C6");

    const transfers = calls.filter((call) => call.path.endsWith("/range-transfer"));
    await waitFor(() => expect(transfers).toHaveLength(1));
    expect(transfers[0].body).toEqual({
      mode: "copy",
      source: { start: "C5", end: "C5" },
      target: { start: "C6", end: "C6" },
    });

    // The target shows the offset expression and the result of the new sources.
    await waitFor(() => expect(cell("C6").textContent).toBe("10"));
    await user.click(cell("C6"));
    expect(formulaBar().value).toBe("=A6+B6");
    // The source formula and its result are unchanged.
    expect(cell("C5").textContent).toBe("5");
    await user.click(cell("C5"));
    expect(formulaBar().value).toBe("=A5+B5");
    expect(cell("C5").textContent).toBe("5");
  });

  it("shows =#REF! in the Formula bar and #REF! in the grid when the offset leaves the sheet", async () => {
    const user = userEvent.setup();
    const seed = sheetWith({ A1: "5", C1: "=A1" }, { A1: "5", C1: "5" });
    stubCopyServer(seed, () => sheetWith(
      { A1: "5", C1: "=A1", B2: "=#REF!" },
      { A1: "5", C1: "5", B2: "#REF!" },
    ));
    await openEditor();

    await user.click(cell("C1"));
    await copyTo(user, "B2");

    await waitFor(() => expect(cell("B2").textContent).toBe("#REF!"));
    await user.click(cell("B2"));
    expect(formulaBar().value).toBe("=#REF!");
    // The source keeps the expression and the result it had.
    await user.click(cell("C1"));
    expect(formulaBar().value).toBe("=A1");
    expect(cell("C1").textContent).toBe("5");
  });
});
