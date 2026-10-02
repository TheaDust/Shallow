/**
 * In-memory stand-in for the workbook API used by the frontend tests.
 *
 * It answers the same routes as `backend/src/api.mjs` for the flows under test: workbook
 * list/open, cell commits, bulk paste, range transfer, worksheet state restore (undo/redo),
 * worksheet patches and worksheet creation. Values are recalculated on every response the
 * way `serializeWorkbook` does, so the grid always shows server-derived results.
 */

import { vi } from "vitest";

import { filterRangeBounds, hiddenRowsOf } from "../domain/filter";
import { compareSortKeys, sortRangeBounds } from "../domain/sort";
import { computePivotCells } from "../domain/pivot";
import { allowedValuesFromText, validationMessageFor } from "../domain/validation";
import type { PivotConfig, PivotMethod, WorkbookState, WorksheetState } from "../domain/workbook";

export const SEED_UPDATED_AT = "2026-03-14T09:32:00.000Z";
export const UPDATED_AT = "2026-04-01T10:00:00.000Z";
export const WORKBOOK_ID = "wb-q3-sales";
export const SHEET1 = "wb-q3-sales-sheet-1";
export const SHEET2 = "wb-q3-sales-sheet-2";
export const OTHER_WORKBOOK_ID = "wb-other";
export const OTHER_SHEET_ID = "wb-other-sheet-1";

export function seedWorkbook(): WorkbookState {
  return {
    id: WORKBOOK_ID,
    name: "Q3 Sales",
    createdAt: SEED_UPDATED_AT,
    updatedAt: SEED_UPDATED_AT,
    activeSheetId: SHEET1,
    sheets: [
      {
        id: SHEET1,
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
        values: {
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
        hiddenRows: [],
      },
      // Mirror of `backend/src/domain/workbooks.mjs#createSeedState`: the workbook seed is
      // `Sheet1` (Region rows) and the formula sample on `Sheet2`.
      {
        id: SHEET2,
        name: "Sheet2",
        cells: { A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2" },
        values: { A1: "2", B1: "3", C1: "5", D1: "10" },
      },
    ],
  };
}

export function otherWorkbook(): WorkbookState {
  return {
    id: OTHER_WORKBOOK_ID,
    name: "Other book",
    createdAt: SEED_UPDATED_AT,
    updatedAt: SEED_UPDATED_AT,
    activeSheetId: OTHER_SHEET_ID,
    sheets: [{ id: OTHER_SHEET_ID, name: "Sheet1", cells: { A1: "Other" }, values: { A1: "Other" } }],
  };
}

/**
 * Minimal evaluator of the test double: text stays text, formulas resolve references (including
 * references to other formula cells), `+ - * /` work on cell references and number literals, and
 * division by zero yields the stable `#DIV/0!`. The authoritative engine is
 * `backend/src/domain/formula.mjs` and is exercised by the backend suite; this double only has to
 * answer the editor flows under test, so aggregates and error codes stay out of scope here.
 */
export function recalculated(cells: Record<string, string>): Record<string, string> {
  const CELL = /^[A-Z]+\d+$/;
  const NUMBER = /^\d+(?:\.\d+)?$/;
  const TERM = "([A-Z]+\\d+|\\d+(?:\\.\\d+)?)";
  const BINARY = new RegExp(`^${TERM}([+\\-*/])${TERM}$`);
  const values: Record<string, string> = {};
  const memo = new Map<string, string>();
  const visiting = new Set<string>();

  const evaluate = (body: string): string => {
    const cleaned = body.replace(/\$/g, "");
    // A formula whose reference left the grid carries the literal `#REF!`; like the server
    // engine, the error propagates through the rest of the expression.
    const literal = /#(REF!|DIV\/0!|NAME\?|ERROR!)/.exec(cleaned);
    if (literal) return `#${literal[1]}`;
    const pair = BINARY.exec(cleaned);
    if (pair) {
      const left = operand(pair[1]);
      const right = operand(pair[3]);
      if (left === null || right === null) return "#ERROR!";
      if (pair[2] === "+") return String(left + right);
      if (pair[2] === "-") return String(left - right);
      if (pair[2] === "*") return String(left * right);
      return right === 0 ? "#DIV/0!" : String(left / right);
    }
    if (CELL.test(cleaned)) return read(cleaned);
    if (NUMBER.test(cleaned)) return String(Number(cleaned));
    return "#ERROR!";
  };

  /** A blank operand counts as zero, a text operand cannot be used in arithmetic. */
  const operand = (token: string): number | null => {
    const raw = NUMBER.test(token) ? token : read(token);
    if (raw.trim() === "") return 0;
    return Number.isNaN(Number(raw)) ? null : Number(raw);
  };

  function read(address: string): string {
    // An A1-shaped token with an impossible row (`A0`) is an invalid reference, like the
    // server engine's out-of-grid handling.
    const position = /^([A-Z]+)(\d+)$/.exec(address);
    if (!position || Number(position[2]) < 1) return "#REF!";
    if (memo.has(address)) return memo.get(address) as string;
    const raw = cells[address] ?? "";
    if (raw === "" || !raw.startsWith("=")) return raw;
    if (visiting.has(address)) return "#REF!";
    visiting.add(address);
    const result = evaluate(raw.slice(1));
    visiting.delete(address);
    memo.set(address, result);
    return result;
  }

  for (const [address, raw] of Object.entries(cells)) {
    if (raw === "") continue;
    values[address] = raw.startsWith("=") ? read(address) : raw;
  }
  return values;
}

/** Same reference translation as `backend/src/domain/reference.mjs`, for copied formulas. */
export function translateFormula(text: string, rowDelta: number, columnDelta: number): string {
  if (!text.startsWith("=")) return text;
  return text.replace(/(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g, (whole, colMark, letters, rowMark, digits) => {
    const column = columnNumber(letters);
    const nextColumn = colMark === "$" ? column : column + columnDelta;
    const nextRow = rowMark === "$" ? Number(digits) : Number(digits) + rowDelta;
    if (nextColumn < 1 || nextRow < 1 || nextColumn > 26 || nextRow > 50) return "#REF!";
    return `${colMark}${columnLabel(nextColumn - 1)}${rowMark}${nextRow}`;
  });
}

export interface StructureChange {
  axis: "row" | "column";
  action: string;
  /** 1-based row number or column index the menu command was opened on. */
  index: number;
}

/**
 * Same structure-aware reference rewriting as `backend/src/domain/reference.mjs`:
 * inserting a row/column moves every reference at or beyond the insertion point (the `$` parts
 * too), deleting one turns its references into `#REF!` and pulls the following ones back.
 */
export function adjustFormulaForStructure(text: string, change: StructureChange): string {
  if (!text.startsWith("=")) return text;
  const deleting = change.action === "delete";
  const insertAbove = change.axis === "row" ? "insert-above" : "insert-left";
  const insertion = change.action === insertAbove ? change.index : change.index + 1;
  return text.replace(/(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g, (whole, colMark, letters, rowMark, digits) => {
    const column = columnNumber(letters);
    const row = Number(digits);
    if (change.axis === "row") {
      if (deleting && row === change.index) return "#REF!";
      const next = deleting ? (row > change.index ? row - 1 : row) : row >= insertion ? row + 1 : row;
      return `${colMark}${letters}${rowMark}${next}`;
    }
    if (deleting && column === change.index) return "#REF!";
    const next = deleting
      ? column > change.index
        ? column - 1
        : column
      : column >= insertion
        ? column + 1
        : column;
    return `${colMark}${columnLabel(next - 1)}${rowMark}${row}`;
  });
}

interface Rectangle {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function parsePosition(address: string): { row: number; column: number } | null {
  const match = /^([A-Za-z]+)([1-9]\d*)$/.exec(address.trim());
  if (!match) return null;
  let column = 0;
  for (const letter of match[1].toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64);
  return { row: Number(match[2]) - 1, column: column - 1 };
}

function columnLabel(column: number): string {
  let label = "";
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
  }
  return label;
}

/** 1-based column number of A1 letters, the inverse of `columnLabel(column - 1)`. */
function columnNumber(letters: string): number {
  return letters
    .toUpperCase()
    .split("")
    .reduce((total, letter) => total * 26 + (letter.charCodeAt(0) - 64), 0);
}

export function rectangleOf(value: { start?: string; end?: string } | undefined): Rectangle | null {
  if (!value?.start) return null;
  const start = parsePosition(value.start);
  const end = value.end ? parsePosition(value.end) : start;
  if (!start || !end) return null;
  return {
    top: Math.min(start.row, end.row),
    bottom: Math.max(start.row, end.row),
    left: Math.min(start.column, end.column),
    right: Math.max(start.column, end.column),
  };
}

export interface FakeApiOptions {
  /** HTTP status returned by a cell commit. */
  cellStatus?: number;
  /** HTTP status returned by a paste. */
  pasteStatus?: number;
  /** Error text returned by a refused paste. */
  pasteError?: string;
  /** HTTP status returned by a range transfer. */
  transferStatus?: number;
  /** Error text returned by a refused range transfer. */
  transferError?: string;
  /** HTTP status returned by a worksheet state restore. */
  stateStatus?: number;
  /** HTTP status returned by a range sort. */
  sortStatus?: number;
  /** Error text returned by a refused range sort. */
  sortError?: string;
  /** HTTP status returned by a worksheet delete. */
  deleteStatus?: number;
  /** Error text returned by a refused worksheet delete. */
  deleteError?: string;
  /** Extra workbooks the fake starts with. */
  workbooks?: WorkbookState[];
}

export interface FakeCall {
  method: string;
  path: string;
  body: unknown;
}

export function installFakeWorkbookApi(options: FakeApiOptions = {}) {
  const workbooks = [seedWorkbook(), ...(options.workbooks ?? [])];
  const calls: FakeCall[] = [];

  const json = (status: number, payload: unknown) => ({
    ok: status < 400,
    status,
    headers: { get: () => "application/json" },
    json: async () => JSON.parse(JSON.stringify(payload)) as unknown,
    text: async () => JSON.stringify(payload),
  });

  const findSheet = (workbook: WorkbookState, sheetId: string): WorksheetState | undefined =>
    workbook.sheets.find((sheet) => sheet.id === sheetId);

  const refresh = (sheet: WorksheetState) => {
    sheet.values = recalculated(sheet.cells);
    sheet.hiddenRows = hiddenRowsOf(sheet);
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path, body });

    if (path === "/api/workbooks" && method === "GET") {
      return json(200, {
        workbooks: workbooks.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })),
      });
    }

    const cellMatch = /^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/cells\/([^/]+)$/.exec(path);
    if (cellMatch) {
      const workbook = workbooks.find((entry) => entry.id === cellMatch[1]);
      const sheet = workbook && findSheet(workbook, cellMatch[2]);
      if (!workbook || !sheet) return json(404, { error: "Worksheet not found" });
      if (options.cellStatus && options.cellStatus >= 400) {
        return json(options.cellStatus, { error: "Please enter a number from 0 to 100" });
      }
      const address = decodeURIComponent(cellMatch[3]).toUpperCase();
      const value = String((body as { value?: unknown })?.value ?? "");
      const rejected = validationMessageFor(sheet.validations, address, value);
      if (rejected) return json(400, { error: rejected });
      if (value === "") delete sheet.cells[address];
      else sheet.cells[address] = value;
      refresh(sheet);
      workbook.updatedAt = UPDATED_AT;
      return json(200, { workbook });
    }

    const pasteMatch = /^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/paste$/.exec(path);
    if (pasteMatch) {
      const workbook = workbooks.find((entry) => entry.id === pasteMatch[1]);
      const sheet = workbook && findSheet(workbook, pasteMatch[2]);
      if (!workbook || !sheet) return json(404, { error: "Worksheet not found" });
      if (options.pasteStatus && options.pasteStatus >= 400) {
        return json(options.pasteStatus, { error: options.pasteError ?? "Unable to paste" });
      }
      const start = String((body as { start?: unknown })?.start ?? "");
      const text = String((body as { text?: unknown })?.text ?? "");
      const origin = parsePosition(start);
      if (!origin) return json(400, { error: "Invalid cell address" });
      const targets: Array<{ address: string; field: string }> = [];
      text.split("\n").forEach((line, row) => {
        line.split("\t").forEach((field, column) => {
          targets.push({
            address: `${columnLabel(origin.column + column)}${origin.row + row + 1}`,
            field,
          });
        });
      });
      for (const target of targets) {
        const rejected = validationMessageFor(sheet.validations, target.address, target.field);
        if (rejected) return json(400, { error: rejected });
      }
      for (const target of targets) {
        if (target.field === "") delete sheet.cells[target.address];
        else sheet.cells[target.address] = target.field;
      }
      refresh(sheet);
      workbook.updatedAt = UPDATED_AT;
      return json(200, { workbook });
    }

    const sortMatch = /^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/sort$/.exec(path);
    if (sortMatch && method === "POST") {
      const workbook = workbooks.find((entry) => entry.id === sortMatch[1]);
      const sheet = workbook && findSheet(workbook, sortMatch[2]);
      if (!workbook || !sheet) return json(404, { error: "Worksheet not found" });
      if (options.sortStatus && options.sortStatus >= 400) {
        return json(options.sortStatus, { error: options.sortError ?? "Invalid sort range" });
      }
      const payload = body as {
        range?: string;
        column?: string;
        order?: string;
        hasHeader?: boolean;
      };
      const bounds = sortRangeBounds(payload?.range);
      if (!bounds) return json(400, { error: "Invalid sort range" });
      const letters = String(payload?.column ?? "").trim().toUpperCase();
      const position = /^[A-Z]+$/.test(letters) ? parsePosition(`${letters}1`) : null;
      if (!position || position.column < bounds.left || position.column > bounds.right) {
        return json(400, { error: "Invalid sort column" });
      }
      const order = payload?.order;
      if (order !== "ascending" && order !== "descending") {
        return json(400, { error: "Invalid sort order" });
      }
      const firstRow = payload?.hasHeader === true ? bounds.top + 1 : bounds.top;
      const values = recalculated(sheet.cells);
      const records: Array<{ row: number; key: string }> = [];
      for (let row = firstRow; row <= bounds.bottom; row += 1) {
        records.push({
          row,
          key: String(values[`${columnLabel(position.column)}${row + 1}`] ?? ""),
        });
      }
      // `Array#sort` is stable, so equal keys keep their original relative order.
      const sorted = [...records].sort((left, right) => compareSortKeys(left.key, right.key, order));
      const cells: Record<string, string> = {};
      for (const [address, value] of Object.entries(sheet.cells)) {
        const spot = parsePosition(address);
        const inBand =
          spot !== null &&
          spot.row >= firstRow &&
          spot.row <= bounds.bottom &&
          spot.column >= bounds.left &&
          spot.column <= bounds.right;
        if (!inBand) cells[address] = value;
      }
      sorted.forEach((record, index) => {
        const targetRow = firstRow + index;
        const rowDelta = targetRow - record.row;
        for (let column = bounds.left; column <= bounds.right; column += 1) {
          const raw = sheet.cells[`${columnLabel(column)}${record.row + 1}`] ?? "";
          if (raw === "") continue;
          cells[`${columnLabel(column)}${targetRow + 1}`] = raw.startsWith("=")
            ? translateFormula(raw, rowDelta, 0)
            : raw;
        }
      });
      sheet.cells = cells;
      refresh(sheet);
      workbook.updatedAt = UPDATED_AT;
      return json(200, { workbook });
    }

    const transferMatch = /^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/range-transfer$/.exec(path);
    if (transferMatch) {
      const workbook = workbooks.find((entry) => entry.id === transferMatch[1]);
      const sheet = workbook && findSheet(workbook, transferMatch[2]);
      if (!workbook || !sheet) return json(404, { error: "Worksheet not found" });
      if (options.transferStatus && options.transferStatus >= 400) {
        return json(options.transferStatus, {
          error: options.transferError ?? "Please enter a number from 0 to 100",
        });
      }
      const payload = body as {
        source?: { start?: string; end?: string };
        target?: { start?: string; end?: string };
        mode?: string;
      };
      const source = rectangleOf(payload.source);
      const target = rectangleOf(payload.target);
      if (!source || !target || (payload.mode !== "copy" && payload.mode !== "cut")) {
        return json(400, { error: "Invalid cell address" });
      }
      const height = source.bottom - source.top + 1;
      const width = source.right - source.left + 1;
      if (target.top + height > 50 || target.left + width > 26) {
        return json(400, { error: "The pasted range does not fit in the worksheet" });
      }
      const rowDelta = target.top - source.top;
      const columnDelta = target.left - source.left;
      const entries: Array<{ from: string; to: string; value: string }> = [];
      for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
          const from = `${columnLabel(source.left + column)}${source.top + row + 1}`;
          const to = `${columnLabel(target.left + column)}${target.top + row + 1}`;
          const raw = sheet.cells[from] ?? "";
          const value =
            payload.mode === "copy" && raw.startsWith("=")
              ? translateFormula(raw, rowDelta, columnDelta)
              : raw;
          const rejected = validationMessageFor(sheet.validations, to, value);
          if (rejected) return json(400, { error: rejected });
          entries.push({ from, to, value });
        }
      }
      if (payload.mode === "cut") for (const entry of entries) delete sheet.cells[entry.from];
      for (const entry of entries) {
        if (entry.value === "") delete sheet.cells[entry.to];
        else sheet.cells[entry.to] = entry.value;
      }
      sheet.selection = {
        start: `${columnLabel(target.left)}${target.top + 1}`,
        end: `${columnLabel(target.left + width - 1)}${target.top + height}`,
      };
      refresh(sheet);
      workbook.updatedAt = UPDATED_AT;
      return json(200, { workbook });
    }

    const stateMatch = /^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/state$/.exec(path);
    if (stateMatch && method === "PUT") {
      const workbook = workbooks.find((entry) => entry.id === stateMatch[1]);
      const sheet = workbook && findSheet(workbook, stateMatch[2]);
      if (!workbook || !sheet) return json(404, { error: "Worksheet not found" });
      if (options.stateStatus && options.stateStatus >= 400) {
        return json(options.stateStatus, { error: "Invalid worksheet state" });
      }
      const payload = body as {
        cells?: Record<string, string>;
        rowCount?: number | null;
        columnCount?: number | null;
        validations?: unknown[];
      };
      sheet.cells = { ...(payload.cells ?? {}) };
      if (payload.rowCount === null) delete sheet.rowCount;
      else if (typeof payload.rowCount === "number") sheet.rowCount = payload.rowCount;
      if (payload.columnCount === null) delete sheet.columnCount;
      else if (typeof payload.columnCount === "number") sheet.columnCount = payload.columnCount;
      if (payload.validations) {
        sheet.validations = payload.validations as WorksheetState["validations"];
      }
      refresh(sheet);
      workbook.updatedAt = UPDATED_AT;
      return json(200, { workbook });
    }

    const filterMatch = /^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/filter$/.exec(path);
    if (filterMatch && method === "PUT") {
      const workbook = workbooks.find((entry) => entry.id === filterMatch[1]);
      const sheet = workbook && findSheet(workbook, filterMatch[2]);
      if (!workbook || !sheet) return json(404, { error: "Worksheet not found" });
      const payload = body as { filter?: WorksheetState["filter"] | null };
      if (payload.filter === null) delete sheet.filter;
      else if (payload.filter) sheet.filter = payload.filter;
      else return json(400, { error: "Invalid filter" });
      refresh(sheet);
      return json(200, { workbook });
    }

    const validationsMatch = /^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/validations$/.exec(path);
    if (validationsMatch && method === "PUT") {
      const workbook = workbooks.find((entry) => entry.id === validationsMatch[1]);
      const sheet = workbook && findSheet(workbook, validationsMatch[2]);
      if (!workbook || !sheet) return json(404, { error: "Worksheet not found" });
      const payload = body as { validations?: WorksheetState["validations"] };
      if (!Array.isArray(payload.validations)) {
        return json(400, { error: "Invalid validation rules" });
      }
      sheet.validations = payload.validations.map((rule) =>
        rule.type === "dropdown"
          ? { ...rule, values: allowedValuesFromText((rule.values ?? []).join(",")) }
          : rule,
      );
      refresh(sheet);
      workbook.updatedAt = UPDATED_AT;
      return json(200, { workbook });
    }

    const sheetMatch = /^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)$/.exec(path);
    if (sheetMatch && method === "DELETE") {
      const workbook = workbooks.find((entry) => entry.id === sheetMatch[1]);
      const sheet = workbook && findSheet(workbook, sheetMatch[2]);
      if (!workbook || !sheet) return json(404, { error: "Worksheet not found" });
      if (options.deleteStatus && options.deleteStatus >= 400) {
        return json(options.deleteStatus, {
          error: options.deleteError ?? "Unable to delete worksheet",
        });
      }
      if (workbook.sheets.length <= 1) {
        return json(400, { error: "A workbook must contain at least one worksheet" });
      }
      const targetId = sheet.id;
      if (
        workbook.sheets.some(
          (entry) => entry.id !== targetId && entry.pivot?.sourceSheetId === targetId,
        )
      ) {
        return json(400, { error: "Please delete or rebuild dependent pivot tables first" });
      }
      const index = workbook.sheets.findIndex((entry) => entry.id === targetId);
      const remaining = workbook.sheets.filter((entry) => entry.id !== targetId);
      const adjacent = index > 0 ? remaining[index - 1].id : remaining[0].id;
      workbook.sheets = remaining;
      if (workbook.activeSheetId === targetId) workbook.activeSheetId = adjacent;
      workbook.updatedAt = UPDATED_AT;
      return json(200, { workbook });
    }

    if (sheetMatch && method === "PATCH") {
      const workbook = workbooks.find((entry) => entry.id === sheetMatch[1]);
      const sheet = workbook && findSheet(workbook, sheetMatch[2]);
      if (!workbook || !sheet) return json(404, { error: "Worksheet not found" });
      const patch = body as { name?: string; selection?: { start: string; end: string } };
      if (patch?.name) sheet.name = patch.name;
      if (patch?.selection) sheet.selection = patch.selection;
      return json(200, { workbook });
    }

    const addSheetMatch = /^\/api\/workbooks\/([^/]+)\/sheets$/.exec(path);
    if (addSheetMatch && method === "POST") {
      const workbook = workbooks.find((entry) => entry.id === addSheetMatch[1]);
      if (!workbook) return json(404, { error: "Workbook not found" });
      const id = `${workbook.id}-sheet-${workbook.sheets.length + 1}`;
      const sheet: WorksheetState = { id, name: `Sheet${workbook.sheets.length + 1}`, cells: {} };
      workbook.sheets.push(sheet);
      workbook.activeSheetId = id;
      return json(201, { workbook, worksheet: sheet });
    }

    const structureMatch = /^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/(rows|columns)$/.exec(path);
    if (structureMatch && method === "POST") {
      const workbook = workbooks.find((entry) => entry.id === structureMatch[1]);
      const sheet = workbook && findSheet(workbook, structureMatch[2]);
      if (!workbook || !sheet) return json(404, { error: "Worksheet not found" });
      const axis: "row" | "column" = structureMatch[3] === "rows" ? "row" : "column";
      const payload = body as { action?: string; row?: number; column?: number };
      const change: StructureChange = {
        axis,
        action: String(payload.action),
        index: Number(axis === "row" ? payload.row : payload.column),
      };
      const target = change.index - 1;
      const insertedAt = change.action === "insert-below" || change.action === "insert-right"
        ? target + 1
        : target;
      const shifted: Record<string, string> = {};
      for (const [address, value] of Object.entries(sheet.cells)) {
        const position = parsePosition(address);
        if (!position) continue;
        let { row, column } = position;
        if (change.action === "delete") {
          const current = axis === "row" ? row : column;
          if (current === target) continue;
          if (current > target) {
            if (axis === "row") row -= 1;
            else column -= 1;
          }
        } else {
          const current = axis === "row" ? row : column;
          if (current >= insertedAt) {
            if (axis === "row") row += 1;
            else column += 1;
          }
        }
        shifted[`${columnLabel(column)}${row + 1}`] = adjustFormulaForStructure(value, change);
      }
      sheet.cells = shifted;
      // A pivot that reads this worksheet keeps its last summary but follows the moved range.
      for (const entry of workbook.sheets) {
        if (entry.pivot?.sourceSheetId === sheet.id) {
          const bounds = filterRangeBounds(entry.pivot.sourceRange);
          if (bounds) {
            const shift = (span: [number, number]): [number, number] | null => {
              const deleting = change.action === "delete";
              const insertedAt =
                change.action === "insert-below" || change.action === "insert-right"
                  ? change.index + 1
                  : change.index;
              if (deleting) {
                const low = span[0] > change.index ? span[0] - 1 : span[0];
                const high = span[1] >= change.index ? span[1] - 1 : span[1];
                return high < low ? null : [low, high];
              }
              return [
                span[0] >= insertedAt ? span[0] + 1 : span[0],
                span[1] >= insertedAt ? span[1] + 1 : span[1],
              ];
            };
            const rows = shift([bounds.top + 1, bounds.bottom + 1]);
            const columns = shift([bounds.left + 1, bounds.right + 1]);
            if (rows && columns) {
              entry.pivot.sourceRange = `${columnLabel(columns[0] - 1)}${rows[0]}:${columnLabel(columns[1] - 1)}${rows[1]}`;
            }
          }
        }
      }
      if (change.action === "delete") {
        if (axis === "row") delete sheet.rowCount;
        else delete sheet.columnCount;
      } else if (axis === "row") {
        sheet.rowCount = (sheet.rowCount ?? 50) + 1;
      } else {
        sheet.columnCount = (sheet.columnCount ?? 26) + 1;
      }
      refresh(sheet);
      workbook.updatedAt = UPDATED_AT;
      return json(200, { workbook });
    }

    const pivotCreateMatch = /^\/api\/workbooks\/([^/]+)\/pivots$/.exec(path);
    if (pivotCreateMatch && method === "POST") {
      const workbook = workbooks.find((entry) => entry.id === pivotCreateMatch[1]);
      if (!workbook) return json(404, { error: "Workbook not found" });
      const payload = body as { sourceSheetId?: string; sourceRange?: string };
      const source = workbook.sheets.find((sheet) => sheet.id === payload?.sourceSheetId);
      if (!source) return json(400, { error: "Worksheet not found" });
      const bounds = filterRangeBounds(String(payload?.sourceRange ?? ""));
      if (!bounds) return json(400, { error: "Invalid pivot source range" });
      const used = workbook.sheets.map((sheet) => sheet.name);
      let index = 1;
      while (used.includes(`Pivot${index}`)) index += 1;
      const id = `${workbook.id}-pivot-${index}`;
      const sheet: WorksheetState = {
        id,
        name: `Pivot${index}`,
        cells: {},
        values: {},
        pivot: {
          sourceSheetId: source.id,
          sourceRange: `${columnLabel(bounds.left)}${bounds.top + 1}:${columnLabel(bounds.right)}${bounds.bottom + 1}`,
          rowField: "",
          columnField: "",
          valueField: "",
          method: "SUM",
        },
      };
      workbook.sheets.push(sheet);
      workbook.activeSheetId = id;
      workbook.updatedAt = UPDATED_AT;
      return json(201, { workbook, worksheet: sheet });
    }

    const pivotMatch = /^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/pivot(\/refresh)?$/.exec(path);
    if (pivotMatch && (pivotMatch[3] ? method === "POST" : method === "PUT")) {
      const workbook = workbooks.find((entry) => entry.id === pivotMatch[1]);
      const sheet = workbook && findSheet(workbook, pivotMatch[2]);
      if (!workbook || !sheet) return json(404, { error: "Worksheet not found" });
      if (!sheet.pivot) return json(400, { error: "This worksheet is not a pivot table" });
      const payload = body as {
        rowField?: string;
        columnField?: string;
        valueField?: string;
        method?: string;
      };
      const config: PivotConfig = pivotMatch[3]
        ? sheet.pivot
        : {
            ...sheet.pivot,
            rowField: String(payload?.rowField ?? "").trim(),
            columnField: String(payload?.columnField ?? "").trim(),
            valueField: String(payload?.valueField ?? "").trim(),
            method: String(payload?.method ?? "").toUpperCase() as PivotMethod,
          };
      const source = workbook.sheets.find((entry) => entry.id === sheet.pivot?.sourceSheetId);
      const result = computePivotCells(source, config);
      if (!result.ok) return json(400, { error: result.error });
      sheet.pivot = config;
      sheet.cells = result.cells;
      refresh(sheet);
      workbook.updatedAt = UPDATED_AT;
      return json(200, { workbook });
    }

    const workbookMatch = /^\/api\/workbooks\/([^/]+)$/.exec(path);
    if (workbookMatch) {
      const workbook = workbooks.find((entry) => entry.id === workbookMatch[1]);
      if (!workbook) return json(404, { error: "Workbook not found" });
      if (method === "PATCH") {
        const patch = body as { activeSheetId?: string };
        if (patch?.activeSheetId) workbook.activeSheetId = patch.activeSheetId;
      }
      return json(200, { workbook });
    }

    return json(404, { error: "Not found" });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { workbooks, calls, fetchMock };
}
