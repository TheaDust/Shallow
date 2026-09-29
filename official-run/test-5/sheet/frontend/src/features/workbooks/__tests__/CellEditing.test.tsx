import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbookEditorPage } from "../WorkbookEditorPage";
import { sheetWithCells, stubFetch, workbookFixture } from "./helpers";
import type { WorkbookData } from "../types";

const EDITOR = "/api/workbooks/wb-q3-sales";
const SHEET1 = `${EDITOR}/worksheets/ws-q3-sheet1`;

const SEED_CELLS = { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.location.hash = "#/workbooks/wb-q3-sales";
});

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function cell(address: string) {
  return within(grid()).getByRole("gridcell", { name: address });
}

function formulaBar() {
  return screen.getByLabelText("Formula bar") as HTMLInputElement;
}

function withSheet1(seed: WorkbookData, cells: Record<string, string>, values: Record<string, string> = cells) {
  return { ...seed, worksheets: [{ ...seed.worksheets[0], cells, values }, seed.worksheets[1]] };
}

/** Fixture whose stored raw text and displayed values differ (formula cells). */
function sheetWithValues(cells: Record<string, string>, values: Record<string, string>): WorkbookData {
  return workbookFixture({
    worksheets: [
      { ...sheetWithCells(cells), values },
      { id: "ws-q3-sheet2", name: "Sheet2", activeCell: "A1", selectionFocus: "A1", cells: {}, values: {}, validations: [] },
    ],
  });
}

function applyUpdates(workbook: WorkbookData, updates: Record<string, string>): WorkbookData {
  return withSheet1(workbook, { ...workbook.worksheets[0].cells, ...updates });
}

interface StubOptions {
  /** Answer of a cell write; defaults to the seed with the updates applied. */
  cells?: (updates: Record<string, string>) => { status?: number; body: unknown };
}

/** Editor stub that keeps serving the latest successful workbook state. */
function stubEditor(seed: WorkbookData, options: StubOptions = {}) {
  let current = seed;
  const { calls } = stubFetch((request) => {
    if (request.method === "GET" && request.path === EDITOR) {
      return { body: { workbook: current } };
    }
    if (request.method === "PATCH" && request.path === SHEET1) {
      const focus = request.body?.selectionFocus ?? request.body?.activeCell;
      current = {
        ...current,
        worksheets: current.worksheets.map((sheet) =>
          sheet.id === "ws-q3-sheet1"
            ? { ...sheet, activeCell: request.body?.activeCell ?? sheet.activeCell, selectionFocus: focus }
            : sheet,
        ),
      };
      return { body: { workbook: current } };
    }
    if (request.method === "POST" && request.path === `${SHEET1}/cells`) {
      if (options.cells) return options.cells(request.body?.updates ?? {});
      current = applyUpdates(current, request.body?.updates ?? {});
      return { body: { workbook: current } };
    }
    return undefined;
  });
  return { calls };
}

async function openEditor(seed: WorkbookData, options: StubOptions = {}) {
  const stub = stubEditor(seed, options);
  render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
  await screen.findByRole("heading", { name: "Q3 Sales" });
  return stub;
}

describe("editing a cell through the grid or the formula bar", () => {
  it("opens an inline text box named Edit <coordinate> on double click and commits it with Enter", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture();
    const { calls } = await openEditor(seed);

    await user.dblClick(cell("D1"));
    const editor = within(grid()).getByRole("textbox", { name: "Edit D1" });
    expect((editor as HTMLInputElement).value).toBe("");
    expect(cell("D1").textContent).toBe("");

    await user.type(editor, "East");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(calls.some((call) => call.method === "POST" && call.body?.updates?.D1 === "East")).toBe(true),
    );
    expect(screen.queryByRole("textbox", { name: "Edit D1" })).toBeNull();
    await waitFor(() => expect(cell("D1").textContent).toBe("East"));
    expect(cell("A1").textContent).toBe("Region");
    expect(formulaBar().value).toBe("East");
  });

  it("prefills the inline editor with the stored content and replaces it when typing over it", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture();
    await openEditor(seed);

    await user.dblClick(cell("B2"));
    const editor = within(grid()).getByRole("textbox", { name: "Edit B2" }) as HTMLInputElement;
    expect(editor.value).toBe("1200");

    await user.clear(editor);
    await user.type(editor, "1500{Enter}");

    await waitFor(() => expect(cell("B2").textContent).toBe("1500"));
    expect(cell("A2").textContent).toBe("East");
  });

  it("starts editing when a printable character is typed on the selected cell", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture();
    const { calls } = await openEditor(seed);

    await user.click(cell("D1"));
    await user.keyboard("East");
    const editor = within(grid()).getByRole("textbox", { name: "Edit D1" }) as HTMLInputElement;
    expect(editor.value).toBe("East");

    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(calls.some((call) => call.method === "POST" && call.body?.updates?.D1 === "East")).toBe(true),
    );
  });

  it("discards an uncommitted change with Escape and keeps the stored value", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture();
    const { calls } = await openEditor(seed);

    await user.dblClick(cell("D1"));
    await user.type(within(grid()).getByRole("textbox", { name: "Edit D1" }), "East");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("textbox", { name: "Edit D1" })).toBeNull();
    expect(cell("D1").textContent).toBe("");
    expect(calls.some((call) => call.method === "POST")).toBe(false);

    // Escape on a filled cell restores its stored content as well.
    await user.dblClick(cell("A2"));
    const editor = within(grid()).getByRole("textbox", { name: "Edit A2" });
    await user.type(editor, "zzz");
    await user.keyboard("{Escape}");
    expect(cell("A2").textContent).toBe("East");
  });

  it("commits the inline change when another cell is clicked", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture();
    const { calls } = await openEditor(seed);

    await user.dblClick(cell("D1"));
    await user.type(within(grid()).getByRole("textbox", { name: "Edit D1" }), "North");
    await user.click(cell("E1"));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "POST" && call.body?.updates?.D1 === "North")).toBe(true),
    );
    await waitFor(() => expect(cell("D1").textContent).toBe("North"));
    expect(cell("E1").getAttribute("aria-selected")).toBe("true");
  });

  it("edits the selected cell through the Formula bar and commits it with Enter", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture();
    const { calls } = await openEditor(seed);

    await user.click(cell("D1"));
    expect(formulaBar().value).toBe("");
    await user.type(formulaBar(), "East{Enter}");

    await waitFor(() =>
      expect(calls.some((call) => call.method === "POST" && call.body?.updates?.D1 === "East")).toBe(true),
    );
    await waitFor(() => expect(cell("D1").textContent).toBe("East"));
    expect(formulaBar().value).toBe("East");
  });

  it("edits the cell that was selected when the Formula bar text was typed", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture();
    const { calls } = await openEditor(seed);

    await user.click(cell("D1"));
    await user.type(formulaBar(), "East");
    await user.click(cell("D2"));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "POST" && call.body?.updates?.D1 === "East")).toBe(true),
    );
    await waitFor(() => expect(cell("D1").textContent).toBe("East"));
    expect(cell("D2").getAttribute("aria-selected")).toBe("true");
  });

  it("restores the formula bar content and sends nothing when Escape is pressed", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture();
    const { calls } = await openEditor(seed);

    await user.click(cell("B2"));
    expect(formulaBar().value).toBe("1200");
    await user.type(formulaBar(), "9");
    await user.keyboard("{Escape}");

    expect(formulaBar().value).toBe("1200");
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    expect(cell("B2").textContent).toBe("1200");
  });

  it("shows the result in the grid and the original formula in the formula bar", async () => {
    const user = userEvent.setup();
    const seed = sheetWithValues({ A1: "4", B1: "6", C1: "=A1+B1" }, { A1: "4", B1: "6", C1: "10" });
    const recalculated = sheetWithValues(
      { A1: "4", B1: "6", C1: "=A1+B1" },
      { A1: "4", B1: "6", C1: "10" },
    );
    const { calls } = await openEditor(seed, {
      cells: () => ({ body: { workbook: recalculated } }),
    });

    await user.click(cell("C1"));
    expect(cell("C1").textContent).toBe("10");
    expect(formulaBar().value).toBe("=A1+B1");

    // The raw expression of a committed source value is written as it was typed.
    await user.click(cell("A1"));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "10{Enter}");
    await waitFor(() =>
      expect(calls.some((call) => call.method === "POST" && call.body?.updates?.A1 === "10")).toBe(true),
    );
    await waitFor(() => expect(cell("C1").textContent).toBe("10"));
    expect(formulaBar().value).toBe("10");
  });

  it("keeps the last successful value when a commit is rejected and shows the error", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture({
      worksheets: [
        sheetWithCells({ ...SEED_CELLS, D1: "50" }),
        { id: "ws-q3-sheet2", name: "Sheet2", activeCell: "A1", selectionFocus: "A1", cells: {}, values: {}, validations: [] },
      ],
    });
    await openEditor(seed, {
      cells: () => ({ status: 400, body: { error: "Please enter a number from 0 to 100" } }),
    });

    await user.click(cell("D1"));
    expect(formulaBar().value).toBe("50");
    await user.clear(formulaBar());
    await user.type(formulaBar(), "500{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Please enter a number from 0 to 100");
    expect(cell("D1").textContent).toBe("50");
    expect(formulaBar().value).toBe("50");
  });

  it("keeps the grid on the previous value when an inline commit is rejected", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture();
    await openEditor(seed, { cells: () => ({ status: 500, body: { error: "Server exploded" } }) });

    await user.dblClick(cell("A2"));
    const editor = within(grid()).getByRole("textbox", { name: "Edit A2" });
    await user.clear(editor);
    await user.type(editor, "West{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Server exploded");
    expect(cell("A2").textContent).toBe("East");
  });
});
