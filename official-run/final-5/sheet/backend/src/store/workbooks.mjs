import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { createJsonStore } from "../lib/json-store.mjs";
import { NotFoundError, ValidationError } from "../lib/errors.mjs";
import { cellName, cellsFromRows, parseArea, parseCellName } from "../domain/grid.mjs";
import {
  STRUCTURE_AXES,
  STRUCTURE_MODES,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  shiftAnnotations,
  shiftFilter,
  shiftPivot,
  shiftRuleRanges,
} from "../domain/structure.mjs";
import { FILTER_CONDITIONS } from "../domain/filter.mjs";
import { normalizeConditionalFormat } from "../domain/formatting.mjs";
import { normalizeNamedRange } from "../domain/named-ranges.mjs";
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
export const EMPTY_NAME_MESSAGE = "Workbook name cannot be empty";
export const EMPTY_WORKSHEET_NAME_MESSAGE = "Worksheet name cannot be empty";
export const DUPLICATE_WORKSHEET_NAME_MESSAGE = "Worksheet name already exists";
const MAX_WORKSHEET_NAME_LENGTH = 50;
export const WORKSHEET_NAME_TOO_LONG_MESSAGE = "Worksheet name must be 50 characters or fewer";
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
export const EMPTY_FILTER_VIEW_NAME_MESSAGE = "Filter view name cannot be empty";
export const FILTER_VIEW_NAME_EXISTS_MESSAGE = "Filter view name already exists";
export const NO_FILTER_TO_SAVE_MESSAGE = "There is no filter to save";
export const UNKNOWN_FILTER_VIEW_MESSAGE = "Unknown filter view";
export const INVALID_SORT_MESSAGE = "Invalid sort request";
export const INVALID_NOTE_MESSAGE = "Invalid cell note";
export const UNKNOWN_CONDITIONAL_FORMAT_MESSAGE = "Unknown conditional formatting rule";
export const INVALID_FREEZE_MESSAGE = "Invalid freeze panes request";
const MAX_FREEZE_COUNT = 10000;
const MAX_WORKBOOK_NAME_LENGTH = 80;
export const NAME_TOO_LONG_MESSAGE = "Workbook name must be 80 characters or fewer";
export const DUPLICATE_WORKBOOK_NAME_MESSAGE = "Workbook name already exists";

/** Selection of a worksheet with no recorded history: cell A1. */
export const DEFAULT_SELECTION = { anchor: "A1", focus: "A1" };

export const EVO_SEED_CREATED_AT = "2026-10-01T09:00:00.000Z";

/**
 * Rows of the `Workload` worksheet shared by the saved-filter-view scenarios:
 * the D3:F7 region is headed `Workstream/Phase/Load` and its four records are
 * `Atlas/Queued/17`, `Atlas/Active/31`, `Beacon/Queued/22` and `Cirrus/Queued/9`.
 * The stored selection starts on that whole region so a filter can be created
 * for it without an extra preparation step.
 */
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

/**
 * Cells of the `ScrollLedger` worksheet shared by the freeze-pane scenarios:
 * headers in row 1 and records through row 40 across columns A:L. Every freeze
 * workbook gets its own copy, so writes to one never reach another.
 */
function scrollLedgerCells() {
  const headers = [
    "Entry",
    "Account",
    "Region",
    "Period",
    "Owner",
    "Phase",
    "Amount",
    "Currency",
    "Status",
    "Note",
    "Code",
    "Ref",
  ];
  const regions = ["North", "South", "East", "West"];
  const phases = ["Queued", "Active", "Holding"];
  const cells = {};
  headers.forEach((header, index) => {
    cells[cellName(1, index + 1)] = header;
  });
  for (let row = 2; row <= 40; row += 1) {
    const offset = row - 2;
    cells[cellName(row, 1)] = `ENT-${String(offset + 1).padStart(3, "0")}`;
    cells[cellName(row, 2)] = `Ledger ${offset + 1}`;
    cells[cellName(row, 3)] = regions[offset % regions.length];
    cells[cellName(row, 4)] = `2026-Q${(offset % 4) + 1}`;
    cells[cellName(row, 5)] = `Owner ${(offset % 6) + 1}`;
    cells[cellName(row, 6)] = phases[offset % phases.length];
    cells[cellName(row, 7)] = String(100 + (offset * 7) % 900);
    cells[cellName(row, 8)] = "USD";
    cells[cellName(row, 9)] = offset % 3 === 1 ? "Posted" : "Draft";
    cells[cellName(row, 10)] = `Note ${offset + 1}`;
    cells[cellName(row, 11)] = `C${String(offset + 1).padStart(2, "0")}`;
    cells[cellName(row, 12)] = `R-${offset + 1}`;
  }
  return cells;
}

/** Saved filter view `Queued lanes`: keeps only the records whose Phase is `Queued`. */
function queuedLanesView(id) {
  return [
    {
      id,
      name: "Queued lanes",
      filter: {
        range: "D3:F7",
        columns: [{ column: 5, header: "Phase", mode: "values", values: ["Queued"] }],
      },
    },
  ];
}

/**
 * Scenario workbooks pre-provisioned for the workbook/worksheet lifecycle and
 * cell-editing features. Each is a self-contained workbook with its own stable
 * id, display name, worksheet list and active worksheet, so those scenarios
 * never depend on the baseline `Q3 Sales` seed. The id doubles as the display
 * name (and thus the deep link), which keeps the pre-provisioned name and its
 * address aligned. Worksheet ids stay `<workbook id>--<initial worksheet name>`,
 * so they are stable for the single-sheet workbooks already shipped.
 *
 * `extras` carries the optional per-worksheet `selection`, `validationRules`
 * and `filterViews` the later scenarios pre-provision.
 */
export function evoSeedWorkbooks() {
  const make = (id, worksheetNames, activeWorksheetName, updatedAt, cellsByWorksheet = {}, extras = {}) => {
    const {
      validationRules = {},
      filterViews = {},
      conditionalFormats = {},
      selection = {},
      notes = {},
      namedRanges,
    } = extras;
    return {
      id,
      name: id,
      createdAt: EVO_SEED_CREATED_AT,
      updatedAt,
      activeWorksheetId: `${id}--${activeWorksheetName}`,
      ...(namedRanges ? { namedRanges } : {}),
      worksheets: worksheetNames.map((worksheetName) => ({
        id: `${id}--${worksheetName}`,
        name: worksheetName,
        selection: selection[worksheetName] ?? { anchor: "A1", focus: "A1" },
        cells: cellsByWorksheet[worksheetName] ?? {},
        ...(validationRules[worksheetName] ? { validationRules: validationRules[worksheetName] } : {}),
        ...(filterViews[worksheetName] ? { filterViews: filterViews[worksheetName] } : {}),
        ...(conditionalFormats[worksheetName] ? { conditionalFormats: conditionalFormats[worksheetName] } : {}),
        ...(notes[worksheetName] ? { notes: notes[worksheetName] } : {}),
      })),
    };
  };
  return [
    make("EVO-M01-RENAME-OK", ["IdentityLog"], "IdentityLog", "2026-10-02T09:00:00.000Z", {
      IdentityLog: { F3: "unreviewed" },
    }),
    make("EVO-M01-RENAME-DUP", ["IdentityLog"], "IdentityLog", "2026-10-02T09:01:00.000Z"),
    make("EVO-M01-ARCHIVE-RESERVED", ["Sheet1"], "Sheet1", "2026-10-02T09:02:00.000Z"),
    make("EVO-M01-RENAME-LIMIT", ["LimitProbe"], "LimitProbe", "2026-10-02T09:03:00.000Z", {
      LimitProbe: { C2: "limit sentinel" },
    }),
    make("EVO-M02-SHEET-OK", ["HarborDraft", "LedgerView"], "HarborDraft", "2026-10-02T10:00:00.000Z", {
      HarborDraft: { D5: "dock marker" },
    }),
    make("EVO-M02-SHEET-DUP", ["Meridian", "ArchiveBay"], "ArchiveBay", "2026-10-02T10:01:00.000Z"),
    make("EVO-M02-SHEET-LIMIT", ["LengthGauge"], "LengthGauge", "2026-10-02T10:02:00.000Z", {
      LengthGauge: { G4: "sheet sentinel" },
    }),
    make("EVO-M03-CLEAR-TEXT", ["Staging"], "Staging", "2026-10-03T09:00:00.000Z", {
      Staging: { H4: "obsolete tag" },
    }),
    make("EVO-M03-CLEAR-FORMULA", ["Calculations"], "Calculations", "2026-10-03T09:01:00.000Z", {
      Calculations: { B7: "13", C7: "=B7*5", D7: "=C7+2" },
    }),
    make("EVO-M03-CLEAR-RANGE", ["Matrix"], "Matrix", "2026-10-03T09:02:00.000Z", {
      Matrix: { H4: "Amber/Delta", I4: "Kite/Orchid" },
    }),
    make("EVO-M04-FILTER-SAVE", ["Workload"], "Workload", "2026-10-04T09:00:00.000Z", {
      Workload: { ...WORKLOAD_CELLS },
    }, { selection: { Workload: { anchor: "D3", focus: "F7" } } }),
    make("EVO-M04-FILTER-APPLY", ["Workload"], "Workload", "2026-10-04T09:01:00.000Z", {
      Workload: { ...WORKLOAD_CELLS },
    }, {
      selection: { Workload: { anchor: "D3", focus: "F7" } },
      filterViews: { Workload: queuedLanesView("EVO-M04-FILTER-APPLY--queued-lanes") },
    }),
    make("EVO-M04-FILTER-DELETE", ["Workload"], "Workload", "2026-10-04T09:02:00.000Z", {
      Workload: { ...WORKLOAD_CELLS },
    }, {
      selection: { Workload: { anchor: "D3", focus: "F7" } },
      filterViews: { Workload: queuedLanesView("EVO-M04-FILTER-DELETE--queued-lanes") },
    }),
    make("EVO-M05-VALIDATION-FORMULA", ["Thresholds"], "Thresholds", "2026-10-05T09:00:00.000Z", {
      Thresholds: { J6: "37" },
    }, {
      selection: { Thresholds: { anchor: "J6", focus: "J6" } },
      validationRules: {
        Thresholds: [
          { range: "J6", type: NUMBER_RANGE_TYPE, min: 25, max: 75, message: "Capacity must be from 25 to 75" },
        ],
      },
    }),
    make("EVO-M05-VALIDATION-GRID", ["Thresholds"], "Thresholds", "2026-10-05T09:01:00.000Z", {
      Thresholds: { K8: "Ready" },
    }, {
      selection: { Thresholds: { anchor: "K8", focus: "K8" } },
      validationRules: {
        Thresholds: [
          {
            range: "K8",
            type: DROPDOWN_TYPE,
            values: ["Ready", "Holding", "Released"],
            message: "Choose a queue state",
          },
        ],
      },
    }),
    make("EVO-M05-VALIDATION-EDIT", ["Thresholds"], "Thresholds", "2026-10-05T09:02:00.000Z", {
      Thresholds: { L4: "42" },
    }, {
      selection: { Thresholds: { anchor: "L4", focus: "L4" } },
      validationRules: {
        Thresholds: [
          { range: "L4", type: NUMBER_RANGE_TYPE, min: 25, max: 75, message: "Capacity must be from 25 to 75" },
        ],
      },
    }),
    // Freeze-pane scenarios: the same scrollable ledger (headers in row 1,
    // records through row 40 and column L) pre-provisioned once per scenario so
    // each one stays independent.
    make("EVO-N01-FREEZE-ROW", ["ScrollLedger"], "ScrollLedger", "2026-10-06T09:00:00.000Z", {
      ScrollLedger: scrollLedgerCells(),
    }),
    make("EVO-N01-FREEZE-COLUMN", ["ScrollLedger"], "ScrollLedger", "2026-10-06T09:01:00.000Z", {
      ScrollLedger: scrollLedgerCells(),
    }),
    make("EVO-N01-FREEZE-BOTH", ["ScrollLedger"], "ScrollLedger", "2026-10-06T09:02:00.000Z", {
      ScrollLedger: scrollLedgerCells(),
    }),
    // Find-and-replace scenarios: one `Narrative` worksheet each, holding only
    // the values the scenario names (so a match count stays exact).
    make("EVO-N02-FIND-NEXT", ["Narrative"], "Narrative", "2026-10-06T10:00:00.000Z", {
      Narrative: { E4: "Cobalt", E7: "Cobalt", E11: "Cobalt" },
    }),
    make("EVO-N02-REPLACE-ALL", ["Narrative"], "Narrative", "2026-10-06T10:01:00.000Z", {
      Narrative: { F3: "Cobalt", F6: "Cobalt", F9: "Cobalt", F12: "Copper" },
    }),
    make("EVO-N02-CASE-SENSITIVE", ["Narrative"], "Narrative", "2026-10-06T10:02:00.000Z", {
      Narrative: { G3: "Cobalt", G4: "cobalt", G5: "Cobalt-7" },
    }),
    // Named-range scenarios: one `ForecastModel` worksheet each. The create and
    // invalid scenarios start without a name; the update scenario already owns
    // `MarginBase` (K2:K3) and the formula `=SUM(MarginBase)` in M2.
    make("EVO-N03-NAMED-CREATE", ["ForecastModel"], "ForecastModel", "2026-10-07T09:00:00.000Z", {
      ForecastModel: { J3: "18", J4: "24", J5: "31" },
    }),
    make("EVO-N03-NAMED-INVALID", ["ForecastModel"], "ForecastModel", "2026-10-07T09:01:00.000Z", {
      ForecastModel: { K2: "6", K3: "14" },
    }),
    make("EVO-N03-NAMED-UPDATE", ["ForecastModel"], "ForecastModel", "2026-10-07T09:02:00.000Z", {
      ForecastModel: { K2: "5", K3: "8", K4: "12", M2: "=SUM(MarginBase)" },
    }, { namedRanges: [{ name: "MarginBase", range: "ForecastModel!K2:K3" }] }),
    // Conditional-formatting scenarios: one `Signals` worksheet each, the edit
    // scenario already holding its Red-fill rule for values greater than 20.
    make("EVO-N04-FORMAT-NUMBER", ["Signals"], "Signals", "2026-10-07T10:00:00.000Z", {
      Signals: { J4: "11", J5: "29", J6: "46" },
    }),
    make("EVO-N04-FORMAT-TEXT", ["Signals"], "Signals", "2026-10-07T10:01:00.000Z", {
      Signals: { K4: "Watch", K5: "Stable", K6: "Elevated" },
    }),
    make("EVO-N04-FORMAT-EDIT", ["Signals"], "Signals", "2026-10-07T10:02:00.000Z", {
      Signals: { L3: "16", L4: "28", L5: "39" },
    }, {
      conditionalFormats: {
        Signals: [{ range: "L3:L5", condition: "Greater than", value: "20", style: "Red fill" }],
      },
    }),
    // Cell-note scenarios: one `ReviewQueue` worksheet each, holding only the
    // annotated record the scenario names. The edit and delete scenarios
    // already carry their note, so the visitor only has to open it.
    make("EVO-N05-NOTE-CREATE", ["ReviewQueue"], "ReviewQueue", "2026-10-08T09:00:00.000Z", {
      ReviewQueue: { D8: "Manifest R41" },
    }),
    make("EVO-N05-NOTE-EDIT", ["ReviewQueue"], "ReviewQueue", "2026-10-08T09:01:00.000Z", {
      ReviewQueue: { F6: "Gate Rho" },
    }, {
      notes: { ReviewQueue: { F6: "Awaiting controller sign-off" } },
    }),
    make("EVO-N05-NOTE-DELETE", ["ReviewQueue"], "ReviewQueue", "2026-10-08T09:02:00.000Z", {
      ReviewQueue: { J3: "Route Zeta" },
    }, {
      notes: { ReviewQueue: { J3: "Retire after audit" } },
    }),
  ];
}

/**
 * Shared evaluation seed. Worksheet `Sheet1` holds the seeded cell `A1 = Region`
 * plus the header row and region rows other requirements reference on the same
 * workbook (`Region/Sales/Status`, `East/1200/Open`, `North/800/Closed`,
 * `South/700/Open`). A second, blank `Sheet2` is seeded so the workbook has two
 * independent worksheets out of the box. The EVO scenario workbooks follow.
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
      ...evoSeedWorkbooks(),
    ],
  };
}

/**
 * Idempotent upgrade merging the current seed's workbooks into an existing
 * state by stable id. Missing pre-provisioned workbooks are appended while
 * every existing record (including user-created and renamed workbooks) is kept
 * untouched; running it again changes nothing.
 */
export function upgradeSeedState(state) {
  const workbooks = Array.isArray(state?.workbooks) ? state.workbooks : [];
  const present = new Set(workbooks.map((workbook) => workbook?.id));
  const missing = createSeedState().workbooks.filter((workbook) => !present.has(workbook.id));
  if (missing.length === 0) return state;
  return { ...state, workbooks: [...workbooks, ...missing] };
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
 * Workbook name for a rename: trimmed, non-empty, at most 80 characters and
 * unique across every workbook regardless of letter case (the workbook being
 * renamed excluded). Each rejection throws a `ValidationError` carrying the
 * exact message, so the stored name is validated before the atomic write.
 */
function normalizeName(value, workbooks, currentId) {
  if (typeof value !== "string") throw new ValidationError(EMPTY_NAME_MESSAGE);
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(EMPTY_NAME_MESSAGE);
  if (trimmed.length > MAX_WORKBOOK_NAME_LENGTH) throw new ValidationError(NAME_TOO_LONG_MESSAGE);
  const wanted = trimmed.toLowerCase();
  const clash = workbooks.some(
    (workbook) =>
      workbook.id !== currentId &&
      typeof workbook.name === "string" &&
      workbook.name.trim().toLowerCase() === wanted,
  );
  if (clash) throw new ValidationError(DUPLICATE_WORKBOOK_NAME_MESSAGE);
  return trimmed;
}

/**
 * Name for a worksheet rename: trimmed, non-empty and at most 50 characters.
 * Each rejection carries its exact message; the caller still checks uniqueness
 * against the workbook before the atomic write.
 */
function normalizeWorksheetName(value) {
  if (typeof value !== "string") throw new ValidationError(EMPTY_WORKSHEET_NAME_MESSAGE);
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(EMPTY_WORKSHEET_NAME_MESSAGE);
  if (trimmed.length > MAX_WORKSHEET_NAME_LENGTH) {
    throw new ValidationError(WORKSHEET_NAME_TOO_LONG_MESSAGE);
  }
  return trimmed;
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

/**
 * Validated, canonical rule payload, or throws `ValidationError`. An optional
 * `message` is trimmed and stored only when nonempty, so it replaces the
 * standard rejection text while an empty one keeps the standard text.
 */
function normalizeRule({ range, type, min, max, values, message } = {}) {
  const normalizedRange = normalizeRuleRange(range);
  const custom = typeof message === "string" ? message.trim() : "";
  let rule;
  if (type === NUMBER_RANGE_TYPE) {
    const low = typeof min === "number" ? min : Number(min);
    const high = typeof max === "number" ? max : Number(max);
    if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) {
      throw new ValidationError(INVALID_RULE_MESSAGE);
    }
    rule = { range: normalizedRange, type, min: low, max: high };
  } else if (type === DROPDOWN_TYPE) {
    const allowed = Array.isArray(values)
      ? values.map((value) => String(value).trim()).filter((value) => value !== "")
      : [];
    if (allowed.length === 0) throw new ValidationError(INVALID_RULE_MESSAGE);
    rule = { range: normalizedRange, type, values: allowed };
  } else {
    throw new ValidationError(INVALID_RULE_MESSAGE);
  }
  return custom ? { ...rule, message: custom } : rule;
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

/** Whole number of frozen rows/columns, or throws `ValidationError`. */
function normalizeFreezeCount(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_FREEZE_COUNT) {
    throw new ValidationError(INVALID_FREEZE_MESSAGE);
  }
  return value;
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
  const store = createJsonStore(filePath, createSeedState(), { upgrade: upgradeSeedState });

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
     * Writes a list of individual cells (an A1 coordinate and its text value
     * each) in a single atomic write. Used by find-and-replace, whose matching
     * cells are not one rectangle: every listed cell is written or cleared
     * together, so a rejected payload (unknown worksheet, malformed coordinate
     * or a rejected validation target) leaves the stored worksheet untouched.
     */
    async applyCellUpdates({ workbookId, worksheetId, updates } = {}) {
      if (!Array.isArray(updates) || updates.length === 0) throw new ValidationError(INVALID_RANGE_MESSAGE);
      const normalized = updates.map((update) => {
        if (update === null || typeof update !== "object" || Array.isArray(update)) {
          throw new ValidationError(INVALID_RANGE_MESSAGE);
        }
        if (typeof update.value !== "string") throw new ValidationError(INVALID_CELL_VALUE_MESSAGE);
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
     * Stores or replaces the note attached to one cell in one atomic write. A
     * note is an annotation of its coordinate and is kept in the worksheet's
     * own notes map, so writing one never changes the cell value and a rejected
     * payload leaves both the notes and the cells untouched. Text that is empty
     * after trimming removes the note instead of storing a blank one.
     */
    async setCellNote({ workbookId, worksheetId, coordinate, text } = {}) {
      if (typeof text !== "string") throw new ValidationError(INVALID_NOTE_MESSAGE);
      const key = normalizeCoordinate(coordinate);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const notes = { ...(worksheet.notes ?? {}) };
          if (text.trim() === "") delete notes[key];
          else notes[key] = text;
          if (Object.keys(notes).length > 0) worksheet.notes = notes;
          else delete worksheet.notes;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Removes the note of one cell (its `Open note for <coordinate>` button
     * disappears) in one atomic write. The cell value and every other note of
     * the worksheet are never touched.
     */
    async deleteCellNote({ workbookId, worksheetId, coordinate } = {}) {
      const key = normalizeCoordinate(coordinate);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          if (worksheet.notes) {
            delete worksheet.notes[key];
            if (Object.keys(worksheet.notes).length === 0) delete worksheet.notes;
          }
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Stores how many leading rows and columns of one worksheet stay in place
     * while scrolling (its frozen panes) in one atomic write. Freeze state is
     * view state of that worksheet, like its selection: the values are stored
     * per worksheet and survive a refresh, and a zero count leaves the stored
     * worksheet without that key.
     */
    async setFreeze({ workbookId, worksheetId, rows, columns } = {}) {
      const frozenRows = normalizeFreezeCount(rows);
      const frozenColumns = normalizeFreezeCount(columns);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          if (frozenRows > 0) worksheet.frozenRows = frozenRows;
          else delete worksheet.frozenRows;
          if (frozenColumns > 0) worksheet.frozenColumns = frozenColumns;
          else delete worksheet.frozenColumns;
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
     * Creates or replaces the validation rule covering one A1 range. Any
     * existing rule with the same range is replaced, other rules are kept, and
     * the whole change is one atomic write. Cell values are never touched, so a
     * rejected payload leaves the stored worksheet unchanged.
     */
    async setValidationRule({ workbookId, worksheetId, range, type, min, max, values, message } = {}) {
      const rule = normalizeRule({ range, type, min, max, values, message });
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
     * Creates or replaces one workbook-level named range in a single atomic
     * write. The name is validated (must start with a letter) and the reference
     * canonicalised before anything is stored, so a rejected save leaves every
     * saved name untouched. An existing name (compared case-insensitively) has
     * its range replaced, which is what the dialog's editing path performs.
     */
    async setNamedRange({ workbookId, name, range } = {}) {
      const entry = normalizeNamedRange({ name, range });
      const wanted = entry.name.toLowerCase();
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const ranges = Array.isArray(workbook.namedRanges) ? workbook.namedRanges : [];
          const index = ranges.findIndex(
            (existing) => typeof existing?.name === "string" && existing.name.trim().toLowerCase() === wanted,
          );
          if (index === -1) workbook.namedRanges = [...ranges, entry];
          else workbook.namedRanges = ranges.map((existing, position) => (position === index ? entry : existing));
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Appends a conditional-formatting rule, or replaces the rule at `index`
     * (the dialog's editing path), in one atomic write. The rule is validated
     * first, so a rejected save leaves the stored rules untouched. A rule is
     * only ever a stored description: no cell value is written.
     */
    async setConditionalFormat({ workbookId, worksheetId, index, range, condition, value, style } = {}) {
      const rule = normalizeConditionalFormat({ range, condition, value, style });
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const rules = Array.isArray(worksheet.conditionalFormats) ? worksheet.conditionalFormats : [];
          if (index === undefined || index === null) {
            worksheet.conditionalFormats = [...rules, rule];
          } else {
            if (!Number.isInteger(index) || index < 0 || index >= rules.length) {
              throw new ValidationError(UNKNOWN_CONDITIONAL_FORMAT_MESSAGE);
            }
            worksheet.conditionalFormats = rules.map((existing, position) => (position === index ? rule : existing));
          }
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Removes one conditional-formatting rule in a single atomic write; the
     * remaining rules keep their order and every cell value stays as it is, so
     * the removed rule's fill simply stops being painted.
     */
    async deleteConditionalFormat({ workbookId, worksheetId, index } = {}) {
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const rules = Array.isArray(worksheet.conditionalFormats) ? worksheet.conditionalFormats : [];
          if (!Number.isInteger(index) || index < 0 || index >= rules.length) {
            throw new ValidationError(UNKNOWN_CONDITIONAL_FORMAT_MESSAGE);
          }
          const kept = rules.filter((existing, position) => position !== index);
          if (kept.length > 0) worksheet.conditionalFormats = kept;
          else delete worksheet.conditionalFormats;
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
     * Saves the worksheet's currently applied filter as a named filter view in
     * one atomic write. The name is trimmed and must be nonempty and unique
     * within the workbook ignoring letter case; a duplicate (for example
     * ` queued lanes ` against `Queued lanes`) rejects with
     * `FILTER_VIEW_NAME_EXISTS_MESSAGE` and leaves every view untouched. The
     * stored criteria are a snapshot of the current filter, so later edits to
     * the live filter never rewrite a saved view.
     */
    async saveFilterView({ workbookId, worksheetId, name } = {}) {
      const trimmed = typeof name === "string" ? name.trim() : "";
      if (!trimmed) throw new ValidationError(EMPTY_FILTER_VIEW_NAME_MESSAGE);
      const wanted = trimmed.toLowerCase();
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          if (!worksheet.filter) throw new ValidationError(NO_FILTER_TO_SAVE_MESSAGE);
          const clash = workbook.worksheets.some((candidate) =>
            (Array.isArray(candidate.filterViews) ? candidate.filterViews : []).some(
              (view) => typeof view?.name === "string" && view.name.trim().toLowerCase() === wanted,
            ),
          );
          if (clash) throw new ValidationError(FILTER_VIEW_NAME_EXISTS_MESSAGE);
          const views = Array.isArray(worksheet.filterViews) ? worksheet.filterViews : [];
          worksheet.filterViews = [
            ...views,
            { id: randomUUID(), name: trimmed, filter: structuredClone(worksheet.filter) },
          ];
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Deletes one saved filter view and restores all source rows in one atomic
     * write: the view is removed and the worksheet's applied filter cleared, so
     * every record is visible again with its original value and order. Cell
     * values and validation rules are never touched.
     */
    async deleteFilterView({ workbookId, worksheetId, viewId } = {}) {
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const views = Array.isArray(worksheet.filterViews) ? worksheet.filterViews : [];
          const kept = views.filter((view) => view?.id !== viewId);
          if (kept.length === views.length) throw new ValidationError(UNKNOWN_FILTER_VIEW_MESSAGE);
          if (kept.length > 0) worksheet.filterViews = kept;
          else delete worksheet.filterViews;
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
     * Renames one worksheet after trimming. The new name must not be empty, must
     * be at most 50 characters and must be unique within the same workbook
     * ignoring letter case; every failure rejects with a `ValidationError` and
     * leaves the stored state (including the old name) untouched, since the name
     * is validated before the atomic write.
     */
    async renameWorksheet({ workbookId, worksheetId, name } = {}) {
      const trimmed = normalizeWorksheetName(name);
      const wanted = trimmed.toLowerCase();
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          if (
            workbook.worksheets.some(
              (candidate) =>
                candidate.id !== worksheetId &&
                typeof candidate.name === "string" &&
                candidate.name.trim().toLowerCase() === wanted,
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
          // Cell notes follow the cells they annotate, so an inserted or deleted
          // line never moves a note onto a different record.
          if (worksheet.notes) {
            const movedNotes = shiftAnnotations(worksheet.notes, { axis, mode, index });
            if (movedNotes && Object.keys(movedNotes).length > 0) worksheet.notes = movedNotes;
            else delete worksheet.notes;
          }
          // Validation rules and the filter view follow their cells, so
          // dropdown buttons and numeric limits stay on the same records.
          const shiftedRules = shiftRuleRanges(worksheet.validationRules, { axis, mode, index });
          if (Array.isArray(shiftedRules) && shiftedRules.length > 0) worksheet.validationRules = shiftedRules;
          else delete worksheet.validationRules;
          // Conditional-formatting rules follow their cells too, so a fill stays
          // attached to the records it was created for.
          if (Array.isArray(worksheet.conditionalFormats)) {
            const shiftedFormats = shiftRuleRanges(worksheet.conditionalFormats, { axis, mode, index });
            if (Array.isArray(shiftedFormats) && shiftedFormats.length > 0) {
              worksheet.conditionalFormats = shiftedFormats;
            } else {
              delete worksheet.conditionalFormats;
            }
          }
          if (worksheet.filter) {
            const shifted = shiftFilter(worksheet.filter, { axis, mode, index });
            if (shifted) worksheet.filter = shifted;
            else delete worksheet.filter;
          }
          // Saved filter views follow their cells too, so a later apply reads the
          // same records the view was saved for.
          if (Array.isArray(worksheet.filterViews)) {
            const movedViews = [];
            for (const view of worksheet.filterViews) {
              const shifted = view?.filter ? shiftFilter(view.filter, { axis, mode, index }) : null;
              if (shifted) movedViews.push({ ...view, filter: shifted });
            }
            if (movedViews.length > 0) worksheet.filterViews = movedViews;
            else delete worksheet.filterViews;
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
