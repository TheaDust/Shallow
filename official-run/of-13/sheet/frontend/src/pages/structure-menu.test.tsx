import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import type { WorkbookState } from "../domain/workbook";

const SEED_UPDATED_AT = "2026-03-14T09:32:00.000Z";

/** Local A1 helpers so the test derives its own expectations from the stored cells. */
function parseAddress(address: string) {
  const match = /^([A-Z]+)(\d+)$/.exec(address);
  if (!match) return null;
  let column = 0;
  for (const letter of match[1]) column = column * 26 + (letter.charCodeAt(0) - 64);
  return { row: Number(match[2]) - 1, column: column - 1 };
}

function columnName(column: number) {
  let value = column + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function seedWorkbook(): WorkbookState {
  return {
    id: "wb-q3-sales",
    name: "Q3 Sales",
    createdAt: SEED_UPDATED_AT,
    updatedAt: SEED_UPDATED_AT,
    activeSheetId: "wb-q3-sales-sheet-1",
    sheets: [
      {
        id: "wb-q3-sales-sheet-1",
        name: "Sheet1",
        cells: { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" },
      },
      { id: "wb-q3-sales-sheet-2", name: "Sheet2", cells: {} },
    ],
  };
}

function moveCells(cells: Record<string, string>, axis: "row" | "column", at: number, count: number, drop: boolean) {
  const next: Record<string, string> = {};
  for (const [address, value] of Object.entries(cells)) {
    const position = parseAddress(address);
    if (!position) {
      next[address] = value;
      continue;
    }
    const current = position[axis];
    if (drop && current >= at && current < at + count) continue;
    const delta = drop ? (current >= at + count ? -count : 0) : current >= at ? count : 0;
    const row = axis === "row" ? position.row + delta : position.row;
    const column = axis === "column" ? position.column + delta : position.column;
    next[`${columnName(column)}${row + 1}`] = value;
  }
  return next;
}

interface FakeApiOptions {
  structureStatus?: number;
}

function installFakeApi(options: FakeApiOptions = {}) {
  const workbook = seedWorkbook();
  const calls: { path: string; body: unknown }[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const json = (status: number, payload: unknown) => ({
      ok: status < 400,
      status,
      headers: { get: () => "application/json" },
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    });

    if (path === "/api/workbooks" ) {
      return json(200, {
        workbooks: [{ id: workbook.id, name: workbook.name, updatedAt: workbook.updatedAt }],
      });
    }

    const structure = /^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/(rows|columns)$/.exec(path);
    if (structure) {
      calls.push({ path, body });
      if (options.structureStatus && options.structureStatus >= 400) {
        return json(options.structureStatus, { error: "Unable to update the worksheet structure" });
      }
      const sheet = workbook.sheets.find((entry) => entry.id === decodeURIComponent(structure[2]));
      if (!sheet) return json(404, { error: "Worksheet not found" });
      const { action, row, column } = body as {
        action: string;
        row?: number;
        column?: number;
      };
      const axis = structure[3] === "rows" ? "row" : "column";
      const index = (axis === "row" ? row! : column!) - 1;
      if (action === "delete") {
        sheet.cells = moveCells(sheet.cells, axis, index, 1, true);
      } else {
        const at = action.endsWith("below") || action.endsWith("right") ? index + 1 : index;
        sheet.cells = moveCells(sheet.cells, axis, at, 1, false);
        if (axis === "row") sheet.rowCount = (sheet.rowCount ?? 50) + 1;
        else sheet.columnCount = (sheet.columnCount ?? 26) + 1;
      }
      workbook.updatedAt = "2026-04-02T08:15:00.000Z";
      return json(200, { workbook });
    }

    const match = /^\/api\/workbooks\/([^/]+)$/.exec(path);
    if (match && (init?.method ?? "GET") === "GET") {
      return json(200, { workbook });
    }
    return json(404, { error: "Not found" });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { workbook, calls };
}

function renderEditor() {
  window.location.hash = "#/workbooks/wb-q3-sales";
  return render(<App />);
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

async function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

describe("row and column header structure menus", () => {
  it("names row headers with the row number and column headers with the column letter", async () => {
    installFakeApi();
    renderEditor();
    const table = await grid();

    expect(within(table).getByRole("rowheader", { name: "3" }).textContent).toBe("3");
    expect(within(table).getByRole("columnheader", { name: "B" }).textContent).toBe("B");
    expect(within(table).getByRole("rowheader", { name: "50" })).toBeTruthy();
  });

  it("opens the row menu on right-click with the three row commands", async () => {
    installFakeApi();
    renderEditor();
    const table = await grid();

    fireEvent.contextMenu(within(table).getByRole("rowheader", { name: "3" }), {
      clientX: 20,
      clientY: 40,
    });

    const menu = screen.getByRole("menu", { name: "Row 3 options" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Insert 1 row above",
      "Insert 1 row below",
      "Delete row",
    ]);
  });

  it("opens the column menu on right-click with the three column commands", async () => {
    installFakeApi();
    renderEditor();
    const table = await grid();

    fireEvent.contextMenu(within(table).getByRole("columnheader", { name: "B" }), {
      clientX: 5,
      clientY: 5,
    });

    const menu = screen.getByRole("menu", { name: "Column B options" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Insert 1 column left",
      "Insert 1 column right",
      "Delete column",
    ]);
  });

  it("inserts one row above the target row and shifts the following rows down", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    renderEditor();
    const table = await grid();

    expect(within(table).getByRole("gridcell", { name: "A3" }).textContent).toBe("North");

    fireEvent.contextMenu(within(table).getByRole("rowheader", { name: "3" }), {
      clientX: 20,
      clientY: 40,
    });
    await user.click(screen.getByRole("menuitem", { name: "Insert 1 row above" }));

    await waitFor(() =>
      expect(
        within(screen.getByRole("grid", { name: "Worksheet grid" })).getByRole("gridcell", {
          name: "A3",
        }).textContent,
      ).toBe(""),
    );
    const shifted = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(shifted).getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(within(shifted).getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");
    expect(within(shifted).getByRole("gridcell", { name: "A4" }).textContent).toBe("North");
    expect(within(shifted).getByRole("gridcell", { name: "B4" }).textContent).toBe("800");
    expect(api.calls.at(-1)).toEqual({
      path: "/api/workbooks/wb-q3-sales/sheets/wb-q3-sales-sheet-1/rows",
      body: { action: "insert-above", row: 3 },
    });

    // The other worksheet keeps its own (blank) grid.
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    const sheet2 = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(sheet2).getByRole("gridcell", { name: "A2" }).textContent).toBe("");
  });

  it("keeps the formula bar and the grid consistent after a row deletion", async () => {
    installFakeApi();
    const user = userEvent.setup();
    renderEditor();
    const table = await grid();

    await user.click(within(table).getByRole("gridcell", { name: "B2" }));
    expect((screen.getByLabelText("Formula bar") as HTMLInputElement).value).toBe("1200");

    fireEvent.contextMenu(within(table).getByRole("rowheader", { name: "2" }), {
      clientX: 10,
      clientY: 10,
    });
    await user.click(screen.getByRole("menuitem", { name: "Delete row" }));

    await waitFor(() =>
      expect(
        within(screen.getByRole("grid", { name: "Worksheet grid" })).getByRole("gridcell", {
          name: "A2",
        }).textContent,
      ).toBe("North"),
    );
    const deleted = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(deleted).getByRole("gridcell", { name: "B2" }).textContent).toBe("800");
    expect(within(deleted).getByRole("gridcell", { name: "A3" }).textContent).toBe("");
    expect((screen.getByLabelText("Formula bar") as HTMLInputElement).value).toBe("800");
  });

  it("inserts a column to the left of the target column and shifts it right", async () => {
    installFakeApi();
    const user = userEvent.setup();
    renderEditor();
    const table = await grid();

    fireEvent.contextMenu(within(table).getByRole("columnheader", { name: "B" }), {
      clientX: 10,
      clientY: 10,
    });
    await user.click(screen.getByRole("menuitem", { name: "Insert 1 column left" }));

    await waitFor(() =>
      expect(
        within(screen.getByRole("grid", { name: "Worksheet grid" })).getByRole("gridcell", {
          name: "C2",
        }).textContent,
      ).toBe("1200"),
    );
    const shifted = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(shifted).getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(within(shifted).getByRole("gridcell", { name: "B2" }).textContent).toBe("");
  });

  it("shows an alert and keeps the seeded grid when the operation fails", async () => {
    installFakeApi({ structureStatus: 500 });
    const user = userEvent.setup();
    renderEditor();
    const table = await grid();

    fireEvent.contextMenu(within(table).getByRole("rowheader", { name: "1" }), {
      clientX: 10,
      clientY: 10,
    });
    await user.click(screen.getByRole("menuitem", { name: "Delete row" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    const unchanged = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(unchanged).getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(within(unchanged).getByRole("gridcell", { name: "A3" }).textContent).toBe("North");
  });

  it("re-reads the shifted structure after the editor is reopened", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    const view = renderEditor();
    const table = await grid();

    fireEvent.contextMenu(within(table).getByRole("rowheader", { name: "2" }), {
      clientX: 10,
      clientY: 10,
    });
    await user.click(screen.getByRole("menuitem", { name: "Insert 1 row below" }));
    await waitFor(() => expect(api.workbook.sheets[0].cells.A4).toBe("North"));

    view.unmount();
    render(<App />);

    const reopened = await grid();
    expect(within(reopened).getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(within(reopened).getByRole("gridcell", { name: "A4" }).textContent).toBe("North");
  });
});
