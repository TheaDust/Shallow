import { vi } from "vitest";

import { cellName, parseCellName } from "../domain/grid";
import type { SummarizeMethod, Worksheet, WorksheetFilter, Workbook } from "../domain/types";

export const SEED_WORKBOOK_ID = "wb-q3-sales";
export const SEED_WORKSHEET_ID = "ws-q3-sheet1";
export const SEED_SECOND_WORKSHEET_ID = "ws-q3-sheet2";
export const SEED_UPDATED_AT = "2026-09-28T14:05:00.000Z";

/** Evolution seeds of REQ-1-2-2, mirroring `createSeedState()` in the backend. */
export const EVO_SEEDED_AT = "2026-09-19T09:00:00.000Z";
export const EVO_RENAME_OK_ID = "wb-evo-m01-rename-ok";
export const EVO_RENAME_OK_WORKSHEET_ID = "ws-evo-m01-rename-ok-log";
export const EVO_RENAME_DUP_ID = "wb-evo-m01-rename-dup";
export const EVO_ARCHIVE_RESERVED_ID = "wb-evo-m01-archive-reserved";
export const EVO_RENAME_LIMIT_ID = "wb-evo-m01-rename-limit";
export const EVO_RENAME_LIMIT_WORKSHEET_ID = "ws-evo-m01-rename-limit-probe";

/** Evolution seeds of REQ-2-1-3 (worksheet rename), mirroring the backend. */
export const EVO_SHEET_OK_ID = "wb-evo-m02-sheet-ok";
export const EVO_SHEET_OK_WORKSHEET_ID = "ws-evo-m02-sheet-ok-harbor";
export const EVO_SHEET_OK_OTHER_WORKSHEET_ID = "ws-evo-m02-sheet-ok-ledger";
export const EVO_SHEET_DUP_ID = "wb-evo-m02-sheet-dup";
export const EVO_SHEET_DUP_WORKSHEET_ID = "ws-evo-m02-sheet-dup-meridian";
export const EVO_SHEET_DUP_ACTIVE_WORKSHEET_ID = "ws-evo-m02-sheet-dup-archive";
export const EVO_SHEET_LIMIT_ID = "wb-evo-m02-sheet-limit";
export const EVO_SHEET_LIMIT_WORKSHEET_ID = "ws-evo-m02-sheet-limit-gauge";

/** Evolution seeds of REQ-3-1-1 (clearing a selection), mirroring the backend. */
export const EVO_CLEAR_TEXT_ID = "wb-evo-m03-clear-text";
export const EVO_CLEAR_TEXT_WORKSHEET_ID = "ws-evo-m03-clear-text-staging";
export const EVO_CLEAR_FORMULA_ID = "wb-evo-m03-clear-formula";
export const EVO_CLEAR_FORMULA_WORKSHEET_ID = "ws-evo-m03-clear-formula-calculations";
export const EVO_CLEAR_RANGE_ID = "wb-evo-m03-clear-range";
export const EVO_CLEAR_RANGE_WORKSHEET_ID = "ws-evo-m03-clear-range-matrix";

/**
 * Evolution seeds of REQ-5-1-2 (saved filter views) and REQ-5-2-1 (custom
 * validation error messages), mirroring `createSeedState()` in the backend:
 * one workbook per scenario, the `EVO-M04-*` ones carrying the same `Workload`
 * table plus the saved view `Queued lanes` where the scenario provides it.
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

/** Evolution seeds of REQ-6-1-1 (freeze panes), mirroring the backend. */
export const EVO_FREEZE_ROW_ID = "wb-evo-n01-freeze-row";
export const EVO_FREEZE_ROW_WORKSHEET_ID = "ws-evo-n01-freeze-row-scroll";
export const EVO_FREEZE_COLUMN_ID = "wb-evo-n01-freeze-column";
export const EVO_FREEZE_COLUMN_WORKSHEET_ID = "ws-evo-n01-freeze-column-scroll";
export const EVO_FREEZE_BOTH_ID = "wb-evo-n01-freeze-both";
export const EVO_FREEZE_BOTH_WORKSHEET_ID = "ws-evo-n01-freeze-both-scroll";

/** Evolution seeds of REQ-6-2-1 (find and replace), mirroring the backend. */
export const EVO_FIND_NEXT_ID = "wb-evo-n02-find-next";
export const EVO_FIND_NEXT_WORKSHEET_ID = "ws-evo-n02-find-next-narrative";
export const EVO_REPLACE_ALL_ID = "wb-evo-n02-replace-all";
export const EVO_REPLACE_ALL_WORKSHEET_ID = "ws-evo-n02-replace-all-narrative";
export const EVO_CASE_SENSITIVE_ID = "wb-evo-n02-case-sensitive";
export const EVO_CASE_SENSITIVE_WORKSHEET_ID = "ws-evo-n02-case-sensitive-narrative";

/**
 * Evolution seeds of REQ-8-1-1 (cell notes), mirroring `createSeedState()` in
 * the backend: one `ReviewQueue` workbook per scenario. `EVO-N05-NOTE-CREATE`
 * carries `Manifest R41` on D8 without a note, `EVO-N05-NOTE-EDIT` carries
 * `Gate Rho` on F6 with its note, and `EVO-N05-NOTE-DELETE` carries
 * `Route Zeta` on J3 with its note.
 */
export const EVO_NOTE_CREATE_ID = "wb-evo-n05-note-create";
export const EVO_NOTE_CREATE_WORKSHEET_ID = "ws-evo-n05-note-create-review";
export const EVO_NOTE_EDIT_ID = "wb-evo-n05-note-edit";
export const EVO_NOTE_EDIT_WORKSHEET_ID = "ws-evo-n05-note-edit-review";
export const EVO_NOTE_DELETE_ID = "wb-evo-n05-note-delete";
export const EVO_NOTE_DELETE_WORKSHEET_ID = "ws-evo-n05-note-delete-review";

/**
 * Evolution seeds of REQ-7-1-1 (named ranges) and REQ-7-2-1 (conditional
 * formatting), mirroring `createSeedState()` in the backend: one workbook per
 * scenario, the `ForecastModel` sheet for the named ranges and the `Signals`
 * sheet for the conditional formatting rules.
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

/** Headers of the `ScrollLedger` freeze seeds, one per column A..L of row 1. */
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

/** Mirror of the backend `ScrollLedger` data cell. */
function ledgerCell(row: number, column: number): string {
  if (column === 1) return `SL-${1000 + row}`;
  if (column === 2) return LEDGER_OWNERS[(row - 2) % LEDGER_OWNERS.length];
  if (column === 3) return String(40 + row * 3);
  if (column === 4) return `2026-09-${String(((row - 2) % 28) + 1).padStart(2, "0")}`;
  if (column === 5) return LEDGER_STATUSES[(row - 2) % LEDGER_STATUSES.length];
  return `${SCROLL_LEDGER_HEADERS[column - 1]} ${row}`;
}

/** Mirror of the backend `ScrollLedger` seed grid. */
function scrollLedgerCells({ lastRow, lastColumn }: { lastRow: number; lastColumn: number }): Record<string, string> {
  const cells: Record<string, string> = {};
  for (let column = 1; column <= lastColumn; column += 1) {
    cells[cellName(1, column)] = SCROLL_LEDGER_HEADERS[column - 1];
  }
  for (let row = 2; row <= lastRow; row += 1) {
    for (let column = 1; column <= lastColumn; column += 1) {
      cells[cellName(row, column)] = ledgerCell(row, column);
    }
  }
  return cells;
}

/** Shared `Workload` records of every `EVO-M04-*` seed workbook. */
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

/** Saved view selecting the `Phase` value `Queued` of the seeded `Workload` table. */
function queuedLanesView() {
  return {
    name: "Queued lanes",
    filter: {
      range: "D3:F7",
      columns: [
        { column: 4, header: "Workstream", mode: "values" as const, values: [] },
        { column: 5, header: "Phase", mode: "values" as const, values: ["Queued"] },
        { column: 6, header: "Load", mode: "values" as const, values: [] },
      ],
    },
  };
}

/** Maximum worksheet name length, counted after trimming (server authoritative). */
export const MAX_WORKSHEET_NAME_LENGTH = 50;

/**
 * Independent EVO workbooks, one per rename scenario: `IdentityLog` carries the
 * `unreviewed` sentinel, `LimitProbe` the `limit sentinel`, and
 * `EVO-M01-ARCHIVE-RESERVED` the name a case-insensitive rename must not take.
 * The `EVO-M02-SHEET-*` workbooks cover the worksheet rename scenarios and the
 * `EVO-M03-CLEAR-*` workbooks the Delete-clears-a-selection scenarios.
 */
function evoSeedWorkbooks(): Workbook[] {
  const created = EVO_SEEDED_AT;
  const sheet = (id: string, name: string, cells: Record<string, string>, selection = { anchor: "A1", focus: "A1" }) => ({
    id,
    name,
    selection,
    cells,
  });
  const reviewQueue = (id: string, cells: Record<string, string>, notes?: Record<string, string>) => ({
    ...sheet(id, "ReviewQueue", cells),
    ...(notes ? { notes } : {}),
  });
  const workload = (id: string) => sheet(id, "Workload", { ...WORKLOAD_CELLS }, { anchor: "D3", focus: "F7" });
  return [
    {
      id: EVO_NOTE_CREATE_ID,
      name: "EVO-N05-NOTE-CREATE",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_NOTE_CREATE_WORKSHEET_ID,
      worksheets: [reviewQueue(EVO_NOTE_CREATE_WORKSHEET_ID, { D8: "Manifest R41" })],
    },
    {
      id: EVO_NOTE_EDIT_ID,
      name: "EVO-N05-NOTE-EDIT",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_NOTE_EDIT_WORKSHEET_ID,
      worksheets: [
        reviewQueue(EVO_NOTE_EDIT_WORKSHEET_ID, { F6: "Gate Rho" }, { F6: "Awaiting controller sign-off" }),
      ],
    },
    {
      id: EVO_NOTE_DELETE_ID,
      name: "EVO-N05-NOTE-DELETE",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_NOTE_DELETE_WORKSHEET_ID,
      worksheets: [
        reviewQueue(EVO_NOTE_DELETE_WORKSHEET_ID, { J3: "Route Zeta" }, { J3: "Retire after audit" }),
      ],
    },
    {
      id: EVO_NAMED_CREATE_ID,
      name: "EVO-N03-NAMED-CREATE",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_NAMED_CREATE_WORKSHEET_ID,
      worksheets: [sheet(EVO_NAMED_CREATE_WORKSHEET_ID, "ForecastModel", { J3: "18", J4: "24", J5: "31" })],
    },
    {
      id: EVO_NAMED_INVALID_ID,
      name: "EVO-N03-NAMED-INVALID",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_NAMED_INVALID_WORKSHEET_ID,
      worksheets: [sheet(EVO_NAMED_INVALID_WORKSHEET_ID, "ForecastModel", { K2: "6", K3: "14" })],
    },
    {
      id: EVO_NAMED_UPDATE_ID,
      name: "EVO-N03-NAMED-UPDATE",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_NAMED_UPDATE_WORKSHEET_ID,
      namedRanges: [{ name: "MarginBase", range: "ForecastModel!K2:K3" }],
      worksheets: [
        sheet(EVO_NAMED_UPDATE_WORKSHEET_ID, "ForecastModel", { K2: "5", K3: "8", K4: "12", M2: "=SUM(MarginBase)" }),
      ],
    },
    {
      id: EVO_FORMAT_NUMBER_ID,
      name: "EVO-N04-FORMAT-NUMBER",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_FORMAT_NUMBER_WORKSHEET_ID,
      worksheets: [sheet(EVO_FORMAT_NUMBER_WORKSHEET_ID, "Signals", { J4: "11", J5: "29", J6: "46" })],
    },
    {
      id: EVO_FORMAT_TEXT_ID,
      name: "EVO-N04-FORMAT-TEXT",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_FORMAT_TEXT_WORKSHEET_ID,
      worksheets: [sheet(EVO_FORMAT_TEXT_WORKSHEET_ID, "Signals", { K4: "Watch", K5: "Stable", K6: "Elevated" })],
    },
    {
      id: EVO_FORMAT_EDIT_ID,
      name: "EVO-N04-FORMAT-EDIT",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_FORMAT_EDIT_WORKSHEET_ID,
      worksheets: [
        {
          ...sheet(EVO_FORMAT_EDIT_WORKSHEET_ID, "Signals", { L3: "16", L4: "28", L5: "39" }),
          conditionalRules: [{ range: "L3:L5", condition: "greater-than", value: "20", style: "red-fill" }],
        },
      ],
    },    {
      id: EVO_RENAME_OK_ID,
      name: "EVO-M01-RENAME-OK",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_RENAME_OK_WORKSHEET_ID,
      worksheets: [sheet(EVO_RENAME_OK_WORKSHEET_ID, "IdentityLog", { F3: "unreviewed" })],
    },
    {
      id: EVO_RENAME_DUP_ID,
      name: "EVO-M01-RENAME-DUP",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: "ws-evo-m01-rename-dup-log",
      worksheets: [sheet("ws-evo-m01-rename-dup-log", "IdentityLog", {})],
    },
    {
      id: EVO_ARCHIVE_RESERVED_ID,
      name: "EVO-M01-ARCHIVE-RESERVED",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: "ws-evo-m01-archive-reserved",
      worksheets: [sheet("ws-evo-m01-archive-reserved", "Sheet1", {})],
    },
    {
      id: EVO_RENAME_LIMIT_ID,
      name: "EVO-M01-RENAME-LIMIT",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_RENAME_LIMIT_WORKSHEET_ID,
      worksheets: [sheet(EVO_RENAME_LIMIT_WORKSHEET_ID, "LimitProbe", { C2: "limit sentinel" })],
    },
    {
      id: EVO_SHEET_OK_ID,
      name: "EVO-M02-SHEET-OK",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_SHEET_OK_WORKSHEET_ID,
      worksheets: [
        sheet(EVO_SHEET_OK_WORKSHEET_ID, "HarborDraft", { D5: "dock marker" }),
        sheet(EVO_SHEET_OK_OTHER_WORKSHEET_ID, "LedgerView", {}),
      ],
    },
    {
      id: EVO_SHEET_DUP_ID,
      name: "EVO-M02-SHEET-DUP",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_SHEET_DUP_ACTIVE_WORKSHEET_ID,
      worksheets: [
        sheet(EVO_SHEET_DUP_WORKSHEET_ID, "Meridian", {}),
        sheet(EVO_SHEET_DUP_ACTIVE_WORKSHEET_ID, "ArchiveBay", {}),
      ],
    },
    {
      id: EVO_SHEET_LIMIT_ID,
      name: "EVO-M02-SHEET-LIMIT",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_SHEET_LIMIT_WORKSHEET_ID,
      worksheets: [sheet(EVO_SHEET_LIMIT_WORKSHEET_ID, "LengthGauge", { G4: "sheet sentinel" })],
    },
    {
      id: EVO_CLEAR_TEXT_ID,
      name: "EVO-M03-CLEAR-TEXT",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_CLEAR_TEXT_WORKSHEET_ID,
      worksheets: [sheet(EVO_CLEAR_TEXT_WORKSHEET_ID, "Staging", { H4: "obsolete tag" })],
    },
    {
      id: EVO_CLEAR_FORMULA_ID,
      name: "EVO-M03-CLEAR-FORMULA",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_CLEAR_FORMULA_WORKSHEET_ID,
      worksheets: [
        sheet(EVO_CLEAR_FORMULA_WORKSHEET_ID, "Calculations", { B7: "13", C7: "=B7*5", D7: "=C7+2" }),
      ],
    },
    {
      id: EVO_CLEAR_RANGE_ID,
      name: "EVO-M03-CLEAR-RANGE",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_CLEAR_RANGE_WORKSHEET_ID,
      worksheets: [
        sheet(EVO_CLEAR_RANGE_WORKSHEET_ID, "Matrix", {
          H4: "Amber",
          I4: "Delta",
          H5: "Kite",
          I5: "Orchid",
        }),
      ],
    },
    {
      id: EVO_FILTER_SAVE_ID,
      name: "EVO-M04-FILTER-SAVE",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_FILTER_SAVE_WORKSHEET_ID,
      worksheets: [workload(EVO_FILTER_SAVE_WORKSHEET_ID)],
    },
    {
      id: EVO_FILTER_APPLY_ID,
      name: "EVO-M04-FILTER-APPLY",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_FILTER_APPLY_WORKSHEET_ID,
      filterViews: [queuedLanesView()],
      worksheets: [workload(EVO_FILTER_APPLY_WORKSHEET_ID)],
    },
    {
      id: EVO_FILTER_DELETE_ID,
      name: "EVO-M04-FILTER-DELETE",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_FILTER_DELETE_WORKSHEET_ID,
      filterViews: [queuedLanesView()],
      worksheets: [workload(EVO_FILTER_DELETE_WORKSHEET_ID)],
    },
    {
      id: EVO_VALIDATION_FORMULA_ID,
      name: "EVO-M05-VALIDATION-FORMULA",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_VALIDATION_FORMULA_WORKSHEET_ID,
      worksheets: [
        {
          ...sheet(EVO_VALIDATION_FORMULA_WORKSHEET_ID, "Thresholds", { J6: "37" }, { anchor: "J6", focus: "J6" }),
          validationRules: [
            { range: "J6", type: "number-range", min: 25, max: 75, errorMessage: "Capacity must be from 25 to 75" },
          ],
        },
      ],
    },
    {
      id: EVO_VALIDATION_GRID_ID,
      name: "EVO-M05-VALIDATION-GRID",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_VALIDATION_GRID_WORKSHEET_ID,
      worksheets: [
        {
          ...sheet(EVO_VALIDATION_GRID_WORKSHEET_ID, "Thresholds", { K8: "Ready" }, { anchor: "K8", focus: "K8" }),
          validationRules: [
            {
              range: "K8",
              type: "dropdown",
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
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_VALIDATION_EDIT_WORKSHEET_ID,
      worksheets: [
        {
          ...sheet(EVO_VALIDATION_EDIT_WORKSHEET_ID, "Thresholds", { L4: "42" }, { anchor: "L4", focus: "L4" }),
          validationRules: [
            {
              range: "L4",
              type: "number-range",
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
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_FREEZE_ROW_WORKSHEET_ID,
      worksheets: [
        sheet(EVO_FREEZE_ROW_WORKSHEET_ID, "ScrollLedger", scrollLedgerCells({ lastRow: 40, lastColumn: 12 })),
      ],
    },
    {
      id: EVO_FREEZE_COLUMN_ID,
      name: "EVO-N01-FREEZE-COLUMN",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_FREEZE_COLUMN_WORKSHEET_ID,
      worksheets: [
        sheet(
          EVO_FREEZE_COLUMN_WORKSHEET_ID,
          "ScrollLedger",
          scrollLedgerCells({ lastRow: 40, lastColumn: 12 }),
        ),
      ],
    },
    {
      id: EVO_FREEZE_BOTH_ID,
      name: "EVO-N01-FREEZE-BOTH",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_FREEZE_BOTH_WORKSHEET_ID,
      worksheets: [
        sheet(EVO_FREEZE_BOTH_WORKSHEET_ID, "ScrollLedger", scrollLedgerCells({ lastRow: 40, lastColumn: 12 })),
      ],
    },
    {
      id: EVO_FIND_NEXT_ID,
      name: "EVO-N02-FIND-NEXT",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_FIND_NEXT_WORKSHEET_ID,
      worksheets: [sheet(EVO_FIND_NEXT_WORKSHEET_ID, "Narrative", { E4: "Cobalt", E7: "Cobalt", E11: "Cobalt" })],
    },
    {
      id: EVO_REPLACE_ALL_ID,
      name: "EVO-N02-REPLACE-ALL",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_REPLACE_ALL_WORKSHEET_ID,
      worksheets: [
        sheet(EVO_REPLACE_ALL_WORKSHEET_ID, "Narrative", { F3: "Cobalt", F6: "Cobalt", F9: "Cobalt", F12: "Copper" }),
      ],
    },
    {
      id: EVO_CASE_SENSITIVE_ID,
      name: "EVO-N02-CASE-SENSITIVE",
      createdAt: created,
      updatedAt: created,
      activeWorksheetId: EVO_CASE_SENSITIVE_WORKSHEET_ID,
      worksheets: [
        sheet(EVO_CASE_SENSITIVE_WORKSHEET_ID, "Narrative", { G3: "Cobalt", G4: "cobalt", G5: "Cobalt-7" }),
      ],
    },
  ];
}

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
    ...evoSeedWorkbooks(),
  ];
}

export interface FakeApi {
  readonly workbooks: Workbook[];
  /** Make the next matching request fail with a 500 response. */
  failOnce(method: string, pathname: string): void;
  restore(): void;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function summary(workbook: Workbook) {
  return {
    id: workbook.id,
    name: workbook.name,
    createdAt: workbook.createdAt,
    updatedAt: workbook.updatedAt,
    activeWorksheetId: workbook.activeWorksheetId,
    worksheetCount: workbook.worksheets.length,
  };
}

function nextSheetName(workbook: Workbook): string {
  const used = new Set(workbook.worksheets.map((worksheet) => worksheet.name.toLowerCase()));
  let index = 1;
  while (used.has(`sheet${index}`)) index += 1;
  return `Sheet${index}`;
}

/**
 * Test-double mirror of `backend/src/domain/structure.mjs`: shifts plain values
 * for the inserted or deleted line (the authoritative implementation also
 * rewrites formula references and lives on the server).
 */
function shiftCells(
  cells: Record<string, string>,
  axis: "row" | "column",
  mode: string,
  index: number,
): Record<string, string> {
  const at = mode === "insert-after" ? index + 1 : index;
  const next: Record<string, string> = {};
  for (const [coordinate, raw] of Object.entries(cells)) {
    const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(coordinate);
    if (!match) continue;
    let column = 0;
    for (const letter of match[1].toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64);
    let row = Number(match[2]);
    if (mode === "delete") {
      if (axis === "row" ? row === index : column === index) continue;
      if (axis === "row" ? row > index : column > index) {
        if (axis === "row") row -= 1;
        else column -= 1;
      }
    } else if (axis === "row" ? row >= at : column >= at) {
      if (axis === "row") row += 1;
      else column += 1;
    }
    next[cellName(row, column)] = raw;
  }
  return next;
}

/** Canonical `Sheet!A1` / `Sheet!A1:B2` text of a named range, or `null`. */
function parseNamedRangeArea(value: unknown): { sheet: string; area: string } | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const separator = text.lastIndexOf("!");
  if (separator <= 0 || separator === text.length - 1) return null;
  const sheetName = text.slice(0, separator).trim();
  if (sheetName === "") return null;
  const area = normalizeArea(text.slice(separator + 1));
  if (!area) return null;
  return { sheet: sheetName, area };
}

/** Canonical `A1`/`A1:B2` area, or `null` when the range is malformed. */
function normalizeArea(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parts = value.trim().split(":");
  if (parts.length < 1 || parts.length > 2) return null;
  const first = parseCellName(parts[0]);
  const last = parts.length === 2 ? parseCellName(parts[1]) : first;
  if (!first || !last) return null;
  const top = Math.min(first.row, last.row);
  const bottom = Math.max(first.row, last.row);
  const left = Math.min(first.column, last.column);
  const right = Math.max(first.column, last.column);
  const start = cellName(top, left);
  const end = cellName(bottom, right);
  return start === end ? start : `${start}:${end}`;
}

/** Test-double mirror of the backend validation rules used by write endpoints. */
function validationMessage(
  worksheet: Worksheet,
  updates: Array<{ coordinate: string; value: string }>,
): string | null {
  const rules = worksheet.validationRules;
  if (!Array.isArray(rules) || rules.length === 0) return null;
  // A nonempty error message of the rule replaces its standard rejection text.
  const custom = (rule: { errorMessage?: unknown }) =>
    typeof rule.errorMessage === "string" && rule.errorMessage.trim() !== "" ? rule.errorMessage.trim() : null;
  for (const update of updates) {
    const position = parseCellName(update.coordinate);
    if (!position) continue;
    for (const rule of rules) {
      const [start, end = start] = String(rule?.range ?? "").split(":");
      const first = parseCellName(start);
      const last = parseCellName(end);
      if (!first || !last) continue;
      const top = Math.min(first.row, last.row);
      const bottom = Math.max(first.row, last.row);
      const left = Math.min(first.column, last.column);
      const right = Math.max(first.column, last.column);
      if (position.row < top || position.row > bottom || position.column < left || position.column > right) continue;
      if (rule.type === "number-range") {
        const text = update.value.trim();
        if (!text) continue;
        const number = Number(text);
        if (!Number.isFinite(number) || number < (rule.min ?? 0) || number > (rule.max ?? 0)) {
          return (
            custom(rule) ??
            (rule.min === 0 && rule.max === 100
              ? "Please enter a number from 0 to 100"
              : `Please enter a number between ${rule.min} and ${rule.max}`)
          );
        }
      } else if (rule.type === "dropdown") {
        const allowed = Array.isArray(rule.values) ? rule.values : [];
        if (update.value !== "" && !allowed.includes(update.value)) {
          return custom(rule) ?? `Please select one of the following values: ${allowed.join(", ")}`;
        }
      }
    }
  }
  return null;
}

/** Test-double mirror of the backend pivot domain: derived summary cell maps. */
function parseCellNumber(text: unknown): number | null {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function formatCellNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

interface Bounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function areaBounds(value: unknown): Bounds | null {
  const text = typeof value === "string" ? value.trim() : "";
  const parts = text.split(":");
  if (parts.length < 1 || parts.length > 2) return null;
  const first = parseCellName(parts[0]);
  const last = parts.length === 2 ? parseCellName(parts[1]) : first;
  if (!first || !last) return null;
  return {
    top: Math.min(first.row, last.row),
    bottom: Math.max(first.row, last.row),
    left: Math.min(first.column, last.column),
    right: Math.max(first.column, last.column),
  };
}

function boundsText(bounds: Bounds): string {
  const start = cellName(bounds.top, bounds.left);
  const end = cellName(bounds.bottom, bounds.right);
  return start === end ? start : `${start}:${end}`;
}

/**
 * Mirror of the backend filter shift: the filtered range and each column index
 * follow their cells, and a column whose header was deleted is dropped.
 */
function shiftFilterRange(
  filter: WorksheetFilter,
  axis: "row" | "column",
  mode: string,
  at: number,
): WorksheetFilter | null {
  const range = shiftArea(filter.range, axis, mode, at);
  if (!range) return null;
  const columns = (Array.isArray(filter.columns) ? filter.columns : []).flatMap((column) => {
    if (axis !== "column") return [column];
    if (mode === "delete") {
      if (column.column === at) return [];
      return [{ ...column, column: column.column > at ? column.column - 1 : column.column }];
    }
    return [{ ...column, column: column.column >= at ? column.column + 1 : column.column }];
  });
  return { ...filter, range, columns };
}

/** Moves an A1 area with its cells; `null` when a deleted line covered it. */
function shiftArea(area: unknown, axis: "row" | "column", mode: string, at: number): string | null {
  const bounds = areaBounds(area);
  if (!bounds) return null;
  const next = { ...bounds };
  if (axis === "row") {
    if (mode === "delete") {
      next.top = next.top > at ? next.top - 1 : next.top;
      next.bottom = next.bottom >= at ? next.bottom - 1 : next.bottom;
    } else {
      next.top = next.top >= at ? next.top + 1 : next.top;
      next.bottom = next.bottom >= at ? next.bottom + 1 : next.bottom;
    }
  } else if (mode === "delete") {
    next.left = next.left > at ? next.left - 1 : next.left;
    next.right = next.right >= at ? next.right - 1 : next.right;
  } else {
    next.left = next.left >= at ? next.left + 1 : next.left;
    next.right = next.right >= at ? next.right + 1 : next.right;
  }
  if (next.bottom < next.top || next.right < next.left) return null;
  return boundsText(next);
}

function nextPivotName(workbook: Workbook): string {
  const used = new Set(workbook.worksheets.map((worksheet) => worksheet.name));
  let index = 1;
  while (used.has(`Pivot${index}`)) index += 1;
  return `Pivot${index}`;
}

/** Mirror of the backend pivot builder; returns the message instead of throwing. */
function buildPivotCells(
  cells: Record<string, string>,
  range: string,
  config: { rowField: string; columnField: string; valueField: string; summarizeBy: SummarizeMethod },
): { cells: Record<string, string> } | { error: string } {
  const bounds = areaBounds(range);
  if (!bounds) return { error: "Invalid pivot table configuration" };
  const headers: Array<{ column: number; header: string }> = [];
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    const header = cells[cellName(bounds.top, column)] ?? "";
    if (header !== "") headers.push({ column, header });
  }
  const columnOf = (field: string) => headers.find((header) => header.header === field)?.column ?? null;
  const rowColumn = columnOf(config.rowField);
  const valueColumn = columnOf(config.valueField);
  const columnColumn = config.columnField === "" ? null : columnOf(config.columnField);
  if (rowColumn === null || valueColumn === null || (config.columnField !== "" && columnColumn === null)) {
    return { error: "Pivot field is no longer available. Select a new field." };
  }
  const records: Array<{ row: string; column: string | null; value: string }> = [];
  for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
    const group = cells[cellName(row, rowColumn)] ?? "";
    if (group === "") continue;
    records.push({
      row: group,
      column: columnColumn === null ? null : cells[cellName(row, columnColumn)] ?? "",
      value: cells[cellName(row, valueColumn)] ?? "",
    });
  }
  const summarize = (values: string[]) => {
    if (config.summarizeBy === "COUNT") return values.filter((value) => value !== "").length;
    const numbers = values.map(parseCellNumber).filter((value): value is number => value !== null);
    if (config.summarizeBy === "AVERAGE") {
      return numbers.length === 0 ? 0 : numbers.reduce((total, value) => total + value, 0) / numbers.length;
    }
    return numbers.reduce((total, value) => total + value, 0);
  };
  if (config.summarizeBy !== "COUNT" && !records.some((record) => parseCellNumber(record.value) !== null)) {
    return { error: "Value field requires numeric values" };
  }
  const firstAppearance = (values: string[]) => [...new Set(values)];
  const rowGroups = firstAppearance(records.map((record) => record.row));
  const result: Record<string, string> = { A1: config.rowField };
  if (columnColumn === null) {
    result.B1 = `${config.summarizeBy} of ${config.valueField}`;
    rowGroups.forEach((group, index) => {
      result[cellName(index + 2, 1)] = group;
      result[cellName(index + 2, 2)] = formatCellNumber(
        summarize(records.filter((record) => record.row === group).map((record) => record.value)),
      );
    });
    result[cellName(rowGroups.length + 2, 1)] = "Grand Total";
    result[cellName(rowGroups.length + 2, 2)] = formatCellNumber(summarize(records.map((record) => record.value)));
    return { cells: result };
  }
  const columnGroups = firstAppearance(records.map((record) => record.column ?? ""));
  columnGroups.forEach((group, index) => {
    result[cellName(1, index + 2)] = group;
  });
  const totalColumn = columnGroups.length + 2;
  result[cellName(1, totalColumn)] = "Grand Total";
  rowGroups.forEach((group, index) => {
    const line = index + 2;
    const rowRecords = records.filter((record) => record.row === group);
    result[cellName(line, 1)] = group;
    columnGroups.forEach((group2, columnIndex) => {
      result[cellName(line, columnIndex + 2)] = formatCellNumber(
        summarize(rowRecords.filter((record) => record.column === group2).map((record) => record.value)),
      );
    });
    result[cellName(line, totalColumn)] = formatCellNumber(summarize(rowRecords.map((record) => record.value)));
  });
  const totalLine = rowGroups.length + 2;
  result[cellName(totalLine, 1)] = "Grand Total";
  columnGroups.forEach((group, columnIndex) => {
    result[cellName(totalLine, columnIndex + 2)] = formatCellNumber(
      summarize(records.filter((record) => record.column === group).map((record) => record.value)),
    );
  });
  result[cellName(totalLine, totalColumn)] = formatCellNumber(summarize(records.map((record) => record.value)));
  return { cells: result };
}

/** Mirror of the backend default layout: first header groups, first numeric header sums. */
function defaultPivotConfig(
  cells: Record<string, string>,
  range: string,
): { rowField: string; columnField: string; valueField: string; summarizeBy: SummarizeMethod } | null {
  const bounds = areaBounds(range);
  if (!bounds) return null;
  const headers: Array<{ column: number; header: string }> = [];
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    const header = cells[cellName(bounds.top, column)] ?? "";
    if (header !== "") headers.push({ column, header });
  }
  if (headers.length === 0) return null;
  const rowField = headers[0].header;
  const numeric = headers.find((header) => {
    for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
      if (parseCellNumber(cells[cellName(row, header.column)]) !== null) return true;
    }
    return false;
  });
  if (numeric) return { rowField, columnField: "", valueField: numeric.header, summarizeBy: "SUM" };
  const counted = headers.find((header) => header.header !== rowField) ?? headers[0];
  return { rowField, columnField: "", valueField: counted.header, summarizeBy: "COUNT" };
}

/**
 * Test-double mirror of the backend range sort: reorders whole records by one
 * column (numbers and dates by value, otherwise text, stable ties). The
 * authoritative implementation also rewrites formula row references.
 */
function compareSortValues(left: string | undefined, right: string | undefined): number {
  const leftText = String(left ?? "");
  const rightText = String(right ?? "");
  const leftNumber = leftText.trim() === "" ? null : Number(leftText.trim());
  const rightNumber = rightText.trim() === "" ? null : Number(rightText.trim());
  if (leftNumber !== null && rightNumber !== null && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  const leftDate = leftText.trim() === "" ? null : Date.parse(leftText.trim());
  const rightDate = rightText.trim() === "" ? null : Date.parse(rightText.trim());
  if (leftDate !== null && rightDate !== null && !Number.isNaN(leftDate) && !Number.isNaN(rightDate)) {
    return leftDate - rightDate;
  }
  return leftText.trim().localeCompare(rightText.trim());
}

function sortCells(
  cells: Record<string, string>,
  bounds: Bounds,
  column: number,
  order: string,
  hasHeaderRow: boolean,
): Record<string, string> {
  const firstDataRow = hasHeaderRow ? bounds.top + 1 : bounds.top;
  if (firstDataRow > bounds.bottom) return { ...cells };
  const dataRows: number[] = [];
  for (let row = firstDataRow; row <= bounds.bottom; row += 1) dataRows.push(row);
  const decorated = dataRows.map((row, index) => ({ row, index }));
  const isBlank = (row: number) => String(cells[cellName(row, column)] ?? "").trim() === "";
  decorated.sort((a, b) => {
    const leftBlank = isBlank(a.row);
    const rightBlank = isBlank(b.row);
    if (leftBlank !== rightBlank) return leftBlank ? 1 : -1;
    const primary = compareSortValues(cells[cellName(a.row, column)], cells[cellName(b.row, column)]);
    if (primary !== 0) return order === "desc" ? -primary : primary;
    return a.index - b.index;
  });
  const next = { ...cells };
  decorated.forEach(({ row: sourceRow }, position) => {
    const targetRow = firstDataRow + position;
    for (let c = bounds.left; c <= bounds.right; c += 1) {
      const raw = cells[cellName(sourceRow, c)];
      const target = cellName(targetRow, c);
      if (raw === undefined) delete next[target];
      else next[target] = raw;
    }
  });
  return next;
}

/** Installs an in-memory fetch double implementing the workbook API contract. */
export function installFakeApi(initial: Workbook[] = seedWorkbooks()): FakeApi {
  const workbooks = structuredClone(initial);
  const failures = new Set<string>();
  let counter = 0;

  const handle = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url.pathname}`;
    if (failures.has(key)) {
      failures.delete(key);
      return jsonResponse(500, { error: "Server error" });
    }

    if (url.pathname === "/api/workbooks") {
      if (method === "GET") {
        const sorted = [...workbooks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return jsonResponse(200, { workbooks: sorted.map(summary) });
      }
      if (method === "POST") {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const now = new Date().toISOString();
        counter += 1;
        const workbook: Workbook = {
          id: `wb-new-${counter}`,
          name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Untitled workbook",
          createdAt: now,
          updatedAt: now,
          activeWorksheetId: `ws-new-${counter}`,
          worksheets: [{ id: `ws-new-${counter}`, name: "Sheet1", cells: {} }],
        };
        workbooks.push(workbook);
        return jsonResponse(201, { workbook });
      }
    }

    if (url.pathname === "/api/workbooks/import" && method === "POST") {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
      const rows: unknown = body.rows;
      if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row) || row.some((cell) => typeof cell !== "string"))) {
        return jsonResponse(400, { error: "Invalid CSV file format. Import failed." });
      }
      const cells: Record<string, string> = {};
      (rows as string[][]).forEach((row, rowIndex) => {
        row.forEach((value, columnIndex) => {
          cells[cellName(rowIndex + 1, columnIndex + 1)] = value;
        });
      });
      const now = new Date().toISOString();
      counter += 1;
      const workbook: Workbook = {
        id: `wb-import-${counter}`,
        name: fileName.replace(/\.csv$/i, "").trim() || "Untitled workbook",
        createdAt: now,
        updatedAt: now,
        activeWorksheetId: `ws-import-${counter}`,
        worksheets: [{ id: `ws-import-${counter}`, name: "Sheet1", cells }],
      };
      workbooks.push(workbook);
      return jsonResponse(201, { workbook });
    }

    const structureMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/structure$/.exec(url.pathname);
    if (structureMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(structureMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      if (method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(structureMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const axis: unknown = body.axis;
      const mode: unknown = body.mode;
      const index: unknown = body.index;
      if (axis !== "row" && axis !== "column") return jsonResponse(400, { error: "Invalid row or column change" });
      if (mode !== "insert-before" && mode !== "insert-after" && mode !== "delete") {
        return jsonResponse(400, { error: "Invalid row or column change" });
      }
      if (!Number.isInteger(index) || (index as number) < 1) {
        return jsonResponse(400, { error: "Invalid row or column change" });
      }
      worksheet.cells = shiftCells(worksheet.cells, axis, mode, index as number);
      // Pivot tables reading this worksheet move their source range with it.
      const at = mode === "insert-after" ? (index as number) + 1 : (index as number);
      for (const other of workbook.worksheets) {
        if (!other.pivot || other.pivot.sourceWorksheetId !== worksheet.id) continue;
        const moved = shiftArea(other.pivot.range, axis, mode as string, at);
        if (moved) other.pivot = { ...other.pivot, range: moved };
      }
      if (worksheet.filter) {
        const movedFilter = shiftFilterRange(worksheet.filter, axis, mode as string, at);
        if (movedFilter) worksheet.filter = movedFilter;
        else delete worksheet.filter;
      }
      if (Array.isArray(workbook.filterViews)) {
        workbook.filterViews = workbook.filterViews.flatMap((view) => {
          const movedView = view?.filter ? shiftFilterRange(view.filter, axis, mode as string, at) : null;
          return movedView ? [{ ...view, filter: movedView }] : [];
        });
      }
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const sortMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/sort$/.exec(url.pathname);
    if (sortMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(sortMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      if (method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(sortMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const bounds = areaBounds(body.range);
      const column: unknown = body.column;
      if (
        !bounds ||
        !Number.isInteger(column) ||
        (column as number) < bounds.left ||
        (column as number) > bounds.right ||
        (body.order !== "asc" && body.order !== "desc") ||
        typeof body.hasHeaderRow !== "boolean"
      ) {
        return jsonResponse(400, { error: "Invalid sort request" });
      }
      worksheet.cells = sortCells(worksheet.cells, bounds, column as number, body.order, body.hasHeaderRow);
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const transferMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/range-transfer$/.exec(url.pathname);
    if (transferMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(transferMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      if (method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(transferMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const target = String(body.target ?? "").trim().toUpperCase();
      const origin = /^([A-Z]+)([1-9][0-9]*)$/.exec(target);
      const rows: unknown = body.rows;
      if (!origin || !Array.isArray(rows) || rows.some((row) => !Array.isArray(row) || row.some((cell) => typeof cell !== "string"))) {
        return jsonResponse(400, { error: "Invalid range transfer" });
      }
      const toColumn = (letters: string) => [...letters].reduce((value, letter) => value * 26 + (letter.charCodeAt(0) - 64), 0);
      const column = toColumn(origin[1]);
      const row = Number(origin[2]);
      const updates: Array<{ coordinate: string; value: string }> = [];
      (rows as string[][]).forEach((values, rowIndex) => {
        values.forEach((value, columnIndex) => {
          updates.push({ coordinate: cellName(row + rowIndex, column + columnIndex), value });
        });
      });
      const violation = validationMessage(worksheet, updates);
      if (violation) return jsonResponse(400, { error: violation });
      const sourceText = typeof body.source === "string" && body.source.trim() ? body.source.trim().toUpperCase() : null;
      let sourceBounds: { top: number; bottom: number; left: number; right: number } | null = null;
      if (sourceText) {
        const [start, end = start] = sourceText.split(":");
        const first = /^([A-Z]+)([1-9][0-9]*)$/.exec(start);
        const last = /^([A-Z]+)([1-9][0-9]*)$/.exec(end);
        if (!first || !last) return jsonResponse(400, { error: "Invalid range transfer" });
        sourceBounds = {
          top: Math.min(Number(first[2]), Number(last[2])),
          bottom: Math.max(Number(first[2]), Number(last[2])),
          left: Math.min(toColumn(first[1]), toColumn(last[1])),
          right: Math.max(toColumn(first[1]), toColumn(last[1])),
        };
      }
      const written = new Set(updates.map((update) => update.coordinate));
      for (const update of updates) {
        if (update.value === "") delete worksheet.cells[update.coordinate];
        else worksheet.cells[update.coordinate] = update.value;
      }
      if (sourceBounds) {
        for (let r = sourceBounds.top; r <= sourceBounds.bottom; r += 1) {
          for (let c = sourceBounds.left; c <= sourceBounds.right; c += 1) {
            const coordinate = cellName(r, c);
            if (!written.has(coordinate)) delete worksheet.cells[coordinate];
          }
        }
      }
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const freezeMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/freeze$/.exec(url.pathname);
    if (freezeMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(freezeMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(freezeMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      if (method !== "PATCH") return jsonResponse(405, { error: "Method not allowed" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const rows: unknown = body.rows;
      const columns: unknown = body.columns;
      if (
        !Number.isInteger(rows) ||
        (rows as number) < 0 ||
        !Number.isInteger(columns) ||
        (columns as number) < 0
      ) {
        return jsonResponse(400, { error: "Invalid frozen pane state" });
      }
      if (rows === 0 && columns === 0) delete worksheet.freeze;
      else worksheet.freeze = { rows: rows as number, columns: columns as number };
      return jsonResponse(200, { workbook });
    }

    const replaceMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/replace$/.exec(url.pathname);
    if (replaceMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(replaceMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(replaceMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      if (method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const updates: unknown = body.updates;
      if (
        !Array.isArray(updates) ||
        updates.length === 0 ||
        updates.some(
          (update) =>
            update === null ||
            typeof update !== "object" ||
            typeof (update as { value?: unknown }).value !== "string" ||
            !/^[A-Za-z]+[1-9][0-9]*$/.test(String((update as { coordinate?: unknown }).coordinate ?? "").trim()),
        )
      ) {
        return jsonResponse(400, { error: "Invalid replace request" });
      }
      const replacements = (updates as Array<{ coordinate: string; value: string }>).map((update) => ({
        coordinate: update.coordinate.trim().toUpperCase(),
        value: update.value,
      }));
      const replaceViolation = validationMessage(worksheet, replacements);
      if (replaceViolation) return jsonResponse(400, { error: replaceViolation });
      for (const update of replacements) {
        if (update.value === "") delete worksheet.cells[update.coordinate];
        else worksheet.cells[update.coordinate] = update.value;
      }
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook, replaced: replacements.length });
    }

    const stateMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/state$/.exec(url.pathname);
    if (stateMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(stateMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      if (method !== "PUT") return jsonResponse(405, { error: "Method not allowed" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(stateMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const cells: unknown = body.cells;
      if (cells === null || typeof cells !== "object" || Array.isArray(cells)) {
        return jsonResponse(400, { error: "Invalid worksheet state" });
      }
      const next: Record<string, string> = {};
      for (const [coordinate, value] of Object.entries(cells as Record<string, unknown>)) {
        if (typeof value !== "string" || value === "") continue;
        const parsed = parseCellName(coordinate);
        if (!parsed) continue;
        next[cellName(parsed.row, parsed.column)] = value;
      }
      worksheet.cells = next;
      if (Array.isArray(body.validationRules)) worksheet.validationRules = body.validationRules;
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const batchMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/cells\/batch$/.exec(url.pathname);
    if (batchMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(batchMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(batchMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      if (method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const start = String(body.start ?? "").trim().toUpperCase();
      const origin = /^([A-Z]+)([1-9][0-9]*)$/.exec(start);
      const rows: unknown = body.rows;
      if (!origin || !Array.isArray(rows) || rows.some((row) => !Array.isArray(row) || row.some((cell) => typeof cell !== "string"))) {
        return jsonResponse(400, { error: "Invalid cell range update" });
      }
      const toColumn = (letters: string) => [...letters].reduce((value, letter) => value * 26 + (letter.charCodeAt(0) - 64), 0);
      const column = toColumn(origin[1]);
      const row = Number(origin[2]);
      const updates: Array<{ coordinate: string; value: string }> = [];
      (rows as string[][]).forEach((values, rowIndex) => {
        values.forEach((value, columnIndex) => {
          updates.push({ coordinate: cellName(row + rowIndex, column + columnIndex), value });
        });
      });
      const batchViolation = validationMessage(worksheet, updates);
      if (batchViolation) return jsonResponse(400, { error: batchViolation });
      for (const update of updates) {
        if (update.value === "") delete worksheet.cells[update.coordinate];
        else worksheet.cells[update.coordinate] = update.value;
      }
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const ruleMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/validation-rule$/.exec(url.pathname);
    if (ruleMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(ruleMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(ruleMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (method === "PUT") {
        const range = normalizeArea(body.range);
        if (!range) return jsonResponse(400, { error: "Invalid validation rule" });
        const errorMessage = typeof body.errorMessage === "string" ? body.errorMessage.trim() : "";
        let rule: { range: string; type: string; min?: number; max?: number; values?: string[]; errorMessage?: string };
        if (body.type === "number-range") {
          const low = Number(body.min);
          const high = Number(body.max);
          if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) {
            return jsonResponse(400, { error: "Invalid validation rule" });
          }
          rule = { range, type: "number-range", min: low, max: high };
        } else if (body.type === "dropdown") {
          const values = Array.isArray(body.values)
            ? (body.values as unknown[]).map((value) => String(value).trim()).filter((value) => value !== "")
            : [];
          if (values.length === 0) return jsonResponse(400, { error: "Invalid validation rule" });
          rule = { range, type: "dropdown", values };
        } else {
          return jsonResponse(400, { error: "Invalid validation rule" });
        }
        if (errorMessage) rule = { ...rule, errorMessage };
        const kept = (Array.isArray(worksheet.validationRules) ? worksheet.validationRules : []).filter(
          (existing) => normalizeArea(existing?.range) !== range,
        );
        worksheet.validationRules = [...kept, rule];
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook });
      }
      if (method === "DELETE") {
        const range = normalizeArea(body.range);
        if (!range) return jsonResponse(400, { error: "Invalid validation rule" });
        const kept = (Array.isArray(worksheet.validationRules) ? worksheet.validationRules : []).filter(
          (existing) => normalizeArea(existing?.range) !== range,
        );
        if (kept.length === 0) delete worksheet.validationRules;
        else worksheet.validationRules = kept;
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook });
      }
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const namedRangeMatch = /^\/api\/workbooks\/([^/]+)\/named-ranges$/.exec(url.pathname);
    if (namedRangeMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(namedRangeMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      if (method !== "PUT") return jsonResponse(405, { error: "Method not allowed" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!/^[A-Za-z]/.test(name)) return jsonResponse(400, { error: "Named range must start with a letter" });
      const parsed = parseNamedRangeArea(body.range);
      if (!parsed) return jsonResponse(400, { error: "Invalid named range" });
      const worksheet = workbook.worksheets.find(
        (candidate) => candidate.name.toLowerCase() === parsed.sheet.toLowerCase(),
      );
      if (!worksheet) return jsonResponse(400, { error: "Invalid named range" });
      const kept = (Array.isArray(workbook.namedRanges) ? workbook.namedRanges : []).filter(
        (existing) => String(existing?.name ?? "").toLowerCase() !== name.toLowerCase(),
      );
      workbook.namedRanges = [...kept, { name, range: `${worksheet.name}!${parsed.area}` }];
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const conditionalMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/conditional-rules$/.exec(url.pathname);
    if (conditionalMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(conditionalMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(conditionalMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const rules = Array.isArray(worksheet.conditionalRules) ? worksheet.conditionalRules : [];
      if (method === "DELETE") {
        const index = Number(body.index);
        if (!Number.isInteger(index) || index < 0 || index >= rules.length) {
          return jsonResponse(400, { error: "Invalid conditional formatting rule" });
        }
        const kept = rules.filter((_, current) => current !== index);
        if (kept.length === 0) delete worksheet.conditionalRules;
        else worksheet.conditionalRules = kept;
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook });
      }
      if (method === "POST" || method === "PUT") {
        const range = normalizeArea(body.range);
        const conditions = ["greater-than", "text-contains"];
        const styles = ["red-fill", "yellow-fill", "green-fill"];
        const value = typeof body.value === "string" ? body.value.trim() : "";
        if (
          !range ||
          !conditions.includes(body.condition) ||
          !styles.includes(body.style) ||
          value === ""
        ) {
          return jsonResponse(400, { error: "Invalid conditional formatting rule" });
        }
        const rule = { range, condition: body.condition, value, style: body.style };
        if (method === "POST") {
          worksheet.conditionalRules = [...rules, rule];
        } else {
          const index = Number(body.index);
          if (!Number.isInteger(index) || index < 0 || index >= rules.length) {
            return jsonResponse(400, { error: "Invalid conditional formatting rule" });
          }
          worksheet.conditionalRules = rules.map((existing, current) => (current === index ? rule : existing));
        }
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(method === "POST" ? 201 : 200, { workbook });
      }
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const filterMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/filter$/.exec(url.pathname);
    if (filterMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(filterMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(filterMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      if (method === "PUT") {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const filter: unknown = body.filter;
        const range = normalizeArea((filter as { range?: unknown } | null)?.range);
        const columns = (filter as { columns?: unknown } | null)?.columns;
        if (!range || !Array.isArray(columns)) return jsonResponse(400, { error: "Invalid filter" });
        worksheet.filter = { range, columns };
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook });
      }
      if (method === "DELETE") {
        delete worksheet.filter;
        delete worksheet.filterViewName;
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook });
      }
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const filterViewMatch = /^\/api\/workbooks\/([^/]+)\/filter-views$/.exec(url.pathname);
    if (filterViewMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(filterViewMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const views = Array.isArray(workbook.filterViews) ? workbook.filterViews : [];
      const found = (name: unknown) =>
        views.find(
          (view) => typeof name === "string" && name.trim() !== "" && view.name.trim().toLowerCase() === name.trim().toLowerCase(),
        );
      if (method === "POST") {
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === body.worksheetId);
        if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) return jsonResponse(400, { error: "Filter view name cannot be empty" });
        if (!worksheet.filter) return jsonResponse(400, { error: "Create a filter before saving a filter view" });
        if (views.some((view) => view.name.trim().toLowerCase() === name.toLowerCase())) {
          return jsonResponse(400, { error: "Filter view name already exists" });
        }
        workbook.filterViews = [...views, { name, filter: structuredClone(worksheet.filter) }];
        worksheet.filterViewName = name;
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(201, { workbook });
      }
      if (method === "PUT") {
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === body.worksheetId);
        if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
        const view = found(body.name);
        if (!view) return jsonResponse(400, { error: "Filter view not found" });
        worksheet.filter = structuredClone(view.filter);
        worksheet.filterViewName = view.name;
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook });
      }
      if (method === "DELETE") {
        const name = typeof body.name === "string" ? body.name.trim().toLowerCase() : "";
        const index = views.findIndex((view) => name !== "" && view.name.trim().toLowerCase() === name);
        if (index === -1) return jsonResponse(400, { error: "Filter view not found" });
        const [removed] = views.splice(index, 1);
        if (views.length === 0) delete workbook.filterViews;
        for (const worksheet of workbook.worksheets) {
          const applied = typeof worksheet.filterViewName === "string" ? worksheet.filterViewName.trim().toLowerCase() : "";
          if (applied === "" || applied !== String(removed?.name ?? "").trim().toLowerCase()) continue;
          delete worksheet.filter;
          delete worksheet.filterViewName;
        }
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook });
      }
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const pivotRefreshMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/pivot\/refresh$/.exec(url.pathname);
    if (pivotRefreshMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(pivotRefreshMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      if (method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(pivotRefreshMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      if (!worksheet.pivot) return jsonResponse(400, { error: "Invalid pivot table configuration" });
      const source = workbook.worksheets.find((candidate) => candidate.id === worksheet.pivot!.sourceWorksheetId);
      if (!source) return jsonResponse(400, { error: "The pivot table source is no longer available" });
      const built = buildPivotCells(source.cells, worksheet.pivot.range, worksheet.pivot);
      if ("error" in built) return jsonResponse(400, { error: built.error });
      worksheet.cells = built.cells;
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const pivotMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/pivot$/.exec(url.pathname);
    if (pivotMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(pivotMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(pivotMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (method === "POST") {
        const bounds = areaBounds(body.range);
        if (!bounds) return jsonResponse(400, { error: "Invalid pivot table configuration" });
        const range = boundsText(bounds);
        const config = defaultPivotConfig(worksheet.cells, range);
        if (!config) return jsonResponse(400, { error: "Select a range with header cells to create a pivot table" });
        const built = buildPivotCells(worksheet.cells, range, config);
        if ("error" in built) return jsonResponse(400, { error: built.error });
        counter += 1;
        const created: Worksheet = {
          id: `ws-pivot-${counter}`,
          name: nextPivotName(workbook),
          selection: { anchor: "A1", focus: "A1" },
          cells: built.cells,
          pivot: { sourceWorksheetId: worksheet.id, range, ...config },
        };
        workbook.worksheets.push(created);
        workbook.activeWorksheetId = created.id;
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(201, { workbook });
      }
      if (method === "PUT") {
        if (!worksheet.pivot) return jsonResponse(400, { error: "Invalid pivot table configuration" });
        const summarizeBy = String(body.summarizeBy ?? "").toUpperCase() as SummarizeMethod;
        if (
          typeof body.rowField !== "string" ||
          body.rowField === "" ||
          typeof body.valueField !== "string" ||
          body.valueField === "" ||
          !["SUM", "COUNT", "AVERAGE"].includes(summarizeBy)
        ) {
          return jsonResponse(400, { error: "Invalid pivot table configuration" });
        }
        const columnField = body.columnField === undefined || body.columnField === null ? "" : body.columnField;
        if (typeof columnField !== "string") return jsonResponse(400, { error: "Invalid pivot table configuration" });
        const config = {
          rowField: body.rowField as string,
          columnField,
          valueField: body.valueField as string,
          summarizeBy,
        };
        const source = workbook.worksheets.find((candidate) => candidate.id === worksheet.pivot!.sourceWorksheetId);
        if (!source) return jsonResponse(400, { error: "The pivot table source is no longer available" });
        const built = buildPivotCells(source.cells, worksheet.pivot.range, config);
        if ("error" in built) return jsonResponse(400, { error: built.error });
        worksheet.cells = built.cells;
        worksheet.pivot = { ...worksheet.pivot, ...config };
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook });
      }
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const selectionMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/selection$/.exec(url.pathname);
    if (selectionMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(selectionMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(selectionMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      if (method !== "PATCH") return jsonResponse(405, { error: "Method not allowed" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const anchor = String(body.anchor ?? "").trim().toUpperCase();
      const focus = String(body.focus ?? "").trim().toUpperCase();
      if (!/^[A-Z]+[1-9][0-9]*$/.test(anchor) || !/^[A-Z]+[1-9][0-9]*$/.test(focus)) {
        return jsonResponse(400, { error: "Unknown cell reference" });
      }
      worksheet.selection = { anchor, focus };
      return jsonResponse(200, { workbook });
    }

    const noteMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/notes$/.exec(url.pathname);
    if (noteMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(noteMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(noteMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const coordinate = String(body.coordinate ?? "").trim().toUpperCase();
      if (!/^[A-Z]+[1-9][0-9]*$/.test(coordinate)) {
        return jsonResponse(400, { error: "Unknown cell reference" });
      }
      if (method === "PUT") {
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return jsonResponse(400, { error: "Note cannot be empty" });
        worksheet.notes = { ...(worksheet.notes ?? {}), [coordinate]: text };
      } else if (method === "DELETE") {
        const notes = { ...(worksheet.notes ?? {}) };
        if (notes[coordinate] === undefined) return jsonResponse(200, { workbook });
        delete notes[coordinate];
        if (Object.keys(notes).length === 0) delete worksheet.notes;
        else worksheet.notes = notes;
      } else {
        return jsonResponse(405, { error: "Method not allowed" });
      }
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const cellMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/cells$/.exec(url.pathname);
    if (cellMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(cellMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(cellMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      if (method !== "PATCH") return jsonResponse(405, { error: "Method not allowed" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const coordinate = String(body.coordinate ?? "").trim().toUpperCase();
      if (!/^[A-Z]+[1-9][0-9]*$/.test(coordinate)) return jsonResponse(400, { error: "Unknown cell reference" });
      if (typeof body.value !== "string") return jsonResponse(400, { error: "Cell value must be a string" });
      const cellViolation = validationMessage(worksheet, [{ coordinate, value: body.value }]);
      if (cellViolation) return jsonResponse(400, { error: cellViolation });
      if (body.value === "") {
        delete worksheet.cells[coordinate];
      } else {
        worksheet.cells[coordinate] = body.value;
      }
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const worksheetMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)$/.exec(url.pathname);
    if (worksheetMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(worksheetMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const index = workbook.worksheets.findIndex(
        (candidate) => candidate.id === decodeURIComponent(worksheetMatch[2]),
      );
      if (index === -1) return jsonResponse(400, { error: "Unknown worksheet" });
      const worksheet = workbook.worksheets[index];
      if (method === "DELETE") {
        if (workbook.worksheets.length <= 1) {
          return jsonResponse(400, { error: "A workbook must contain at least one worksheet" });
        }
        if (
          workbook.worksheets.some(
            (candidate) => candidate.id !== worksheet.id && candidate.pivot?.sourceWorksheetId === worksheet.id,
          )
        ) {
          return jsonResponse(400, { error: "Please delete or rebuild dependent pivot tables first" });
        }
        workbook.worksheets.splice(index, 1);
        if (workbook.activeWorksheetId === worksheet.id) {
          const neighbour = workbook.worksheets[Math.max(0, index - 1)] ?? workbook.worksheets[0];
          workbook.activeWorksheetId = neighbour.id;
        }
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook });
      }
      if (method !== "PATCH") return jsonResponse(405, { error: "Method not allowed" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return jsonResponse(400, { error: "Worksheet name cannot be empty" });
      if (name.length > MAX_WORKSHEET_NAME_LENGTH) {
        return jsonResponse(400, { error: "Worksheet name must be 50 characters or fewer" });
      }
      const folded = name.toLowerCase();
      if (
        workbook.worksheets.some(
          (candidate) => candidate.id !== worksheet.id && candidate.name.toLowerCase() === folded,
        )
      ) {
        return jsonResponse(400, { error: "Worksheet name already exists" });
      }
      worksheet.name = name;
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const worksheetsMatch = /^\/api\/workbooks\/([^/]+)\/worksheets$/.exec(url.pathname);
    if (worksheetsMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(worksheetsMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      if (method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
      counter += 1;
      const worksheet = { id: `ws-added-${counter}`, name: nextSheetName(workbook), cells: {} };
      workbook.worksheets.push(worksheet);
      workbook.activeWorksheetId = worksheet.id;
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(201, { workbook });
    }

    const match = /^\/api\/workbooks\/([^/]+)$/.exec(url.pathname);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const workbook = workbooks.find((candidate) => candidate.id === id);
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      if (method === "GET") return jsonResponse(200, { workbook });
      if (method === "PATCH") {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (body.name !== undefined) {
          const name = String(body.name).trim();
          if (!name) return jsonResponse(400, { error: "Workbook name cannot be empty" });
          if (name.length > 80) {
            return jsonResponse(400, { error: "Workbook name must be 80 characters or fewer" });
          }
          const folded = name.toLowerCase();
          if (
            workbooks.some(
              (candidate) => candidate.id !== workbook.id && candidate.name.trim().toLowerCase() === folded,
            )
          ) {
            return jsonResponse(400, { error: "Workbook name already exists" });
          }
          workbook.name = name;
        }
        if (body.activeWorksheetId !== undefined) {
          const target = workbook.worksheets.find((worksheet) => worksheet.id === body.activeWorksheetId);
          if (!target) return jsonResponse(400, { error: "Unknown worksheet" });
          workbook.activeWorksheetId = target.id;
        }
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook });
      }
    }

    return jsonResponse(404, { error: "Not found" });
  };

  vi.stubGlobal("fetch", vi.fn(handle));

  return {
    get workbooks() {
      return workbooks;
    },
    failOnce(method, pathname) {
      failures.add(`${method.toUpperCase()} ${pathname}`);
    },
    restore() {
      vi.unstubAllGlobals();
    },
  };
}
