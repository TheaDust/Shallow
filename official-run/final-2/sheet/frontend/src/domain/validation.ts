/**
 * Client-side helpers for the worksheet's data-validation rules.
 *
 * Rules are enforced by the server (the authoritative boundary); the editor
 * only needs to describe and display them: the A1 area a rule covers, the rule
 * currently in effect for a selection, and how a rule maps onto the dialog.
 */

import { parseCellName, regionFromArea, type CellRegion } from "./grid";
import type { ValidationRule } from "./types";

export const NUMBER_RANGE_TYPE = "number-range";
export const DROPDOWN_TYPE = "dropdown";

export const RULE_TYPE_OPTIONS = [
  { value: NUMBER_RANGE_TYPE, label: "Number range" },
  { value: DROPDOWN_TYPE, label: "Dropdown" },
] as const;

/** Rectangle covered by a rule's A1 range, or `null` when it is malformed. */
export function ruleBounds(rule: ValidationRule | null | undefined): CellRegion | null {
  if (!rule || typeof rule.range !== "string") return null;
  return regionFromArea(rule.range);
}

/** First rule that fully covers `region`, or `null`. */
export function findRuleForRegion(
  rules: ValidationRule[] | undefined,
  region: CellRegion,
): ValidationRule | null {
  if (!Array.isArray(rules)) return null;
  for (const rule of rules) {
    const bounds = ruleBounds(rule);
    if (!bounds) continue;
    if (
      region.top >= bounds.top &&
      region.bottom <= bounds.bottom &&
      region.left >= bounds.left &&
      region.right <= bounds.right
    ) {
      return rule;
    }
  }
  return null;
}

/** First rule covering `coordinate`, or `null`; drives the grid's dropdown cells. */
export function findRuleForCoordinate(
  rules: ValidationRule[] | undefined,
  coordinate: string,
): ValidationRule | null {
  const position = parseCellName(coordinate);
  if (!position || !Array.isArray(rules)) return null;
  for (const rule of rules) {
    const bounds = ruleBounds(rule);
    if (!bounds) continue;
    if (
      position.row >= bounds.top &&
      position.row <= bounds.bottom &&
      position.column >= bounds.left &&
      position.column <= bounds.right
    ) {
      return rule;
    }
  }
  return null;
}

/** Allowed values of a dropdown rule, or an empty list. */
export function dropdownValues(rule: ValidationRule | null | undefined): string[] {
  if (!rule || rule.type !== DROPDOWN_TYPE || !Array.isArray(rule.values)) return [];
  return rule.values;
}

/** Comma-separated dialog text turned into the trimmed allowed-value list. */
export function parseAllowedValues(text: string): string[] {
  return text
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
}
