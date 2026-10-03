import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import type { CellData, Selection, Workbook, Worksheet } from "../domain/types";
import { installFetchStub, type StubRequest } from "../test/fetch-stub";
import { seededWorkbook } from "../test/fixtures";

const WORKBOOK_URL = "/api/workbooks/wb-q3-sales";
const SHEET = "ws-q3-sales-sheet1";
const SHEET_URL = `${WORKBOOK_URL}/worksheets/${SHEET}`;
const SORT_URL = `${SHEET_URL}/sort`;
const SELECTION_URL = `${SHEET_URL}/selection`;

function reset() {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
}

function parseCoordinate(name: string): { row: number; column: number } | null {
  const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(name.trim());
  if (!match) return null;
  let column = 0;
  for (const character of match[1].toUpperCase()) column = column * 26 + (character.charCodeAt(0) - 64);
  return { row: Number(match[2]) - 1, column: column - 1 };
}

function columnLetters(column: number): string {
  let index = column;
  let label = "";
  do {
    label = String.fromCharCode(65 + (index % 26)) + label;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return label;
}

function coordinateName(row: number, column: number): string {
  return `${columnLetters(column)}${row + 1}`;
}

interface SortPayload {
  range: string;
  column: number;
  order: "ascending" | "descending";
  hasHeader: boolean;
}

function rangeBounds(range: string) {
  const [first, last] = String(range ?? "").split(":");
  const start = parseCoordinate(first ?? "");
  const end = parseCoordinate(last ?? first ?? "");
  if (!start || !end) return null;
  return {
    top: Math.min(start.row, end.row),
    bottom: Math.max(start.row, end.row),
    left: Math.min(start.column, end.column),
    right: Math.max(start.column, end.column),
  };
}

function sortKeyOf(text: string): { rank: number; value: number | string } {
  const trimmed = text.trim();
  if (trimmed !== "" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    return { rank: 0, value: Number(trimmed) };
  }
  if (trimmed !== "") {
    const time = Date.parse(trimmed);
    if (!Number.isNaN(time)) return { rank: 1, value: time };
  }
  return { rank: 2, value: trimmed.toLowerCase() };
}

/** Mirrors the backend sort so the grid shows the stable reordered records. */
function sortSheetCells(worksheet: Worksheet, payload: SortPayload): Record<string, CellData> {
  const bounds = rangeBounds(payload.range);
  if (!bounds) return structuredClone(worksheet.cells);
  const firstDataRow = payload.hasHeader ? bounds.top + 1 : bounds.top;
  const rows: number[] = [];
  for (let row = firstDataRow; row <= bounds.bottom; row += 1) rows.push(row);
  const width = bounds.right - bounds.left + 1;
  const records = rows.map((row) =>
    Array.from({ length: width }, (_, offset) => worksheet.cells[coordinateName(row, bounds.left + offset)]),
  );
  const keys = rows.map((row) => sortKeyOf(String(worksheet.cells[coordinateName(row, payload.column)]?.value ?? "")));
  const direction = payload.order === "descending" ? -1 : 1;
  const positions = records.map((_, index) => index);
  positions.sort((left, right) => {
    const a = keys[left];
    const b = keys[right];
    let comparison = a.rank - b.rank;
    if (comparison === 0) comparison = a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
    return comparison !== 0 ? comparison * direction : left - right;
  });
  const cells = structuredClone(worksheet.cells);
  rows.forEach((targetRow, position) => {
    records[positions[position]].forEach((cell, offset) => {
      const name = coordinateName(targetRow, bounds.left + offset);
      if (!cell) delete cells[name];
      else cells[name] = cell;
    });
  });
  return cells;
}

function stubSort(options: { sortError?: string } = {}) {
  let current: Workbook = structuredClone(seededWorkbook);
  const requests: StubRequest[] = [];

  const updateSheet = (worksheetId: string, update: (worksheet: Worksheet) => Worksheet) => {
    current = {
      ...current,
      updatedAt: "2026-10-04T10:00:00.000Z",
      worksheets: current.worksheets.map((worksheet) =>
        worksheet.id === worksheetId ? update(worksheet) : worksheet,
      ),
    };
  };

  installFetchStub((request) => {
    requests.push(request);
    if (request.url === WORKBOOK_URL && request.method === "GET") {
      return { body: { workbook: current } };
    }
    if (request.url === SORT_URL && request.method === "POST") {
      if (options.sortError) return { status: 400, body: { error: options.sortError } };
      const body = request.body as SortPayload;
      updateSheet(SHEET, (worksheet) => ({ ...worksheet, cells: sortSheetCells(worksheet, body) }));
      return { body: { workbook: current } };
    }
    if (request.url === SELECTION_URL && request.method === "PATCH") {
      const selection = request.body as Selection;
      updateSheet(SHEET, (worksheet) => ({ ...worksheet, selection }));
      return { body: { workbook: current } };
    }
    return { status: 404, body: { error: "Not found" } };
  });
  return { requests, workbook: () => current };
}

async function openEditor() {
  window.location.hash = "#/workbooks/wb-q3-sales";
  render(<App />);
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
}

describe("sort range dialog", () => {
  afterEach(reset);

  it("opens the Data menu with the Sort range command", async () => {
    stubSort();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Data" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Sort range",
      "Create filter",
      "Clear filter",
      "Data validation",
      "Create pivot table",
    ]);
  });

  it("shows the Sort range dialog with header-named sort columns and the order options", async () => {
    stubSort();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(screen.getByRole("menuitem", { name: "Sort range" }));

    const dialog = await screen.findByRole("dialog", { name: "Sort range" });
    const sortBy = within(dialog).getByRole("combobox", { name: "Sort by" });
    expect(within(sortBy).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Region",
      "Sales",
      "Status",
    ]);
    const order = within(dialog).getByRole("combobox", { name: "Order" });
    expect(within(order).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Ascending",
      "Descending",
    ]);
    expect(within(dialog).getByRole("checkbox", { name: "Data has header row" })).toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Sort" })).toBeInTheDocument();
  });

  it("sorts the selected range by a column and persists the new order", async () => {
    const stub = stubSort();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(screen.getByRole("menuitem", { name: "Sort range" }));

    const dialog = await screen.findByRole("dialog", { name: "Sort range" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Sort by" }), "1");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const requested = stub.requests.find((request) => request.url === SORT_URL && request.method === "POST");
    expect(requested?.body).toEqual({
      range: "A1:C4",
      column: 1,
      order: "ascending",
      hasHeader: true,
    });

    expect(screen.getByRole("gridcell", { name: "B1" })).toHaveTextContent("Sales");
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("South");
    expect(screen.getByRole("gridcell", { name: "B2" })).toHaveTextContent("700");
    expect(screen.getByRole("gridcell", { name: "A3" })).toHaveTextContent("North");
    expect(screen.getByRole("gridcell", { name: "A4" })).toHaveTextContent("East");

    // Refreshing the editor keeps the sorted order.
    cleanup();
    await openEditor();
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("South"));
    expect(screen.getByRole("gridcell", { name: "A4" })).toHaveTextContent("East");
  });

  it("sorts descending when the Order combo box asks for it", async () => {
    stubSort();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(screen.getByRole("menuitem", { name: "Sort range" }));
    const dialog = await screen.findByRole("dialog", { name: "Sort range" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Sort by" }), "1");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Order" }), "descending");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East"));
    expect(screen.getByRole("gridcell", { name: "A3" })).toHaveTextContent("North");
    expect(screen.getByRole("gridcell", { name: "A4" })).toHaveTextContent("South");
  });

  it("keeps the original order and reports the error when the sort fails", async () => {
    stubSort({ sortError: "Unable to sort the selected range" });
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(screen.getByRole("menuitem", { name: "Sort range" }));
    const dialog = await screen.findByRole("dialog", { name: "Sort range" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Sort by" }), "1");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Unable to sort the selected range");
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
    expect(screen.getByRole("gridcell", { name: "A3" })).toHaveTextContent("North");
    expect(screen.getByRole("gridcell", { name: "A4" })).toHaveTextContent("South");
  });

  it("keeps the sort range selection from a selected rectangle without expanding it", async () => {
    const stub = stubSort();
    const user = userEvent.setup();
    await openEditor();

    fireEvent.mouseDown(screen.getByRole("gridcell", { name: "B1" }));
    fireEvent.mouseEnter(screen.getByRole("gridcell", { name: "B3" }));
    fireEvent.mouseUp(window);
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B3" })).toHaveAttribute("aria-selected", "true"));

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(screen.getByRole("menuitem", { name: "Sort range" }));
    const dialog = await screen.findByRole("dialog", { name: "Sort range" });
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const requested = stub.requests.find((request) => request.url === SORT_URL && request.method === "POST");
    expect(requested?.body).toEqual({ range: "B1:B3", column: 1, order: "ascending", hasHeader: true });
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
  });
});
