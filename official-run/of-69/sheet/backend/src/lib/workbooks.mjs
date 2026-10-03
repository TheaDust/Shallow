import { randomUUID } from "node:crypto";

import { cellName, parseCellName } from "./cells.mjs";
import { CsvError, INVALID_CSV_MESSAGE, parseCsv, worksheetToCsv } from "./csv.mjs";
import { FILTER_RANGE_INVALID_MESSAGE, filterBounds, normalizeFilter, rangeName } from "./filter.mjs";
import { isFormulaText, recalculateCells } from "./formula.mjs";
import { createJsonStore } from "./json-store.mjs";
import {
  PIVOT_METHODS,
  PIVOT_RANGE_INVALID_MESSAGE,
  PIVOT_SOURCE_MISSING_MESSAGE,
  PIVOT_WORKSHEET_INVALID_MESSAGE,
  PivotError,
  computePivotCells,
  normalizePivotField,
  normalizePivotMethod,
  normalizePivotRange,
} from "./pivot.mjs";
import {
  SORT_COLUMN_INVALID_MESSAGE,
  SORT_ORDER_INVALID_MESSAGE,
  SORT_ORDERS,
  SORT_RANGE_INVALID_MESSAGE,
  sortRangeCells,
} from "./sort.mjs";
import { applyAxisChange, shiftValidationRange, structureActions, structureKind } from "./structure.mjs";
import { TRANSFER_MODES, selectionBounds, selectionTopLeft, transferCells } from "./transfer.mjs";
import { validateCellValue } from "./validation.mjs";

export const DEFAULT_ROW_COUNT = 30;
export const DEFAULT_COLUMN_COUNT = 26;
export const DEFAULT_WORKBOOK_NAME = "Untitled workbook";
export const WORKBOOK_NAME_EMPTY_MESSAGE = "Workbook name cannot be empty";
export const WORKBOOK_NOT_FOUND_MESSAGE = "Workbook not found";
export const WORKSHEET_NOT_FOUND_MESSAGE = "Worksheet not found";
export const WORKSHEET_NAME_EMPTY_MESSAGE = "Worksheet name cannot be empty";
export const WORKSHEET_NAME_EXISTS_MESSAGE = "Worksheet name already exists";
export const LAST_WORKSHEET_MESSAGE = "A workbook must contain at least one worksheet";
export const PIVOT_DEPENDENT_MESSAGE = "Please delete or rebuild dependent pivot tables first";
export const STRUCTURE_ACTION_INVALID_MESSAGE = "Unable to update the row or column structure";
export const STRUCTURE_INDEX_INVALID_MESSAGE = "Invalid row or column index";
export const LAST_ROW_MESSAGE = "A worksheet must contain at least one row";
export const LAST_COLUMN_MESSAGE = "A worksheet must contain at least one column";
export const CELL_REFERENCE_INVALID_MESSAGE = "Invalid cell reference";
export const CELL_OUT_OF_RANGE_MESSAGE = "The cell is outside the worksheet";
export const CELL_VALUE_INVALID_MESSAGE = "The cell value must be text";
export const CELL_UPDATE_EMPTY_MESSAGE = "No cell values were provided";
export const SELECTION_INVALID_MESSAGE = "Invalid cell selection";
export const TRANSFER_MODE_INVALID_MESSAGE = "Unable to transfer the range";
export const WORKSHEET_STATE_INVALID_MESSAGE = "Invalid worksheet state";
export const VALIDATION_RULE_INVALID_MESSAGE = "Invalid validation rule";
export const VALIDATION_VALUES_EMPTY_MESSAGE = "Enter at least one allowed value";
export const VALIDATION_LIMITS_INVALID_MESSAGE = "Minimum must not be greater than Maximum";
export const VALIDATION_RANGE_REQUIRED_MESSAGE = "Invalid validation range";

// Fixed evaluation seed: workbook `Q3 Sales` with worksheets `Sheet1`/`Sheet2` and the
// data region A1:C4 (`Region/Sales/Status`) with rows `East/1200/Open`, `North/800/Closed`, `South/700/Open`.
const SEED_UPDATED_AT = "2026-10-01T08:00:00.000Z";

export const SEED_DATA = {
  workbooks: [
    {
      id: "wb-q3-sales",
      name: "Q3 Sales",
      createdAt: SEED_UPDATED_AT,
      updatedAt: SEED_UPDATED_AT,
      activeWorksheetId: "ws-q3-sales-sheet1",
      worksheets: [
        {
          id: "ws-q3-sales-sheet1",
          name: "Sheet1",
          rowCount: DEFAULT_ROW_COUNT,
          columnCount: DEFAULT_COLUMN_COUNT,
          cells: {
            A1: { value: "Region" },
            B1: { value: "Sales" },
            C1: { value: "Status" },
            A2: { value: "East" },
            B2: { value: "1200" },
            C2: { value: "Open" },
            A3: { value: "North" },
            B3: { value: "800" },
            C3: { value: "Closed" },
            A4: { value: "South" },
            B4: { value: "700" },
            C4: { value: "Open" },
          },
          selection: { anchor: "A1", focus: "A1" },
        },
        {
          id: "ws-q3-sales-sheet2",
          name: "Sheet2",
          rowCount: DEFAULT_ROW_COUNT,
          columnCount: DEFAULT_COLUMN_COUNT,
          cells: {},
          selection: { anchor: "A1", focus: "A1" },
        },
      ],
    },
  ],
};

export class WorkbookError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "WorkbookError";
    this.status = status;
  }
}

export function normalizeName(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}

function createBlankWorksheet(idFactory, name = "Sheet1") {
  return {
    id: `ws-${idFactory()}`,
    name,
    rowCount: DEFAULT_ROW_COUNT,
    columnCount: DEFAULT_COLUMN_COUNT,
    cells: {},
    selection: { anchor: "A1", focus: "A1" },
  };
}

/** Blank result worksheet carrying the pivot configuration that fills it. */
function createPivotWorksheet(idFactory, name, pivot) {
  return { ...createBlankWorksheet(idFactory, name), pivot };
}

/** First unused `SheetN` name in positive-integer order for a workbook. */
export function nextWorksheetName(worksheets) {
  const taken = new Set((worksheets ?? []).map((worksheet) => worksheet.name));
  for (let index = 1; ; index += 1) {
    const candidate = `Sheet${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** First unused `PivotN` name in positive-integer order for a workbook. */
export function nextPivotWorksheetName(worksheets) {
  const taken = new Set((worksheets ?? []).map((worksheet) => worksheet.name));
  for (let index = 1; ; index += 1) {
    const candidate = `Pivot${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function csvWorkbookName(fileName) {
  const base = String(fileName ?? "").split(/[\\/]/).pop() ?? "";
  return normalizeName(base.replace(/\.csv$/i, "")) || DEFAULT_WORKBOOK_NAME;
}

/** Builds a workbook from CSV text; throws `CsvError` before anything is persisted. */
export function createWorkbookFromCsv({ fileName, content, timestamp, idFactory = randomUUID }) {
  const rows = parseCsv(content);
  const worksheet = createBlankWorksheet(idFactory);
  let columnCount = DEFAULT_COLUMN_COUNT;
  for (const row of rows) columnCount = Math.max(columnCount, row.length);
  worksheet.rowCount = Math.max(DEFAULT_ROW_COUNT, rows.length);
  worksheet.columnCount = columnCount;
  worksheet.cells = {};
  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      worksheet.cells[cellName(rowIndex, columnIndex)] = { value };
    });
  });
  return {
    id: `wb-${idFactory()}`,
    name: csvWorkbookName(fileName),
    createdAt: timestamp,
    updatedAt: timestamp,
    activeWorksheetId: worksheet.id,
    worksheets: [worksheet],
  };
}

export function createBlankWorkbook({ name, timestamp, idFactory = randomUUID }) {
  const worksheet = createBlankWorksheet(idFactory);
  return {
    id: `wb-${idFactory()}`,
    name: normalizeName(name) || DEFAULT_WORKBOOK_NAME,
    createdAt: timestamp,
    updatedAt: timestamp,
    activeWorksheetId: worksheet.id,
    worksheets: [worksheet],
  };
}

/** Validates a pivot source: one worksheet of the workbook plus a range fitting inside it. */
function pivotSourceOf(workbook, sourceWorksheetId, range) {
  const source = workbook.worksheets.find((candidate) => candidate.id === sourceWorksheetId);
  if (!source) throw new WorkbookError(WORKSHEET_NOT_FOUND_MESSAGE, 404);
  const canonical = normalizePivotRange(range);
  if (!canonical) throw new WorkbookError(PIVOT_RANGE_INVALID_MESSAGE, 400);
  const bounds = filterBounds(canonical);
  if (bounds.bottom >= source.rowCount || bounds.right >= source.columnCount) {
    throw new WorkbookError(CELL_OUT_OF_RANGE_MESSAGE, 400);
  }
  return { source, sourceRange: canonical };
}

/** Runs the pivot engine, translating its errors into HTTP-level `WorkbookError`s. */
function pivotCellsOf(source, spec) {
  try {
    return computePivotCells(source, spec);
  } catch (error) {
    if (error instanceof PivotError) throw new WorkbookError(error.message, 400);
    throw error;
  }
}

function summarize(workbook) {
  return { id: workbook.id, name: workbook.name, updatedAt: workbook.updatedAt };
}

/** Stores one submitted value: formulas keep their original text, empty input clears the cell. */
function applyCellInput(cells, name, input) {
  if (input === "") {
    delete cells[name];
    return;
  }
  if (isFormulaText(input)) cells[name] = { formula: input, value: "" };
  else cells[name] = { value: input };
}

/** Grid size passed to the formula engine so an off-sheet reference becomes `#REF!`. */
function boundsOf(worksheet) {
  return { rowCount: worksheet.rowCount, columnCount: worksheet.columnCount };
}

function numericBound(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim();
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function containedIn(inner, outer) {
  return (
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom &&
    inner.left >= outer.left &&
    inner.right <= outer.right
  );
}

/**
 * Builds one stored validation rule: `{range, type:"list", values}` or
 * `{range, type:"number", min, max}`. Comma-separated list items are trimmed and the
 * bounds are inclusive; invalid payloads are rejected before anything is stored.
 */
export function buildValidationRule({ range, type, values, min, max } = {}) {
  const bounds = filterBounds(range);
  if (!bounds) throw new WorkbookError(VALIDATION_RANGE_REQUIRED_MESSAGE, 400);
  const canonical = rangeName(bounds);
  if (type === "list") {
    const items = (Array.isArray(values) ? values : String(values ?? "").split(","))
      .map((value) => String(value).trim())
      .filter((value) => value !== "");
    if (items.length === 0) throw new WorkbookError(VALIDATION_VALUES_EMPTY_MESSAGE, 400);
    return { range: canonical, type: "list", values: items };
  }
  if (type === "number") {
    const minimum = numericBound(min);
    const maximum = numericBound(max);
    if (minimum === null || maximum === null || minimum > maximum) {
      throw new WorkbookError(VALIDATION_LIMITS_INVALID_MESSAGE, 400);
    }
    return { range: canonical, type: "number", min: minimum, max: maximum };
  }
  throw new WorkbookError(VALIDATION_RULE_INVALID_MESSAGE, 400);
}

/** Validates a `{anchor, focus}` rectangle against the worksheet bounds. */
function normalizeSelection(worksheet, selection) {
  const anchor = parseCellName(selection?.anchor);
  const focus = parseCellName(selection?.focus);
  const inBounds = (position) =>
    position && position.row < worksheet.rowCount && position.column < worksheet.columnCount;
  if (!inBounds(anchor) || !inBounds(focus)) throw new WorkbookError(SELECTION_INVALID_MESSAGE, 400);
  return { anchor: cellName(anchor.row, anchor.column), focus: cellName(focus.row, focus.column) };
}

export function createWorkbookService({ filePath, now = () => new Date().toISOString(), idFactory = randomUUID }) {
  const store = createJsonStore(filePath, SEED_DATA);

  return {
    async list() {
      const data = await store.read();
      return [...data.workbooks]
        .sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : left.updatedAt > right.updatedAt ? -1 : 0))
        .map(summarize);
    },

    async get(id) {
      const data = await store.read();
      return data.workbooks.find((workbook) => workbook.id === id) ?? null;
    },

    async create({ name } = {}) {
      const workbook = createBlankWorkbook({ name, timestamp: now(), idFactory });
      await store.update((draft) => {
        draft.workbooks.push(workbook);
      });
      return workbook;
    },

    async importCsv({ fileName, content } = {}) {
      if (typeof content !== "string") throw new WorkbookError(INVALID_CSV_MESSAGE, 400);
      let workbook;
      try {
        workbook = createWorkbookFromCsv({ fileName, content, timestamp: now(), idFactory });
      } catch (error) {
        if (error instanceof CsvError) throw new WorkbookError(INVALID_CSV_MESSAGE, 400);
        throw error;
      }
      await store.update((draft) => {
        draft.workbooks.push(workbook);
      });
      return workbook;
    },

    /** Read-only export of one worksheet (the active one unless `worksheetId` is given). */
    async exportCsv(id, worksheetId) {
      const data = await store.read();
      const workbook = data.workbooks.find((candidate) => candidate.id === id);
      if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
      const worksheet = workbook.worksheets.find(
        (candidate) => candidate.id === (worksheetId ?? workbook.activeWorksheetId),
      );
      if (!worksheet) throw new WorkbookError(WORKSHEET_NOT_FOUND_MESSAGE, 404);
      return { workbook, worksheet, csv: worksheetToCsv(worksheet) };
    },

    /** Adds a blank worksheet named after the first unused `SheetN` and makes it active. */
    async addWorksheet(id) {
      let updated = null;
      await store.update((draft) => {
        const workbook = draft.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
        const worksheet = createBlankWorksheet(idFactory, nextWorksheetName(workbook.worksheets));
        workbook.worksheets.push(worksheet);
        workbook.activeWorksheetId = worksheet.id;
        workbook.updatedAt = now();
        updated = structuredClone(workbook);
      });
      return updated;
    },

    /**
     * Deletes one worksheet and activates an adjacent one. A workbook always keeps at
     * least one worksheet, and a worksheet another pivot still reads cannot be removed;
     * both rules are checked before anything changes, so a rejected deletion keeps the
     * workbook exactly as it was.
     */
    async deleteWorksheet(id, worksheetId) {
      let updated = null;
      await store.update((draft) => {
        const workbook = draft.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
        const index = workbook.worksheets.findIndex((candidate) => candidate.id === worksheetId);
        if (index === -1) throw new WorkbookError(WORKSHEET_NOT_FOUND_MESSAGE, 404);
        if (workbook.worksheets.length <= 1) throw new WorkbookError(LAST_WORKSHEET_MESSAGE, 400);
        const isPivotSource = workbook.worksheets.some(
          (candidate) =>
            candidate.id !== worksheetId && candidate.pivot?.sourceWorksheetId === worksheetId,
        );
        if (isPivotSource) throw new WorkbookError(PIVOT_DEPENDENT_MESSAGE, 400);

        workbook.worksheets.splice(index, 1);
        // An adjacent worksheet takes over: the next one, or the previous when the
        // deleted tab was the last.
        if (workbook.activeWorksheetId === worksheetId) {
          const adjacent = workbook.worksheets[index] ?? workbook.worksheets[index - 1];
          workbook.activeWorksheetId = adjacent.id;
        }
        workbook.updatedAt = now();
        updated = structuredClone(workbook);
      });
      return updated;
    },

    /**
     * Creates a pivot-result worksheet for a source range: the first unused `PivotN` name
     * is used, the new worksheet becomes active and starts unconfigured. Only the source
     * range is read, so the source cells stay exactly as they were.
     */
    async createPivotTable(id, { sourceWorksheetId, range } = {}) {
      let updated = null;
      await store.update((draft) => {
        const workbook = draft.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
        const { source, sourceRange } = pivotSourceOf(workbook, sourceWorksheetId, range);

        const worksheet = createPivotWorksheet(
          idFactory,
          nextPivotWorksheetName(workbook.worksheets),
          {
            sourceWorksheetId: source.id,
            sourceRange,
            rowField: null,
            columnField: null,
            valueField: null,
            summarizeBy: PIVOT_METHODS[0],
          },
        );
        workbook.worksheets.push(worksheet);
        workbook.activeWorksheetId = worksheet.id;
        workbook.updatedAt = now();
        updated = structuredClone(workbook);
      });
      return updated;
    },

    /**
     * Applies one pivot configuration and replaces the result cells of the pivot
     * worksheet. A rejected configuration (missing field, no parseable numbers) keeps the
     * last successful result and never touches the source worksheet.
     */
    async applyPivotTable(id, worksheetId, payload = {}) {
      let updated = null;
      await store.update((draft) => {
        const workbook = draft.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
        if (!worksheet) throw new WorkbookError(WORKSHEET_NOT_FOUND_MESSAGE, 404);
        if (!worksheet.pivot) throw new WorkbookError(PIVOT_WORKSHEET_INVALID_MESSAGE, 400);

        const source = workbook.worksheets.find(
          (candidate) => candidate.id === worksheet.pivot.sourceWorksheetId,
        );
        if (!source) throw new WorkbookError(PIVOT_SOURCE_MISSING_MESSAGE, 400);

        const spec = {
          ...worksheet.pivot,
          rowField: normalizePivotField(payload.rowField),
          columnField: normalizePivotField(payload.columnField),
          valueField: normalizePivotField(payload.valueField),
          summarizeBy: normalizePivotMethod(payload.summarizeBy) ?? worksheet.pivot.summarizeBy,
        };
        // Compute first: a rejected configuration leaves the stored result untouched.
        const cells = pivotCellsOf(source, spec);
        worksheet.pivot = spec;
        worksheet.cells = cells;
        workbook.updatedAt = now();
        updated = structuredClone(workbook);
      });
      return updated;
    },

    /**
     * Recomputes a pivot from the current source data and completely replaces the previous
     * summary. A source range or field that is gone keeps the last successful result.
     */
    async refreshPivotTable(id, worksheetId) {
      let updated = null;
      await store.update((draft) => {
        const workbook = draft.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
        if (!worksheet) throw new WorkbookError(WORKSHEET_NOT_FOUND_MESSAGE, 404);
        if (!worksheet.pivot) throw new WorkbookError(PIVOT_WORKSHEET_INVALID_MESSAGE, 400);

        const source = workbook.worksheets.find(
          (candidate) => candidate.id === worksheet.pivot.sourceWorksheetId,
        );
        if (!source) throw new WorkbookError(PIVOT_SOURCE_MISSING_MESSAGE, 400);

        worksheet.cells = pivotCellsOf(source, worksheet.pivot);
        workbook.updatedAt = now();
        updated = structuredClone(workbook);
      });
      return updated;
    },

    /**
     * Inserts or deletes one row/column of a worksheet. Validation runs before any change,
     * so a rejected operation leaves the stored structure exactly as it was.
     */
    async structure(id, worksheetId, { axis, action, index } = {}) {
      let updated = null;
      await store.update((draft) => {
        const workbook = draft.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
        if (!worksheet) throw new WorkbookError(WORKSHEET_NOT_FOUND_MESSAGE, 404);

        const actions = structureActions(axis);
        if (!actions || !structureKind(action) || !actions.includes(action)) {
          throw new WorkbookError(STRUCTURE_ACTION_INVALID_MESSAGE, 400);
        }
        const count = axis === "row" ? worksheet.rowCount : worksheet.columnCount;
        const parsed = typeof index === "number"
          ? index
          : typeof index === "string" && index.trim() !== ""
            ? Number(index)
            : Number.NaN;
        const maxIndex = action === "delete" ? count - 1 : count;
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > maxIndex) {
          throw new WorkbookError(STRUCTURE_INDEX_INVALID_MESSAGE, 400);
        }
        if (action === "delete" && count <= 1) {
          throw new WorkbookError(axis === "row" ? LAST_ROW_MESSAGE : LAST_COLUMN_MESSAGE, 400);
        }

        Object.assign(worksheet, applyAxisChange(worksheet, axis, action, parsed));
        // A pivot reads its source range: the range follows the moved cells, while the
        // stored result stays untouched until "Refresh pivot table" is clicked.
        const isRow = axis === "row";
        const kind = structureKind(action);
        for (const candidate of workbook.worksheets) {
          if (candidate.pivot?.sourceWorksheetId !== worksheet.id) continue;
          candidate.pivot.sourceRange = shiftValidationRange(candidate.pivot.sourceRange, {
            isRow,
            kind,
            index: parsed,
          });
        }
        // Moving cells can change what formulas point at, so results are recomputed too.
        worksheet.cells = recalculateCells(worksheet.cells, boundsOf(worksheet));
        workbook.updatedAt = now();
        updated = structuredClone(workbook);
      });
      return updated;
    },

    /**
     * Writes one or more cells (and optionally the selection) in a single atomic change:
     * every coordinate and value is validated first, then the whole worksheet is
     * recalculated, so a rejected write keeps the stored state exactly as it was.
     */
    async writeCells(id, worksheetId, { updates, selection } = {}) {
      let updated = null;
      await store.update((draft) => {
        const workbook = draft.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
        if (!worksheet) throw new WorkbookError(WORKSHEET_NOT_FOUND_MESSAGE, 404);
        if (!Array.isArray(updates) || updates.length === 0) {
          throw new WorkbookError(CELL_UPDATE_EMPTY_MESSAGE, 400);
        }

        const writes = updates.map((update) => {
          const name = typeof update?.name === "string" ? update.name.trim().toUpperCase() : "";
          const position = parseCellName(name);
          if (!position) throw new WorkbookError(CELL_REFERENCE_INVALID_MESSAGE, 400);
          if (position.row >= worksheet.rowCount || position.column >= worksheet.columnCount) {
            throw new WorkbookError(CELL_OUT_OF_RANGE_MESSAGE, 400);
          }
          if (typeof update.input !== "string") throw new WorkbookError(CELL_VALUE_INVALID_MESSAGE, 400);
          return { name, input: update.input };
        });

        const cells = structuredClone(worksheet.cells ?? {});
        for (const write of writes) applyCellInput(cells, write.name, write.input);
        const recalculated = recalculateCells(cells, boundsOf(worksheet));

        for (const write of writes) {
          const message = validateCellValue(worksheet, write.name, recalculated[write.name]?.value ?? "");
          if (message) throw new WorkbookError(message, 400);
        }

        worksheet.cells = recalculated;
        if (selection !== undefined) worksheet.selection = normalizeSelection(worksheet, selection);
        workbook.updatedAt = now();
        updated = structuredClone(workbook);
      });
      return updated;
    },

    /**
     * Copies or cuts one rectangular range onto another location of the same worksheet in
     * a single atomic change: every coordinate is validated and the whole worksheet is
     * recalculated, so a rejected transfer keeps the stored state exactly as it was.
     */
    async transferRange(id, worksheetId, { mode, source, target } = {}) {
      let updated = null;
      await store.update((draft) => {
        const workbook = draft.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
        if (!worksheet) throw new WorkbookError(WORKSHEET_NOT_FOUND_MESSAGE, 404);
        if (!TRANSFER_MODES.includes(mode)) throw new WorkbookError(TRANSFER_MODE_INVALID_MESSAGE, 400);

        const src = selectionBounds(source);
        if (!src) throw new WorkbookError(CELL_REFERENCE_INVALID_MESSAGE, 400);
        if (
          src.bottom >= worksheet.rowCount ||
          src.right >= worksheet.columnCount
        ) {
          throw new WorkbookError(CELL_OUT_OF_RANGE_MESSAGE, 400);
        }
        const targetTopLeft = selectionTopLeft(target);
        if (!targetTopLeft) throw new WorkbookError(CELL_REFERENCE_INVALID_MESSAGE, 400);

        const plan = transferCells(worksheet, { mode, source, target });
        if (!plan) throw new WorkbookError(CELL_OUT_OF_RANGE_MESSAGE, 400);

        const recalculated = recalculateCells(plan.cells, boundsOf(worksheet));
        for (const name of plan.targets) {
          const message = validateCellValue(worksheet, name, recalculated[name]?.value ?? "");
          if (message) throw new WorkbookError(message, 400);
        }

        worksheet.cells = recalculated;
        workbook.updatedAt = now();
        updated = structuredClone(workbook);
      });
      return updated;
    },

    /**
     * Restores one worksheet to a previously captured state (structure, cells, selection
     * and rule ranges). Used by undo/redo; a rejected payload keeps the stored state.
     */
    async restoreWorksheet(id, worksheetId, state = {}) {
      let updated = null;
      await store.update((draft) => {
        const workbook = draft.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
        if (!worksheet) throw new WorkbookError(WORKSHEET_NOT_FOUND_MESSAGE, 404);

        const rowCount = Number(state?.rowCount);
        const columnCount = Number(state?.columnCount);
        if (!Number.isInteger(rowCount) || rowCount < 1 || !Number.isInteger(columnCount) || columnCount < 1) {
          throw new WorkbookError(WORKSHEET_STATE_INVALID_MESSAGE, 400);
        }
        if (!state?.cells || typeof state.cells !== "object" || Array.isArray(state.cells)) {
          throw new WorkbookError(WORKSHEET_STATE_INVALID_MESSAGE, 400);
        }
        const cells = {};
        for (const [rawName, rawCell] of Object.entries(state.cells)) {
          const position = parseCellName(rawName);
          if (!position || position.row >= rowCount || position.column >= columnCount) {
            throw new WorkbookError(CELL_REFERENCE_INVALID_MESSAGE, 400);
          }
          if (!rawCell || typeof rawCell.value !== "string") {
            throw new WorkbookError(CELL_VALUE_INVALID_MESSAGE, 400);
          }
          const cell = { value: rawCell.value };
          if (typeof rawCell.formula === "string" && rawCell.formula !== "") cell.formula = rawCell.formula;
          cells[cellName(position.row, position.column)] = cell;
        }

        worksheet.rowCount = rowCount;
        worksheet.columnCount = columnCount;
        worksheet.cells = recalculateCells(cells, { rowCount, columnCount });
        worksheet.selection = normalizeSelection({ rowCount, columnCount }, state.selection);
        if (Array.isArray(state.validations)) worksheet.validations = structuredClone(state.validations);
        workbook.updatedAt = now();
        updated = structuredClone(workbook);
      });
      return updated;
    },

    /**
     * Stably sorts the data rows of one selected range by one of its columns in a single
     * atomic change: whole records move together, moved formulas follow their row and the
     * result is recalculated. A rejected payload keeps the stored order exactly as it was.
     */
    async sortRange(id, worksheetId, { range, column, order, hasHeader } = {}) {
      let updated = null;
      await store.update((draft) => {
        const workbook = draft.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
        if (!worksheet) throw new WorkbookError(WORKSHEET_NOT_FOUND_MESSAGE, 404);

        const bounds = filterBounds(range);
        if (!bounds) throw new WorkbookError(SORT_RANGE_INVALID_MESSAGE, 400);
        if (bounds.bottom >= worksheet.rowCount || bounds.right >= worksheet.columnCount) {
          throw new WorkbookError(CELL_OUT_OF_RANGE_MESSAGE, 400);
        }
        const parsedColumn = typeof column === "number" ? column : Number(column);
        if (!Number.isInteger(parsedColumn) || parsedColumn < bounds.left || parsedColumn > bounds.right) {
          throw new WorkbookError(SORT_COLUMN_INVALID_MESSAGE, 400);
        }
        if (!SORT_ORDERS.includes(order)) throw new WorkbookError(SORT_ORDER_INVALID_MESSAGE, 400);

        worksheet.cells = recalculateCells(
          sortRangeCells(worksheet, { bounds, column: parsedColumn, order, hasHeader: Boolean(hasHeader) }),
          boundsOf(worksheet),
        );
        workbook.updatedAt = now();
        updated = structuredClone(workbook);
      });
      return updated;
    },

    /**
     * Replaces the filter view of one worksheet with the submitted region and rules.
     * The region must fit the sheet; a rejected payload keeps the stored filter as it was.
     */
    async setFilter(id, worksheetId, { range, rules } = {}) {
      let updated = null;
      await store.update((draft) => {
        const workbook = draft.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
        if (!worksheet) throw new WorkbookError(WORKSHEET_NOT_FOUND_MESSAGE, 404);
        const bounds = filterBounds(range);
        if (!bounds) throw new WorkbookError(FILTER_RANGE_INVALID_MESSAGE, 400);
        if (bounds.bottom >= worksheet.rowCount || bounds.right >= worksheet.columnCount) {
          throw new WorkbookError(CELL_OUT_OF_RANGE_MESSAGE, 400);
        }
        worksheet.filter = normalizeFilter(range, rules);
        workbook.updatedAt = now();
        updated = structuredClone(workbook);
      });
      return updated;
    },

    /** Removes the filter view of one worksheet: every source row becomes visible again. */
    async clearFilter(id, worksheetId) {
      let updated = null;
      await store.update((draft) => {
        const workbook = draft.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
        if (!worksheet) throw new WorkbookError(WORKSHEET_NOT_FOUND_MESSAGE, 404);
        delete worksheet.filter;
        workbook.updatedAt = now();
        updated = structuredClone(workbook);
      });
      return updated;
    },

    /**
     * Applies a dropdown/number rule to the submitted range. Re-saving the same range
     * replaces the previous rule; a rejected payload changes nothing.
     */
    async setValidation(id, worksheetId, payload = {}) {
      let updated = null;
      await store.update((draft) => {
        const workbook = draft.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
        if (!worksheet) throw new WorkbookError(WORKSHEET_NOT_FOUND_MESSAGE, 404);

        const rule = buildValidationRule(payload);
        const bounds = filterBounds(rule.range);
        const existing = Array.isArray(worksheet.validations) ? worksheet.validations : [];
        const kept = existing.filter((candidate) => {
          if (candidate?.range === rule.range) return false;
          const candidateBounds = filterBounds(candidate?.range);
          return !(candidateBounds && containedIn(candidateBounds, bounds));
        });
        worksheet.validations = [...kept, rule];
        workbook.updatedAt = now();
        updated = structuredClone(workbook);
      });
      return updated;
    },

    /** Removes the rule bound to exactly this range, keeping all cell values untouched. */
    async deleteValidation(id, worksheetId, range) {
      let updated = null;
      await store.update((draft) => {
        const workbook = draft.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
        if (!worksheet) throw new WorkbookError(WORKSHEET_NOT_FOUND_MESSAGE, 404);
        const bounds = filterBounds(range);
        if (!bounds) throw new WorkbookError(VALIDATION_RANGE_REQUIRED_MESSAGE, 400);
        const canonical = rangeName(bounds);
        const kept = (Array.isArray(worksheet.validations) ? worksheet.validations : [])
          .filter((candidate) => candidate?.range !== canonical);
        if (kept.length > 0) worksheet.validations = kept;
        else delete worksheet.validations;
        workbook.updatedAt = now();
        updated = structuredClone(workbook);
      });
      return updated;
    },

    /** Stores the most recent successful selection of one worksheet without touching content. */
    async setSelection(id, worksheetId, selection) {
      let updated = null;
      await store.update((draft) => {
        const workbook = draft.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
        if (!worksheet) throw new WorkbookError(WORKSHEET_NOT_FOUND_MESSAGE, 404);
        worksheet.selection = normalizeSelection(worksheet, selection);
        updated = structuredClone(workbook);
      });
      return updated;
    },

    /** Renames one worksheet; validation runs before any change so failures keep the previous name. */
    async renameWorksheet(id, worksheetId, name) {
      let updated = null;
      await store.update((draft) => {
        const workbook = draft.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
        if (!worksheet) throw new WorkbookError(WORKSHEET_NOT_FOUND_MESSAGE, 404);

        const trimmed = normalizeName(name);
        if (!trimmed) throw new WorkbookError(WORKSHEET_NAME_EMPTY_MESSAGE, 400);
        if (workbook.worksheets.some((candidate) => candidate !== worksheet && candidate.name === trimmed)) {
          throw new WorkbookError(WORKSHEET_NAME_EXISTS_MESSAGE, 400);
        }

        worksheet.name = trimmed;
        workbook.updatedAt = now();
        updated = structuredClone(workbook);
      });
      return updated;
    },

    async update(id, changes = {}) {
      let updated = null;
      await store.update((draft) => {
        const workbook = draft.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new WorkbookError(WORKBOOK_NOT_FOUND_MESSAGE, 404);

        if (Object.hasOwn(changes, "name")) {
          const trimmed = normalizeName(changes.name);
          if (!trimmed) throw new WorkbookError(WORKBOOK_NAME_EMPTY_MESSAGE, 400);
          workbook.name = trimmed;
        }

        if (Object.hasOwn(changes, "activeWorksheetId")) {
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === changes.activeWorksheetId);
          if (!worksheet) throw new WorkbookError(WORKSHEET_NOT_FOUND_MESSAGE, 404);
          workbook.activeWorksheetId = worksheet.id;
        }

        workbook.updatedAt = now();
        updated = structuredClone(workbook);
      });
      return updated;
    },
  };
}
