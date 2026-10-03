import { parseRange, type RangeBounds } from "./filter";
import { cellName, parseCellName, type ValidationRule, type Worksheet } from "./types";

function contains(bounds: RangeBounds, row: number, column: number): boolean {
  return row >= bounds.top && row <= bounds.bottom && column >= bounds.left && column <= bounds.right;
}

/** Trims and drops empty items of a dropdown rule, mirroring the backend. */
export function allowedValuesOf(rule: ValidationRule | null | undefined): string[] {
  if (!rule || rule.type !== "list") return [];
  return (rule.values ?? []).map((value) => String(value).trim()).filter((value) => value !== "");
}

/** The rule whose range is exactly `range`, or `null`. */
export function ruleForRange(worksheet: Worksheet, range: string): ValidationRule | null {
  const bounds = parseRange(range);
  if (!bounds) return null;
  const canonical = `${cellName(bounds.top, bounds.left)}:${cellName(bounds.bottom, bounds.right)}`;
  return (worksheet.validations ?? []).find((rule) => rule?.range === canonical) ?? null;
}

/** The rule covering the top-left cell of `range`, used to prefill the dialog. */
export function ruleCoveringRange(worksheet: Worksheet, range: string): ValidationRule | null {
  const bounds = parseRange(range);
  if (!bounds) return null;
  const exact = ruleForRange(worksheet, range);
  if (exact) return exact;
  return (
    (worksheet.validations ?? []).find((rule) => {
      const ruleBounds = parseRange(rule?.range);
      return ruleBounds ? contains(ruleBounds, bounds.top, bounds.left) : false;
    }) ?? null
  );
}

/** The dropdown rule covering one cell, when the cell offers an "Open dropdown" button. */
export function listRuleForCell(worksheet: Worksheet, name: string): ValidationRule | null {
  const position = parseCellName(name);
  if (!position) return null;
  for (const rule of worksheet.validations ?? []) {
    if (rule?.type !== "list") continue;
    const bounds = parseRange(rule.range);
    if (bounds && contains(bounds, position.row, position.column)) return rule;
  }
  return null;
}
