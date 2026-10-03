import { cellCoordinate, parseCoordinate } from "./grid";

/**
 * Formula evaluation for a worksheet's raw cell map.
 *
 * A cell holds the text the user submitted; a leading `=` marks a formula.
 * `evaluateCells` turns the whole map into the text the grid displays, so a
 * formula cell shows its calculated result while its raw text keeps the
 * original expression for the formula bar and the store. Results are computed
 * from the current source values on every call, which keeps directly and
 * indirectly dependent formulas consistent after any edit.
 */

export const DIVIDE_BY_ZERO_ERROR = "#DIV/0!";
export const INVALID_REFERENCE_ERROR = "#REF!";
export const UNKNOWN_FUNCTION_ERROR = "#NAME?";
export const MALFORMED_EXPRESSION_ERROR = "#ERROR!";

/** Safe ceiling for a single range argument (rows x columns). */
const MAX_RANGE_CELLS = 100_000;

const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export function isFormula(raw: string | undefined): boolean {
  return typeof raw === "string" && raw.startsWith("=");
}

/** True when the text is a plain number, so arithmetic can use it. */
export function numericTextValue(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "" || !NUMBER_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Formats a computed number the way the grid should display it. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return DIVIDE_BY_ZERO_ERROR;
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(12)));
}

type ErrorValue = { error: string };
type RangeValue = { range: { startRow: number; startCol: number; endRow: number; endCol: number } };
type Value = number | string | ErrorValue | RangeValue;

function isError(value: Value): value is ErrorValue {
  return typeof value === "object" && value !== null && "error" in value;
}

function isRange(value: Value): value is RangeValue {
  return typeof value === "object" && value !== null && "range" in value;
}

interface Token {
  type: "number" | "string" | "ref" | "name" | "error" | "op" | "lparen" | "rparen" | "comma";
  value?: string;
  number?: number;
}

const REFERENCE_PATTERN = /^\$?([A-Za-z]{1,3})\$?([0-9]{1,7})/;
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*/;
/** A cell whose text is itself an error value, so a reference keeps the error. */
const ERROR_TEXT_PATTERN = /^#[A-Z0-9/]+[!?]$/;
const NUMBER_LITERAL_PATTERN = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;
/** A literal error such as `#REF!`, kept so a broken reference still shows as one. */
const ERROR_LITERAL_PATTERN = /^#[A-Z0-9/]+[!?]/;

function tokenize(body: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  while (index < body.length) {
    const character = body[index];
    if (character === " " || character === "\t") {
      index += 1;
      continue;
    }
    if (character === "(") {
      tokens.push({ type: "lparen" });
      index += 1;
      continue;
    }
    if (character === ")") {
      tokens.push({ type: "rparen" });
      index += 1;
      continue;
    }
    if (character === ",") {
      tokens.push({ type: "comma" });
      index += 1;
      continue;
    }
    if ("+-*/^&".includes(character)) {
      tokens.push({ type: "op", value: character });
      index += 1;
      continue;
    }
    if (character === '"') {
      let text = "";
      let closed = false;
      index += 1;
      while (index < body.length) {
        if (body[index] === '"') {
          if (body[index + 1] === '"') {
            text += '"';
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        text += body[index];
        index += 1;
      }
      if (!closed) return null;
      tokens.push({ type: "string", value: text });
      continue;
    }
    if (character === "#") {
      const error = ERROR_LITERAL_PATTERN.exec(body.slice(index));
      if (!error) return null;
      tokens.push({ type: "error", value: error[0] });
      index += error[0].length;
      continue;
    }
    const number = NUMBER_LITERAL_PATTERN.exec(body.slice(index));
    if (number && !REFERENCE_PATTERN.test(body.slice(index))) {
      tokens.push({ type: "number", number: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const reference = REFERENCE_PATTERN.exec(body.slice(index));
    if (reference) {
      index += reference[0].length;
      if (body[index] === ":" && REFERENCE_PATTERN.test(body.slice(index + 1))) {
        const second = REFERENCE_PATTERN.exec(body.slice(index + 1))!;
        index += 1 + second[0].length;
        tokens.push({ type: "ref", value: `${reference[1]}${reference[2]}:${second[1]}${second[2]}` });
      } else {
        tokens.push({ type: "ref", value: `${reference[1]}${reference[2]}` });
      }
      continue;
    }
    const name = NAME_PATTERN.exec(body.slice(index));
    if (name) {
      tokens.push({ type: "name", value: name[0] });
      index += name[0].length;
      continue;
    }
    return null;
  }
  return tokens;
}

interface EvaluationContext {
  cells: Record<string, string>;
  cache: Map<string, string>;
  visiting: Set<string>;
}

/** Resolves a reference to the referenced cell's displayed text ("" when blank). */
function referenceText(reference: string, context: EvaluationContext): string {
  const coordinate = parseCoordinate(reference.replace(/\$/g, ""));
  if (!coordinate || coordinate.row < 0 || coordinate.col < 0) return INVALID_REFERENCE_ERROR;
  const key = cellCoordinate(coordinate.row, coordinate.col);
  const raw = context.cells[key];
  if (raw === undefined || raw === "") return "";
  if (!isFormula(raw)) return raw;
  if (context.visiting.has(key)) return INVALID_REFERENCE_ERROR;
  if (context.cache.has(key)) return context.cache.get(key)!;
  context.visiting.add(key);
  const value = evaluateBody(raw.slice(1), context);
  context.visiting.delete(key);
  const text = valueToText(value);
  context.cache.set(key, text);
  return text;
}

/** Turns a computed value into the text a cell shows. */
function valueToText(value: Value): string {
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "string") return value;
  if (isError(value)) return value.error;
  return MALFORMED_EXPRESSION_ERROR;
}

/**
 * Resolves a reference used on its own. A blank cell reads as zero, a number as
 * a number, and any other text is passed through as that cell's text, so `=B1`
 * shows `Qty` and a dependent formula keeps following it. A cell holding an
 * error keeps its error. Arithmetic on text still fails in `toNumber`, so
 * `=B1+1` stays an error instead of silently calculating.
 */
function referenceValue(reference: string, context: EvaluationContext): Value {
  const text = referenceText(reference, context);
  if (text === "") return 0;
  const numeric = numericTextValue(text);
  if (numeric !== null) return numeric;
  if (ERROR_TEXT_PATTERN.test(text)) return { error: text };
  return text;
}

function rangeCoordinates(reference: string): RangeValue["range"] | null {
  const [start, end] = reference.split(":");
  const first = parseCoordinate(start);
  const second = parseCoordinate(end);
  if (!first || !second) return null;
  const range = {
    startRow: Math.min(first.row, second.row),
    endRow: Math.max(first.row, second.row),
    startCol: Math.min(first.col, second.col),
    endCol: Math.max(first.col, second.col),
  };
  const size = (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
  return size > 0 && size <= MAX_RANGE_CELLS ? range : null;
}

/** Resolves a single reference or a range as a function argument. */
function rangeNumbers(reference: string, context: EvaluationContext): Value {
  const range = rangeCoordinates(reference);
  if (!range) return { error: INVALID_REFERENCE_ERROR };
  const numbers: number[] = [];
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    for (let col = range.startCol; col <= range.endCol; col += 1) {
      const text = referenceText(cellCoordinate(row, col), context);
      if (text === INVALID_REFERENCE_ERROR) return { error: INVALID_REFERENCE_ERROR };
      const numeric = numericTextValue(text);
      if (numeric !== null) numbers.push(numeric);
    }
  }
  return { range: range, numbers } as RangeValue & { numbers: number[] };
}

const AGGREGATES: Record<string, (numbers: number[]) => Value> = {
  SUM: (numbers) => numbers.reduce((total, value) => total + value, 0),
  AVERAGE: (numbers) =>
    numbers.length === 0
      ? { error: DIVIDE_BY_ZERO_ERROR }
      : numbers.reduce((total, value) => total + value, 0) / numbers.length,
  COUNT: (numbers) => numbers.length,
  MIN: (numbers) => (numbers.length === 0 ? 0 : Math.min(...numbers)),
  MAX: (numbers) => (numbers.length === 0 ? 0 : Math.max(...numbers)),
};

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly context: EvaluationContext,
  ) {}

  parse(): Value {
    const value = this.expression();
    if (this.index !== this.tokens.length) return { error: MALFORMED_EXPRESSION_ERROR };
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private expression(): Value {
    let left = this.term();
    while (true) {
      const token = this.peek();
      if (token?.type !== "op" || (token.value !== "+" && token.value !== "-")) break;
      this.index += 1;
      const right = this.term();
      // The first error is kept, but the rest of the expression is still consumed
      // so the caller reports the error value instead of a parse failure.
      left = isError(left) ? left : applyOperator(token.value, left, right);
    }
    return left;
  }

  private term(): Value {
    let left = this.unary();
    while (true) {
      const token = this.peek();
      if (token?.type !== "op" || (token.value !== "*" && token.value !== "/")) break;
      this.index += 1;
      const right = this.unary();
      left = isError(left) ? left : applyOperator(token.value, left, right);
    }
    return left;
  }

  private unary(): Value {
    const token = this.peek();
    if (token?.type === "op" && (token.value === "-" || token.value === "+")) {
      this.index += 1;
      const value = this.unary();
      if (isError(value)) return value;
      const numeric = toNumber(value);
      if (typeof numeric === "object") return numeric;
      return token.value === "-" ? -numeric : numeric;
    }
    return this.atom();
  }

  private atom(): Value {
    const token = this.peek();
    if (!token) return { error: MALFORMED_EXPRESSION_ERROR };
    if (token.type === "number") {
      this.index += 1;
      return token.number ?? 0;
    }
    if (token.type === "string") {
      this.index += 1;
      return token.value ?? "";
    }
    if (token.type === "ref") {
      this.index += 1;
      const reference = token.value ?? "";
      return reference.includes(":")
        ? rangeNumbers(reference, this.context)
        : referenceValue(reference, this.context);
    }
    if (token.type === "error") {
      this.index += 1;
      return { error: token.value ?? MALFORMED_EXPRESSION_ERROR };
    }
    if (token.type === "name") {
      this.index += 1;
      return this.callFunction(token.value ?? "");
    }
    if (token.type === "lparen") {
      this.index += 1;
      const value = this.expression();
      if (this.peek()?.type !== "rparen") return { error: MALFORMED_EXPRESSION_ERROR };
      this.index += 1;
      return value;
    }
    return { error: MALFORMED_EXPRESSION_ERROR };
  }

  private callFunction(name: string): Value {
    const aggregate = AGGREGATES[name.toUpperCase()];
    if (this.peek()?.type !== "lparen") return { error: MALFORMED_EXPRESSION_ERROR };
    this.index += 1;
    const numbers: number[] = [];
    let argumentError: ErrorValue | null = null;
    let expectingArgument = true;
    while (true) {
      const token = this.peek();
      if (!token) return { error: MALFORMED_EXPRESSION_ERROR };
      if (token.type === "rparen") {
        this.index += 1;
        break;
      }
      if (!expectingArgument) {
        if (token.type !== "comma") return { error: MALFORMED_EXPRESSION_ERROR };
        this.index += 1;
      }
      const value = this.expression();
      if (isError(value)) {
        argumentError = argumentError ?? value;
      } else if (isRange(value)) {
        const collected = (value as RangeValue & { numbers?: number[] }).numbers;
        if (collected) numbers.push(...collected);
      } else if (typeof value === "number") {
        numbers.push(value);
      } else if (typeof value === "string") {
        const parsed = numericTextValue(value);
        if (parsed !== null) numbers.push(parsed);
      }
      expectingArgument = false;
    }
    if (!aggregate) return { error: UNKNOWN_FUNCTION_ERROR };
    if (argumentError) return argumentError;
    return aggregate(numbers);
  }
}

function toNumber(value: Value): number | ErrorValue {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const numeric = numericTextValue(value);
    return numeric ?? { error: MALFORMED_EXPRESSION_ERROR };
  }
  if (isRange(value)) return { error: MALFORMED_EXPRESSION_ERROR };
  return value;
}

function applyOperator(operator: string, left: Value, right: Value): Value {
  const a = toNumber(left);
  if (typeof a === "object") return a;
  const b = toNumber(right);
  if (typeof b === "object") return b;
  switch (operator) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return b === 0 ? { error: DIVIDE_BY_ZERO_ERROR } : a / b;
    default:
      return { error: MALFORMED_EXPRESSION_ERROR };
  }
}

function evaluateBody(body: string, context: EvaluationContext): Value {
  const tokens = tokenize(body);
  if (!tokens || tokens.length === 0) return "";
  return new Parser(tokens, context).parse();
}

/**
 * The text every cell of `cells` displays: ordinary cells keep their raw text,
 * formula cells show the calculated result (or a stable error value).
 */
export function evaluateCells(cells: Record<string, string>): Record<string, string> {
  const cache = new Map<string, string>();
  const visiting = new Set<string>();
  const display: Record<string, string> = {};
  for (const [key, raw] of Object.entries(cells)) {
    if (typeof raw !== "string" || !isFormula(raw)) {
      display[key] = raw;
      continue;
    }
    if (cache.has(key)) {
      display[key] = cache.get(key)!;
      continue;
    }
    const context: EvaluationContext = { cells, cache, visiting };
    visiting.add(key);
    const text = valueToText(evaluateBody(raw.slice(1), context));
    visiting.delete(key);
    cache.set(key, text);
    display[key] = text;
  }
  return display;
}

/** The displayed text of one coordinate inside a raw cell map. */
export function displayValueAt(cells: Record<string, string>, row: number, col: number): string {
  return evaluateCells(cells)[cellCoordinate(row, col)] ?? "";
}
