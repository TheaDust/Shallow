import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { createJsonStore } from "../lib/json-store.mjs";
import { NotFoundError, ValidationError } from "../lib/errors.mjs";
import { cellName, cellsFromRows, columnName, parseArea, parseCellName } from "../domain/grid.mjs";
import {
  STRUCTURE_AXES,
  STRUCTURE_MODES,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  shiftFilter,
  shiftPivot,
  shiftRuleRanges,
} from "../domain/structure.mjs";
import { FILTER_CONDITIONS } from "../domain/filter.mjs";
import {
  NAMED_RANGE_DUPLICATE_MESSAGE,
  UNKNOWN_NAMED_RANGE_MESSAGE,
  normalizeNamedRangeName,
  normalizeNamedRangeReference,
  shiftNamedRanges,
} from "../domain/named-range.mjs";
import {
  UNKNOWN_CONDITIONAL_FORMAT_MESSAGE,
  normalizeConditionalFormat,
  shiftConditionalFormats,
} from "../domain/conditional-format.mjs";
import {
  normalizeNoteCoordinate,
  normalizeNoteText,
  shiftNotes,
} from "../domain/notes.mjs";
import { SORT_ORDERS, sortRangeCells } from "../domain/sort.mjs";
import { DROPDOWN_TYPE, NUMBER_RANGE_TYPE, firstValidationError } from "../domain/validation.mjs";
import {
  INVALID_PIVOT_MESSAGE,
  PIVOT_SOURCE_MISSING_MESSAGE,
  buildPivotCells,
  defaultPivotConfig,
  nextPivotName,
  normalizePivotConfig,
} from "../domain/pivot.mjs";

// The HTTP layer only knows these two error types; they stay importable here.
export { NotFoundError, ValidationError };

/** Seeded workbook shown on the home page for a fresh (empty) data directory. */
export const SEED_WORKBOOK_ID = "wb-q3-sales";
export const SEED_WORKSHEET_ID = "ws-q3-sheet1";
export const SEED_SECOND_WORKSHEET_ID = "ws-q3-sheet2";
export const SEED_CREATED_AT = "2026-09-21T09:00:00.000Z";
export const SEED_UPDATED_AT = "2026-09-28T14:05:00.000Z";
export const DEFAULT_WORKBOOK_NAME = "Untitled workbook";
export const DEFAULT_WORKSHEET_NAME = "Sheet1";
/** Longest workbook name accepted after trimming. */
export const WORKBOOK_NAME_MAX_LENGTH = 80;
/** Longest worksheet name accepted after trimming. */
export const WORKSHEET_NAME_MAX_LENGTH = 50;
export const EMPTY_NAME_MESSAGE = "Workbook name cannot be empty";
export const LONG_NAME_MESSAGE = "Workbook name must be 80 characters or fewer";
export const DUPLICATE_NAME_MESSAGE = "Workbook name already exists";
export const EMPTY_WORKSHEET_NAME_MESSAGE = "Worksheet name cannot be empty";
export const LONG_WORKSHEET_NAME_MESSAGE = "Worksheet name must be 50 characters or fewer";
export const DUPLICATE_WORKSHEET_NAME_MESSAGE = "Worksheet name already exists";
export const LAST_WORKSHEET_MESSAGE = "A workbook must contain at least one worksheet";
export const PIVOT_SOURCE_DEPENDENCY_MESSAGE = "Please delete or rebuild dependent pivot tables first";
export const INVALID_CSV_MESSAGE = "Invalid CSV file format. Import failed.";
export const UNKNOWN_CELL_MESSAGE = "Unknown cell reference";
export const INVALID_CELL_VALUE_MESSAGE = "Cell value must be a string";
export const INVALID_STRUCTURE_MESSAGE = "Invalid row or column change";
export const INVALID_RANGE_MESSAGE = "Invalid cell range update";
export const INVALID_TRANSFER_MESSAGE = "Invalid range transfer";
export const INVALID_STATE_MESSAGE = "Invalid worksheet state";
export const INVALID_RULE_MESSAGE = "Invalid validation rule";
export const INVALID_FILTER_MESSAGE = "Invalid filter";
export const DUPLICATE_FILTER_VIEW_MESSAGE = "Filter view name already exists";
export const EMPTY_FILTER_VIEW_NAME_MESSAGE = "Filter view name cannot be empty";
export const UNKNOWN_FILTER_VIEW_MESSAGE = "Unknown filter view";
export const INVALID_SORT_MESSAGE = "Invalid sort request";
export const INVALID_FREEZE_MESSAGE = "Invalid freeze panes";
export const INVALID_CELL_UPDATE_MESSAGE = "Invalid cell update";

/** Selection of a worksheet with no recorded history: cell A1. */
export const DEFAULT_SELECTION = { anchor: "A1", focus: "A1" };

/**
 * Pre-provisioned workbooks of the workbook-rename scenarios. Their id is the
 * initial visible name, so a home-page link and the deep link
 * `#/workbooks/<name>` both reach the same workbook; renaming keeps the id.
 */
export const EVO_RENAME_WORKBOOK_ID = "EVO-M01-RENAME-OK";
export const EVO_RENAME_WORKSHEET_ID = "ws-evo-rename-ok-identitylog";
export const EVO_RENAME_DUP_WORKBOOK_ID = "EVO-M01-RENAME-DUP";
export const EVO_RENAME_DUP_WORKSHEET_ID = "ws-evo-rename-dup-identitylog";
export const EVO_ARCHIVE_WORKBOOK_ID = "EVO-M01-ARCHIVE-RESERVED";
export const EVO_ARCHIVE_WORKSHEET_ID = "ws-evo-archive-reserved-sheet1";
export const EVO_RENAME_LIMIT_WORKBOOK_ID = "EVO-M01-RENAME-LIMIT";
export const EVO_RENAME_LIMIT_WORKSHEET_ID = "ws-evo-rename-limit-limitprobe";

/** One seeded worksheet with its stable id, visible name and seeded cells. */
function seedWorksheet({ id, name, cells = {}, validationRules, filterViews, conditionalFormats, notes }) {
  const worksheet = { id, name, selection: { ...DEFAULT_SELECTION }, cells };
  if (Array.isArray(validationRules)) worksheet.validationRules = validationRules;
  if (Array.isArray(filterViews)) worksheet.filterViews = filterViews;
  if (Array.isArray(conditionalFormats)) worksheet.conditionalFormats = conditionalFormats;
  if (notes && Object.keys(notes).length > 0) worksheet.notes = { ...notes };
  return worksheet;
}

/**
 * One seeded workbook whose visible name equals its stable id, so the home-page
 * link and the deep link `#/workbooks/<id>` both reach it while the id survives
 * later renames. `worksheets` keeps the stored order; `activeWorksheetId` picks
 * the active tab (the first worksheet when omitted).
 */
function seedWorkbook({ id, worksheets, createdAt, updatedAt, activeWorksheetId, namedRanges }) {
  const workbook = {
    id,
    name: id,
    createdAt,
    updatedAt,
    activeWorksheetId: activeWorksheetId ?? worksheets[0].id,
    worksheets,
  };
  if (Array.isArray(namedRanges)) workbook.namedRanges = namedRanges;
  return workbook;
}

/** Stable ids of the worksheet-rename scenarios added in this round. */
export const EVO_SHEET_OK_WORKBOOK_ID = "EVO-M02-SHEET-OK";
export const EVO_SHEET_OK_HARBOR_WORKSHEET_ID = "ws-evo-m02-sheet-ok-harbordraft";
export const EVO_SHEET_OK_LEDGER_WORKSHEET_ID = "ws-evo-m02-sheet-ok-ledgerview";
export const EVO_SHEET_DUP_WORKBOOK_ID = "EVO-M02-SHEET-DUP";
export const EVO_SHEET_DUP_MERIDIAN_WORKSHEET_ID = "ws-evo-m02-sheet-dup-meridian";
export const EVO_SHEET_DUP_ARCHIVE_WORKSHEET_ID = "ws-evo-m02-sheet-dup-archivebay";
export const EVO_SHEET_LIMIT_WORKBOOK_ID = "EVO-M02-SHEET-LIMIT";
export const EVO_SHEET_LIMIT_WORKSHEET_ID = "ws-evo-m02-sheet-limit-lengthgauge";

/** Stable ids of the clear-with-Delete scenarios added in this round. */
export const EVO_CLEAR_TEXT_WORKBOOK_ID = "EVO-M03-CLEAR-TEXT";
export const EVO_CLEAR_TEXT_WORKSHEET_ID = "ws-evo-m03-clear-text-staging";
export const EVO_CLEAR_FORMULA_WORKBOOK_ID = "EVO-M03-CLEAR-FORMULA";
export const EVO_CLEAR_FORMULA_WORKSHEET_ID = "ws-evo-m03-clear-formula-calculations";
export const EVO_CLEAR_RANGE_WORKBOOK_ID = "EVO-M03-CLEAR-RANGE";
export const EVO_CLEAR_RANGE_WORKSHEET_ID = "ws-evo-m03-clear-range-matrix";

/** Stable ids of the saved-filter-view scenarios added in this round. */
export const EVO_FILTER_SAVE_WORKBOOK_ID = "EVO-M04-FILTER-SAVE";
export const EVO_FILTER_SAVE_WORKSHEET_ID = "ws-evo-m04-filter-save-workload";
export const EVO_FILTER_APPLY_WORKBOOK_ID = "EVO-M04-FILTER-APPLY";
export const EVO_FILTER_APPLY_WORKSHEET_ID = "ws-evo-m04-filter-apply-workload";
export const EVO_FILTER_DELETE_WORKBOOK_ID = "EVO-M04-FILTER-DELETE";
export const EVO_FILTER_DELETE_WORKSHEET_ID = "ws-evo-m04-filter-delete-workload";
export const EVO_FILTER_VIEW_APPLY_ID = "fv-evo-m04-apply-queued";
export const EVO_FILTER_VIEW_DELETE_ID = "fv-evo-m04-delete-queued";

/** Stable ids of the freeze-panes scenarios added in this round. */
export const EVO_FREEZE_ROW_WORKBOOK_ID = "EVO-N01-FREEZE-ROW";
export const EVO_FREEZE_ROW_WORKSHEET_ID = "ws-evo-n01-freeze-row-scrollledger";
export const EVO_FREEZE_COLUMN_WORKBOOK_ID = "EVO-N01-FREEZE-COLUMN";
export const EVO_FREEZE_COLUMN_WORKSHEET_ID = "ws-evo-n01-freeze-column-scrollledger";
export const EVO_FREEZE_BOTH_WORKBOOK_ID = "EVO-N01-FREEZE-BOTH";
export const EVO_FREEZE_BOTH_WORKSHEET_ID = "ws-evo-n01-freeze-both-scrollledger";

/** Stable ids of the find-and-replace scenarios added in this round. */
export const EVO_FIND_NEXT_WORKBOOK_ID = "EVO-N02-FIND-NEXT";
export const EVO_FIND_NEXT_WORKSHEET_ID = "ws-evo-n02-find-next-narrative";
export const EVO_REPLACE_ALL_WORKBOOK_ID = "EVO-N02-REPLACE-ALL";
export const EVO_REPLACE_ALL_WORKSHEET_ID = "ws-evo-n02-replace-all-narrative";
export const EVO_CASE_SENSITIVE_WORKBOOK_ID = "EVO-N02-CASE-SENSITIVE";
export const EVO_CASE_SENSITIVE_WORKSHEET_ID = "ws-evo-n02-case-sensitive-narrative";

/** Stable ids of the custom-validation-message scenarios added in this round. */
export const EVO_VALIDATION_FORMULA_WORKBOOK_ID = "EVO-M05-VALIDATION-FORMULA";
export const EVO_VALIDATION_FORMULA_WORKSHEET_ID = "ws-evo-m05-validation-formula-thresholds";
export const EVO_VALIDATION_GRID_WORKBOOK_ID = "EVO-M05-VALIDATION-GRID";
export const EVO_VALIDATION_GRID_WORKSHEET_ID = "ws-evo-m05-validation-grid-thresholds";
export const EVO_VALIDATION_EDIT_WORKBOOK_ID = "EVO-M05-VALIDATION-EDIT";
export const EVO_VALIDATION_EDIT_WORKSHEET_ID = "ws-evo-m05-validation-edit-thresholds";

/** Stable ids of the named-range scenarios added in this round. */
export const EVO_NAMED_CREATE_WORKBOOK_ID = "EVO-N03-NAMED-CREATE";
export const EVO_NAMED_CREATE_WORKSHEET_ID = "ws-evo-n03-named-create-forecastmodel";
export const EVO_NAMED_INVALID_WORKBOOK_ID = "EVO-N03-NAMED-INVALID";
export const EVO_NAMED_INVALID_WORKSHEET_ID = "ws-evo-n03-named-invalid-forecastmodel";
export const EVO_NAMED_UPDATE_WORKBOOK_ID = "EVO-N03-NAMED-UPDATE";
export const EVO_NAMED_UPDATE_WORKSHEET_ID = "ws-evo-n03-named-update-forecastmodel";
export const EVO_NAMED_UPDATE_RANGE_ID = "nr-evo-n03-named-update-marginbase";

/** Stable ids of the conditional-formatting scenarios added in this round. */
export const EVO_FORMAT_NUMBER_WORKBOOK_ID = "EVO-N04-FORMAT-NUMBER";
export const EVO_FORMAT_NUMBER_WORKSHEET_ID = "ws-evo-n04-format-number-signals";
export const EVO_FORMAT_TEXT_WORKBOOK_ID = "EVO-N04-FORMAT-TEXT";
export const EVO_FORMAT_TEXT_WORKSHEET_ID = "ws-evo-n04-format-text-signals";
export const EVO_FORMAT_EDIT_WORKBOOK_ID = "EVO-N04-FORMAT-EDIT";
export const EVO_FORMAT_EDIT_WORKSHEET_ID = "ws-evo-n04-format-edit-signals";
export const EVO_FORMAT_EDIT_RULE_ID = "cf-evo-n04-format-edit-1";

/** Stable ids of the cell-note scenarios added in this round. */
export const EVO_NOTE_CREATE_WORKBOOK_ID = "EVO-N05-NOTE-CREATE";
export const EVO_NOTE_CREATE_WORKSHEET_ID = "ws-evo-n05-note-create-reviewqueue";
export const EVO_NOTE_EDIT_WORKBOOK_ID = "EVO-N05-NOTE-EDIT";
export const EVO_NOTE_EDIT_WORKSHEET_ID = "ws-evo-n05-note-edit-reviewqueue";
export const EVO_NOTE_DELETE_WORKBOOK_ID = "EVO-N05-NOTE-DELETE";
export const EVO_NOTE_DELETE_WORKSHEET_ID = "ws-evo-n05-note-delete-reviewqueue";

/** Records of the `Workload` worksheet: range D3:F7 with headers in row 3. */
const WORKLOAD_CELLS = {
  D3: "Workstream",
  E3: "Phase",
  F3: "Load",
  D4: "Atlas",
  E4: "Queued",
  F4: "17",
  D5: "Atlas",
  E5: "Active",
  F5: "31",
  D6: "Beacon",
  E6: "Queued",
  F6: "22",
  D7: "Cirrus",
  E7: "Queued",
  F7: "9",
};

/** Saved view accepting only `Queued` phases of the `Workload` range D3:F7. */
function queuedLanesView(id) {
  return {
    id,
    name: "Queued lanes",
    range: "D3:F7",
    columns: [{ column: 5, header: "Phase", mode: "values", values: ["Queued"] }],
  };
}

/** Header texts of a `ScrollLedger` worksheet, one per column from A on. */
const SCROLL_HEADERS = [
  "Entry",
  "Amount",
  "Status",
  "Owner",
  "Region",
  "Quarter",
  "Channel",
  "Margin",
  "Units",
  "Target",
  "Delta",
  "Notes",
];
const SCROLL_STATES = ["Open", "Closed", "Pending"];

/** Deterministic value of one `ScrollLedger` data cell (rows start at 2). */
function scrollCellValue(row, column) {
  if (column === 1) return `Entry ${row}`;
  if (column === 2) return String(1000 + row * 7);
  if (column === 3) return SCROLL_STATES[(row - 2) % SCROLL_STATES.length];
  return `${columnName(column)}-${row}`;
}

/**
 * `ScrollLedger` table of a freeze-panes workbook: `SCROLL_HEADERS` in row 1
 * and one deterministic record per row up to `rows`, over the first `columns`
 * columns. The scenario text fixes the extent of the table (rows through 40,
 * columns through L), not the individual values.
 */
function scrollLedgerCells({ rows, columns }) {
  const cells = {};
  for (let column = 1; column <= columns; column += 1) {
    cells[cellName(1, column)] = SCROLL_HEADERS[column - 1] ?? `Field ${columnName(column)}`;
  }
  for (let row = 2; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      cells[cellName(row, column)] = scrollCellValue(row, column);
    }
  }
  return cells;
}

/**
 * Shared evaluation seed. Worksheet `Sheet1` holds the seeded cell `A1 = Region`
 * plus the header row and region rows other requirements reference on the same
 * workbook (`Region/Sales/Status`, `East/1200/Open`, `North/800/Closed`,
 * `South/700/Open`). A second, blank `Sheet2` is seeded so the workbook has two
 * independent worksheets out of the box.
 */
export function createSeedState() {
  return {
    workbooks: [
      {
        id: SEED_WORKBOOK_ID,
        name: "Q3 Sales",
        createdAt: SEED_CREATED_AT,
        updatedAt: SEED_UPDATED_AT,
        activeWorksheetId: SEED_WORKSHEET_ID,
        worksheets: [
          {
            id: SEED_WORKSHEET_ID,
            name: DEFAULT_WORKSHEET_NAME,
            selection: { anchor: "A1", focus: "A1" },
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
          },
          {
            id: SEED_SECOND_WORKSHEET_ID,
            name: "Sheet2",
            selection: { anchor: "A1", focus: "A1" },
            cells: {},
          },
        ],
      },
      seedWorkbook({
        id: EVO_RENAME_WORKBOOK_ID,
        worksheets: [seedWorksheet({ id: EVO_RENAME_WORKSHEET_ID, name: "IdentityLog", cells: { F3: "unreviewed" } })],
        createdAt: "2026-09-05T08:00:00.000Z",
        updatedAt: "2026-09-06T08:00:00.000Z",
      }),
      seedWorkbook({
        id: EVO_RENAME_DUP_WORKBOOK_ID,
        worksheets: [seedWorksheet({ id: EVO_RENAME_DUP_WORKSHEET_ID, name: "IdentityLog" })],
        createdAt: "2026-09-05T08:05:00.000Z",
        updatedAt: "2026-09-06T08:05:00.000Z",
      }),
      seedWorkbook({
        id: EVO_ARCHIVE_WORKBOOK_ID,
        worksheets: [seedWorksheet({ id: EVO_ARCHIVE_WORKSHEET_ID, name: "Sheet1" })],
        createdAt: "2026-09-05T08:10:00.000Z",
        updatedAt: "2026-09-06T08:10:00.000Z",
      }),
      seedWorkbook({
        id: EVO_RENAME_LIMIT_WORKBOOK_ID,
        worksheets: [seedWorksheet({ id: EVO_RENAME_LIMIT_WORKSHEET_ID, name: "LimitProbe", cells: { C2: "limit sentinel" } })],
        createdAt: "2026-09-05T08:15:00.000Z",
        updatedAt: "2026-09-06T08:15:00.000Z",
      }),
      // Worksheet-rename scenarios: `HarborDraft` stays active with its sentinel
      // cell while `LedgerView` is the sibling name a rename must not collide with.
      seedWorkbook({
        id: EVO_SHEET_OK_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({ id: EVO_SHEET_OK_HARBOR_WORKSHEET_ID, name: "HarborDraft", cells: { D5: "dock marker" } }),
          seedWorksheet({ id: EVO_SHEET_OK_LEDGER_WORKSHEET_ID, name: "LedgerView" }),
        ],
        createdAt: "2026-09-05T08:20:00.000Z",
        updatedAt: "2026-09-06T08:20:00.000Z",
      }),
      // Case-insensitive duplicate: `ArchiveBay` is active and `Meridian` already
      // occupies the name a differently-cased rename would take.
      seedWorkbook({
        id: EVO_SHEET_DUP_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({ id: EVO_SHEET_DUP_MERIDIAN_WORKSHEET_ID, name: "Meridian" }),
          seedWorksheet({ id: EVO_SHEET_DUP_ARCHIVE_WORKSHEET_ID, name: "ArchiveBay" }),
        ],
        activeWorksheetId: EVO_SHEET_DUP_ARCHIVE_WORKSHEET_ID,
        createdAt: "2026-09-05T08:25:00.000Z",
        updatedAt: "2026-09-06T08:25:00.000Z",
      }),
      seedWorkbook({
        id: EVO_SHEET_LIMIT_WORKBOOK_ID,
        worksheets: [seedWorksheet({ id: EVO_SHEET_LIMIT_WORKSHEET_ID, name: "LengthGauge", cells: { G4: "sheet sentinel" } })],
        createdAt: "2026-09-05T08:30:00.000Z",
        updatedAt: "2026-09-06T08:30:00.000Z",
      }),
      // Clear-with-Delete scenarios: one text cell, a formula with a directly
      // dependent formula, and a 2x2 rectangle whose rows are read in row order.
      seedWorkbook({
        id: EVO_CLEAR_TEXT_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({ id: EVO_CLEAR_TEXT_WORKSHEET_ID, name: "Staging", cells: { H4: "obsolete tag" } }),
        ],
        createdAt: "2026-09-05T08:35:00.000Z",
        updatedAt: "2026-09-06T08:35:00.000Z",
      }),
      seedWorkbook({
        id: EVO_CLEAR_FORMULA_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_CLEAR_FORMULA_WORKSHEET_ID,
            name: "Calculations",
            cells: { B7: "13", C7: "=B7*5", D7: "=C7+2" },
          }),
        ],
        createdAt: "2026-09-05T08:40:00.000Z",
        updatedAt: "2026-09-06T08:40:00.000Z",
      }),
      seedWorkbook({
        id: EVO_CLEAR_RANGE_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_CLEAR_RANGE_WORKSHEET_ID,
            name: "Matrix",
            cells: { H4: "Amber", I4: "Delta", H5: "Kite", I5: "Orchid" },
          }),
        ],
        createdAt: "2026-09-05T08:45:00.000Z",
        updatedAt: "2026-09-06T08:45:00.000Z",
      }),
      // Saved-filter-view scenarios: the same `Workload` records, with no view
      // yet in the save scenario and the pre-provisioned `Queued lanes` view in
      // the apply and delete scenarios.
      seedWorkbook({
        id: EVO_FILTER_SAVE_WORKBOOK_ID,
        worksheets: [seedWorksheet({ id: EVO_FILTER_SAVE_WORKSHEET_ID, name: "Workload", cells: { ...WORKLOAD_CELLS } })],
        createdAt: "2026-09-05T08:50:00.000Z",
        updatedAt: "2026-09-06T08:50:00.000Z",
      }),
      seedWorkbook({
        id: EVO_FILTER_APPLY_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_FILTER_APPLY_WORKSHEET_ID,
            name: "Workload",
            cells: { ...WORKLOAD_CELLS },
            filterViews: [queuedLanesView(EVO_FILTER_VIEW_APPLY_ID)],
          }),
        ],
        createdAt: "2026-09-05T08:55:00.000Z",
        updatedAt: "2026-09-06T08:55:00.000Z",
      }),
      seedWorkbook({
        id: EVO_FILTER_DELETE_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_FILTER_DELETE_WORKSHEET_ID,
            name: "Workload",
            cells: { ...WORKLOAD_CELLS },
            filterViews: [queuedLanesView(EVO_FILTER_VIEW_DELETE_ID)],
          }),
        ],
        createdAt: "2026-09-05T09:00:00.000Z",
        updatedAt: "2026-09-06T09:00:00.000Z",
      }),
      // Custom-validation-message scenarios: one constrained cell each, with an
      // `errorMessage` that replaces the standard rejection text.
      seedWorkbook({
        id: EVO_VALIDATION_FORMULA_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_VALIDATION_FORMULA_WORKSHEET_ID,
            name: "Thresholds",
            cells: { J6: "37" },
            validationRules: [
              {
                range: "J6",
                type: "number-range",
                min: 25,
                max: 75,
                errorMessage: "Capacity must be from 25 to 75",
              },
            ],
          }),
        ],
        createdAt: "2026-09-05T09:05:00.000Z",
        updatedAt: "2026-09-06T09:05:00.000Z",
      }),
      seedWorkbook({
        id: EVO_VALIDATION_GRID_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_VALIDATION_GRID_WORKSHEET_ID,
            name: "Thresholds",
            cells: { K8: "Ready" },
            validationRules: [
              {
                range: "K8",
                type: "dropdown",
                values: ["Ready", "Holding", "Released"],
                errorMessage: "Choose a queue state",
              },
            ],
          }),
        ],
        createdAt: "2026-09-05T09:10:00.000Z",
        updatedAt: "2026-09-06T09:10:00.000Z",
      }),
      seedWorkbook({
        id: EVO_VALIDATION_EDIT_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_VALIDATION_EDIT_WORKSHEET_ID,
            name: "Thresholds",
            cells: { L4: "42" },
            validationRules: [
              {
                range: "L4",
                type: "number-range",
                min: 25,
                max: 75,
                errorMessage: "Capacity must be from 25 to 75",
              },
            ],
          }),
        ],
        createdAt: "2026-09-05T09:15:00.000Z",
        updatedAt: "2026-09-06T09:15:00.000Z",
      }),
      // Freeze-panes scenarios: the same `ScrollLedger` sheet, grown either
      // through row 40, through column L or through both.
      seedWorkbook({
        id: EVO_FREEZE_ROW_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_FREEZE_ROW_WORKSHEET_ID,
            name: "ScrollLedger",
            cells: scrollLedgerCells({ rows: 40, columns: 3 }),
          }),
        ],
        createdAt: "2026-09-05T09:20:00.000Z",
        updatedAt: "2026-09-06T09:20:00.000Z",
      }),
      seedWorkbook({
        id: EVO_FREEZE_COLUMN_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_FREEZE_COLUMN_WORKSHEET_ID,
            name: "ScrollLedger",
            cells: scrollLedgerCells({ rows: 8, columns: 12 }),
          }),
        ],
        createdAt: "2026-09-05T09:25:00.000Z",
        updatedAt: "2026-09-06T09:25:00.000Z",
      }),
      seedWorkbook({
        id: EVO_FREEZE_BOTH_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_FREEZE_BOTH_WORKSHEET_ID,
            name: "ScrollLedger",
            cells: scrollLedgerCells({ rows: 40, columns: 12 }),
          }),
        ],
        createdAt: "2026-09-05T09:30:00.000Z",
        updatedAt: "2026-09-06T09:30:00.000Z",
      }),
      // Find-and-replace scenarios: one `Narrative` sheet each, whose matching
      // cells differ per scenario. No other cell of a sheet equals `Cobalt`
      // without regard to letter case apart from the scenario's own cells.
      seedWorkbook({
        id: EVO_FIND_NEXT_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_FIND_NEXT_WORKSHEET_ID,
            name: "Narrative",
            cells: { D4: "Batch", E4: "Cobalt", D7: "Batch", E7: "Cobalt", D11: "Batch", E11: "Cobalt" },
          }),
        ],
        createdAt: "2026-09-05T09:35:00.000Z",
        updatedAt: "2026-09-06T09:35:00.000Z",
      }),
      seedWorkbook({
        id: EVO_REPLACE_ALL_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_REPLACE_ALL_WORKSHEET_ID,
            name: "Narrative",
            cells: { F3: "Cobalt", F6: "Cobalt", F9: "Cobalt", F12: "Copper" },
          }),
        ],
        createdAt: "2026-09-05T09:40:00.000Z",
        updatedAt: "2026-09-06T09:40:00.000Z",
      }),
      seedWorkbook({
        id: EVO_CASE_SENSITIVE_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_CASE_SENSITIVE_WORKSHEET_ID,
            name: "Narrative",
            cells: { G3: "Cobalt", G4: "cobalt", G5: "Cobalt-7" },
          }),
        ],
        createdAt: "2026-09-05T09:45:00.000Z",
        updatedAt: "2026-09-06T09:45:00.000Z",
      }),
      // Named-range scenarios: one `ForecastModel` sheet each. The create and
      // invalid scenarios start without a stored name; the update scenario is
      // pre-provisioned with `MarginBase` and a formula that already reads it.
      seedWorkbook({
        id: EVO_NAMED_CREATE_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_NAMED_CREATE_WORKSHEET_ID,
            name: "ForecastModel",
            cells: { J3: "18", J4: "24", J5: "31" },
          }),
        ],
        createdAt: "2026-09-05T09:50:00.000Z",
        updatedAt: "2026-09-06T09:50:00.000Z",
      }),
      seedWorkbook({
        id: EVO_NAMED_INVALID_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_NAMED_INVALID_WORKSHEET_ID,
            name: "ForecastModel",
            cells: { K2: "6", K3: "14" },
          }),
        ],
        createdAt: "2026-09-05T09:52:00.000Z",
        updatedAt: "2026-09-06T09:52:00.000Z",
      }),
      seedWorkbook({
        id: EVO_NAMED_UPDATE_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_NAMED_UPDATE_WORKSHEET_ID,
            name: "ForecastModel",
            cells: { K2: "5", K3: "8", K4: "12", M2: "=SUM(MarginBase)" },
          }),
        ],
        namedRanges: [
          {
            id: EVO_NAMED_UPDATE_RANGE_ID,
            name: "MarginBase",
            range: "ForecastModel!K2:K3",
          },
        ],
        createdAt: "2026-09-05T09:54:00.000Z",
        updatedAt: "2026-09-06T09:54:00.000Z",
      }),
      // Conditional-formatting scenarios: one `Signals` sheet each, with the
      // edit scenario's rule 1 already stored over `L3:L5`.
      seedWorkbook({
        id: EVO_FORMAT_NUMBER_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_FORMAT_NUMBER_WORKSHEET_ID,
            name: "Signals",
            cells: { J4: "11", J5: "29", J6: "46" },
          }),
        ],
        createdAt: "2026-09-05T09:56:00.000Z",
        updatedAt: "2026-09-06T09:56:00.000Z",
      }),
      seedWorkbook({
        id: EVO_FORMAT_TEXT_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_FORMAT_TEXT_WORKSHEET_ID,
            name: "Signals",
            cells: { K4: "Watch", K5: "Stable", K6: "Elevated" },
          }),
        ],
        createdAt: "2026-09-05T09:58:00.000Z",
        updatedAt: "2026-09-06T09:58:00.000Z",
      }),
      seedWorkbook({
        id: EVO_FORMAT_EDIT_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_FORMAT_EDIT_WORKSHEET_ID,
            name: "Signals",
            cells: { L3: "16", L4: "28", L5: "39" },
            conditionalFormats: [
              {
                id: EVO_FORMAT_EDIT_RULE_ID,
                range: "L3:L5",
                condition: "Greater than",
                value: "20",
                style: "Red fill",
              },
            ],
          }),
        ],
        createdAt: "2026-09-05T10:00:00.000Z",
        updatedAt: "2026-09-06T10:00:00.000Z",
      }),
      // Cell-note scenarios: one `ReviewQueue` sheet each, where the create
      // scenario starts without a note, and the edit and delete scenarios are
      // pre-provisioned with the note their scenario opens.
      seedWorkbook({
        id: EVO_NOTE_CREATE_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({ id: EVO_NOTE_CREATE_WORKSHEET_ID, name: "ReviewQueue", cells: { D8: "Manifest R41" } }),
        ],
        createdAt: "2026-09-05T10:05:00.000Z",
        updatedAt: "2026-09-06T10:05:00.000Z",
      }),
      seedWorkbook({
        id: EVO_NOTE_EDIT_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_NOTE_EDIT_WORKSHEET_ID,
            name: "ReviewQueue",
            cells: { F6: "Gate Rho" },
            notes: { F6: "Awaiting controller sign-off" },
          }),
        ],
        createdAt: "2026-09-05T10:08:00.000Z",
        updatedAt: "2026-09-06T10:08:00.000Z",
      }),
      seedWorkbook({
        id: EVO_NOTE_DELETE_WORKBOOK_ID,
        worksheets: [
          seedWorksheet({
            id: EVO_NOTE_DELETE_WORKSHEET_ID,
            name: "ReviewQueue",
            cells: { J3: "Route Zeta" },
            notes: { J3: "Retire after audit" },
          }),
        ],
        createdAt: "2026-09-05T10:11:00.000Z",
        updatedAt: "2026-09-06T10:11:00.000Z",
      }),
    ],
  };
}

/**
 * Appends every seed workbook whose stable id is absent from `state`, leaving
 * stored records and user changes untouched. Called on every store creation, so
 * a store created before this round gains the new pre-provisioned workbooks
 * without duplicating them on later starts.
 */
export function mergeSeedWorkbooks(state) {
  const workbooks = Array.isArray(state.workbooks) ? state.workbooks : (state.workbooks = []);
  const known = new Set(workbooks.map((workbook) => workbook?.id));
  for (const seed of createSeedState().workbooks) {
    if (!known.has(seed.id)) workbooks.push(seed);
  }
}

export function summarizeWorkbook(workbook) {
  return {
    id: workbook.id,
    name: workbook.name,
    createdAt: workbook.createdAt,
    updatedAt: workbook.updatedAt,
    activeWorksheetId: workbook.activeWorksheetId,
    worksheetCount: workbook.worksheets.length,
  };
}

/**
 * Workbook name of a rename after trimming: non-empty, at most
 * `WORKBOOK_NAME_MAX_LENGTH` characters and not already taken by another
 * workbook of the same store, compared without regard to letter case. The
 * workbook being renamed is excluded, so changing only the case of its own name
 * is accepted. Every rejection throws before the atomic write happens.
 */
function normalizeName(value, workbooks, workbookId) {
  if (typeof value !== "string") throw new ValidationError(EMPTY_NAME_MESSAGE);
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(EMPTY_NAME_MESSAGE);
  if (trimmed.length > WORKBOOK_NAME_MAX_LENGTH) throw new ValidationError(LONG_NAME_MESSAGE);
  const wanted = trimmed.toLowerCase();
  const taken = (Array.isArray(workbooks) ? workbooks : []).some(
    (candidate) =>
      candidate?.id !== workbookId &&
      typeof candidate?.name === "string" &&
      candidate.name.trim().toLowerCase() === wanted,
  );
  if (taken) throw new ValidationError(DUPLICATE_NAME_MESSAGE);
  return trimmed;
}

/**
 * Name for a newly created workbook. Creation may omit the name entirely, in
 * which case the blank workbook keeps the default `Untitled workbook` name;
 * renaming an existing workbook still rejects an empty name.
 */
/**
 * Worksheet name of a rename after trimming: non-empty and at most
 * `WORKSHEET_NAME_MAX_LENGTH` characters. The uniqueness rule is applied by the
 * caller, which knows the other names of the same workbook. Every rejection
 * throws before the atomic write happens.
 */
function normalizeWorksheetName(value) {
  if (typeof value !== "string") throw new ValidationError(EMPTY_WORKSHEET_NAME_MESSAGE);
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(EMPTY_WORKSHEET_NAME_MESSAGE);
  if (trimmed.length > WORKSHEET_NAME_MAX_LENGTH) throw new ValidationError(LONG_WORKSHEET_NAME_MESSAGE);
  return trimmed;
}

/**
 * True when another worksheet of the same workbook already uses `name`,
 * compared without regard to letter case. The worksheet being renamed is
 * excluded, so changing only the case of its own name is accepted.
 */
function worksheetNameTaken(worksheets, name, worksheetId) {
  const wanted = name.toLowerCase();
  return worksheets.some(
    (candidate) =>
      candidate?.id !== worksheetId &&
      typeof candidate?.name === "string" &&
      candidate.name.trim().toLowerCase() === wanted,
  );
}

/**
 * First unused `SheetN` name in positive-integer order, so a workbook with
 * only `Sheet1` yields `Sheet2` and one with `Sheet1`/`Sheet2` yields `Sheet3`.
 */
export function nextWorksheetName(worksheets) {
  const used = new Set(worksheets.map((worksheet) => worksheet.name));
  let index = 1;
  while (used.has(`Sheet${index}`)) index += 1;
  return `Sheet${index}`;
}

function normalizeCreateName(value) {
  if (typeof value !== "string") return DEFAULT_WORKBOOK_NAME;
  return value.trim() || DEFAULT_WORKBOOK_NAME;
}

/** 1-based line index of a row/column change, or throws `ValidationError`. */
function normalizeLineIndex(value) {
  if (!Number.isInteger(value) || value < 1) throw new ValidationError(INVALID_STRUCTURE_MESSAGE);
  return value;
}

/** Non-negative count of frozen rows or columns, or throws `ValidationError`. */
function normalizeFrozenCount(value) {
  if (!Number.isInteger(value) || value < 0) throw new ValidationError(INVALID_FREEZE_MESSAGE);
  return value;
}

/** Maps a structure request onto the pure domain change, or throws `ValidationError`. */
function structureChange(cells, { axis, mode, index }) {
  if (!STRUCTURE_AXES.includes(axis) || !STRUCTURE_MODES.includes(mode)) {
    throw new ValidationError(INVALID_STRUCTURE_MESSAGE);
  }
  const target = normalizeLineIndex(index);
  if (mode === "delete") {
    return axis === "row" ? deleteRow(cells, target) : deleteColumn(cells, target);
  }
  const at = mode === "insert-after" ? target + 1 : target;
  return axis === "row" ? insertRow(cells, at) : insertColumn(cells, at);
}

/** Uppercases and validates an A1 coordinate, or throws `ValidationError`. */
function normalizeCoordinate(value) {
  const parsed = typeof value === "string" ? parseCellName(value) : null;
  if (!parsed) throw new ValidationError(UNKNOWN_CELL_MESSAGE);
  return cellName(parsed.row, parsed.column);
}

/**
 * Canonical A1 area for a rule: a single cell stays `A1`, a rectangle becomes
 * `A1:B2` with top-left/bottom-right ordering. Throws `ValidationError` for
 * anything that is not an A1 cell or area.
 */
function normalizeRuleRange(value) {
  if (typeof value !== "string") throw new ValidationError(INVALID_RULE_MESSAGE);
  const parts = value.trim().split(":");
  if (parts.length < 1 || parts.length > 2) throw new ValidationError(INVALID_RULE_MESSAGE);
  const first = parseCellName(parts[0]);
  const last = parts.length === 2 ? parseCellName(parts[1]) : first;
  if (!first || !last) throw new ValidationError(INVALID_RULE_MESSAGE);
  const top = Math.min(first.row, last.row);
  const bottom = Math.max(first.row, last.row);
  const left = Math.min(first.column, last.column);
  const right = Math.max(first.column, last.column);
  const start = cellName(top, left);
  const end = cellName(bottom, right);
  return start === end ? start : `${start}:${end}`;
}

/** Validated, canonical rule payload, or throws `ValidationError`. */
function normalizeRule({ range, type, min, max, values, errorMessage } = {}) {
  const normalizedRange = normalizeRuleRange(range);
  const message = typeof errorMessage === "string" ? errorMessage.trim() : "";
  const custom = message === "" ? {} : { errorMessage: message };
  if (type === NUMBER_RANGE_TYPE) {
    const low = typeof min === "number" ? min : Number(min);
    const high = typeof max === "number" ? max : Number(max);
    if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) {
      throw new ValidationError(INVALID_RULE_MESSAGE);
    }
    return { range: normalizedRange, type, min: low, max: high, ...custom };
  }
  if (type === DROPDOWN_TYPE) {
    const allowed = Array.isArray(values)
      ? values.map((value) => String(value).trim()).filter((value) => value !== "")
      : [];
    if (allowed.length === 0) throw new ValidationError(INVALID_RULE_MESSAGE);
    return { range: normalizedRange, type, values: allowed, ...custom };
  }
  throw new ValidationError(INVALID_RULE_MESSAGE);
}

/** True when two rule ranges cover the same rectangle. */
function sameRuleRange(a, b) {
  try {
    return normalizeRuleRange(a) === normalizeRuleRange(b);
  } catch {
    return false;
  }
}

/** Validated, canonical filter view, or throws `ValidationError`. */
function normalizeFilter(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(INVALID_FILTER_MESSAGE);
  }
  let range;
  try {
    range = normalizeRuleRange(value.range);
  } catch {
    // A malformed area is a filter error here, not a rule error.
    throw new ValidationError(INVALID_FILTER_MESSAGE);
  }
  if (!Array.isArray(value.columns)) throw new ValidationError(INVALID_FILTER_MESSAGE);
  const columns = value.columns.map((column) => {
    if (column === null || typeof column !== "object" || Array.isArray(column)) {
      throw new ValidationError(INVALID_FILTER_MESSAGE);
    }
    const index = column.column;
    if (!Number.isInteger(index) || index < 1) throw new ValidationError(INVALID_FILTER_MESSAGE);
    const header = typeof column.header === "string" ? column.header : "";
    if (column.mode === "values") {
      const values = Array.isArray(column.values) ? column.values.map((entry) => String(entry)) : [];
      return { column: index, header, mode: "values", values };
    }
    if (column.mode === "condition") {
      if (!FILTER_CONDITIONS.includes(column.condition)) throw new ValidationError(INVALID_FILTER_MESSAGE);
      const text = typeof column.value === "string" ? column.value : "";
      return { column: index, header, mode: "condition", condition: column.condition, value: text };
    }
    throw new ValidationError(INVALID_FILTER_MESSAGE);
  });
  return { range, columns };
}

/**
 * Deep copy of a filter view's criteria (range plus column rules), so a saved
 * view and the filter currently applied never share mutable arrays.
 */
function copyFilterCriteria(filter) {
  return {
    range: filter.range,
    columns: filter.columns.map((column) => ({
      ...column,
      ...(Array.isArray(column.values) ? { values: [...column.values] } : {}),
    })),
  };
}

/** Trimmed name of a filter view to save; an empty one is rejected. */
function normalizeFilterViewName(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed === "") throw new ValidationError(EMPTY_FILTER_VIEW_NAME_MESSAGE);
  return trimmed;
}

/**
 * True when `name` is already used by a saved view of `workbook`. Uniqueness
 * spans the whole workbook and ignores letter case, so ` queued lanes ` cannot
 * be stored next to `Queued lanes`.
 */
function filterViewNameTaken(workbook, name) {
  const wanted = name.toLowerCase();
  return workbook.worksheets.some((worksheet) =>
    (Array.isArray(worksheet.filterViews) ? worksheet.filterViews : []).some(
      (view) => String(view?.name ?? "").trim().toLowerCase() === wanted,
    ),
  );
}

/** Canonical A1 area of a pivot's source range, or throws `ValidationError`. */
function normalizePivotRange(value) {
  const bounds = typeof value === "string" ? parseArea(value) : null;
  if (!bounds) throw new ValidationError(INVALID_PIVOT_MESSAGE);
  const start = cellName(bounds.top, bounds.left);
  const end = cellName(bounds.bottom, bounds.right);
  return start === end ? start : `${start}:${end}`;
}

/**
 * Recomputes one pivot worksheet from its source worksheet inside the current
 * draft: the field layout is stored and the summary replaces the worksheet's
 * cells. A field that is no longer a header of the stored range rejects before
 * anything is written, so the last successful summary stays visible.
 */
function writePivotTable(workbook, worksheet, config) {
  const source = workbook.worksheets.find((candidate) => candidate.id === worksheet.pivot.sourceWorksheetId);
  if (!source) throw new ValidationError(PIVOT_SOURCE_MISSING_MESSAGE);
  worksheet.cells = buildPivotCells({
    cells: source.cells,
    range: worksheet.pivot.range,
    ...config,
  });
  worksheet.pivot = { ...worksheet.pivot, ...config };
  workbook.updatedAt = new Date().toISOString();
}

/** Workbook name for an imported CSV: the file name without its final `.csv` extension. */
export function workbookNameFromFileName(fileName) {
  const raw = typeof fileName === "string" ? fileName.trim() : "";
  const base = raw.replace(/\.csv$/i, "").trim();
  return base || DEFAULT_WORKBOOK_NAME;
}

function assertRows(rows) {
  if (!Array.isArray(rows)) throw new ValidationError(INVALID_CSV_MESSAGE);
  for (const row of rows) {
    if (!Array.isArray(row)) throw new ValidationError(INVALID_CSV_MESSAGE);
    for (const cell of row) {
      if (typeof cell !== "string") throw new ValidationError(INVALID_CSV_MESSAGE);
    }
  }
}

/** A1-keyed map of text values required by a state restore; anything else is rejected. */
function assertCellMap(cells) {
  if (cells === null || typeof cells !== "object" || Array.isArray(cells)) {
    throw new ValidationError(INVALID_STATE_MESSAGE);
  }
  for (const value of Object.values(cells)) {
    if (typeof value !== "string") throw new ValidationError(INVALID_STATE_MESSAGE);
  }
}

/** Row-major strings required by a bulk range write; anything else is rejected. */
function assertRangeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new ValidationError(INVALID_RANGE_MESSAGE);
  for (const row of rows) {
    if (!Array.isArray(row)) throw new ValidationError(INVALID_RANGE_MESSAGE);
    for (const cell of row) {
      if (typeof cell !== "string") throw new ValidationError(INVALID_RANGE_MESSAGE);
    }
  }
}

export function createWorkbookStore({ dataDir } = {}) {
  const filePath = join(dataDir ?? ".", "workbooks.json");
  const store = createJsonStore(filePath, createSeedState());
  // Seed upgrade of an existing file: it runs once per store and is queued
  // ahead of every later read/update, so a caller never sees a partially
  // migrated store. A store that cannot be written stays readable.
  store.update((state) => {
    mergeSeedWorkbooks(state);
  }).catch(() => undefined);

  return {
    async listWorkbooks() {
      const state = await store.read();
      return [...state.workbooks]
        .sort((a, b) => (a.updatedAt === b.updatedAt ? a.id.localeCompare(b.id) : b.updatedAt.localeCompare(a.updatedAt)))
        .map(summarizeWorkbook);
    },

    async getWorkbook(id) {
      const state = await store.read();
      return state.workbooks.find((workbook) => workbook.id === id) ?? null;
    },

    async createWorkbook({ name } = {}) {
      const now = new Date().toISOString();
      const worksheetId = randomUUID();
      const workbook = {
        id: randomUUID(),
        name: normalizeCreateName(name),
        createdAt: now,
        updatedAt: now,
        activeWorksheetId: worksheetId,
        worksheets: [{ id: worksheetId, name: DEFAULT_WORKSHEET_NAME, selection: { ...DEFAULT_SELECTION }, cells: {} }],
      };
      await store.update((state) => {
        state.workbooks.push(workbook);
      });
      return workbook;
    },

    /**
     * Creates a workbook from parsed CSV rows. The whole import is one atomic
     * write, so a rejected payload leaves the stored state untouched.
     */
    async importWorkbook({ fileName, rows } = {}) {
      assertRows(rows);
      const now = new Date().toISOString();
      const worksheetId = randomUUID();
      const workbook = {
        id: randomUUID(),
        name: workbookNameFromFileName(fileName),
        createdAt: now,
        updatedAt: now,
        activeWorksheetId: worksheetId,
        worksheets: [
          { id: worksheetId, name: DEFAULT_WORKSHEET_NAME, selection: { ...DEFAULT_SELECTION }, cells: cellsFromRows(rows) },
        ],
      };
      await store.update((state) => {
        state.workbooks.push(workbook);
      });
      return workbook;
    },

    /**
     * Writes one cell of one worksheet. An empty string clears the cell, so a
     * cleared cell leaves the used range instead of storing an empty value. The
     * whole update is a single atomic write: a rejected payload (unknown
     * worksheet or malformed coordinate) leaves the stored state untouched.
     */
    async updateCell({ workbookId, worksheetId, coordinate, value } = {}) {
      if (typeof value !== "string") throw new ValidationError(INVALID_CELL_VALUE_MESSAGE);
      const key = normalizeCoordinate(coordinate);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const violation = firstValidationError(worksheet.validationRules, [{ coordinate: key, value }]);
          if (violation) throw new ValidationError(violation);
          if (value === "") {
            delete worksheet.cells[key];
          } else {
            worksheet.cells[key] = value;
          }
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Applies a rectangle of text values starting at `start` (row-major `rows`)
     * in a single atomic write. Every cell in the rectangle is written or
     * cleared together: an unknown coordinate, a malformed payload or any
     * rejected validation target leaves the stored worksheet untouched, so a
     * paste never drops only some of its values.
     */
    async applyCellRange({ workbookId, worksheetId, start, rows } = {}) {
      assertRangeRows(rows);
      const origin = typeof start === "string" ? parseCellName(start) : null;
      if (!origin) throw new ValidationError(UNKNOWN_CELL_MESSAGE);
      const updates = [];
      rows.forEach((row, rowIndex) => {
        row.forEach((value, columnIndex) => {
          updates.push({ coordinate: cellName(origin.row + rowIndex, origin.column + columnIndex), value });
        });
      });
      if (updates.length === 0) throw new ValidationError(INVALID_RANGE_MESSAGE);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const violation = firstValidationError(worksheet.validationRules, updates);
          if (violation) throw new ValidationError(violation);
          for (const { coordinate, value } of updates) {
            if (value === "") delete worksheet.cells[coordinate];
            else worksheet.cells[coordinate] = value;
          }
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Writes an explicit list of cells in one atomic write. Every update is
     * validated against the worksheet's rules before anything is written, so a
     * payload that would break a rule leaves all cells as they were. Used by
     * find-and-replace, whose matching cells are not a rectangle.
     */
    async replaceCells({ workbookId, worksheetId, updates } = {}) {
      if (!Array.isArray(updates) || updates.length === 0) {
        throw new ValidationError(INVALID_CELL_UPDATE_MESSAGE);
      }
      const normalized = updates.map((update) => {
        if (update === null || typeof update !== "object" || Array.isArray(update)) {
          throw new ValidationError(INVALID_CELL_UPDATE_MESSAGE);
        }
        if (typeof update.value !== "string") throw new ValidationError(INVALID_CELL_UPDATE_MESSAGE);
        if (typeof update.coordinate !== "string") throw new ValidationError(INVALID_CELL_UPDATE_MESSAGE);
        return { coordinate: normalizeCoordinate(update.coordinate), value: update.value };
      });
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const violation = firstValidationError(worksheet.validationRules, normalized);
          if (violation) throw new ValidationError(violation);
          for (const { coordinate, value } of normalized) {
            if (value === "") delete worksheet.cells[coordinate];
            else worksheet.cells[coordinate] = value;
          }
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Transfers a rectangle onto `target` in one atomic write: the target cells
     * are written (an empty field clears the cell) and, for a cut, every cell of
     * the optional `source` area that is not part of the target is cleared. The
     * whole transfer is validated against the worksheet's rules before the write,
     * so a rejected move changes neither the source nor the target. Cells outside
     * both rectangles are never touched.
     */
    async transferRange({ workbookId, worksheetId, target, rows, source } = {}) {
      assertRangeRows(rows);
      const origin = typeof target === "string" ? parseCellName(target) : null;
      if (!origin) throw new ValidationError(UNKNOWN_CELL_MESSAGE);
      const clearBounds = source === undefined || source === null || source === "" ? null : parseArea(source);
      if (source !== undefined && source !== null && source !== "" && !clearBounds) {
        throw new ValidationError(INVALID_TRANSFER_MESSAGE);
      }
      const updates = [];
      rows.forEach((row, rowIndex) => {
        row.forEach((value, columnIndex) => {
          updates.push({ coordinate: cellName(origin.row + rowIndex, origin.column + columnIndex), value });
        });
      });
      if (updates.length === 0) throw new ValidationError(INVALID_TRANSFER_MESSAGE);
      const written = new Set(updates.map((update) => update.coordinate));
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const violation = firstValidationError(worksheet.validationRules, updates);
          if (violation) throw new ValidationError(violation);
          for (const { coordinate, value } of updates) {
            if (value === "") delete worksheet.cells[coordinate];
            else worksheet.cells[coordinate] = value;
          }
          if (clearBounds) {
            for (let row = clearBounds.top; row <= clearBounds.bottom; row += 1) {
              for (let column = clearBounds.left; column <= clearBounds.right; column += 1) {
                const coordinate = cellName(row, column);
                if (!written.has(coordinate)) delete worksheet.cells[coordinate];
              }
            }
          }
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Replaces a worksheet's content in one atomic write. Used to restore a
     * previously persisted state (undo/redo); `cells` is an A1-keyed map and
     * `validationRules` an optional rule list. Other worksheets and workbooks
     * are never modified.
     */
    async replaceWorksheetState({ workbookId, worksheetId, cells, validationRules } = {}) {
      assertCellMap(cells);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const next = {};
          for (const [coordinate, value] of Object.entries(cells)) {
            if (value === "") continue;
            const parsed = parseCellName(coordinate);
            if (!parsed) continue;
            next[cellName(parsed.row, parsed.column)] = value;
          }
          worksheet.cells = next;
          if (Array.isArray(validationRules)) worksheet.validationRules = validationRules;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Persists the complete rectangle of a worksheet's most recent successful
     * selection. Only this worksheet changes, so switching ahead and back keeps
     * each worksheet's own rectangle. Selection is view state and does not bump
     * the workbook's last-updated time.
     */
    async selectRange({ workbookId, worksheetId, anchor, focus } = {}) {
      const from = normalizeCoordinate(anchor);
      const to = normalizeCoordinate(focus);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          worksheet.selection = { anchor: from, focus: to };
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Stores the number of frozen rows and columns of one worksheet: the
     * headings that stay put while scrolling. The counts are view state, so no
     * cell value changes and the workbook's last-updated time stays as it was;
     * a rejected payload leaves the stored worksheet untouched.
     */
    async freezeWorksheet({ workbookId, worksheetId, rows, columns } = {}) {
      const frozenRows = normalizeFrozenCount(rows);
      const frozenColumns = normalizeFrozenCount(columns);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          if (frozenRows === 0 && frozenColumns === 0) delete worksheet.frozen;
          else worksheet.frozen = { rows: frozenRows, columns: frozenColumns };
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Creates or replaces the validation rule covering one A1 range. Any
     * existing rule with the same range is replaced, other rules are kept, and
     * the whole change is one atomic write. Cell values are never touched, so a
     * rejected payload leaves the stored worksheet unchanged.
     */
    async setValidationRule({ workbookId, worksheetId, range, type, min, max, values, errorMessage } = {}) {
      const rule = normalizeRule({ range, type, min, max, values, errorMessage });
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const kept = (Array.isArray(worksheet.validationRules) ? worksheet.validationRules : []).filter(
            (existing) => !sameRuleRange(existing?.range, rule.range),
          );
          worksheet.validationRules = [...kept, rule];
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Removes every rule covering the given A1 range in one atomic write. Cell
     * values and the worksheet's other rules are left untouched.
     */
    async deleteValidationRule({ workbookId, worksheetId, range } = {}) {
      const target = normalizeRuleRange(range);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const kept = (Array.isArray(worksheet.validationRules) ? worksheet.validationRules : []).filter(
            (existing) => !sameRuleRange(existing?.range, target),
          );
          if (kept.length === 0) delete worksheet.validationRules;
          else worksheet.validationRules = kept;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Reorders the records of one A1 range by one of its columns in a single
     * atomic write. Every record (the cells of one row inside the range) moves
     * as a unit, so values outside the range and every other worksheet stay as
     * they were, and formula row references follow their record. A rejected
     * payload leaves the stored grid in its original order.
     */
    async sortRange({ workbookId, worksheetId, range, column, order, hasHeaderRow } = {}) {
      const bounds = parseArea(range);
      if (!bounds) throw new ValidationError(INVALID_SORT_MESSAGE);
      if (!Number.isInteger(column) || column < bounds.left || column > bounds.right) {
        throw new ValidationError(INVALID_SORT_MESSAGE);
      }
      if (!SORT_ORDERS.includes(order)) throw new ValidationError(INVALID_SORT_MESSAGE);
      if (typeof hasHeaderRow !== "boolean") throw new ValidationError(INVALID_SORT_MESSAGE);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          worksheet.cells = sortRangeCells(worksheet.cells, { range, column, order, hasHeaderRow });
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Creates or replaces a worksheet's filter view in one atomic write. Only
     * the stored view changes, so hidden rows keep their values, order and
     * rules; a rejected payload leaves the stored worksheet untouched.
     */
    async setFilter({ workbookId, worksheetId, filter } = {}) {
      const normalized = normalizeFilter(filter);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          worksheet.filter = normalized;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Removes a worksheet's filter view in one atomic write; every record of
     * the range becomes visible again with its original value and position.
     */
    async clearFilter({ workbookId, worksheetId } = {}) {
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          delete worksheet.filter;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Saves the filter currently applied to a worksheet as a named filter view
     * in one atomic write. The name is trimmed, must not be empty and stays
     * unique within the whole workbook (letter case ignored), so a duplicate
     * is rejected with its message and the stored views stay as they were. The
     * saved criteria are a copy of the applied filter, so later filter edits
     * never rewrite the saved view.
     */
    async saveFilterView({ workbookId, worksheetId, name } = {}) {
      const viewName = normalizeFilterViewName(name);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          if (!worksheet.filter || typeof worksheet.filter.range !== "string") {
            throw new ValidationError(INVALID_FILTER_MESSAGE);
          }
          if (filterViewNameTaken(workbook, viewName)) {
            throw new ValidationError(DUPLICATE_FILTER_VIEW_MESSAGE);
          }
          const views = Array.isArray(worksheet.filterViews) ? worksheet.filterViews : [];
          worksheet.filterViews = [
            ...views,
            { id: randomUUID(), name: viewName, ...copyFilterCriteria(worksheet.filter) },
          ];
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Replaces the worksheet's current filter with the criteria of one saved
     * view in one atomic write; the saved view itself is not modified, so it
     * can be applied again after other filters were used. An unknown view is
     * rejected and leaves the stored state untouched.
     */
    async applyFilterView({ workbookId, worksheetId, viewId } = {}) {
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const views = Array.isArray(worksheet.filterViews) ? worksheet.filterViews : [];
          const view = views.find((candidate) => candidate?.id === viewId);
          if (!view) throw new ValidationError(UNKNOWN_FILTER_VIEW_MESSAGE);
          worksheet.filter = copyFilterCriteria(view);
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Removes one saved filter view in a single atomic write and clears the
     * worksheet's current filter with it, so every source record is visible
     * again in its original order and with its original value. Cell values and
     * validation rules are never touched.
     */
    async deleteFilterView({ workbookId, worksheetId, viewId } = {}) {
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const views = Array.isArray(worksheet.filterViews) ? worksheet.filterViews : [];
          if (!views.some((candidate) => candidate?.id === viewId)) {
            throw new ValidationError(UNKNOWN_FILTER_VIEW_MESSAGE);
          }
          const kept = views.filter((candidate) => candidate?.id !== viewId);
          if (kept.length === 0) delete worksheet.filterViews;
          else worksheet.filterViews = kept;
          delete worksheet.filter;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Creates a pivot table from a source range with headers. The result lives
     * on its own worksheet named after the first unused `PivotN`, which becomes
     * the active worksheet; the source cells are only read. One atomic write, so
     * an unknown range leaves the workbook (and both worksheets) untouched.
     */
    async createPivotTable({ workbookId, sourceWorksheetId, range } = {}) {
      const sourceRange = normalizePivotRange(range);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const source = workbook.worksheets.find((candidate) => candidate.id === sourceWorksheetId);
          if (!source) throw new ValidationError("Unknown worksheet");
          const config = defaultPivotConfig(source.cells, sourceRange);
          const worksheet = {
            id: randomUUID(),
            name: nextPivotName(workbook.worksheets),
            selection: { ...DEFAULT_SELECTION },
            cells: buildPivotCells({ cells: source.cells, range: sourceRange, ...config }),
            pivot: { sourceWorksheetId: source.id, range: sourceRange, ...config },
          };
          workbook.worksheets.push(worksheet);
          workbook.activeWorksheetId = worksheet.id;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Replaces a pivot worksheet's field layout and recomputes its summary. An
     * unknown field or a value field without numbers rejects with its message
     * and leaves the last successful result as well as the source worksheet
     * exactly as they were.
     */
    async applyPivotConfig({ workbookId, worksheetId, rowField, columnField, valueField, summarizeBy } = {}) {
      const config = normalizePivotConfig({ rowField, columnField, valueField, summarizeBy });
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          if (!worksheet.pivot) throw new ValidationError(INVALID_PIVOT_MESSAGE);
          writePivotTable(workbook, worksheet, config);
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Recomputes a pivot worksheet with its stored field layout against the
     * current source range. Used after the source data or its rows/columns
     * changed; the whole summary is replaced, or nothing changes at all.
     */
    async refreshPivotTable({ workbookId, worksheetId } = {}) {
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          if (!worksheet.pivot) throw new ValidationError(INVALID_PIVOT_MESSAGE);
          const { rowField, columnField, valueField, summarizeBy } = worksheet.pivot;
          writePivotTable(workbook, worksheet, { rowField, columnField, valueField, summarizeBy });
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Adds a blank worksheet using the first unused `SheetN` name and makes it
     * the active worksheet. One atomic write: a rejected call (unknown
     * workbook) leaves the stored state untouched.
     */
    async addWorksheet({ workbookId } = {}) {
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = {
            id: randomUUID(),
            name: nextWorksheetName(workbook.worksheets),
            selection: { ...DEFAULT_SELECTION },
            cells: {},
          };
          workbook.worksheets.push(worksheet);
          workbook.activeWorksheetId = worksheet.id;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Renames one worksheet after trimming. The new name must not be empty, at
     * most `WORKSHEET_NAME_MAX_LENGTH` characters and unique within the same
     * workbook without regard to letter case; every failure rejects with a
     * `ValidationError` and leaves the stored state (including the old name)
     * untouched, since the name is validated before the atomic write.
     */
    async renameWorksheet({ workbookId, worksheetId, name } = {}) {
      const trimmed = normalizeWorksheetName(name);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          if (worksheetNameTaken(workbook.worksheets, trimmed, worksheetId)) {
            throw new ValidationError(DUPLICATE_WORKSHEET_NAME_MESSAGE);
          }
          worksheet.name = trimmed;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Deletes one worksheet in a single atomic write. A workbook always keeps
     * at least one worksheet, so the last remaining one is rejected with
     * `LAST_WORKSHEET_MESSAGE`. A worksheet that is still the source of a
     * pivot result stored on another worksheet is rejected with
     * `PIVOT_SOURCE_DEPENDENCY_MESSAGE`; deleting the pivot result worksheet
     * first (or rebuilding it on another source) lifts that constraint because
     * the dependency is derived from the stored pivot configs. When the deleted
     * worksheet was active, an adjacent worksheet becomes active. A rejected
     * call leaves every worksheet (and every pivot result) untouched.
     */
    async deleteWorksheet({ workbookId, worksheetId } = {}) {
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const index = workbook.worksheets.findIndex((candidate) => candidate.id === worksheetId);
          if (index === -1) throw new ValidationError("Unknown worksheet");
          if (workbook.worksheets.length <= 1) throw new ValidationError(LAST_WORKSHEET_MESSAGE);
          const dependent = workbook.worksheets.some(
            (candidate) => candidate.id !== worksheetId && candidate.pivot?.sourceWorksheetId === worksheetId,
          );
          if (dependent) throw new ValidationError(PIVOT_SOURCE_DEPENDENCY_MESSAGE);
          workbook.worksheets.splice(index, 1);
          if (workbook.activeWorksheetId === worksheetId) {
            // The tab to the left if it exists, otherwise the new first tab:
            // either way an adjacent worksheet of the deleted one becomes active.
            const neighbour = workbook.worksheets[Math.max(0, index - 1)] ?? workbook.worksheets[0];
            workbook.activeWorksheetId = neighbour.id;
          }
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Inserts or deletes one row or column of one worksheet. Cells, formula
     * references and everything after the target line move together in a single
     * atomic write, so a rejected request leaves the stored grid untouched and
     * other worksheets are never modified.
     */
    async changeStructure({ workbookId, worksheetId, axis, mode, index } = {}) {
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          worksheet.cells = structureChange(worksheet.cells, { axis, mode, index });
          // Validation rules and the filter view follow their cells, so
          // dropdown buttons and numeric limits stay on the same records.
          const shiftedRules = shiftRuleRanges(worksheet.validationRules, { axis, mode, index });
          if (Array.isArray(shiftedRules) && shiftedRules.length > 0) worksheet.validationRules = shiftedRules;
          else delete worksheet.validationRules;
          if (worksheet.filter) {
            const shifted = shiftFilter(worksheet.filter, { axis, mode, index });
            if (shifted) worksheet.filter = shifted;
            else delete worksheet.filter;
          }
          // Saved filter views follow their cells too, so applying one after a
          // row or column change still filters the same records.
          if (Array.isArray(worksheet.filterViews)) {
            const shiftedViews = worksheet.filterViews.flatMap((view) => {
              const moved = shiftFilter({ range: view.range, columns: view.columns }, { axis, mode, index });
              return moved ? [{ ...view, ...moved }] : [];
            });
            if (shiftedViews.length === 0) delete worksheet.filterViews;
            else worksheet.filterViews = shiftedViews;
          }
          // Pivot tables reading this worksheet move their stored source range
          // with the cells, so a later refresh reads the adjusted data.
          for (const other of workbook.worksheets) {
            if (!other.pivot || other.pivot.sourceWorksheetId !== worksheet.id) continue;
            const moved = shiftPivot(other.pivot, { axis, mode, index });
            if (moved) other.pivot = moved;
          }
          // Conditional-formatting rules constrain cells of this worksheet, so
          // their target range follows the same cells.
          const shiftedFormats = shiftConditionalFormats(worksheet.conditionalFormats, { axis, mode, index });
          if (Array.isArray(shiftedFormats) && shiftedFormats.length > 0) {
            worksheet.conditionalFormats = shiftedFormats;
          } else {
            delete worksheet.conditionalFormats;
          }
          // A cell note moves with the cell it is attached to, so it stays on
          // the same record after rows or columns were inserted or deleted.
          const shiftedNotes = shiftNotes(worksheet.notes, { axis, mode, index });
          if (shiftedNotes && Object.keys(shiftedNotes).length > 0) worksheet.notes = shiftedNotes;
          else delete worksheet.notes;
          // Named ranges that refer to this worksheet's cells follow them too,
          // while a name of another worksheet keeps its own coordinates.
          const shiftedNames = shiftNamedRanges(workbook.namedRanges, {
            worksheetName: worksheet.name,
            axis,
            mode,
            index,
          });
          if (Array.isArray(shiftedNames) && shiftedNames.length > 0) workbook.namedRanges = shiftedNames;
          else delete workbook.namedRanges;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Creates one named range, or replaces the range of the stored one whose id
     * is given. The name is trimmed and must start with a letter, and it must
     * not be used by another range of the same workbook (letter case ignored),
     * so a rejected name leaves the stored ranges untouched. One atomic write.
     */
    async saveNamedRange({ workbookId, id, name, range } = {}) {
      const normalizedName = normalizeNamedRangeName(name);
      const reference = normalizeNamedRangeReference(range);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const ranges = Array.isArray(workbook.namedRanges) ? workbook.namedRanges : [];
          const existing = id === undefined || id === null ? null : ranges.find((entry) => entry?.id === id);
          if (id !== undefined && id !== null && !existing) throw new ValidationError(UNKNOWN_NAMED_RANGE_MESSAGE);
          const wanted = normalizedName.toLowerCase();
          const taken = ranges.some(
            (entry) => entry?.id !== existing?.id && String(entry?.name ?? "").trim().toLowerCase() === wanted,
          );
          if (taken) throw new ValidationError(NAMED_RANGE_DUPLICATE_MESSAGE);
          const entry = { id: existing ? existing.id : randomUUID(), name: normalizedName, range: reference };
          workbook.namedRanges = existing
            ? ranges.map((candidate) => (candidate?.id === existing.id ? entry : candidate))
            : [...ranges, entry];
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /** Removes one named range in a single atomic write; unknown ids are rejected. */
    async deleteNamedRange({ workbookId, id } = {}) {
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const ranges = Array.isArray(workbook.namedRanges) ? workbook.namedRanges : [];
          if (!ranges.some((entry) => entry?.id === id)) throw new ValidationError(UNKNOWN_NAMED_RANGE_MESSAGE);
          const kept = ranges.filter((entry) => entry?.id !== id);
          if (kept.length === 0) delete workbook.namedRanges;
          else workbook.namedRanges = kept;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Creates one conditional-formatting rule, or replaces the stored rule whose
     * id is given. The rule only describes an appearance: no cell value changes,
     * and a rejected payload leaves the stored rules as they were. One atomic
     * write.
     */
    async saveConditionalFormat({ workbookId, worksheetId, id, range, condition, value, style } = {}) {
      const rule = normalizeConditionalFormat({ range, condition, value, style });
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const rules = Array.isArray(worksheet.conditionalFormats) ? worksheet.conditionalFormats : [];
          const existing = id === undefined || id === null ? null : rules.find((entry) => entry?.id === id);
          if (id !== undefined && id !== null && !existing) {
            throw new ValidationError(UNKNOWN_CONDITIONAL_FORMAT_MESSAGE);
          }
          const entry = { id: existing ? existing.id : randomUUID(), ...rule };
          worksheet.conditionalFormats = existing
            ? rules.map((candidate) => (candidate?.id === existing.id ? entry : candidate))
            : [...rules, entry];
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Removes one conditional-formatting rule in a single atomic write, so the
     * fill of every cell it covered disappears with it. Cell values and the
     * worksheet's other rules stay as they are.
     */
    async deleteConditionalFormat({ workbookId, worksheetId, id } = {}) {
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const rules = Array.isArray(worksheet.conditionalFormats) ? worksheet.conditionalFormats : [];
          if (!rules.some((entry) => entry?.id === id)) {
            throw new ValidationError(UNKNOWN_CONDITIONAL_FORMAT_MESSAGE);
          }
          const kept = rules.filter((entry) => entry?.id !== id);
          if (kept.length === 0) delete worksheet.conditionalFormats;
          else worksheet.conditionalFormats = kept;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Stores the note of one cell (a new note or the replacement of an existing
     * one) in a single atomic write. The note is free text kept apart from the
     * cell value, so neither the grid text nor any formula result changes; a
     * rejected payload leaves the stored notes untouched.
     */
    async saveNote({ workbookId, worksheetId, coordinate, text } = {}) {
      const key = normalizeNoteCoordinate(coordinate);
      const note = normalizeNoteText(text);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          worksheet.notes = { ...(worksheet.notes ?? {}), [key]: note };
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Removes the note of one cell in a single atomic write, so the cell keeps
     * its value and every other note of the worksheet stays as it was. An
     * unknown coordinate is rejected without touching the stored notes.
     */
    async deleteNote({ workbookId, worksheetId, coordinate } = {}) {
      const key = normalizeNoteCoordinate(coordinate);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const notes = { ...(worksheet.notes ?? {}) };
          delete notes[key];
          if (Object.keys(notes).length === 0) delete worksheet.notes;
          else worksheet.notes = notes;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    async updateWorkbook(id, changes = {}) {
      return store.update((state) => {
        const workbook = state.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new NotFoundError("Workbook not found");
        if (changes.name !== undefined) {
          workbook.name = normalizeName(changes.name, state.workbooks, id);
        }
        if (changes.activeWorksheetId !== undefined) {
          const target = workbook.worksheets.find((worksheet) => worksheet.id === changes.activeWorksheetId);
          if (!target) throw new ValidationError("Unknown worksheet");
          workbook.activeWorksheetId = target.id;
        }
        workbook.updatedAt = new Date().toISOString();
        return state;
      }).then((state) => state.workbooks.find((workbook) => workbook.id === id));
    },
  };
}
