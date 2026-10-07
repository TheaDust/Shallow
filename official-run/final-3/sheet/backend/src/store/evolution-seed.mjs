/**
 * Workbooks pre-provisioned by the current evolution requirements. Every entry
 * is keyed by a stable id (here the workbook name itself) so the same object is
 * merged into a store that already holds records without touching them, and so
 * `#/workbooks/<id>` opens the pre-provisioned object directly.
 *
 * Each entry is independent of the baseline evaluation seed (`Q3 Sales`); add
 * new objects by appending an entry, never by rewriting an existing one.
 */
import { cellName } from "../domain/grid.mjs";

export const EVOLUTION_SEED_CREATED_AT = "2026-10-01T09:00:00.000Z";

/** Worksheets of a pre-provisioned workbook start with A1 selected. */
const SEED_SELECTION = { anchor: "A1", focus: "A1" };

/**
 * `Workload` table of the filter-view workbooks: the D3:F7 region headed
 * `Workstream/Phase/Load` with its four records, exactly as the scenarios
 * describe them.
 */
function workloadCells() {
  return {
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
}

/** Filter criteria of the pre-provisioned `Queued lanes` view: Phase is `Queued`. */
function queuedLanesView() {
  return {
    name: "Queued lanes",
    filter: {
      range: "D3:F7",
      columns: [
        { column: 4, header: "Workstream", mode: "values", values: [] },
        { column: 5, header: "Phase", mode: "values", values: ["Queued"] },
        { column: 6, header: "Load", mode: "values", values: [] },
      ],
    },
  };
}

/**
 * Header row and record values of the `ScrollLedger` sheet shared by the freeze
 * scenarios. Every scenario keeps its own workbook, so the tables may overlap.
 */
const LEDGER_HEADERS = [
  "Entry",
  "Owner",
  "Team",
  "Amount",
  "Opened",
  "Status",
  "Priority",
  "Region",
  "Channel",
  "Reviewer",
  "Age",
  "Notes",
];
const LEDGER_OWNERS = ["Ada", "Bram", "Cyd", "Dev", "Elin", "Fen"];
const LEDGER_TEAMS = ["Atlas", "Beacon", "Cirrus"];

/**
 * `ScrollLedger` table: headers in row 1 across columns A..L and one ledger
 * record per row from row 2 through `lastRow`, so the sheet really scrolls in
 * both directions when a pane is frozen.
 */
function scrollLedgerCells(lastRow) {
  const cells = {};
  LEDGER_HEADERS.forEach((header, index) => {
    cells[cellName(1, index + 1)] = header;
  });
  for (let row = 2; row <= lastRow; row += 1) {
    const record = row - 2;
    cells[cellName(row, 1)] = `E-${String(row).padStart(4, "0")}`;
    cells[cellName(row, 2)] = LEDGER_OWNERS[record % LEDGER_OWNERS.length];
    cells[cellName(row, 3)] = LEDGER_TEAMS[record % LEDGER_TEAMS.length];
    cells[cellName(row, 4)] = String(120 + row * 7);
    cells[cellName(row, 5)] = `2026-03-${String((record % 28) + 1).padStart(2, "0")}`;
    cells[cellName(row, 6)] = record % 2 === 0 ? "Open" : "Closed";
    cells[cellName(row, 7)] = `P${(record % 3) + 1}`;
    cells[cellName(row, 8)] = record % 2 === 0 ? "North" : "South";
    cells[cellName(row, 9)] = record % 2 === 0 ? "Direct" : "Partner";
    cells[cellName(row, 10)] = LEDGER_OWNERS[(record + 3) % LEDGER_OWNERS.length];
    cells[cellName(row, 11)] = String((record % 30) + 1);
    cells[cellName(row, 12)] = record % 2 === 0 ? "Checked" : "Pending";
  }
  return cells;
}

export const EVOLUTION_WORKBOOK_SEEDS = [
  {
    id: "EVO-M01-RENAME-OK",
    name: "EVO-M01-RENAME-OK",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-01T09:01:00.000Z",
    activeWorksheetId: "ws-evo-m01-rename-ok-identitylog",
    worksheets: [
      {
        id: "ws-evo-m01-rename-ok-identitylog",
        name: "IdentityLog",
        selection: { ...SEED_SELECTION },
        cells: { F3: "unreviewed" },
      },
    ],
  },
  {
    id: "EVO-M01-RENAME-DUP",
    name: "EVO-M01-RENAME-DUP",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-01T09:02:00.000Z",
    activeWorksheetId: "ws-evo-m01-rename-dup-identitylog",
    worksheets: [
      {
        id: "ws-evo-m01-rename-dup-identitylog",
        name: "IdentityLog",
        selection: { ...SEED_SELECTION },
        cells: {},
      },
    ],
  },
  {
    id: "EVO-M01-ARCHIVE-RESERVED",
    name: "EVO-M01-ARCHIVE-RESERVED",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-01T09:03:00.000Z",
    activeWorksheetId: "ws-evo-m01-archive-reserved-sheet1",
    worksheets: [
      {
        id: "ws-evo-m01-archive-reserved-sheet1",
        name: "Sheet1",
        selection: { ...SEED_SELECTION },
        cells: {},
      },
    ],
  },
  {
    id: "EVO-M01-RENAME-LIMIT",
    name: "EVO-M01-RENAME-LIMIT",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-01T09:04:00.000Z",
    activeWorksheetId: "ws-evo-m01-rename-limit-limitprobe",
    worksheets: [
      {
        id: "ws-evo-m01-rename-limit-limitprobe",
        name: "LimitProbe",
        selection: { ...SEED_SELECTION },
        cells: { C2: "limit sentinel" },
      },
    ],
  },
  {
    id: "EVO-M02-SHEET-OK",
    name: "EVO-M02-SHEET-OK",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-02T09:01:00.000Z",
    activeWorksheetId: "ws-evo-m02-sheet-ok-harbordraft",
    worksheets: [
      {
        id: "ws-evo-m02-sheet-ok-harbordraft",
        name: "HarborDraft",
        selection: { ...SEED_SELECTION },
        cells: { D5: "dock marker" },
      },
      {
        id: "ws-evo-m02-sheet-ok-ledgerview",
        name: "LedgerView",
        selection: { ...SEED_SELECTION },
        cells: {},
      },
    ],
  },
  {
    id: "EVO-M02-SHEET-DUP",
    name: "EVO-M02-SHEET-DUP",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-02T09:02:00.000Z",
    activeWorksheetId: "ws-evo-m02-sheet-dup-archivebay",
    worksheets: [
      {
        id: "ws-evo-m02-sheet-dup-meridian",
        name: "Meridian",
        selection: { ...SEED_SELECTION },
        cells: {},
      },
      {
        id: "ws-evo-m02-sheet-dup-archivebay",
        name: "ArchiveBay",
        selection: { ...SEED_SELECTION },
        cells: {},
      },
    ],
  },
  {
    id: "EVO-M02-SHEET-LIMIT",
    name: "EVO-M02-SHEET-LIMIT",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-02T09:03:00.000Z",
    activeWorksheetId: "ws-evo-m02-sheet-limit-lengthgauge",
    worksheets: [
      {
        id: "ws-evo-m02-sheet-limit-lengthgauge",
        name: "LengthGauge",
        selection: { ...SEED_SELECTION },
        cells: { G4: "sheet sentinel" },
      },
    ],
  },
  {
    id: "EVO-M03-CLEAR-TEXT",
    name: "EVO-M03-CLEAR-TEXT",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-03T09:01:00.000Z",
    activeWorksheetId: "ws-evo-m03-clear-text-staging",
    worksheets: [
      {
        id: "ws-evo-m03-clear-text-staging",
        name: "Staging",
        selection: { ...SEED_SELECTION },
        cells: { H4: "obsolete tag" },
      },
    ],
  },
  {
    id: "EVO-M03-CLEAR-FORMULA",
    name: "EVO-M03-CLEAR-FORMULA",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-03T09:02:00.000Z",
    activeWorksheetId: "ws-evo-m03-clear-formula-calculations",
    worksheets: [
      {
        id: "ws-evo-m03-clear-formula-calculations",
        name: "Calculations",
        selection: { ...SEED_SELECTION },
        cells: { B7: "13", C7: "=B7*5", D7: "=C7+2" },
      },
    ],
  },
  {
    id: "EVO-M03-CLEAR-RANGE",
    name: "EVO-M03-CLEAR-RANGE",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-03T09:03:00.000Z",
    activeWorksheetId: "ws-evo-m03-clear-range-matrix",
    worksheets: [
      {
        id: "ws-evo-m03-clear-range-matrix",
        name: "Matrix",
        selection: { ...SEED_SELECTION },
        cells: { H4: "Amber", I4: "Delta", H5: "Kite", I5: "Orchid" },
      },
    ],
  },
  {
    id: "EVO-M04-FILTER-SAVE",
    name: "EVO-M04-FILTER-SAVE",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-04T09:01:00.000Z",
    activeWorksheetId: "ws-evo-m04-filter-save-workload",
    worksheets: [
      {
        id: "ws-evo-m04-filter-save-workload",
        name: "Workload",
        selection: { ...SEED_SELECTION },
        cells: workloadCells(),
      },
    ],
  },
  {
    id: "EVO-M04-FILTER-APPLY",
    name: "EVO-M04-FILTER-APPLY",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-04T09:02:00.000Z",
    activeWorksheetId: "ws-evo-m04-filter-apply-workload",
    worksheets: [
      {
        id: "ws-evo-m04-filter-apply-workload",
        name: "Workload",
        selection: { ...SEED_SELECTION },
        cells: workloadCells(),
        filterViews: [queuedLanesView()],
      },
    ],
  },
  {
    id: "EVO-M04-FILTER-DELETE",
    name: "EVO-M04-FILTER-DELETE",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-04T09:03:00.000Z",
    activeWorksheetId: "ws-evo-m04-filter-delete-workload",
    worksheets: [
      {
        id: "ws-evo-m04-filter-delete-workload",
        name: "Workload",
        selection: { ...SEED_SELECTION },
        cells: workloadCells(),
        filterViews: [queuedLanesView()],
      },
    ],
  },
  {
    id: "EVO-M05-VALIDATION-FORMULA",
    name: "EVO-M05-VALIDATION-FORMULA",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-05T09:01:00.000Z",
    activeWorksheetId: "ws-evo-m05-validation-formula-thresholds",
    worksheets: [
      {
        id: "ws-evo-m05-validation-formula-thresholds",
        name: "Thresholds",
        selection: { ...SEED_SELECTION },
        cells: { J6: "37" },
        validationRules: [
          { range: "J6", type: "number-range", min: 25, max: 75, errorMessage: "Capacity must be from 25 to 75" },
        ],
      },
    ],
  },
  {
    id: "EVO-M05-VALIDATION-GRID",
    name: "EVO-M05-VALIDATION-GRID",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-05T09:02:00.000Z",
    activeWorksheetId: "ws-evo-m05-validation-grid-thresholds",
    worksheets: [
      {
        id: "ws-evo-m05-validation-grid-thresholds",
        name: "Thresholds",
        selection: { ...SEED_SELECTION },
        cells: { K8: "Ready" },
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
    id: "EVO-N01-FREEZE-ROW",
    name: "EVO-N01-FREEZE-ROW",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-06T09:01:00.000Z",
    activeWorksheetId: "ws-evo-n01-freeze-row-scrollledger",
    worksheets: [
      {
        id: "ws-evo-n01-freeze-row-scrollledger",
        name: "ScrollLedger",
        selection: { ...SEED_SELECTION },
        cells: scrollLedgerCells(40),
      },
    ],
  },
  {
    id: "EVO-N01-FREEZE-COLUMN",
    name: "EVO-N01-FREEZE-COLUMN",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-06T09:02:00.000Z",
    activeWorksheetId: "ws-evo-n01-freeze-column-scrollledger",
    worksheets: [
      {
        id: "ws-evo-n01-freeze-column-scrollledger",
        name: "ScrollLedger",
        selection: { ...SEED_SELECTION },
        cells: scrollLedgerCells(24),
      },
    ],
  },
  {
    id: "EVO-N01-FREEZE-BOTH",
    name: "EVO-N01-FREEZE-BOTH",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-06T09:03:00.000Z",
    activeWorksheetId: "ws-evo-n01-freeze-both-scrollledger",
    worksheets: [
      {
        id: "ws-evo-n01-freeze-both-scrollledger",
        name: "ScrollLedger",
        selection: { ...SEED_SELECTION },
        cells: scrollLedgerCells(40),
      },
    ],
  },
  {
    id: "EVO-N02-FIND-NEXT",
    name: "EVO-N02-FIND-NEXT",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-06T09:04:00.000Z",
    activeWorksheetId: "ws-evo-n02-find-next-narrative",
    worksheets: [
      {
        id: "ws-evo-n02-find-next-narrative",
        name: "Narrative",
        selection: { ...SEED_SELECTION },
        cells: { E4: "Cobalt", E7: "Cobalt", E11: "Cobalt" },
      },
    ],
  },
  {
    id: "EVO-N02-REPLACE-ALL",
    name: "EVO-N02-REPLACE-ALL",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-06T09:05:00.000Z",
    activeWorksheetId: "ws-evo-n02-replace-all-narrative",
    worksheets: [
      {
        id: "ws-evo-n02-replace-all-narrative",
        name: "Narrative",
        selection: { ...SEED_SELECTION },
        cells: { F3: "Cobalt", F6: "Cobalt", F9: "Cobalt", F12: "Copper" },
      },
    ],
  },
  {
    id: "EVO-N02-CASE-SENSITIVE",
    name: "EVO-N02-CASE-SENSITIVE",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-06T09:06:00.000Z",
    activeWorksheetId: "ws-evo-n02-case-sensitive-narrative",
    worksheets: [
      {
        id: "ws-evo-n02-case-sensitive-narrative",
        name: "Narrative",
        selection: { ...SEED_SELECTION },
        cells: { G3: "Cobalt", G4: "cobalt", G5: "Cobalt-7" },
      },
    ],
  },
  {
    id: "EVO-M05-VALIDATION-EDIT",
    name: "EVO-M05-VALIDATION-EDIT",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-05T09:03:00.000Z",
    activeWorksheetId: "ws-evo-m05-validation-edit-thresholds",
    worksheets: [
      {
        id: "ws-evo-m05-validation-edit-thresholds",
        name: "Thresholds",
        selection: { ...SEED_SELECTION },
        cells: { L4: "42" },
        validationRules: [
          { range: "L4", type: "number-range", min: 25, max: 75, errorMessage: "Capacity must be from 25 to 75" },
        ],
      },
    ],
  },
  {
    id: "EVO-N03-NAMED-CREATE",
    name: "EVO-N03-NAMED-CREATE",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-07T09:01:00.000Z",
    activeWorksheetId: "ws-evo-n03-named-create-forecastmodel",
    worksheets: [
      {
        id: "ws-evo-n03-named-create-forecastmodel",
        name: "ForecastModel",
        selection: { ...SEED_SELECTION },
        cells: { J3: "18", J4: "24", J5: "31" },
      },
    ],
  },
  {
    id: "EVO-N03-NAMED-INVALID",
    name: "EVO-N03-NAMED-INVALID",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-07T09:02:00.000Z",
    activeWorksheetId: "ws-evo-n03-named-invalid-forecastmodel",
    worksheets: [
      {
        id: "ws-evo-n03-named-invalid-forecastmodel",
        name: "ForecastModel",
        selection: { ...SEED_SELECTION },
        cells: { K2: "6", K3: "14" },
      },
    ],
  },
  {
    id: "EVO-N03-NAMED-UPDATE",
    name: "EVO-N03-NAMED-UPDATE",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-07T09:03:00.000Z",
    activeWorksheetId: "ws-evo-n03-named-update-forecastmodel",
    namedRanges: [
      { name: "MarginBase", worksheetId: "ws-evo-n03-named-update-forecastmodel", range: "K2:K3" },
    ],
    worksheets: [
      {
        id: "ws-evo-n03-named-update-forecastmodel",
        name: "ForecastModel",
        selection: { ...SEED_SELECTION },
        cells: { K2: "5", K3: "8", K4: "12", M2: "=SUM(MarginBase)" },
      },
    ],
  },
  {
    id: "EVO-N04-FORMAT-NUMBER",
    name: "EVO-N04-FORMAT-NUMBER",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-07T09:04:00.000Z",
    activeWorksheetId: "ws-evo-n04-format-number-signals",
    worksheets: [
      {
        id: "ws-evo-n04-format-number-signals",
        name: "Signals",
        selection: { ...SEED_SELECTION },
        cells: { J4: "11", J5: "29", J6: "46" },
      },
    ],
  },
  {
    id: "EVO-N04-FORMAT-TEXT",
    name: "EVO-N04-FORMAT-TEXT",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-07T09:05:00.000Z",
    activeWorksheetId: "ws-evo-n04-format-text-signals",
    worksheets: [
      {
        id: "ws-evo-n04-format-text-signals",
        name: "Signals",
        selection: { ...SEED_SELECTION },
        cells: { K4: "Watch", K5: "Stable", K6: "Elevated" },
      },
    ],
  },
  {
    id: "EVO-N04-FORMAT-EDIT",
    name: "EVO-N04-FORMAT-EDIT",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-07T09:06:00.000Z",
    activeWorksheetId: "ws-evo-n04-format-edit-signals",
    worksheets: [
      {
        id: "ws-evo-n04-format-edit-signals",
        name: "Signals",
        selection: { ...SEED_SELECTION },
        cells: { L3: "16", L4: "28", L5: "39" },
        formatRules: [{ range: "L3:L5", condition: "greater-than", value: "20", style: "red" }],
      },
    ],
  },
  {
    id: "EVO-N05-NOTE-CREATE",
    name: "EVO-N05-NOTE-CREATE",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-07T09:07:00.000Z",
    activeWorksheetId: "ws-evo-n05-note-create-reviewqueue",
    worksheets: [
      {
        id: "ws-evo-n05-note-create-reviewqueue",
        name: "ReviewQueue",
        selection: { ...SEED_SELECTION },
        cells: { D8: "Manifest R41" },
      },
    ],
  },
  {
    id: "EVO-N05-NOTE-EDIT",
    name: "EVO-N05-NOTE-EDIT",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-07T09:08:00.000Z",
    activeWorksheetId: "ws-evo-n05-note-edit-reviewqueue",
    worksheets: [
      {
        id: "ws-evo-n05-note-edit-reviewqueue",
        name: "ReviewQueue",
        selection: { ...SEED_SELECTION },
        cells: { F6: "Gate Rho" },
        notes: { F6: "Awaiting controller sign-off" },
      },
    ],
  },
  {
    id: "EVO-N05-NOTE-DELETE",
    name: "EVO-N05-NOTE-DELETE",
    createdAt: EVOLUTION_SEED_CREATED_AT,
    updatedAt: "2026-10-07T09:09:00.000Z",
    activeWorksheetId: "ws-evo-n05-note-delete-reviewqueue",
    worksheets: [
      {
        id: "ws-evo-n05-note-delete-reviewqueue",
        name: "ReviewQueue",
        selection: { ...SEED_SELECTION },
        cells: { J3: "Route Zeta" },
        notes: { J3: "Retire after audit" },
      },
    ],
  },
];

/** Fresh copies of the pre-provisioned workbooks of the current requirements. */
export function evolutionSeedWorkbooks() {
  return structuredClone(EVOLUTION_WORKBOOK_SEEDS);
}

/** True when every pre-provisioned workbook is already stored (by stable id). */
export function hasEvolutionSeeds(state) {
  const stored = new Set((state?.workbooks ?? []).map((workbook) => workbook.id));
  return EVOLUTION_WORKBOOK_SEEDS.every((seed) => stored.has(seed.id));
}

/**
 * Adds every pre-provisioned workbook that is missing (matched by stable id) to
 * `state` and returns it. Existing records keep their id, name, cells and user
 * modifications, and a second call adds nothing, so the upgrade is idempotent.
 */
export function mergeEvolutionSeeds(state) {
  const stored = new Set((state?.workbooks ?? []).map((workbook) => workbook.id));
  for (const seed of EVOLUTION_WORKBOOK_SEEDS) {
    if (stored.has(seed.id)) continue;
    state.workbooks.push(structuredClone(seed));
    stored.add(seed.id);
  }
  return state;
}
