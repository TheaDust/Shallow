import { randomUUID } from "node:crypto";

import { cellAddress, parseCellAddress } from "./coordinates.mjs";
import { filterHiddenRows } from "./filtering.mjs";
import { worksheetValues } from "./formula.mjs";

export const DEFAULT_WORKBOOK_NAME = "Untitled workbook";
export const DEFAULT_WORKSHEET_NAME = "Sheet1";
export const MAX_WORKBOOK_NAME_LENGTH = 200;
export const EMPTY_WORKBOOK_NAME_MESSAGE = "Workbook name cannot be empty";
export const LONG_WORKBOOK_NAME_MESSAGE = "Workbook name is too long";
export const EMPTY_WORKSHEET_NAME_MESSAGE = "Worksheet name cannot be empty";
export const WORKSHEET_NAME_EXISTS_MESSAGE = "Worksheet name already exists";

/**
 * Applies the workbook naming rule shared by every rename entry point: leading
 * and trailing spaces are trimmed and the trimmed name must not be empty.
 * Returns `{ ok: true, name }` or `{ ok: false, error }`.
 */
export function normalizeWorkbookName(value) {
  if (typeof value !== "string") {
    return { ok: false, error: EMPTY_WORKBOOK_NAME_MESSAGE };
  }
  const name = value.trim();
  if (name === "") return { ok: false, error: EMPTY_WORKBOOK_NAME_MESSAGE };
  if (name.length > MAX_WORKBOOK_NAME_LENGTH) return { ok: false, error: LONG_WORKBOOK_NAME_MESSAGE };
  return { ok: true, name };
}

/**
 * Applies the worksheet naming rule shared by every rename entry point: leading
 * and trailing spaces are trimmed and the trimmed name must not be empty.
 * Uniqueness inside one workbook is checked by `renameWorksheet`.
 */
export function normalizeWorksheetName(value) {
  if (typeof value !== "string") {
    return { ok: false, error: EMPTY_WORKSHEET_NAME_MESSAGE };
  }
  const name = value.trim();
  if (name === "") return { ok: false, error: EMPTY_WORKSHEET_NAME_MESSAGE };
  return { ok: true, name };
}

export function nowIso() {
  return new Date().toISOString();
}

export function createWorksheet({ id = `ws-${randomUUID()}`, name, cells = {}, validations = [], filter = null } = {}) {
  return {
    id,
    name,
    activeCell: "A1",
    selectionFocus: "A1",
    cells: { ...cells },
    validations: [...validations],
    filter: filter ?? null,
  };
}

export function createWorkbook({ name, worksheets, createdAt, updatedAt }) {
  const stamp = nowIso();
  const list = worksheets.length > 0 ? worksheets : [createWorksheet({ name: DEFAULT_WORKSHEET_NAME })];
  return {
    id: `wb-${randomUUID()}`,
    name,
    createdAt: createdAt ?? stamp,
    updatedAt: updatedAt ?? stamp,
    activeWorksheetId: list[0].id,
    worksheets: list,
  };
}

export function createBlankWorkbook(name) {
  return createWorkbook({ name, worksheets: [createWorksheet({ name: DEFAULT_WORKSHEET_NAME })] });
}

/** Builds a workbook from parsed CSV rows; the first row stays ordinary data. */
export function createWorkbookFromRows(name, rows) {
  const cells = {};
  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (typeof value === "string" && value !== "") {
        cells[cellAddress(columnIndex + 1, rowIndex + 1)] = value;
      }
    });
  });
  return createWorkbook({ name, worksheets: [createWorksheet({ name: DEFAULT_WORKSHEET_NAME, cells })] });
}

export function workbookNameFromFileName(fileName) {
  const raw = typeof fileName === "string" ? fileName.trim() : "";
  const base = raw.split(/[\\/]/).pop() ?? "";
  const trimmed = base.replace(/\.csv$/i, "").trim();
  return trimmed === "" ? DEFAULT_WORKBOOK_NAME : trimmed;
}

/** First unused `SheetN` name of the workbook, in positive-integer order. */
export function nextWorksheetName(workbook) {
  const taken = new Set(workbook.worksheets.map((sheet) => sheet.name));
  for (let index = 1; ; index += 1) {
    const candidate = `Sheet${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Appends a blank worksheet to a workbook draft and makes it the active one.
 * The new worksheet starts with `A1` selected and inherits nothing (no cells,
 * filters, validation or pivot state) from the other worksheets.
 */
export function addWorksheet(workbook) {
  const worksheet = createWorksheet({ name: nextWorksheetName(workbook) });
  workbook.worksheets.push(worksheet);
  workbook.activeWorksheetId = worksheet.id;
  return worksheet;
}

/**
 * Renames one worksheet of a workbook draft. Returns `{ ok: true, name }` after
 * mutating, or `{ ok: false, error }` without touching anything when the
 * trimmed name is empty or already used by another worksheet of the workbook.
 */
export function renameWorksheet(workbook, worksheet, value) {
  const normalized = normalizeWorksheetName(value);
  if (!normalized.ok) return normalized;
  const duplicate = workbook.worksheets.some(
    (sheet) => sheet.id !== worksheet.id && sheet.name === normalized.name,
  );
  if (duplicate) return { ok: false, error: WORKSHEET_NAME_EXISTS_MESSAGE };
  worksheet.name = normalized.name;
  return { ok: true, name: normalized.name };
}

export function toWorkbookSummary(workbook) {
  return {
    id: workbook.id,
    name: workbook.name,
    createdAt: workbook.createdAt,
    updatedAt: workbook.updatedAt,
  };
}

/**
 * API payload of one worksheet: the stored fields plus the derived display
 * `values`, so the grid renders formula results from the same authoritative
 * state the raw `cells` hold.
 */
export function toWorksheetPayload(worksheet) {
  const values = worksheetValues(worksheet);
  const filter = worksheet.filter ?? null;
  return {
    id: worksheet.id,
    name: worksheet.name,
    activeCell: worksheet.activeCell ?? "A1",
    selectionFocus: worksheet.selectionFocus ?? worksheet.activeCell ?? "A1",
    cells: { ...worksheet.cells },
    validations: Array.isArray(worksheet.validations) ? worksheet.validations : [],
    filter,
    hiddenRows: filterHiddenRows(filter, values, worksheet.cells),
    values,
  };
}

/**
 * API payload of a workbook: every worksheet carries its stored state and
 * derived values, plus the undo/redo availability of the current session (the
 * history itself is process memory, so this is what lets the toolbar disable
 * "Undo"/"Redo" while a branch is exhausted).
 */
export function toWorkbookPayload(workbook, capabilities = {}) {
  return {
    ...workbook,
    canUndo: Boolean(capabilities.canUndo),
    canRedo: Boolean(capabilities.canRedo),
    worksheets: workbook.worksheets.map(toWorksheetPayload),
  };
}

export function findWorkbook(state, workbookId) {
  return state.workbooks.find((workbook) => workbook.id === workbookId) ?? null;
}

/**
 * Bounding box of the non-empty cells of a worksheet, or null when the
 * worksheet is still empty. Row and column order stays the grid's own order.
 */
export function worksheetUsedRange(worksheet) {
  let rowCount = 0;
  let columnCount = 0;
  for (const [address, raw] of Object.entries(worksheet.cells)) {
    if (typeof raw !== "string" || raw === "") continue;
    const coordinate = parseCellAddress(address);
    if (!coordinate) continue;
    rowCount = Math.max(rowCount, coordinate.row);
    columnCount = Math.max(columnCount, coordinate.column);
  }
  return rowCount === 0 || columnCount === 0 ? null : { rowCount, columnCount };
}

/**
 * Grid cells of the used range as a rectangular string matrix. Cells inside the
 * range that were never filled stay empty strings. Cell text is the displayed
 * value, so a formula cell exports its calculated result instead of the
 * expression.
 */
export function worksheetToRows(worksheet) {
  const range = worksheetUsedRange(worksheet);
  if (!range) return [];
  const values = worksheetValues(worksheet);
  const rows = [];
  for (let row = 1; row <= range.rowCount; row += 1) {
    const fields = [];
    for (let column = 1; column <= range.columnCount; column += 1) {
      const raw = values[cellAddress(column, row)];
      fields.push(typeof raw === "string" ? raw : "");
    }
    rows.push(fields);
  }
  return rows;
}

/** Suggested download name for a worksheet export, always ending in `.csv`. */
export function csvFileName(workbookName, worksheetName) {
  const clean = (value) =>
    String(value ?? "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/[\u0000-\u001f\u007f]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
  const base = clean(workbookName) || "workbook";
  const sheet = clean(worksheetName) || DEFAULT_WORKSHEET_NAME;
  return `${base} - ${sheet}.csv`;
}

/**
 * Shared evaluation seed. Compatible pre-existing entities are all seeded:
 * workbook "Q3 Sales" with worksheets "Sheet1"/"Sheet2" and the data region
 * `A1:C6` whose headers are Region/Sales/Status and whose records are
 * East/1200/Open, North/800/Closed and South/700/Open.
 */
export function createSeedState() {
  return {
    workbooks: [
      {
        id: "wb-q3-sales",
        name: "Q3 Sales",
        createdAt: "2026-09-10T08:00:00.000Z",
        updatedAt: "2026-09-15T08:30:00.000Z",
        activeWorksheetId: "ws-q3-sheet1",
        worksheets: [
          {
            id: "ws-q3-sheet1",
            name: "Sheet1",
            activeCell: "A1",
            selectionFocus: "A1",
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
            validations: [],
            filter: null,
          },
          {
            id: "ws-q3-sheet2",
            name: "Sheet2",
            activeCell: "A1",
            selectionFocus: "A1",
            cells: {},
            validations: [],
            filter: null,
          },
        ],
      },
    ],
  };
}
