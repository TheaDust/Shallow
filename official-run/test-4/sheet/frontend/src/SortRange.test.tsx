import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

interface Sheet {
  id: string;
  name: string;
  cells: Record<string, string>;
  selectedCell: string;
  selectedRange?: { start: string; end: string };
  validationRules: unknown[];
  filter: unknown;
}

interface Workbook {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeSheetId: string;
  sheets: Sheet[];
}

function parse(text: string): { row: number; col: number } | null {
  const match = /^([A-Z]+)([1-9]\d*)$/.exec(text);
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(match[2]), col: col - 1 };
}

function cellName(row: number, col: number): string {
  let n = col + 1;
  let name = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return `${name}${row}`;
}

/** Mirrors the backend sort semantics for the fixture columns (REQ-5-1-1). */
function fakeSortCells(
  cells: Record<string, string>,
  start: string,
  end: string,
  column: string,
  order: string,
  hasHeader: boolean,
): Record<string, string> {
  const from = parse(start);
  const to = parse(end);
  if (!from || !to) return cells;
  const rowMin = Math.min(from.row, to.row);
  const rowMax = Math.max(from.row, to.row);
  const colMin = Math.min(from.col, to.col);
  const colMax = Math.max(from.col, to.col);
  const sortCol = parse(`${column}1`)?.col ?? 0;
  const firstDataRow = hasHeader ? rowMin + 1 : rowMin;
  const rows: number[] = [];
  for (let row = firstDataRow; row <= rowMax; row += 1) rows.push(row);

  function key(row: number) {
    const value = cells[cellName(row, sortCol)] ?? "";
    const number = Number(value);
    if (value.trim() !== "" && Number.isFinite(number)) return { type: 0, value: number };
    return { type: 1, value: value.toLowerCase() };
  }
  const direction = order === "descending" ? -1 : 1;
  rows.sort((a, b) => {
    const keyA = key(a);
    const keyB = key(b);
    if (keyA.type !== keyB.type) return direction * (keyA.type - keyB.type);
    if (keyA.value < keyB.value) return -1 * direction;
    if (keyA.value > keyB.value) return 1 * direction;
    return 0;
  });

  const result = { ...cells };
  const snapshot: Record<string, string> = {};
  for (let row = rowMin; row <= rowMax; row += 1) {
    for (let col = colMin; col <= colMax; col += 1) {
      snapshot[`${row}:${col}`] = cells[cellName(row, col)] ?? "";
    }
  }
  rows.forEach((sourceRow, index) => {
    const targetRow = firstDataRow + index;
    for (let col = colMin; col <= colMax; col += 1) {
      const value = snapshot[`${sourceRow}:${col}`];
      if (value === "") {
        delete result[cellName(targetRow, col)];
      } else {
        result[cellName(targetRow, col)] = value;
      }
    }
  });
  return result;
}

function makeWorkbook(): Workbook {
  const now = new Date(2026, 8, 27, 10, 30, 0).toISOString();
  return {
    id: "wb_sort",
    name: "Q3 Sales",
    createdAt: now,
    updatedAt: now,
    activeSheetId: "s1",
    sheets: [
      {
        id: "s1",
        name: "Sheet1",
        cells: {
          A1: "Region",
          B1: "Sales",
          C1: "Status",
          A2: "East",
          B2: "1200",
          C2: "Open",
          A3: "North",
          B3: "800",
          C3: "Closed",
          A4: "South",
          B4: "700",
          C4: "Open",
          D2: "outside",
        },
        selectedCell: "A1",
        selectedRange: { start: "A1", end: "A1" },
        validationRules: [],
        filter: null,
      },
    ],
  };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null,
    },
    json: async () => body,
  };
}

function serialize(workbook: Workbook) {
  const clone: Workbook = JSON.parse(JSON.stringify(workbook));
  clone.sheets = clone.sheets.map((sheet) => ({
    ...sheet,
    selectedRange: sheet.selectedRange ?? { start: sheet.selectedCell, end: sheet.selectedCell },
    validationRules: [],
    filter: null,
    results: {},
  }));
  return clone;
}

function installFakeBackend(): { store: Workbook[]; fetchMock: ReturnType<typeof vi.fn> } {
  const store: Workbook[] = [makeWorkbook()];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const segments = url.pathname.split("/").filter(Boolean);
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    if (segments[0] !== "api") return jsonResponse(404, { error: "Not found" });

    if (segments[1] === "workbooks" && segments.length === 2 && method === "GET") {
      return jsonResponse(200, {
        workbooks: store.map((entry) => ({ id: entry.id, name: entry.name, updatedAt: entry.updatedAt })),
      });
    }

    const id = decodeURIComponent(segments[2] ?? "");
    const workbook = store.find((entry) => entry.id === id);
    if (!workbook) return jsonResponse(404, { error: "Workbook not found" });

    if (segments.length === 3 && method === "GET") {
      return jsonResponse(200, serialize(workbook));
    }

    if (segments[3] === "state" && method === "PATCH") {
      const sheet = workbook.sheets.find((entry) => entry.id === body.sheetId);
      if (!sheet) return jsonResponse(400, { error: "Worksheet not found" });
      workbook.activeSheetId = body.sheetId;
      sheet.selectedCell = body.selectedCell;
      if (body.selectedRange && body.selectedRange.start && body.selectedRange.end) {
        sheet.selectedRange = { start: body.selectedRange.start, end: body.selectedRange.end };
      }
      return jsonResponse(200, serialize(workbook));
    }

    if (segments[3] === "sort" && method === "PATCH") {
      const sheet = workbook.sheets.find((entry) => entry.id === body.sheetId);
      if (!sheet) return jsonResponse(400, { error: "Worksheet not found" });
      if (body.column === "C") {
        return jsonResponse(400, { error: "Sort failed" });
      }
      sheet.cells = fakeSortCells(sheet.cells, body.start, body.end, body.column, body.order, body.hasHeader);
      workbook.updatedAt = new Date(2026, 8, 27, 11, 0, 0).toISOString();
      return jsonResponse(200, serialize(workbook));
    }

    return jsonResponse(404, { error: "Not found" });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { store, fetchMock };
}

function renderHome() {
  window.location.hash = "#/";
  return render(<App />);
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
  await screen.findByRole("heading", { name: "Q3 Sales" });
}

/** Drag-select a rectangle A1..C4 using pointer events on the grid. */
async function selectRange(user: ReturnType<typeof userEvent.setup>, start: string, end: string) {
  const grid = screen.getByRole("grid", { name: "Worksheet grid" });
  const from = within(grid).getByRole("gridcell", { name: start });
  const to = within(grid).getByRole("gridcell", { name: end });
  fireEvent.mouseDown(from);
  fireEvent.mouseEnter(to);
  fireEvent.mouseUp(window);
  await waitFor(() => expect(from.getAttribute("aria-selected")).toBe("true"));
  expect(to.getAttribute("aria-selected")).toBe("true");
}

async function openSortDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  await user.click(await screen.findByRole("menuitem", { name: "Sort range" }));
  return screen.findByRole("dialog", { name: "Sort range" });
}

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-5-1-1 sort a data range by a specified column", () => {
  it("opens the Sort range dialog with the required controls and header options", async () => {
    installFakeBackend();
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await selectRange(user, "A1", "C4");
    const dialog = await openSortDialog(user);

    expect(within(dialog).getByRole("combobox", { name: "Sort by" })).toBeTruthy();
    const sortByCombo = within(dialog).getByRole("combobox", { name: "Sort by" });
    expect(within(sortByCombo).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Region",
      "Sales",
      "Status",
    ]);
    expect(within(dialog).getByRole("combobox", { name: "Order" })).toBeTruthy();
    const orderCombo = within(dialog).getByRole("combobox", { name: "Order" });
    expect(within(orderCombo).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Ascending",
      "Descending",
    ]);
    expect(within(dialog).getByRole("checkbox", { name: "Data has header row" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Sort" })).toBeTruthy();
  });

  it("sorts by Sales ascending with a header row, keeps outside data, and persists", async () => {
    const backend = installFakeBackend();
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await selectRange(user, "A1", "C4");
    const dialog = await openSortDialog(user);
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Sort by" }), "Sales");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // header row does not participate; rows reorder by Sales: 700, 800, 1200
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toContain("Region");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("South");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toContain("700");
    expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toContain("Open");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toContain("North");
    expect(screen.getByRole("gridcell", { name: "C3" }).textContent).toContain("Closed");
    expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "B4" }).textContent).toContain("1200");
    // data outside the selection is unchanged
    expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toContain("outside");

    // order persists after refresh
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    await screen.findByRole("heading", { name: "Q3 Sales" });
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("South");
    expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toContain("East");
  });

  it("sorts descending by Sales with a header row", async () => {
    installFakeBackend();
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await selectRange(user, "A1", "C4");
    const dialog = await openSortDialog(user);
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Sort by" }), "Sales");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Order" }), "Descending");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toContain("North");
    expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toContain("South");
  });

  it("includes the first row when Data has header row is unchecked", async () => {
    installFakeBackend();
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await selectRange(user, "A1", "C4");
    const dialog = await openSortDialog(user);
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Sort by" }), "Sales");
    await user.click(within(dialog).getByRole("checkbox", { name: "Data has header row" }));
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // blank header key sorts last: 700 South, 800 North, 1200 East, then Region
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toContain("South");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("North");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toContain("Region");
  });

  it("shows the sort error and keeps the original order when sorting fails", async () => {
    installFakeBackend();
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await selectRange(user, "A1", "C4");
    const dialog = await openSortDialog(user);
    // the fake backend rejects sorting by the Status column (letter C)
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Sort by" }), "Status");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("Sort failed");
    // dialog stays open and the grid keeps its original order
    expect(screen.getByRole("dialog", { name: "Sort range" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toContain("North");
    expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toContain("South");
  });
});
