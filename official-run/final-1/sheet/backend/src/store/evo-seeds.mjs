/**
 * Pre-provisioned workbooks of the evolution scenarios. Every evolution
 * scenario works on its own `EVO-` prefixed workbook, so these objects are added
 * to the shared seed next to the baseline one and never replace it. A scenario
 * owns exactly one workbook identity: the same `name` always maps to the same
 * `id` and the same worksheet, so a deep link keeps identifying that workbook
 * while a rename only changes the display name.
 *
 * Groups are appended per evolution module; later modules add their own group
 * instead of editing an existing one.
 */

import { cellName } from "../domain/grid.mjs";

/** Creation stamp shared by this module's pre-provisioned workbooks. */
const EVO_CREATED_AT = "2026-10-01T08:00:00.000Z";

/**
 * One pre-provisioned workbook with a single worksheet and optional seeded
 * cells, cell notes, validation rules and saved filter views. `updatedAt` orders workbooks
 * on the home page and stays distinct per workbook so the list order is
 * deterministic. `selection` picks the cell a scenario starts on, so a dialog
 * that acts on the current selection opens on the seeded record.
 */
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
}) {
  const worksheet = {
    id: worksheetId,
    name: worksheetName,
    selection: selection ?? { anchor: "A1", focus: "A1" },
    cells,
  };
  if (notes) worksheet.notes = notes;
  if (validationRules) worksheet.validationRules = validationRules;
  if (conditionalFormats) worksheet.conditionalFormats = conditionalFormats;
  const workbook = {
    id,
    name,
    createdAt: EVO_CREATED_AT,
    updatedAt,
    activeWorksheetId: worksheetId,
    worksheets: [worksheet],
  };
  if (filterViews) workbook.filterViews = filterViews;
  if (namedRanges) workbook.namedRanges = namedRanges;
  return workbook;
}

/**
 * One pre-provisioned workbook holding several worksheets. `activeWorksheetId`
 * picks the tab a scenario starts on; every other worksheet keeps its own name
 * and cells, so renaming one tab leaves the rest untouched.
 */
function evoWorkbookWithWorksheets({ id, name, updatedAt, activeWorksheetId, worksheets }) {
  return {
    id,
    name,
    createdAt: EVO_CREATED_AT,
    updatedAt,
    activeWorksheetId,
    worksheets: worksheets.map(({ id: worksheetId, name: worksheetName, cells = {} }) => ({
      id: worksheetId,
      name: worksheetName,
      selection: { anchor: "A1", focus: "A1" },
      cells,
    })),
  };
}

/** REQ-1-2-2 (rename a workbook): one workbook per scenario of the module. */
function renameWorkbookSeeds() {
  return [
    evoWorkbook({
      id: "wb-evo-m01-rename-ok",
      name: "EVO-M01-RENAME-OK",
      worksheetId: "ws-evo-m01-rename-ok-identity-log",
      worksheetName: "IdentityLog",
      updatedAt: "2026-10-01T09:00:00.000Z",
      cells: { F3: "unreviewed" },
    }),
    evoWorkbook({
      id: "wb-evo-m01-rename-dup",
      name: "EVO-M01-RENAME-DUP",
      worksheetId: "ws-evo-m01-rename-dup-identity-log",
      worksheetName: "IdentityLog",
      updatedAt: "2026-10-01T09:05:00.000Z",
    }),
    // Occupies the name the duplicate scenario tries to reuse; it is a separate
    // workbook, so rejecting the rename leaves this one untouched.
    evoWorkbook({
      id: "wb-evo-m01-archive-reserved",
      name: "EVO-M01-ARCHIVE-RESERVED",
      worksheetId: "ws-evo-m01-archive-reserved-sheet1",
      worksheetName: "Sheet1",
      updatedAt: "2026-10-01T09:10:00.000Z",
    }),
    evoWorkbook({
      id: "wb-evo-m01-rename-limit",
      name: "EVO-M01-RENAME-LIMIT",
      worksheetId: "ws-evo-m01-rename-limit-limit-probe",
      worksheetName: "LimitProbe",
      updatedAt: "2026-10-01T09:15:00.000Z",
      cells: { C2: "limit sentinel" },
    }),
  ];
}

/**
 * REQ-2-1-3 (rename a worksheet): one workbook per scenario. The worksheet ids
 * and the worksheet order stay fixed; only a `name` changes through the rename
 * endpoint, so a deep link keeps identifying the same workbook.
 */
function worksheetRenameSeeds() {
  return [
    evoWorkbookWithWorksheets({
      id: "wb-evo-m02-sheet-ok",
      name: "EVO-M02-SHEET-OK",
      updatedAt: "2026-10-02T09:00:00.000Z",
      activeWorksheetId: "ws-evo-m02-sheet-ok-harbor-draft",
      worksheets: [
        { id: "ws-evo-m02-sheet-ok-harbor-draft", name: "HarborDraft", cells: { D5: "dock marker" } },
        { id: "ws-evo-m02-sheet-ok-ledger-view", name: "LedgerView" },
      ],
    }),
    evoWorkbookWithWorksheets({
      id: "wb-evo-m02-sheet-dup",
      name: "EVO-M02-SHEET-DUP",
      updatedAt: "2026-10-02T09:05:00.000Z",
      activeWorksheetId: "ws-evo-m02-sheet-dup-archive-bay",
      worksheets: [
        { id: "ws-evo-m02-sheet-dup-meridian", name: "Meridian" },
        { id: "ws-evo-m02-sheet-dup-archive-bay", name: "ArchiveBay" },
      ],
    }),
    evoWorkbookWithWorksheets({
      id: "wb-evo-m02-sheet-limit",
      name: "EVO-M02-SHEET-LIMIT",
      updatedAt: "2026-10-02T09:10:00.000Z",
      activeWorksheetId: "ws-evo-m02-sheet-limit-length-gauge",
      worksheets: [
        { id: "ws-evo-m02-sheet-limit-length-gauge", name: "LengthGauge", cells: { G4: "sheet sentinel" } },
      ],
    }),
  ];
}

/**
 * REQ-3-1-1 (clear a cell or a selected rectangle with Delete): one workbook
 * per scenario. `Staging` holds a single text cell, `Calculations` a source
 * value with a directly and an indirectly dependent formula, and `Matrix` a
 * 2x2 block so a rectangular clear covers four cells at once. Every workbook
 * keeps its own worksheet, so clearing one never touches another scenario.
 */
function cellClearSeeds() {
  return [
    evoWorkbook({
      id: "wb-evo-m03-clear-text",
      name: "EVO-M03-CLEAR-TEXT",
      worksheetId: "ws-evo-m03-clear-text-staging",
      worksheetName: "Staging",
      updatedAt: "2026-10-03T09:00:00.000Z",
      cells: { H4: "obsolete tag" },
    }),
    evoWorkbook({
      id: "wb-evo-m03-clear-formula",
      name: "EVO-M03-CLEAR-FORMULA",
      worksheetId: "ws-evo-m03-clear-formula-calculations",
      worksheetName: "Calculations",
      updatedAt: "2026-10-03T09:05:00.000Z",
      cells: { B7: "13", C7: "=B7*5", D7: "=C7+2" },
    }),
    evoWorkbook({
      id: "wb-evo-m03-clear-range",
      name: "EVO-M03-CLEAR-RANGE",
      worksheetId: "ws-evo-m03-clear-range-matrix",
      worksheetName: "Matrix",
      updatedAt: "2026-10-03T09:10:00.000Z",
      // Row order: row 4 holds `Amber`/`Delta`, row 5 `Kite`/`Orchid`.
      cells: { H4: "Amber", I4: "Delta", H5: "Kite", I5: "Orchid" },
    }),
  ];
}

/**
 * REQ-5-1-2 (filter rows by value or condition): every scenario works on its
 * own workbook with the same `Workload` table in D3:F7. The table is the source
 * region of the filter, so no scenario can observe another one's rows. The two
 * later workbooks already carry the saved view `Queued lanes`, whose criterion
 * keeps the `Phase` cells equal to `Queued`.
 */
function filterViewSeeds() {
  const workloadCells = {
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
  // Criterion of `Queued lanes`: the `Phase` column of D3:F7 keeps `Queued`.
  const queuedLanes = {
    id: "fv-queued-lanes",
    name: "Queued lanes",
    filter: {
      range: "D3:F7",
      columns: [{ column: 5, header: "Phase", mode: "values", values: ["Queued"] }],
    },
  };
  return [
    evoWorkbook({
      id: "wb-evo-m04-filter-save",
      name: "EVO-M04-FILTER-SAVE",
      worksheetId: "ws-evo-m04-filter-save-workload",
      worksheetName: "Workload",
      updatedAt: "2026-10-04T09:00:00.000Z",
      cells: { ...workloadCells },
    }),
    evoWorkbook({
      id: "wb-evo-m04-filter-apply",
      name: "EVO-M04-FILTER-APPLY",
      worksheetId: "ws-evo-m04-filter-apply-workload",
      worksheetName: "Workload",
      updatedAt: "2026-10-04T09:05:00.000Z",
      cells: { ...workloadCells },
      filterViews: [structuredClone(queuedLanes)],
    }),
    evoWorkbook({
      id: "wb-evo-m04-filter-delete",
      name: "EVO-M04-FILTER-DELETE",
      worksheetId: "ws-evo-m04-filter-delete-workload",
      worksheetName: "Workload",
      updatedAt: "2026-10-04T09:10:00.000Z",
      cells: { ...workloadCells },
      filterViews: [structuredClone(queuedLanes)],
    }),
  ];
}

/**
 * REQ-5-2-1 (data validation with a custom error message): one workbook per
 * scenario, each holding its own cell, its own rule and the message that rule
 * shows instead of the standard wording. The selection starts on the seeded
 * cell so the dialog acts on that record.
 */
function validationMessageSeeds() {
  const numericMessage = "Capacity must be from 25 to 75";
  return [
    evoWorkbook({
      id: "wb-evo-m05-validation-formula",
      name: "EVO-M05-VALIDATION-FORMULA",
      worksheetId: "ws-evo-m05-validation-formula-thresholds",
      worksheetName: "Thresholds",
      updatedAt: "2026-10-05T09:00:00.000Z",
      cells: { J6: "37" },
      selection: { anchor: "J6", focus: "J6" },
      validationRules: [{ range: "J6", type: "number-range", min: 25, max: 75, message: numericMessage }],
    }),
    evoWorkbook({
      id: "wb-evo-m05-validation-grid",
      name: "EVO-M05-VALIDATION-GRID",
      worksheetId: "ws-evo-m05-validation-grid-thresholds",
      worksheetName: "Thresholds",
      updatedAt: "2026-10-05T09:05:00.000Z",
      cells: { K8: "Ready" },
      selection: { anchor: "K8", focus: "K8" },
      validationRules: [
        {
          range: "K8",
          type: "dropdown",
          values: ["Ready", "Holding", "Released"],
          message: "Choose a queue state",
        },
      ],
    }),
    evoWorkbook({
      id: "wb-evo-m05-validation-edit",
      name: "EVO-M05-VALIDATION-EDIT",
      worksheetId: "ws-evo-m05-validation-edit-thresholds",
      worksheetName: "Thresholds",
      updatedAt: "2026-10-05T09:10:00.000Z",
      cells: { L4: "42" },
      selection: { anchor: "L4", focus: "L4" },
      validationRules: [{ range: "L4", type: "number-range", min: 25, max: 75, message: numericMessage }],
    }),
  ];
}

/**
 * REQ-6-1-1 (freeze rows and columns): one `ScrollLedger` workbook per
 * scenario. Every workbook carries the same ledger table (headers in row 1,
 * twelve columns A..L through row 40), so freezing one scenario's panes never
 * touches another one's headings. No scenario starts frozen: the `View` menu
 * sets the state and the editor exposes it through the frozen-panes button.
 */
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

/** `ScrollLedger` table: header row 1 and data rows 2..40 across columns A..L. */
function scrollLedgerCells() {
  const cells = {};
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

function freezePaneSeeds() {
  return [
    evoWorkbook({
      id: "wb-evo-n01-freeze-row",
      name: "EVO-N01-FREEZE-ROW",
      worksheetId: "ws-evo-n01-freeze-row-scroll-ledger",
      worksheetName: "ScrollLedger",
      updatedAt: "2026-10-06T09:00:00.000Z",
      cells: scrollLedgerCells(),
    }),
    evoWorkbook({
      id: "wb-evo-n01-freeze-column",
      name: "EVO-N01-FREEZE-COLUMN",
      worksheetId: "ws-evo-n01-freeze-column-scroll-ledger",
      worksheetName: "ScrollLedger",
      updatedAt: "2026-10-06T09:05:00.000Z",
      cells: scrollLedgerCells(),
    }),
    evoWorkbook({
      id: "wb-evo-n01-freeze-both",
      name: "EVO-N01-FREEZE-BOTH",
      worksheetId: "ws-evo-n01-freeze-both-scroll-ledger",
      worksheetName: "ScrollLedger",
      updatedAt: "2026-10-06T09:10:00.000Z",
      cells: scrollLedgerCells(),
    }),
  ];
}

/**
 * REQ-6-2-1 (find and replace): one `Narrative` workbook per scenario, each
 * holding exactly the cells its scenario searches. The matched texts live in
 * their own workbook, so replacing in one scenario never changes another one's
 * data.
 */
function findReplaceSeeds() {
  return [
    evoWorkbook({
      id: "wb-evo-n02-find-next",
      name: "EVO-N02-FIND-NEXT",
      worksheetId: "ws-evo-n02-find-next-narrative",
      worksheetName: "Narrative",
      updatedAt: "2026-10-06T09:15:00.000Z",
      cells: { E4: "Cobalt", E7: "Cobalt", E11: "Cobalt" },
    }),
    evoWorkbook({
      id: "wb-evo-n02-replace-all",
      name: "EVO-N02-REPLACE-ALL",
      worksheetId: "ws-evo-n02-replace-all-narrative",
      worksheetName: "Narrative",
      updatedAt: "2026-10-06T09:20:00.000Z",
      cells: { F3: "Cobalt", F6: "Cobalt", F9: "Cobalt", F12: "Copper" },
    }),
    evoWorkbook({
      id: "wb-evo-n02-case-sensitive",
      name: "EVO-N02-CASE-SENSITIVE",
      worksheetId: "ws-evo-n02-case-sensitive-narrative",
      worksheetName: "Narrative",
      updatedAt: "2026-10-06T09:25:00.000Z",
      cells: { G3: "Cobalt", G4: "cobalt", G5: "Cobalt-7" },
    }),
  ];
}

/**
 * REQ-7-1-1 (create and edit named ranges): one `ForecastModel` workbook per
 * scenario. Every workbook owns its own cells, so a saved name never resolves
 * against another scenario's data; the update scenario additionally starts
 * with the saved name `MarginBase` and the dependent formula `=SUM(MarginBase)`.
 */
function namedRangeSeeds() {
  return [
    evoWorkbook({
      id: "wb-evo-n03-named-create",
      name: "EVO-N03-NAMED-CREATE",
      worksheetId: "ws-evo-n03-named-create-forecast-model",
      worksheetName: "ForecastModel",
      updatedAt: "2026-10-06T09:30:00.000Z",
      cells: { J3: "18", J4: "24", J5: "31" },
    }),
    evoWorkbook({
      id: "wb-evo-n03-named-invalid",
      name: "EVO-N03-NAMED-INVALID",
      worksheetId: "ws-evo-n03-named-invalid-forecast-model",
      worksheetName: "ForecastModel",
      updatedAt: "2026-10-06T09:35:00.000Z",
      cells: { K2: "6", K3: "14" },
    }),
    evoWorkbook({
      id: "wb-evo-n03-named-update",
      name: "EVO-N03-NAMED-UPDATE",
      worksheetId: "ws-evo-n03-named-update-forecast-model",
      worksheetName: "ForecastModel",
      updatedAt: "2026-10-06T09:40:00.000Z",
      cells: { K2: "5", K3: "8", K4: "12", M2: "=SUM(MarginBase)" },
      namedRanges: [{ id: "nr-evo-n03-named-update-margin-base", name: "MarginBase", range: "ForecastModel!K2:K3" }],
    }),
  ];
}

/**
 * REQ-7-2-1 (conditional formatting): one `Signals` workbook per scenario. The
 * edit scenario starts with rule 1 painting Red fill over the cells above 20, so
 * an edit or a delete is observable on its own seeded data only.
 */
function conditionalFormatSeeds() {
  return [
    evoWorkbook({
      id: "wb-evo-n04-format-number",
      name: "EVO-N04-FORMAT-NUMBER",
      worksheetId: "ws-evo-n04-format-number-signals",
      worksheetName: "Signals",
      updatedAt: "2026-10-06T09:45:00.000Z",
      cells: { J4: "11", J5: "29", J6: "46" },
    }),
    evoWorkbook({
      id: "wb-evo-n04-format-text",
      name: "EVO-N04-FORMAT-TEXT",
      worksheetId: "ws-evo-n04-format-text-signals",
      worksheetName: "Signals",
      updatedAt: "2026-10-06T09:50:00.000Z",
      cells: { K4: "Watch", K5: "Stable", K6: "Elevated" },
    }),
    evoWorkbook({
      id: "wb-evo-n04-format-edit",
      name: "EVO-N04-FORMAT-EDIT",
      worksheetId: "ws-evo-n04-format-edit-signals",
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
  ];
}

/**
 * REQ-8-1-1 (create, edit and delete a cell note): one `ReviewQueue` workbook
 * per scenario. The create scenario starts without a note, the edit and delete
 * scenarios carry their own note, so a saved note is only observable on its own
 * scenario's data and the cell values never change.
 */
function cellNoteSeeds() {
  return [
    evoWorkbook({
      id: "wb-evo-n05-note-create",
      name: "EVO-N05-NOTE-CREATE",
      worksheetId: "ws-evo-n05-note-create-review-queue",
      worksheetName: "ReviewQueue",
      updatedAt: "2026-10-06T10:00:00.000Z",
      cells: { D8: "Manifest R41" },
    }),
    evoWorkbook({
      id: "wb-evo-n05-note-edit",
      name: "EVO-N05-NOTE-EDIT",
      worksheetId: "ws-evo-n05-note-edit-review-queue",
      worksheetName: "ReviewQueue",
      updatedAt: "2026-10-06T10:05:00.000Z",
      cells: { F6: "Gate Rho" },
      notes: { F6: "Awaiting controller sign-off" },
    }),
    evoWorkbook({
      id: "wb-evo-n05-note-delete",
      name: "EVO-N05-NOTE-DELETE",
      worksheetId: "ws-evo-n05-note-delete-review-queue",
      worksheetName: "ReviewQueue",
      updatedAt: "2026-10-06T10:10:00.000Z",
      cells: { J3: "Route Zeta" },
      notes: { J3: "Retire after audit" },
    }),
  ];
}

/** Every pre-provisioned evolution workbook, baseline seed excluded. */
export function createEvolutionSeedWorkbooks() {
  return [
    ...renameWorkbookSeeds(),
    ...worksheetRenameSeeds(),
    ...cellClearSeeds(),
    ...filterViewSeeds(),
    ...validationMessageSeeds(),
    ...freezePaneSeeds(),
    ...findReplaceSeeds(),
    ...namedRangeSeeds(),
    ...conditionalFormatSeeds(),
    ...cellNoteSeeds(),
  ];
}
