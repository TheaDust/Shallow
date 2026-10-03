import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { PIVOT_FIELD_MISSING_MESSAGE, PIVOT_GRAND_TOTAL_LABEL } from "../domain/pivot";
import type { CellInput, PivotSpec, Selection, Workbook, Worksheet } from "../domain/types";
import { installFetchStub, type StubRequest } from "../test/fetch-stub";
import { seededWorkbook } from "../test/fixtures";

const WORKBOOK_URL = "/api/workbooks/wb-q3-sales";
const PIVOTS_URL = `${WORKBOOK_URL}/pivots`;
const SHEET = "ws-q3-sales-sheet1";

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

const cellTextOf = (worksheet: Worksheet, row: number, column: number) =>
  String(worksheet.cells[coordinateName(row, column)]?.value ?? "");

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

type PivotRecord = { rowValue: string; columnValue: string; valueText: string };

function aggregate(method: PivotSpec["summarizeBy"], records: PivotRecord[]): string {
  if (method === "COUNT") return String(records.filter((record) => record.valueText.trim() !== "").length);
  const numbers = records.map((record) => parseNumber(record.valueText)).filter((value): value is number => value !== null);
  if (numbers.length === 0) return "0";
  const total = numbers.reduce((sum, value) => sum + value, 0);
  return String(Number((method === "AVERAGE" ? total / numbers.length : total).toFixed(10)));
}

/** Mirrors the backend pivot engine so the page test can drive real result values. */
function mirrorPivot(
  workbook: Workbook,
  spec: PivotSpec,
): { cells: Record<string, { value: string }> } | { error: string } {
  const bounds = rangeBounds(spec.sourceRange);
  const source = workbook.worksheets.find((worksheet) => worksheet.id === spec.sourceWorksheetId);
  const missing = { error: PIVOT_FIELD_MISSING_MESSAGE };
  if (!bounds || !source) return { error: "Invalid pivot source range" };

  const options: Array<{ column: number; name: string }> = [];
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    const header = cellTextOf(source, bounds.top, column).trim();
    options.push({ column, name: header !== "" ? header : columnLetters(column) });
  }
  const resolve = (field: string | null | undefined) => {
    if (!field) return null;
    const match = options.find((option) => option.name === field);
    return match ? match.column : null;
  };
  const rowColumn = resolve(spec.rowField);
  const valueColumn = resolve(spec.valueField);
  const columnColumn = resolve(spec.columnField);
  if (rowColumn === null || valueColumn === null) return missing;
  if (spec.columnField && columnColumn === null) return missing;

  const records: PivotRecord[] = [];
  for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
    const blank = Array.from({ length: bounds.right - bounds.left + 1 }, (_, index) =>
      cellTextOf(source, row, bounds.left + index).trim(),
    ).every((text) => text === "");
    if (blank) continue;
    records.push({
      rowValue: cellTextOf(source, row, rowColumn),
      columnValue: columnColumn === null ? "" : cellTextOf(source, row, columnColumn),
      valueText: cellTextOf(source, row, valueColumn),
    });
  }
  if (spec.summarizeBy !== "COUNT" && !records.some((record) => parseNumber(record.valueText) !== null)) {
    return { error: "Value field requires numeric values" };
  }

  const rowKeys: string[] = [];
  const columnKeys: string[] = [];
  for (const record of records) {
    if (!rowKeys.includes(record.rowValue)) rowKeys.push(record.rowValue);
    if (columnColumn !== null && !columnKeys.includes(record.columnValue)) columnKeys.push(record.columnValue);
  }
  const forKeys = (rowValue: string | null, columnValue: string | null) =>
    records.filter(
      (record) =>
        (rowValue === null || record.rowValue === rowValue) &&
        (columnValue === null || record.columnValue === columnValue),
    );

  const cells: Record<string, { value: string }> = {};
  cells.A1 = { value: spec.rowField ?? "" };
  if (columnColumn === null) {
    cells.B1 = { value: `${spec.summarizeBy} of ${spec.valueField ?? ""}` };
    let row = 1;
    for (const key of rowKeys) {
      cells[coordinateName(row, 0)] = { value: key };
      cells[coordinateName(row, 1)] = { value: aggregate(spec.summarizeBy, forKeys(key, null)) };
      row += 1;
    }
    cells[coordinateName(row, 0)] = { value: PIVOT_GRAND_TOTAL_LABEL };
    cells[coordinateName(row, 1)] = { value: aggregate(spec.summarizeBy, records) };
    return { cells };
  }
  columnKeys.forEach((key, index) => {
    cells[coordinateName(0, index + 1)] = { value: key };
  });
  const totalColumn = columnKeys.length + 1;
  cells[coordinateName(0, totalColumn)] = { value: PIVOT_GRAND_TOTAL_LABEL };
  let row = 1;
  for (const rowKey of rowKeys) {
    cells[coordinateName(row, 0)] = { value: rowKey };
    columnKeys.forEach((columnKey, index) => {
      cells[coordinateName(row, index + 1)] = {
        value: aggregate(spec.summarizeBy, forKeys(rowKey, columnKey)),
      };
    });
    cells[coordinateName(row, totalColumn)] = { value: aggregate(spec.summarizeBy, forKeys(rowKey, null)) };
    row += 1;
  }
  cells[coordinateName(row, 0)] = { value: PIVOT_GRAND_TOTAL_LABEL };
  columnKeys.forEach((columnKey, index) => {
    cells[coordinateName(row, index + 1)] = { value: aggregate(spec.summarizeBy, forKeys(null, columnKey)) };
  });
  cells[coordinateName(row, totalColumn)] = { value: aggregate(spec.summarizeBy, records) };
  return { cells };
}

interface PivotStubOptions {
  workbook?: Workbook;
  applyError?: string;
}

/** Stateful API double mirroring the pivot, cell, selection and active-worksheet endpoints. */
function stubPivotApi(options: PivotStubOptions = {}) {
  let current: Workbook = structuredClone(options.workbook ?? seededWorkbook);
  let created = 0;
  const requests: StubRequest[] = [];

  const replaceWorkbook = (next: Workbook) => {
    current = { ...next, updatedAt: "2026-10-04T10:00:00.000Z" };
  };
  const updateSheet = (worksheetId: string, change: (worksheet: Worksheet) => Worksheet) => {
    replaceWorkbook({
      ...current,
      worksheets: current.worksheets.map((worksheet) =>
        worksheet.id === worksheetId ? change(worksheet) : worksheet,
      ),
    });
  };
  const pivotOf = (worksheetId: string) => current.worksheets.find((worksheet) => worksheet.id === worksheetId);

  installFetchStub((request) => {
    requests.push(request);
    const { method, url } = request;
    if (url === WORKBOOK_URL && method === "GET") return { body: { workbook: current } };
    if (url === WORKBOOK_URL && method === "PATCH") {
      const body = request.body as { activeWorksheetId?: string; name?: string };
      if (body.activeWorksheetId) {
        replaceWorkbook({ ...current, activeWorksheetId: body.activeWorksheetId });
      }
      return { body: { workbook: current } };
    }
    if (url === PIVOTS_URL && method === "POST") {
      const body = request.body as { sourceWorksheetId: string; range: string };
      created += 1;
      const worksheet: Worksheet = {
        id: `ws-pivot-${created}`,
        name: `Pivot${created}`,
        rowCount: 30,
        columnCount: 26,
        cells: {},
        selection: { anchor: "A1", focus: "A1" },
        pivot: {
          sourceWorksheetId: body.sourceWorksheetId,
          sourceRange: body.range,
          rowField: null,
          columnField: null,
          valueField: null,
          summarizeBy: "SUM",
        },
      };
      replaceWorkbook({
        ...current,
        activeWorksheetId: worksheet.id,
        worksheets: [...current.worksheets, worksheet],
      });
      return { status: 201, body: { workbook: current } };
    }
    const applyMatch = new RegExp(`^${WORKBOOK_URL}/worksheets/([^/]+)/pivot$`).exec(url);
    if (applyMatch && method === "POST") {
      if (options.applyError) return { status: 400, body: { error: options.applyError } };
      const target = pivotOf(decodeURIComponent(applyMatch[1]));
      if (!target?.pivot) return { status: 400, body: { error: "This worksheet does not contain a pivot table" } };
      const body = request.body as {
        rowField: string;
        columnField: string | null;
        valueField: string;
        summarizeBy: PivotSpec["summarizeBy"];
      };
      const spec: PivotSpec = {
        ...target.pivot,
        rowField: body.rowField,
        columnField: body.columnField,
        valueField: body.valueField,
        summarizeBy: body.summarizeBy,
      };
      const computed = mirrorPivot(current, spec);
      if ("error" in computed) return { status: 400, body: { error: computed.error } };
      updateSheet(target.id, (worksheet) => ({ ...worksheet, pivot: spec, cells: computed.cells }));
      return { body: { workbook: current } };
    }
    const refreshMatch = new RegExp(`^${WORKBOOK_URL}/worksheets/([^/]+)/pivot/refresh$`).exec(url);
    if (refreshMatch && method === "POST") {
      const target = pivotOf(decodeURIComponent(refreshMatch[1]));
      if (!target?.pivot) return { status: 400, body: { error: "This worksheet does not contain a pivot table" } };
      const computed = mirrorPivot(current, target.pivot);
      if ("error" in computed) return { status: 400, body: { error: computed.error } };
      updateSheet(target.id, (worksheet) => ({ ...worksheet, cells: computed.cells }));
      return { body: { workbook: current } };
    }
    const cellsMatch = new RegExp(`^${WORKBOOK_URL}/worksheets/([^/]+)/cells$`).exec(url);
    if (cellsMatch && method === "PATCH") {
      const worksheetId = decodeURIComponent(cellsMatch[1]);
      const body = request.body as { updates: CellInput[]; selection?: Selection };
      updateSheet(worksheetId, (worksheet) => {
        const cells = structuredClone(worksheet.cells);
        for (const update of body.updates) {
          if (update.input === "") delete cells[update.name];
          else cells[update.name] = { value: update.input };
        }
        return { ...worksheet, cells, selection: body.selection ?? worksheet.selection };
      });
      return { body: { workbook: current } };
    }
    const selectionMatch = new RegExp(`^${WORKBOOK_URL}/worksheets/([^/]+)/selection$`).exec(url);
    if (selectionMatch && method === "PATCH") {
      const selection = request.body as Selection;
      updateSheet(decodeURIComponent(selectionMatch[1]), (worksheet) => ({ ...worksheet, selection }));
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

async function selectRange(user: ReturnType<typeof userEvent.setup>, from: string, to: string) {
  fireEvent.mouseDown(screen.getByRole("gridcell", { name: from }));
  fireEvent.mouseEnter(screen.getByRole("gridcell", { name: to }));
  fireEvent.mouseUp(window);
  await waitFor(() => expect(screen.getByRole("gridcell", { name: from })).toHaveAttribute("aria-selected", "true"));
}

/** Creates a pivot table from the whole seeded region and returns its editor region. */
async function openPivotEditor(user: ReturnType<typeof userEvent.setup>) {
  await selectRange(user, "A1", "C4");
  await user.click(screen.getByRole("button", { name: "Data" }));
  await user.click(screen.getByRole("menuitem", { name: "Create pivot table" }));
  const dialog = await screen.findByRole("dialog", { name: "Create pivot table" });
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
  return screen.findByRole("region", { name: "Pivot table editor" });
}

describe("pivot tables", () => {
  afterEach(reset);

  it("creates a Pivot1 worksheet from the selected range through the Data menu", async () => {
    const stub = stubPivotApi();
    const user = userEvent.setup();
    await openEditor();

    await selectRange(user, "A1", "C4");
    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(screen.getByRole("menuitem", { name: "Create pivot table" }));

    const dialog = await screen.findByRole("dialog", { name: "Create pivot table" });
    expect(within(dialog).getByText("Source range: A1:C4")).toBeInTheDocument();
    const destination = within(dialog).getByRole("radio", { name: "New worksheet" });
    expect(destination).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("tab", { name: "Pivot1" })).toHaveAttribute("aria-selected", "true");
    const posted = stub.requests.find((request) => request.url === PIVOTS_URL && request.method === "POST");
    expect(posted?.body).toEqual({ sourceWorksheetId: SHEET, range: "A1:C4" });
    expect(stub.workbook().worksheets.at(-1)?.pivot?.sourceRange).toBe("A1:C4");
  });

  it("offers the pivot editor fields, source header options and the summarization methods", async () => {
    stubPivotApi();
    const user = userEvent.setup();
    await openEditor();

    const editor = await openPivotEditor(user);
    for (const label of ["Rows", "Columns", "Values", "Summarize by"]) {
      expect(within(editor).getByRole("combobox", { name: label })).toBeInTheDocument();
    }
    expect(within(editor).getAllByRole("option").map((option) => option.textContent)).toEqual(
      expect.arrayContaining(["Region", "Sales", "Status", "SUM", "COUNT", "AVERAGE", "None"]),
    );
    expect(within(editor).getByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "Refresh pivot table" })).toBeInTheDocument();
  });

  it("applies one row and one value field and keeps the source worksheet untouched", async () => {
    const stub = stubPivotApi();
    const user = userEvent.setup();
    await openEditor();

    const editor = await openPivotEditor(user);
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Rows" }), "Region");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Values" }), "Sales");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Summarize by" }), "SUM");
    await user.click(within(editor).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B5" })).toHaveTextContent("2700"));
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
    expect(screen.getByRole("gridcell", { name: "B1" })).toHaveTextContent("SUM of Sales");
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
    expect(screen.getByRole("gridcell", { name: "B2" })).toHaveTextContent("1200");
    expect(screen.getByRole("gridcell", { name: "A3" })).toHaveTextContent("North");
    expect(screen.getByRole("gridcell", { name: "A4" })).toHaveTextContent("South");
    expect(screen.getByRole("gridcell", { name: "A5" })).toHaveTextContent("Grand Total");

    // Switching back to the source worksheet keeps its values and row order.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(await screen.findByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
    expect(screen.getByRole("gridcell", { name: "A3" })).toHaveTextContent("North");
    expect(screen.getByRole("gridcell", { name: "A4" })).toHaveTextContent("South");
    expect(screen.getByRole("gridcell", { name: "B2" })).toHaveTextContent("1200");
    expect(stub.workbook().worksheets[0].cells.A2.value).toBe("East");

    // Refreshing the page from the editor entry point restores the same pivot worksheet.
    cleanup();
    await openEditor();
    await user.click(await screen.findByRole("tab", { name: "Pivot1" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B5" })).toHaveTextContent("2700"));
    expect(screen.getByRole("gridcell", { name: "B1" })).toHaveTextContent("SUM of Sales");
    const restored = within(screen.getByRole("region", { name: "Pivot table editor" }));
    expect(restored.getByRole("combobox", { name: "Rows" })).toHaveValue("Region");
    expect(restored.getByRole("combobox", { name: "Values" })).toHaveValue("Sales");
    expect(restored.getByRole("combobox", { name: "Summarize by" })).toHaveValue("SUM");
  });

  it("lays out an optional column field with a Grand Total column and row", async () => {
    stubPivotApi();
    const user = userEvent.setup();
    await openEditor();

    const editor = await openPivotEditor(user);
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Rows" }), "Region");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Columns" }), "Status");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Values" }), "Sales");
    await user.click(within(editor).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D5" })).toHaveTextContent("2700"));
    expect(screen.getByRole("gridcell", { name: "B1" })).toHaveTextContent("Open");
    expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("Closed");
    expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("Grand Total");
    expect(screen.getByRole("gridcell", { name: "B2" })).toHaveTextContent("1200");
    expect(screen.getByRole("gridcell", { name: "C3" })).toHaveTextContent("800");
    expect(screen.getByRole("gridcell", { name: "B5" })).toHaveTextContent("1900");
    expect(screen.getByRole("gridcell", { name: "A5" })).toHaveTextContent("Grand Total");
  });

  it("counts non-empty records and reports 0 for an empty combination", async () => {
    stubPivotApi();
    const user = userEvent.setup();
    await openEditor();

    const editor = await openPivotEditor(user);
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Rows" }), "Region");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Columns" }), "Status");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Values" }), "Sales");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Summarize by" }), "COUNT");
    await user.click(within(editor).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D5" })).toHaveTextContent("3"));
    expect(screen.getByRole("gridcell", { name: "C2" })).toHaveTextContent("0");
    expect(screen.getByRole("gridcell", { name: "B3" })).toHaveTextContent("0");
    expect(screen.getByRole("gridcell", { name: "C3" })).toHaveTextContent("1");
    expect(screen.getByRole("gridcell", { name: "B5" })).toHaveTextContent("2");
  });

  it("refreshes the summary from the current source data", async () => {
    const stub = stubPivotApi();
    const user = userEvent.setup();
    await openEditor();

    const editor = await openPivotEditor(user);
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Rows" }), "Region");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Values" }), "Sales");
    await user.click(within(editor).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B5" })).toHaveTextContent("2700"));

    // Change one source value and return to the pivot worksheet.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await user.click(await screen.findByRole("gridcell", { name: "B2" }));
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.clear(formulaBar);
    await user.type(formulaBar, "2000");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B2" })).toHaveTextContent("2000"));

    await user.click(screen.getByRole("tab", { name: "Pivot1" }));
    const region = await screen.findByRole("region", { name: "Pivot table editor" });
    expect(screen.getByRole("gridcell", { name: "B2" })).toHaveTextContent("1200");
    await user.click(within(region).getByRole("button", { name: "Refresh pivot table" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B2" })).toHaveTextContent("2000"));
    expect(screen.getByRole("gridcell", { name: "B5" })).toHaveTextContent("3500");
    expect(stub.workbook().worksheets[0].cells.B2.value).toBe("2000");
  });

  it("shows the numeric-value error and keeps the last successful result", async () => {
    const stub = stubPivotApi({ applyError: "Value field requires numeric values" });
    const user = userEvent.setup();
    await openEditor();

    const editor = await openPivotEditor(user);
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Rows" }), "Region");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Values" }), "Sales");
    await user.click(within(editor).getByRole("button", { name: "Apply" }));

    const alert = await within(editor).findByRole("alert");
    expect(alert).toHaveTextContent("Value field requires numeric values");
    const pivotSheet = stub.workbook().worksheets.at(-1);
    expect(pivotSheet?.cells).toEqual({});
    expect(pivotSheet?.pivot?.valueField).toBeNull();
  });

  it("reports a deleted source header and keeps the last result when refreshing", async () => {
    // The stored pivot still reads "Sales", which the source worksheet no longer has.
    const shrunk: Workbook = {
      ...structuredClone(seededWorkbook),
      worksheets: [
        {
          ...structuredClone(seededWorkbook.worksheets[0]),
          cells: {
            A1: { value: "Region" },
            B1: { value: "Status" },
            A2: { value: "East" },
            B2: { value: "Open" },
            A3: { value: "North" },
            B3: { value: "Closed" },
            A4: { value: "South" },
            B4: { value: "Open" },
          },
        },
        structuredClone(seededWorkbook.worksheets[1]),
        {
          id: "ws-pivot-1",
          name: "Pivot1",
          rowCount: 30,
          columnCount: 26,
          cells: {
            A1: { value: "Region" },
            B1: { value: "SUM of Sales" },
            A2: { value: "East" },
            B2: { value: "1200" },
            A3: { value: "North" },
            B3: { value: "800" },
            A4: { value: "South" },
            B4: { value: "700" },
            A5: { value: "Grand Total" },
            B5: { value: "2700" },
          },
          selection: { anchor: "A1", focus: "A1" },
          pivot: {
            sourceWorksheetId: SHEET,
            sourceRange: "A1:B4",
            rowField: "Region",
            columnField: null,
            valueField: "Sales",
            summarizeBy: "SUM",
          },
        },
      ],
      activeWorksheetId: "ws-pivot-1",
    };
    const stub = stubPivotApi({ workbook: shrunk });
    const user = userEvent.setup();
    await openEditor();

    const editor = await screen.findByRole("region", { name: "Pivot table editor" });
    expect(within(editor).getByRole("alert")).toHaveTextContent(
      "Pivot field is no longer available. Select a new field.",
    );
    expect(screen.getByRole("gridcell", { name: "B5" })).toHaveTextContent("2700");

    await user.click(within(editor).getByRole("button", { name: "Refresh pivot table" }));
    await waitFor(() =>
      expect(within(editor).getByRole("alert")).toHaveTextContent(
        "Pivot field is no longer available. Select a new field.",
      ),
    );
    expect(screen.getByRole("gridcell", { name: "B5" })).toHaveTextContent("2700");
    expect(stub.workbook().worksheets[2].cells.B5.value).toBe("2700");
    expect(stub.workbook().worksheets[0].cells.A2.value).toBe("East");
  });
});
