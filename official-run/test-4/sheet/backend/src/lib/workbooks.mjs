import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { parseCsv, serializeCsv, CsvError } from "./csv.mjs";
import { computeSheetResults, isFormula } from "./formula.mjs";
import { createJsonStore } from "./json-store.mjs";
import { computePivotCells, shiftPivotRange } from "./pivot.mjs";
import { rewriteFormulaRefs, translateFormulaRefs } from "./refs.mjs";
import { sortRangeCells } from "./sort.mjs";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function columnName(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

export function cellName(row, columnIndex) {
  return `${columnName(columnIndex)}${row}`;
}

export function parseCoord(coord) {
  const match = /^([A-Z]+)([1-9]\d*)$/.exec(coord);
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { row: Number(match[2]), col: col - 1 };
}

function nowIso() {
  return new Date().toISOString();
}

function makeSheet(id, name, cells) {
  return {
    id,
    name,
    cells: { ...cells },
    selectedCell: "A1",
    selectedRange: { start: "A1", end: "A1" },
    validationRules: [],
    filter: null,
    // Pivot-result worksheets carry their pivot configuration here; ordinary
    // worksheets have null (REQ-5-3-1).
    pivot: null,
  };
}

function makeWorkbook(name, sheetCells) {
  const createdAt = nowIso();
  const sheetId = `s_${randomUUID()}`;
  return {
    id: `wb_${randomUUID()}`,
    name,
    createdAt,
    updatedAt: createdAt,
    activeSheetId: sheetId,
    sheets: [makeSheet(sheetId, "Sheet1", sheetCells)],
  };
}

function findSheet(workbook, sheetId) {
  return workbook.sheets.find((sheet) => sheet.id === sheetId) ?? null;
}

/**
 * Serialize a workbook for API responses: every sheet carries its persisted
 * selection rectangle and a derived `results` map (formula cells only) so the
 * grid can show calculated results while the formula bar keeps the original
 * submitted formula text. Formula results are never persisted; they are
 * recomputed from the stored cell text on every read, so results stay
 * consistent with the current source values after refresh. Session-only
 * undo/redo availability and the current clipboard are attached so the
 * editor can enable/disable its toolbar and pick paste behaviour.
 */
function withResults(workbook, histories, clipboards) {
  const clone = structuredClone(workbook);
  const history = histories.get(workbook.id);
  clone.undoAvailable = Boolean(history && history.undo.length > 0);
  clone.redoAvailable = Boolean(history && history.redo.length > 0);
  const clipboard = clipboards.get(workbook.id);
  clone.clipboard = clipboard
    ? {
        sheetId: clipboard.sheetId,
        kind: clipboard.kind,
        range: { start: clipboard.range.start, end: clipboard.range.end },
      }
    : null;
  clone.sheets = clone.sheets.map((sheet) => {
    const selectedCell = sheet.selectedCell ?? "A1";
    return {
      ...sheet,
      selectedRange: sheet.selectedRange ?? { start: selectedCell, end: selectedCell },
      validationRules: Array.isArray(sheet.validationRules) ? sheet.validationRules : [],
      filter: sheet.filter ?? null,
      results: computeSheetResults(sheet.cells),
    };
  });
  return clone;
}

/**
 * Validation-rule seam (REQ-5-2-1 builds the editing UI on top of this
 * model). Numeric rules reject out-of-range committed values with a stable
 * message; the 0-to-100 rule uses the exact wording required by REQ-3-1-2
 * and the REQ-5-2-1 boundary scenario. Empty values (clearing a cell) are
 * always allowed.
 */
function ruleMessage(rule) {
  if (rule.type === "number" && rule.min === 0 && rule.max === 100) {
    return "Please enter a number from 0 to 100";
  }
  if (rule.type === "number") {
    return `Please enter a number between ${rule.min} and ${rule.max}`;
  }
  if (rule.type === "dropdown") {
    return `Please select one of the following values: ${rule.allowed.join(", ")}`;
  }
  return "Invalid value";
}

function ruleRejects(rule, value) {
  if (value === "") return false;
  if (rule.type === "number") {
    const number = Number(value);
    if (value.trim() === "" || !Number.isFinite(number)) return true;
    return number < rule.min || number > rule.max;
  }
  if (rule.type === "dropdown") {
    return !rule.allowed.includes(value);
  }
  return false;
}

function findRejectingRule(sheet, updates) {
  const rules = sheet.validationRules ?? [];
  if (rules.length === 0) return null;
  for (const [coord, value] of Object.entries(updates)) {
    const position = parseCoord(coord);
    if (!position) continue;
    for (const rule of rules) {
      const from = parseCoord(rule.start);
      const to = parseCoord(rule.end);
      if (!from || !to) continue;
      const rowMin = Math.min(from.row, to.row);
      const rowMax = Math.max(from.row, to.row);
      const colMin = Math.min(from.col, to.col);
      const colMax = Math.max(from.col, to.col);
      const inside =
        position.row >= rowMin && position.row <= rowMax &&
        position.col >= colMin && position.col <= colMax;
      if (inside && ruleRejects(rule, value)) return rule;
    }
  }
  return null;
}

function nextSheetName(sheets) {
  for (let n = 1; ; n += 1) {
    const name = `Sheet${n}`;
    if (!sheets.some((sheet) => sheet.name === name)) return name;
  }
}

/** First unused PivotN name for a new pivot-result worksheet (REQ-5-3-1). */
function nextPivotName(sheets) {
  for (let n = 1; ; n += 1) {
    const name = `Pivot${n}`;
    if (!sheets.some((sheet) => sheet.name === name)) return name;
  }
}

/**
 * Structure helpers: shift cell coordinates after a row/column insertion or
 * deletion. Every cell value is carried along, and formula text (values
 * starting with "=") has its A1 references rewritten so formulas keep pointing
 * at the same logical cells; direct references into a deleted row/column
 * become #REF!. Validation rules shift with the originally constrained cells
 * (REQ-5-2); pivot-range adjustment lands with its own feature package.
 */
function insertRowAt(cells, targetRow) {
  const op = { axis: "row", insert: targetRow };
  const result = {};
  for (const [coord, value] of Object.entries(cells)) {
    const position = parseCoord(coord);
    const rewritten = rewriteFormulaRefs(value, op);
    if (!position || position.row < targetRow) {
      result[coord] = rewritten;
    } else {
      result[cellName(position.row + 1, position.col)] = rewritten;
    }
  }
  return result;
}

function deleteRowAt(cells, row) {
  const op = { axis: "row", delete: row };
  const result = {};
  for (const [coord, value] of Object.entries(cells)) {
    const position = parseCoord(coord);
    const rewritten = rewriteFormulaRefs(value, op);
    if (!position || position.row < row) {
      result[coord] = rewritten;
    } else if (position.row > row) {
      result[cellName(position.row - 1, position.col)] = rewritten;
    }
    // cells on the deleted row are dropped
  }
  return result;
}

function insertColumnAt(cells, targetCol) {
  const op = { axis: "column", insert: targetCol };
  const result = {};
  for (const [coord, value] of Object.entries(cells)) {
    const position = parseCoord(coord);
    const rewritten = rewriteFormulaRefs(value, op);
    if (!position || position.col < targetCol) {
      result[coord] = rewritten;
    } else {
      result[cellName(position.row, position.col + 1)] = rewritten;
    }
  }
  return result;
}

function deleteColumnAt(cells, col) {
  const op = { axis: "column", delete: col };
  const result = {};
  for (const [coord, value] of Object.entries(cells)) {
    const position = parseCoord(coord);
    const rewritten = rewriteFormulaRefs(value, op);
    if (!position || position.col < col) {
      result[coord] = rewritten;
    } else if (position.col > col) {
      result[cellName(position.row, position.col - 1)] = rewritten;
    }
    // cells on the deleted column are dropped
  }
  return result;
}

/**
 * Shift a validation rule's range with a row/column structure operation so
 * dropdown buttons and numeric limits move with the originally constrained
 * cells (REQ-5-2). A rule whose constrained region is fully deleted (the
 * start and end collapse onto the deleted row/column) is dropped.
 */
function shiftRuleCoords(rule, op) {
  const from = parseCoord(rule.start);
  const to = parseCoord(rule.end);
  if (!from || !to) return null;
  let rowMin = Math.min(from.row, to.row);
  let rowMax = Math.max(from.row, to.row);
  let colMin = Math.min(from.col, to.col);
  let colMax = Math.max(from.col, to.col);
  if (op.axis === "row") {
    if (op.insert !== undefined) {
      if (rowMin >= op.insert) rowMin += 1;
      if (rowMax >= op.insert) rowMax += 1;
    } else if (op.delete !== undefined) {
      if (rowMin === op.delete && rowMax === op.delete) return null;
      if (rowMin > op.delete) rowMin -= 1;
      if (rowMax > op.delete) rowMax -= 1;
      else if (rowMax === op.delete) rowMax -= 1; // deleted row was the last constrained row
    }
  } else {
    if (op.insert !== undefined) {
      if (colMin >= op.insert) colMin += 1;
      if (colMax >= op.insert) colMax += 1;
    } else if (op.delete !== undefined) {
      if (colMin === op.delete && colMax === op.delete) return null;
      if (colMin > op.delete) colMin -= 1;
      if (colMax > op.delete) colMax -= 1;
      else if (colMax === op.delete) colMax -= 1; // deleted column was the last constrained column
    }
  }
  if (rowMin > rowMax || colMin > colMax) return null;
  return {
    ...rule,
    start: cellName(rowMin, colMin),
    end: cellName(rowMax, colMax),
  };
}

function shiftValidationRules(rules, op) {
  return (Array.isArray(rules) ? rules : [])
    .map((rule) => shiftRuleCoords(rule, op))
    .filter(Boolean);
}

/**
 * Shift the source ranges of every pivot that reads from `sourceSheetId`
 * after a row/column structure operation. Only the configuration moves — the
 * stored summary cells stay unchanged until "Refresh pivot table" is clicked
 * (REQ-5-3-1, REQ-2-2-1/REQ-2-2-2).
 */
function shiftPivotRanges(sheets, sourceSheetId, op) {
  for (const sheet of sheets) {
    if (!sheet.pivot || sheet.pivot.sourceSheetId !== sourceSheetId) continue;
    sheet.pivot.sourceRange = shiftPivotRange(sheet.pivot.sourceRange, op);
  }
}

function assertPositiveIndex(index, message) {
  if (!Number.isInteger(index) || index < 1) {
    throw new ApiError(400, message);
  }
}

function assertRowPosition(position) {
  if (position !== "above" && position !== "below") {
    throw new ApiError(400, "Invalid row position");
  }
}

function assertColumnPosition(position) {
  if (position !== "left" && position !== "right") {
    throw new ApiError(400, "Invalid column position");
  }
}

export function createWorkbookService(dataDir) {
  const store = createJsonStore(join(dataDir, "workbooks.json"), { workbooks: [] });
  let seeded = false;

  // Session-only per-workbook state: undo/redo history stacks and the current
  // clipboard (copy/cut capture). Both may be empty after a server restart;
  // they are never written to the JSON store. History is keyed by workbook id
  // so undo/redo in one workbook never touches another workbook.
  const histories = new Map();
  const clipboards = new Map();

  function getHistory(id) {
    let history = histories.get(id);
    if (!history) {
      history = { undo: [], redo: [] };
      histories.set(id, history);
    }
    return history;
  }

  /**
   * Record a snapshot of a workbook before a tracked mutation (cell edits,
   * pastes, row/column structure changes). A new modification clears the redo
   * stack so an old branch can never be restored after it.
   */
  function pushHistory(workbook) {
    const history = getHistory(workbook.id);
    history.undo.push(structuredClone(workbook));
    if (history.undo.length > 100) history.undo.shift();
    history.redo = [];
  }

  function withResultsFor(workbook) {
    return withResults(workbook, histories, clipboards);
  }

  /** Coordinates covered by a rectangle (inclusive, normalized). */
  function rangeCells(start, end) {
    const from = parseCoord(start);
    const to = parseCoord(end);
    if (!from || !to) return [];
    const rowMin = Math.min(from.row, to.row);
    const rowMax = Math.max(from.row, to.row);
    const colMin = Math.min(from.col, to.col);
    const colMax = Math.max(from.col, to.col);
    const coords = [];
    for (let row = rowMin; row <= rowMax; row += 1) {
      for (let col = colMin; col <= colMax; col += 1) {
        coords.push(cellName(row, col));
      }
    }
    return coords;
  }

  async function ensureSeeded() {
    if (seeded) return;
    await store.update((state) => {
      if (state.workbooks.length === 0) {
        // REQ-5 family evaluation seed (REQ-5-1-2 / REQ-5-2-1 / REQ-5-3-1):
        // worksheet range A1:C6 with headers Region/Sales/Status and rows
        // East/1200/Open, North/800/Closed, South/700/Open (rows 5-6 empty).
        // The East/1200/North/800 records also support the REQ-2 row/column
        // structure scenarios. Note: the REQ-4 seed (A1=2, B1=3, =A1+B1) is
        // mutually exclusive with this seed, so the REQ-5 seed wins.
        const workbook = makeWorkbook("Q3 Sales", {
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
        });
        workbook.sheets.push(makeSheet(`s_${randomUUID()}`, "Sheet2", {}));
        state.workbooks.push(workbook);
      }
    });
    seeded = true;
  }

  async function readWorkbooks() {
    await ensureSeeded();
    const state = await store.read();
    return state.workbooks;
  }

  return {
    async list() {
      const workbooks = await readWorkbooks();
      return [...workbooks]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
    },

    async get(id) {
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      return withResultsFor(workbook);
    },

    async create(name) {
      const trimmed = typeof name === "string" ? name.trim() : "";
      if (trimmed === "") throw new ApiError(400, "Workbook name cannot be empty");
      await ensureSeeded();
      const workbook = makeWorkbook(trimmed, {});
      await store.update((state) => {
        state.workbooks.push(workbook);
      });
      return withResultsFor(workbook);
    },

    async rename(id, name) {
      const trimmed = typeof name === "string" ? name.trim() : "";
      if (trimmed === "") throw new ApiError(400, "Workbook name cannot be empty");
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        if (target) {
          target.name = trimmed;
          target.updatedAt = nowIso();
        }
      });
      return this.get(id);
    },

    async updateCells(id, sheetId, updates) {
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) throw new ApiError(400, "Worksheet not found");
      if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
        throw new ApiError(400, "Invalid cell updates");
      }
      for (const [coord, value] of Object.entries(updates)) {
        if (typeof value !== "string") throw new ApiError(400, "Invalid cell value");
      }
      const rejectingRule = findRejectingRule(sheet, updates);
      if (rejectingRule) {
        throw new ApiError(400, ruleMessage(rejectingRule));
      }
      pushHistory(workbook);
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        const targetSheet = target && findSheet(target, sheetId);
        if (target && targetSheet) {
          for (const [coord, value] of Object.entries(updates)) {
            targetSheet.cells[coord] = value;
          }
          target.updatedAt = nowIso();
        }
      });
      return this.get(id);
    },

    async updateState(id, sheetId, selectedCell, selectedRange) {
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) throw new ApiError(400, "Worksheet not found");
      const normalizedRange =
        selectedRange && selectedRange.start && selectedRange.end
          ? { start: selectedRange.start, end: selectedRange.end }
          : { start: selectedCell, end: selectedCell };
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        const targetSheet = target && findSheet(target, sheetId);
        if (target && targetSheet) {
          target.activeSheetId = sheetId;
          targetSheet.selectedCell = selectedCell;
          targetSheet.selectedRange = normalizedRange;
        }
      });
      return this.get(id);
    },

    /** Normalize a rectangle to its top-left/bottom-right corners. */
    normalizeRange(start, end) {
      const from = parseCoord(start);
      const to = parseCoord(end);
      if (!from || !to) return null;
      return {
        start: cellName(Math.min(from.row, to.row), Math.min(from.col, to.col)),
        end: cellName(Math.max(from.row, to.row), Math.max(from.col, to.col)),
      };
    },

    /**
     * Create, update, or clear the active-sheet filter (REQ-5-1-2). A null
     * filter removes the filter view and restores every source row; otherwise
     * the filter rectangle and per-column filters are persisted with the
     * sheet so the same rows remain visible after refresh. Filter state never
     * deletes or reorders records and does not affect other worksheets.
     */
    async updateFilter(id, sheetId, filter) {
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) throw new ApiError(400, "Worksheet not found");
      let normalized = null;
      if (filter !== null && filter !== undefined) {
        const range = this.normalizeRange(filter.start, filter.end);
        if (!range) throw new ApiError(400, "Invalid filter range");
        const columns = filter.columns ?? {};
        if (typeof columns !== "object" || Array.isArray(columns)) {
          throw new ApiError(400, "Invalid filter columns");
        }
        const rangeFrom = parseCoord(range.start);
        const rangeTo = parseCoord(range.end);
        for (const [letter, columnFilter] of Object.entries(columns)) {
          const col = parseCoord(`${letter}1`);
          if (!col || col.row !== 1) {
            throw new ApiError(400, "Invalid filter column");
          }
          if (col.col < rangeFrom.col || col.col > rangeTo.col) {
            throw new ApiError(400, "Filter column outside range");
          }
          if (!columnFilter || typeof columnFilter !== "object") {
            throw new ApiError(400, "Invalid column filter");
          }
          if (columnFilter.kind === "values") {
            if (!Array.isArray(columnFilter.selected)) {
              throw new ApiError(400, "Invalid value filter");
            }
            columnFilter.selected = columnFilter.selected.map(String);
          } else if (columnFilter.kind === "condition") {
            if (typeof columnFilter.condition !== "string") {
              throw new ApiError(400, "Invalid condition filter");
            }
            columnFilter.value = typeof columnFilter.value === "string" ? columnFilter.value : "";
          } else {
            throw new ApiError(400, "Invalid column filter");
          }
        }
        normalized = { start: range.start, end: range.end, columns };
      }
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        const targetSheet = target && findSheet(target, sheetId);
        if (target && targetSheet) {
          targetSheet.filter = normalized;
        }
      });
      return this.get(id);
    },

    /**
     * Sort a rectangular range by one of its columns (REQ-5-1-1). Only the
     * selected rectangle is reordered: rows move together inside the range,
     * the optional header row stays put, and cells outside the rectangle are
     * never touched. The sorted layout is persisted so refresh/reopen keeps
     * the order; formula text moves with its row (references stay relative)
     * and results recompute on the next read. Filters and validation rules
     * remain at the same coordinates and continue to apply to the same range.
     * A rejected request (invalid range, column outside the range, unknown
     * order) throws before anything is written, so the grid keeps its
     * original order.
     */
    async sortRange(id, sheetId, payload) {
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) throw new ApiError(400, "Worksheet not found");
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new ApiError(400, "Invalid sort request");
      }
      const range = this.normalizeRange(payload.start, payload.end);
      if (!range) throw new ApiError(400, "Invalid sort range");
      let sorted;
      try {
        sorted = sortRangeCells(
          sheet.cells,
          range,
          payload.column,
          payload.order,
          payload.hasHeader === true,
        );
      } catch (error) {
        throw new ApiError(
          400,
          error instanceof Error ? error.message : "Invalid sort request",
        );
      }
      pushHistory(workbook);
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        const targetSheet = target && findSheet(target, sheetId);
        if (target && targetSheet) {
          targetSheet.cells = sorted;
          target.updatedAt = nowIso();
        }
      });
      return this.get(id);
    },

    /**
     * Upsert a dropdown or numeric validation rule for a range (REQ-5-2-1).
     * Passing an existing ruleId edits that rule (new range applies
     * immediately); without one, an existing rule covering the exact range is
     * replaced, otherwise a new rule is created. Saving never changes existing
     * cell values; enforcement happens on subsequent writes.
     */
    async saveValidationRule(id, sheetId, payload) {
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) throw new ApiError(400, "Worksheet not found");
      const range = this.normalizeRange(payload.start, payload.end);
      if (!range) throw new ApiError(400, "Invalid rule range");
      const type = payload.type;
      if (type !== "dropdown" && type !== "number") {
        throw new ApiError(400, "Invalid rule type");
      }
      let allowed;
      let min;
      let max;
      if (type === "dropdown") {
        if (!Array.isArray(payload.allowed)) {
          throw new ApiError(400, "Invalid allowed values");
        }
        allowed = payload.allowed.map((value) => String(value).trim()).filter((value) => value !== "");
        if (allowed.length === 0) throw new ApiError(400, "Allowed values cannot be empty");
      } else {
        min = Number(payload.min);
        max = Number(payload.max);
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
          throw new ApiError(400, "Minimum and Maximum must be numbers");
        }
        if (min > max) throw new ApiError(400, "Minimum must not exceed Maximum");
      }
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        const targetSheet = target && findSheet(target, sheetId);
        if (!target || !targetSheet) return;
        const rules = targetSheet.validationRules ?? [];
        let rule = payload.ruleId
          ? rules.find((entry) => entry.id === payload.ruleId) ?? null
          : rules.find((entry) => entry.start === range.start && entry.end === range.end) ?? null;
        if (payload.ruleId && !rule) {
          throw new ApiError(400, "Rule not found");
        }
        if (!rule) {
          rule = { id: `r_${randomUUID()}` };
          rules.push(rule);
        }
        rule.start = range.start;
        rule.end = range.end;
        rule.type = type;
        delete rule.allowed;
        delete rule.min;
        delete rule.max;
        if (type === "dropdown") {
          rule.allowed = allowed;
        } else {
          rule.min = min;
          rule.max = max;
        }
        targetSheet.validationRules = rules;
        target.updatedAt = nowIso();
      });
      return this.get(id);
    },

    /** Remove a validation rule; existing cell values stay unchanged. */
    async deleteValidationRule(id, sheetId, ruleId) {
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) throw new ApiError(400, "Worksheet not found");
      let removed = false;
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        const targetSheet = target && findSheet(target, sheetId);
        if (!target || !targetSheet) return;
        const before = targetSheet.validationRules?.length ?? 0;
        targetSheet.validationRules = (targetSheet.validationRules ?? []).filter(
          (rule) => rule.id !== ruleId,
        );
        removed = targetSheet.validationRules.length !== before;
        if (removed) target.updatedAt = nowIso();
      });
      if (!removed) throw new ApiError(400, "Rule not found");
      return this.get(id);
    },

    async addSheet(id) {
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        if (target) {
          const sheet = makeSheet(`s_${randomUUID()}`, nextSheetName(target.sheets), {});
          target.sheets.push(sheet);
          target.activeSheetId = sheet.id;
          target.updatedAt = nowIso();
        }
      });
      return this.get(id);
    },

    async renameSheet(id, sheetId, name) {
      const trimmed = typeof name === "string" ? name.trim() : "";
      if (trimmed === "") throw new ApiError(400, "Worksheet name cannot be empty");
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) throw new ApiError(400, "Worksheet not found");
      const duplicate = workbook.sheets.some(
        (other) => other.id !== sheetId && other.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (duplicate) throw new ApiError(400, "Worksheet name already exists");
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        const targetSheet = target && findSheet(target, sheetId);
        if (target && targetSheet) {
          targetSheet.name = trimmed;
          target.updatedAt = nowIso();
        }
      });
      return this.get(id);
    },

    /**
     * Delete a worksheet (REQ-2-1-4). The last remaining worksheet can never
     * be deleted, and a worksheet that is still the source of a pivot-result
     * worksheet rejects the deletion so source data and pivot results stay
     * unchanged. On success the whole sheet — cells, formulas, validation
     * rules, filter view, and pivot results — is removed; if the deleted
     * sheet was active, an adjacent worksheet becomes active. A session
     * clipboard that referenced the deleted sheet is cleared.
     */
    async deleteSheet(id, sheetId) {
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) throw new ApiError(400, "Worksheet not found");
      if (workbook.sheets.length <= 1) {
        throw new ApiError(400, "A workbook must contain at least one worksheet");
      }
      const dependentPivot = workbook.sheets.some(
        (other) =>
          other.id !== sheetId &&
          other.pivot &&
          other.pivot.sourceSheetId === sheetId,
      );
      if (dependentPivot) {
        throw new ApiError(400, "Please delete or rebuild dependent pivot tables first");
      }
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        if (!target) return;
        const index = target.sheets.findIndex((entry) => entry.id === sheetId);
        if (index === -1) return;
        const wasActive = target.activeSheetId === sheetId;
        target.sheets.splice(index, 1);
        if (wasActive) {
          // An adjacent worksheet becomes active: the sheet that followed the
          // deleted one, or the new last sheet when the deleted one was last.
          const adjacent = target.sheets[Math.min(index, target.sheets.length - 1)];
          target.activeSheetId = adjacent?.id ?? target.sheets[0]?.id;
        }
        target.updatedAt = nowIso();
      });
      const clipboard = clipboards.get(id);
      if (clipboard && clipboard.sheetId === sheetId) {
        clipboards.delete(id);
      }
      return this.get(id);
    },

    async insertRow(id, sheetId, index, position) {
      assertPositiveIndex(index, "Invalid row index");
      assertRowPosition(position);
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) throw new ApiError(400, "Worksheet not found");
      const targetRow = position === "above" ? index : index + 1;
      pushHistory(workbook);
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        const targetSheet = target && findSheet(target, sheetId);
        if (target && targetSheet) {
          targetSheet.cells = insertRowAt(targetSheet.cells, targetRow);
          targetSheet.validationRules = shiftValidationRules(targetSheet.validationRules, {
            axis: "row",
            insert: targetRow,
          });
          shiftPivotRanges(target.sheets, sheetId, { axis: "row", insert: targetRow });
          target.updatedAt = nowIso();
        }
      });
      return this.get(id);
    },

    async deleteRow(id, sheetId, index) {
      assertPositiveIndex(index, "Invalid row index");
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) throw new ApiError(400, "Worksheet not found");
      pushHistory(workbook);
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        const targetSheet = target && findSheet(target, sheetId);
        if (target && targetSheet) {
          targetSheet.cells = deleteRowAt(targetSheet.cells, index);
          targetSheet.validationRules = shiftValidationRules(targetSheet.validationRules, {
            axis: "row",
            delete: index,
          });
          shiftPivotRanges(target.sheets, sheetId, { axis: "row", delete: index });
          target.updatedAt = nowIso();
        }
      });
      return this.get(id);
    },

    async insertColumn(id, sheetId, index, position) {
      assertPositiveIndex(index, "Invalid column index");
      assertColumnPosition(position);
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) throw new ApiError(400, "Worksheet not found");
      const targetCol = position === "left" ? index - 1 : index;
      pushHistory(workbook);
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        const targetSheet = target && findSheet(target, sheetId);
        if (target && targetSheet) {
          targetSheet.cells = insertColumnAt(targetSheet.cells, targetCol);
          targetSheet.validationRules = shiftValidationRules(targetSheet.validationRules, {
            axis: "column",
            insert: targetCol,
          });
          shiftPivotRanges(target.sheets, sheetId, { axis: "column", insert: targetCol });
          target.updatedAt = nowIso();
        }
      });
      return this.get(id);
    },

    async deleteColumn(id, sheetId, index) {
      assertPositiveIndex(index, "Invalid column index");
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) throw new ApiError(400, "Worksheet not found");
      pushHistory(workbook);
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        const targetSheet = target && findSheet(target, sheetId);
        if (target && targetSheet) {
          targetSheet.cells = deleteColumnAt(targetSheet.cells, index - 1);
          targetSheet.validationRules = shiftValidationRules(targetSheet.validationRules, {
            axis: "column",
            delete: index - 1,
          });
          shiftPivotRanges(target.sheets, sheetId, { axis: "column", delete: index - 1 });
          target.updatedAt = nowIso();
        }
      });
      return this.get(id);
    },

    /**
     * Create a pivot-result worksheet from the selected source rectangle
     * (REQ-5-3-1). The new sheet is named with the first unused PivotN name
     * (Pivot1 when none exists), becomes the active sheet, and starts with an
     * empty configuration the "Pivot table editor" region fills in.
     */
    async createPivotTable(id, sheetId, range) {
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) throw new ApiError(400, "Worksheet not found");
      if (!range || !range.start || !range.end) {
        throw new ApiError(400, "Invalid source range");
      }
      const normalized = this.normalizeRange(range.start, range.end);
      if (!normalized) throw new ApiError(400, "Invalid source range");
      pushHistory(workbook);
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        if (target) {
          const pivotSheet = makeSheet(
            `s_${randomUUID()}`,
            nextPivotName(target.sheets),
            {},
          );
          pivotSheet.pivot = {
            sourceSheetId: sheetId,
            sourceRange: { start: normalized.start, end: normalized.end },
            rowField: null,
            columnField: null,
            valueField: null,
            summarizeBy: null,
          };
          target.sheets.push(pivotSheet);
          target.activeSheetId = pivotSheet.id;
          target.updatedAt = nowIso();
        }
      });
      return this.get(id);
    },

    /**
     * Apply a field layout to the pivot sheet: recompute the summary from the
     * current source range and replace the old result cells. On any error
     * (missing field, nonnumeric value field for SUM/AVERAGE, invalid range)
     * nothing is written: the last successful result and the source worksheet
     * stay unchanged.
     */
    async applyPivotConfig(id, sheetId, config) {
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) throw new ApiError(400, "Worksheet not found");
      if (!sheet.pivot) throw new ApiError(400, "Not a pivot worksheet");
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new ApiError(400, "Invalid pivot configuration");
      }
      const normalizedConfig = {
        rowField: typeof config.rowField === "string" ? config.rowField : null,
        columnField:
          typeof config.columnField === "string" && config.columnField !== ""
            ? config.columnField
            : null,
        valueField: typeof config.valueField === "string" ? config.valueField : null,
        summarizeBy: typeof config.summarizeBy === "string" ? config.summarizeBy : null,
      };
      if (!normalizedConfig.rowField || !normalizedConfig.valueField || !normalizedConfig.summarizeBy) {
        throw new ApiError(400, "Row and value fields are required");
      }
      const sourceSheet = findSheet(workbook, sheet.pivot.sourceSheetId);
      if (!sourceSheet) throw new ApiError(400, "Pivot source worksheet is missing");
      const outcome = computePivotCells(
        sourceSheet.cells,
        computeSheetResults(sourceSheet.cells),
        sheet.pivot.sourceRange,
        normalizedConfig,
      );
      if (outcome.error) throw new ApiError(400, outcome.error);
      pushHistory(workbook);
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        const targetSheet = target && findSheet(target, sheetId);
        if (target && targetSheet && targetSheet.pivot) {
          targetSheet.cells = outcome.cells;
          targetSheet.pivot.rowField = normalizedConfig.rowField;
          targetSheet.pivot.columnField = normalizedConfig.columnField;
          targetSheet.pivot.valueField = normalizedConfig.valueField;
          targetSheet.pivot.summarizeBy = normalizedConfig.summarizeBy;
          target.updatedAt = nowIso();
        }
      });
      return this.get(id);
    },

    /**
     * Recompute the pivot summary with the stored configuration. The old
     * result cells are replaced only on success; failures preserve the last
     * successful result and never modify the source worksheet.
     */
    async refreshPivot(id, sheetId) {
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) throw new ApiError(400, "Worksheet not found");
      if (!sheet.pivot) throw new ApiError(400, "Not a pivot worksheet");
      const { rowField, columnField, valueField, summarizeBy } = sheet.pivot;
      if (!rowField || !valueField || !summarizeBy) {
        throw new ApiError(400, "Pivot configuration is incomplete");
      }
      const sourceSheet = findSheet(workbook, sheet.pivot.sourceSheetId);
      if (!sourceSheet) throw new ApiError(400, "Pivot source worksheet is missing");
      const config = { rowField, columnField, valueField, summarizeBy };
      const outcome = computePivotCells(
        sourceSheet.cells,
        computeSheetResults(sourceSheet.cells),
        sheet.pivot.sourceRange,
        config,
      );
      if (outcome.error) throw new ApiError(400, outcome.error);
      pushHistory(workbook);
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        const targetSheet = target && findSheet(target, sheetId);
        if (target && targetSheet && targetSheet.pivot) {
          targetSheet.cells = outcome.cells;
          target.updatedAt = nowIso();
        }
      });
      return this.get(id);
    },

    /**
     * Capture the current values/formulas of a rectangular range into the
     * workbook's session clipboard (REQ-3-2-1). Copy keeps the source
     * unchanged; cut only records the source range — the source cells are
     * cleared when (and only when) the paste succeeds, so an interrupted or
     * rejected transfer never loses data.
     */
    async captureClipboard(id, sheetId, kind, range) {
      if (kind !== "copy" && kind !== "cut") {
        throw new ApiError(400, "Invalid clipboard kind");
      }
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) throw new ApiError(400, "Worksheet not found");
      if (!range || !range.start || !range.end) {
        throw new ApiError(400, "Invalid clipboard range");
      }
      const coords = rangeCells(range.start, range.end);
      if (coords.length === 0) {
        throw new ApiError(400, "Invalid clipboard range");
      }
      const content = {};
      for (const coord of coords) {
        content[coord] = sheet.cells[coord] ?? "";
      }
      clipboards.set(id, {
        sheetId,
        kind,
        range: { start: range.start, end: range.end },
        content,
      });
      return this.get(id);
    },

    /**
     * Paste the workbook's session clipboard so the target rectangle starts
     * at `target`. Values and formulas keep their two-dimensional layout;
     * formula relative references shift by the target offset while absolute
     * references stay unchanged. For a cut the source range is cleared. The
     * whole transfer (target writes + cut source clears) applies atomically
     * and either persists or leaves every cell unchanged; target validation
     * rules reject the paste before anything is written.
     */
    async pasteClipboard(id, sheetId, target) {
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) throw new ApiError(400, "Worksheet not found");
      const clipboard = clipboards.get(id);
      if (!clipboard) throw new ApiError(400, "Nothing to paste");
      if (clipboard.sheetId !== sheetId) {
        throw new ApiError(400, "Clipboard belongs to another worksheet");
      }
      const targetPos = parseCoord(target);
      const sourcePos = parseCoord(clipboard.range.start);
      if (!targetPos || !sourcePos) {
        throw new ApiError(400, "Invalid paste target");
      }
      const rowOffset = targetPos.row - sourcePos.row;
      const colOffset = targetPos.col - sourcePos.col;

      const updates = {};
      // Cut clears the source first so an overlapping move lands correctly;
      // the captured content is independent of the live grid afterwards.
      if (clipboard.kind === "cut") {
        for (const coord of Object.keys(clipboard.content)) {
          updates[coord] = "";
        }
      }
      for (const [coord, value] of Object.entries(clipboard.content)) {
        const position = parseCoord(coord);
        const targetCoord = cellName(
          position.row + rowOffset,
          position.col + colOffset,
        );
        updates[targetCoord] = translateFormulaRefs(value, { rowOffset, colOffset });
      }

      const rejectingRule = findRejectingRule(sheet, updates);
      if (rejectingRule) {
        throw new ApiError(400, ruleMessage(rejectingRule));
      }
      pushHistory(workbook);
      await store.update((state) => {
        const target = state.workbooks.find((entry) => entry.id === id);
        const targetSheet = target && findSheet(target, sheetId);
        if (target && targetSheet) {
          for (const [coord, value] of Object.entries(updates)) {
            targetSheet.cells[coord] = value;
          }
          target.updatedAt = nowIso();
        }
      });
      return this.get(id);
    },

    /** Restore the workbook to the state before its most recent tracked op. */
    async undo(id) {
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const history = histories.get(id);
      if (!history || history.undo.length === 0) {
        throw new ApiError(400, "Nothing to undo");
      }
      await store.update((state) => {
        const index = state.workbooks.findIndex((entry) => entry.id === id);
        const current = state.workbooks[index];
        const snapshot = history.undo.pop();
        history.redo.push(structuredClone(current));
        state.workbooks[index] = snapshot;
        state.workbooks[index].updatedAt = nowIso();
      });
      return this.get(id);
    },

    /** Reapply the operation that was just undone. */
    async redo(id) {
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const history = histories.get(id);
      if (!history || history.redo.length === 0) {
        throw new ApiError(400, "Nothing to redo");
      }
      await store.update((state) => {
        const index = state.workbooks.findIndex((entry) => entry.id === id);
        const current = state.workbooks[index];
        const snapshot = history.redo.pop();
        history.undo.push(structuredClone(current));
        state.workbooks[index] = snapshot;
        state.workbooks[index].updatedAt = nowIso();
      });
      return this.get(id);
    },

    async importCsv(fileName, content) {
      let rows;
      try {
        rows = parseCsv(content);
      } catch (error) {
        if (error instanceof CsvError) {
          throw new ApiError(400, error.message);
        }
        throw error;
      }
      const rawName = typeof fileName === "string" ? fileName.trim() : "";
      const baseName = rawName.replace(/\.csv$/i, "");
      const name = baseName === "" ? "Imported workbook" : baseName;

      const cells = {};
      rows.forEach((row, rowIndex) => {
        row.forEach((value, columnIndex) => {
          if (value !== "") {
            cells[cellName(rowIndex + 1, columnIndex)] = value;
          }
        });
      });

      await ensureSeeded();
      const workbook = makeWorkbook(name, cells);
      await store.update((state) => {
        state.workbooks.push(workbook);
      });
      return withResultsFor(workbook);
    },

    async exportSheetCsv(id) {
      const workbooks = await readWorkbooks();
      const workbook = workbooks.find((entry) => entry.id === id);
      if (!workbook) throw new ApiError(404, "Workbook not found");
      const sheet = findSheet(workbook, workbook.activeSheetId);
      if (!sheet) throw new ApiError(404, "Worksheet not found");

      let maxRow = 1;
      let maxCol = 0;
      for (const [coord, value] of Object.entries(sheet.cells)) {
        if (value === "") continue;
        const position = parseCoord(coord);
        if (!position) continue;
        maxRow = Math.max(maxRow, position.row);
        maxCol = Math.max(maxCol, position.col);
      }

      const results = computeSheetResults(sheet.cells);
      const rows = [];
      for (let row = 1; row <= maxRow; row += 1) {
        const fields = [];
        for (let col = 0; col <= maxCol; col += 1) {
          const coord = cellName(row, col);
          const raw = sheet.cells[coord] ?? "";
          // Ordinary cells export their displayed values; formula cells export
          // their current calculated results (REQ-1-3-2).
          fields.push(isFormula(raw) ? (results[coord] ?? "") : raw);
        }
        rows.push(fields);
      }

      return {
        fileName: `${sheet.name}.csv`,
        content: serializeCsv(rows),
      };
    },
  };
}
