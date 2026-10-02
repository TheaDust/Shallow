import { displayValues } from "./formula";
import {
  cellName,
  parseCellName,
  selectionRegion,
  type CellRegion,
  type FilterCondition,
  type FilterRule,
  type Selection,
  type Worksheet,
  type WorksheetFilter,
} from "./workbook";

/**
 * Filter views for one worksheet (REQ-5-1-2).
 *
 * A filter names a data region whose first row holds the headers plus one rule
 * per constrained column. Everything here is derived: the hidden rows are
 * computed from the stored cells and the persisted rules, so hiding never
 * rewrites a value, the row order stays the source order, and CSV export /
 * pivot summarization (which read the worksheet, not the view) keep every
 * hidden row. Rules of different columns are combined with AND.
 */

/** Visible names of the condition options, in the order the dialog lists them. */
export const FILTER_CONDITIONS: readonly { value: FilterCondition; label: string }[] = [
  { value: "text-contains", label: "Text contains" },
  { value: "greater-than", label: "Greater than" },
  { value: "before", label: "Before" },
  { value: "is-empty", label: "Is empty" },
  { value: "is-not-empty", label: "Is not empty" },
];

/** Conditions that read the "Value" text box; the others compare nothing. */
export const VALUE_CONDITIONS: readonly FilterCondition[] = ["text-contains", "greater-than", "before"];

export function conditionLabel(condition: FilterCondition): string {
  return FILTER_CONDITIONS.find((entry) => entry.value === condition)?.label ?? condition;
}

/** Parses an `A1` or `A1:B2` rectangle; null when it is not a valid range. */
export function parseRangeText(text: string): CellRegion | null {
  const parts = String(text ?? "").trim().toUpperCase().split(":");
  if (parts.length > 2) return null;
  const first = parseCellName(parts[0]);
  if (!first) return null;
  const second = parts.length === 2 ? parseCellName(parts[1]) : first;
  if (!second) return null;
  return {
    minRow: Math.min(first.row, second.row),
    maxRow: Math.max(first.row, second.row),
    minCol: Math.min(first.col, second.col),
    maxCol: Math.max(first.col, second.col),
  };
}

/** A1 text of one rectangle, as stored in a filter or validation rule. */
export function rangeText(region: CellRegion): string {
  const first = cellName({ row: region.minRow, col: region.minCol });
  const second = cellName({ row: region.maxRow, col: region.maxCol });
  return first === second ? first : `${first}:${second}`;
}

export function regionSize(region: CellRegion): number {
  return (region.maxRow - region.minRow + 1) * (region.maxCol - region.minCol + 1);
}

function isCollapsed(region: CellRegion): boolean {
  return region.minRow === region.maxRow && region.minCol === region.maxCol;
}

/** Used rectangle of the worksheet, as a region (`null` when it is empty). */
export function usedRegion(worksheet: Worksheet): CellRegion | null {
  let rows = Math.max(0, worksheet.usedRows ?? 0);
  let cols = Math.max(0, worksheet.usedCols ?? 0);
  for (const [name, value] of Object.entries(worksheet.cells ?? {})) {
    if (!value) continue;
    const ref = parseCellName(name);
    if (!ref) continue;
    rows = Math.max(rows, ref.row + 1);
    cols = Math.max(cols, ref.col + 1);
  }
  if (rows === 0 || cols === 0) return null;
  return { minRow: 0, maxRow: rows - 1, minCol: 0, maxCol: cols - 1 };
}

/**
 * Region an organization command ("Create filter" of REQ-5-1-2, "Sort range" of
 * REQ-5-1-1) applies to: the selected rectangle, or — for a single selected
 * cell — the whole used data region around it, which is the seeded sales table.
 * A rectangle that is not inside the used region is still honored, so the
 * command never silently expands to adjacent data.
 */
export function dataRegionFor(worksheet: Worksheet, selection: Selection): CellRegion | null {
  const selected = selectionRegion(selection);
  if (!isCollapsed(selected)) return selected;
  const used = usedRegion(worksheet);
  if (!used) return null;
  const inside = selected.minRow <= used.maxRow && selected.minCol <= used.maxCol;
  return inside ? used : selected;
}

/** Region a filter covers: the same data region rule as every organization command. */
export function filterRegionFor(worksheet: Worksheet, selection: Selection): CellRegion | null {
  return dataRegionFor(worksheet, selection);
}

/** Columns of the filtered region with their header text, in column order. */
export function filterHeaderColumns(worksheet: Worksheet, filter: WorksheetFilter): { header: string; col: number }[] {
  const region = parseRangeText(filter.range);
  if (!region) return [];
  const display = displayValues(worksheet);
  const columns: { header: string; col: number }[] = [];
  for (let col = region.minCol; col <= region.maxCol; col += 1) {
    const header = (display[cellName({ row: region.minRow, col })] ?? "").trim();
    if (header) columns.push({ header, col });
  }
  return columns;
}

/** Distinct displayed values of one column inside the data rows of the region. */
export function distinctColumnValues(worksheet: Worksheet, region: CellRegion, col: number): string[] {
  const display = displayValues(worksheet);
  const values: string[] = [];
  for (let row = region.minRow + 1; row <= region.maxRow; row += 1) {
    const text = display[cellName({ row, col })] ?? "";
    if (text.trim() === "" || values.includes(text)) continue;
    values.push(text);
  }
  return values;
}

function isBlank(text: string): boolean {
  return text.trim() === "";
}

/**
 * "Before" reads dates first (`2026-08-01` before `2026-09-01`), then plain
 * numbers and finally text, so a date column, a numeric column and a text
 * column all behave sensibly with the same option.
 */
function isBefore(text: string, bound: string): boolean {
  const left = Date.parse(text);
  const right = Date.parse(bound);
  if (Number.isFinite(left) && Number.isFinite(right)) return left < right;
  const leftNumber = Number(text);
  const rightNumber = Number(bound);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber < rightNumber;
  return text < bound;
}

/** True when one displayed value satisfies one rule of its column. */
export function matchesFilterRule(text: string, rule: FilterRule): boolean {
  if (rule.type === "values") return (rule.values ?? []).includes(text);
  const value = rule.value ?? "";
  switch (rule.condition) {
    case "text-contains":
      return text.toLowerCase().includes(value.trim().toLowerCase());
    case "greater-than": {
      if (isBlank(text)) return false;
      const numeric = Number(text);
      const bound = Number(value);
      return Number.isFinite(numeric) && Number.isFinite(bound) && numeric > bound;
    }
    case "before":
      return !isBlank(text) && !isBlank(value) && isBefore(text, value);
    case "is-empty":
      return isBlank(text);
    case "is-not-empty":
      return !isBlank(text);
    default:
      return true;
  }
}

/**
 * Data rows hidden by the filter. Only the rows inside the filtered region can
 * be hidden, and a rule whose header no longer exists in the region constrains
 * nothing. A row stays visible when every rule accepts it (AND).
 */
export function hiddenRows(worksheet: Worksheet, filter: WorksheetFilter | undefined): Set<number> {
  const hidden = new Set<number>();
  if (!filter) return hidden;
  const region = parseRangeText(filter.range);
  if (!region) return hidden;
  const columns = filterHeaderColumns(worksheet, filter);
  const rules = filter.rules.map((rule) => {
    const column = columns.find((candidate) => candidate.header === rule.header);
    return column ? { rule, col: column.col } : null;
  }).filter((entry): entry is { rule: FilterRule; col: number } => entry !== null);
  if (!rules.length) return hidden;
  const display = displayValues(worksheet);
  for (let row = region.minRow + 1; row <= region.maxRow; row += 1) {
    const visible = rules.every(({ rule, col }) => matchesFilterRule(display[cellName({ row, col })] ?? "", rule));
    if (!visible) hidden.add(row);
  }
  return hidden;
}

/** One rule per header: replaces the previous rule of that column (or removes it). */
export function withFilterRule(filter: WorksheetFilter, rule: FilterRule | null, header: string): WorksheetFilter {
  const rules = filter.rules.filter((candidate) => candidate.header !== header);
  if (rule) rules.push(rule);
  return { range: filter.range, rules };
}
