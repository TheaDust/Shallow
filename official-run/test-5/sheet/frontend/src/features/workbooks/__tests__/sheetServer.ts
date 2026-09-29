/**
 * In-memory stand-in of the worksheet API for the editor tests.
 *
 * It answers the same routes as `backend/src/api.mjs` for the flows these tests
 * cover (cell writes, range transfers, row operations, row filters, validation
 * rules and undo/redo), so the components are exercised through the real
 * request/answer cycle. Only plain values are placed in the grid: the formula
 * engine is covered by the backend tests.
 */

import { stubFetch, type StubHandler, type StubRequest, type StubResult } from "./helpers";
import type { WorkbookData, WorksheetData } from "../types";

interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function parseAddress(value: unknown): { column: number; row: number } | null {
  const match = /^([A-Za-z]+)([0-9]+)$/.exec(String(value ?? "").trim());
  if (!match) return null;
  let column = 0;
  for (const letter of match[1].toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64);
  const row = Number(match[2]);
  return Number.isInteger(row) && row > 0 ? { column, row } : null;
}

function label(column: number): string {
  let remaining = column;
  let text = "";
  while (remaining > 0) {
    text = String.fromCharCode(65 + ((remaining - 1) % 26)) + text;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return text;
}

function address(column: number, row: number): string {
  return `${label(column)}${row}`;
}

function displayValue(worksheet: WorksheetData, cell: string): string {
  return worksheet.values?.[cell] ?? worksheet.cells[cell] ?? "";
}

/** Matching of one filtered column, mirroring the backend domain module. */
function columnMatches(text: string, column: any): boolean {
  if (!column) return true;
  if (column.kind === "values") return (column.values ?? []).includes(text);
  const trimmed = text.trim();
  if (column.operator === "text-contains") {
    return text.toLowerCase().includes(String(column.value ?? "").toLowerCase());
  }
  if (column.operator === "greater-than") {
    const cell = trimmed === "" ? NaN : Number(trimmed);
    const bound = Number(String(column.value ?? "").trim());
    return Number.isFinite(cell) && Number.isFinite(bound) && cell > bound;
  }
  if (column.operator === "before") {
    const cell = trimmed === "" ? NaN : Date.parse(trimmed);
    const bound = Date.parse(String(column.value ?? "").trim());
    return Number.isFinite(cell) && Number.isFinite(bound) && cell < bound;
  }
  if (column.operator === "is-empty") return trimmed === "";
  if (column.operator === "is-not-empty") return trimmed !== "";
  return true;
}

/** Rows the worksheet's filter hides, derived like the server derives them. */
function hiddenRowsFor(worksheet: WorksheetData): number[] {
  const filter = worksheet.filter;
  if (!filter) return [];
  const start = parseAddress(filter.range.start);
  const end = parseAddress(filter.range.end);
  const columns = Object.entries(filter.columns ?? {});
  if (!start || !end || columns.length === 0) return [];
  const hidden: number[] = [];
  for (let row = start.row + 1; row <= end.row; row += 1) {
    const matches = columns.every(([key, column]) => {
      const coordinate = parseAddress(`${key}1`);
      if (!coordinate) return true;
      return columnMatches(displayValue(worksheet, address(coordinate.column, row)), column);
    });
    if (!matches) hidden.push(row);
  }
  return hidden;
}

/** First dropdown rule covering a coordinate, so a write can be checked. */
function dropdownRuleFor(worksheet: WorksheetData, cell: string): any {
  return ruleCovering(worksheet, cell, "dropdown");
}

/** First numeric range rule covering a coordinate, so a write can be checked. */
function numberRuleFor(worksheet: WorksheetData, cell: string): any {
  return ruleCovering(worksheet, cell, "number-between");
}

function ruleCovering(worksheet: WorksheetData, cell: string, type: string): any {
  const coordinate = parseAddress(cell);
  if (!coordinate) return null;
  return (worksheet.validations ?? []).find((rule: any) => {
    if (rule.type !== type) return false;
    const start = parseAddress(rule.range?.start ?? "");
    const end = parseAddress(rule.range?.end ?? "");
    if (!start || !end) return false;
    return (
      coordinate.column >= Math.min(start.column, end.column)
      && coordinate.column <= Math.max(start.column, end.column)
      && coordinate.row >= Math.min(start.row, end.row)
      && coordinate.row <= Math.max(start.row, end.row)
    );
  }) ?? null;
}

/** Message the server would answer with for one rejected cell write, or null. */
function validationError(worksheet: WorksheetData, cell: string, value: string): string | null {
  const text = String(value ?? "").trim();
  if (text === "") return null;
  const dropdown = dropdownRuleFor(worksheet, cell);
  if (dropdown && !(dropdown.values ?? []).includes(text)) {
    return dropdown.message
      ?? `Please select one of the following values: ${(dropdown.values ?? []).join(", ")}`;
  }
  const numeric = numberRuleFor(worksheet, cell);
  if (numeric) {
    const number = Number(text);
    if (!Number.isFinite(number) || number < numeric.min || number > numeric.max) {
      return numeric.message ?? `Please enter a number from ${numeric.min} to ${numeric.max}`;
    }
  }
  return null;
}

function rangeValue(value: unknown): { start: string; end: string } | null {
  if (typeof value === "string") return { start: value, end: value };
  if (value && typeof value === "object") {
    const range = value as { start?: string; end?: string };
    if (typeof range.start !== "string") return null;
    return { start: range.start, end: typeof range.end === "string" ? range.end : range.start };
  }
  return null;
}

function boundsOf(value: unknown): Bounds | null {
  const range = rangeValue(value);
  if (!range) return null;
  const first = parseAddress(range.start);
  const second = parseAddress(range.end);
  if (!first || !second) return null;
  return {
    left: Math.min(first.column, second.column),
    right: Math.max(first.column, second.column),
    top: Math.min(first.row, second.row),
    bottom: Math.max(first.row, second.row),
  };
}

export interface SheetServer {
  /** Workbook the server currently stores, without the session flags. */
  current(): WorkbookData;
  /** Sheet1 of `current()`. */
  sheet(): WorksheetData;
  /** Every request the editor made. */
  calls: StubRequest[];
}

/** Options of the fake server, used to simulate a rejected operation. */
export interface SheetServerOptions {
  /** Error the next range transfer answers with, instead of applying it. */
  transferError?: { status: number; error: string };
}

/** Installs the fake worksheet server for one workbook. */
export function stubSheetServer(seed: WorkbookData, options: SheetServerOptions = {}): SheetServer {
  const workbookId = seed.id;
  let current: WorkbookData = structuredClone(seed);
  const undo: WorkbookData[] = [];
  const redo: WorkbookData[] = [];

  const activeSheet = (): WorksheetData =>
    current.worksheets.find((sheet) => sheet.id === current.activeWorksheetId)!;

  /** Worksheet a route addresses (`/worksheets/<id>/...`). */
  function sheetFromPath(path: string): WorksheetData {
    const [, , , , worksheetId] = path.split("/");
    return current.worksheets.find((sheet) => sheet.id === worksheetId) ?? activeSheet();
  }

  function replaceSheet(worksheetId: string, cells: Record<string, string>): void {
    current = {
      ...current,
      worksheets: current.worksheets.map((sheet) =>
        sheet.id === worksheetId ? { ...sheet, cells: { ...cells }, values: { ...cells } } : sheet),
    };
  }

  function respond(status = 200): StubResult {
    return {
      status,
      body: {
        workbook: {
          ...structuredClone(current),
          canUndo: undo.length > 0,
          canRedo: redo.length > 0,
          worksheets: current.worksheets.map((sheet) => ({
            ...structuredClone(sheet),
            hiddenRows: hiddenRowsFor(sheet),
          })),
        },
      },
    };
  }

  function record(): void {
    undo.push(structuredClone(current));
    redo.length = 0;
  }

  const handler: StubHandler = (request) => {
    const { method, path } = request;

    if (method === "GET" && path === `/api/workbooks/${workbookId}`) return respond();

    if (method === "PATCH" && path === `/api/workbooks/${workbookId}`) {
      const activeWorksheetId = request.body?.activeWorksheetId;
      if (typeof activeWorksheetId === "string") current = { ...current, activeWorksheetId };
      return respond();
    }

    if (method === "PATCH" && path.includes("/worksheets/")) {
      const worksheetId = path.split("/").pop();
      const patch = request.body ?? {};
      current = {
        ...current,
        worksheets: current.worksheets.map((sheet) => (sheet.id === worksheetId
          ? {
            ...sheet,
            ...(typeof patch.activeCell === "string"
              ? { activeCell: patch.activeCell, selectionFocus: patch.selectionFocus ?? patch.activeCell }
              : {}),
            ...(typeof patch.name === "string" ? { name: patch.name } : {}),
            ...(Array.isArray(patch.validations) ? { validations: patch.validations } : {}),
            ...("filter" in patch ? { filter: patch.filter } : {}),
          }
          : sheet)),
      };
      return respond();
    }

    if (method === "POST" && path.endsWith("/cells")) {
      const worksheet = sheetFromPath(path);
      const updates: Record<string, string> = request.body?.updates ?? {};
      for (const [cell, value] of Object.entries(updates)) {
        const error = validationError(worksheet, cell, value);
        if (error) return { status: 400, body: { error } };
      }
      record();
      replaceSheet(worksheet.id, { ...worksheet.cells, ...updates });
      return respond();
    }

    if (method === "POST" && path.endsWith("/range-transfer")) {
      const worksheet = sheetFromPath(path);
      const source = boundsOf(request.body?.source);
      const target = boundsOf(request.body?.target);
      if (!source || !target) return { status: 400, body: { error: "Invalid range" } };
      if (options.transferError) {
        return { status: options.transferError.status, body: { error: options.transferError.error } };
      }
      const updates: Record<string, string> = {};
      for (let row = source.top; row <= source.bottom; row += 1) {
        for (let column = source.left; column <= source.right; column += 1) {
          const text = worksheet.cells[address(column, row)] ?? "";
          updates[address(target.left + column - source.left, target.top + row - source.top)] = text;
        }
      }
      if (request.body?.mode === "cut") {
        for (let row = source.top; row <= source.bottom; row += 1) {
          for (let column = source.left; column <= source.right; column += 1) {
            const from = address(column, row);
            if (!(from in updates)) updates[from] = "";
          }
        }
      }
      record();
      const next = { ...worksheet.cells };
      for (const [key, text] of Object.entries(updates)) {
        if (text === "") delete next[key];
        else next[key] = text;
      }
      replaceSheet(worksheet.id, next);
      return respond();
    }

    if (method === "POST" && path.endsWith("/rows")) {
      const worksheet = sheetFromPath(path);
      const index = Number(request.body?.row);
      const op = request.body?.op;
      const cells: Record<string, string> = {};
      for (const [key, text] of Object.entries(worksheet.cells)) {
        const parsed = parseAddress(key)!;
        let row = parsed.row;
        if (op === "delete-row" && row === index) continue;
        if (row > index || (row === index && op === "insert-row-above")) {
          row += op === "delete-row" ? -1 : 1;
        }
        if (row >= 1 && row <= 40) cells[address(parsed.column, row)] = text;
      }
      record();
      replaceSheet(worksheet.id, cells);
      return respond();
    }

    if (method === "POST" && path === `/api/workbooks/${workbookId}/undo`) {
      const previous = undo.pop();
      if (!previous) return { status: 400, body: { error: "Nothing to undo" } };
      redo.push(structuredClone(current));
      current = previous;
      return respond();
    }

    if (method === "POST" && path === `/api/workbooks/${workbookId}/redo`) {
      const next = redo.pop();
      if (!next) return { status: 400, body: { error: "Nothing to redo" } };
      undo.push(structuredClone(current));
      current = next;
      return respond();
    }

    return undefined;
  };

  const { calls } = stubFetch(handler);
  return {
    current: () => structuredClone(current),
    sheet: () => activeSheet(),
    calls,
  };
}
