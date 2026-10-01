import { vi } from "vitest";

import {
  cellCoordinate,
  columnIndex,
  columnLabel,
  isCellCoordinate,
  parseCellCoordinate,
  type SelectionRange,
} from "../lib/spreadsheet";
import type { CellRange, PivotConfig, SummarizeMethod, Workbook, WorkbookSummary } from "../lib/workbooks";
import type { FilterView } from "../lib/filter-view";
import type { ValidationRule } from "../lib/data-validation";

interface FakeWorksheet {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  cells: Record<string, string>;
  selection: SelectionRange;
  validations: ValidationRule[];
  filters: FilterView[];
  pivot: PivotConfig | null;
}

interface FakeHistoryEntry {
  past: Workbook[];
  future: Workbook[];
}

interface FakeState {
  workbooks: Workbook[];
  clock: number;
  history: Record<string, FakeHistoryEntry>;
}

export const SEED_UPDATED_AT = "2026-01-15T09:30:00.000Z";

export function seededWorkbook(): Workbook {
  return {
    id: "wb-q3-sales",
    name: "Q3 Sales",
    createdAt: SEED_UPDATED_AT,
    updatedAt: SEED_UPDATED_AT,
    activeWorksheetId: "ws-q3-sales-sheet1",
    canUndo: false,
    canRedo: false,
    worksheets: [
      {
        id: "ws-q3-sales-sheet1",
        name: "Sheet1",
        rowCount: 30,
        columnCount: 26,
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
        selection: { anchor: "A1", focus: "A1" },
        validations: [],
        filters: [],
        pivot: null,
      },
      {
        id: "ws-q3-sales-sheet2",
        name: "Sheet2",
        rowCount: 30,
        columnCount: 26,
        cells: {},
        selection: { anchor: "A1", focus: "A1" },
        validations: [],
        filters: [],
        pivot: null,
      },
    ],
  };
}

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function summarize(workbook: Workbook): WorkbookSummary {
  return {
    id: workbook.id,
    name: workbook.name,
    updatedAt: workbook.updatedAt,
    worksheetCount: workbook.worksheets.length,
    activeWorksheetName: workbook.worksheets.find((sheet) => sheet.id === workbook.activeWorksheetId)?.name ?? null,
  };
}

function requireWorkbook(state: FakeState, id: string) {
  return state.workbooks.find((workbook) => workbook.id === id) ?? null;
}

function historyOf(state: FakeState, workbookId: string): FakeHistoryEntry {
  state.history[workbookId] ??= { past: [], future: [] };
  return state.history[workbookId];
}

/** First unused `SheetN` name in positive-integer order, exactly like the backend allocates it. */
function nextWorksheetName(workbook: Workbook): string {
  const used = new Set<number>();
  for (const sheet of workbook.worksheets) {
    const match = /^Sheet([1-9][0-9]*)$/.exec(sheet.name);
    if (match) used.add(Number(match[1]));
  }
  let index = 1;
  while (used.has(index)) index += 1;
  return `Sheet${index}`;
}

/**
 * Mirrors the backend: every content operation snapshots the workbook first, so undo/redo restore
 * values, formulas and structure together, and a new modification drops the redo branch.
 */
function recordHistory(state: FakeState, workbook: Workbook) {
  const entry = historyOf(state, workbook.id);
  entry.past.push(structuredClone(workbook));
  entry.future = [];
}

/** Adds the undo/redo availability the real payload carries. */
function respond(state: FakeState, workbook: Workbook): Workbook {
  const entry = historyOf(state, workbook.id);
  workbook.canUndo = entry.past.length > 0;
  workbook.canRedo = entry.future.length > 0;
  return workbook;
}

function restoreSnapshot(state: FakeState, workbookId: string, snapshot: Workbook): Workbook | null {
  const index = state.workbooks.findIndex((item) => item.id === workbookId);
  if (index === -1) return null;
  const previous = structuredClone(state.workbooks[index]);
  state.workbooks[index] = structuredClone(snapshot);
  return previous;
}

/** Copy semantics of the backend formula rewriting: relative references follow the offset. */
function offsetFormula(value: string, rowDelta: number, columnDelta: number): string {
  if (value[0] !== "=") return value;
  return value.replace(/\$?[A-Z]+\$?[0-9]+/g, (match) => {
    const parsed = /^(\$?)([A-Z]+)(\$?)([0-9]+)$/.exec(match)!;
    const column = columnIndex(parsed[2]);
    const movedColumn = parsed[1] ? column : column + columnDelta;
    const movedRow = parsed[3] ? Number(parsed[4]) - 1 : Number(parsed[4]) - 1 + rowDelta;
    if (movedColumn < 0 || movedRow < 0) return "#REF!";
    return `${parsed[1]}${columnLabel(movedColumn)}${parsed[3]}${movedRow + 1}`;
  });
}

/** Rectangle bounds of `{ start, end }`, in any corner order. */
function rectangleBounds(rectangle: CellRange) {
  const start = parseCellCoordinate(rectangle.start) ?? { row: 0, column: 0 };
  const end = parseCellCoordinate(rectangle.end) ?? start;
  return {
    minRow: Math.min(start.row, end.row),
    maxRow: Math.max(start.row, end.row),
    minColumn: Math.min(start.column, end.column),
    maxColumn: Math.max(start.column, end.column),
  };
}

/** Mirror of the rectangle semantics of `backend/src/lib/range-transfer.mjs`. */
function transferRectangle(
  worksheet: FakeWorksheet,
  { source, target, mode }: { source: CellRange; target: CellRange; mode: string },
) {
  const from = rectangleBounds(source);
  const to = rectangleBounds(target);
  const rowDelta = to.minRow - from.minRow;
  const columnDelta = to.minColumn - from.minColumn;
  const writes: Array<{ coordinate: string; value: string }> = [];
  const clears: string[] = [];
  for (let row = from.minRow; row <= from.maxRow; row += 1) {
    for (let column = from.minColumn; column <= from.maxColumn; column += 1) {
      const coordinate = cellCoordinate(row, column);
      writes.push({
        coordinate: cellCoordinate(row + rowDelta, column + columnDelta),
        value: offsetFormula(worksheet.cells[coordinate] ?? "", rowDelta, columnDelta),
      });
      if (mode === "cut") clears.push(coordinate);
    }
  }
  for (const coordinate of clears) delete worksheet.cells[coordinate];
  for (const write of writes) {
    if (write.value === "") delete worksheet.cells[write.coordinate];
    else worksheet.cells[write.coordinate] = write.value;
  }
  worksheet.rowCount = Math.max(worksheet.rowCount, from.maxRow + rowDelta + 1);
  worksheet.columnCount = Math.max(worksheet.columnCount, from.maxColumn + columnDelta + 1);
}

const INVALID_CSV_MESSAGE = "Invalid CSV file format. Import failed.";

/**
 * Mirror of `backend/src/lib/paste.mjs`: tab-separated columns, newline-separated rows, a single
 * trailing line break ignored. Empty fields stay empty so the rectangle is overwritten completely.
 */
function parsePastedText(text: string): string[][] {
  let normalised = text;
  if (normalised.endsWith("\r\n")) normalised = normalised.slice(0, -2);
  else if (normalised.endsWith("\n") || normalised.endsWith("\r")) normalised = normalised.slice(0, -1);
  if (normalised === "") return [];
  return normalised.split(/\r\n|\n|\r/).map((line) => line.split("\t"));
}

function pastedRectangle(rows: string[][], start: string): Array<{ coordinate: string; value: string }> {
  const position = parseCellCoordinate(start);
  if (!position) return [];
  const updates: Array<{ coordinate: string; value: string }> = [];
  rows.forEach((fields, rowOffset) => {
    fields.forEach((value, columnOffset) => {
      updates.push({ coordinate: cellCoordinate(position.row + rowOffset, position.column + columnOffset), value });
    });
  });
  return updates;
}

/** Mirror of `backend/src/lib/csv.mjs` so UI tests exercise the documented import contract. */
function parseCsvRows(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let fieldStarted = false;
  let inQuotes = false;
  let closedQuote = false;
  let index = 0;
  const endField = () => { row.push(field); field = ""; fieldStarted = false; closedQuote = false; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (index < text.length) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 2; continue; }
        inQuotes = false; closedQuote = true; index += 1; continue;
      }
      if (char === "\r") { field += "\n"; index += text[index + 1] === "\n" ? 2 : 1; continue; }
      field += char; index += 1; continue;
    }
    if (closedQuote) {
      if (char === ",") { endField(); index += 1; continue; }
      if (char === "\n") { endRow(); index += 1; continue; }
      if (char === "\r") { endRow(); index += text[index + 1] === "\n" ? 2 : 1; continue; }
      throw new Error(INVALID_CSV_MESSAGE);
    }
    if (char === '"' && !fieldStarted) { inQuotes = true; fieldStarted = true; index += 1; continue; }
    if (char === ",") { endField(); index += 1; continue; }
    if (char === "\n") { endRow(); index += 1; continue; }
    if (char === "\r") { endRow(); index += text[index + 1] === "\n" ? 2 : 1; continue; }
    field += char; fieldStarted = true; index += 1;
  }
  if (inQuotes) throw new Error(INVALID_CSV_MESSAGE);
  if (fieldStarted || row.length > 0) endRow();
  return rows;
}

/** First unused `PivotN` name in positive-integer order, like the backend allocates it. */
function nextPivotName(workbook: Workbook): string {
  const used = new Set<number>();
  for (const sheet of workbook.worksheets) {
    const match = /^Pivot([1-9][0-9]*)$/.exec(sheet.name);
    if (match) used.add(Number(match[1]));
  }
  let index = 1;
  while (used.has(index)) index += 1;
  return `Pivot${index}`;
}

/**
 * Mirror of `backend/src/lib/pivot.mjs` (REQ-5-3-1): the result rectangle of one configuration over
 * a source range, or the message of a refused configuration.
 */
const PIVOT_FIELD_UNAVAILABLE_MESSAGE = "Pivot field is no longer available. Select a new field.";
const PIVOT_NUMERIC_MESSAGE = "Value field requires numeric values";
const PIVOT_FIELDS_REQUIRED_MESSAGE = "Select a row field and a value field";
const PIVOT_RANGE_MESSAGE = "Invalid pivot source range";
const SUMMARIZE_METHOD_NAMES: SummarizeMethod[] = ["SUM", "COUNT", "AVERAGE"];

function pivotHeaderText(cells: Record<string, string>, row: number, column: number): string {
  return (cells[cellCoordinate(row, column)] ?? "").trim();
}

function pivotFields(cells: Record<string, string>, range: CellRange): string[] {
  const bounds = rectangleBounds(range);
  const fields: string[] = [];
  for (let column = bounds.minColumn; column <= bounds.maxColumn; column += 1) {
    const text = pivotHeaderText(cells, bounds.minRow, column);
    if (text !== "") fields.push(text);
  }
  return fields;
}

function pivotColumnOf(cells: Record<string, string>, bounds: ReturnType<typeof rectangleBounds>, field: string): number {
  for (let column = bounds.minColumn; column <= bounds.maxColumn; column += 1) {
    if (pivotHeaderText(cells, bounds.minRow, column) === field) return column;
  }
  return -1;
}

function pivotNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function pivotResult(
  cells: Record<string, string>,
  range: CellRange,
  settings: { rows: string | null; columns: string | null; values: string | null; summarizeBy: string },
): { cells: Record<string, string> } | { error: string } {
  const bounds = rectangleBounds(range);
  if (!settings.rows || !settings.values) return { error: PIVOT_FIELDS_REQUIRED_MESSAGE };
  const rowColumn = pivotColumnOf(cells, bounds, settings.rows);
  const valueColumn = pivotColumnOf(cells, bounds, settings.values);
  const columnColumn = settings.columns ? pivotColumnOf(cells, bounds, settings.columns) : -1;
  if (rowColumn < 0 || valueColumn < 0 || (settings.columns !== null && columnColumn < 0)) {
    return { error: PIVOT_FIELD_UNAVAILABLE_MESSAGE };
  }
  const method: SummarizeMethod = SUMMARIZE_METHOD_NAMES.includes(settings.summarizeBy as SummarizeMethod)
    ? settings.summarizeBy as SummarizeMethod
    : "SUM";
  const records: Array<{ rowKey: string; columnKey: string | null; value: string }> = [];
  for (let row = bounds.minRow + 1; row <= bounds.maxRow; row += 1) {
    let empty = true;
    for (let column = bounds.minColumn; column <= bounds.maxColumn; column += 1) {
      if ((cells[cellCoordinate(row, column)] ?? "") !== "") {
        empty = false;
        break;
      }
    }
    if (empty) continue;
    records.push({
      rowKey: pivotHeaderText(cells, row, rowColumn),
      columnKey: columnColumn >= 0 ? pivotHeaderText(cells, row, columnColumn) : null,
      value: cells[cellCoordinate(row, valueColumn)] ?? "",
    });
  }
  if (method !== "COUNT" && !records.some((record) => pivotNumber(record.value) !== null)) {
    return { error: PIVOT_NUMERIC_MESSAGE };
  }
  const aggregate = (selected: typeof records): number => {
    if (method === "COUNT") return selected.filter((record) => record.value.trim() !== "").length;
    const numbers = selected.map((record) => pivotNumber(record.value)).filter((value): value is number => value !== null);
    if (!numbers.length) return 0;
    const total = numbers.reduce((sum, value) => sum + value, 0);
    return method === "AVERAGE" ? total / numbers.length : total;
  };
  const format = (value: number) => String(Number(value.toFixed(10)));
  const matching = (rowKey: string | null, columnKey: string | null) => records.filter(
    (record) => (rowKey === null || record.rowKey === rowKey)
      && (columnKey === null || record.columnKey === columnKey),
  );
  const rowKeys: string[] = [];
  const columnKeys: string[] = [];
  for (const record of records) {
    if (!rowKeys.includes(record.rowKey)) rowKeys.push(record.rowKey);
    if (columnColumn >= 0 && record.columnKey !== null && !columnKeys.includes(record.columnKey)) {
      columnKeys.push(record.columnKey);
    }
  }
  const result: Record<string, string> = { A1: settings.rows };
  if (columnColumn < 0) {
    result.B1 = `${method} of ${settings.values}`;
    rowKeys.forEach((key, index) => {
      result[cellCoordinate(index + 1, 0)] = key;
      result[cellCoordinate(index + 1, 1)] = format(aggregate(matching(key, null)));
    });
    result[cellCoordinate(rowKeys.length + 1, 0)] = "Grand Total";
    result[cellCoordinate(rowKeys.length + 1, 1)] = format(aggregate(records));
    return { cells: result };
  }
  const totalColumn = columnKeys.length + 1;
  columnKeys.forEach((key, index) => {
    result[cellCoordinate(0, index + 1)] = key;
  });
  result[cellCoordinate(0, totalColumn)] = "Grand Total";
  rowKeys.forEach((key, index) => {
    const row = index + 1;
    result[cellCoordinate(row, 0)] = key;
    columnKeys.forEach((columnKey, columnIndex) => {
      result[cellCoordinate(row, columnIndex + 1)] = format(aggregate(matching(key, columnKey)));
    });
    result[cellCoordinate(row, totalColumn)] = format(aggregate(matching(key, null)));
  });
  const totalRow = rowKeys.length + 1;
  result[cellCoordinate(totalRow, 0)] = "Grand Total";
  columnKeys.forEach((columnKey, index) => {
    result[cellCoordinate(totalRow, index + 1)] = format(aggregate(matching(null, columnKey)));
  });
  result[cellCoordinate(totalRow, totalColumn)] = format(aggregate(records));
  return { cells: result };
}

function activeWorksheetOf(workbook: Workbook, worksheetId?: string): FakeWorksheet {
  return (workbook.worksheets.find((sheet) => sheet.id === worksheetId)
    ?? workbook.worksheets.find((sheet) => sheet.id === workbook.activeWorksheetId)
    ?? workbook.worksheets[0]) as FakeWorksheet;
}

/** One-axis shift of a single row/column insertion or deletion. */
interface AxisShift {
  axis: "row" | "column";
  kind: "insert" | "delete";
  index: number;
}

/** Moves one 0-based row/column; `null` when the shifted line itself was deleted. */
function shiftedIndex(value: number, shift: AxisShift): number | null {
  if (shift.kind === "insert") return value >= shift.index ? value + 1 : value;
  if (value === shift.index) return null;
  return value > shift.index ? value - 1 : value;
}

/**
 * A1 references and ranges of the shifted worksheet; a reference prefixed by a worksheet name is
 * matched by the first alternative and therefore left untouched.
 */
const FORMULA_REFERENCE = /(?:'[^']*'|[A-Za-z_][A-Za-z0-9_.]*)!|(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*)(?::(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*))?/g;

/**
 * Mirror of the documented formula rewriting of `backend/src/lib/formulas.mjs` for one-axis
 * structure changes: every reference of this worksheet follows the shift, both endpoints of a
 * range follow it, and a reference whose row or column was deleted becomes `#REF!`. String
 * literals and references naming another worksheet are covered by the backend suite instead.
 */
function shiftFormula(value: string, shift: AxisShift): string {
  if (value[0] !== "=") return value;
  const moveEndpoint = (dollarColumn: string, letters: string, dollarRow: string, digits: string) => {
    const column = columnIndex(letters.toUpperCase());
    const row = Number(digits) - 1;
    const movedColumn = shift.axis === "column" ? shiftedIndex(column, shift) : column;
    const movedRow = shift.axis === "row" ? shiftedIndex(row, shift) : row;
    if (movedColumn === null || movedRow === null) return null;
    return `${dollarColumn}${columnLabel(movedColumn)}${dollarRow}${movedRow + 1}`;
  };
  return value.replace(
    FORMULA_REFERENCE,
    (match, dollarColumn, letters, dollarRow, digits, endDollarColumn, endLetters, endRow, endDigits) => {
      if (letters === undefined) return match;
      const start = moveEndpoint(dollarColumn, letters, dollarRow, digits);
      if (!start) return "#REF!";
      if (endDigits === undefined) return start;
      const end = moveEndpoint(endDollarColumn, endLetters, endRow, endDigits);
      if (!end) return "#REF!";
      return `${start}:${end}`;
    },
  );
}

/**
 * Mirror of the documented row/column structure contract (`backend/src/lib/structure.mjs`): cells
 * and the selection move with the insert/delete while the formulas they hold are rewritten. Rule,
 * filter and pivot range alignment is covered by the backend suite.
 */
function moveWorksheet(worksheet: FakeWorksheet, shift: AxisShift) {
  const moveIndex = (value: number) => shiftedIndex(value, shift);
  const cells: Record<string, string> = {};
  for (const [coordinate, value] of Object.entries(worksheet.cells)) {
    const position = parseCellCoordinate(coordinate);
    if (!position) continue;
    const row = shift.axis === "row" ? moveIndex(position.row) : position.row;
    const column = shift.axis === "column" ? moveIndex(position.column) : position.column;
    if (row === null || column === null) continue;
    cells[cellCoordinate(row, column)] = shiftFormula(value, shift);
  }
  const moveCoordinate = (coordinate: string) => {
    const position = parseCellCoordinate(coordinate) ?? { row: 0, column: 0 };
    const moved = shift.axis === "row" ? moveIndex(position.row) : moveIndex(position.column);
    const clamped = moved === null ? shift.index : moved;
    return shift.axis === "row"
      ? cellCoordinate(clamped, position.column)
      : cellCoordinate(position.row, clamped);
  };
  worksheet.cells = cells;
  worksheet.selection = {
    anchor: moveCoordinate(worksheet.selection.anchor),
    focus: moveCoordinate(worksheet.selection.focus),
  };
  return worksheet;
}

/**
 * In-memory stand-in for the backend workbook API. It mirrors the documented contract so UI
 * tests can drive the same relative endpoints the application uses in the browser.
 */
function validationRuleAccepts(rule: ValidationRule, value: string): boolean {
  const text = value.trim();
  if (rule.type === "dropdown") return rule.values.includes(text);
  const parsed = Number(text);
  if (text === "" || !Number.isFinite(parsed)) return false;
  return parsed >= rule.min && parsed <= rule.max;
}

function validationRuleMessage(rule: ValidationRule): string {
  if (rule.type === "dropdown") {
    return `Please select one of the following values: ${rule.values.join(", ")}`;
  }
  if (rule.min === 0 && rule.max === 100) return "Please enter a number from 0 to 100";
  return `Please enter a number between ${rule.min} and ${rule.max}`;
}

/** Mirrors `validationRejection` of `backend/src/lib/validation.mjs` for one list of writes. */
function validationRefusal(
  worksheet: FakeWorksheet,
  updates: Array<{ coordinate: string; value: string }>,
): string | null {
  for (const rule of worksheet.validations) {
    const start = parseCellCoordinate(rule.range.start);
    const end = parseCellCoordinate(rule.range.end);
    if (!start || !end) continue;
    for (const update of updates) {
      if (update.value === "") continue;
      const target = parseCellCoordinate(update.coordinate);
      if (!target) continue;
      const inside = target.row >= Math.min(start.row, end.row) && target.row <= Math.max(start.row, end.row)
        && target.column >= Math.min(start.column, end.column)
        && target.column <= Math.max(start.column, end.column);
      if (inside && !validationRuleAccepts(rule, update.value)) return validationRuleMessage(rule);
    }
  }
  return null;
}

function parseAllowedValueList(values: string[]): string[] {
  return values.map((value) => value.trim()).filter((value) => value !== "");
}

/** Target writes of a copy/cut, checked against the rules before anything is written. */
function transferWrites(
  worksheet: FakeWorksheet,
  { source, target }: { source: CellRange; target: CellRange },
): Array<{ coordinate: string; value: string }> {
  const from = rectangleBounds(source);
  const to = rectangleBounds(target);
  const rowDelta = to.minRow - from.minRow;
  const columnDelta = to.minColumn - from.minColumn;
  const writes: Array<{ coordinate: string; value: string }> = [];
  for (let row = from.minRow; row <= from.maxRow; row += 1) {
    for (let column = from.minColumn; column <= from.maxColumn; column += 1) {
      const coordinate = cellCoordinate(row, column);
      writes.push({
        coordinate: cellCoordinate(row + rowDelta, column + columnDelta),
        value: offsetFormula(worksheet.cells[coordinate] ?? "", rowDelta, columnDelta),
      });
    }
  }
  return writes;
}

interface SortKey {
  rank: number;
  number?: number;
  date?: number;
  text?: string;
}

/** Comparable key of one cell text, mirroring the ranking of the backend module. */
function sortKey(text: string): SortKey {
  const trimmed = text.trim();
  if (trimmed === "") return { rank: 3 };
  const number = Number(trimmed);
  if (Number.isFinite(number)) return { rank: 0, number };
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) return { rank: 1, date };
  return { rank: 2, text: trimmed.toLowerCase() };
}

function compareSortKeys(first: SortKey, second: SortKey): number {
  if (first.rank !== second.rank) return first.rank < second.rank ? -1 : 1;
  if (first.rank === 0) return (first.number ?? 0) === (second.number ?? 0) ? 0 : ((first.number ?? 0) < (second.number ?? 0) ? -1 : 1);
  if (first.rank === 1) return (first.date ?? 0) === (second.date ?? 0) ? 0 : ((first.date ?? 0) < (second.date ?? 0) ? -1 : 1);
  if (first.rank === 2) return (first.text ?? "") === (second.text ?? "") ? 0 : ((first.text ?? "") < (second.text ?? "") ? -1 : 1);
  return 0;
}

/**
 * Mirror of `backend/src/lib/sort-range.mjs` (REQ-5-1-1): whole records move together by row inside
 * the selected range only, a formula follows the row offset of its record, and equal sort keys keep
 * their original relative order.
 */
function sortRectangle(
  worksheet: FakeWorksheet,
  { range, column, order, hasHeaderRow }: { range: CellRange; column: string; order: string; hasHeaderRow: boolean },
) {
  const bounds = rectangleBounds(range);
  const index = columnIndex(column) - bounds.minColumn;
  const firstDataRow = bounds.minRow + (hasHeaderRow ? 1 : 0);
  const records: Array<{ row: number; values: string[]; key: SortKey }> = [];
  for (let row = firstDataRow; row <= bounds.maxRow; row += 1) {
    const values: string[] = [];
    for (let position = bounds.minColumn; position <= bounds.maxColumn; position += 1) {
      values.push(worksheet.cells[cellCoordinate(row, position)] ?? "");
    }
    records.push({ row, values, key: sortKey(values[index]) });
  }
  const direction = order === "descending" ? -1 : 1;
  const ordered = records
    .map((record, position) => ({ record, position }))
    .sort((first, second) => direction * compareSortKeys(first.record.key, second.record.key)
      || first.position - second.position)
    .map((entry) => entry.record);
  ordered.forEach((record, offset) => {
    const targetRow = firstDataRow + offset;
    const rowDelta = targetRow - record.row;
    record.values.forEach((value, position) => {
      const coordinate = cellCoordinate(targetRow, bounds.minColumn + position);
      if (value === "") {
        delete worksheet.cells[coordinate];
        return;
      }
      worksheet.cells[coordinate] = value[0] === "=" ? offsetFormula(value, rowDelta, 0) : value;
    });
  });
}

export function installFakeBackend(workbooks: Workbook[] = [seededWorkbook()]) {
  const state: FakeState = { workbooks: structuredClone(workbooks), clock: 0, history: {} };
  const requests: Array<{ method: string; path: string }> = [];
  let pendingFailure: { test: (method: string, path: string) => boolean; status: number; error: string } | null = null;

  const nextTimestamp = () => {
    state.clock += 1;
    return `2026-02-01T00:00:${String(state.clock).padStart(2, "0")}.000Z`;
  };

  const handler = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input.toString();
    const url = new URL(raw, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    requests.push({ method, path: url.pathname });

    if (pendingFailure && pendingFailure.test(method, url.pathname)) {
      const failure = pendingFailure;
      pendingFailure = null;
      return jsonResponse(failure.status, { error: failure.error });
    }

    if (url.pathname === "/api/workbooks" && method === "GET") {
      return jsonResponse(200, { workbooks: state.workbooks.map(summarize) });
    }
    if (url.pathname === "/api/workbooks" && method === "POST") {
      const name = String(body.name ?? "").trim();
      if (!name) return jsonResponse(400, { error: "Workbook name cannot be empty" });
      const timestamp = nextTimestamp();
      const workbook: Workbook = {
        id: `wb-created-${state.clock}`,
        name,
        createdAt: timestamp,
        updatedAt: timestamp,
        activeWorksheetId: `ws-created-${state.clock}`,
        canUndo: false,
        canRedo: false,
        worksheets: [{
          id: `ws-created-${state.clock}`,
          name: "Sheet1",
          rowCount: 30,
          columnCount: 26,
          cells: {},
          selection: { anchor: "A1", focus: "A1" },
          validations: [],
          filters: [],
          pivot: null,
        }],
      };
      state.workbooks.push(workbook);
      return jsonResponse(201, { workbook: respond(state, workbook) });
    }

    const importMatch = url.pathname === "/api/workbooks/import" && method === "POST";
    if (importMatch) {
      let rows: string[][];
      try {
        rows = parseCsvRows(String(body.content ?? ""));
      } catch {
        return jsonResponse(400, { error: INVALID_CSV_MESSAGE });
      }
      const name = String(body.fileName ?? "").split(/[\\/]/).pop()!.replace(/\.csv$/i, "").trim()
        || "Imported workbook";
      const timestamp = nextTimestamp();
      const cells: Record<string, string> = {};
      let maxRow = -1;
      let maxColumn = -1;
      rows.forEach((row, rowIndex) => {
        row.forEach((value, columnIndex) => {
          if (!value) return;
          cells[cellCoordinate(rowIndex, columnIndex)] = value;
          maxRow = Math.max(maxRow, rowIndex);
          maxColumn = Math.max(maxColumn, columnIndex);
        });
      });
      const workbook: Workbook = {
        id: `wb-imported-${state.clock}`,
        name,
        createdAt: timestamp,
        updatedAt: timestamp,
        activeWorksheetId: `ws-imported-${state.clock}`,
        canUndo: false,
        canRedo: false,
        worksheets: [{
          id: `ws-imported-${state.clock}`,
          name: "Sheet1",
          rowCount: Math.max(30, maxRow + 1),
          columnCount: Math.max(26, maxColumn + 1),
          cells,
          selection: { anchor: "A1", focus: "A1" },
          validations: [],
          filters: [],
          pivot: null,
        }],
      };
      state.workbooks.push(workbook);
      return jsonResponse(201, { workbook: respond(state, workbook) });
    }

    const transferMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/range-transfer$/.exec(url.pathname);
    if (transferMatch && method === "POST") {
      const workbook = requireWorkbook(state, decodeURIComponent(transferMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((sheet) => sheet.id === decodeURIComponent(transferMatch[2]));
      if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
      if (!["copy", "cut"].includes(String(body.mode ?? ""))) {
        return jsonResponse(400, { error: "Unsupported range operation" });
      }
      const source = body.source as CellRange | undefined;
      const target = body.target as CellRange | undefined;
      if (!isCellCoordinate(source?.start ?? "") || !isCellCoordinate(source?.end ?? "")
        || !isCellCoordinate(target?.start ?? "") || !isCellCoordinate(target?.end ?? "")) {
        return jsonResponse(400, { error: "Invalid range" });
      }
      const writes = transferWrites(worksheet as FakeWorksheet, { source: source!, target: target! });
      const refusal = validationRefusal(worksheet as FakeWorksheet, writes);
      if (refusal) return jsonResponse(400, { error: refusal });
      recordHistory(state, workbook);
      transferRectangle(worksheet as FakeWorksheet, { source: source!, target: target!, mode: body.mode });
      workbook.updatedAt = nextTimestamp();
      return jsonResponse(200, { workbook: respond(state, workbook) });
    }

    const sortMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/sort-range$/.exec(url.pathname);
    if (sortMatch && method === "POST") {
      const workbook = requireWorkbook(state, decodeURIComponent(sortMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((sheet) => sheet.id === decodeURIComponent(sortMatch[2]));
      if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
      const range = body.range as CellRange | undefined;
      if (!isCellCoordinate(range?.start ?? "") || !isCellCoordinate(range?.end ?? "")) {
        return jsonResponse(400, { error: "Invalid range" });
      }
      if (!["ascending", "descending"].includes(String(body.order ?? ""))) {
        return jsonResponse(400, { error: "Unsupported sort order" });
      }
      const bounds = rectangleBounds(range!);
      const index = typeof body.column === "string" && /^[A-Z]+$/.test(body.column)
        ? columnIndex(body.column)
        : -1;
      if (index < bounds.minColumn || index > bounds.maxColumn) {
        return jsonResponse(400, { error: "Invalid sort column" });
      }
      recordHistory(state, workbook);
      sortRectangle(worksheet as FakeWorksheet, {
        range: range!,
        column: body.column,
        order: body.order,
        hasHeaderRow: body.hasHeaderRow === true,
      });
      workbook.updatedAt = nextTimestamp();
      return jsonResponse(200, { workbook: respond(state, workbook) });
    }

    const historyMatch = /^\/api\/workbooks\/([^/]+)\/(undo|redo)$/.exec(url.pathname);
    if (historyMatch && method === "POST") {
      const workbook = requireWorkbook(state, decodeURIComponent(historyMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const entry = historyOf(state, workbook.id);
      const stack = historyMatch[2] === "undo" ? entry.past : entry.future;
      const snapshot = stack[stack.length - 1];
      if (!snapshot) {
        return jsonResponse(400, { error: historyMatch[2] === "undo" ? "Nothing to undo" : "Nothing to redo" });
      }
      stack.pop();
      const previous = restoreSnapshot(state, workbook.id, snapshot)!;
      (historyMatch[2] === "undo" ? entry.future : entry.past).push(previous);
      return jsonResponse(200, { workbook: respond(state, state.workbooks.find((w) => w.id === workbook.id)!) });
    }

    const structureMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/(rows|columns)$/.exec(url.pathname);
    if (structureMatch && method === "POST") {
      const workbook = requireWorkbook(state, decodeURIComponent(structureMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((sheet) => sheet.id === decodeURIComponent(structureMatch[2]));
      if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
      const target = structureMatch[3];
      const action = String(body.action ?? "");
      if (target === "rows") {
        if (!["insert-above", "insert-below", "delete"].includes(action)) {
          return jsonResponse(400, { error: "Unsupported structure operation" });
        }
        if (!Number.isInteger(body.row) || body.row < 1 || body.row > worksheet.rowCount) {
          return jsonResponse(400, { error: "Invalid row number" });
        }
        const index = body.row - 1;
        recordHistory(state, workbook);
        moveWorksheet(worksheet as FakeWorksheet, action === "delete"
          ? { axis: "row", kind: "delete", index }
          : { axis: "row", kind: "insert", index: action === "insert-above" ? index : index + 1 });
      } else {
        if (!["insert-left", "insert-right", "delete"].includes(action)) {
          return jsonResponse(400, { error: "Unsupported structure operation" });
        }
        const index = typeof body.column === "string" && /^[A-Z]+$/.test(body.column) ? columnIndex(body.column) : -1;
        if (index < 0 || index >= worksheet.columnCount) {
          return jsonResponse(400, { error: "Invalid column" });
        }
        recordHistory(state, workbook);
        moveWorksheet(worksheet as FakeWorksheet, action === "delete"
          ? { axis: "column", kind: "delete", index }
          : { axis: "column", kind: "insert", index: action === "insert-left" ? index : index + 1 });
      }
      workbook.updatedAt = nextTimestamp();
      return jsonResponse(200, { workbook: respond(state, workbook) });
    }

    const pasteMatch = /^\/api\/workbooks\/([^/]+)\/paste$/.exec(url.pathname);
    if (pasteMatch && method === "PUT") {
      const workbook = requireWorkbook(state, decodeURIComponent(pasteMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((sheet) => sheet.id === body.worksheetId);
      if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
      const start = String(body.start ?? "");
      if (!isCellCoordinate(start)) return jsonResponse(400, { error: "Invalid cell coordinate" });
      const rows = parsePastedText(String(body.text ?? ""));
      if (!rows.length) return jsonResponse(400, { error: "Nothing to paste" });
      const updates = pastedRectangle(rows, start);
      const refusal = validationRefusal(worksheet as FakeWorksheet, updates);
      if (refusal) return jsonResponse(400, { error: refusal });
      recordHistory(state, workbook);
      const { row, column } = parseCellCoordinate(start)!;
      for (const update of updates) {
        if (update.value === "") delete worksheet.cells[update.coordinate];
        else worksheet.cells[update.coordinate] = update.value;
      }
      worksheet.rowCount = Math.max(worksheet.rowCount, row + rows.length);
      worksheet.columnCount = Math.max(
        worksheet.columnCount,
        column + rows.reduce((max, fields) => Math.max(max, fields.length), 0),
      );
      workbook.updatedAt = nextTimestamp();
      return jsonResponse(200, { workbook: respond(state, workbook) });
    }

    const cellsMatch = /^\/api\/workbooks\/([^/]+)\/cells$/.exec(url.pathname);
    if (cellsMatch && method === "PUT") {
      const workbook = requireWorkbook(state, decodeURIComponent(cellsMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = activeWorksheetOf(workbook, body.worksheetId) as FakeWorksheet;
      const value = body.value === null || body.value === undefined ? "" : String(body.value);
      if (isCellCoordinate(String(body.cell ?? ""))) {
        const refusal = validationRefusal(worksheet, [{ coordinate: body.cell, value }]);
        if (refusal) return jsonResponse(400, { error: refusal });
      }
      recordHistory(state, workbook);
      if (value === "") delete worksheet.cells[body.cell];
      else worksheet.cells[body.cell] = value;
      workbook.updatedAt = nextTimestamp();
      return jsonResponse(200, { workbook: respond(state, workbook) });
    }

    const pivotMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/pivot$/.exec(url.pathname);
    if (pivotMatch && (method === "POST" || method === "PUT")) {
      const workbook = requireWorkbook(state, decodeURIComponent(pivotMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((sheet) => sheet.id === decodeURIComponent(pivotMatch[2]));
      if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });

      if (method === "POST") {
        const range = body.range as CellRange | undefined;
        if (!isCellCoordinate(range?.start ?? "") || !isCellCoordinate(range?.end ?? "")) {
          return jsonResponse(400, { error: "Invalid range" });
        }
        const fields = pivotFields(worksheet.cells, range!);
        if (!fields.length) return jsonResponse(400, { error: PIVOT_RANGE_MESSAGE });
        const bounds = rectangleBounds(range!);
        const numericField = fields.slice(1).find((field) => {
          const column = pivotColumnOf(worksheet.cells, bounds, field);
          for (let row = bounds.minRow + 1; row <= bounds.maxRow; row += 1) {
            if (pivotNumber(worksheet.cells[cellCoordinate(row, column)] ?? "") !== null) return true;
          }
          return false;
        });
        const settings = numericField
          ? { rows: fields[0], values: numericField, summarizeBy: "SUM" as SummarizeMethod }
          : { rows: fields[0], values: fields[1] ?? fields[0], summarizeBy: "COUNT" as SummarizeMethod };
        const computed = pivotResult(worksheet.cells, range!, { ...settings, columns: null });
        if ("error" in computed) return jsonResponse(400, { error: computed.error });
        recordHistory(state, workbook);
        const pivot: PivotConfig = {
          source: { worksheetId: worksheet.id, range: range! },
          rows: settings.rows,
          columns: null,
          values: settings.values,
          summarizeBy: settings.summarizeBy,
        };
        const created: FakeWorksheet = {
          id: `ws-pivot-${state.clock + 1}`,
          name: nextPivotName(workbook),
          rowCount: 30,
          columnCount: 26,
          cells: computed.cells,
          selection: { anchor: "A1", focus: "A1" },
          validations: [],
          filters: [],
          pivot,
        };
        workbook.worksheets.push(created);
        workbook.activeWorksheetId = created.id;
        workbook.updatedAt = nextTimestamp();
        return jsonResponse(201, { workbook: respond(state, workbook) });
      }

      if (!worksheet.pivot) return jsonResponse(404, { error: "Pivot table not found" });
      const source = workbook.worksheets.find((sheet) => sheet.id === worksheet.pivot?.source.worksheetId);
      if (!source) return jsonResponse(404, { error: "Worksheet not found" });
      const settings = {
        rows: "rows" in body ? body.rows : worksheet.pivot.rows,
        columns: "columns" in body ? body.columns : worksheet.pivot.columns,
        values: "values" in body ? body.values : worksheet.pivot.values,
        summarizeBy: "summarizeBy" in body ? body.summarizeBy : worksheet.pivot.summarizeBy,
      };
      const computed = pivotResult(source.cells, worksheet.pivot.source.range, settings);
      if ("error" in computed) return jsonResponse(400, { error: computed.error });
      recordHistory(state, workbook);
      worksheet.pivot = {
        source: { ...worksheet.pivot.source },
        rows: typeof settings.rows === "string" && settings.rows !== "" ? settings.rows : null,
        columns: typeof settings.columns === "string" && settings.columns !== "" ? settings.columns : null,
        values: typeof settings.values === "string" && settings.values !== "" ? settings.values : null,
        summarizeBy: SUMMARIZE_METHOD_NAMES.includes(settings.summarizeBy as SummarizeMethod)
          ? settings.summarizeBy as SummarizeMethod
          : "SUM",
      };
      worksheet.cells = computed.cells;
      workbook.updatedAt = nextTimestamp();
      return jsonResponse(200, { workbook: respond(state, workbook) });
    }

    const pivotRefreshMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/pivot\/refresh$/.exec(url.pathname);
    if (pivotRefreshMatch && method === "POST") {
      const workbook = requireWorkbook(state, decodeURIComponent(pivotRefreshMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((sheet) => sheet.id === decodeURIComponent(pivotRefreshMatch[2]));
      if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
      if (!worksheet.pivot) return jsonResponse(404, { error: "Pivot table not found" });
      const source = workbook.worksheets.find((sheet) => sheet.id === worksheet.pivot?.source.worksheetId);
      if (!source) return jsonResponse(404, { error: "Worksheet not found" });
      const computed = pivotResult(source.cells, worksheet.pivot.source.range, worksheet.pivot);
      if ("error" in computed) return jsonResponse(400, { error: computed.error });
      recordHistory(state, workbook);
      worksheet.cells = computed.cells;
      workbook.updatedAt = nextTimestamp();
      return jsonResponse(200, { workbook: respond(state, workbook) });
    }

    const filterMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/filters$/.exec(url.pathname);
    if (filterMatch && (method === "POST" || method === "DELETE")) {
      const workbook = requireWorkbook(state, decodeURIComponent(filterMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((sheet) => sheet.id === decodeURIComponent(filterMatch[2]));
      if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
      if (method === "DELETE") {
        recordHistory(state, workbook);
        worksheet.filters = [];
      } else {
        const range = body.range as CellRange | undefined;
        if (!isCellCoordinate(range?.start ?? "") || !isCellCoordinate(range?.end ?? "")) {
          return jsonResponse(400, { error: "Invalid range" });
        }
        recordHistory(state, workbook);
        worksheet.filters = [{ id: `filter-${state.clock + 1}`, range: range!, conditions: [] }];
      }
      workbook.updatedAt = nextTimestamp();
      return jsonResponse(200, { workbook: respond(state, workbook) });
    }

    const columnFilterMatch =
      /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/filters\/([^/]+)\/columns\/([^/]+)$/
        .exec(url.pathname);
    if (columnFilterMatch && method === "PUT") {
      const workbook = requireWorkbook(state, decodeURIComponent(columnFilterMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((sheet) => sheet.id === decodeURIComponent(columnFilterMatch[2]));
      if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
      const filter = worksheet.filters.find((record) => record.id === decodeURIComponent(columnFilterMatch[3]))
        ?? worksheet.filters[0];
      if (!filter) return jsonResponse(404, { error: "Filter not found" });
      const column = decodeURIComponent(columnFilterMatch[4]).toUpperCase();
      const condition = body.condition as FilterView["conditions"][number] | null | undefined;
      recordHistory(state, workbook);
      const others = filter.conditions.filter((entry) => entry.column !== column);
      filter.conditions = condition ? [...others, { ...condition, column }] : others;
      workbook.updatedAt = nextTimestamp();
      return jsonResponse(200, { workbook: respond(state, workbook) });
    }

    const validationsMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/validations$/.exec(url.pathname);
    if (validationsMatch && method === "POST") {
      const workbook = requireWorkbook(state, decodeURIComponent(validationsMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((sheet) => sheet.id === decodeURIComponent(validationsMatch[2]));
      if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
      const range = body.range as CellRange | undefined;
      if (!isCellCoordinate(range?.start ?? "") || !isCellCoordinate(range?.end ?? "")) {
        return jsonResponse(400, { error: "Invalid range" });
      }
      let record: ValidationRule;
      if (body.type === "dropdown") {
        const values = parseAllowedValueList(String(body.values ?? "").split(","));
        if (!values.length) return jsonResponse(400, { error: "Allowed values cannot be empty" });
        record = { id: `dv-${state.clock + 1}`, type: "dropdown", range: range!, values };
      } else if (body.type === "number-range") {
        const min = Number(String(body.min ?? "").trim());
        const max = Number(String(body.max ?? "").trim());
        if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
          return jsonResponse(400, { error: "Enter a valid number range" });
        }
        record = {
          id: `dv-${state.clock + 1}`,
          type: "number-range",
          range: range!,
          min,
          max,
          message: min === 0 && max === 100
            ? "Please enter a number from 0 to 100"
            : `Please enter a number between ${min} and ${max}`,
        };
      } else {
        return jsonResponse(400, { error: "Invalid validation rule" });
      }
      recordHistory(state, workbook);
      const index = body.ruleId ? worksheet.validations.findIndex((rule) => rule.id === body.ruleId) : -1;
      if (index >= 0) worksheet.validations[index] = { ...record, id: worksheet.validations[index].id };
      else worksheet.validations.push(record);
      workbook.updatedAt = nextTimestamp();
      return jsonResponse(200, { workbook: respond(state, workbook) });
    }

    const ruleMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/validations\/([^/]+)$/.exec(url.pathname);
    if (ruleMatch && method === "DELETE") {
      const workbook = requireWorkbook(state, decodeURIComponent(ruleMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((sheet) => sheet.id === decodeURIComponent(ruleMatch[2]));
      if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
      const index = worksheet.validations.findIndex((rule) => rule.id === decodeURIComponent(ruleMatch[3]));
      if (index < 0) return jsonResponse(404, { error: "Validation rule not found" });
      recordHistory(state, workbook);
      worksheet.validations.splice(index, 1);
      workbook.updatedAt = nextTimestamp();
      return jsonResponse(200, { workbook: respond(state, workbook) });
    }

    const activeMatch = /^\/api\/workbooks\/([^/]+)\/active-worksheet$/.exec(url.pathname);
    if (activeMatch && method === "PUT") {
      const workbook = requireWorkbook(state, decodeURIComponent(activeMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((sheet) => sheet.id === body.worksheetId);
      if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
      workbook.activeWorksheetId = worksheet.id;
      return jsonResponse(200, { workbook: respond(state, workbook) });
    }

    const selectionMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/selection$/.exec(url.pathname);
    if (selectionMatch && method === "PUT") {
      const workbook = requireWorkbook(state, decodeURIComponent(selectionMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((sheet) => sheet.id === decodeURIComponent(selectionMatch[2]));
      if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
      worksheet.selection = { anchor: body.anchor, focus: body.focus ?? body.anchor };
      return jsonResponse(200, { worksheetId: worksheet.id, selection: worksheet.selection });
    }

    const worksheetsMatch = /^\/api\/workbooks\/([^/]+)\/worksheets$/.exec(url.pathname);
    if (worksheetsMatch && method === "POST") {
      const workbook = requireWorkbook(state, decodeURIComponent(worksheetsMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const timestamp = nextTimestamp();
      const worksheet: FakeWorksheet = {
        id: `ws-added-${state.clock}`,
        name: nextWorksheetName(workbook),
        rowCount: 30,
        columnCount: 26,
        cells: {},
        selection: { anchor: "A1", focus: "A1" },
        validations: [],
        filters: [],
        pivot: null,
      };
      workbook.worksheets.push(worksheet);
      workbook.activeWorksheetId = worksheet.id;
      workbook.updatedAt = timestamp;
      return jsonResponse(201, { workbook: respond(state, workbook) });
    }

    const worksheetDeleteMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)$/.exec(url.pathname);
    if (worksheetDeleteMatch && method === "DELETE") {
      const workbook = requireWorkbook(state, decodeURIComponent(worksheetDeleteMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const index = workbook.worksheets.findIndex(
        (sheet) => sheet.id === decodeURIComponent(worksheetDeleteMatch[2]),
      );
      if (index < 0) return jsonResponse(404, { error: "Worksheet not found" });
      const worksheet = workbook.worksheets[index];
      if (workbook.worksheets.length <= 1) {
        return jsonResponse(400, { error: "A workbook must contain at least one worksheet" });
      }
      const dependent = workbook.worksheets.some(
        (sheet) => sheet.id !== worksheet.id && sheet.pivot?.source.worksheetId === worksheet.id,
      );
      if (dependent) {
        return jsonResponse(400, { error: "Please delete or rebuild dependent pivot tables first" });
      }
      workbook.worksheets.splice(index, 1);
      workbook.activeWorksheetId = (workbook.worksheets[index - 1] ?? workbook.worksheets[index]).id;
      workbook.updatedAt = nextTimestamp();
      return jsonResponse(200, { workbook: respond(state, workbook) });
    }

    const worksheetRenameMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)$/.exec(url.pathname);
    if (worksheetRenameMatch && method === "PATCH") {
      const workbook = requireWorkbook(state, decodeURIComponent(worksheetRenameMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((sheet) => sheet.id === decodeURIComponent(worksheetRenameMatch[2]));
      if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
      const name = String(body.name ?? "").trim();
      if (!name) return jsonResponse(400, { error: "Worksheet name cannot be empty" });
      if (workbook.worksheets.some((sheet) => sheet.id !== worksheet.id && sheet.name === name)) {
        return jsonResponse(400, { error: "Worksheet name already exists" });
      }
      worksheet.name = name;
      workbook.updatedAt = nextTimestamp();
      return jsonResponse(200, { workbook: respond(state, workbook) });
    }

    const workbookMatch = /^\/api\/workbooks\/([^/]+)$/.exec(url.pathname);
    if (workbookMatch) {
      const workbook = requireWorkbook(state, decodeURIComponent(workbookMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      if (method === "GET") return jsonResponse(200, { workbook: respond(state, workbook) });
      if (method === "PATCH") {
        const name = String(body.name ?? "").trim();
        if (!name) return jsonResponse(400, { error: "Workbook name cannot be empty" });
        workbook.name = name;
        workbook.updatedAt = nextTimestamp();
        return jsonResponse(200, { workbook: respond(state, workbook) });
      }
    }

    return jsonResponse(404, { error: "Not found" });
  };

  const install = () => {
    vi.stubGlobal("fetch", vi.fn(handler));
  };
  install();

  return {
    state,
    requests,
    install,
    failNextRequest(
      test: (method: string, path: string) => boolean,
      options: { status?: number; error?: string } = {},
    ) {
      pendingFailure = { test, status: options.status ?? 500, error: options.error ?? "Request failed" };
    },
  };
}

export function workbookFrom(state: { workbooks: Workbook[] }, id: string): Workbook {
  const workbook = state.workbooks.find((item) => item.id === id);
  if (!workbook) throw new Error(`Unknown workbook ${id}`);
  return workbook;
}
