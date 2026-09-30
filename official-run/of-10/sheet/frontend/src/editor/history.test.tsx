import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fakeApi";
import type { WorksheetData } from "../workbooks/types";

/**
 * REQ-3-2-2: the toolbar buttons "Undo" and "Redo" (and Ctrl+Z / Ctrl+Y) step the session history of
 * the current workbook through cell edits, bulk pastes, range moves and structure changes.
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

function workbook() {
  return api.state.workbooks[0];
}

function sheet(): WorksheetData {
  return workbook().worksheets[0];
}

const cell = (grid: HTMLElement, name: string) => within(grid).getByRole("gridcell", { name });
const cellText = (grid: HTMLElement, name: string) => cell(grid, name).textContent;

function button(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

const undoButton = () => button("Undo");
const redoButton = () => button("Redo");

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
}

/** Types a value into the labelled formula bar and commits it with Enter, like a user would. */
async function typeIntoFormulaBar(cellId: string, text: string) {
  const grid = screen.getByRole("grid", { name: "Worksheet grid" });
  await user.click(cell(grid, cellId));
  await user.clear(formulaBar());
  await user.type(formulaBar(), `${text}{Enter}`);
}

function dragSelect(grid: HTMLElement, from: string, to: string) {
  fireEvent.mouseDown(cell(grid, from));
  fireEvent.mouseEnter(cell(grid, to));
  fireEvent.mouseUp(cell(grid, to));
}

async function openRowMenu(grid: HTMLElement, row: number) {
  fireEvent.contextMenu(within(grid).getByRole("rowheader", { name: String(row) }), {
    clientX: 60,
    clientY: 90,
  });
  return screen.findByRole("menu", { name: `Row ${row} menu` });
}

describe("the Undo and Redo commands of the toolbar", () => {
  it("starts disabled and undoes a cell edit written through the formula bar, redoing it again", async () => {
    const grid = await openSeedWorkbook();
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);

    await typeIntoFormulaBar("D1", "East");
    await waitFor(() => expect(sheet().cells.D1?.value).toBe("East"));
    expect(cellText(grid, "D1")).toBe("East");
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);

    await user.click(undoButton());
    await waitFor(() => expect(sheet().cells.D1).toBeUndefined());
    expect(cellText(grid, "D1")).toBe("");
    expect(formulaBar().value).toBe("");
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);

    await user.click(redoButton());
    await waitFor(() => expect(sheet().cells.D1?.value).toBe("East"));
    expect(cellText(grid, "D1")).toBe("East");

    cleanup();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(cellText(reopened, "D1")).toBe("East");
    expect(sheet().cells.D1?.value).toBe("East");
  });

  it("performs the same two commands with Ctrl+Z and Ctrl+Y", async () => {
    const grid = await openSeedWorkbook();

    await user.dblClick(cell(grid, "D1"));
    await user.type(within(grid).getByRole("textbox", { name: "Edit D1" }), "East{Enter}");
    await waitFor(() => expect(sheet().cells.D1?.value).toBe("East"));

    fireEvent.keyDown(grid, { key: "z", ctrlKey: true });
    await waitFor(() => expect(sheet().cells.D1).toBeUndefined());
    expect(cellText(grid, "D1")).toBe("");

    fireEvent.keyDown(grid, { key: "y", ctrlKey: true });
    await waitFor(() => expect(sheet().cells.D1?.value).toBe("East"));
    expect(cellText(grid, "D1")).toBe("East");
  });

  it("undoes consecutive changes in reverse order and replays the whole branch with redo", async () => {
    const grid = await openSeedWorkbook();

    await typeIntoFormulaBar("D1", "East");
    await typeIntoFormulaBar("D2", "North");
    await typeIntoFormulaBar("D3", "South");
    await waitFor(() => expect(sheet().cells.D3?.value).toBe("South"));

    await user.click(undoButton());
    await waitFor(() => expect(sheet().cells.D3).toBeUndefined());
    expect(sheet().cells.D2?.value).toBe("North");

    await user.click(undoButton());
    await waitFor(() => expect(sheet().cells.D2).toBeUndefined());
    expect(sheet().cells.D1?.value).toBe("East");

    await user.click(undoButton());
    await waitFor(() => expect(sheet().cells.D1).toBeUndefined());
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);

    await user.click(redoButton());
    await waitFor(() => expect(sheet().cells.D1?.value).toBe("East"));
    expect(cellText(grid, "D1")).toBe("East");
    expect(sheet().cells.D2).toBeUndefined();

    await user.click(redoButton());
    await waitFor(() => expect(sheet().cells.D2?.value).toBe("North"));
    expect(sheet().cells.D3).toBeUndefined();
  });

  it("disables Redo after a new change and does not let Ctrl+Y restore the replaced branch", async () => {
    const grid = await openSeedWorkbook();

    await typeIntoFormulaBar("D1", "East");
    await user.click(undoButton());
    await waitFor(() => expect(sheet().cells.D1).toBeUndefined());
    expect(redoButton().disabled).toBe(false);

    await typeIntoFormulaBar("E1", "West");
    await waitFor(() => expect(sheet().cells.E1?.value).toBe("West"));
    expect(redoButton().disabled).toBe(true);

    fireEvent.keyDown(grid, { key: "y", ctrlKey: true });
    expect(sheet().cells.D1).toBeUndefined();
    expect(sheet().cells.E1?.value).toBe("West");
    expect(cellText(grid, "E1")).toBe("West");

    // The new change itself is undoable and restores the state the first undo left.
    await user.click(undoButton());
    await waitFor(() => expect(sheet().cells.E1).toBeUndefined());
    expect(sheet().cells.D1).toBeUndefined();
  });

  it("undoes a bulk paste of a two dimensional table", async () => {
    const grid = await openSeedWorkbook();

    await user.click(cell(grid, "D1"));
    fireEvent.paste(grid, { clipboardData: { getData: () => "East\t1200\nNorth\t800" } });
    await waitFor(() => expect(sheet().cells.D1?.value).toBe("East"));
    expect(sheet().cells.E1?.value).toBe("1200");
    expect(sheet().cells.D2?.value).toBe("North");
    expect(sheet().cells.E2?.value).toBe("800");

    await user.click(undoButton());
    await waitFor(() => expect(sheet().cells.D1).toBeUndefined());
    expect(sheet().cells.E1).toBeUndefined();
    expect(sheet().cells.D2).toBeUndefined();
    expect(sheet().cells.E2).toBeUndefined();
    expect(cellText(grid, "D2")).toBe("");
    expect(sheet().cells.A1?.value).toBe("Region");
  });

  it("undoes a cut range move, bringing back the target and the cleared source", async () => {
    const grid = await openSeedWorkbook();

    dragSelect(grid, "A1", "B2");
    await user.click(button("Cut"));
    await user.click(cell(grid, "D1"));
    fireEvent.paste(grid, { clipboardData: { getData: () => "" } });
    await waitFor(() => expect(sheet().cells.D1?.value).toBe("Region"));
    expect(sheet().cells.E2?.value).toBe("1200");
    expect(sheet().cells.A1).toBeUndefined();
    expect(sheet().cells.B2).toBeUndefined();

    await user.click(undoButton());
    await waitFor(() => expect(sheet().cells.A1?.value).toBe("Region"));
    expect(sheet().cells.B2?.value).toBe("1200");
    expect(sheet().cells.D1).toBeUndefined();
    expect(sheet().cells.E2).toBeUndefined();
    expect(cellText(grid, "A1")).toBe("Region");

    await user.click(redoButton());
    await waitFor(() => expect(sheet().cells.D1?.value).toBe("Region"));
    expect(sheet().cells.A1).toBeUndefined();
    expect(sheet().cells.B2).toBeUndefined();

    cleanup();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(cellText(reopened, "D1")).toBe("Region");
    expect(cellText(reopened, "A1")).toBe("");
  });

  it("undoes a deleted row and restores the rule range it carried", async () => {
    sheet().validations = [
      {
        id: "vr_1",
        type: "numberRange",
        range: { top: 1, bottom: 2, left: 1, right: 2 },
        min: 0,
        max: 100,
        message: "Please enter a number from 0 to 100",
      },
    ];
    const grid = await openSeedWorkbook();

    const menu = await openRowMenu(grid, 2);
    await user.click(within(menu).getByRole("menuitem", { name: "Delete row" }));
    await waitFor(() => expect(sheet().cells.A2?.value).toBe("North"));
    expect(sheet().cells.A3?.value).toBe("South");
    expect(sheet().validations?.[0].range).toEqual({ top: 1, bottom: 1, left: 1, right: 2 });

    await user.click(undoButton());
    await waitFor(() => expect(sheet().cells.A2?.value).toBe("East"));
    expect(sheet().cells.A3?.value).toBe("North");
    expect(sheet().cells.A4?.value).toBe("South");
    expect(sheet().validations?.[0].range).toEqual({ top: 1, bottom: 2, left: 1, right: 2 });
    expect(cellText(grid, "B2")).toBe("1200");

    await user.click(redoButton());
    await waitFor(() => expect(sheet().cells.A2?.value).toBe("North"));
    expect(sheet().cells.A3?.value).toBe("South");
    expect(sheet().validations?.[0].range).toEqual({ top: 1, bottom: 1, left: 1, right: 2 });
  });

  it("keeps the history of one workbook out of another workbook", async () => {
    api.state.workbooks.push({
      id: "wb_other",
      name: "Other book",
      createdAt: "2026-09-28T11:00:00.000Z",
      updatedAt: "2026-09-28T11:00:00.000Z",
      activeWorksheetId: "ws_other_sheet1",
      worksheets: [
        {
          id: "ws_other_sheet1",
          name: "Sheet1",
          rowCount: 12,
          columnCount: 6,
          cells: { A1: { value: "Keep" } },
          validations: [],
          filter: null,
          selection: { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } },
        },
      ],
    });

    const grid = await openSeedWorkbook();
    await typeIntoFormulaBar("D1", "East");
    await waitFor(() => expect(sheet().cells.D1?.value).toBe("East"));

    // The other workbook has its own history: an edit there does not enable Undo in the first one.
    await user.click(screen.getByRole("link", { name: "All workbooks" }));
    await user.click(await screen.findByRole("link", { name: "Other book" }));
    const otherGrid = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(undoButton().disabled).toBe(true);
    expect(cellText(otherGrid, "A1")).toBe("Keep");
    expect(sheet().cells.D1?.value).toBe("East");

    await typeIntoFormulaBar("B1", "Other value");
    await waitFor(() => expect(api.state.workbooks[1].worksheets[0].cells.B1?.value).toBe("Other value"));
    expect(undoButton().disabled).toBe(false);

    await user.click(undoButton());
    await waitFor(() => expect(api.state.workbooks[1].worksheets[0].cells.B1).toBeUndefined());
    // Undoing in the other workbook leaves the first workbook and its own history alone.
    expect(sheet().cells.D1?.value).toBe("East");
    expect(api.state.workbooks[1].worksheets[0].cells.A1?.value).toBe("Keep");

    await user.click(screen.getByRole("link", { name: "All workbooks" }));
    await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(cellText(reopened, "D1")).toBe("East");
    expect(undoButton().disabled).toBe(false);
  });
});
