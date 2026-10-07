/**
 * Conditional formatting: a stored rule decides the visible fill of the cells
 * inside its target area. A cell shows the rule's style only when it matches the
 * condition ("Greater than" for parseable numbers, "Text contains" for text);
 * every other cell of the area keeps its normal background. No rule ever changes
 * a cell value, so the fills are derived on every render from the stored rules
 * and the displayed values.
 */

import type { ConditionalFormat, ConditionalFormatCondition, ConditionalFormatStyle } from "./types";

/** Condition names of the "Condition" field, in dialog order. */
export const CONDITIONAL_CONDITIONS: readonly ConditionalFormatCondition[] = ["Greater than", "Text contains"];
/** Style names of the "Style" field, in dialog order. */
export const CONDITIONAL_STYLES: readonly ConditionalFormatStyle[] = ["Red fill", "Yellow fill", "Green fill"];

/** Visible fill of each style name, shared by the grid and the dialog preview. */
export const STYLE_FILLS: Record<ConditionalFormatStyle, string> = {
  "Red fill": "#fee2e2",
  "Yellow fill": "#fef9c3",
  "Green fill": "#dcfce7",
};

/** Parses a displayed cell value as a number, or `null` when it is not one. */
function parseDisplayNumber(value: string | undefined): number | null {
  const text = String(value ?? "").trim();
  if (text === "") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/** Coordinates covered by an A1 area, or an empty list when it is malformed. */
function areaCoordinates(range: string): string[] {
  const parts = String(range ?? "").trim().replace(/\$/g, "").split(":");
  if (parts.length < 1 || parts.length > 2) return [];
  const pattern = /^([A-Za-z]+)([1-9][0-9]*)$/;
  const first = pattern.exec(parts[0].trim());
  const last = pattern.exec((parts.length === 2 ? parts[1] : parts[0]).trim());
  if (!first || !last) return [];
  const toColumn = (letters: string) => {
    let value = 0;
    for (const letter of letters.toUpperCase()) value = value * 26 + (letter.charCodeAt(0) - 64);
    return value;
  };
  const toLetters = (column: number) => {
    let value = column;
    let name = "";
    while (value > 0) {
      const remainder = (value - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      value = Math.floor((value - 1) / 26);
    }
    return name;
  };
  const rows = [Number(first[2]), Number(last[2])].sort((a, b) => a - b);
  const columns = [toColumn(first[1]), toColumn(last[1])].sort((a, b) => a - b);
  const coordinates: string[] = [];
  for (let row = rows[0]; row <= rows[1]; row += 1) {
    for (let column = columns[0]; column <= columns[1]; column += 1) {
      coordinates.push(`${toLetters(column)}${row}`);
    }
  }
  return coordinates;
}

/** True when the displayed value of a cell satisfies the rule's condition. */
export function conditionalFormatMatches(rule: ConditionalFormat, displayed: string | undefined): boolean {
  const value = String(displayed ?? "");
  if (rule.condition === "Greater than") {
    const number = parseDisplayNumber(value);
    const threshold = parseDisplayNumber(rule.value);
    return number !== null && threshold !== null && number > threshold;
  }
  return value.toLowerCase().includes(String(rule.value).toLowerCase());
}

/**
 * Fill color of every cell a stored rule paints, keyed by coordinate. Later
 * rules paint over earlier ones, so the fill always follows the stored order.
 */
export function conditionalFormatFills(
  values: Record<string, string>,
  rules: readonly ConditionalFormat[] | undefined,
): Record<string, string> {
  const fills: Record<string, string> = {};
  for (const rule of rules ?? []) {
    const fill = STYLE_FILLS[rule?.style as ConditionalFormatStyle];
    if (!fill) continue;
    for (const coordinate of areaCoordinates(rule.range)) {
      if (!conditionalFormatMatches(rule, values[coordinate])) continue;
      fills[coordinate] = fill;
    }
  }
  return fills;
}

/** Condition names a rule may use, narrowed from arbitrary server text. */
export function isConditionalCondition(value: string): value is ConditionalFormatCondition {
  return CONDITIONAL_CONDITIONS.includes(value as ConditionalFormatCondition);
}

/** Style names a rule may use, narrowed from arbitrary server text. */
export function isConditionalStyle(value: string): value is ConditionalFormatStyle {
  return CONDITIONAL_STYLES.includes(value as ConditionalFormatStyle);
}
