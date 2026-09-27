import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseCsv, INVALID_CSV_MESSAGE } from "./csv.js";
import { cellCoordinate, columnLabel, columnNumber } from "./coords.js";
import { parsePasteText } from "./paste.js";
import { ROW_ACTIONS, shiftCells, shiftCoordinateRow, COLUMN_ACTIONS, shiftCellsColumn, shiftCoordinateColumn } from "./structure.js";
import { TRANSFER_OPERATIONS, normalizeRect, applyRangeTransfer } from "./transfer.js";

const BACKEND_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Directory used to persist application data (override with SHALLOW_DATA_DIR). */
export function dataDir() {
  return process.env.SHALLOW_DATA_DIR || path.join(BACKEND_DIR, "data");
}

export function dataFile() {
  return path.join(dataDir(), "workbooks.json");
}

/** Default name used for newly created blank workbooks. */
export const DEFAULT_WORKBOOK_NAME = "Untitled workbook";

/** Seed content produced only when the data store is empty. */
export function seedData() {
  const now = new Date().toISOString();
  return {
    version: 1,
    workbooks: [
      {
        id: "wb-q3-sales",
        name: "Q3 Sales",
        createdAt: now,
        updatedAt: now,
        activeSheetId: "sheet-1",
        sheets: [
          {
            id: "sheet-1",
            name: "Sheet1",
            activeCell: "A1",
            selection: { current: "A1", end: "A1" },
            cells: { A1: "Item", B1: "Qty", A2: "Pen", B2: "4" },
          },
          {
            id: "sheet-2",
            name: "Sheet2",
            activeCell: "A1",
            selection: { current: "A1", end: "A1" },
            cells: {},
          },
        ],
      },
    ],
  };
}

/**
 * First unused "SheetN" name in positive-integer order (case-insensitive).
 * When only Sheet1 exists, Sheet2 is created.
 */
export function firstUnusedSheetName(sheets) {
  const used = new Set((sheets || []).map((s) => String(s.name ?? "").toLowerCase()));
  let n = 1;
  while (used.has(`sheet${n}`)) n += 1;
  return `Sheet${n}`;
}

export async function saveData(data) {
  const file = dataFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file);
}

/** Load persisted data; seed and persist when nothing exists yet. */
export async function loadData() {
  const file = dataFile();
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      const seeded = seedData();
      await saveData(seeded);
      return seeded;
    }
    throw err;
  }
  return JSON.parse(raw);
}

export function summarize(workbook) {
  return {
    id: workbook.id,
    name: workbook.name,
    updatedAt: workbook.updatedAt,
  };
}

/** List workbooks ordered by most recently updated first. */
export async function listWorkbooks() {
  const data = await loadData();
  return data.workbooks
    .slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .map(summarize);
}

export async function getWorkbook(id) {
  const data = await loadData();
  return data.workbooks.find((wb) => wb.id === id) || null;
}

export async function createWorkbook(name) {
  const data = await loadData();
  const trimmed = (name || "").trim();
  const now = new Date().toISOString();
  const sheetId = crypto.randomUUID();
  const workbook = {
    id: crypto.randomUUID(),
    name: trimmed || DEFAULT_WORKBOOK_NAME,
    createdAt: now,
    updatedAt: now,
    activeSheetId: sheetId,
    sheets: [
      {
        id: sheetId,
        name: "Sheet1",
        activeCell: "A1",
        selection: { current: "A1", end: "A1" },
        cells: {},
      },
    ],
  };
  data.workbooks.push(workbook);
  await saveData(data);
  return workbook;
}

/**
 * Workbook name derived from an uploaded file name: the final .csv extension is
 * removed (case-insensitive); whitespace is trimmed; falls back to a default.
 */
export function workbookNameFromFileName(fileName) {
  const trimmed = String(fileName ?? "").trim();
  const name = trimmed.replace(/\.csv$/i, "");
  return name || "Imported workbook";
}

/**
 * Import CSV text as a brand-new workbook. Parsing and creation are atomic:
 * on a parse failure no record is created. Returns { workbook } on success or
 * { error: { code, message } } for invalid CSV.
 */
export async function importCsvWorkbook(fileName, csv) {
  const parsed = parseCsv(csv);
  if (parsed.error) {
    return { error: { code: "INVALID_CSV", message: parsed.error } };
  }
  const rows = parsed.rows;
  const data = await loadData();
  const now = new Date().toISOString();
  const sheetId = crypto.randomUUID();
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const cells = {};
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      if (value !== "") cells[cellCoordinate(c, r)] = value;
    });
  });
  const workbook = {
    id: crypto.randomUUID(),
    name: workbookNameFromFileName(fileName),
    createdAt: now,
    updatedAt: now,
    activeSheetId: sheetId,
    sheets: [
      {
        id: sheetId,
        name: "Sheet1",
        activeCell: "A1",
        selection: { current: "A1", end: "A1" },
        rowCount: rows.length,
        columnCount,
        cells,
      },
    ],
  };
  data.workbooks.push(workbook);
  await saveData(data);
  return { workbook };
}

/**
 * Add a blank worksheet to a workbook. The new sheet uses the first unused
 * SheetN name, becomes the active sheet with A1 selected, and is persisted.
 * Returns { workbook } on success or { error }.
 */
export async function addSheet(workbookId) {
  const data = await loadData();
  const workbook = data.workbooks.find((wb) => wb.id === workbookId);
  if (!workbook) {
    return { error: { code: "NOT_FOUND", message: "Workbook not found" } };
  }
  const sheet = {
    id: crypto.randomUUID(),
    name: firstUnusedSheetName(workbook.sheets),
    activeCell: "A1",
    selection: { current: "A1", end: "A1" },
    cells: {},
  };
  workbook.sheets.push(sheet);
  workbook.activeSheetId = sheet.id;
  workbook.updatedAt = new Date().toISOString();
  await saveData(data);
  return { workbook };
}

/**
 * Rename a worksheet. Leading/trailing whitespace is trimmed; the result must
 * be non-empty and unique within the same workbook (case-insensitive, excluding
 * the sheet being renamed). Returns { workbook } on success or { error } with a
 * user-facing message.
 */
export async function renameSheet(workbookId, sheetId, name) {
  const data = await loadData();
  const workbook = data.workbooks.find((wb) => wb.id === workbookId);
  if (!workbook) {
    return { error: { code: "NOT_FOUND", message: "Workbook not found" } };
  }
  const sheet = workbook.sheets.find((s) => s.id === sheetId);
  if (!sheet) {
    return { error: { code: "NOT_FOUND", message: "Worksheet not found" } };
  }
  const trimmed = (name == null ? "" : String(name)).trim();
  if (!trimmed) {
    return { error: { code: "EMPTY_NAME", message: "Worksheet name cannot be empty" } };
  }
  const duplicate = workbook.sheets.some(
    (s) => s.id !== sheetId && String(s.name ?? "").toLowerCase() === trimmed.toLowerCase(),
  );
  if (duplicate) {
    return { error: { code: "DUPLICATE_SHEET_NAME", message: "Worksheet name already exists" } };
  }
  sheet.name = trimmed;
  workbook.updatedAt = new Date().toISOString();
  await saveData(data);
  return { workbook };
}

/**
 * Insert a blank row above/below a target row, or delete the target row, in a
 * worksheet (REQ-2-2-1). Cells, formula references and the active cell in the
 * target sheet shift together; other worksheets are untouched. The operation is
 * atomic: on validation failure nothing is written. Returns { workbook } on
 * success or { error }.
 */
export async function modifyRows(workbookId, sheetId, action, row) {
  const data = await loadData();
  const workbook = data.workbooks.find((wb) => wb.id === workbookId);
  if (!workbook) {
    return { error: { code: "NOT_FOUND", message: "Workbook not found" } };
  }
  const sheet = workbook.sheets.find((s) => s.id === sheetId);
  if (!sheet) {
    return { error: { code: "NOT_FOUND", message: "Worksheet not found" } };
  }
  if (!ROW_ACTIONS.includes(action)) {
    return { error: { code: "INVALID_ACTION", message: "Invalid row operation" } };
  }
  const rowNumber = Number(row);
  if (!Number.isInteger(rowNumber) || rowNumber < 1) {
    return { error: { code: "INVALID_ROW", message: "Invalid row number" } };
  }
  const { cells, maxRow } = shiftCells(sheet.cells, action, rowNumber);
  sheet.cells = cells;
  sheet.activeCell = shiftCoordinateRow(sheet.activeCell, action, rowNumber);
  if (sheet.selection) {
    sheet.selection = {
      current: shiftCoordinateRow(sheet.selection.current, action, rowNumber),
      end: shiftCoordinateRow(sheet.selection.end, action, rowNumber),
    };
  }
  sheet.rowCount = Math.max(sheet.rowCount ?? 0, maxRow);
  workbook.updatedAt = new Date().toISOString();
  await saveData(data);
  return { workbook };
}

/**
 * Insert a blank column to the left/right of a target column, or delete the
 * target column, in a worksheet (REQ-2-2-2). Cells, formula references and the
 * active cell in the target sheet shift together; other worksheets are
 * untouched. The operation is atomic: on validation failure nothing is written.
 * Returns { workbook } on success or { error }.
 */
export async function modifyColumns(workbookId, sheetId, action, column) {
  const data = await loadData();
  const workbook = data.workbooks.find((wb) => wb.id === workbookId);
  if (!workbook) {
    return { error: { code: "NOT_FOUND", message: "Workbook not found" } };
  }
  const sheet = workbook.sheets.find((s) => s.id === sheetId);
  if (!sheet) {
    return { error: { code: "NOT_FOUND", message: "Worksheet not found" } };
  }
  if (!COLUMN_ACTIONS.includes(action)) {
    return { error: { code: "INVALID_ACTION", message: "Invalid column operation" } };
  }
  const columnNumber = Number(column);
  if (!Number.isInteger(columnNumber) || columnNumber < 1) {
    return { error: { code: "INVALID_COLUMN", message: "Invalid column number" } };
  }
  const { cells, maxCol } = shiftCellsColumn(sheet.cells, action, columnNumber);
  sheet.cells = cells;
  sheet.activeCell = shiftCoordinateColumn(sheet.activeCell, action, columnNumber);
  if (sheet.selection) {
    sheet.selection = {
      current: shiftCoordinateColumn(sheet.selection.current, action, columnNumber),
      end: shiftCoordinateColumn(sheet.selection.end, action, columnNumber),
    };
  }
  sheet.columnCount = Math.max(sheet.columnCount ?? 0, maxCol);
  workbook.updatedAt = new Date().toISOString();
  await saveData(data);
  return { workbook };
}

const COORD_PATTERN = /^[A-Za-z]+\d+$/;

/**
 * Copy or cut a rectangular range to a target location inside the same
 * worksheet (REQ-3-2-1). `source` is the complete selected rectangle
 * ({current, end}); `target` is the top-left cell where the range is pasted.
 * Copy leaves the source unchanged; cut clears the source only as part of the
 * same atomic operation that writes the complete target range. Formulas are
 * adjusted by the target offset (relative references shift, absolute
 * references stay fixed). The sheet's active cell and selection become the
 * pasted rectangle. On any validation failure nothing is written and the
 * cells keep their original values. Returns { workbook } on success or
 * { error }.
 */
export async function transferCells(workbookId, sheetId, operation, source, target) {
  const data = await loadData();
  const workbook = data.workbooks.find((wb) => wb.id === workbookId);
  if (!workbook) {
    return { error: { code: "NOT_FOUND", message: "Workbook not found" } };
  }
  const sheet = workbook.sheets.find((s) => s.id === sheetId);
  if (!sheet) {
    return { error: { code: "NOT_FOUND", message: "Worksheet not found" } };
  }
  if (!TRANSFER_OPERATIONS.includes(operation)) {
    return { error: { code: "INVALID_OPERATION", message: "Invalid transfer operation" } };
  }
  const sourceRect = normalizeRect(source?.current, source?.end);
  if (!sourceRect) {
    return { error: { code: "INVALID_COORD", message: "Invalid source range" } };
  }
  const targetMatch = /^([A-Z]+)(\d+)$/.exec(String(target ?? "").toUpperCase());
  if (!targetMatch || Number(targetMatch[2]) < 1) {
    return { error: { code: "INVALID_COORD", message: "Invalid target cell" } };
  }

  // Future validation hook (REQ-5): a rejected value (e.g. a 0-to-100 numeric
  // rule, message "Please enter a number from 0 to 100") returns an error here
  // before any cell below is written, keeping the transfer atomic.

  const { cells, end } = applyRangeTransfer(sheet.cells, operation, sourceRect, {
    col: columnNumber(targetMatch[1]),
    row: Number(targetMatch[2]),
  });
  const targetStart = `${columnLabel(columnNumber(targetMatch[1]) - 1)}${targetMatch[2]}`;
  sheet.cells = cells;
  sheet.activeCell = targetStart;
  sheet.selection = { current: targetStart, end };
  workbook.updatedAt = new Date().toISOString();
  await saveData(data);
  return { workbook };
}

/**
 * Paste a two-dimensional table (REQ-3-1-2): tab-separated columns and
 * newline-separated rows are applied starting at `start`. The entire rectangle
 * is applied — empty fields clear their cells and formulas inside the target
 * are replaced by the new raw text (the frontend derives display values).
 * Only the target rectangle is overwritten; the sheet's active cell and
 * selection become the pasted rectangle. The operation is atomic: on any
 * validation failure nothing is written and the cells keep their original
 * values. Returns { workbook } on success or { error }.
 */
export async function pasteCells(workbookId, sheetId, start, text) {
  const data = await loadData();
  const workbook = data.workbooks.find((wb) => wb.id === workbookId);
  if (!workbook) {
    return { error: { code: "NOT_FOUND", message: "Workbook not found" } };
  }
  const sheet = workbook.sheets.find((s) => s.id === sheetId);
  if (!sheet) {
    return { error: { code: "NOT_FOUND", message: "Worksheet not found" } };
  }
  if (typeof start !== "string" || !COORD_PATTERN.test(start)) {
    return { error: { code: "INVALID_COORD", message: "Invalid cell coordinate" } };
  }
  if (typeof text !== "string") {
    return { error: { code: "INVALID_VALUE", message: "Invalid paste content" } };
  }
  const rows = parsePasteText(text);
  const m = start.toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!m || Number(m[2]) < 1) {
    return { error: { code: "INVALID_COORD", message: "Invalid cell coordinate" } };
  }
  const startCol = columnNumber(m[1]);
  const startRow = Number(m[2]);
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);

  // Future validation hook (REQ-5): a rejected value (e.g. a 0-to-100 numeric
  // rule, message "Please enter a number from 0 to 100") returns an error here
  // before any cell below is written, keeping the paste atomic.

  const cells = { ...sheet.cells };
  rows.forEach((row, r) => {
    for (let c = 0; c < width; c += 1) {
      const value = row[c] ?? "";
      const coord = cellCoordinate(startCol - 1 + c, startRow - 1 + r);
      if (value === "") {
        delete cells[coord];
      } else {
        cells[coord] = value;
      }
    }
  });
  const endCoord = cellCoordinate(startCol - 1 + width - 1, startRow - 1 + rows.length - 1);
  sheet.cells = cells;
  sheet.activeCell = start.toUpperCase();
  sheet.selection = { current: start.toUpperCase(), end: endCoord };
  workbook.updatedAt = new Date().toISOString();
  await saveData(data);
  return { workbook };
}

/**
 * Set a single cell's value in a worksheet (REQ-3-1-1). The edited cell
 * becomes the active/selected cell; the workbook's updatedAt is refreshed.
 * An empty value clears the cell. The operation is atomic: on validation
 * failure nothing is written. Returns { workbook } on success or { error }.
 */
export async function setCellValue(workbookId, sheetId, coord, value) {
  const data = await loadData();
  const workbook = data.workbooks.find((wb) => wb.id === workbookId);
  if (!workbook) {
    return { error: { code: "NOT_FOUND", message: "Workbook not found" } };
  }
  const sheet = workbook.sheets.find((s) => s.id === sheetId);
  if (!sheet) {
    return { error: { code: "NOT_FOUND", message: "Worksheet not found" } };
  }
  if (typeof coord !== "string" || !COORD_PATTERN.test(coord)) {
    return { error: { code: "INVALID_COORD", message: "Invalid cell coordinate" } };
  }
  if (typeof value !== "string") {
    return { error: { code: "INVALID_VALUE", message: "Invalid cell value" } };
  }
  const normalized = coord.toUpperCase();
  if (value === "") {
    delete sheet.cells[normalized];
  } else {
    sheet.cells[normalized] = value;
  }
  sheet.activeCell = normalized;
  sheet.selection = { current: normalized, end: normalized };
  workbook.updatedAt = new Date().toISOString();
  await saveData(data);
  return { workbook };
}

/**
 * Persist the complete selected rectangle {current, end} of a worksheet
 * (REQ-3-1-3). Selecting is a view-state change, so updatedAt is untouched.
 * The anchor becomes the sheet's activeCell. Returns { workbook } on success
 * or { error }.
 */
export async function setSelection(workbookId, sheetId, current, end) {
  const data = await loadData();
  const workbook = data.workbooks.find((wb) => wb.id === workbookId);
  if (!workbook) {
    return { error: { code: "NOT_FOUND", message: "Workbook not found" } };
  }
  const sheet = workbook.sheets.find((s) => s.id === sheetId);
  if (!sheet) {
    return { error: { code: "NOT_FOUND", message: "Worksheet not found" } };
  }
  const normalizedCurrent = String(current ?? "").toUpperCase();
  const normalizedEnd = String(end ?? "").toUpperCase();
  if (!COORD_PATTERN.test(normalizedCurrent) || !COORD_PATTERN.test(normalizedEnd)) {
    return { error: { code: "INVALID_COORD", message: "Invalid cell coordinate" } };
  }
  sheet.selection = { current: normalizedCurrent, end: normalizedEnd };
  sheet.activeCell = normalizedCurrent;
  await saveData(data);
  return { workbook };
}

/**
 * Rename a workbook. Leading/trailing whitespace is trimmed; an empty result is
 * rejected. Returns { workbook } on success or { error } with a user-facing message.
 */
export async function renameWorkbook(id, name) {
  const data = await loadData();
  const workbook = data.workbooks.find((wb) => wb.id === id);
  if (!workbook) {
    return { error: { code: "NOT_FOUND", message: "Workbook not found" } };
  }
  const trimmed = (name == null ? "" : String(name)).trim();
  if (!trimmed) {
    return { error: { code: "EMPTY_NAME", message: "Workbook name cannot be empty" } };
  }
  workbook.name = trimmed;
  workbook.updatedAt = new Date().toISOString();
  await saveData(data);
  return { workbook };
}
