import { randomUUID } from "node:crypto";

import { normalizeFilter } from "./filter.mjs";

/** Default grid dimensions for a worksheet that has no explicit structure. */
export const DEFAULT_ROW_COUNT = 50;
export const DEFAULT_COLUMN_COUNT = 26;

/** Fallback name used when a workbook is created without an explicit name. */
export const DEFAULT_WORKBOOK_NAME = "Untitled spreadsheet";

/** Validation message shared by the API and the editor for an empty workbook name. */
export const WORKBOOK_NAME_REQUIRED = "Workbook name cannot be empty";

/** Validation message shared by the API and the editor for an empty worksheet name. */
export const WORKSHEET_NAME_REQUIRED = "Worksheet name cannot be empty";

/** Validation message shared by the API and the editor for a duplicate worksheet name. */
export const WORKSHEET_NAME_DUPLICATE = "Worksheet name already exists";

/** Rejection shown when deleting would leave the workbook without any worksheet. */
export const WORKSHEET_LAST_REMAINING = "A workbook must contain at least one worksheet";

/** Rejection shown when the target worksheet still feeds a pivot table. */
export const WORKSHEET_PIVOT_SOURCE = "Please delete or rebuild dependent pivot tables first";

/** Converts a zero-based column index into its spreadsheet label (0 -> A, 26 -> AA). */
export function columnLabel(index) {
  let remaining = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (remaining % 26)) + label;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return label;
}

/** Converts a spreadsheet column label back into its zero-based index (A -> 0, AA -> 26). */
export function columnIndexFromLabel(label) {
  let index = 0;
  for (const character of label.toUpperCase()) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** Converts zero-based row/column indexes into an A1-style coordinate. */
export function cellCoordinate(row, col) {
  return `${columnLabel(col)}${row + 1}`;
}

/** Parses an A1-style coordinate into `{row, col}` (zero-based) or null. */
export function parseCoordinate(key) {
  const match = /^([A-Za-z]+)([0-9]+)$/.exec(key);
  if (!match) return null;
  return { row: Number(match[2]) - 1, col: columnIndexFromLabel(match[1]) };
}

/**
 * Trims a raw workbook name. Returns null when the trimmed value is empty so
 * callers can reject it at their own trust boundary.
 */
export function normalizeWorkbookName(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Trims a raw worksheet name. Returns null when the trimmed value is empty so
 * callers can reject it at their own trust boundary.
 */
export function normalizeWorksheetName(raw) {
  return normalizeWorkbookName(raw);
}

/**
 * True when another worksheet of the same workbook already uses `name`. The
 * worksheet identified by `exceptId` is ignored so a worksheet may keep or
 * re-save its own name.
 */
export function isWorksheetNameTaken(worksheets, name, exceptId) {
  return worksheets.some((entry) => entry.name === name && entry.id !== exceptId);
}

/**
 * First unused `SheetN` name in positive-integer order (Sheet1, Sheet2, ...),
 * skipping every name already present in the workbook.
 */
export function nextWorksheetName(worksheets) {
  const used = new Set(worksheets.map((entry) => entry.name));
  let index = 1;
  while (used.has(`Sheet${index}`)) index += 1;
  return `Sheet${index}`;
}

/**
 * First unused `PivotN` name in positive-integer order (Pivot1, Pivot2, ...),
 * skipping every name already present in the workbook.
 */
export function nextPivotName(worksheets) {
  const used = new Set(worksheets.map((entry) => entry.name));
  let index = 1;
  while (used.has(`Pivot${index}`)) index += 1;
  return `Pivot${index}`;
}

function defaultSelection() {
  return { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } };
}

/**
 * Coerces a possibly hand-written cell map into raw text keyed by A1
 * coordinate. Numbers and booleans become their text form so the grid and the
 * formula engine read the same type for every cell.
 */
function normalizeCells(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const cells = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string") cells[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") cells[key] = String(value);
    else cells[key] = JSON.stringify(value);
  }
  return cells;
}

/** Highest row and column count used by a cell map (0 when it holds no cell). */
export function occupiedBounds(cells) {
  let rows = 0;
  let columns = 0;
  for (const key of Object.keys(cells)) {
    const coordinate = parseCoordinate(key);
    if (!coordinate) continue;
    rows = Math.max(rows, coordinate.row + 1);
    columns = Math.max(columns, coordinate.col + 1);
  }
  return { rows, columns };
}

/**
 * Grid size for a worksheet: an explicit stored size is honoured (grown when
 * cells sit beyond it), a missing one falls back to the default grid.
 */
function gridSize(raw, occupied, fallback) {
  if (Number.isInteger(raw) && raw > 0) return Math.max(raw, occupied);
  return Math.max(occupied, fallback);
}

/** A coordinate pair clamped into the grid, or null when it is not a pair. */
function normalizePoint(raw, rowCount, columnCount) {
  if (raw === null || typeof raw !== "object") return null;
  if (!Number.isInteger(raw.row) || !Number.isInteger(raw.col)) return null;
  return {
    row: Math.min(Math.max(raw.row, 0), rowCount - 1),
    col: Math.min(Math.max(raw.col, 0), columnCount - 1),
  };
}

/**
 * Fills the fields a worksheet needs to render without discarding what the
 * stored (or pre-provisioned) object already provides: the grid grows to cover
 * every cell, a missing or out-of-range selection falls back to A1 and a
 * missing rule list becomes empty. Unknown fields are preserved.
 */
export function normalizeWorksheet(raw, fallbackId, fallbackName = "Sheet1") {
  const source = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const cells = normalizeCells(source.cells);
  const bounds = occupiedBounds(cells);
  const rowCount = gridSize(source.rowCount, bounds.rows, DEFAULT_ROW_COUNT);
  const columnCount = gridSize(source.columnCount, bounds.columns, DEFAULT_COLUMN_COUNT);
  const anchor = normalizePoint(source.selection?.anchor, rowCount, columnCount);
  const focus = normalizePoint(source.selection?.focus, rowCount, columnCount);
  return {
    ...source,
    id: typeof source.id === "string" && source.id !== "" ? source.id : fallbackId,
    name:
      typeof source.name === "string" && source.name.trim() !== "" ? source.name : fallbackName,
    rowCount,
    columnCount,
    cells,
    selection: anchor && focus ? { anchor, focus } : defaultSelection(),
    validations: Array.isArray(source.validations) ? source.validations : [],
    filter: normalizeFilter(source.filter, rowCount, columnCount),
  };
}

const PIVOT_SUMMARIZE_METHODS = ["SUM", "COUNT", "AVERAGE"];

/**
 * Fills the fields a stored pivot table needs to stay addressable: a source
 * range, the source/result worksheet ids and the field selections. Unknown
 * fields are preserved and a malformed entry is dropped.
 */
export function normalizePivotTable(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const range = raw.sourceRange;
  if (
    !range ||
    typeof range !== "object" ||
    !Number.isInteger(range.minRow) ||
    !Number.isInteger(range.maxRow) ||
    !Number.isInteger(range.minCol) ||
    !Number.isInteger(range.maxCol)
  ) {
    return null;
  }
  return {
    ...raw,
    id: typeof raw.id === "string" ? raw.id : "",
    sourceWorksheetId: typeof raw.sourceWorksheetId === "string" ? raw.sourceWorksheetId : "",
    sourceRange: {
      minRow: range.minRow,
      maxRow: range.maxRow,
      minCol: range.minCol,
      maxCol: range.maxCol,
    },
    rowField: typeof raw.rowField === "string" ? raw.rowField : "",
    columnField:
      typeof raw.columnField === "string" && raw.columnField !== "" ? raw.columnField : null,
    valueField: typeof raw.valueField === "string" ? raw.valueField : "",
    summarizeBy: PIVOT_SUMMARIZE_METHODS.includes(raw.summarizeBy) ? raw.summarizeBy : "SUM",
    resultWorksheetId: typeof raw.resultWorksheetId === "string" ? raw.resultWorksheetId : "",
  };
}

/**
 * Plans the deletion of one worksheet: the workbook keeps at least one
 * worksheet and a worksheet that still feeds a pivot table can only be deleted
 * once its dependent pivot tables are gone. Deleting a pivot *result*
 * worksheet drops the pivot table itself, so its source worksheet is no longer
 * constrained by it. Returns the remaining worksheets, pivots and the adjacent
 * worksheet (the previous tab, else the following one) that becomes active.
 */
export function removeWorksheet(workbook, worksheetId) {
  const index = workbook.worksheets.findIndex((entry) => entry.id === worksheetId);
  if (index < 0) return { ok: false, error: "Workbook not found" };
  if (workbook.worksheets.length <= 1) {
    return { ok: false, error: WORKSHEET_LAST_REMAINING };
  }
  const pivots = Array.isArray(workbook.pivots) ? workbook.pivots : [];
  if (pivots.some((pivot) => pivot.sourceWorksheetId === worksheetId)) {
    return { ok: false, error: WORKSHEET_PIVOT_SOURCE };
  }
  const worksheets = workbook.worksheets.filter((entry) => entry.id !== worksheetId);
  return {
    ok: true,
    worksheets,
    pivots: pivots.filter((pivot) => pivot.resultWorksheetId !== worksheetId),
    activeWorksheetId: worksheets[Math.max(0, index - 1)].id,
  };
}

/**
 * Fills the workbook fields the editor needs (an id to address it by, a name,
 * at least one worksheet and an existing active worksheet).
 */
export function normalizeWorkbook(raw, index = 0) {
  const source = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const id = typeof source.id === "string" && source.id !== "" ? source.id : `workbook-${index + 1}`;
  const stored = Array.isArray(source.worksheets) ? source.worksheets : [];
  const worksheets = (stored.length > 0 ? stored : [{}]).map((worksheet, worksheetIndex) =>
    normalizeWorksheet(worksheet, `${id}-sheet-${worksheetIndex + 1}`, `Sheet${worksheetIndex + 1}`),
  );
  const activeWorksheetId = worksheets.some((entry) => entry.id === source.activeWorksheetId)
    ? source.activeWorksheetId
    : worksheets[0].id;
  const pivots = (Array.isArray(source.pivots) ? source.pivots : [])
    .map(normalizePivotTable)
    .filter(Boolean);
  return {
    ...source,
    id,
    name:
      typeof source.name === "string" && source.name.trim() !== ""
        ? source.name
        : DEFAULT_WORKBOOK_NAME,
    activeWorksheetId,
    worksheets,
    pivots,
  };
}

/** Normalizes a whole stored state so every workbook can be opened directly. */
export function normalizeState(raw) {
  const source = raw !== null && typeof raw === "object" ? raw : {};
  const workbooks = Array.isArray(source.workbooks) ? source.workbooks : [];
  return { ...source, workbooks: workbooks.map((workbook, index) => normalizeWorkbook(workbook, index)) };
}

export function createWorksheet(name) {
  return {
    id: randomUUID(),
    name,
    rowCount: DEFAULT_ROW_COUNT,
    columnCount: DEFAULT_COLUMN_COUNT,
    cells: {},
    selection: defaultSelection(),
    validations: [],
    filter: null,
  };
}

export function createBlankWorkbook(name, now = new Date().toISOString()) {
  const worksheet = createWorksheet("Sheet1");
  return {
    id: randomUUID(),
    name: name ?? DEFAULT_WORKBOOK_NAME,
    createdAt: now,
    updatedAt: now,
    activeWorksheetId: worksheet.id,
    worksheets: [worksheet],
  };
}

/**
 * Derives a workbook name from an uploaded file name: the last path segment
 * with its final `.csv` extension removed (case-insensitive). Falls back to the
 * whole file name, then to the default name, when stripping leaves nothing.
 */
export function workbookNameFromFileName(fileName) {
  const raw = typeof fileName === "string" ? fileName.trim() : "";
  const base = raw.split(/[\\/]/).pop() ?? "";
  const withoutExtension = base.replace(/\.csv$/i, "");
  return (
    normalizeWorkbookName(withoutExtension) ??
    normalizeWorkbookName(base) ??
    DEFAULT_WORKBOOK_NAME
  );
}

/**
 * Builds a workbook from parsed CSV rows. Row and column order follow the
 * parsed data; empty fields stay empty (no cell entry). The grid keeps its
 * default size unless the imported data needs more rows or columns. The first
 * row is ordinary data and is never treated as a header.
 */
export function createWorkbookFromRows(name, rows, now = new Date().toISOString()) {
  const columnCount = Math.max(
    DEFAULT_COLUMN_COUNT,
    rows.reduce((max, row) => Math.max(max, row.length), 0),
  );
  const cells = {};
  rows.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      if (value !== "") cells[cellCoordinate(rowIndex, colIndex)] = value;
    });
  });
  const worksheet = {
    id: randomUUID(),
    name: "Sheet1",
    rowCount: Math.max(DEFAULT_ROW_COUNT, rows.length),
    columnCount,
    cells,
    selection: defaultSelection(),
    validations: [],
    filter: null,
  };
  return {
    id: randomUUID(),
    name: name ?? DEFAULT_WORKBOOK_NAME,
    createdAt: now,
    updatedAt: now,
    activeWorksheetId: worksheet.id,
    worksheets: [worksheet],
  };
}

/** Compact record shown in the workbook home page list. */
export function workbookSummary(workbook) {
  return { id: workbook.id, name: workbook.name, updatedAt: workbook.updatedAt };
}

/**
 * The shared seed state planted into empty storage: the `Q3 Sales` workbook
 * with `Sheet1` (the seeded Region/Sales/Status table) and a blank `Sheet2`,
 * so worksheet independence and lifecycle workflows have data to act on.
 */
export function seedState() {
  const sheet1 = {
    id: "workbook-q3-sales-sheet-1",
    name: "Sheet1",
    rowCount: DEFAULT_ROW_COUNT,
    columnCount: DEFAULT_COLUMN_COUNT,
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
    selection: defaultSelection(),
    validations: [],
    filter: null,
  };
  const sheet2 = {
    id: "workbook-q3-sales-sheet-2",
    name: "Sheet2",
    rowCount: DEFAULT_ROW_COUNT,
    columnCount: DEFAULT_COLUMN_COUNT,
    cells: {},
    selection: defaultSelection(),
    validations: [],
    filter: null,
  };
  return {
    workbooks: [
      {
        id: "workbook-q3-sales",
        name: "Q3 Sales",
        createdAt: "2024-07-01T09:00:00.000Z",
        updatedAt: "2024-07-01T09:00:00.000Z",
        activeWorksheetId: sheet1.id,
        worksheets: [sheet1, sheet2],
      },
    ],
  };
}
