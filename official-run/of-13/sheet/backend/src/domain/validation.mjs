/**
 * Data-validation rules for one worksheet.
 *
 * A rule is `{ id, range: "A1:B3", type: "number-range" | "dropdown", min?, max?, values?,
 * message? }` stored on the worksheet so it persists with the workbook. The same check is
 * used by every write path (grid/formula bar entry and bulk paste), and a rejected write
 * leaves the whole target untouched.
 *
 * Error text follows the contract wording; a rule may carry its own `message` when the
 * scenario wording differs from the default.
 */

/**
 * Contract wording of a rejected number-range write. The 0-to-100 boundary rule uses the
 * `from <min> to <max>` wording required by the persisted boundary scenario; every other
 * bound pair uses the `between <min> and <max>` template. A rule may also carry its own
 * `message`, which always wins.
 */
export const NUMBER_RANGE_INVALID_MESSAGE = (min, max) =>
  Number(min) === 0 && Number(max) === 100
    ? `Please enter a number from ${min} to ${max}`
    : `Please enter a number between ${min} and ${max}`;

export const DROPDOWN_INVALID_MESSAGE = (values) =>
  `Please select one of the following values: ${values.join(", ")}`;

function addrToPosition(address) {
  const match = /^([A-Z]+)(\d+)$/.exec(String(address).toUpperCase());
  if (!match) return null;
  let column = 0;
  for (const letter of match[1]) column = column * 26 + (letter.charCodeAt(0) - 64);
  return { row: Number(match[2]), column };
}

function rangeBounds(range) {
  const [start, end = start] = String(range ?? "").split(":");
  const from = addrToPosition(start);
  const to = addrToPosition(end);
  if (!from || !to) return null;
  return {
    top: Math.min(from.row, to.row),
    bottom: Math.max(from.row, to.row),
    left: Math.min(from.column, to.column),
    right: Math.max(from.column, to.column),
  };
}

export function ruleCoversAddress(rule, address) {
  const bounds = rangeBounds(rule?.range);
  const position = addrToPosition(address);
  if (!bounds || !position) return false;
  return (
    position.row >= bounds.top &&
    position.row <= bounds.bottom &&
    position.column >= bounds.left &&
    position.column <= bounds.right
  );
}

/** Message when `value` violates `rule`, or null when the value is acceptable. */
export function ruleViolationMessage(rule, value) {
  const text = String(value ?? "");
  if (rule?.type === "number-range") {
    const min = Number(rule.min);
    const max = Number(rule.max);
    const numeric = text.trim() === "" ? Number.NaN : Number(text.trim());
    if (Number.isFinite(numeric) && numeric >= min && numeric <= max) return null;
    return rule.message || NUMBER_RANGE_INVALID_MESSAGE(rule.min, rule.max);
  }
  if (rule?.type === "dropdown") {
    const allowed = (Array.isArray(rule.values) ? rule.values : []).map((entry) => String(entry));
    if (allowed.includes(text)) return null;
    return rule.message || DROPDOWN_INVALID_MESSAGE(allowed);
  }
  return null;
}

/**
 * Message for writing `value` into `address` of `sheet`, or null when no rule rejects it.
 * Empty values are always accepted, like a blank cell in a spreadsheet.
 */
export function validationMessageFor(sheet, address, value) {
  const text = String(value ?? "");
  if (text === "") return null;
  for (const rule of sheet?.validations ?? []) {
    if (!ruleCoversAddress(rule, address)) continue;
    const message = ruleViolationMessage(rule, text);
    if (message) return message;
  }
  return null;
}
