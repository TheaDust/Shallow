/**
 * Named ranges: workbook-scoped names that stand for an A1 area of one
 * worksheet. A stored reference keeps the optional `Sheet!` qualifier, so the
 * name stays meaningful when the workbook has several worksheets, and its area
 * follows row/column structure changes exactly like a validation rule does.
 *
 * Every helper is pure; the store validates a name and a reference before its
 * single atomic write, so a rejected name never changes the stored ranges.
 */

import { ValidationError } from "../lib/errors.mjs";
import { cellName, parseArea } from "./grid.mjs";
import { shiftArea } from "./structure.mjs";

/** Exact message of a name that does not start with a letter. */
export const NAMED_RANGE_NAME_MESSAGE = "Named range must start with a letter";
/** Exact message of a name another range of the same workbook already uses. */
export const NAMED_RANGE_DUPLICATE_MESSAGE = "Named range name already exists";
/** Exact message of a range that is not a `Sheet!A1:B2` style reference. */
export const NAMED_RANGE_REFERENCE_MESSAGE = "Named range reference must be a valid range";
/** Exact message of an update/delete that names no stored range. */
export const UNKNOWN_NAMED_RANGE_MESSAGE = "Unknown named range";

// A usable name starts with a letter and continues with letters, digits or
// underscores, so it can be written inside a formula without quoting.
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Name of a named range after trimming. A name that does not start with a
 * letter (including an empty one) is rejected with `NAMED_RANGE_NAME_MESSAGE`.
 */
export function normalizeNamedRangeName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!NAME_PATTERN.test(name)) throw new ValidationError(NAMED_RANGE_NAME_MESSAGE);
  return name;
}

/**
 * Splits a reference into its optional worksheet name and its canonical A1
 * area, or returns `null` when it is not a usable reference. An absolute
 * reference (`$J$3:$J$5`) is accepted and stored without the `$` anchors.
 */
export function parseNamedRangeReference(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "") return null;
  const separator = text.indexOf("!");
  let sheet = null;
  let areaText = text;
  if (separator >= 0) {
    sheet = text.slice(0, separator).trim();
    areaText = text.slice(separator + 1).trim();
    if (sheet.startsWith("'") && sheet.endsWith("'") && sheet.length >= 2) {
      sheet = sheet.slice(1, -1).replace(/''/g, "'").trim();
    }
    if (sheet === "") return null;
  }
  const bounds = parseArea(areaText.replace(/\$/g, ""));
  if (!bounds) return null;
  const start = cellName(bounds.top, bounds.left);
  const end = cellName(bounds.bottom, bounds.right);
  return { sheet, range: start === end ? start : `${start}:${end}` };
}

/** Canonical reference text of a parsed reference, or `null` when invalid. */
export function formatNamedRangeReference(value) {
  const parsed = parseNamedRangeReference(value);
  if (!parsed) return null;
  return parsed.sheet ? `${parsed.sheet}!${parsed.range}` : parsed.range;
}

/** Canonical reference of a request payload, or throws `ValidationError`. */
export function normalizeNamedRangeReference(value) {
  const text = formatNamedRangeReference(value);
  if (!text) throw new ValidationError(NAMED_RANGE_REFERENCE_MESSAGE);
  return text;
}

/**
 * Named ranges after a row/column change of one worksheet: every reference
 * targeting that worksheet follows its cells, while a reference to another
 * worksheet (or a range covered by a deleted line) stays as it is or is
 * dropped. `worksheetName` selects the moved references without regard to
 * letter case; an unqualified reference follows the changed worksheet.
 */
export function shiftNamedRanges(ranges, { worksheetName, axis, mode, index } = {}) {
  if (!Array.isArray(ranges) || ranges.length === 0) return ranges;
  const at = mode === "insert-after" ? index + 1 : index;
  const change = mode === "delete" ? "delete" : "insert-before";
  const wanted = String(worksheetName ?? "").trim().toLowerCase();
  const next = [];
  for (const entry of ranges) {
    const parsed = parseNamedRangeReference(entry?.range);
    if (!parsed) continue;
    if (parsed.sheet && parsed.sheet.toLowerCase() !== wanted) {
      next.push(entry);
      continue;
    }
    const moved = shiftArea(parsed.range, axis, change, at);
    if (!moved) continue;
    next.push({ ...entry, range: parsed.sheet ? `${parsed.sheet}!${moved}` : moved });
  }
  return next;
}
