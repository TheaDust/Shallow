import type { ConditionalFormatRule, FilterView, NamedRange, ValidationRule, Workbook, Worksheet } from "../domain/types";
import { cellName } from "../domain/grid";

/**
 * Mirror of `backend/src/store/evo-seeds.mjs`: the pre-provisioned `EVO-`
 * workbooks of the evolution scenarios plus the shared baseline seed. Every
 * scenario owns one workbook identity, so a front-end test can start from the
 * same initial data the real evaluation seed provides.
 */

export const SEED_WORKBOOK_ID = "wb-q3-sales";
export const SEED_WORKSHEET_ID = "ws-q3-sheet1";
export const SEED_SECOND_WORKSHEET_ID = "ws-q3-sheet2";
export const SEED_UPDATED_AT = "2026-09-28T14:05:00.000Z";

/** Pre-provisioned `EVO-` workbook ids of the evolution scenarios (REQ-1-2-2). */
export const EVO_RENAME_WORKBOOK_ID = "wb-evo-m01-rename-ok";
export const EVO_RENAME_WORKSHEET_ID = "ws-evo-m01-rename-ok-identity-log";
export const EVO_RENAME_DUP_WORKBOOK_ID = "wb-evo-m01-rename-dup";
export const EVO_RENAME_LIMIT_WORKBOOK_ID = "wb-evo-m01-rename-limit";

/** Pre-provisioned `EVO-` workbook ids of the worksheet-rename module (REQ-2-1-3). */
export const EVO_SHEET_OK_WORKBOOK_ID = "wb-evo-m02-sheet-ok";
export const EVO_SHEET_OK_WORKSHEET_ID = "ws-evo-m02-sheet-ok-harbor-draft";
export const EVO_SHEET_DUP_WORKBOOK_ID = "wb-evo-m02-sheet-dup";
export const EVO_SHEET_DUP_WORKSHEET_ID = "ws-evo-m02-sheet-dup-archive-bay";
export const EVO_SHEET_LIMIT_WORKBOOK_ID = "wb-evo-m02-sheet-limit";
export const EVO_SHEET_LIMIT_WORKSHEET_ID = "ws-evo-m02-sheet-limit-length-gauge";

/** Pre-provisioned `EVO-` workbook ids of the cell-clear module (REQ-3-1-1). */
export const EVO_CLEAR_TEXT_WORKBOOK_ID = "wb-evo-m03-clear-text";
export const EVO_CLEAR_TEXT_WORKSHEET_ID = "ws-evo-m03-clear-text-staging";
export const EVO_CLEAR_FORMULA_WORKBOOK_ID = "wb-evo-m03-clear-formula";
export const EVO_CLEAR_FORMULA_WORKSHEET_ID = "ws-evo-m03-clear-formula-calculations";
export const EVO_CLEAR_RANGE_WORKBOOK_ID = "wb-evo-m03-clear-range";
export const EVO_CLEAR_RANGE_WORKSHEET_ID = "ws-evo-m03-clear-range-matrix";

/** Pre-provisioned `EVO-` workbook ids of the filter-view module (REQ-5-1-2). */
export const EVO_FILTER_SAVE_WORKBOOK_ID = "wb-evo-m04-filter-save";
export const EVO_FILTER_SAVE_WORKSHEET_ID = "ws-evo-m04-filter-save-workload";
export const EVO_FILTER_APPLY_WORKBOOK_ID = "wb-evo-m04-filter-apply";
export const EVO_FILTER_APPLY_WORKSHEET_ID = "ws-evo-m04-filter-apply-workload";
export const EVO_FILTER_DELETE_WORKBOOK_ID = "wb-evo-m04-filter-delete";
export const EVO_FILTER_DELETE_WORKSHEET_ID = "ws-evo-m04-filter-delete-workload";
/** Name of the saved view the apply/delete scenarios start with. */
export const EVO_QUEUED_LANES_VIEW_NAME = "Queued lanes";

/** Pre-provisioned `EVO-` workbook ids of the validation-message module (REQ-5-2-1). */
export const EVO_VALIDATION_FORMULA_WORKBOOK_ID = "wb-evo-m05-validation-formula";
export const EVO_VALIDATION_FORMULA_WORKSHEET_ID = "ws-evo-m05-validation-formula-thresholds";
export const EVO_VALIDATION_GRID_WORKBOOK_ID = "wb-evo-m05-validation-grid";
export const EVO_VALIDATION_GRID_WORKSHEET_ID = "ws-evo-m05-validation-grid-thresholds";
export const EVO_VALIDATION_EDIT_WORKBOOK_ID = "wb-evo-m05-validation-edit";
export const EVO_VALIDATION_EDIT_WORKSHEET_ID = "ws-evo-m05-validation-edit-thresholds";
/** Error messages the pre-provisioned validation rules carry. */
export const EVO_NUMERIC_MESSAGE = "Capacity must be from 25 to 75";
export const EVO_DROPDOWN_MESSAGE = "Choose a queue state";

/** Pre-provisioned `EVO-` workbook ids of the freeze-panes module (REQ-6-1-1). */
export const EVO_FREEZE_ROW_WORKBOOK_ID = "wb-evo-n01-freeze-row";
export const EVO_FREEZE_ROW_WORKSHEET_ID = "ws-evo-n01-freeze-row-scroll-ledger";
export const EVO_FREEZE_COLUMN_WORKBOOK_ID = "wb-evo-n01-freeze-column";
export const EVO_FREEZE_COLUMN_WORKSHEET_ID = "ws-evo-n01-freeze-column-scroll-ledger";
export const EVO_FREEZE_BOTH_WORKBOOK_ID = "wb-evo-n01-freeze-both";
export const EVO_FREEZE_BOTH_WORKSHEET_ID = "ws-evo-n01-freeze-both-scroll-ledger";

/** Pre-provisioned `EVO-` workbook ids of the find-and-replace module (REQ-6-2-1). */
export const EVO_FIND_NEXT_WORKBOOK_ID = "wb-evo-n02-find-next";
export const EVO_FIND_NEXT_WORKSHEET_ID = "ws-evo-n02-find-next-narrative";
export const EVO_REPLACE_ALL_WORKBOOK_ID = "wb-evo-n02-replace-all";
export const EVO_REPLACE_ALL_WORKSHEET_ID = "ws-evo-n02-replace-all-narrative";
export const EVO_CASE_SENSITIVE_WORKBOOK_ID = "wb-evo-n02-case-sensitive";
export const EVO_CASE_SENSITIVE_WORKSHEET_ID = "ws-evo-n02-case-sensitive-narrative";

/** Pre-provisioned `EVO-` workbook ids of the named-range module (REQ-7-1-1). */
export const EVO_NAMED_CREATE_WORKBOOK_ID = "wb-evo-n03-named-create";
export const EVO_NAMED_CREATE_WORKSHEET_ID = "ws-evo-n03-named-create-forecast-model";
export const EVO_NAMED_INVALID_WORKBOOK_ID = "wb-evo-n03-named-invalid";
export const EVO_NAMED_INVALID_WORKSHEET_ID = "ws-evo-n03-named-invalid-forecast-model";
export const EVO_NAMED_UPDATE_WORKBOOK_ID = "wb-evo-n03-named-update";
export const EVO_NAMED_UPDATE_WORKSHEET_ID = "ws-evo-n03-named-update-forecast-model";

/** Pre-provisioned `EVO-` workbook ids of the conditional-format module (REQ-7-2-1). */
export const EVO_FORMAT_NUMBER_WORKBOOK_ID = "wb-evo-n04-format-number";
export const EVO_FORMAT_NUMBER_WORKSHEET_ID = "ws-evo-n04-format-number-signals";
export const EVO_FORMAT_TEXT_WORKBOOK_ID = "wb-evo-n04-format-text";
export const EVO_FORMAT_TEXT_WORKSHEET_ID = "ws-evo-n04-format-text-signals";
export const EVO_FORMAT_EDIT_WORKBOOK_ID = "wb-evo-n04-format-edit";
export const EVO_FORMAT_EDIT_WORKSHEET_ID = "ws-evo-n04-format-edit-signals";

/** Pre-provisioned `EVO-` workbook ids of the cell-note module (REQ-8-1-1). */
export const EVO_NOTE_CREATE_WORKBOOK_ID = "wb-evo-n05-note-create";
export const EVO_NOTE_EDIT_WORKBOOK_ID = "wb-evo-n05-note-edit";
export const EVO_NOTE_DELETE_WORKBOOK_ID = "wb-evo-n05-note-delete";
/** Note texts the edit and delete scenarios start with. */
export const EVO_NOTE_EDIT_TEXT = "Awaiting controller sign-off";
export const EVO_NOTE_DELETE_TEXT = "Retire after audit";

interface EvoWorkbookOptions {
  id: string;
  name: string;
  worksheetId: string;
  worksheetName: string;
  updatedAt: string;
  cells?: Record<string, string>;
  notes?: Record<string, string>;
  selection?: { anchor: string; focus: string };
  validationRules?: ValidationRule[];
  filterViews?: FilterView[];
  namedRanges?: NamedRange[];
  conditionalFormats?: ConditionalFormatRule[];
}

function evoWorkbook({
  id,
  name,
  worksheetId,
  worksheetName,
  updatedAt,
  cells = {},
  notes,
  selection,
  validationRules,
  filterViews,
  namedRanges,
  conditionalFormats,
}: EvoWorkbookOptions): Workbook {
  const worksheet: Worksheet = {
    id: worksheetId,
    name: worksheetName,
    selection: selection ?? { anchor: "A1", focus: "A1" },
    cells,
  };
  if (notes) worksheet.notes = notes;
  if (validationRules) worksheet.validationRules = validationRules;
  if (conditionalFormats) worksheet.conditionalFormats = conditionalFormats;
  const workbook: Workbook = {
    id,
    name,
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt,
    activeWorksheetId: worksheetId,
    worksheets: [worksheet],
  };
  if (filterViews) workbook.filterViews = filterViews;
  if (namedRanges) workbook.namedRanges = namedRanges;
  return workbook;
}

/**
 * One pre-provisioned workbook with several worksheets; `activeWorksheetId`
 * picks the tab the scenario starts on.
 */
function evoWorkbookWithWorksheets(
  id: string,
  name: string,
  updatedAt: string,
  activeWorksheetId: string,
  worksheets: { id: string; name: string; cells?: Record<string, string> }[],
): Workbook {
  return {
    id,
    name,
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt,
    activeWorksheetId,
    worksheets: worksheets.map((worksheet) => ({
      id: worksheet.id,
      name: worksheet.name,
      selection: { anchor: "A1", focus: "A1" },
      cells: worksheet.cells ?? {},
    })),
  };
}

/** The `Workload` table of the filter-view scenarios, headers in D3:F3. */
const WORKLOAD_CELLS: Record<string, string> = {
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

/** Mirror of the `ScrollLedger` table: header row 1, data rows 2..40, columns A..L. */
const SCROLL_LEDGER_HEADERS = [
  "Entry",
  "Account",
  "Period",
  "Debit",
  "Credit",
  "Balance",
  "Status",
  "Owner",
  "Note",
  "Tag",
  "Ref",
  "Updated",
];

function scrollLedgerCells(): Record<string, string> {
  const cells: Record<string, string> = {};
  SCROLL_LEDGER_HEADERS.forEach((header, index) => {
    cells[cellName(1, index + 1)] = header;
  });
  for (let row = 2; row <= 40; row += 1) {
    const line = row - 1;
    cells[cellName(row, 1)] = `Entry ${line}`;
    cells[cellName(row, 2)] = `Account ${((row - 2) % 6) + 1}`;
    cells[cellName(row, 3)] = `2026-${String(((row - 2) % 12) + 1).padStart(2, "0")}`;
    cells[cellName(row, 4)] = String(100 + row);
    cells[cellName(row, 5)] = String(50 + row);
    cells[cellName(row, 6)] = String(150 + row * 2);
    cells[cellName(row, 7)] = row % 3 === 0 ? "Closed" : "Open";
    cells[cellName(row, 8)] = ["Avery", "Blake", "Casey", "Dana"][(row - 2) % 4];
    cells[cellName(row, 9)] = `Note ${line}`;
    cells[cellName(row, 10)] = `Tag ${((row - 2) % 5) + 1}`;
    cells[cellName(row, 11)] = `REF-${String(line).padStart(3, "0")}`;
    cells[cellName(row, 12)] = `2026-10-${String(((row - 2) % 9) + 1).padStart(2, "0")}`;
  }
  return cells;
}

/** Saved view `Queued lanes`: the `Phase` cells of D3:F7 keep `Queued`. */
const QUEUED_LANES_VIEW: FilterView = {
  id: "fv-queued-lanes",
  name: "Queued lanes",
  filter: {
    range: "D3:F7",
    columns: [{ column: 5, header: "Phase", mode: "values", values: ["Queued"] }],
  },
};

/** Mirror of the backend evolution seed: one pre-provisioned workbook per scenario. */
function evolutionWorkbooks(): Workbook[] {
  return [
    evoWorkbook({
      id: EVO_RENAME_WORKBOOK_ID,
      name: "EVO-M01-RENAME-OK",
      worksheetId: EVO_RENAME_WORKSHEET_ID,
      worksheetName: "IdentityLog",
      updatedAt: "2026-10-01T09:00:00.000Z",
      cells: { F3: "unreviewed" },
    }),
    evoWorkbook({
      id: EVO_RENAME_DUP_WORKBOOK_ID,
      name: "EVO-M01-RENAME-DUP",
      worksheetId: "ws-evo-m01-rename-dup-identity-log",
      worksheetName: "IdentityLog",
      updatedAt: "2026-10-01T09:05:00.000Z",
    }),
    evoWorkbook({
      id: "wb-evo-m01-archive-reserved",
      name: "EVO-M01-ARCHIVE-RESERVED",
      worksheetId: "ws-evo-m01-archive-reserved-sheet1",
      worksheetName: "Sheet1",
      updatedAt: "2026-10-01T09:10:00.000Z",
    }),
    evoWorkbook({
      id: EVO_RENAME_LIMIT_WORKBOOK_ID,
      name: "EVO-M01-RENAME-LIMIT",
      worksheetId: "ws-evo-m01-rename-limit-limit-probe",
      worksheetName: "LimitProbe",
      updatedAt: "2026-10-01T09:15:00.000Z",
      cells: { C2: "limit sentinel" },
    }),
    // REQ-2-1-3 (rename a worksheet): one workbook per scenario.
    evoWorkbookWithWorksheets(EVO_SHEET_OK_WORKBOOK_ID, "EVO-M02-SHEET-OK", "2026-10-02T09:00:00.000Z", EVO_SHEET_OK_WORKSHEET_ID, [
      { id: EVO_SHEET_OK_WORKSHEET_ID, name: "HarborDraft", cells: { D5: "dock marker" } },
      { id: "ws-evo-m02-sheet-ok-ledger-view", name: "LedgerView" },
    ]),
    evoWorkbookWithWorksheets(EVO_SHEET_DUP_WORKBOOK_ID, "EVO-M02-SHEET-DUP", "2026-10-02T09:05:00.000Z", EVO_SHEET_DUP_WORKSHEET_ID, [
      { id: "ws-evo-m02-sheet-dup-meridian", name: "Meridian" },
      { id: EVO_SHEET_DUP_WORKSHEET_ID, name: "ArchiveBay" },
    ]),
    evoWorkbookWithWorksheets(
      EVO_SHEET_LIMIT_WORKBOOK_ID,
      "EVO-M02-SHEET-LIMIT",
      "2026-10-02T09:10:00.000Z",
      EVO_SHEET_LIMIT_WORKSHEET_ID,
      [{ id: EVO_SHEET_LIMIT_WORKSHEET_ID, name: "LengthGauge", cells: { G4: "sheet sentinel" } }],
    ),
    // REQ-3-1-1 (clear a cell or a selected rectangle with Delete): one
    // workbook per scenario, each with its own worksheet and initial cells.
    evoWorkbook({
      id: EVO_CLEAR_TEXT_WORKBOOK_ID,
      name: "EVO-M03-CLEAR-TEXT",
      worksheetId: EVO_CLEAR_TEXT_WORKSHEET_ID,
      worksheetName: "Staging",
      updatedAt: "2026-10-03T09:00:00.000Z",
      cells: { H4: "obsolete tag" },
    }),
    evoWorkbook({
      id: EVO_CLEAR_FORMULA_WORKBOOK_ID,
      name: "EVO-M03-CLEAR-FORMULA",
      worksheetId: EVO_CLEAR_FORMULA_WORKSHEET_ID,
      worksheetName: "Calculations",
      updatedAt: "2026-10-03T09:05:00.000Z",
      cells: { B7: "13", C7: "=B7*5", D7: "=C7+2" },
    }),
    evoWorkbook({
      id: EVO_CLEAR_RANGE_WORKBOOK_ID,
      name: "EVO-M03-CLEAR-RANGE",
      worksheetId: EVO_CLEAR_RANGE_WORKSHEET_ID,
      worksheetName: "Matrix",
      updatedAt: "2026-10-03T09:10:00.000Z",
      // Row order: row 4 holds `Amber`/`Delta`, row 5 `Kite`/`Orchid`.
      cells: { H4: "Amber", I4: "Delta", H5: "Kite", I5: "Orchid" },
    }),
    // REQ-5-1-2 (filter rows by value or condition): the same `Workload`
    // table in three independent workbooks; the later two carry the saved
    // view `Queued lanes` keeping the `Phase` cells equal to `Queued`.
    evoWorkbook({
      id: EVO_FILTER_SAVE_WORKBOOK_ID,
      name: "EVO-M04-FILTER-SAVE",
      worksheetId: EVO_FILTER_SAVE_WORKSHEET_ID,
      worksheetName: "Workload",
      updatedAt: "2026-10-04T09:00:00.000Z",
      cells: structuredClone(WORKLOAD_CELLS),
    }),
    evoWorkbook({
      id: EVO_FILTER_APPLY_WORKBOOK_ID,
      name: "EVO-M04-FILTER-APPLY",
      worksheetId: EVO_FILTER_APPLY_WORKSHEET_ID,
      worksheetName: "Workload",
      updatedAt: "2026-10-04T09:05:00.000Z",
      cells: structuredClone(WORKLOAD_CELLS),
      filterViews: [structuredClone(QUEUED_LANES_VIEW)],
    }),
    evoWorkbook({
      id: EVO_FILTER_DELETE_WORKBOOK_ID,
      name: "EVO-M04-FILTER-DELETE",
      worksheetId: EVO_FILTER_DELETE_WORKSHEET_ID,
      worksheetName: "Workload",
      updatedAt: "2026-10-04T09:10:00.000Z",
      cells: structuredClone(WORKLOAD_CELLS),
      filterViews: [structuredClone(QUEUED_LANES_VIEW)],
    }),
    // REQ-5-2-1 (custom validation error message): each scenario holds its own
    // cell, rule and message; the selection starts on the seeded record.
    evoWorkbook({
      id: EVO_VALIDATION_FORMULA_WORKBOOK_ID,
      name: "EVO-M05-VALIDATION-FORMULA",
      worksheetId: EVO_VALIDATION_FORMULA_WORKSHEET_ID,
      worksheetName: "Thresholds",
      updatedAt: "2026-10-05T09:00:00.000Z",
      cells: { J6: "37" },
      selection: { anchor: "J6", focus: "J6" },
      validationRules: [{ range: "J6", type: "number-range", min: 25, max: 75, message: EVO_NUMERIC_MESSAGE }],
    }),
    evoWorkbook({
      id: EVO_VALIDATION_GRID_WORKBOOK_ID,
      name: "EVO-M05-VALIDATION-GRID",
      worksheetId: EVO_VALIDATION_GRID_WORKSHEET_ID,
      worksheetName: "Thresholds",
      updatedAt: "2026-10-05T09:05:00.000Z",
      cells: { K8: "Ready" },
      selection: { anchor: "K8", focus: "K8" },
      validationRules: [
        { range: "K8", type: "dropdown", values: ["Ready", "Holding", "Released"], message: EVO_DROPDOWN_MESSAGE },
      ],
    }),
    evoWorkbook({
      id: EVO_VALIDATION_EDIT_WORKBOOK_ID,
      name: "EVO-M05-VALIDATION-EDIT",
      worksheetId: EVO_VALIDATION_EDIT_WORKSHEET_ID,
      worksheetName: "Thresholds",
      updatedAt: "2026-10-05T09:10:00.000Z",
      cells: { L4: "42" },
      selection: { anchor: "L4", focus: "L4" },
      validationRules: [{ range: "L4", type: "number-range", min: 25, max: 75, message: EVO_NUMERIC_MESSAGE }],
    }),
    // REQ-6-1-1 (freeze rows and columns): one `ScrollLedger` workbook per
    // scenario, each with headers in row 1 and data through row 40/column L.
    evoWorkbook({
      id: EVO_FREEZE_ROW_WORKBOOK_ID,
      name: "EVO-N01-FREEZE-ROW",
      worksheetId: EVO_FREEZE_ROW_WORKSHEET_ID,
      worksheetName: "ScrollLedger",
      updatedAt: "2026-10-06T09:00:00.000Z",
      cells: scrollLedgerCells(),
    }),
    evoWorkbook({
      id: EVO_FREEZE_COLUMN_WORKBOOK_ID,
      name: "EVO-N01-FREEZE-COLUMN",
      worksheetId: EVO_FREEZE_COLUMN_WORKSHEET_ID,
      worksheetName: "ScrollLedger",
      updatedAt: "2026-10-06T09:05:00.000Z",
      cells: scrollLedgerCells(),
    }),
    evoWorkbook({
      id: EVO_FREEZE_BOTH_WORKBOOK_ID,
      name: "EVO-N01-FREEZE-BOTH",
      worksheetId: EVO_FREEZE_BOTH_WORKSHEET_ID,
      worksheetName: "ScrollLedger",
      updatedAt: "2026-10-06T09:10:00.000Z",
      cells: scrollLedgerCells(),
    }),
    // REQ-6-2-1 (find and replace): each scenario searches its own `Narrative`
    // workbook, so a replacement never changes another scenario's data.
    evoWorkbook({
      id: EVO_FIND_NEXT_WORKBOOK_ID,
      name: "EVO-N02-FIND-NEXT",
      worksheetId: EVO_FIND_NEXT_WORKSHEET_ID,
      worksheetName: "Narrative",
      updatedAt: "2026-10-06T09:15:00.000Z",
      cells: { E4: "Cobalt", E7: "Cobalt", E11: "Cobalt" },
    }),
    evoWorkbook({
      id: EVO_REPLACE_ALL_WORKBOOK_ID,
      name: "EVO-N02-REPLACE-ALL",
      worksheetId: EVO_REPLACE_ALL_WORKSHEET_ID,
      worksheetName: "Narrative",
      updatedAt: "2026-10-06T09:20:00.000Z",
      cells: { F3: "Cobalt", F6: "Cobalt", F9: "Cobalt", F12: "Copper" },
    }),
    evoWorkbook({
      id: EVO_CASE_SENSITIVE_WORKBOOK_ID,
      name: "EVO-N02-CASE-SENSITIVE",
      worksheetId: EVO_CASE_SENSITIVE_WORKSHEET_ID,
      worksheetName: "Narrative",
      updatedAt: "2026-10-06T09:25:00.000Z",
      cells: { G3: "Cobalt", G4: "cobalt", G5: "Cobalt-7" },
    }),
    // REQ-7-1-1 (create and edit named ranges): one `ForecastModel` workbook
    // per scenario; the update scenario starts with `MarginBase` and the
    // dependent formula `=SUM(MarginBase)`.
    evoWorkbook({
      id: EVO_NAMED_CREATE_WORKBOOK_ID,
      name: "EVO-N03-NAMED-CREATE",
      worksheetId: EVO_NAMED_CREATE_WORKSHEET_ID,
      worksheetName: "ForecastModel",
      updatedAt: "2026-10-06T09:30:00.000Z",
      cells: { J3: "18", J4: "24", J5: "31" },
    }),
    evoWorkbook({
      id: EVO_NAMED_INVALID_WORKBOOK_ID,
      name: "EVO-N03-NAMED-INVALID",
      worksheetId: EVO_NAMED_INVALID_WORKSHEET_ID,
      worksheetName: "ForecastModel",
      updatedAt: "2026-10-06T09:35:00.000Z",
      cells: { K2: "6", K3: "14" },
    }),
    evoWorkbook({
      id: EVO_NAMED_UPDATE_WORKBOOK_ID,
      name: "EVO-N03-NAMED-UPDATE",
      worksheetId: EVO_NAMED_UPDATE_WORKSHEET_ID,
      worksheetName: "ForecastModel",
      updatedAt: "2026-10-06T09:40:00.000Z",
      cells: { K2: "5", K3: "8", K4: "12", M2: "=SUM(MarginBase)" },
      namedRanges: [{ id: "nr-evo-n03-named-update-margin-base", name: "MarginBase", range: "ForecastModel!K2:K3" }],
    }),
    // REQ-7-2-1 (conditional formatting): one `Signals` workbook per scenario;
    // the edit scenario starts with rule 1 painting Red fill above 20.
    evoWorkbook({
      id: EVO_FORMAT_NUMBER_WORKBOOK_ID,
      name: "EVO-N04-FORMAT-NUMBER",
      worksheetId: EVO_FORMAT_NUMBER_WORKSHEET_ID,
      worksheetName: "Signals",
      updatedAt: "2026-10-06T09:45:00.000Z",
      cells: { J4: "11", J5: "29", J6: "46" },
    }),
    evoWorkbook({
      id: EVO_FORMAT_TEXT_WORKBOOK_ID,
      name: "EVO-N04-FORMAT-TEXT",
      worksheetId: EVO_FORMAT_TEXT_WORKSHEET_ID,
      worksheetName: "Signals",
      updatedAt: "2026-10-06T09:50:00.000Z",
      cells: { K4: "Watch", K5: "Stable", K6: "Elevated" },
    }),
    evoWorkbook({
      id: EVO_FORMAT_EDIT_WORKBOOK_ID,
      name: "EVO-N04-FORMAT-EDIT",
      worksheetId: EVO_FORMAT_EDIT_WORKSHEET_ID,
      worksheetName: "Signals",
      updatedAt: "2026-10-06T09:55:00.000Z",
      cells: { L3: "16", L4: "28", L5: "39" },
      conditionalFormats: [
        {
          id: "cf-evo-n04-format-edit-red",
          range: "L3:L5",
          condition: "Greater than",
          value: "20",
          style: "Red fill",
        },
      ],
    }),
    // REQ-8-1-1 (create, edit and delete a cell note): one `ReviewQueue`
    // workbook per scenario; the edit and delete scenarios carry their own note.
    evoWorkbook({
      id: EVO_NOTE_CREATE_WORKBOOK_ID,
      name: "EVO-N05-NOTE-CREATE",
      worksheetId: "ws-evo-n05-note-create-review-queue",
      worksheetName: "ReviewQueue",
      updatedAt: "2026-10-06T10:00:00.000Z",
      cells: { D8: "Manifest R41" },
    }),
    evoWorkbook({
      id: EVO_NOTE_EDIT_WORKBOOK_ID,
      name: "EVO-N05-NOTE-EDIT",
      worksheetId: "ws-evo-n05-note-edit-review-queue",
      worksheetName: "ReviewQueue",
      updatedAt: "2026-10-06T10:05:00.000Z",
      cells: { F6: "Gate Rho" },
      notes: { F6: EVO_NOTE_EDIT_TEXT },
    }),
    evoWorkbook({
      id: EVO_NOTE_DELETE_WORKBOOK_ID,
      name: "EVO-N05-NOTE-DELETE",
      worksheetId: "ws-evo-n05-note-delete-review-queue",
      worksheetName: "ReviewQueue",
      updatedAt: "2026-10-06T10:10:00.000Z",
      cells: { J3: "Route Zeta" },
      notes: { J3: EVO_NOTE_DELETE_TEXT },
    }),
  ];
}

/** Baseline workbook plus every pre-provisioned evolution workbook. */
export function seedWorkbooks(): Workbook[] {
  return [
    {
      id: SEED_WORKBOOK_ID,
      name: "Q3 Sales",
      createdAt: "2026-09-21T09:00:00.000Z",
      updatedAt: SEED_UPDATED_AT,
      activeWorksheetId: SEED_WORKSHEET_ID,
      worksheets: [
        {
          id: SEED_WORKSHEET_ID,
          name: "Sheet1",
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
    ...evolutionWorkbooks(),
  ];
}
