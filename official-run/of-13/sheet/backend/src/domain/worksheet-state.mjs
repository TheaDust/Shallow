/**
 * Replacing the stored state of one worksheet.
 *
 * Undo/redo restores the state a worksheet had before an operation (cells, original formula
 * text, grid size and validation rules) through this one call. The submitted state is
 * normalized and fully checked before anything is written, so an unusable payload leaves the
 * worksheet exactly as it was; `rowCount`/`columnCount`/`validations` are optional, and
 * `null` resets the field to its default (no stored grid size / no rules).
 */

import { randomUUID } from "node:crypto";

import { cellAddress, parseAddress } from "./address.mjs";
import { sheetColumnCount, sheetRowCount } from "./structure.mjs";

export const WORKSHEET_STATE_INVALID_MESSAGE = "Invalid worksheet state";
export const WORKSHEET_STATE_ROW_COUNT_MESSAGE = "Invalid row count";
export const WORKSHEET_STATE_COLUMN_COUNT_MESSAGE = "Invalid column count";
export const WORKSHEET_STATE_VALIDATIONS_MESSAGE = "Invalid validation rules";

const MAX_GRID_SIZE = 1000;

function positiveCount(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_GRID_SIZE;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** True for a flat, `address → string` cell map. */
function isCellMap(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Canonical `A1:B2` form (upper case, corners in order) of a submitted range. */
export function canonicalRange(range) {
  const [start, end = start] = String(range ?? "").split(":");
  const from = parseAddress(start);
  const to = parseAddress(end);
  if (!from || !to) return null;
  const startAddress = cellAddress(Math.min(from.row, to.row), Math.min(from.column, to.column));
  const endAddress = cellAddress(Math.max(from.row, to.row), Math.max(from.column, to.column));
  // A single cell keeps the short form when it was submitted without a colon.
  if (startAddress === endAddress && !String(range).includes(":")) return startAddress;
  return `${startAddress}:${endAddress}`;
}

/**
 * Shapes one rule the same way `domain/validation.mjs` reads it, rejecting junk.
 * Dropdown values are trimmed of leading and trailing spaces and de-duplicated, so the
 * dialog's comma-separated list and the stored rule carry the same values. A rule without
 * an id gets one, so a rule created through the validation dialog can be addressed later.
 */
export function normalizeValidationRule(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null;
  if (typeof rule.range !== "string") return null;
  const range = canonicalRange(rule.range);
  if (!range) return null;
  if (hasOwn(rule, "message") && rule.message !== undefined && typeof rule.message !== "string") {
    return null;
  }
  const id = typeof rule.id === "string" && rule.id !== "" ? rule.id : randomUUID();
  if (rule.type === "number-range") {
    const min = Number(rule.min);
    const max = Number(rule.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { ...rule, id, range, min, max };
  }
  if (rule.type === "dropdown") {
    if (!Array.isArray(rule.values)) return null;
    const values = [];
    for (const entry of rule.values) {
      if (typeof entry !== "string") return null;
      const trimmed = entry.trim();
      if (trimmed !== "" && !values.includes(trimmed)) values.push(trimmed);
    }
    if (values.length === 0) return null;
    return { ...rule, id, range, values };
  }
  return null;
}

/**
 * Rewrites the state of `sheet` from a previously captured snapshot.
 *
 * @param {object} sheet worksheet to replace
 * @param {{ cells?: unknown, rowCount?: unknown, columnCount?: unknown, validations?: unknown }} payload
 * @returns {{ ok: true } | { ok: false, error: string }} mutating `sheet` only on success
 */
export function replaceWorksheetState(sheet, payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: WORKSHEET_STATE_INVALID_MESSAGE };
  }
  if (!isCellMap(payload.cells)) {
    return { ok: false, error: WORKSHEET_STATE_INVALID_MESSAGE };
  }

  // A field that is absent keeps its stored value; `null` resets it to the default.
  const setsRows = hasOwn(payload, "rowCount");
  const setsColumns = hasOwn(payload, "columnCount");
  const rows = setsRows ? payload.rowCount : undefined;
  const columns = setsColumns ? payload.columnCount : undefined;

  if (rows !== undefined && rows !== null && !positiveCount(rows)) {
    return { ok: false, error: WORKSHEET_STATE_ROW_COUNT_MESSAGE };
  }
  if (columns !== undefined && columns !== null && !positiveCount(columns)) {
    return { ok: false, error: WORKSHEET_STATE_COLUMN_COUNT_MESSAGE };
  }
  const limitRows = rows ?? sheetRowCount(sheet);
  const limitColumns = columns ?? sheetColumnCount(sheet);

  const cells = {};
  for (const [address, value] of Object.entries(payload.cells)) {
    if (typeof value !== "string") return { ok: false, error: WORKSHEET_STATE_INVALID_MESSAGE };
    const position = parseAddress(address);
    if (!position || position.row >= limitRows || position.column >= limitColumns) {
      return { ok: false, error: WORKSHEET_STATE_INVALID_MESSAGE };
    }
    if (value !== "") cells[cellAddress(position.row, position.column)] = value;
  }

  let validations;
  if (hasOwn(payload, "validations") && payload.validations !== null) {
    if (!Array.isArray(payload.validations)) {
      return { ok: false, error: WORKSHEET_STATE_VALIDATIONS_MESSAGE };
    }
    validations = [];
    for (const rule of payload.validations) {
      const normalized = normalizeValidationRule(rule);
      if (!normalized) return { ok: false, error: WORKSHEET_STATE_VALIDATIONS_MESSAGE };
      validations.push(normalized);
    }
  } else if (hasOwn(payload, "validations")) {
    validations = [];
  }

  sheet.cells = cells;
  if (setsRows) {
    if (rows === null) delete sheet.rowCount;
    else sheet.rowCount = rows;
  }
  if (setsColumns) {
    if (columns === null) delete sheet.columnCount;
    else sheet.columnCount = columns;
  }
  if (validations !== undefined) sheet.validations = validations;

  // A restored grid may be smaller than the current one; keep the stored selection inside it.
  if (sheet.selection) {
    const start = parseAddress(sheet.selection.start);
    const end = parseAddress(sheet.selection.end);
    if (start && end) {
      const clamp = (position) =>
        cellAddress(
          Math.min(position.row, limitRows - 1),
          Math.min(position.column, limitColumns - 1),
        );
      sheet.selection = { start: clamp(start), end: clamp(end) };
    } else {
      delete sheet.selection;
    }
  }
  return { ok: true };
}
