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
  shiftNotes,
  shiftPivot,
  shiftRuleRanges,
} from "../domain/structure.mjs";
import {
  FILTER_VIEW_DUPLICATE_MESSAGE,
  FILTER_VIEW_MISSING_MESSAGE,
  FILTER_VIEW_NO_FILTER_MESSAGE,
  INVALID_FILTER_MESSAGE,
  copyFilter,
  normalizeFilter,
  normalizeFilterViewName,
} from "../domain/filter.mjs";
import { SORT_ORDERS, sortRangeCells } from "../domain/sort.mjs";
import {
  INVALID_NAMED_RANGE_MESSAGE,
  normalizeNamedRangeName,
  parseNamedRangeArea,
} from "../domain/named-ranges.mjs";
import {
  INVALID_CONDITIONAL_MESSAGE,
  normalizeConditionalIndex,
  normalizeConditionalRule,
} from "../domain/conditional.mjs";
import {
  DROPDOWN_TYPE,
  INVALID_RULE_MESSAGE,
  NUMBER_RANGE_TYPE,
  firstValidationError,
  normalizeRule,
  normalizeRuleRange,
  sameRuleRange,
} from "../domain/validation.mjs";
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
export const EMPTY_NAME_MESSAGE = "Workbook name cannot be empty";
export const LONG_NAME_MESSAGE = "Workbook name must be 80 characters or fewer";
export const DUPLICATE_NAME_MESSAGE = "Workbook name already exists";
export const MAX_WORKBOOK_NAME_LENGTH = 80;
export const EMPTY_WORKSHEET_NAME_MESSAGE = "Worksheet name cannot be empty";
export const DUPLICATE_WORKSHEET_NAME_MESSAGE = "Worksheet name already exists";
export const LONG_WORKSHEET_NAME_MESSAGE = "Worksheet name must be 50 characters or fewer";
export const MAX_WORKSHEET_NAME_LENGTH = 50;
export const LAST_WORKSHEET_MESSAGE = "A workbook must contain at least one worksheet";
export const PIVOT_SOURCE_DEPENDENCY_MESSAGE = "Please delete or rebuild dependent pivot tables first";
export const INVALID_CSV_MESSAGE = "Invalid CSV file format. Import failed.";
export const UNKNOWN_CELL_MESSAGE = "Unknown cell reference";
export const INVALID_CELL_VALUE_MESSAGE = "Cell value must be a string";
export const INVALID_STRUCTURE_MESSAGE = "Invalid row or column change";
export const INVALID_RANGE_MESSAGE = "Invalid cell range update";
export const INVALID_TRANSFER_MESSAGE = "Invalid range transfer";
export const INVALID_STATE_MESSAGE = "Invalid worksheet state";
export const INVALID_SORT_MESSAGE = "Invalid sort request";
export const EMPTY_NOTE_MESSAGE = "Note cannot be empty";
export const INVALID_FREEZE_MESSAGE = "Invalid frozen pane state";
export const INVALID_REPLACE_MESSAGE = "Invalid replace request";
// Rule and filter messages live in their domain modules; re-exported here for
// the HTTP layer and the tests that already import them from the store.
export { INVALID_RULE_MESSAGE, INVALID_FILTER_MESSAGE };

/** Selection of a worksheet with no recorded history: cell A1. */
export const DEFAULT_SELECTION = { anchor: "A1", focus: "A1" };

/**
 * Evolution seeds for REQ-1-2-2 (workbook rename): one independent EVO workbook
 * per rename scenario, added next to the baseline `Q3 Sales` workbook.
 * `IdentityLog` carries the `unreviewed` sentinel, `LimitProbe` the
 * `limit sentinel`, and `EVO-M01-ARCHIVE-RESERVED` is the unrelated name a
 * rename must not collide with. Their `updatedAt` stays older than the baseline
 * seed so the home page keeps listing `Q3 Sales` first.
 */
export const EVO_SEEDED_AT = "2026-09-19T09:00:00.000Z";
export const EVO_RENAME_OK_ID = "wb-evo-m01-rename-ok";
export const EVO_RENAME_OK_WORKSHEET_ID = "ws-evo-m01-rename-ok-log";
export const EVO_RENAME_DUP_ID = "wb-evo-m01-rename-dup";
export const EVO_RENAME_DUP_WORKSHEET_ID = "ws-evo-m01-rename-dup-log";
export const EVO_ARCHIVE_RESERVED_ID = "wb-evo-m01-archive-reserved";
export const EVO_ARCHIVE_RESERVED_WORKSHEET_ID = "ws-evo-m01-archive-reserved";
export const EVO_RENAME_LIMIT_ID = "wb-evo-m01-rename-limit";
export const EVO_RENAME_LIMIT_WORKSHEET_ID = "ws-evo-m01-rename-limit-probe";

/**
 * Evolution seeds for REQ-2-1-3 (worksheet rename): one independent workbook
 * per scenario, so a case-insensitive or overlong worksheet rename never
 * touches another scenario's tabs. They share the `EVO_SEEDED_AT` stamp, which
 * keeps `Q3 Sales` first on the home page. `HarborDraft` carries the
 * `dock marker` value on D5, `LengthGauge` the `sheet sentinel` on G4; DUP holds
 * the two tabs whose names differ by letter case.
 */
export const EVO_SHEET_OK_ID = "wb-evo-m02-sheet-ok";
export const EVO_SHEET_OK_WORKSHEET_ID = "ws-evo-m02-sheet-ok-harbor";
export const EVO_SHEET_OK_OTHER_WORKSHEET_ID = "ws-evo-m02-sheet-ok-ledger";
export const EVO_SHEET_DUP_ID = "wb-evo-m02-sheet-dup";
export const EVO_SHEET_DUP_WORKSHEET_ID = "ws-evo-m02-sheet-dup-meridian";
export const EVO_SHEET_DUP_ACTIVE_WORKSHEET_ID = "ws-evo-m02-sheet-dup-archive";
export const EVO_SHEET_LIMIT_ID = "wb-evo-m02-sheet-limit";
export const EVO_SHEET_LIMIT_WORKSHEET_ID = "ws-evo-m02-sheet-limit-gauge";

/**
 * Evolution seeds for REQ-3-1-1 (clearing the selected rectangle with Delete):
 * one independent workbook per scenario, so clearing a text cell, a formula or
 * a rectangle never touches another scenario's grid. They share the
 * `EVO_SEEDED_AT` stamp, which keeps `Q3 Sales` first on the home page.
 * `Staging` carries the `obsolete tag` text on H4, `Calculations` the source
 * `13` on B7 with `=B7*5` on C7 and its dependent `=C7+2` on D7, and `Matrix`
 * the two record rows `Amber/Delta` and `Kite/Orchid` on H4:I5.
 */
export const EVO_CLEAR_TEXT_ID = "wb-evo-m03-clear-text";
export const EVO_CLEAR_TEXT_WORKSHEET_ID = "ws-evo-m03-clear-text-staging";
export const EVO_CLEAR_FORMULA_ID = "wb-evo-m03-clear-formula";
export const EVO_CLEAR_FORMULA_WORKSHEET_ID = "ws-evo-m03-clear-formula-calculations";
export const EVO_CLEAR_RANGE_ID = "wb-evo-m03-clear-range";
export const EVO_CLEAR_RANGE_WORKSHEET_ID = "ws-evo-m03-clear-range-matrix";

/**
 * Evolution seeds for REQ-5-1-2 (saved filter views) and REQ-5-2-1 (custom
 * validation error messages): one independent workbook per scenario, so saving,
 * applying or deleting a view — and updating a rule's message — never touches
 * another scenario's state. They share the `EVO_SEEDED_AT` stamp, which keeps
 * `Q3 Sales` first on the home page.
 *
 * Every `EVO-M04-*` workbook holds the same `Workload` table on D3:F7 (headers
 * `Workstream/Phase/Load`, rows `Atlas/Queued/17`, `Atlas/Active/31`,
 * `Beacon/Queued/22`, `Cirrus/Queued/9`) with the range selected, and the two
 * apply/delete workbooks additionally store the saved view `Queued lanes`
 * selecting the `Phase` value `Queued`. Each `EVO-M05-*` workbook holds a
 * `Thresholds` worksheet with one constrained cell, its rule and the rule's
 * custom error message.
 */
export const EVO_FILTER_SAVE_ID = "wb-evo-m04-filter-save";
export const EVO_FILTER_SAVE_WORKSHEET_ID = "ws-evo-m04-filter-save-workload";
export const EVO_FILTER_APPLY_ID = "wb-evo-m04-filter-apply";
export const EVO_FILTER_APPLY_WORKSHEET_ID = "ws-evo-m04-filter-apply-workload";
export const EVO_FILTER_DELETE_ID = "wb-evo-m04-filter-delete";
export const EVO_FILTER_DELETE_WORKSHEET_ID = "ws-evo-m04-filter-delete-workload";
export const EVO_VALIDATION_FORMULA_ID = "wb-evo-m05-validation-formula";
export const EVO_VALIDATION_FORMULA_WORKSHEET_ID = "ws-evo-m05-validation-formula-thresholds";
export const EVO_VALIDATION_GRID_ID = "wb-evo-m05-validation-grid";
export const EVO_VALIDATION_GRID_WORKSHEET_ID = "ws-evo-m05-validation-grid-thresholds";
export const EVO_VALIDATION_EDIT_ID = "wb-evo-m05-validation-edit";
export const EVO_VALIDATION_EDIT_WORKSHEET_ID = "ws-evo-m05-validation-edit-thresholds";

/**
 * Evolution seeds for REQ-6-1-1 (freeze panes): one independent `ScrollLedger`
 * workbook per scenario, so freezing headings in one never touches another
 * scenario's panes. All three hold the same header row 1 and the same 12
 * columns (A..L) with data through row 40, which covers "data through row 40"
 * and "data through column L"; they share `EVO_SEEDED_AT`, which keeps `Q3
 * Sales` first on the home page.
 */
export const EVO_FREEZE_ROW_ID = "wb-evo-n01-freeze-row";
export const EVO_FREEZE_ROW_WORKSHEET_ID = "ws-evo-n01-freeze-row-scroll";
export const EVO_FREEZE_COLUMN_ID = "wb-evo-n01-freeze-column";
export const EVO_FREEZE_COLUMN_WORKSHEET_ID = "ws-evo-n01-freeze-column-scroll";
export const EVO_FREEZE_BOTH_ID = "wb-evo-n01-freeze-both";
export const EVO_FREEZE_BOTH_WORKSHEET_ID = "ws-evo-n01-freeze-both-scroll";

/**
 * Evolution seeds for REQ-6-2-1 (find and replace): one independent `Narrative`
 * workbook per scenario. Each holds exactly the cells its scenario names, so
 * the match counts of the dialog (3, 3 and 1) describe that scenario alone.
 */
/**
 * Evolution seeds for REQ-7-1-1 (named ranges) and REQ-7-2-1 (conditional
 * formatting): one independent workbook per scenario, so creating, updating or
 * rejecting a name — and applying, editing or deleting a fill rule — never
 * touches another scenario's workbook. They share the `EVO_SEEDED_AT` stamp,
 * which keeps `Q3 Sales` first on the home page.
 *
 * Every `EVO-N03-*` workbook holds the `ForecastModel` sheet its scenario
 * names; `EVO-N03-NAMED-UPDATE` additionally carries the saved name
 * `MarginBase` over K2:K3 plus the dependent formula `=SUM(MarginBase)`. Every
 * `EVO-N04-*` workbook holds the `Signals` sheet, and
 * `EVO-N04-FORMAT-EDIT` the rule 1 that fills values greater than 20.
 */
export const EVO_NAMED_CREATE_ID = "wb-evo-n03-named-create";
export const EVO_NAMED_CREATE_WORKSHEET_ID = "ws-evo-n03-named-create-forecast";
export const EVO_NAMED_INVALID_ID = "wb-evo-n03-named-invalid";
export const EVO_NAMED_INVALID_WORKSHEET_ID = "ws-evo-n03-named-invalid-forecast";
export const EVO_NAMED_UPDATE_ID = "wb-evo-n03-named-update";
export const EVO_NAMED_UPDATE_WORKSHEET_ID = "ws-evo-n03-named-update-forecast";
export const EVO_FORMAT_NUMBER_ID = "wb-evo-n04-format-number";
export const EVO_FORMAT_NUMBER_WORKSHEET_ID = "ws-evo-n04-format-number-signals";
export const EVO_FORMAT_TEXT_ID = "wb-evo-n04-format-text";
export const EVO_FORMAT_TEXT_WORKSHEET_ID = "ws-evo-n04-format-text-signals";
export const EVO_FORMAT_EDIT_ID = "wb-evo-n04-format-edit";
export const EVO_FORMAT_EDIT_WORKSHEET_ID = "ws-evo-n04-format-edit-signals";

/**
 * Evolution seeds for REQ-8-1-1 (cell notes): one independent `ReviewQueue`
 * workbook per scenario, so saving, editing or deleting a note never touches
 * another scenario's cell. They share the `EVO_SEEDED_AT` stamp, which keeps
 * `Q3 Sales` first on the home page. `EVO-N05-NOTE-CREATE` holds `Manifest R41`
 * on D8 without a note, `EVO-N05-NOTE-EDIT` holds `Gate Rho` on F6 with the note
 * `Awaiting controller sign-off`, and `EVO-N05-NOTE-DELETE` holds `Route Zeta`
 * on J3 with the note `Retire after audit`.
 */
export const EVO_NOTE_CREATE_ID = "wb-evo-n05-note-create";
export const EVO_NOTE_CREATE_WORKSHEET_ID = "ws-evo-n05-note-create-review";
export const EVO_NOTE_EDIT_ID = "wb-evo-n05-note-edit";
export const EVO_NOTE_EDIT_WORKSHEET_ID = "ws-evo-n05-note-edit-review";
export const EVO_NOTE_DELETE_ID = "wb-evo-n05-note-delete";
export const EVO_NOTE_DELETE_WORKSHEET_ID = "ws-evo-n05-note-delete-review";

export const EVO_FIND_NEXT_ID = "wb-evo-n02-find-next";
export const EVO_FIND_NEXT_WORKSHEET_ID = "ws-evo-n02-find-next-narrative";
export const EVO_REPLACE_ALL_ID = "wb-evo-n02-replace-all";
export const EVO_REPLACE_ALL_WORKSHEET_ID = "ws-evo-n02-replace-all-narrative";
export const EVO_CASE_SENSITIVE_ID = "wb-evo-n02-case-sensitive";
export const EVO_CASE_SENSITIVE_WORKSHEET_ID = "ws-evo-n02-case-sensitive-narrative";

/** Headers of the `ScrollLedger` seeds, one per column A..L of its row 1. */
const SCROLL_LEDGER_HEADERS = [
  "Lane",
  "Owner",
  "Amount",
  "Posted",
  "Status",
  "Batch",
  "Clerk",
  "Region",
  "Units",
  "Rate",
  "Total",
  "Note",
];

const LEDGER_OWNERS = ["Kai", "Rune", "Mira", "Tove"];
const LEDGER_STATUSES = ["Queued", "Posted", "Held"];

/**
 * One data cell of a `ScrollLedger` record: lane codes, owners, amounts, date
 * text and queue states in the leading columns, so the headings of the sheet
 * describe recognisable records rather than repeated filler.
 */
function ledgerCell(row, column) {
  if (column === 1) return `SL-${1000 + row}`;
  if (column === 2) return LEDGER_OWNERS[(row - 2) % LEDGER_OWNERS.length];
  if (column === 3) return String(40 + row * 3);
  if (column === 4) return `2026-09-${String(((row - 2) % 28) + 1).padStart(2, "0")}`;
  if (column === 5) return LEDGER_STATUSES[(row - 2) % LEDGER_STATUSES.length];
  return `${SCROLL_LEDGER_HEADERS[column - 1]} ${row}`;
}

/** `ScrollLedger` grid: headings in row 1 and data through `lastRow`/`lastColumn`. */
function scrollLedgerCells({ lastRow, lastColumn }) {
  const cells = {};
  for (let column = 1; column <= lastColumn; column += 1) {
    cells[cellName(1, column)] = SCROLL_LEDGER_HEADERS[column - 1] ?? `Column ${columnName(column)}`;
  }
  for (let row = 2; row <= lastRow; row += 1) {
    for (let column = 1; column <= lastColumn; column += 1) {
      cells[cellName(row, column)] = ledgerCell(row, column);
    }
  }
  return cells;
}

/** Shared `Workload` records of every `EVO-M04-*` workbook. */
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

/** The `Workload` range D3:F7 is the pre-selected rectangle of every M04 seed. */
const WORKLOAD_SELECTION = { anchor: "D3", focus: "F7" };

/** Saved view selecting the `Phase` value `Queued` of the seeded `Workload` table. */
const QUEUED_LANES_FILTER = {
  range: "D3:F7",
  columns: [
    { column: 4, header: "Workstream", mode: "values", values: [] },
    { column: 5, header: "Phase", mode: "values", values: ["Queued"] },
    { column: 6, header: "Load", mode: "values", values: [] },
  ],
};

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
      {
        id: EVO_RENAME_OK_ID,
        name: "EVO-M01-RENAME-OK",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_RENAME_OK_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_RENAME_OK_WORKSHEET_ID,
            name: "IdentityLog",
            selection: { ...DEFAULT_SELECTION },
            cells: { F3: "unreviewed" },
          },
        ],
      },
      {
        id: EVO_RENAME_DUP_ID,
        name: "EVO-M01-RENAME-DUP",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_RENAME_DUP_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_RENAME_DUP_WORKSHEET_ID,
            name: "IdentityLog",
            selection: { ...DEFAULT_SELECTION },
            cells: {},
          },
        ],
      },
      {
        id: EVO_ARCHIVE_RESERVED_ID,
        name: "EVO-M01-ARCHIVE-RESERVED",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_ARCHIVE_RESERVED_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_ARCHIVE_RESERVED_WORKSHEET_ID,
            name: DEFAULT_WORKSHEET_NAME,
            selection: { ...DEFAULT_SELECTION },
            cells: {},
          },
        ],
      },
      {
        id: EVO_RENAME_LIMIT_ID,
        name: "EVO-M01-RENAME-LIMIT",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_RENAME_LIMIT_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_RENAME_LIMIT_WORKSHEET_ID,
            name: "LimitProbe",
            selection: { ...DEFAULT_SELECTION },
            cells: { C2: "limit sentinel" },
          },
        ],
      },
      {
        id: EVO_SHEET_OK_ID,
        name: "EVO-M02-SHEET-OK",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_SHEET_OK_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_SHEET_OK_WORKSHEET_ID,
            name: "HarborDraft",
            selection: { ...DEFAULT_SELECTION },
            cells: { D5: "dock marker" },
          },
          {
            id: EVO_SHEET_OK_OTHER_WORKSHEET_ID,
            name: "LedgerView",
            selection: { ...DEFAULT_SELECTION },
            cells: {},
          },
        ],
      },
      {
        id: EVO_SHEET_DUP_ID,
        name: "EVO-M02-SHEET-DUP",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_SHEET_DUP_ACTIVE_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_SHEET_DUP_WORKSHEET_ID,
            name: "Meridian",
            selection: { ...DEFAULT_SELECTION },
            cells: {},
          },
          {
            id: EVO_SHEET_DUP_ACTIVE_WORKSHEET_ID,
            name: "ArchiveBay",
            selection: { ...DEFAULT_SELECTION },
            cells: {},
          },
        ],
      },
      {
        id: EVO_SHEET_LIMIT_ID,
        name: "EVO-M02-SHEET-LIMIT",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_SHEET_LIMIT_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_SHEET_LIMIT_WORKSHEET_ID,
            name: "LengthGauge",
            selection: { ...DEFAULT_SELECTION },
            cells: { G4: "sheet sentinel" },
          },
        ],
      },
      {
        id: EVO_CLEAR_TEXT_ID,
        name: "EVO-M03-CLEAR-TEXT",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_CLEAR_TEXT_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_CLEAR_TEXT_WORKSHEET_ID,
            name: "Staging",
            selection: { ...DEFAULT_SELECTION },
            cells: { H4: "obsolete tag" },
          },
        ],
      },
      {
        id: EVO_CLEAR_FORMULA_ID,
        name: "EVO-M03-CLEAR-FORMULA",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_CLEAR_FORMULA_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_CLEAR_FORMULA_WORKSHEET_ID,
            name: "Calculations",
            selection: { ...DEFAULT_SELECTION },
            cells: { B7: "13", C7: "=B7*5", D7: "=C7+2" },
          },
        ],
      },
      {
        id: EVO_CLEAR_RANGE_ID,
        name: "EVO-M03-CLEAR-RANGE",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_CLEAR_RANGE_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_CLEAR_RANGE_WORKSHEET_ID,
            name: "Matrix",
            selection: { ...DEFAULT_SELECTION },
            cells: { H4: "Amber", I4: "Delta", H5: "Kite", I5: "Orchid" },
          },
        ],
      },
      {
        id: EVO_FILTER_SAVE_ID,
        name: "EVO-M04-FILTER-SAVE",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_FILTER_SAVE_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_FILTER_SAVE_WORKSHEET_ID,
            name: "Workload",
            selection: { ...WORKLOAD_SELECTION },
            cells: { ...WORKLOAD_CELLS },
          },
        ],
      },
      {
        id: EVO_FILTER_APPLY_ID,
        name: "EVO-M04-FILTER-APPLY",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_FILTER_APPLY_WORKSHEET_ID,
        filterViews: [{ name: "Queued lanes", filter: copyFilter(QUEUED_LANES_FILTER) }],
        worksheets: [
          {
            id: EVO_FILTER_APPLY_WORKSHEET_ID,
            name: "Workload",
            selection: { ...WORKLOAD_SELECTION },
            cells: { ...WORKLOAD_CELLS },
          },
        ],
      },
      {
        id: EVO_FILTER_DELETE_ID,
        name: "EVO-M04-FILTER-DELETE",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_FILTER_DELETE_WORKSHEET_ID,
        filterViews: [{ name: "Queued lanes", filter: copyFilter(QUEUED_LANES_FILTER) }],
        worksheets: [
          {
            id: EVO_FILTER_DELETE_WORKSHEET_ID,
            name: "Workload",
            selection: { ...WORKLOAD_SELECTION },
            cells: { ...WORKLOAD_CELLS },
          },
        ],
      },
      {
        id: EVO_VALIDATION_FORMULA_ID,
        name: "EVO-M05-VALIDATION-FORMULA",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_VALIDATION_FORMULA_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_VALIDATION_FORMULA_WORKSHEET_ID,
            name: "Thresholds",
            selection: { anchor: "J6", focus: "J6" },
            cells: { J6: "37" },
            validationRules: [
              { range: "J6", type: NUMBER_RANGE_TYPE, min: 25, max: 75, errorMessage: "Capacity must be from 25 to 75" },
            ],
          },
        ],
      },
      {
        id: EVO_VALIDATION_GRID_ID,
        name: "EVO-M05-VALIDATION-GRID",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_VALIDATION_GRID_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_VALIDATION_GRID_WORKSHEET_ID,
            name: "Thresholds",
            selection: { anchor: "K8", focus: "K8" },
            cells: { K8: "Ready" },
            validationRules: [
              {
                range: "K8",
                type: DROPDOWN_TYPE,
                values: ["Ready", "Holding", "Released"],
                errorMessage: "Choose a queue state",
              },
            ],
          },
        ],
      },
      {
        id: EVO_VALIDATION_EDIT_ID,
        name: "EVO-M05-VALIDATION-EDIT",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_VALIDATION_EDIT_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_VALIDATION_EDIT_WORKSHEET_ID,
            name: "Thresholds",
            selection: { anchor: "L4", focus: "L4" },
            cells: { L4: "42" },
            validationRules: [
              {
                range: "L4",
                type: NUMBER_RANGE_TYPE,
                min: 25,
                max: 75,
                errorMessage: "Capacity must be from 25 to 75",
              },
            ],
          },
        ],
      },
      {
        id: EVO_FREEZE_ROW_ID,
        name: "EVO-N01-FREEZE-ROW",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_FREEZE_ROW_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_FREEZE_ROW_WORKSHEET_ID,
            name: "ScrollLedger",
            selection: { ...DEFAULT_SELECTION },
            cells: scrollLedgerCells({ lastRow: 40, lastColumn: 12 }),
          },
        ],
      },
      {
        id: EVO_FREEZE_COLUMN_ID,
        name: "EVO-N01-FREEZE-COLUMN",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_FREEZE_COLUMN_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_FREEZE_COLUMN_WORKSHEET_ID,
            name: "ScrollLedger",
            selection: { ...DEFAULT_SELECTION },
            cells: scrollLedgerCells({ lastRow: 40, lastColumn: 12 }),
          },
        ],
      },
      {
        id: EVO_FREEZE_BOTH_ID,
        name: "EVO-N01-FREEZE-BOTH",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_FREEZE_BOTH_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_FREEZE_BOTH_WORKSHEET_ID,
            name: "ScrollLedger",
            selection: { ...DEFAULT_SELECTION },
            cells: scrollLedgerCells({ lastRow: 40, lastColumn: 12 }),
          },
        ],
      },
      {
        id: EVO_NOTE_CREATE_ID,
        name: "EVO-N05-NOTE-CREATE",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_NOTE_CREATE_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_NOTE_CREATE_WORKSHEET_ID,
            name: "ReviewQueue",
            selection: { ...DEFAULT_SELECTION },
            cells: { D8: "Manifest R41" },
          },
        ],
      },
      {
        id: EVO_NOTE_EDIT_ID,
        name: "EVO-N05-NOTE-EDIT",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_NOTE_EDIT_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_NOTE_EDIT_WORKSHEET_ID,
            name: "ReviewQueue",
            selection: { ...DEFAULT_SELECTION },
            cells: { F6: "Gate Rho" },
            notes: { F6: "Awaiting controller sign-off" },
          },
        ],
      },
      {
        id: EVO_NOTE_DELETE_ID,
        name: "EVO-N05-NOTE-DELETE",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_NOTE_DELETE_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_NOTE_DELETE_WORKSHEET_ID,
            name: "ReviewQueue",
            selection: { ...DEFAULT_SELECTION },
            cells: { J3: "Route Zeta" },
            notes: { J3: "Retire after audit" },
          },
        ],
      },
      {
        id: EVO_FIND_NEXT_ID,
        name: "EVO-N02-FIND-NEXT",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_FIND_NEXT_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_FIND_NEXT_WORKSHEET_ID,
            name: "Narrative",
            selection: { ...DEFAULT_SELECTION },
            cells: { E4: "Cobalt", E7: "Cobalt", E11: "Cobalt" },
          },
        ],
      },
      {
        id: EVO_REPLACE_ALL_ID,
        name: "EVO-N02-REPLACE-ALL",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_REPLACE_ALL_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_REPLACE_ALL_WORKSHEET_ID,
            name: "Narrative",
            selection: { ...DEFAULT_SELECTION },
            cells: { F3: "Cobalt", F6: "Cobalt", F9: "Cobalt", F12: "Copper" },
          },
        ],
      },
      {
        id: EVO_CASE_SENSITIVE_ID,
        name: "EVO-N02-CASE-SENSITIVE",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_CASE_SENSITIVE_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_CASE_SENSITIVE_WORKSHEET_ID,
            name: "Narrative",
            selection: { ...DEFAULT_SELECTION },
            cells: { G3: "Cobalt", G4: "cobalt", G5: "Cobalt-7" },
          },
        ],
      },
      {
        id: EVO_NAMED_CREATE_ID,
        name: "EVO-N03-NAMED-CREATE",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_NAMED_CREATE_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_NAMED_CREATE_WORKSHEET_ID,
            name: "ForecastModel",
            selection: { ...DEFAULT_SELECTION },
            cells: { J3: "18", J4: "24", J5: "31" },
          },
        ],
      },
      {
        id: EVO_NAMED_INVALID_ID,
        name: "EVO-N03-NAMED-INVALID",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_NAMED_INVALID_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_NAMED_INVALID_WORKSHEET_ID,
            name: "ForecastModel",
            selection: { ...DEFAULT_SELECTION },
            cells: { K2: "6", K3: "14" },
          },
        ],
      },
      {
        id: EVO_NAMED_UPDATE_ID,
        name: "EVO-N03-NAMED-UPDATE",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_NAMED_UPDATE_WORKSHEET_ID,
        namedRanges: [{ name: "MarginBase", range: "ForecastModel!K2:K3" }],
        worksheets: [
          {
            id: EVO_NAMED_UPDATE_WORKSHEET_ID,
            name: "ForecastModel",
            selection: { ...DEFAULT_SELECTION },
            cells: { K2: "5", K3: "8", K4: "12", M2: "=SUM(MarginBase)" },
          },
        ],
      },
      {
        id: EVO_FORMAT_NUMBER_ID,
        name: "EVO-N04-FORMAT-NUMBER",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_FORMAT_NUMBER_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_FORMAT_NUMBER_WORKSHEET_ID,
            name: "Signals",
            selection: { ...DEFAULT_SELECTION },
            cells: { J4: "11", J5: "29", J6: "46" },
          },
        ],
      },
      {
        id: EVO_FORMAT_TEXT_ID,
        name: "EVO-N04-FORMAT-TEXT",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_FORMAT_TEXT_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_FORMAT_TEXT_WORKSHEET_ID,
            name: "Signals",
            selection: { ...DEFAULT_SELECTION },
            cells: { K4: "Watch", K5: "Stable", K6: "Elevated" },
          },
        ],
      },
      {
        id: EVO_FORMAT_EDIT_ID,
        name: "EVO-N04-FORMAT-EDIT",
        createdAt: EVO_SEEDED_AT,
        updatedAt: EVO_SEEDED_AT,
        activeWorksheetId: EVO_FORMAT_EDIT_WORKSHEET_ID,
        worksheets: [
          {
            id: EVO_FORMAT_EDIT_WORKSHEET_ID,
            name: "Signals",
            selection: { ...DEFAULT_SELECTION },
            cells: { L3: "16", L4: "28", L5: "39" },
            conditionalRules: [
              { range: "L3:L5", condition: "greater-than", value: "20", style: "red-fill" },
            ],
          },
        ],
      },
    ],
  };
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
 * Workbook name of a rename: trimmed, non-empty, at most
 * `MAX_WORKBOOK_NAME_LENGTH` characters, and unique across every stored
 * workbook ignoring letter case (a workbook never collides with itself).
 * Every rejection throws before the atomic write, so the stored name, the
 * editor title and the home-page link keep the last successful name.
 */
function normalizeName(value, { workbooks = [], excludeId } = {}) {
  if (typeof value !== "string") throw new ValidationError(EMPTY_NAME_MESSAGE);
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(EMPTY_NAME_MESSAGE);
  if (trimmed.length > MAX_WORKBOOK_NAME_LENGTH) throw new ValidationError(LONG_NAME_MESSAGE);
  const folded = trimmed.toLowerCase();
  const taken = workbooks.some(
    (workbook) => workbook.id !== excludeId && workbook.name.trim().toLowerCase() === folded,
  );
  if (taken) throw new ValidationError(DUPLICATE_NAME_MESSAGE);
  return trimmed;
}

/**
 * Worksheet name of a rename: trimmed, non-empty and at most
 * `MAX_WORKSHEET_NAME_LENGTH` characters (counted after trimming). Every
 * rejection throws before the atomic write, so the stored tab keeps its name.
 */
function normalizeWorksheetName(value) {
  if (typeof value !== "string") throw new ValidationError(EMPTY_WORKSHEET_NAME_MESSAGE);
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(EMPTY_WORKSHEET_NAME_MESSAGE);
  if (trimmed.length > MAX_WORKSHEET_NAME_LENGTH) throw new ValidationError(LONG_WORKSHEET_NAME_MESSAGE);
  return trimmed;
}

/**
 * First unused `SheetN` name in positive-integer order, so a workbook with
 * only `Sheet1` yields `Sheet2` and one with `Sheet1`/`Sheet2` yields `Sheet3`.
 * The occupied set folds letter case, matching the case-insensitive uniqueness
 * a rename enforces, so a generated name never collides with an existing tab.
 */
export function nextWorksheetName(worksheets) {
  const used = new Set(worksheets.map((worksheet) => String(worksheet.name).toLowerCase()));
  let index = 1;
  while (used.has(`sheet${index}`)) index += 1;
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
 * Note text of one cell: the stored text is the trimmed input, so a payload
 * carrying only whitespace is rejected instead of storing an empty note.
 */
function normalizeNoteText(value) {
  if (typeof value !== "string") throw new ValidationError(EMPTY_NOTE_MESSAGE);
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(EMPTY_NOTE_MESSAGE);
  return trimmed;
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

/**
 * Frozen pane state of one worksheet: the counts of rows and columns kept
 * visible. Both are whole numbers and never negative, so a request can only
 * freeze a prefix of the sheet; anything else is rejected before the write.
 */
function normalizeFreeze({ rows, columns } = {}) {
  if (!Number.isInteger(rows) || rows < 0 || !Number.isInteger(columns) || columns < 0) {
    throw new ValidationError(INVALID_FREEZE_MESSAGE);
  }
  return { rows, columns };
}

/**
 * Sparse cell writes of one replacement: a non-empty list of `{ coordinate,
 * value }` pairs with an A1 coordinate and a text value each. Anything else is
 * rejected before the write, so a replacement is applied whole or not at all.
 */
function normalizeReplacementUpdates(updates) {
  if (!Array.isArray(updates) || updates.length === 0) throw new ValidationError(INVALID_REPLACE_MESSAGE);
  return updates.map((update) => {
    if (update === null || typeof update !== "object" || typeof update.value !== "string") {
      throw new ValidationError(INVALID_REPLACE_MESSAGE);
    }
    const parsed = typeof update.coordinate === "string" ? parseCellName(update.coordinate) : null;
    if (!parsed) throw new ValidationError(INVALID_REPLACE_MESSAGE);
    return { coordinate: cellName(parsed.row, parsed.column), value: update.value };
  });
}

export function createWorkbookStore({ dataDir } = {}) {
  const filePath = join(dataDir ?? ".", "workbooks.json");
  const store = createJsonStore(filePath, createSeedState());

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
     * Persists the frozen pane state of one worksheet: the leading `rows` rows
     * and `columns` columns stay visible while the rest scrolls. Freezing
     * nothing removes the stored state again, so an unfrozen sheet holds no
     * count at all. Only this worksheet changes and, like the selection, panes
     * are view state that does not bump the workbook's last-updated time.
     */
    async setFreeze({ workbookId, worksheetId, rows, columns } = {}) {
      const freeze = normalizeFreeze({ rows, columns });
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          if (freeze.rows === 0 && freeze.columns === 0) delete worksheet.freeze;
          else worksheet.freeze = freeze;
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Writes a sparse set of cells of one worksheet in a single atomic write:
     * every coordinate of `updates` is written or none of them is. The whole
     * list is checked against the worksheet's rules first, so a replacement
     * that would break a rule changes no cell at all. Returns the stored
     * workbook together with the number of cells written.
     */
    async replaceCells({ workbookId, worksheetId, updates } = {}) {
      const replacements = normalizeReplacementUpdates(updates);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const violation = firstValidationError(worksheet.validationRules, replacements);
          if (violation) throw new ValidationError(violation);
          for (const { coordinate, value } of replacements) {
            if (value === "") delete worksheet.cells[coordinate];
            else worksheet.cells[coordinate] = value;
          }
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => ({
          workbook: state.workbooks.find((workbook) => workbook.id === workbookId) ?? null,
          replaced: replacements.length,
        }));
    },

    /**
     * Creates or replaces the validation rule covering one A1 range. Any
     * existing rule with the same range is replaced, other rules are kept, and
     * the whole change is one atomic write. Cell values are never touched, so a
     * rejected payload leaves the stored worksheet unchanged. A supplied
     * `errorMessage` replaces the standard rejection text of that rule.
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
     * Creates or replaces one named range of a workbook. The name must start
     * with a letter and the range must be a sheet-qualified A1 cell or area of
     * this workbook; the entry is stored with the worksheet's own name and the
     * canonical area, so the text shown by "Edit <name>" is stable. Every
     * rejection throws before the atomic write, so the stored names, cells and
     * formulas keep their last successful state. Cell values are never touched:
     * a formula referencing the name recalculates from the new area.
     */
    async setNamedRange({ workbookId, name, range } = {}) {
      const normalizedName = normalizeNamedRangeName(name);
      const parsed = parseNamedRangeArea(range);
      if (!parsed) throw new ValidationError(INVALID_NAMED_RANGE_MESSAGE);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find(
            (candidate) => String(candidate.name).toLowerCase() === parsed.sheet.toLowerCase(),
          );
          if (!worksheet) throw new ValidationError(INVALID_NAMED_RANGE_MESSAGE);
          const entry = { name: normalizedName, range: `${worksheet.name}!${parsed.area}` };
          const kept = (Array.isArray(workbook.namedRanges) ? workbook.namedRanges : []).filter(
            (existing) => String(existing?.name ?? "").toLowerCase() !== normalizedName.toLowerCase(),
          );
          workbook.namedRanges = [...kept, entry];
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Appends one conditional formatting rule to a worksheet, or replaces the
     * rule at `index` when one is given (the dialog's "Edit rule 1" flow). The
     * rule order is stored as sent and decides which fill wins for a cell that
     * two rules cover. A rejected payload throws before the atomic write, so
     * cell values, formulas and the stored rules keep their last state.
     */
    async saveConditionalRule({ workbookId, worksheetId, index, range, condition, value, style } = {}) {
      const rule = normalizeConditionalRule({ range, condition, value, style });
      const position = index === undefined || index === null ? null : normalizeConditionalIndex(index);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const rules = Array.isArray(worksheet.conditionalRules) ? worksheet.conditionalRules : [];
          if (position === null) {
            worksheet.conditionalRules = [...rules, rule];
          } else {
            if (position >= rules.length) throw new ValidationError(INVALID_CONDITIONAL_MESSAGE);
            worksheet.conditionalRules = rules.map((existing, current) =>
              current === position ? rule : existing,
            );
          }
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Removes the conditional formatting rule at `index` in one atomic write,
     * so the cells it filled stop showing that fill. The worksheet's cells, its
     * formulas and its other rules are left untouched; the last removed rule
     * drops the stored list entirely.
     */
    async deleteConditionalRule({ workbookId, worksheetId, index } = {}) {
      const position = normalizeConditionalIndex(index);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const rules = Array.isArray(worksheet.conditionalRules) ? worksheet.conditionalRules : [];
          if (position >= rules.length) throw new ValidationError(INVALID_CONDITIONAL_MESSAGE);
          const kept = rules.filter((_, current) => current !== position);
          if (kept.length === 0) delete worksheet.conditionalRules;
          else worksheet.conditionalRules = kept;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Creates or replaces the note of one cell in a single atomic write. The
     * note is keyed by the canonical coordinate of the cell, so saving the same
     * cell twice keeps one note; cell values, formulas and the worksheet's other
     * annotations are never touched. Every rejection throws before the write, so
     * a rejected note keeps the last stored text.
     */
    async saveNote({ workbookId, worksheetId, coordinate, text } = {}) {
      const key = normalizeCoordinate(coordinate);
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
     * Removes the note of one cell in a single atomic write, so the cell loses
     * its open button while its value and every other note stay as they were.
     * Deleting a cell that carries no note leaves the stored state unchanged.
     */
    async deleteNote({ workbookId, worksheetId, coordinate } = {}) {
      const key = normalizeCoordinate(coordinate);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const notes = { ...(worksheet.notes ?? {}) };
          if (notes[key] === undefined) return;
          delete notes[key];
          if (Object.keys(notes).length === 0) delete worksheet.notes;
          else worksheet.notes = notes;
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
     * Saves the worksheet's currently applied filter under a workbook-unique
     * name. The name is trimmed and compared ignoring letter case, so the same
     * name in another casing is a duplicate; both an empty name, a missing
     * applied filter and a duplicate reject before the atomic write, leaving
     * the stored views and the visible rows exactly as they were. The saved
     * criteria are an independent copy, so later filter edits never change a
     * stored view.
     */
    async saveFilterView({ workbookId, worksheetId, name } = {}) {
      const trimmed = normalizeFilterViewName(name);
      const folded = trimmed.toLowerCase();
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          if (!worksheet.filter) throw new ValidationError(FILTER_VIEW_NO_FILTER_MESSAGE);
          const views = Array.isArray(workbook.filterViews) ? workbook.filterViews : [];
          if (views.some((view) => String(view?.name ?? "").trim().toLowerCase() === folded)) {
            throw new ValidationError(FILTER_VIEW_DUPLICATE_MESSAGE);
          }
          workbook.filterViews = [...views, { name: trimmed, filter: copyFilter(worksheet.filter) }];
          worksheet.filterViewName = trimmed;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Applies a saved filter view to one worksheet in a single atomic write: the
     * stored criteria, not a reference to them, become the worksheet's filter,
     * so the view replaces whatever filter was applied before. An unknown view
     * rejects and leaves the visible rows as they were.
     */
    async applyFilterView({ workbookId, worksheetId, name } = {}) {
      const wanted = typeof name === "string" ? name.trim() : "";
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const views = Array.isArray(workbook.filterViews) ? workbook.filterViews : [];
          const view = views.find(
            (candidate) => wanted !== "" && String(candidate?.name ?? "").trim().toLowerCase() === wanted.toLowerCase(),
          );
          if (!view) throw new ValidationError(FILTER_VIEW_MISSING_MESSAGE);
          worksheet.filter = copyFilter(view.filter);
          worksheet.filterViewName = view.name;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Deletes a saved filter view in one atomic write and restores every source
     * row of the worksheet(s) it filtered: the stored criteria are removed with
     * the view, while cell values, order and rules stay untouched. An unknown
     * name rejects and keeps the stored views.
     */
    async deleteFilterView({ workbookId, name } = {}) {
      const wanted = typeof name === "string" ? name.trim() : "";
      const folded = wanted.toLowerCase();
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const views = Array.isArray(workbook.filterViews) ? workbook.filterViews : [];
          const index = views.findIndex(
            (candidate) => wanted !== "" && String(candidate?.name ?? "").trim().toLowerCase() === folded,
          );
          if (index === -1) throw new ValidationError(FILTER_VIEW_MISSING_MESSAGE);
          const [removed] = views.splice(index, 1);
          const removedName = String(removed?.name ?? "").trim().toLowerCase();
          if (views.length === 0) delete workbook.filterViews;
          else workbook.filterViews = views;
          for (const worksheet of workbook.worksheets) {
            const applied = typeof worksheet.filterViewName === "string" ? worksheet.filterViewName.trim().toLowerCase() : "";
            if (applied === "" || applied !== removedName) continue;
            delete worksheet.filter;
            delete worksheet.filterViewName;
          }
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
          delete worksheet.filterViewName;
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
     * Renames one worksheet after trimming. The new name must not be empty, must
     * be at most `MAX_WORKSHEET_NAME_LENGTH` characters and must be unique within
     * the same workbook ignoring letter case (a worksheet never collides with
     * itself). Every failure rejects with a `ValidationError` and leaves the
     * stored state (including the old name) untouched, since the name is
     * validated before the atomic write.
     */
    async renameWorksheet({ workbookId, worksheetId, name } = {}) {
      const trimmed = normalizeWorksheetName(name);
      const folded = trimmed.toLowerCase();
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          if (
            workbook.worksheets.some(
              (candidate) => candidate.id !== worksheetId && String(candidate.name).toLowerCase() === folded,
            )
          ) {
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
          // Conditional formatting follows the cells it paints as well, so a
          // moved range keeps filling the same records.
          const shiftedConditional = shiftRuleRanges(worksheet.conditionalRules, { axis, mode, index });
          if (Array.isArray(shiftedConditional) && shiftedConditional.length > 0) {
            worksheet.conditionalRules = shiftedConditional;
          } else {
            delete worksheet.conditionalRules;
          }
          // Cell notes follow their cell as well, so an annotation stays on the
          // record it describes (and disappears with a deleted line).
          const shiftedNotes = shiftNotes(worksheet.notes, { axis, mode, index });
          if (shiftedNotes && Object.keys(shiftedNotes).length > 0) worksheet.notes = shiftedNotes;
          else delete worksheet.notes;
          if (worksheet.filter) {
            const shifted = shiftFilter(worksheet.filter, { axis, mode, index });
            if (shifted) worksheet.filter = shifted;
            else delete worksheet.filter;
          }
          // Saved filter views follow their cells as well, so choosing one later
          // still covers the same records.
          if (Array.isArray(workbook.filterViews)) {
            const moved = workbook.filterViews.flatMap((view) => {
              const shifted = view?.filter ? shiftFilter(view.filter, { axis, mode, index }) : null;
              return shifted ? [{ ...view, filter: shifted }] : [];
            });
            if (moved.length > 0) workbook.filterViews = moved;
            else delete workbook.filterViews;
          }
          // Pivot tables reading this worksheet move their stored source range
          // with the cells, so a later refresh reads the adjusted data.
          for (const other of workbook.worksheets) {
            if (!other.pivot || other.pivot.sourceWorksheetId !== worksheet.id) continue;
            const moved = shiftPivot(other.pivot, { axis, mode, index });
            if (moved) other.pivot = moved;
          }
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    async updateWorkbook(id, changes = {}) {
      return store.update((state) => {
        const workbook = state.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new NotFoundError("Workbook not found");
        if (changes.name !== undefined) {
          workbook.name = normalizeName(changes.name, { workbooks: state.workbooks, excludeId: workbook.id });
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
