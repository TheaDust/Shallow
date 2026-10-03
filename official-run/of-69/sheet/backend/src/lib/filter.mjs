import { cellName, parseCellName } from "./cells.mjs";
import { numericCellValue } from "./formula.mjs";

/**
 * Filter views of one worksheet (REQ-5-1-2). A filter names a data region with headers;
 * its rules only hide data rows, they never move or delete cells. The frontend mirrors
 * this model in `frontend/src/domain/filter.ts`.
 */
export const FILTER_CONDITIONS = Object.freeze([
  "text-contains",
  "greater-than",
  "before",
  "is-empty",
  "is-not-empty",
]);

export const FILTER_RANGE_INVALID_MESSAGE = "Invalid filter range";

/** Parses `A1:C6` into a rectangle, or `null` when the text is not a range. */
export function filterBounds(range) {
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

export function rangeName(bounds) {
  return `${cellName(bounds.top, bounds.left)}:${cellName(bounds.bottom, bounds.right)}`;
}

function cellText(worksheet, row, column) {
  return String(worksheet?.cells?.[cellName(row, column)]?.value ?? "");
}

/** Parses a displayed value as a date; plain numbers are quantities, not dates. */
export function dateValue(value) {
  const text = String(value ?? "").trim();
  if (text === "" || /^[+-]?\d+(\.\d+)?$/.test(text)) return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : time;
}

/** Whether one data row of the filter region satisfies one column rule. */
export function rowMatchesFilterRule(worksheet, row, rule) {
  const text = cellText(worksheet, row, rule?.column);
  if (rule?.mode === "values") {
    const values = Array.isArray(rule.values) ? rule.values : [];
    return values.includes(text);
  }
  switch (rule?.condition) {
    case "text-contains":
      return text.toLowerCase().includes(String(rule.value ?? "").toLowerCase());
    case "greater-than": {
      const cell = numericCellValue(text);
      const limit = numericCellValue(String(rule.value ?? ""));
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
 * Row indices hidden by the filter view: every data row of the region that does not
 * satisfy all column rules. The header row and everything outside the region stay visible.
 */
export function hiddenRowsOf(worksheet) {
  const filter = worksheet?.filter;
  const bounds = filterBounds(filter?.range);
  const rules = Array.isArray(filter?.rules) ? filter.rules : [];
  if (!bounds || rules.length === 0) return [];
  const hidden = [];
  for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
    if (!rules.every((rule) => rowMatchesFilterRule(worksheet, row, rule))) hidden.push(row);
  }
  return hidden;
}

/** Distinct non-empty displayed values of one column of the region, in first-seen order. */
export function distinctColumnValues(worksheet, filter, column) {
  const bounds = filterBounds(filter?.range);
  if (!bounds) return [];
  const values = [];
  for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
    const text = cellText(worksheet, row, column);
    if (text.trim() === "" || values.includes(text)) continue;
    values.push(text);
  }
  return values;
}

/** Header cells of the filtered region: one entry per column carrying a filter button. */
export function filterColumnsOf(worksheet) {
  const filter = worksheet?.filter;
  const bounds = filterBounds(filter?.range);
  if (!bounds) return [];
  const columns = [];
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    columns.push({ column, header: cellText(worksheet, bounds.top, column) });
  }
  return columns;
}

/**
 * Canonical filter payload: the region plus its per-column rules. Unknown conditions and
 * columns outside the region are dropped instead of stored.
 */
export function normalizeFilter(range, rules) {
  const bounds = filterBounds(range);
  if (!bounds) return null;
  const normalized = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    const column = Number(rule?.column);
    if (!Number.isInteger(column) || column < bounds.left || column > bounds.right) continue;
    if (rule?.mode === "values") {
      const values = Array.isArray(rule.values) ? rule.values.map((value) => String(value)) : [];
      normalized.push({ column, mode: "values", values });
      continue;
    }
    if (rule?.mode === "condition" && FILTER_CONDITIONS.includes(rule.condition)) {
      normalized.push({
        column,
        mode: "condition",
        condition: rule.condition,
        value: String(rule.value ?? ""),
      });
    }
  }
  return { range: rangeName(bounds), rules: normalized };
}

/**
 * Rewrites a filter region after a row/column insertion or deletion and drops deleted
 * columns; `null` means the region no longer covers any cell.
 */
export function shiftFilter(filter, { isRow, kind, index }) {
  const bounds = filterBounds(filter?.range);
  if (!bounds) return null;
  const map = (value) => {
    if (kind === "delete") return value === index ? null : value > index ? value - 1 : value;
    const threshold = kind === "before" ? index : index + 1;
    return value >= threshold ? value + 1 : value;
  };
  const rows = isRow ? [map(bounds.top), map(bounds.bottom)] : [bounds.top, bounds.bottom];
  const columns = isRow ? [bounds.left, bounds.right] : [map(bounds.left), map(bounds.right)];
  const keptRows = rows.filter((value) => value !== null);
  const keptColumns = columns.filter((value) => value !== null);
  if (keptRows.length === 0 || keptColumns.length === 0) return null;
  const next = {
    top: Math.min(...keptRows),
    bottom: Math.max(...keptRows),
    left: Math.min(...keptColumns),
    right: Math.max(...keptColumns),
  };
  const rules = (Array.isArray(filter.rules) ? filter.rules : [])
    .map((rule) => {
      const column = isRow ? rule.column : map(rule.column);
      return column === null ? null : { ...rule, column };
    })
    .filter((rule) => rule !== null && rule.column >= next.left && rule.column <= next.right);
  return { range: rangeName(next), rules };
}
