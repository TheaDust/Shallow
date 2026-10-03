import { parseCellName } from "./cells.mjs";
import { numericCellValue } from "./formula.mjs";

export const NUMBER_ZERO_TO_HUNDRED_MESSAGE = "Please enter a number from 0 to 100";

/** Inclusive numeric rule message; the persisted 0-to-100 rule has its own wording. */
export function numberRuleMessage(rule) {
  if (typeof rule?.message === "string" && rule.message !== "") return rule.message;
  if (Number(rule?.min) === 0 && Number(rule?.max) === 100) return NUMBER_ZERO_TO_HUNDRED_MESSAGE;
  return `Please enter a number between ${rule?.min} and ${rule?.max}`;
}

export function listRuleMessage(rule) {
  const values = Array.isArray(rule?.values) ? rule.values.map((value) => String(value).trim()) : [];
  return `Please select one of the following values: ${values.join(", ")}`;
}

function ruleBounds(range) {
  const match = /^([A-Za-z]+[1-9][0-9]*):([A-Za-z]+[1-9][0-9]*)$/.exec(String(range ?? "").trim());
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

function covers(bounds, position) {
  return (
    position.row >= bounds.top &&
    position.row <= bounds.bottom &&
    position.column >= bounds.left &&
    position.column <= bounds.right
  );
}

/**
 * First validation message for writing `value` into the cell `name`, or `null` when the
 * write is allowed. Rules live on the worksheet as
 * `{ range, type: "number" | "list", min, max, values, message }`.
 */
export function validateCellValue(worksheet, name, value) {
  const position = parseCellName(name);
  if (!position) return null;
  const text = typeof value === "string" ? value : String(value ?? "");
  for (const rule of worksheet?.validations ?? []) {
    const bounds = ruleBounds(rule?.range);
    if (!bounds || !covers(bounds, position)) continue;
    if (rule.type === "list") {
      const values = Array.isArray(rule.values) ? rule.values.map((item) => String(item).trim()) : [];
      if (!values.includes(text.trim())) return listRuleMessage(rule);
      continue;
    }
    if (rule.type === "number") {
      // An empty cell is accepted; filled cells must hold an in-range number.
      if (text.trim() === "") continue;
      const numeric = numericCellValue(text);
      const min = Number(rule.min);
      const max = Number(rule.max);
      if (numeric === null || numeric < min || numeric > max) return numberRuleMessage(rule);
    }
  }
  return null;
}
