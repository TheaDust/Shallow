import { randomUUID } from "node:crypto";

import { CsvFormatError, parseCsv, workbookNameFromFileName } from "./csv.mjs";
import { DomainError } from "./errors.mjs";
import { normalizeFilter } from "./filter.mjs";
import { contentExtent, parseCellName, toCellName } from "./grid.mjs";
import {
  computePivotResult,
  normalizePivotFields,
  pivotHeaderColumns,
  SELECT_FIELDS_MESSAGE,
  SOURCE_RANGE_MESSAGE,
} from "./pivot.mjs";
import { normalizeSortRequest, sortWorksheetCells } from "./sort.mjs";
import {
  COLUMN_ACTIONS,
  ROW_ACTIONS,
  shiftPivotSourceRange,
  shiftWorksheetStructure,
} from "./structure.mjs";
import { checkValidationError, normalizeValidationRules } from "./validation.mjs";

// Coordinate helpers live in `grid.mjs` so the structure operations can reuse
// them without a circular import; they stay re-exported here for existing callers.
export { columnName, contentExtent, parseCellName, toCellName } from "./grid.mjs";
export { DomainError } from "./errors.mjs";

export const DEFAULT_ROW_COUNT = 50;
export const DEFAULT_COLUMN_COUNT = 26;
export const DEFAULT_WORKBOOK_NAME = "Untitled workbook";

/** A workbook always keeps one worksheet (REQ-2-1-4). */
export const LAST_WORKSHEET_MESSAGE = "A workbook must contain at least one worksheet";
/** A worksheet a pivot worksheet still reads cannot be deleted first (REQ-2-1-4). */
export const PIVOT_DEPENDENCY_MESSAGE = "Please delete or rebuild dependent pivot tables first";

/**
 * Evaluation seed: workbook `Q3 Sales` with worksheets `Sheet1`/`Sheet2`.
 * Sheet1 carries the shared sales region `A1:C4` with headers
 * `Region/Sales/Status` and the rows `East/1200/Open`, `North/800/Closed` and
 * `South/700/Open`, which is the data every organization feature (sort,
 * filter, validation, pivot, CSV export) reads. Sheet2 of the same workbook
 * carries the formula seed (REQ-4): `A1=2`, `B1=3` and the formulas `=A1+B1`
 * (5) and `=C1*2` (10), a directly-dependent chain that shows a calculated
 * result and its source values.
 * The timestamp is fixed so the "Last updated" value is stable for a fresh store.
 */
export const SEED_UPDATED_AT = "2026-09-29T09:15:00.000Z";

/**
 * A worksheet carries its grid structure (rowCount/columnCount) plus the used
 * rectangle (usedRows/usedCols) that CSV export writes out. The used rectangle
 * never shrinks, so empty fields and empty trailing coordinates survive. A
 * worksheet cannot be rectangularly parsed cell by cell because cells are stored
 * sparsely, so the used rectangle is the persisted extent of written values and
 * truncated coordinates from an import.
 */
export function createWorksheet(id, name, cells = {}, extent = {}) {
  const computed = contentExtent(cells);
  const usedRows = Math.max(computed.rows, toCount(extent.rows));
  const usedCols = Math.max(computed.cols, toCount(extent.cols));
  return {
    id,
    name,
    rowCount: Math.max(DEFAULT_ROW_COUNT, usedRows),
    columnCount: Math.max(DEFAULT_COLUMN_COUNT, usedCols),
    usedRows,
    usedCols,
    cells: { ...cells },
  };
}

function toCount(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

/**
 * Stored selection of one worksheet: the complete rectangle (REQ-3-1-3), not
 * just its top-left corner. A collapsed selection has anchor === focus.
 */
export function originSelection() {
  return { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } };
}

/** Reads one stored cell ref, accepting the legacy `{ row, col }` shape. */
function readSelectionRef(value, fallback) {
  const source = value && typeof value === "object" ? value : fallback;
  const row = Number(source?.row);
  const col = Number(source?.col);
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) return null;
  return { row, col };
}

/**
 * Normalizes a stored or requested selection into `{ anchor, focus }`. A legacy
 * top-left-only selection becomes a collapsed rectangle at that coordinate.
 */
export function normalizeSelection(value) {
  const anchor = readSelectionRef(value?.anchor ?? value, null);
  if (!anchor) return null;
  const focus = readSelectionRef(value?.focus ?? value?.anchor ?? value, anchor);
  if (!focus) return null;
  return { anchor, focus };
}

function worksheetNameKey(name) {
  return String(name ?? "").trim().toLowerCase();
}

/**
 * Trims and validates a worksheet name inside one workbook (REQ-2-1-3): the
 * name must not be empty and must be unique among the other worksheets, which
 * excludes the worksheet being renamed so a pure reformat stays valid.
 */
function normalizeWorksheetName(workbook, rawName, selfId) {
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) throw new DomainError("Worksheet name cannot be empty", 400);
  const key = worksheetNameKey(name);
  const clash = workbook.worksheets.some(
    (worksheet) => worksheet.id !== selfId && worksheetNameKey(worksheet.name) === key,
  );
  if (clash) throw new DomainError("Worksheet name already exists", 400);
  return name;
}

/** First unused `SheetN` (positive-integer order) inside one workbook (REQ-2-1-1). */
export function firstUnusedWorksheetName(worksheets) {
  const taken = new Set((worksheets ?? []).map((worksheet) => worksheetNameKey(worksheet.name)));
  let index = 1;
  while (taken.has(`sheet${index}`)) index += 1;
  return `Sheet${index}`;
}

/** First unused `PivotN` (positive-integer order) inside one workbook (REQ-5-3-1). */
export function firstUnusedPivotName(worksheets) {
  const taken = new Set((worksheets ?? []).map((worksheet) => worksheetNameKey(worksheet.name)));
  let index = 1;
  while (taken.has(`pivot${index}`)) index += 1;
  return `Pivot${index}`;
}

export function createSeedState() {
  const sheet1 = "q3-sales-sheet1";
  const sheet2 = "q3-sales-sheet2";
  return {
    workbooks: [
      {
        id: "q3-sales",
        name: "Q3 Sales",
        updatedAt: SEED_UPDATED_AT,
        activeWorksheetId: sheet1,
        worksheets: [
          createWorksheet(sheet1, "Sheet1", {
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
          }),
          createWorksheet(sheet2, "Sheet2", {
            A1: "2",
            B1: "3",
            C1: "=A1+B1",
            D1: "=C1*2",
          }),
        ],
        selections: {
          [sheet1]: originSelection(),
          [sheet2]: originSelection(),
        },
      },
    ],
  };
}

export function slugify(value) {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "workbook";
}

/** Converts a parsed CSV grid into a sparse cell map plus its used rectangle. */
export function gridToCells(grid) {
  const cells = {};
  let cols = 0;
  grid.forEach((row, rowIndex) => {
    cols = Math.max(cols, row.length);
    row.forEach((value, colIndex) => {
      if (value === "") return;
      cells[toCellName(rowIndex, colIndex)] = value;
    });
  });
  return { cells, rows: grid.length, cols };
}

const EXPLICIT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Client-supplied opaque id used when the browser creates a workbook. */
function explicitWorkbookId(input) {
  const value = typeof input?.id === "string" ? input.id.trim() : "";
  return EXPLICIT_ID.test(value) ? value : "";
}

function uniqueId(state, base) {
  const taken = new Set(state.workbooks.map((workbook) => workbook.id));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function findWorkbook(state, id) {
  const workbook = state.workbooks.find((candidate) => candidate.id === id);
  if (!workbook) throw new DomainError("Workbook not found", 404);
  return workbook;
}

function findWorksheet(workbook, worksheetId) {
  const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
  if (!worksheet) throw new DomainError("Worksheet not found", 404);
  return worksheet;
}

function toSummary(workbook) {
  return {
    id: workbook.id,
    name: workbook.name,
    updatedAt: workbook.updatedAt,
    worksheetCount: workbook.worksheets.length,
  };
}

export function createWorkbookService(store) {
  /**
   * Writes one computed pivot result into its own worksheet. The result
   * completely replaces the previous summary (cells and used rectangle), while
   * the source worksheet is only read.
   */
  function applyPivotResult(worksheet, result) {
    worksheet.cells = result.cells;
    worksheet.usedRows = result.usedRows;
    worksheet.usedCols = result.usedCols;
    worksheet.rowCount = Math.max(DEFAULT_ROW_COUNT, result.usedRows + 1);
    worksheet.columnCount = Math.max(DEFAULT_COLUMN_COUNT, result.usedCols + 1);
  }

  /** Source worksheet and stored configuration of one pivot worksheet. */
  function readPivot(workbook, worksheet) {
    const pivot = worksheet.pivot;
    if (!pivot || typeof pivot !== "object") {
      throw new DomainError("This worksheet is not a pivot table", 400);
    }
    return { pivot, source: findWorksheet(workbook, pivot.sourceWorksheetId) };
  }

  return {
    async list() {
      const state = await store.read();
      return state.workbooks.map(toSummary);
    },

    async get(id) {
      const state = await store.read();
      return findWorkbook(state, id);
    },

    async create(input = {}) {
      const requested = typeof input?.name === "string" ? input.name.trim() : "";
      const name = requested || DEFAULT_WORKBOOK_NAME;
      const explicitId = explicitWorkbookId(input);
      let createdId = explicitId;
      const state = await store.update((draft) => {
        // A client-supplied id makes creation idempotent: replaying the same
        // request (for example after a page reload cancels the first one)
        // returns the existing workbook instead of a second record.
        if (explicitId) {
          if (draft.workbooks.some((workbook) => workbook.id === explicitId)) return draft;
          createdId = explicitId;
        } else {
          createdId = uniqueId(draft, slugify(name));
        }
        const worksheetId = `ws-${randomUUID()}`;
        draft.workbooks.push({
          id: createdId,
          name,
          updatedAt: new Date().toISOString(),
          activeWorksheetId: worksheetId,
          worksheets: [createWorksheet(worksheetId, "Sheet1")],
          selections: { [worksheetId]: originSelection() },
        });
        return draft;
      });
      return state.workbooks.find((workbook) => workbook.id === createdId);
    },

    /**
     * Creates a workbook from an uploaded CSV file. The parse happens before any
     * write, so invalid input leaves the store untouched (no partial import).
     */
    async importCsv(input = {}) {
      const content = typeof input?.content === "string" ? input.content : "";
      let grid;
      try {
        grid = parseCsv(content);
      } catch (error) {
        if (error instanceof CsvFormatError) throw new DomainError(error.message, 400);
        throw error;
      }
      const requestedName = typeof input?.name === "string" ? input.name.trim() : "";
      const name = workbookNameFromFileName(input?.fileName) || requestedName || DEFAULT_WORKBOOK_NAME;
      const { cells, rows, cols } = gridToCells(grid);
      return store.update((state) => {
        const worksheetId = `ws-${randomUUID()}`;
        const workbook = {
          id: uniqueId(state, slugify(name)),
          name,
          updatedAt: new Date().toISOString(),
          activeWorksheetId: worksheetId,
          worksheets: [createWorksheet(worksheetId, "Sheet1", cells, { rows, cols })],
          selections: { [worksheetId]: originSelection() },
        };
        state.workbooks.push(workbook);
        return state;
      }).then((state) => state.workbooks[state.workbooks.length - 1]);
    },

    async rename(id, rawName) {
      const name = typeof rawName === "string" ? rawName.trim() : "";
      if (!name) throw new DomainError("Workbook name cannot be empty", 400);
      const state = await store.update((draft) => {
        const workbook = findWorkbook(draft, id);
        workbook.name = name;
        workbook.updatedAt = new Date().toISOString();
        return draft;
      });
      return findWorkbook(state, id);
    },

    async updateState(id, patch = {}) {
      const state = await store.update((draft) => {
        const workbook = findWorkbook(draft, id);
        if (typeof patch.activeWorksheetId === "string") {
          workbook.activeWorksheetId = findWorksheet(workbook, patch.activeWorksheetId).id;
        }
        const selection = patch.selection;
        if (selection && typeof selection === "object") {
          const worksheet = findWorksheet(workbook, selection.worksheetId);
          // The whole rectangle is stored (REQ-3-1-3); a legacy top-left-only
          // payload collapses to a single cell instead of losing the selection.
          const rectangle = normalizeSelection(selection);
          if (!rectangle) throw new DomainError("Invalid selection", 400);
          workbook.selections = { ...(workbook.selections ?? {}), [worksheet.id]: rectangle };
        }
        return draft;
      });
      return findWorkbook(state, id);
    },

    /**
     * Appends a blank worksheet (REQ-2-1-1): named after the first unused
     * `SheetN`, made active with A1 selected, and with no filters, validation or
     * pivot state copied from the other worksheets.
     */
    async addWorksheet(id) {
      const state = await store.update((draft) => {
        const workbook = findWorkbook(draft, id);
        const worksheetId = `ws-${randomUUID()}`;
        workbook.worksheets.push(
          createWorksheet(worksheetId, firstUnusedWorksheetName(workbook.worksheets)),
        );
        workbook.activeWorksheetId = worksheetId;
        workbook.selections = { ...(workbook.selections ?? {}), [worksheetId]: originSelection() };
        workbook.updatedAt = new Date().toISOString();
        return draft;
      });
      return findWorkbook(state, id);
    },

    /**
     * Removes one worksheet (REQ-2-1-4). Every rule is checked before the store
     * is touched: a workbook keeps at least one worksheet, and a worksheet that
     * a pivot-result worksheet still reads is rejected until that pivot table is
     * deleted or rebuilt. On success the tab disappears together with its own
     * grid, formulas, filter view, validation rules and pivot results; when the
     * removed worksheet was active an adjacent worksheet becomes active, and the
     * stored selection of the removed worksheet is dropped.
     */
    async deleteWorksheet(id, worksheetId) {
      const state = await store.update((draft) => {
        const workbook = findWorkbook(draft, id);
        const index = workbook.worksheets.findIndex((candidate) => candidate.id === worksheetId);
        if (index < 0) throw new DomainError("Worksheet not found", 404);
        if (workbook.worksheets.length <= 1) {
          throw new DomainError(LAST_WORKSHEET_MESSAGE, 400);
        }
        const dependent = workbook.worksheets.some(
          (candidate) => candidate.pivot && candidate.pivot.sourceWorksheetId === worksheetId,
        );
        if (dependent) throw new DomainError(PIVOT_DEPENDENCY_MESSAGE, 400);
        workbook.worksheets.splice(index, 1);
        if (workbook.selections) delete workbook.selections[worksheetId];
        if (workbook.activeWorksheetId === worksheetId) {
          // The worksheet that slid into the removed slot, or the new last one.
          const adjacent = workbook.worksheets[Math.min(index, workbook.worksheets.length - 1)];
          workbook.activeWorksheetId = adjacent.id;
        }
        workbook.updatedAt = new Date().toISOString();
        return draft;
      });
      return findWorkbook(state, id);
    },

    /** Renames one worksheet inside its workbook (REQ-2-1-3). */
    async renameWorksheet(id, worksheetId, rawName) {
      const state = await store.update((draft) => {
        const workbook = findWorkbook(draft, id);
        const worksheet = findWorksheet(workbook, worksheetId);
        worksheet.name = normalizeWorksheetName(workbook, rawName, worksheet.id);
        workbook.updatedAt = new Date().toISOString();
        return draft;
      });
      return findWorkbook(state, id);
    },

    /**
     * Inserts or deletes one row/column of the current worksheet (REQ-2-2). The
     * target and all later coordinates move together, formulas keep adjusted
     * references (an unpreservable direct reference becomes `#REF!`) and every
     * other worksheet stays untouched. The action and index are validated before
     * any write, so a rejected change keeps the last successful structure.
     */
    async changeStructure(id, worksheetId, axis, input = {}) {
      const actions = axis === "row" ? ROW_ACTIONS : COLUMN_ACTIONS;
      const action = typeof input?.action === "string" ? input.action : "";
      if (!actions.includes(action)) {
        throw new DomainError(axis === "row" ? "Unknown row action" : "Unknown column action", 400);
      }
      const index = input?.index;
      if (!Number.isInteger(index) || index < 0) {
        throw new DomainError("Structure index out of range", 400);
      }
      const state = await store.update((draft) => {
        const workbook = findWorkbook(draft, id);
        const worksheet = findWorksheet(workbook, worksheetId);
        const limit = axis === "row" ? worksheet.rowCount : worksheet.columnCount;
        if (index >= limit) throw new DomainError("Structure index out of range", 400);
        Object.assign(worksheet, shiftWorksheetStructure(worksheet, axis, action, index));
        // A pivot that reads this worksheet keeps its source range in step with
        // the moved cells, so a later refresh summarizes the adjusted region.
        for (const candidate of workbook.worksheets) {
          if (candidate.pivot && candidate.pivot.sourceWorksheetId === worksheet.id) {
            candidate.pivot = shiftPivotSourceRange(candidate.pivot, axis, action, index);
          }
        }
        // A shifted filter/rule set that no longer constrains anything is removed
        // instead of staying as a null or empty key in the stored worksheet.
        if (worksheet.filter === null || worksheet.filter === undefined) delete worksheet.filter;
        if (!Array.isArray(worksheet.validations) || !worksheet.validations.length) delete worksheet.validations;
        workbook.updatedAt = new Date().toISOString();
        return draft;
      });
      return findWorkbook(state, id);
    },

    /**
     * Replaces the complete content state of one worksheet (undo/redo of
     * REQ-3-2-2). The caller sends a snapshot it captured earlier, so the whole
     * payload is validated before any write: an invalid coordinate or
     * non-string value leaves the stored worksheet exactly as it was.
     */
    async replaceWorksheet(id, worksheetId, input = {}) {
      const cellsInput = input?.cells;
      if (!cellsInput || typeof cellsInput !== "object" || Array.isArray(cellsInput)) {
        throw new DomainError("cells must be an object", 400);
      }
      const changes = [];
      for (const [name, value] of Object.entries(cellsInput)) {
        const ref = parseCellName(name);
        if (!ref) throw new DomainError(`Invalid cell reference: ${name}`, 400);
        if (value !== null && typeof value !== "string") {
          throw new DomainError(`Invalid cell value for ${name}`, 400);
        }
        // Empty text means "no stored value", exactly like `updateCells`.
        if (!value) continue;
        changes.push({ key: name.toUpperCase(), ref, value });
      }
      const state = await store.update((draft) => {
        const workbook = findWorkbook(draft, id);
        const worksheet = findWorksheet(workbook, worksheetId);
        const cells = {};
        for (const change of changes) cells[change.key] = change.value;
        const extent = contentExtent(cells);
        const usedRows = Math.max(extent.rows, toCount(input.usedRows));
        const usedCols = Math.max(extent.cols, toCount(input.usedCols));
        worksheet.cells = cells;
        worksheet.usedRows = usedRows;
        worksheet.usedCols = usedCols;
        worksheet.rowCount = Math.max(DEFAULT_ROW_COUNT, usedRows + 1, toCount(input.rowCount));
        worksheet.columnCount = Math.max(DEFAULT_COLUMN_COUNT, usedCols + 1, toCount(input.columnCount));
        // Rule ranges travel with the snapshot when it carries them; a payload
        // without them leaves the stored rules alone (so undoing an edit taken
        // before a rule was added cannot silently drop that rule).
        if (Array.isArray(input.validations)) {
          worksheet.validations = input.validations.map((rule) => ({ ...rule }));
        }
        // Same for the filter of the worksheet (REQ-5-1-2): only an explicit
        // `filter` key touches it, `null` clears it.
        if (input && Object.prototype.hasOwnProperty.call(input, "filter")) {
          const filter = normalizeFilter(input.filter);
          if (filter) worksheet.filter = filter;
          else delete worksheet.filter;
        }
        workbook.updatedAt = new Date().toISOString();
        return draft;
      });
      return findWorkbook(state, id);
    },

    /**
     * Replaces the complete validation rule list of one worksheet (REQ-5-2-1).
     * The dialog computes the new list (the rule it saved with every overlapping
     * rule removed) and the whole payload is validated before the store is
     * touched, so a rejected save keeps the previously stored rules.
     */
    async replaceValidations(id, worksheetId, input = {}) {
      const raw = input && typeof input === "object" && "validations" in input ? input.validations : input;
      const rules = normalizeValidationRules(raw);
      const state = await store.update((draft) => {
        const workbook = findWorkbook(draft, id);
        const worksheet = findWorksheet(workbook, worksheetId);
        if (rules.length) worksheet.validations = rules;
        else delete worksheet.validations;
        workbook.updatedAt = new Date().toISOString();
        return draft;
      });
      return findWorkbook(state, id);
    },

    /**
     * Stores the filter of one worksheet, or clears it with an explicit `null`
     * ("Clear filter", REQ-5-1-2). The payload is normalized before any write,
     * so an unknown condition leaves the stored filter untouched.
     */
    async setFilter(id, worksheetId, input = {}) {
      const raw = input && typeof input === "object" && "filter" in input ? input.filter : null;
      const filter = normalizeFilter(raw);
      const state = await store.update((draft) => {
        const workbook = findWorkbook(draft, id);
        const worksheet = findWorksheet(workbook, worksheetId);
        if (filter) worksheet.filter = filter;
        else delete worksheet.filter;
        workbook.updatedAt = new Date().toISOString();
        return draft;
      });
      return findWorkbook(state, id);
    },

    /**
     * Sorts the selected rectangle of one worksheet (REQ-5-1-1). The request is
     * validated (range inside the sheet, known order, column inside the range)
     * and the new row order is computed before the store is touched, so a
     * rejected sort leaves the grid in its original order. Only the rows of the
     * rectangle move: values outside it, the used rectangle, the validation
     * rules and the filter view stay exactly as they were.
     */
    async sortRange(id, worksheetId, input = {}) {
      const state = await store.update((draft) => {
        const workbook = findWorkbook(draft, id);
        const worksheet = findWorksheet(workbook, worksheetId);
        const request = normalizeSortRequest(input, worksheet);
        if (request.range.maxRow >= worksheet.rowCount || request.range.maxCol >= worksheet.columnCount) {
          throw new DomainError("Sort range is outside the worksheet", 400);
        }
        worksheet.cells = sortWorksheetCells(worksheet, request);
        workbook.updatedAt = new Date().toISOString();
        return draft;
      });
      return findWorkbook(state, id);
    },

    /**
     * Creates a pivot-result worksheet from one source range (REQ-5-3-1). The
     * source range is validated before the store is touched and the new
     * worksheet is named after the first unused `PivotN` (Pivot1 when none
     * exists); it starts blank and becomes the active worksheet. The source
     * worksheet keeps every value and coordinate.
     */
    async createPivot(id, input = {}) {
      const sourceWorksheetId = typeof input?.sourceWorksheetId === "string" ? input.sourceWorksheetId : "";
      const range = typeof input?.range === "string" ? input.range.trim().toUpperCase() : "";
      const state = await store.update((draft) => {
        const workbook = findWorkbook(draft, id);
        const source = sourceWorksheetId
          ? findWorksheet(workbook, sourceWorksheetId)
          : findWorksheet(workbook, workbook.activeWorksheetId);
        const { region, headers } = pivotHeaderColumns(source, range);
        if (!region || region.maxRow >= source.rowCount || region.maxCol >= source.columnCount) {
          throw new DomainError(SOURCE_RANGE_MESSAGE, 400);
        }
        if (!headers.length) {
          throw new DomainError("The pivot source range needs a header row", 400);
        }
        const worksheetId = `ws-${randomUUID()}`;
        const worksheet = createWorksheet(worksheetId, firstUnusedPivotName(workbook.worksheets));
        worksheet.pivot = {
          sourceWorksheetId: source.id,
          sourceRange: range,
          rowField: "",
          columnField: "",
          valueField: "",
          summarizeBy: "SUM",
        };
        workbook.worksheets.push(worksheet);
        workbook.activeWorksheetId = worksheetId;
        workbook.selections = { ...(workbook.selections ?? {}), [worksheetId]: originSelection() };
        workbook.updatedAt = new Date().toISOString();
        return draft;
      });
      return findWorkbook(state, id);
    },

    /**
     * Stores the chosen fields of one pivot worksheet and replaces its summary
     * with the fresh computation ("Apply"). Every field is resolved against the
     * current header row of the stored source range before anything is written,
     * so a deleted header keeps the last successful result and both worksheets.
     */
    async configurePivot(id, worksheetId, input = {}) {
      const fields = normalizePivotFields(input);
      const state = await store.update((draft) => {
        const workbook = findWorkbook(draft, id);
        const worksheet = findWorksheet(workbook, worksheetId);
        const { pivot, source } = readPivot(workbook, worksheet);
        const next = { ...pivot, ...fields };
        const result = computePivotResult({ worksheet: source, pivot: next });
        worksheet.pivot = next;
        applyPivotResult(worksheet, result);
        workbook.updatedAt = new Date().toISOString();
        return draft;
      });
      return findWorkbook(state, id);
    },

    /**
     * Recomputes one pivot worksheet from the current source content ("Refresh
     * pivot table"). The stored configuration is used as-is, so a source header
     * that was deleted since the last apply is reported as an unusable field and
     * the previous summary survives intact.
     */
    async refreshPivot(id, worksheetId) {
      const state = await store.update((draft) => {
        const workbook = findWorkbook(draft, id);
        const worksheet = findWorksheet(workbook, worksheetId);
        const { pivot, source } = readPivot(workbook, worksheet);
        if (!pivot.rowField || !pivot.valueField) throw new DomainError(SELECT_FIELDS_MESSAGE, 400);
        const result = computePivotResult({ worksheet: source, pivot });
        applyPivotResult(worksheet, result);
        workbook.updatedAt = new Date().toISOString();
        return draft;
      });
      return findWorkbook(state, id);
    },

    async updateCells(id, worksheetId, cells) {
      if (!cells || typeof cells !== "object" || Array.isArray(cells)) {
        throw new DomainError("cells must be an object", 400);
      }
      const state = await store.update((draft) => {
        const workbook = findWorkbook(draft, id);
        const worksheet = findWorksheet(workbook, worksheetId);
        // Validate the complete batch before touching the grid: a rejected cell
        // (validation rule, invalid coordinate) leaves every target cell and the
        // rest of the workbook exactly as it was (REQ-3-1-2).
        const changes = [];
        for (const [name, value] of Object.entries(cells)) {
          const ref = parseCellName(name);
          if (!ref) throw new DomainError(`Invalid cell reference: ${name}`, 400);
          if (value !== null && typeof value !== "string") {
            throw new DomainError(`Invalid cell value for ${name}`, 400);
          }
          changes.push({ key: name.toUpperCase(), ref, value: value ? value : null });
        }
        for (const change of changes) {
          const message = checkValidationError(worksheet, change.ref, change.value);
          if (message) throw new DomainError(message, 400);
        }
        const next = { ...worksheet.cells };
        for (const change of changes) {
          if (change.value === null) delete next[change.key];
          else next[change.key] = change.value;
          worksheet.rowCount = Math.max(worksheet.rowCount, change.ref.row + 1);
          worksheet.columnCount = Math.max(worksheet.columnCount, change.ref.col + 1);
          // The used rectangle only grows; exported empty cells inside it stay empty.
          worksheet.usedRows = Math.max(worksheet.usedRows ?? 0, change.ref.row + 1);
          worksheet.usedCols = Math.max(worksheet.usedCols ?? 0, change.ref.col + 1);
        }
        worksheet.cells = next;
        workbook.updatedAt = new Date().toISOString();
        return draft;
      });
      return findWorkbook(state, id);
    },
  };
}
