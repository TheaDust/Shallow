import { columnLabel, parseCellName, type CellRef, type Worksheet } from "./workbook";

/**
 * Formula evaluation for the visible grid (REQ-3-1-1, REQ-4).
 *
 * Supported: numeric constants, parentheses, `+ - * /`, unary sign, A1-style
 * references (relative and `$`-absolute, same worksheet) and the aggregate
 * functions SUM, AVERAGE, COUNT, MIN and MAX over contiguous ranges. Function
 * names are case-insensitive; aggregates use numeric cells only, so blanks and
 * text are ignored and never read as zero. Errors stay isolated per cell: a
 * stored `#REF!`/`#DIV/0!` text (written by a reference adjustment) or an error
 * literal inside a formula propagates, `=1/0` gives `#DIV/0!`, a coordinate such
 * as `A0`, or a cell outside the sheet like `ZZZ99999`, gives `#REF!`, an unknown
 * function gives `#NAME?`, a malformed
 * expression gives `#ERROR!` and a direct/indirect circular reference gives
 * `#REF!`.
 *
 * `worksheet.cells` stays the single authoritative store of what the user
 * entered: ordinary text as typed and formulas as the original `=...`
 * expression. Everything the grid shows for a formula cell is derived here, so
 * committing one source value recalculates every directly and indirectly
 * dependent formula without a second stored value that could drift.
 */
export const VALUE_ERROR = "#VALUE!";
export const NAME_ERROR = "#NAME?";
export const REF_ERROR = "#REF!";
export const DIV_ZERO_ERROR = "#DIV/0!";
export const NUM_ERROR = "#NUM!";
export const PARSE_ERROR = "#ERROR!";

export const SUM_FUNCTIONS = ["SUM", "AVERAGE", "COUNT", "MIN", "MAX"] as const;

interface Region {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

type Token =
  | { type: "number"; value: number }
  | { type: "ref"; ref: CellRef }
  // Cell-shaped text whose coordinate cannot exist (`A0`): an invalid reference.
  | { type: "badref"; name: string }
  // An error marker written in the formula text (`=#REF!+1`, `=SUM(#REF!)`).
  | { type: "error"; error: string }
  | { type: "ident"; name: string }
  | { type: "op"; op: string };

type Operand =
  | { kind: "number"; value: number }
  // A reference kept unresolved so functions can ignore a non-numeric or blank
  // cell while arithmetic still reads a blank as 0.
  | { kind: "cell"; name: string }
  | { kind: "range"; region: Region }
  | { kind: "error"; error: string };

const NUMBER_TEXT = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const ERROR_TEXTS = new Set([VALUE_ERROR, NAME_ERROR, REF_ERROR, DIV_ZERO_ERROR, NUM_ERROR, PARSE_ERROR]);
const TOKEN = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|(\$?[A-Za-z]{1,3}\$?[0-9]+)|([A-Za-z]+)|([+\-*/(),:])|(#(?:DIV\/0!|REF!|NAME\?|VALUE!|NUM!|ERROR!)))/y;

/** True for a stored/derived error marker such as `#REF!` or `#DIV/0!`. */
function isErrorText(text: string): boolean {
  return ERROR_TEXTS.has(text.trim());
}

function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    TOKEN.lastIndex = index;
    const match = TOKEN.exec(text);
    if (!match) {
      if (text.slice(index).trim() === "") return tokens;
      return null;
    }
    index = TOKEN.lastIndex;
    if (match[1] !== undefined) {
      tokens.push({ type: "number", value: Number(match[1]) });
    } else if (match[2] !== undefined) {
      // `$` markers are part of the reference text only; the coordinate itself
      // is the same cell, so `$B$2` reads B2 (REQ-3-2-1 keeps them in formulas).
      const ref = parseCellName(match[2].replace(/\$/g, ""));
      // A name followed by `(` is a function call even when it looks like a
      // coordinate (`LOG10(...)`): that reads as an unsupported function.
      if (text[index] === "(") tokens.push({ type: "ident", name: match[2].toUpperCase() });
      else if (ref) tokens.push({ type: "ref", ref });
      else tokens.push({ type: "badref", name: match[2] });
    } else if (match[3] !== undefined) {
      tokens.push({ type: "ident", name: match[3].toUpperCase() });
    } else if (match[5] !== undefined) {
      tokens.push({ type: "error", error: match[5].toUpperCase() });
    } else {
      tokens.push({ type: "op", op: match[4] });
    }
  }
  return tokens;
}

/**
 * Numeric value of one display text; `null` means "no number" (blank or text),
 * which aggregate functions ignore and arithmetic reports separately.
 */
function numericValue(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!NUMBER_TEXT.test(trimmed)) return null;
  return Number(trimmed);
}

function isInside(ref: CellRef, region: Region): boolean {
  return ref.row >= region.minRow && ref.row <= region.maxRow
    && ref.col >= region.minCol && ref.col <= region.maxCol;
}

/** Formats a computed number the way the grid shows it (no trailing float noise). */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return NUM_ERROR;
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 1e9) / 1e9;
  return String(rounded);
}

/**
 * Evaluation context: the worksheet being read plus a memo of already displayed
 * cells, together with the set of cells currently being evaluated so a circular
 * reference stops instead of recursing forever.
 */
class Evaluator {
  private readonly cache = new Map<string, string>();
  private readonly visiting = new Set<string>();
  private readonly entries: Array<{ name: string; ref: CellRef }> = [];

  constructor(private readonly worksheet: Worksheet) {
    for (const name of Object.keys(worksheet?.cells ?? {})) {
      const ref = parseCellName(name);
      if (ref) this.entries.push({ name, ref });
    }
  }

  display(name: string): string {
    const key = name.toUpperCase();
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const raw = this.worksheet?.cells?.[key] ?? "";
    if (!raw.startsWith("=")) {
      this.cache.set(key, raw);
      return raw;
    }
    if (this.visiting.has(key)) return REF_ERROR;
    this.visiting.add(key);
    const result = this.evaluate(raw.slice(1));
    this.visiting.delete(key);
    const text = result.kind === "error" ? result.error : formatNumber(result.value);
    this.cache.set(key, text);
    return text;
  }

  /**
   * A reference must name a cell this worksheet actually exposes: a coordinate
   * outside `rowCount`/`columnCount` (for example `ZZZ99999`) is an invalid
   * reference that shows `#REF!`, not a blank cell that reads as 0 (REQ-4-2-2).
   */
  private inBounds(ref: CellRef): boolean {
    if (ref.row < 0 || ref.col < 0) return false;
    const rows = this.worksheet?.rowCount;
    const cols = this.worksheet?.columnCount;
    if (Number.isInteger(rows) && (rows as number) > 0 && ref.row >= (rows as number)) return false;
    if (Number.isInteger(cols) && (cols as number) > 0 && ref.col >= (cols as number)) return false;
    return true;
  }

  /**
   * Numeric value of a referenced cell for arithmetic: a blank reads as 0 (so
   * `=B1+5` is 5), text is an error, and a stored error propagates.
   */
  private cellNumber(name: string): number | string {
    const text = this.display(name);
    if (isErrorText(text)) return text;
    if (text.trim() === "") return 0;
    const numeric = numericValue(text);
    return numeric === null ? VALUE_ERROR : numeric;
  }

  /**
   * Every numeric member of a rectangle: empty cells, blanks and text cells are
   * ignored (COUNT counts only numeric cells, SUM/MIN/MAX do not read a blank as
   * zero), while a stored error is propagated to the calling function.
   */
  private numbersIn(region: Region): number[] | string {
    const values: number[] = [];
    for (const entry of this.entries) {
      if (!isInside(entry.ref, region)) continue;
      const text = this.display(entry.name);
      if (isErrorText(text)) return text;
      const numeric = numericValue(text);
      if (numeric !== null) values.push(numeric);
    }
    return values;
  }

  evaluate(text: string): { kind: "number"; value: number } | { kind: "error"; error: string } {
    const tokens = tokenize(text);
    if (!tokens || tokens.length === 0) return { kind: "error", error: PARSE_ERROR };
    let position = 0;
    const peek = () => tokens[position];
    const next = () => tokens[position++];

    const expression = (): Operand => {
      let left = term();
      for (;;) {
        const token = peek();
        if (token?.type !== "op" || (token.op !== "+" && token.op !== "-")) break;
        next();
        const right = term();
        left = combine(left, right, token.op);
      }
      return left;
    };

    const term = (): Operand => {
      let left = unary();
      for (;;) {
        const token = peek();
        if (token?.type !== "op" || (token.op !== "*" && token.op !== "/")) break;
        next();
        const right = unary();
        left = combine(left, right, token.op);
      }
      return left;
    };

    const unary = (): Operand => {
      const token = peek();
      if (token?.type === "op" && (token.op === "-" || token.op === "+")) {
        next();
        const operand = unary();
        if (token.op === "+") return operand;
        const value = asNumber(operand);
        return typeof value === "string" ? { kind: "error", error: value } : { kind: "number", value: -value };
      }
      return primary();
    };

    const primary = (): Operand => {
      const token = next();
      if (!token) return { kind: "error", error: PARSE_ERROR };
      if (token.type === "number") return { kind: "number", value: token.value };
      if (token.type === "error") return { kind: "error", error: token.error };
      if (token.type === "badref") return { kind: "error", error: REF_ERROR };
      if (token.type === "ref") {
        if (!this.inBounds(token.ref)) return { kind: "error", error: REF_ERROR };
        const colon = peek();
        const second = tokens[position + 1];
        if (colon?.type === "op" && colon.op === ":" && second?.type === "ref") {
          next();
          next();
          if (!this.inBounds(second.ref)) return { kind: "error", error: REF_ERROR };
          return {
            kind: "range",
            region: {
              minRow: Math.min(token.ref.row, second.ref.row),
              maxRow: Math.max(token.ref.row, second.ref.row),
              minCol: Math.min(token.ref.col, second.ref.col),
              maxCol: Math.max(token.ref.col, second.ref.col),
            },
          };
        }
        return { kind: "cell", name: cellNameOf(token.ref) };
      }
      if (token.type === "ident") {
        const open = peek();
        if (open?.type !== "op" || open.op !== "(") return { kind: "error", error: NAME_ERROR };
        next();
        const args: Operand[] = [];
        const close = peek();
        if (close?.type === "op" && close.op === ")") next();
        else {
          for (;;) {
            args.push(expression());
            const separator = next();
            if (separator?.type === "op" && separator.op === ")") break;
            if (separator?.type !== "op" || separator.op !== ",") return { kind: "error", error: PARSE_ERROR };
          }
        }
        return call(token.name, args);
      }
      if (token.type === "op" && token.op === "(") {
        const inner = expression();
        const close = next();
        if (close?.type !== "op" || close.op !== ")") return { kind: "error", error: PARSE_ERROR };
        return inner;
      }
      return { kind: "error", error: PARSE_ERROR };
    };

    const combine = (left: Operand, right: Operand, op: string): Operand => {
      const leftValue = asNumber(left);
      const rightValue = asNumber(right);
      if (typeof leftValue === "string") return { kind: "error", error: leftValue };
      if (typeof rightValue === "string") return { kind: "error", error: rightValue };
      if (op === "/" && rightValue === 0) return { kind: "error", error: DIV_ZERO_ERROR };
      const value = op === "+" ? leftValue + rightValue
        : op === "-" ? leftValue - rightValue
          : op === "*" ? leftValue * rightValue
            : leftValue / rightValue;
      return Number.isFinite(value) ? { kind: "number", value } : { kind: "error", error: NUM_ERROR };
    };

    const asNumber = (operand: Operand): number | string => {
      if (operand.kind === "number") return operand.value;
      if (operand.kind === "error") return operand.error;
      if (operand.kind === "cell") return this.cellNumber(operand.name);
      // A range cannot stand in for one value inside arithmetic.
      return VALUE_ERROR;
    };

    const call = (name: string, args: Operand[]): Operand => {
      const failure = args.find((argument): argument is { kind: "error"; error: string } => argument.kind === "error");
      if (failure) return failure;
      const numbers: number[] = [];
      for (const argument of args) {
        if (argument.kind === "range") {
          const members = this.numbersIn(argument.region);
          if (typeof members === "string") return { kind: "error", error: members };
          numbers.push(...members);
        } else if (argument.kind === "number") {
          numbers.push(argument.value);
        } else if (argument.kind === "cell") {
          // `=SUM(A1)` over a blank or text cell contributes nothing (only
          // numeric cells are used), unlike `=A1+1` where a blank reads as 0.
          const text = this.display(argument.name);
          if (isErrorText(text)) return { kind: "error", error: text };
          const numeric = numericValue(text);
          if (numeric !== null) numbers.push(numeric);
        }
      }
      const sum = numbers.reduce((total, value) => total + value, 0);
      switch (name) {
        case "SUM":
          return { kind: "number", value: sum };
        case "COUNT":
          return { kind: "number", value: numbers.length };
        case "AVERAGE":
          return numbers.length === 0
            ? { kind: "error", error: DIV_ZERO_ERROR }
            : { kind: "number", value: sum / numbers.length };
        case "MIN":
          return { kind: "number", value: numbers.length === 0 ? 0 : Math.min(...numbers) };
        case "MAX":
          return { kind: "number", value: numbers.length === 0 ? 0 : Math.max(...numbers) };
        default:
          return { kind: "error", error: NAME_ERROR };
      }
    };

    const result = expression();
    if (position !== tokens.length) return { kind: "error", error: PARSE_ERROR };
    if (result.kind === "range" || result.kind === "cell") {
      const value = asNumber(result);
      return typeof value === "string" ? { kind: "error", error: value } : { kind: "number", value };
    }
    return result;
  }
}

function cellNameOf(ref: CellRef): string {
  return `${columnLabel(ref.col)}${ref.row + 1}`;
}

/** Grid text of one cell: the typed value, or the calculated formula result. */
export function cellDisplayText(worksheet: Worksheet, name: string): string {
  return new Evaluator(worksheet).display(name);
}

/** Grid text of every stored cell; cells missing from the map display as empty. */
export function displayValues(worksheet: Worksheet): Record<string, string> {
  const evaluator = new Evaluator(worksheet);
  const values: Record<string, string> = {};
  for (const name of Object.keys(worksheet?.cells ?? {})) {
    values[name] = evaluator.display(name);
  }
  return values;
}
