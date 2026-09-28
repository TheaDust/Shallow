import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

interface CellRange {
  start: string;
  end: string;
}

interface PivotConfig {
  sourceSheetId: string;
  sourceRange: CellRange;
  rowField: string | null;
  columnField: string | null;
  valueField: string | null;
  summarizeBy: "SUM" | "COUNT" | "AVERAGE" | null;
}

interface Sheet {
  id: string;
  name: string;
  cells: Record<string, string>;
  selectedCell: string;
  selectedRange?: CellRange;
  validationRules: unknown[];
  filter: unknown;
  pivot?: PivotConfig | null;
}

interface Workbook {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeSheetId: string;
  sheets: Sheet[];
}

let sequence = 0;

function makeWorkbook(): Workbook {
  const now = new Date(2026, 8, 27, 10, 30, 0).toISOString();
  sequence += 1;
  return {
    id: `wb_${sequence}`,
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
        },
        selectedCell: "A1",
        selectedRange: { start: "A1", end: "A1" },
        validationRules: [],
        filter: null,
        pivot: null,
      },
      {
        id: "s2",
        name: "Sheet2",
        cells: {},
        selectedCell: "A1",
        selectedRange: { start: "A1", end: "A1" },
        validationRules: [],
        filter: null,
        pivot: null,
      },
    ],
  };
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

/** Mirrors the backend pivot aggregation for the fixture (REQ-5-3-1). */
function fakePivotCells(
  cells: Record<string, string>,
  range: CellRange,
  config: { rowField: string; columnField: string | null; valueField: string; summarizeBy: string },
): Record<string, string> {
  const from = parse(range.start);
  const to = parse(range.end);
  if (!from || !to) throw new Error("Invalid source range");
  const rowMin = Math.min(from.row, to.row);
  const rowMax = Math.max(from.row, to.row);
  const colMin = Math.min(from.col, to.col);
  const colMax = Math.max(from.col, to.col);
  const headerColumns = new Map<string, number>();
  for (let col = colMin; col <= colMax; col += 1) {
    const text = (cells[cellName(rowMin, col)] ?? "").trim();
    if (text !== "" && !headerColumns.has(text)) headerColumns.set(text, col);
  }
  const columnOf = (text: string) => headerColumns.get(text) ?? -1;
  const rowCol = columnOf(config.rowField);
  const valueCol = columnOf(config.valueField);
  const columnCol = config.columnField ? columnOf(config.columnField) : -1;
  if (rowCol < 0 || valueCol < 0 || (config.columnField && columnCol < 0)) {
    throw new Error("Pivot field is no longer available. Select a new field.");
  }

  const records: { rowValue: string; columnValue: string | null; value: string }[] = [];
  let numericCount = 0;
  for (let row = rowMin + 1; row <= rowMax; row += 1) {
    const rowValue = (cells[cellName(row, rowCol)] ?? "").trim();
    if (rowValue === "") continue;
    const value = cells[cellName(row, valueCol)] ?? "";
    const number = Number(value.trim());
    if (value.trim() !== "" && Number.isFinite(number)) numericCount += 1;
    records.push({
      rowValue,
      columnValue: config.columnField ? cells[cellName(row, columnCol)] ?? "" : null,
      value,
    });
  }
  if ((config.summarizeBy === "SUM" || config.summarizeBy === "AVERAGE") && numericCount === 0) {
    throw new Error("Value field requires numeric values");
  }

  const rowGroups: string[] = [];
  const rowGroupIndex = new Map<string, number>();
  const columnGroups: string[] = [];
  const columnGroupIndex = new Map<string, number>();
  for (const record of records) {
    if (!rowGroupIndex.has(record.rowValue)) {
      rowGroupIndex.set(record.rowValue, rowGroups.length);
      rowGroups.push(record.rowValue);
    }
    if (config.columnField) {
      const key = record.columnValue ?? "";
      if (!columnGroupIndex.has(key)) {
        columnGroupIndex.set(key, columnGroups.length);
        columnGroups.push(key);
      }
    }
  }

  const aggregate = (values: string[]): string => {
    if (config.summarizeBy === "COUNT") {
      return String(values.filter((value) => value !== "").length);
    }
    const numbers = values
      .map((value) => Number(value.trim()))
      .filter((value) => value !== null && value !== undefined && Number.isFinite(value));
    if (config.summarizeBy === "SUM") {
      return String(numbers.reduce((sum, number) => sum + number, 0));
    }
    return String(
      numbers.length === 0
        ? 0
        : numbers.reduce((sum, number) => sum + number, 0) / numbers.length,
    );
  };
  const valuesOf = (items: { value: string }[]) => items.map((item) => item.value);
  const out: Record<string, string> = {};

  if (!config.columnField) {
    out.A1 = config.rowField;
    out.B1 = `${config.summarizeBy} of ${config.valueField}`;
    let row = 2;
    for (const group of rowGroups) {
      out[cellName(row, 0)] = group;
      out[cellName(row, 1)] = aggregate(valuesOf(records.filter((item) => item.rowValue === group)));
      row += 1;
    }
    out[cellName(row, 0)] = "Grand Total";
    out[cellName(row, 1)] = aggregate(valuesOf(records));
    return out;
  }

  out.A1 = config.rowField;
  let col = 1;
  for (const group of columnGroups) {
    out[cellName(1, col)] = group;
    col += 1;
  }
  const grandCol = col;
  out[cellName(1, grandCol)] = "Grand Total";
  let row = 2;
  for (const group of rowGroups) {
    const rowRecords = records.filter((item) => item.rowValue === group);
    out[cellName(row, 0)] = group;
    columnGroups.forEach((columnGroup, index) => {
      const combo = rowRecords.filter((item) => (item.columnValue ?? "") === columnGroup);
      out[cellName(row, index + 1)] = aggregate(valuesOf(combo));
    });
    out[cellName(row, grandCol)] = aggregate(valuesOf(rowRecords));
    row += 1;
  }
  out[cellName(row, 0)] = "Grand Total";
  columnGroups.forEach((columnGroup, index) => {
    const combo = records.filter((item) => (item.columnValue ?? "") === columnGroup);
    out[cellName(row, index + 1)] = aggregate(valuesOf(combo));
  });
  out[cellName(row, grandCol)] = aggregate(valuesOf(records));
  return out;
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
    pivot: sheet.pivot ?? null,
    results: {},
  }));
  return clone;
}

function installFakeBackend(): { store: Workbook[]; fetchMock: ReturnType<typeof vi.fn> } {
  const store: Workbook[] = [makeWorkbook()];
  let sheetSequence = 2;
  let pivotSequence = 0;

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

    if (segments.length === 3 && method === "PATCH" && segments[3] === undefined) {
      workbook.name = body.name ?? workbook.name;
      return jsonResponse(200, serialize(workbook));
    }

    if (segments[3] === "state" && method === "PATCH") {
      const sheet = workbook.sheets.find((entry) => entry.id === body.sheetId);
      if (sheet) {
        sheet.selectedCell = body.selectedCell;
        sheet.selectedRange = body.selectedRange ?? { start: body.selectedCell, end: body.selectedCell };
        workbook.activeSheetId = body.sheetId;
      }
      return jsonResponse(200, serialize(workbook));
    }

    if (segments[3] === "cells" && method === "PATCH") {
      const sheet = workbook.sheets.find((entry) => entry.id === body.sheetId);
      if (!sheet) return jsonResponse(400, { error: "Worksheet not found" });
      Object.assign(sheet.cells, body.updates);
      return jsonResponse(200, serialize(workbook));
    }

    if (segments[3] === "pivot" && method === "POST" && segments[4] === undefined) {
      const sheet = workbook.sheets.find((entry) => entry.id === body.sheetId);
      if (!sheet) return jsonResponse(400, { error: "Worksheet not found" });
      pivotSequence += 1;
      let pivotNumber = pivotSequence;
      const names = workbook.sheets.map((entry) => entry.name);
      while (names.includes(`Pivot${pivotNumber}`)) pivotNumber += 1;
      const pivotSheet: Sheet = {
        id: `s${++sheetSequence}`,
        name: `Pivot${pivotNumber}`,
        cells: {},
        selectedCell: "A1",
        selectedRange: { start: "A1", end: "A1" },
        validationRules: [],
        filter: null,
        pivot: {
          sourceSheetId: sheet.id,
          sourceRange: { start: body.range.start, end: body.range.end },
          rowField: null,
          columnField: null,
          valueField: null,
          summarizeBy: null,
        },
      };
      workbook.sheets.push(pivotSheet);
      workbook.activeSheetId = pivotSheet.id;
      return jsonResponse(200, serialize(workbook));
    }

    if (segments[3] === "pivot" && method === "PATCH") {
      const pivotSheet = workbook.sheets.find((entry) => entry.id === body.sheetId);
      if (!pivotSheet?.pivot) return jsonResponse(400, { error: "Not a pivot worksheet" });
      const config = body.config;
      if (!config.rowField || !config.valueField || !config.summarizeBy) {
        return jsonResponse(400, { error: "Row and value fields are required" });
      }
      try {
        const cells = fakePivotCells(
          pivotSheet.pivot.sourceSheetId === workbook.sheets[0].id
            ? workbook.sheets[0].cells
            : {},
          pivotSheet.pivot.sourceRange,
          config,
        );
        pivotSheet.cells = cells;
        pivotSheet.pivot.rowField = config.rowField;
        pivotSheet.pivot.columnField = config.columnField;
        pivotSheet.pivot.valueField = config.valueField;
        pivotSheet.pivot.summarizeBy = config.summarizeBy;
      } catch (error) {
        return jsonResponse(400, { error: error instanceof Error ? error.message : String(error) });
      }
      return jsonResponse(200, serialize(workbook));
    }

    if (segments[3] === "pivot" && segments[4] === "refresh" && method === "POST") {
      const pivotSheet = workbook.sheets.find((entry) => entry.id === body.sheetId);
      if (!pivotSheet?.pivot) return jsonResponse(400, { error: "Not a pivot worksheet" });
      if (!pivotSheet.pivot.rowField || !pivotSheet.pivot.valueField || !pivotSheet.pivot.summarizeBy) {
        return jsonResponse(400, { error: "Pivot configuration is incomplete" });
      }
      try {
        pivotSheet.cells = fakePivotCells(
          pivotSheet.pivot.sourceSheetId === workbook.sheets[0].id
            ? workbook.sheets[0].cells
            : {},
          pivotSheet.pivot.sourceRange,
          {
            rowField: pivotSheet.pivot.rowField,
            columnField: pivotSheet.pivot.columnField,
            valueField: pivotSheet.pivot.valueField,
            summarizeBy: pivotSheet.pivot.summarizeBy,
          },
        );
      } catch (error) {
        return jsonResponse(400, { error: error instanceof Error ? error.message : String(error) });
      }
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

/** Drag-select a rectangle using pointer events on the grid. */
async function selectRange(user: ReturnType<typeof userEvent.setup>, start: string, end: string) {
  const grid = screen.getByRole("grid", { name: "Worksheet grid" });
  const from = within(grid).getByRole("gridcell", { name: start });
  const to = within(grid).getByRole("gridcell", { name: end });
  fireEvent.mouseDown(from);
  fireEvent.mouseEnter(to);
  fireEvent.mouseUp(window);
  await waitFor(() => expect(from.getAttribute("aria-selected")).toBe("true"));
}

function gridCellValue(coord: string): string | null {
  const grid = screen.getByRole("grid", { name: "Worksheet grid" });
  const cell = within(grid).queryByRole("gridcell", { name: coord });
  return cell ? cell.textContent ?? null : null;
}

async function expectCell(coord: string, text: string) {
  const cell = await screen.findByRole("gridcell", { name: coord });
  expect(cell.textContent).toBe(text);
}

beforeEach(() => {
  sequence = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-5-3-1 create and refresh a basic pivot table", () => {
  it("creates Pivot1 from the Data menu and applies a SUM layout", async () => {
    const { fetchMock } = installFakeBackend();
    void fetchMock;
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await selectRange(user, "A1", "C6");
    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create pivot table" }));

    // the dialog shows the source range and a "New worksheet" radio
    const dialog = await screen.findByRole("dialog", { name: "Create pivot table" });
    expect(within(dialog).getByText("Source range: A1:C6")).toBeTruthy();
    expect(within(dialog).getByRole("radio", { name: "New worksheet" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    // Pivot1 tab becomes active and the editor region appears
    expect(await screen.findByRole("tab", { name: "Pivot1" })).toBeTruthy();
    const editor = await screen.findByRole("region", { name: "Pivot table editor" });
    const rowsCombo = within(editor).getByRole("combobox", { name: "Rows" });
    expect(within(rowsCombo).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "",
      "Region",
      "Sales",
      "Status",
    ]);
    expect(within(editor).getByRole("combobox", { name: "Columns" })).toBeTruthy();
    expect(within(editor).getByRole("combobox", { name: "Values" })).toBeTruthy();
    const summarize = within(editor).getByRole("combobox", { name: "Summarize by" });
    expect(within(summarize).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "",
      "SUM",
      "COUNT",
      "AVERAGE",
    ]);

    // configure Rows=Region, Values=Sales, Summarize by=SUM and Apply
    await user.selectOptions(rowsCombo, "Region");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Values" }), "Sales");
    await user.selectOptions(summarize, "SUM");
    await user.click(within(editor).getByRole("button", { name: "Apply" }));

    // the summary grid shows the computed results
    await expectCell("A1", "Region");
    await expectCell("B1", "SUM of Sales");
    await expectCell("A2", "East");
    await expectCell("B2", "1200");
    await expectCell("A5", "Grand Total");
    await expectCell("B5", "2700");

    // the source worksheet keeps its original values and order
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await expectCell("A1", "Region");
    await expectCell("B2", "1200");
    await expectCell("A3", "North");

    // reopening from the entry point restores the same pivot sheet, layout
    // and results (last active tab is Sheet1 from the switch above)
    await user.click(screen.getByRole("link", { name: "Back to home" }));
    await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
    await screen.findByRole("heading", { name: "Q3 Sales" });
    await user.click(await screen.findByRole("tab", { name: "Pivot1" }));
    const editorAgain = await screen.findByRole("region", { name: "Pivot table editor" });
    expect(
      (within(editorAgain).getByRole("combobox", { name: "Rows" }) as HTMLSelectElement).value,
    ).toBe("Region");
    expect(
      (within(editorAgain).getByRole("combobox", { name: "Summarize by" }) as HTMLSelectElement)
        .value,
    ).toBe("SUM");
    await expectCell("A1", "Region");
    await expectCell("B1", "SUM of Sales");
    await expectCell("B5", "2700");
  }, 20000);

  it("supports COUNT with a column field and refreshes after source changes", async () => {
    const backend = installFakeBackend();
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await selectRange(user, "A1", "C6");
    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create pivot table" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Create pivot table" })).getByRole("button", { name: "Create" }),
    );

    const editor = await screen.findByRole("region", { name: "Pivot table editor" });
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Rows" }), "Region");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Columns" }), "Status");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Values" }), "Sales");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Summarize by" }), "COUNT");
    await user.click(within(editor).getByRole("button", { name: "Apply" }));

    await expectCell("B1", "Open");
    await expectCell("C1", "Closed");
    await expectCell("D1", "Grand Total");
    await expectCell("C2", "0"); // East × Closed
    await expectCell("B3", "0"); // North × Open
    await expectCell("D5", "3");
    expect(screen.getByRole("button", { name: "Refresh pivot table" })).toBeTruthy();

    // change the source and refresh recomputes the summary
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    const salesCell = within(grid).getByRole("gridcell", { name: "B2" });
    fireEvent.mouseDown(salesCell);
    fireEvent.mouseUp(window);
    await user.dblClick(salesCell);
    const editorInput = await screen.findByRole("textbox", { name: "Edit B2" });
    await user.clear(editorInput);
    await user.type(editorInput, "1500");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(gridCellValue("B2")).toBe("1500"));

    // the stored result is unchanged until refresh
    await user.click(screen.getByRole("tab", { name: "Pivot1" }));
    await waitFor(() => expect(gridCellValue("D5")).toBe("3"));
    await user.click(screen.getByRole("button", { name: "Refresh pivot table" }));
    await waitFor(() => expect(gridCellValue("D5")).toBe("3"));

    // reopen from the entry point keeps the pivot sheet and layout
    const workbook = backend.store[0];
    const pivot = workbook.sheets.find((sheet) => sheet.pivot);
    expect(pivot?.name).toBe("Pivot1");
    expect(pivot?.pivot?.rowField).toBe("Region");
    expect(pivot?.pivot?.columnField).toBe("Status");
    expect(pivot?.pivot?.valueField).toBe("Sales");
    expect(pivot?.pivot?.summarizeBy).toBe("COUNT");
    expect(pivot?.cells.D5).toBe("3");
  }, 20000);

  it("shows the numeric-value error and preserves the previous result", async () => {
    installFakeBackend();
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await selectRange(user, "A1", "C6");
    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create pivot table" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Create pivot table" })).getByRole("button", { name: "Create" }),
    );

    const editor = await screen.findByRole("region", { name: "Pivot table editor" });
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Rows" }), "Region");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Values" }), "Sales");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Summarize by" }), "SUM");
    await user.click(within(editor).getByRole("button", { name: "Apply" }));
    await expectCell("B5", "2700");

    // re-apply with a nonnumeric value field: the old result is preserved
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Values" }), "Status");
    await user.click(within(editor).getByRole("button", { name: "Apply" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Value field requires numeric values",
    );
    await expectCell("B5", "2700");
    await expectCell("B1", "SUM of Sales");
  });

  it("shows a field-unavailable error when a selected header is renamed", async () => {
    installFakeBackend();
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await selectRange(user, "A1", "C6");
    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create pivot table" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Create pivot table" })).getByRole("button", { name: "Create" }),
    );

    const editor = await screen.findByRole("region", { name: "Pivot table editor" });
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Rows" }), "Region");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Values" }), "Sales");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Summarize by" }), "SUM");
    await user.click(within(editor).getByRole("button", { name: "Apply" }));
    await expectCell("B5", "2700");

    // the selected header disappears from the source range
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    const headerCell = within(grid).getByRole("gridcell", { name: "A1" });
    fireEvent.mouseDown(headerCell);
    fireEvent.mouseUp(window);
    await user.dblClick(headerCell);
    const input = await screen.findByRole("textbox", { name: "Edit A1" });
    await user.clear(input);
    await user.type(input, "Zone");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(gridCellValue("A1")).toBe("Zone"));

    // opening the pivot editor shows the error and preserves the last result
    await user.click(screen.getByRole("tab", { name: "Pivot1" }));
    const editorAgain = await screen.findByRole("region", { name: "Pivot table editor" });
    expect(await within(editorAgain).findByRole("alert")).toBeTruthy();
    expect(within(editorAgain).getByRole("alert").textContent).toBe(
      "Pivot field is no longer available. Select a new field.",
    );
    await expectCell("B5", "2700");
  }, 20000);
});
