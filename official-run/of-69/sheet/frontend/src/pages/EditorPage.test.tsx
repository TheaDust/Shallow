import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import type { CellData, CellInput, Selection, Workbook, Worksheet } from "../domain/types";
import { installFetchStub, type StubRequest } from "../test/fetch-stub";
import { seededWorkbook, twoSheetWorkbook } from "../test/fixtures";

function reset() {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  window.history.replaceState(null, "", "/");
}

const WORKBOOK_URL = "/api/workbooks/wb-q3-sales";
const WORKSHEETS_URL = "/api/workbooks/wb-q3-sales/worksheets";
const WORKSHEET_URL = /^\/api\/workbooks\/wb-q3-sales\/worksheets\/([^/]+)$/;
const STRUCTURE_ROWS_URL = "/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet1/rows";
const STRUCTURE_COLUMNS_URL = "/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet1/columns";
const CELLS_URL = "/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet1/cells";
const RANGE_URL = "/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet1/range";
const RESTORE_URL = "/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet1/restore";
const SELECTION_URL = "/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet1/selection";
const CELLS_ROUTE = /^\/api\/workbooks\/wb-q3-sales\/worksheets\/([^/]+)\/cells$/;
const SELECTION_ROUTE = /^\/api\/workbooks\/wb-q3-sales\/worksheets\/([^/]+)\/selection$/;
const RANGE_ROUTE = /^\/api\/workbooks\/wb-q3-sales\/worksheets\/([^/]+)\/range$/;
const RESTORE_ROUTE = /^\/api\/workbooks\/wb-q3-sales\/worksheets\/([^/]+)\/restore$/;
const STRUCTURE_ROUTE = /^\/api\/workbooks\/wb-q3-sales\/worksheets\/([^/]+)\/(rows|columns)$/;

/** Minimal coordinate helpers mirroring the backend for the in-memory API double. */
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

function boundsOf(selection: Selection) {
  const anchor = parseCoordinate(selection.anchor);
  const focus = parseCoordinate(selection.focus ?? selection.anchor);
  if (!anchor || !focus) return null;
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    right: Math.max(anchor.column, focus.column),
  };
}

/** Offset relative references the way the backend does when copying a formula. */
function translateFormula(formula: string, rowOffset: number, columnOffset: number): string {
  let invalid = false;
  const translated = formula.replace(
    /(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*)/g,
    (_whole, colAbs: string, letters: string, rowAbs: string, digits: string) => {
      let column = 0;
      for (const character of letters.toUpperCase()) column = column * 26 + (character.charCodeAt(0) - 64);
      column -= 1;
      let row = Number(digits) - 1;
      if (!colAbs) column += columnOffset;
      if (!rowAbs) row += rowOffset;
      if (row < 0 || column < 0) {
        invalid = true;
        return "#REF!";
      }
      return `${colAbs}${columnLetters(column)}${rowAbs}${row + 1}`;
    },
  );
  if (!invalid) return translated;
  return formula.startsWith("=") ? "=#REF!" : "#REF!";
}

/** Sheet1 after a row is inserted below row 2: rows 3+ move down together. */
const sheet1WithInsertedRow: Worksheet = {
  ...seededWorkbook.worksheets[0],
  rowCount: 31,
  cells: {
    A1: { value: "Region" },
    B1: { value: "Sales" },
    C1: { value: "Status" },
    A2: { value: "East" },
    B2: { value: "1200" },
    C2: { value: "Open" },
    A4: { value: "North" },
    B4: { value: "800" },
    C4: { value: "Closed" },
    A5: { value: "South" },
    B5: { value: "700" },
    C5: { value: "Open" },
  },
};

/** Sheet1 after a column is inserted left of column B. */
const sheet1WithInsertedColumn: Worksheet = {
  ...seededWorkbook.worksheets[0],
  columnCount: 27,
  cells: {
    A1: { value: "Region" },
    C1: { value: "Sales" },
    D1: { value: "Status" },
    A2: { value: "East" },
    C2: { value: "1200" },
    D2: { value: "Open" },
    A3: { value: "North" },
    C3: { value: "800" },
    D3: { value: "Closed" },
    A4: { value: "South" },
    C4: { value: "700" },
    D4: { value: "Open" },
  },
};

function withSheet1(workbook: Workbook, sheet1: Worksheet): Workbook {
  return { ...workbook, worksheets: [sheet1, ...workbook.worksheets.slice(1)] };
}

function stubEditor(onPatch?: (request: StubRequest) => { status?: number; body: unknown }) {
  return installFetchStub((request) => {
    if (request.url === WORKBOOK_URL && request.method === "GET") {
      return { body: { workbook: seededWorkbook } };
    }
    if (request.url === WORKBOOK_URL && request.method === "PATCH" && onPatch) {
      return onPatch(request);
    }
    return { status: 404, body: { error: "Not found" } };
  });
}

async function openEditor() {
  window.location.hash = "#/workbooks/wb-q3-sales";
  render(<App />);
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
}

/** Numeric meaning of one cell like the backend: numeric text converts, blanks and text do not. */
function numericCell(cells: Record<string, CellData>, name: string): number | null {
  const text = (cells[name]?.value ?? "").trim();
  return text === "" || Number.isNaN(Number(text)) ? null : Number(text);
}

/** Numeric cells of a contiguous range, skipping blanks and text. */
function rangeValues(cells: Record<string, CellData>, range: string): number[] {
  const [first, last] = range.split(":");
  const start = parseCoordinate(first);
  const end = parseCoordinate(last);
  if (!start || !end) return [];
  const values: number[] = [];
  for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
    for (let column = Math.min(start.column, end.column); column <= Math.max(start.column, end.column); column += 1) {
      const number = numericCell(cells, coordinateName(row, column));
      if (number !== null) values.push(number);
    }
  }
  return values;
}

const ERROR_VALUE = /^#(?:REF!|DIV\/0!|NAME\?|ERROR!|VALUE!)$/;

function operand(cells: Record<string, CellData>, token: string): number | null {
  const text = token.trim();
  if (/^[A-Za-z]+[0-9]+$/.test(text)) return numericCell(cells, text.toUpperCase());
  return Number.isNaN(Number(text)) ? null : Number(text);
}

/** Raw text an argument stands for: a referenced cell's value text, or the literal itself. */
function operandText(cells: Record<string, CellData>, token: string): string {
  const text = token.trim();
  if (/^[A-Za-z]+[0-9]+$/.test(text)) return String(cells[text.toUpperCase()]?.value ?? "").trim();
  return text;
}

/** Calculates the formulas used by these tests the way the backend does. */
function calculate(cells: Record<string, CellData>, input: string): string {
  const body = input.replace(/^=/, "").trim();
  if (ERROR_VALUE.test(body)) return body;
  const aggregate = /^(SUM|AVERAGE|COUNT|MIN|MAX)\(([^)]*)\)$/i.exec(body);
  if (aggregate) {
    const args = aggregate[2].split(",").map((argument) => argument.trim());
    for (const token of args) {
      const text = operandText(cells, token);
      if (ERROR_VALUE.test(text)) return text;
    }
    const numbers = args.flatMap((token) => {
      if (/^[A-Za-z]+[0-9]+:[A-Za-z]+[0-9]+$/.test(token)) return rangeValues(cells, token);
      const number = operand(cells, token);
      return number === null ? [] : [number];
    });
    const sum = numbers.reduce((total, number) => total + number, 0);
    switch (aggregate[1].toUpperCase()) {
      case "SUM":
        return String(sum);
      case "COUNT":
        return String(numbers.length);
      case "AVERAGE":
        return numbers.length === 0 ? "#DIV/0!" : String(sum / numbers.length);
      case "MIN":
        return numbers.length === 0 ? "0" : String(Math.min(...numbers));
      default:
        return numbers.length === 0 ? "0" : String(Math.max(...numbers));
    }
  }
  const binary = /^([^+\-*/]+)([+\-*/])(.+)$/.exec(body);
  if (!binary) return "#ERROR!";
  const leftError = ERROR_VALUE.test(operandText(cells, binary[1]));
  const rightError = ERROR_VALUE.test(operandText(cells, binary[3]));
  if (leftError) return operandText(cells, binary[1]);
  if (rightError) return operandText(cells, binary[3]);
  const left = operand(cells, binary[1]);
  const right = operand(cells, binary[3]);
  if (left === null || right === null) return "#ERROR!";
  if (binary[2] === "+") return String(left + right);
  if (binary[2] === "-") return String(left - right);
  if (binary[2] === "*") return String(left * right);
  return right === 0 ? "#DIV/0!" : String(left / right);
}

/** Recomputes every stored formula value, mirroring the backend recalculation. */
function recalculate(cells: Record<string, CellData>): Record<string, CellData> {
  const next = structuredClone(cells);
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const [name, cell] of Object.entries(next)) {
      if (!cell.formula) continue;
      const value = calculate(next, cell.formula);
      if (cell.value !== value) {
        next[name] = { ...cell, value };
        changed = true;
      }
    }
    if (!changed) break;
  }
  return next;
}

/** Shift rows/columns the way the backend does for the in-memory API double. */
function applyStructure(worksheet: Worksheet, axis: "rows" | "columns", action: string, index: number): Worksheet {
  const isRow = axis === "rows";
  const kind = action === "delete"
    ? "delete"
    : action.endsWith("above") || action.endsWith("left")
      ? "before"
      : "after";
  const map = (value: number): number | null => {
    if (kind === "delete") return value === index ? null : value > index ? value - 1 : value;
    const threshold = kind === "before" ? index : index + 1;
    return value >= threshold ? value + 1 : value;
  };
  const cells: Record<string, CellData> = {};
  for (const [name, cell] of Object.entries(worksheet.cells)) {
    const position = parseCoordinate(name);
    if (!position) continue;
    const row = isRow ? map(position.row) : position.row;
    const column = isRow ? position.column : map(position.column);
    if (row === null || column === null) continue;
    cells[coordinateName(row, column)] = { ...cell };
  }
  return {
    ...worksheet,
    rowCount: worksheet.rowCount + (isRow ? (kind === "delete" ? -1 : 1) : 0),
    columnCount: worksheet.columnCount + (isRow ? 0 : kind === "delete" ? -1 : 1),
    cells,
  };
}

interface CellStubOptions {
  workbook?: Workbook;
  /** When set, every cell write is rejected with this message. */
  cellsError?: string;
  /** When set, every range transfer is rejected with this message. */
  rangeError?: string;
}

/** Stateful in-memory API double mirroring the cell, selection and worksheet endpoints. */
function stubCellEditing(options: CellStubOptions = {}) {
  let current: Workbook = structuredClone(options.workbook ?? seededWorkbook);
  const requests: StubRequest[] = [];
  installFetchStub((request) => {
    requests.push(request);
    const cellsMatch = CELLS_ROUTE.exec(request.url);
    const selectionMatch = SELECTION_ROUTE.exec(request.url);
    const rangeMatch = RANGE_ROUTE.exec(request.url);
    const restoreMatch = RESTORE_ROUTE.exec(request.url);
    const structureMatch = STRUCTURE_ROUTE.exec(request.url);
    if (request.url === WORKBOOK_URL && request.method === "GET") {
      return { body: { workbook: current } };
    }
    if (request.url === WORKBOOK_URL && request.method === "PATCH") {
      const activeWorksheetId = String((request.body as { activeWorksheetId?: string }).activeWorksheetId ?? "");
      current = { ...current, activeWorksheetId, updatedAt: "2026-10-03T11:00:00.000Z" };
      return { body: { workbook: current } };
    }
    if (cellsMatch && request.method === "PATCH") {
      if (options.cellsError) return { status: 400, body: { error: options.cellsError } };
      const body = request.body as { updates: CellInput[]; selection?: Selection };
      const worksheetId = decodeURIComponent(cellsMatch[1]);
      const target = current.worksheets.find((worksheet) => worksheet.id === worksheetId);
      if (!target) return { status: 404, body: { error: "Worksheet not found" } };
      const cells = structuredClone(target.cells);
      for (const update of body.updates) {
        if (update.input === "") delete cells[update.name];
        else if (update.input.startsWith("=")) cells[update.name] = { formula: update.input, value: "" };
        else cells[update.name] = { value: update.input };
      }
      const recalculated = recalculate(cells);
      current = {
        ...current,
        updatedAt: "2026-10-03T11:00:00.000Z",
        worksheets: current.worksheets.map((worksheet) =>
          worksheet.id === worksheetId
            ? { ...worksheet, cells: recalculated, selection: body.selection ?? worksheet.selection }
            : worksheet,
        ),
      };
      return { body: { workbook: current } };
    }
    if (selectionMatch && request.method === "PATCH") {
      const worksheetId = decodeURIComponent(selectionMatch[1]);
      const selection = request.body as Selection;
      current = {
        ...current,
        worksheets: current.worksheets.map((worksheet) =>
          worksheet.id === worksheetId ? { ...worksheet, selection } : worksheet,
        ),
      };
      return { body: { workbook: current } };
    }
    if (rangeMatch && request.method === "POST") {
      if (options.rangeError) return { status: 400, body: { error: options.rangeError } };
      const worksheetId = decodeURIComponent(rangeMatch[1]);
      const target = current.worksheets.find((worksheet) => worksheet.id === worksheetId);
      if (!target) return { status: 404, body: { error: "Worksheet not found" } };
      const body = request.body as { mode: "copy" | "cut"; source: Selection; target: Selection };
      const src = boundsOf(body.source);
      const start = boundsOf(body.target);
      if (!src || !start) return { status: 400, body: { error: "Invalid cell selection" } };
      const height = src.bottom - src.top + 1;
      const width = src.right - src.left + 1;
      const cells = structuredClone(target.cells);
      const original = target.cells;
      const moves: Array<{ from: string; to: string }> = [];
      for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
          moves.push({
            from: coordinateName(src.top + row, src.left + column),
            to: coordinateName(start.top + row, start.left + column),
          });
        }
      }
      if (body.mode === "cut") for (const move of moves) delete cells[move.from];
      for (const move of moves) {
        const cell = original[move.from];
        if (!cell) {
          delete cells[move.to];
          continue;
        }
        const next = { ...cell };
        if (cell.formula) {
          next.formula = translateFormula(cell.formula, start.top - src.top, start.left - src.left);
        }
        cells[move.to] = next;
      }
      const recalculated = recalculate(cells);
      current = {
        ...current,
        updatedAt: "2026-10-03T11:00:00.000Z",
        worksheets: current.worksheets.map((worksheet) =>
          worksheet.id === worksheetId ? { ...worksheet, cells: recalculated } : worksheet,
        ),
      };
      return { body: { workbook: current } };
    }
    if (restoreMatch && request.method === "POST") {
      const worksheetId = decodeURIComponent(restoreMatch[1]);
      const state = request.body as {
        rowCount: number;
        columnCount: number;
        cells: Record<string, CellData>;
        selection: Selection;
        validations?: Worksheet["validations"];
      };
      current = {
        ...current,
        worksheets: current.worksheets.map((worksheet) =>
          worksheet.id === worksheetId
            ? {
                ...worksheet,
                rowCount: state.rowCount,
                columnCount: state.columnCount,
                cells: state.cells,
                selection: state.selection,
                validations: state.validations ?? worksheet.validations,
              }
            : worksheet,
        ),
      };
      return { body: { workbook: current } };
    }
    if (structureMatch && request.method === "POST") {
      const worksheetId = decodeURIComponent(structureMatch[1]);
      const axis = structureMatch[2] as "rows" | "columns";
      const body = request.body as { action: string; index: number };
      current = {
        ...current,
        updatedAt: "2026-10-03T12:00:00.000Z",
        worksheets: current.worksheets.map((worksheet) =>
          worksheet.id === worksheetId ? applyStructure(worksheet, axis, body.action, body.index) : worksheet,
        ),
      };
      return { body: { workbook: current } };
    }
    return { status: 404, body: { error: "Not found" } };
  });
  return { requests, workbook: () => current };
}

/** Stateful in-memory API double mirroring the backend worksheet endpoints. */
function stubWorksheetLifecycle(options: { workbook?: Workbook; deleteError?: string } = {}) {
  let current: Workbook = structuredClone(options.workbook ?? seededWorkbook);
  const requests: StubRequest[] = [];
  installFetchStub((request) => {
    requests.push(request);
    if (request.url === WORKBOOK_URL && request.method === "GET") {
      return { body: { workbook: current } };
    }
    if (request.url === WORKBOOK_URL && request.method === "PATCH") {
      const activeWorksheetId = String((request.body as { activeWorksheetId?: string }).activeWorksheetId ?? "");
      current = { ...current, activeWorksheetId, updatedAt: "2026-10-03T11:00:00.000Z" };
      return { body: { workbook: current } };
    }
    if (request.url === WORKSHEETS_URL && request.method === "POST") {
      const used = new Set(current.worksheets.map((worksheet) => worksheet.name));
      let index = 1;
      while (used.has(`Sheet${index}`)) index += 1;
      const created: Worksheet = {
        id: `ws-created-sheet${index}`,
        name: `Sheet${index}`,
        rowCount: 30,
        columnCount: 26,
        cells: {},
        selection: { anchor: "A1", focus: "A1" },
      };
      current = {
        ...current,
        activeWorksheetId: created.id,
        worksheets: [...current.worksheets, created],
        updatedAt: "2026-10-03T11:00:00.000Z",
      };
      return { status: 201, body: { workbook: current } };
    }
    const renameMatch = WORKSHEET_URL.exec(request.url);
    if (renameMatch && request.method === "PATCH") {
      const targetId = decodeURIComponent(renameMatch[1]);
      const name = String((request.body as { name?: string }).name ?? "").trim();
      if (!name) return { status: 400, body: { error: "Worksheet name cannot be empty" } };
      if (current.worksheets.some((worksheet) => worksheet.id !== targetId && worksheet.name === name)) {
        return { status: 400, body: { error: "Worksheet name already exists" } };
      }
      current = {
        ...current,
        worksheets: current.worksheets.map((worksheet) =>
          worksheet.id === targetId ? { ...worksheet, name } : worksheet,
        ),
        updatedAt: "2026-10-03T11:00:00.000Z",
      };
      return { body: { workbook: current } };
    }
    if (renameMatch && request.method === "DELETE") {
      const targetId = decodeURIComponent(renameMatch[1]);
      if (options.deleteError) return { status: 400, body: { error: options.deleteError } };
      const index = current.worksheets.findIndex((worksheet) => worksheet.id === targetId);
      if (index === -1) return { status: 404, body: { error: "Worksheet not found" } };
      if (current.worksheets.length <= 1) {
        return { status: 400, body: { error: "A workbook must contain at least one worksheet" } };
      }
      const dependent = current.worksheets.some(
        (worksheet) => worksheet.id !== targetId && worksheet.pivot?.sourceWorksheetId === targetId,
      );
      if (dependent) {
        return { status: 400, body: { error: "Please delete or rebuild dependent pivot tables first" } };
      }
      const worksheets = current.worksheets.filter((worksheet) => worksheet.id !== targetId);
      const activeWorksheetId =
        current.activeWorksheetId === targetId
          ? (worksheets[index] ?? worksheets[index - 1]).id
          : current.activeWorksheetId;
      current = { ...current, worksheets, activeWorksheetId, updatedAt: "2026-10-03T11:00:00.000Z" };
      return { body: { workbook: current } };
    }
    return { status: 404, body: { error: "Not found" } };
  });
  return { requests, workbook: () => current };
}

describe("workbook editor", () => {
  afterEach(reset);

  it("restores the seeded workbook when its editor entry is opened directly", async () => {
    stubEditor();
    await openEditor();

    expect(screen.getByText("Last updated: 2026-10-01 08:00")).toBeInTheDocument();

    const tab = screen.getByRole("tab", { name: "Sheet1" });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab").map((node) => node.textContent)).toEqual(["Sheet1", "Sheet2"]);
    expect(screen.getByRole("button", { name: "Add worksheet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Worksheet options for Sheet1" })).toBeInTheDocument();

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(grid).toHaveAttribute("aria-multiselectable", "true");
    // aria-rowcount/colcount include the header row and the row-number column.
    expect(grid).toHaveAttribute("aria-rowcount", "31");
    expect(grid).toHaveAttribute("aria-colcount", "27");
    expect(screen.getByRole("columnheader", { name: "A" })).toHaveTextContent("A");
    expect(screen.getByRole("columnheader", { name: "B" })).toHaveTextContent("B");
    expect(screen.getByRole("rowheader", { name: "1" })).toHaveTextContent("1");
    expect(screen.getByRole("rowheader", { name: "30" })).toHaveTextContent("30");

    const a1 = screen.getByRole("gridcell", { name: "A1" });
    expect(a1).toHaveAttribute("aria-selected", "true");
    expect(a1.textContent).toBe("Region");
    expect(screen.getByRole("gridcell", { name: "B1" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveAttribute("aria-selected", "false");

    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("Region");
  });

  it("restores the same workbook after a refresh of the editor entry", async () => {
    const fetchMock = stubEditor();
    await openEditor();

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Q3 Sales" })).toBeInTheDocument();
    const requested = fetchMock.mock.calls.filter(([input]) => String(input) === WORKBOOK_URL);
    expect(requested).toHaveLength(2);
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(screen.getByText("Last updated: 2026-10-01 08:00")).toBeInTheDocument();
  });

  it("rejects an empty workbook name without saving", async () => {
    const requests: StubRequest[] = [];
    stubEditor((request) => {
      requests.push(request);
      return { status: 500, body: { error: "should not be called" } };
    });
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Rename workbook" }));
    const nameInput = screen.getByRole("textbox", { name: "Workbook name" });
    expect(nameInput).toHaveValue("Q3 Sales");

    await user.clear(nameInput);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Workbook name cannot be empty");
    expect(screen.getByRole("heading", { level: 1, name: "Q3 Sales" })).toBeInTheDocument();
    expect(requests.filter((request) => request.method === "PATCH")).toHaveLength(0);
  });

  it("keeps the saved name in the editor title, the home page link and after refresh", async () => {
    let current: Workbook = seededWorkbook;
    installFetchStub((request) => {
      if (request.url === "/api/workbooks" && request.method === "GET") {
        return { body: { workbooks: [{ id: current.id, name: current.name, updatedAt: current.updatedAt }] } };
      }
      if (request.url === WORKBOOK_URL && request.method === "GET") {
        return { body: { workbook: current } };
      }
      if (request.url === WORKBOOK_URL && request.method === "PATCH") {
        const name = String((request.body as { name?: string }).name ?? "").trim();
        if (!name) return { status: 400, body: { error: "Workbook name cannot be empty" } };
        current = { ...current, name, updatedAt: "2026-10-03T09:15:00.000Z" };
        return { body: { workbook: current } };
      }
      return { status: 404, body: { error: "Not found" } };
    });
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Rename workbook" }));
    const nameInput = screen.getByRole("textbox", { name: "Workbook name" });
    await user.clear(nameInput);
    await user.type(nameInput, "  Q3 Sales 2026  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Q3 Sales 2026" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Last updated: 2026-10-03 09:15")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Home" }));
    const link = await screen.findByRole("link", { name: "Q3 Sales 2026" });
    expect(link).toHaveAttribute("href", "#/workbooks/wb-q3-sales");
    expect(screen.getByText("Last updated: 2026-10-03 09:15")).toBeInTheDocument();

    await user.click(link);
    expect(await screen.findByRole("heading", { level: 1, name: "Q3 Sales 2026" })).toBeInTheDocument();
  });

  it("shows an error beside the field and keeps the original name when saving fails", async () => {
    stubEditor(() => ({ status: 500, body: { error: "Unable to save the workbook name" } }));
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Rename workbook" }));
    const nameInput = screen.getByRole("textbox", { name: "Workbook name" });
    await user.clear(nameInput);
    await user.type(nameInput, "Q3 Sales 2026");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save the workbook name");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })[0]).toHaveTextContent("Q3 Sales");
  });

  it("reports a missing workbook instead of crashing", async () => {    installFetchStub(() => ({ status: 404, body: { error: "Workbook not found" } }));
    window.location.hash = "#/workbooks/wb-missing";
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Workbook not found");
  });

  it("downloads the active worksheet as CSV without changing the visible state", async () => {
    const anchors: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function capture(this: HTMLAnchorElement) {
      anchors.push(this);
    });
    stubEditor();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute("href")).toBe(
      "/api/workbooks/wb-q3-sales/export.csv?worksheetId=ws-q3-sales-sheet1",
    );
    expect(anchors[0].getAttribute("download")).toBe("Q3 Sales - Sheet1.csv");
    expect(anchors[0].isConnected).toBe(false);

    expect(screen.getByRole("tab", { name: "Sheet1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("Region");
    expect(screen.getByText("Last updated: 2026-10-01 08:00")).toBeInTheDocument();
  });

  it("exports the worksheet that is currently active", async () => {
    const anchors: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function capture(this: HTMLAnchorElement) {
      anchors.push(this);
    });
    installFetchStub((request) => {
      if (request.url === WORKBOOK_URL && request.method === "GET") {
        return { body: { workbook: twoSheetWorkbook } };
      }
      if (request.url === WORKBOOK_URL && request.method === "PATCH") {
        return { body: { workbook: { ...twoSheetWorkbook, activeWorksheetId: "ws-q3-sales-sheet2" } } };
      }
      return { status: 404, body: { error: "Not found" } };
    });
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(await screen.findByRole("gridcell", { name: "A1" })).toHaveTextContent("Gross");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute("href")).toBe(
      "/api/workbooks/wb-q3-sales/export.csv?worksheetId=ws-q3-sales-sheet2",
    );
    expect(anchors[0].getAttribute("download")).toBe("Q3 Sales - Sheet2.csv");
    expect(screen.getByRole("tab", { name: "Sheet2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("Gross");
  });

  it("renames a worksheet from the tab menu, trims spaces and persists the new name", async () => {
    const stub = stubWorksheetLifecycle();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));

    expect(await screen.findByRole("dialog", { name: "Rename worksheet" })).toBeInTheDocument();
    const nameInput = screen.getByRole("textbox", { name: "Worksheet name" });
    expect(nameInput).toHaveValue("Sheet1");

    await user.clear(nameInput);
    await user.type(nameInput, "  Summary  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("tab", { name: "Summary" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Worksheet options for Summary" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
    const renameRequest = stub.requests.find((request) => request.method === "PATCH");
    expect(renameRequest?.body).toEqual({ name: "Summary" });

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("tab", { name: "Summary" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Sheet1" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "A3" })).toHaveTextContent("North");
  });

  it("rejects an empty worksheet name without saving and keeps the original tab", async () => {
    const stub = stubWorksheetLifecycle();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const nameInput = await screen.findByRole("textbox", { name: "Worksheet name" });
    await user.clear(nameInput);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Worksheet name cannot be empty");
    expect(screen.getByRole("dialog", { name: "Rename worksheet" })).toBeInTheDocument();
    expect(stub.requests.filter((request) => request.method === "PATCH")).toHaveLength(0);
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeInTheDocument();
  });

  it("shows a duplicate worksheet name error beside the field and keeps both tab names", async () => {    const stub = stubWorksheetLifecycle();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet2" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const nameInput = await screen.findByRole("textbox", { name: "Worksheet name" });
    expect(nameInput).toHaveValue("Sheet2");
    await user.clear(nameInput);
    await user.type(nameInput, "Sheet1");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Worksheet name already exists");
    expect(screen.getByRole("dialog", { name: "Rename worksheet" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Worksheet name" })).toHaveValue("Sheet1");
    expect(stub.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getAllByRole("tab").map((node) => node.textContent)).toEqual(["Sheet1", "Sheet2"]);
    expect(screen.getByRole("tab", { name: "Sheet1" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the original tab name when renaming a worksheet fails", async () => {
    installFetchStub((request) => {
      if (request.url === WORKBOOK_URL && request.method === "GET") {
        return { body: { workbook: seededWorkbook } };
      }
      if (WORKSHEET_URL.test(request.url) && request.method === "PATCH") {
        return { status: 500, body: { error: "Unable to rename the worksheet." } };
      }
      return { status: 404, body: { error: "Not found" } };
    });
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet2" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const nameInput = await screen.findByRole("textbox", { name: "Worksheet name" });
    await user.clear(nameInput);
    await user.type(nameInput, "Q3 Detail");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to rename the worksheet.");
    expect(screen.getByRole("dialog", { name: "Rename worksheet" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getAllByRole("tab").map((node) => node.textContent)).toEqual(["Sheet1", "Sheet2"]);
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
  });

  it("adds a blank worksheet, makes it active and keeps the existing worksheets", async () => {
    const stub = stubWorksheetLifecycle();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    expect(await screen.findByRole("tab", { name: "Sheet3" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab").map((node) => node.textContent)).toEqual(["Sheet1", "Sheet2", "Sheet3"]);
    expect(screen.getByRole("button", { name: "Add worksheet" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("");

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("tab", { name: "Sheet3" })).toHaveAttribute("aria-selected", "true");
    // The seeded worksheet keeps its rows, untouched by the new blank worksheet.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(await screen.findByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
    expect(screen.getByRole("gridcell", { name: "A3" })).toHaveTextContent("North");
    expect(stub.requests.filter((request) => request.method === "POST")).toHaveLength(1);
  });

  it("inserts a row below the target row from the row-number menu and persists it", async () => {
    let current: Workbook = structuredClone(seededWorkbook);
    const requests: StubRequest[] = [];
    installFetchStub((request) => {
      requests.push(request);
      if (request.url === WORKBOOK_URL && request.method === "GET") {
        return { body: { workbook: current } };
      }
      if (request.url === WORKBOOK_URL && request.method === "PATCH") {
        const activeWorksheetId = String((request.body as { activeWorksheetId?: string }).activeWorksheetId ?? "");
        current = { ...current, activeWorksheetId };
        return { body: { workbook: current } };
      }
      if (request.url === STRUCTURE_ROWS_URL && request.method === "POST") {
        current = { ...withSheet1(current, sheet1WithInsertedRow), updatedAt: "2026-10-03T12:00:00.000Z" };
        return { body: { workbook: current } };
      }
      return { status: 404, body: { error: "Not found" } };
    });
    const user = userEvent.setup();
    await openEditor();

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "2" }));
    expect(screen.getAllByRole("menuitem").map((node) => node.textContent)).toEqual([
      "Insert 1 row above",
      "Insert 1 row below",
      "Delete row",
    ]);
    await user.click(screen.getByRole("menuitem", { name: "Insert 1 row below" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A4" })).toHaveTextContent("North"));
    expect(screen.getByRole("gridcell", { name: "B4" })).toHaveTextContent("800");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
    expect(screen.getByRole("rowheader", { name: "31" })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("Region");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveAttribute("aria-selected", "true");
    const structureRequest = requests.find((request) => request.url === STRUCTURE_ROWS_URL);
    expect(structureRequest?.method).toBe("POST");
    expect(structureRequest?.body).toEqual({ action: "insert-below", index: 1 });

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "A4" })).toHaveTextContent("North");
    expect(screen.getByRole("rowheader", { name: "31" })).toBeInTheDocument();

    // The other worksheet keeps its own row structure and blank cells.
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe(""));
    expect(screen.getByRole("rowheader", { name: "30" })).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", { name: "31" })).toBeNull();
  });

  it("inserts a column left of the target column from the column-header menu and persists it", async () => {
    let current: Workbook = structuredClone(seededWorkbook);
    const requests: StubRequest[] = [];
    installFetchStub((request) => {
      requests.push(request);
      if (request.url === WORKBOOK_URL && request.method === "GET") {
        return { body: { workbook: current } };
      }
      if (request.url === STRUCTURE_COLUMNS_URL && request.method === "POST") {
        current = withSheet1(current, sheet1WithInsertedColumn);
        return { body: { workbook: current } };
      }
      return { status: 404, body: { error: "Not found" } };
    });
    const user = userEvent.setup();
    await openEditor();

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "B" }));
    expect(screen.getAllByRole("menuitem").map((node) => node.textContent)).toEqual([
      "Insert 1 column left",
      "Insert 1 column right",
      "Delete column",
    ]);
    await user.click(screen.getByRole("menuitem", { name: "Insert 1 column left" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("Sales"));
    expect(screen.getByRole("gridcell", { name: "B1" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
    expect(screen.getByRole("gridcell", { name: "C3" })).toHaveTextContent("800");
    expect(screen.getByRole("columnheader", { name: "AA" })).toBeInTheDocument();
    const structureRequest = requests.find((request) => request.url === STRUCTURE_COLUMNS_URL);
    expect(structureRequest?.body).toEqual({ action: "insert-left", index: 1 });

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "C2" })).toHaveTextContent("1200");
    expect(screen.getByRole("columnheader", { name: "AA" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeInTheDocument();
  });

  it("shows an error and keeps the pre-operation structure when a row change fails", async () => {
    installFetchStub((request) => {
      if (request.url === WORKBOOK_URL && request.method === "GET") {
        return { body: { workbook: seededWorkbook } };
      }
      if (request.url === STRUCTURE_ROWS_URL && request.method === "POST") {
        return { status: 500, body: { error: "Unable to update the row or column structure" } };
      }
      return { status: 404, body: { error: "Not found" } };
    });
    const user = userEvent.setup();
    await openEditor();

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "3" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete row" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to update the row or column structure");
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
    expect(screen.getByRole("gridcell", { name: "A3" })).toHaveTextContent("North");
    expect(screen.getByRole("rowheader", { name: "30" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "A4" })).toHaveTextContent("South");
    expect(screen.getByRole("gridcell", { name: "A5" }).textContent).toBe("");

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "A3" })).toHaveTextContent("North");
    expect(screen.getByRole("rowheader", { name: "30" })).toBeInTheDocument();
  });

  it("shows an error and keeps the previous worksheets when adding a worksheet fails", async () => {
    installFetchStub((request) => {
      if (request.url === WORKBOOK_URL && request.method === "GET") {
        return { body: { workbook: seededWorkbook } };
      }
      if (request.url === WORKSHEETS_URL && request.method === "POST") {
        return { status: 500, body: { error: "Unable to add the worksheet." } };
      }
      return { status: 404, body: { error: "Not found" } };
    });
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to add the worksheet.");
    expect(screen.getAllByRole("tab").map((node) => node.textContent)).toEqual(["Sheet1", "Sheet2"]);
    expect(screen.getByRole("tab", { name: "Sheet1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
    expect(screen.getByRole("button", { name: "Add worksheet" })).toBeEnabled();
  });

  it("edits the selected cell through the formula bar and keeps it after refresh", async () => {
    const stub = stubCellEditing();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    const bar = screen.getByRole("textbox", { name: "Formula bar" });
    expect(bar).toHaveValue("");
    await user.type(bar, "East");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("East"));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("East");
    const selectionWrite = stub.requests.find((request) => request.url === SELECTION_URL);
    expect(selectionWrite?.body).toEqual({ anchor: "D1", focus: "D1" });
    const cellWrite = stub.requests.find((request) => request.url === CELLS_URL);
    expect(cellWrite?.body).toEqual({ updates: [{ name: "D1", input: "East" }] });

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "D1" })).toHaveTextContent("East");
    expect(screen.getByRole("gridcell", { name: "D1" })).toHaveAttribute("aria-selected", "true");
  });

  it("cancels an uncommitted change with Escape", async () => {
    const stub = stubCellEditing();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    const bar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.type(bar, "North");
    expect(bar).toHaveValue("North");

    await user.keyboard("{Escape}");

    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("");
    expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("");
    expect(stub.requests.filter((request) => request.url === CELLS_URL)).toHaveLength(0);
  });

  it("edits a cell through the inline grid text box named after the cell", async () => {
    stubCellEditing();
    const user = userEvent.setup();
    await openEditor();

    await user.dblClick(screen.getByRole("gridcell", { name: "E1" }));
    const inline = await screen.findByRole("textbox", { name: "Edit E1" });
    expect(inline).toHaveValue("");
    await user.type(inline, "1200");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E1" })).toHaveTextContent("1200"));
    expect(screen.queryByRole("textbox", { name: "Edit E1" })).toBeNull();
    await user.click(screen.getByRole("gridcell", { name: "E1" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("1200");

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "E1" })).toHaveTextContent("1200");
  });

  it("commits the change when another cell is clicked", async () => {
    stubCellEditing();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    await user.type(screen.getByRole("textbox", { name: "Formula bar" }), "East");
    await user.click(screen.getByRole("gridcell", { name: "E1" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("East"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E1" })).toHaveAttribute("aria-selected", "true"));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue(""));
  });

  it("shows the calculated result in the grid and the original formula in the formula bar", async () => {
    const stub = stubCellEditing();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("gridcell", { name: "E1" }));
    await user.type(screen.getByRole("textbox", { name: "Formula bar" }), "1200");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E1" })).toHaveTextContent("1200"));

    await user.click(screen.getByRole("gridcell", { name: "F1" }));
    await user.type(screen.getByRole("textbox", { name: "Formula bar" }), "=E1*2");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "F1" })).toHaveTextContent("2400"));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("=E1*2");

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "F1" })).toHaveTextContent("2400");
    await user.click(screen.getByRole("gridcell", { name: "F1" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("=E1*2");
    expect(stub.requests.filter((request) => request.url === CELLS_URL)).toHaveLength(2);
  });

  it("enters a formula and an aggregate through the formula bar and recalculates dependents after an edit", async () => {
    const stub = stubCellEditing();
    const user = userEvent.setup();
    await openEditor();

    const bar = () => screen.getByRole("textbox", { name: "Formula bar" });
    async function enter(cell: string, text: string) {
      await user.click(screen.getByRole("gridcell", { name: cell }));
      await user.clear(bar());
      await user.type(bar(), text);
      await user.keyboard("{Enter}");
    }

    await enter("A1", "1");
    await enter("A2", "2");
    await enter("B1", "=SUM(A1:A2)");
    await enter("C1", "=B1*2");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B1" })).toHaveTextContent("3"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("6"));
    await user.click(screen.getByRole("gridcell", { name: "B1" }));
    expect(bar()).toHaveValue("=SUM(A1:A2)");

    // Editing the underlying source recalculates the aggregate and its dependent.
    await enter("A2", "5");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B1" })).toHaveTextContent("6"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("12"));

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "B1" })).toHaveTextContent("6");
    await user.click(screen.getByRole("gridcell", { name: "B1" }));
    expect(bar()).toHaveValue("=SUM(A1:A2)");
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    expect(bar()).toHaveValue("=B1*2");
    expect(stub.requests.filter((request) => request.url === CELLS_URL).length).toBeGreaterThanOrEqual(5);
  });

  it("shows a stable formula error in the grid and the original formula in the formula bar", async () => {
    stubCellEditing();
    const user = userEvent.setup();
    await openEditor();

    const bar = () => screen.getByRole("textbox", { name: "Formula bar" });
    await user.click(screen.getByRole("gridcell", { name: "E1" }));
    await user.type(bar(), "=1/0");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E1" })).toHaveTextContent("#DIV/0!"));
    expect(bar()).toHaveValue("=1/0");
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "E1" })).toHaveTextContent("#DIV/0!");
    await user.click(screen.getByRole("gridcell", { name: "E1" }));
    expect(bar()).toHaveValue("=1/0");
  });

  it("fixes an error formula to a valid one and recalculates its dependent", async () => {
    stubCellEditing();
    const user = userEvent.setup();
    await openEditor();

    const bar = () => screen.getByRole("textbox", { name: "Formula bar" });
    async function enter(cell: string, text: string) {
      await user.click(screen.getByRole("gridcell", { name: cell }));
      await user.clear(bar());
      await user.type(bar(), text);
      await user.keyboard("{Enter}");
    }

    await enter("A1", "2");
    await enter("B1", "=A1/0");
    await enter("C1", "=B1+1");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B1" })).toHaveTextContent("#DIV/0!"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("#DIV/0!"));

    await enter("B1", "=A1*10");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B1" })).toHaveTextContent("20"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("21"));
    expect(bar()).toHaveValue("=A1*10");

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "B1" })).toHaveTextContent("20");
    expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("21");
  });

  it("copies a formula whose offset leaves the worksheet and shows =#REF! while the source stays", async () => {
    stubCellEditing();
    const user = userEvent.setup();
    await openEditor();

    const bar = () => screen.getByRole("textbox", { name: "Formula bar" });
    async function enter(cell: string, text: string) {
      await user.click(screen.getByRole("gridcell", { name: cell }));
      await user.clear(bar());
      await user.type(bar(), text);
      await user.keyboard("{Enter}");
    }

    await enter("A1", "2");
    await enter("B1", "3");
    await enter("D1", "=A1+B1");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("5"));

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    await user.click(screen.getByRole("button", { name: "Paste" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("#REF!"));
    expect(bar()).toHaveValue("=#REF!");
    expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("5");

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "C1" })).toHaveTextContent("#REF!");
    expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("5");
  });

  it("keeps the last successful content and shows an error when a commit fails", async () => {
    stubCellEditing({ cellsError: "Please enter a number from 0 to 100" });
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("gridcell", { name: "E2" }));
    await user.type(screen.getByRole("textbox", { name: "Formula bar" }), "101");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Please enter a number from 0 to 100");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("");
    expect(screen.getByRole("gridcell", { name: "E2" })).toHaveTextContent("");
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
    expect(screen.getByRole("gridcell", { name: "B3" })).toHaveTextContent("800");
  });

  it("pastes a two-dimensional table from the grid context menu", async () => {
    const stub = stubCellEditing();
    const user = userEvent.setup();
    // Defined after `setup()` so the stub survives the user-event clipboard installation.
    const readText = vi.fn(async () => "East\t1200\nNorth\t800");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText } });
    await openEditor();

    fireEvent.contextMenu(screen.getByRole("gridcell", { name: "D1" }));
    expect(screen.getByRole("menu")).toHaveAccessibleName("Cell D1 menu");
    await user.click(screen.getByRole("menuitem", { name: "Paste" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("East"));
    expect(screen.getByRole("gridcell", { name: "E1" })).toHaveTextContent("1200");
    expect(screen.getByRole("gridcell", { name: "D2" })).toHaveTextContent("North");
    expect(screen.getByRole("gridcell", { name: "E2" })).toHaveTextContent("800");
    expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("Status");
    expect(screen.getByRole("gridcell", { name: "D3" }).textContent).toBe("");
    const paste = stub.requests.find((request) => request.url === CELLS_URL);
    expect(paste?.body).toEqual({
      updates: [
        { name: "D1", input: "East" },
        { name: "E1", input: "1200" },
        { name: "D2", input: "North" },
        { name: "E2", input: "800" },
      ],
    });

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "E2" })).toHaveTextContent("800");
  });

  it("pastes the external clipboard with Ctrl+V", async () => {
    stubCellEditing();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("gridcell", { name: "B2" }));
    fireEvent.paste(screen.getByRole("gridcell", { name: "B2" }), {
      clipboardData: { getData: () => "East\t1200\nNorth\t800" },
    });

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B2" })).toHaveTextContent("East"));
    expect(screen.getByRole("gridcell", { name: "C2" })).toHaveTextContent("1200");
    expect(screen.getByRole("gridcell", { name: "B3" })).toHaveTextContent("North");
    expect(screen.getByRole("gridcell", { name: "C3" })).toHaveTextContent("800");
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
  });

  it("rejects the whole paste and keeps every target when the write fails", async () => {
    stubCellEditing({ cellsError: "Please enter a number from 0 to 100" });
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    fireEvent.paste(screen.getByRole("gridcell", { name: "D1" }), {
      clipboardData: { getData: () => "East\t1200\nNorth\t800" },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Please enter a number from 0 to 100");
    for (const name of ["D1", "E1", "D2", "E2"]) {
      expect(screen.getByRole("gridcell", { name }).textContent).toBe("");
    }
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
  });

  it("keeps the selected rectangle after refresh and leaves other worksheets untouched", async () => {
    stubCellEditing();
    const user = userEvent.setup();
    await openEditor();

    fireEvent.mouseDown(screen.getByRole("gridcell", { name: "D1" }));
    fireEvent.mouseEnter(screen.getByRole("gridcell", { name: "E2" }));
    fireEvent.mouseUp(window);

    for (const name of ["D1", "E1", "D2", "E2"]) {
      expect(screen.getByRole("gridcell", { name })).toHaveAttribute("aria-selected", "true");
    }
    expect(screen.getByRole("gridcell", { name: "C1" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("gridcell", { name: "E3" })).toHaveAttribute("aria-selected", "false");

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "D1" })).toHaveAttribute("aria-selected", "true");
    for (const name of ["D1", "E1", "D2", "E2"]) {
      expect(screen.getByRole("gridcell", { name })).toHaveAttribute("aria-selected", "true");
    }
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveAttribute("aria-selected", "false");

    // Another worksheet keeps its own selection and does not overwrite the rectangle.
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(await screen.findByRole("gridcell", { name: "A1" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(await screen.findByRole("gridcell", { name: "D1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "E2" })).toHaveAttribute("aria-selected", "true");
  });

  it("copies a selected rectangle to a target location and keeps both after refresh", async () => {
    const stub = stubCellEditing();
    const user = userEvent.setup();
    await openEditor();

    fireEvent.mouseDown(screen.getByRole("gridcell", { name: "A1" }));
    fireEvent.mouseEnter(screen.getByRole("gridcell", { name: "B2" }));
    fireEvent.mouseUp(window);
    await user.click(screen.getByRole("button", { name: "Copy" }));

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    await user.click(screen.getByRole("button", { name: "Paste" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("Region"));
    expect(screen.getByRole("gridcell", { name: "E1" })).toHaveTextContent("Sales");
    expect(screen.getByRole("gridcell", { name: "D2" })).toHaveTextContent("East");
    expect(screen.getByRole("gridcell", { name: "E2" })).toHaveTextContent("1200");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
    expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("Status");
    const transfer = stub.requests.find((request) => request.url === RANGE_URL);
    expect(transfer?.body).toEqual({
      mode: "copy",
      source: { anchor: "A1", focus: "B2" },
      target: { anchor: "D1", focus: "D1" },
    });

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "E2" })).toHaveTextContent("1200");
  });

  it("cuts a rectangle: the source clears only once the target is pasted", async () => {
    const stub = stubCellEditing();
    const user = userEvent.setup();
    await openEditor();

    fireEvent.mouseDown(screen.getByRole("gridcell", { name: "A1" }));
    fireEvent.mouseEnter(screen.getByRole("gridcell", { name: "B2" }));
    fireEvent.mouseUp(window);
    await user.click(screen.getByRole("button", { name: "Cut" }));
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    await user.click(screen.getByRole("button", { name: "Paste" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("Region"));
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "E2" })).toHaveTextContent("1200");
    expect(screen.getByRole("gridcell", { name: "A3" })).toHaveTextContent("North");
    expect(stub.requests.find((request) => request.url === RANGE_URL)?.body).toMatchObject({ mode: "cut" });
  });

  it("rejects the whole range paste and shows the validation error", async () => {
    stubCellEditing({ rangeError: "Please enter a number from 0 to 100" });
    const user = userEvent.setup();
    await openEditor();

    fireEvent.mouseDown(screen.getByRole("gridcell", { name: "A1" }));
    fireEvent.mouseEnter(screen.getByRole("gridcell", { name: "B2" }));
    fireEvent.mouseUp(window);
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    await user.click(screen.getByRole("button", { name: "Paste" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Please enter a number from 0 to 100");
    for (const name of ["D1", "E1", "D2", "E2"]) {
      expect(screen.getByRole("gridcell", { name }).textContent).toBe("");
    }
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
  });

  it("undoes and redoes a committed cell edit and keeps the result after refresh", async () => {
    stubCellEditing();
    const user = userEvent.setup();
    await openEditor();

    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    await user.type(screen.getByRole("textbox", { name: "Formula bar" }), "East");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("East"));

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe(""));
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("East"));

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "D1" })).toHaveTextContent("East");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("disables Redo after a new modification made following an undo", async () => {
    stubCellEditing();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    await user.type(screen.getByRole("textbox", { name: "Formula bar" }), "East");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("East"));

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled());

    await user.click(screen.getByRole("gridcell", { name: "E1" }));
    await user.type(screen.getByRole("textbox", { name: "Formula bar" }), "North");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E1" })).toHaveTextContent("North"));

    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E1" })).toHaveTextContent("North"));
    expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("");
  });

  it("undoes with Ctrl+Z and redoes with Ctrl+Y", async () => {
    stubCellEditing();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    await user.type(screen.getByRole("textbox", { name: "Formula bar" }), "East");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("East"));

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe(""));
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("East"));
  });

  it("undoes a row insertion and redoes it, restoring the row structure", async () => {
    stubCellEditing();
    const user = userEvent.setup();
    await openEditor();

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "2" }));
    await user.click(screen.getByRole("menuitem", { name: "Insert 1 row below" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A4" })).toHaveTextContent("North"));
    expect(screen.getByRole("rowheader", { name: "31" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A3" })).toHaveTextContent("North"));
    expect(screen.getByRole("gridcell", { name: "A4" })).toHaveTextContent("South");
    expect(screen.queryByRole("rowheader", { name: "31" })).toBeNull();
    expect(screen.getByRole("rowheader", { name: "30" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A4" })).toHaveTextContent("North"));
    expect(screen.getByRole("rowheader", { name: "31" })).toBeInTheDocument();

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "A4" })).toHaveTextContent("North");
  });

  it("switches worksheets so the grid, selection and formula bar follow the active tab", async () => {
    let current: Workbook = structuredClone(twoSheetWorkbook);
    const requests: StubRequest[] = [];
    installFetchStub((request) => {
      requests.push(request);
      if (request.url === WORKBOOK_URL && request.method === "GET") {
        return { body: { workbook: current } };
      }
      if (request.url === WORKBOOK_URL && request.method === "PATCH") {
        const activeWorksheetId = String((request.body as { activeWorksheetId?: string }).activeWorksheetId ?? "");
        current = { ...current, activeWorksheetId, updatedAt: "2026-10-03T11:00:00.000Z" };
        return { body: { workbook: current } };
      }
      return { status: 404, body: { error: "Not found" } };
    });
    const user = userEvent.setup();
    await openEditor();

    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("Region");

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(await screen.findByRole("gridcell", { name: "A1" })).toHaveTextContent("Gross");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("Gross");
    expect(screen.getByRole("tab", { name: "Sheet2" })).toHaveAttribute("aria-selected", "true");
    // The switch is persisted so a refresh reopens the same active tab.
    const switchRequest = requests.find((request) => request.method === "PATCH");
    expect(switchRequest?.body).toEqual({ activeWorksheetId: "ws-q3-sales-sheet2" });

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("tab", { name: "Sheet2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Gross");

    // The source worksheet was not modified by switching away and back.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(await screen.findByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
    expect(screen.getByRole("gridcell", { name: "A3" })).toHaveTextContent("North");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("Region");
  });

  it("deletes a worksheet from the tab menu after confirming and activates an adjacent tab", async () => {
    const stub = stubWorksheetLifecycle();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet2" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
    expect(dialog).toHaveTextContent("Sheet2");
    await user.click(screen.getByRole("button", { name: "Delete worksheet" }));

    await waitFor(() => expect(screen.queryByRole("tab", { name: "Sheet2" })).toBeNull());
    expect(screen.getAllByRole("tab").map((node) => node.textContent)).toEqual(["Sheet1"]);
    expect(screen.getByRole("tab", { name: "Sheet1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
    expect(screen.queryByRole("dialog")).toBeNull();
    const deleteRequest = stub.requests.find((request) => request.method === "DELETE");
    expect(deleteRequest?.url).toBe("/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet2");

    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    expect(await screen.findByRole("tab", { name: "Sheet1" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Sheet2" })).toBeNull();
  });

  it("deletes the active worksheet and shows the remaining grid", async () => {
    stubWorksheetLifecycle();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await screen.findByRole("dialog", { name: "Delete worksheet" });
    await user.click(screen.getByRole("button", { name: "Delete worksheet" }));

    await waitFor(() => expect(screen.queryByRole("tab", { name: "Sheet1" })).toBeNull());
    expect(screen.getByRole("tab", { name: "Sheet2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("");
  });

  it("rejects deleting a pivot source worksheet and keeps both worksheets", async () => {
    stubWorksheetLifecycle({
      workbook: {
        ...seededWorkbook,
        worksheets: [
          seededWorkbook.worksheets[0],
          {
            ...seededWorkbook.worksheets[1],
            cells: { A1: { value: "Region" }, B1: { value: "SUM of Sales" } },
            pivot: {
              sourceWorksheetId: "ws-q3-sales-sheet1",
              sourceRange: "A1:C4",
              rowField: "Region",
              columnField: null,
              valueField: "Sales",
              summarizeBy: "SUM",
            },
          },
        ],
      },
    });
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await screen.findByRole("dialog", { name: "Delete worksheet" });
    await user.click(screen.getByRole("button", { name: "Delete worksheet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please delete or rebuild dependent pivot tables first",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("tab").map((node) => node.textContent)).toEqual(["Sheet1", "Sheet2"]);
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
    expect(screen.getByRole("gridcell", { name: "B2" })).toHaveTextContent("1200");
  });

  it("shows an error and keeps the worksheet when a deletion fails", async () => {
    stubWorksheetLifecycle({ deleteError: "Unable to delete the worksheet." });
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet2" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await screen.findByRole("dialog", { name: "Delete worksheet" });
    await user.click(screen.getByRole("button", { name: "Delete worksheet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to delete the worksheet.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("tab").map((node) => node.textContent)).toEqual(["Sheet1", "Sheet2"]);
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
  });

  it("reports the last-worksheet error without opening a confirmation dialog", async () => {
    stubWorksheetLifecycle({
      workbook: { ...seededWorkbook, worksheets: [seededWorkbook.worksheets[0]] },
    });
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A workbook must contain at least one worksheet",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
  });
});
