import {
  cellName,
  cellDisplayText,
  parseCellName,
  selectionBounds,
  selectionRangeName,
  type FilterCondition,
  type FilterRule,
  type Selection,
  type Worksheet,
  type WorksheetFilter,
} from "./types";

/** UI labels of the filter conditions; mirrors `FILTER_CONDITIONS` in the backend. */
export const FILTER_CONDITION_LABELS: ReadonlyArray<{ value: FilterCondition; label: string }> = [
  { value: "text-contains", label: "Text contains" },
  { value: "greater-than", label: "Greater than" },
  { value: "before", label: "Before" },
  { value: "is-empty", label: "Is empty" },
  { value: "is-not-empty", label: "Is not empty" },
];

export const conditionLabel = (condition: FilterCondition): string =>
  FILTER_CONDITION_LABELS.find((entry) => entry.value === condition)?.label ?? "";

export interface RangeBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Parses `A1:C6` into a rectangle, or `null` when the text is not a range. */
export function parseRange(range: string | undefined | null): RangeBounds | null {
  const match = /^\s*([A-Za-z]+[1-9][0-9]*)\s*:\s*([A-Za-z]+[1-9][0-9]*)\s*$/.exec(String(range ?? ""));
  if (!match) return null;
  const start = parseCellName(match[1]);
  const end = parseCellName(match[2]);
  if (!start || !end) return null;
  return {
    top: Math.min(start.row, end.row),
    bottom: Math.max(start.row, end.row),
    left: Math.min(start.column, end.column),
    right: Math.max(start.column, end.column),
  };
}

function numericValue(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parses a displayed value as a date; plain numbers are quantities, not dates. */
function dateValue(value: string | undefined): number | null {
  const text = String(value ?? "").trim();
  if (text === "" || /^[+-]?\d+(\.\d+)?$/.test(text)) return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : time;
}

function cellText(worksheet: Worksheet, row: number, column: number): string {
  return cellDisplayText(worksheet, cellName(row, column));
}

/** Whether one data row of the filter region satisfies one column rule. */
export function rowMatchesRule(
  worksheet: Worksheet,
  row: number,
  rule: FilterRule,
): boolean {
  const text = cellText(worksheet, row, rule.column);
  if (rule.mode === "values") {
    return (rule.values ?? []).includes(text);
  }
  switch (rule.condition) {
    case "text-contains":
      return text.toLowerCase().includes(String(rule.value ?? "").toLowerCase());
    case "greater-than": {
      const cell = numericValue(text);
      const limit = numericValue(String(rule.value ?? ""));
      return cell !== null && limit !== null && cell > limit;
    }
    case "before": {
      const cell = dateValue(text);
      const limit = dateValue(rule.value);
      return cell !== null && limit !== null && cell < limit;
    }
    case "is-empty":
      return text.trim() === "";
    case "is-not-empty":
      return text.trim() !== "";
    default:
      return true;
  }
}

/**
 * 0-based indices of the rows hidden by the current filter view. Only data rows of the
 * region are hidden; the header row and everything outside the region stay visible.
 */
export function hiddenRowSet(worksheet: Worksheet | null | undefined): Set<number> {
  const filter = worksheet?.filter;
  const bounds = parseRange(filter?.range);
  const rules = filter?.rules ?? [];
  if (!worksheet || !bounds || rules.length === 0) return new Set();
  const hidden = new Set<number>();
  for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
    if (!rules.every((rule) => rowMatchesRule(worksheet, row, rule))) hidden.add(row);
  }
  return hidden;
}

/** Distinct non-empty values of one column of the region, in first-seen order. */
export function distinctColumnValues(
  worksheet: Worksheet,
  filter: WorksheetFilter,
  column: number,
): string[] {
  const bounds = parseRange(filter.range);
  if (!bounds) return [];
  const values: string[] = [];
  for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
    const text = cellText(worksheet, row, column);
    if (text.trim() === "" || values.includes(text)) continue;
    values.push(text);
  }
  return values;
}

/** Header columns of the filtered region: one entry per `Filter <header text>` button. */
export function filterColumns(worksheet: Worksheet): Array<{ column: number; header: string }> {
  const filter = worksheet.filter;
  const bounds = parseRange(filter?.range);
  if (!filter || !bounds) return [];
  const columns: Array<{ column: number; header: string }> = [];
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    columns.push({ column, header: cellText(worksheet, bounds.top, column) });
  }
  return columns;
}

/** Replaces the rule of one column, keeping the region and the other columns' rules. */
export function withColumnRule(
  filter: WorksheetFilter,
  column: number,
  rule: FilterRule | null,
): FilterRule[] {
  const kept = filter.rules.filter((candidate) => candidate.column !== column);
  return rule ? [...kept, rule] : kept;
}

/**
 * Region a new filter is created for: the selected rectangle, or the contiguous block of
 * non-empty rows/columns around a single selected cell.
 */
export function filterRegionFor(worksheet: Worksheet, selection: Selection): string {
  const bounds = selectionBounds(selection);
  if (!bounds) return "A1";
  if (bounds.top !== bounds.bottom || bounds.left !== bounds.right) {
    return selectionRangeName(selection);
  }
  let top = bounds.top;
  let bottom = bounds.bottom;
  let left = bounds.left;
  let right = bounds.right;
  const filled = (row: number, column: number) =>
    cellText(worksheet, row, column).trim() !== "";
  const rowHasData = (row: number) => {
    for (let column = 0; column < worksheet.columnCount; column += 1) {
      if (filled(row, column)) return true;
    }
    return false;
  };
  const columnHasData = (column: number) => {
    for (let row = top; row <= bottom; row += 1) {
      if (filled(row, column)) return true;
    }
    return false;
  };
  if (!rowHasData(top) && !columnHasData(left)) return selectionRangeName(selection);
  while (top > 0 && rowHasData(top - 1)) top -= 1;
  while (bottom < worksheet.rowCount - 1 && rowHasData(bottom + 1)) bottom += 1;
  while (left > 0 && columnHasData(left - 1)) left -= 1;
  while (right < worksheet.columnCount - 1 && columnHasData(right + 1)) right += 1;
  return `${cellName(top, left)}:${cellName(bottom, right)}`;
}
