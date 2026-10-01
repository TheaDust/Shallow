import { cellCoordinate, isCellCoordinate, parseCellCoordinate } from "./spreadsheet";

/**
 * Formula evaluation for the worksheet grid.
 *
 * A worksheet keeps the raw input of every cell, so a formula cell stores the expression the user
 * submitted (`=B2*2`). The grid displays the *result* of that expression, while the formula bar,
 * the clipboard and the CSV export keep reading the raw text. Results are derived from the
 * persisted cell map on every render, which keeps grid and formula bar consistent for the same
 * cell, updates directly and indirectly dependent formulas as soon as a source value changes, and
 * reproduces the same results after a refresh without storing a second copy of the state.
 *
 * Supported (REQ-4-1-1 / REQ-4-2-2): numeric literals, string literals, TRUE/FALSE, parentheses,
 * unary and binary `+ - * /`, A1 references of the current worksheet, ranges inside the aggregate
 * functions SUM, AVERAGE, COUNT, MIN and MAX (case-insensitive), and the stable error values
 * `#DIV/0!`, `#REF!`, `#NAME?`, `#VALUE!` and `#ERROR!`. Cross-worksheet references are not
 * required and evaluate to `#REF!`, the same as a reference-shaped word that names no cell.
 */

export const DIVISION_BY_ZERO = "#DIV/0!";
export const INVALID_REFERENCE = "#REF!";
export const UNKNOWN_FUNCTION = "#NAME?";
export const INVALID_VALUE = "#VALUE!";
export const MALFORMED_FORMULA = "#ERROR!";

const ERROR_LITERALS: ReadonlyArray<string> = [
  DIVISION_BY_ZERO,
  INVALID_REFERENCE,
  UNKNOWN_FUNCTION,
  INVALID_VALUE,
  MALFORMED_FORMULA,
  "#N/A",
  "#NUM!",
];

const NUMBER_LITERAL = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const REFERENCE_SHAPE = /^\$?[A-Za-z]{1,3}\$?[1-9][0-9]*$/;
/** Letters directly followed by digits: a reference *shape*, whether or not it exists (`A0`, `AAAA1`). */
const REFERENCE_LIKE = /^\$?[A-Za-z]+\$?[0-9]+$/;

interface FormulaError {
  readonly error: string;
}

/** A resolved cell value; `null` is a blank cell. */
type Value = number | string | boolean | null | FormulaError;

function isError(value: Value): value is FormulaError {
  return typeof value === "object" && value !== null;
}

function error(code: string): FormulaError {
  return { error: code };
}

class FormulaSyntaxError extends Error {}

/* -------------------------------------------------------------------------- tokenizer */

type TokenType = "number" | "string" | "reference" | "identifier" | "external" | "error" | "operator" | "punctuation";

interface Token {
  type: TokenType;
  value: string;
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      index += 1;
      continue;
    }
    if (char === "(" || char === ")" || char === "," || char === ":") {
      tokens.push({ type: "punctuation", value: char });
      index += 1;
      continue;
    }
    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    if (char === '"') {
      let end = index + 1;
      let text = "";
      let closed = false;
      while (end < input.length) {
        if (input[end] === '"') {
          if (input[end + 1] === '"') {
            text += '"';
            end += 2;
            continue;
          }
          closed = true;
          end += 1;
          break;
        }
        text += input[end];
        end += 1;
      }
      if (!closed) throw new FormulaSyntaxError("Unterminated string literal");
      tokens.push({ type: "string", value: text });
      index = end;
      continue;
    }
    if (char === "#") {
      const match = /^#(REF!|DIV\/0!|NAME\?|VALUE!|ERROR!|N\/A|NUM!)/i.exec(input.slice(index));
      if (!match) throw new FormulaSyntaxError("Unknown error literal");
      tokens.push({ type: "error", value: match[0].toUpperCase() });
      index += match[0].length;
      continue;
    }
    if (isDigit(char) || (char === "." && isDigit(input[index + 1]))) {
      const match = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(input.slice(index));
      if (!match) throw new FormulaSyntaxError("Malformed number");
      tokens.push({ type: "number", value: match[0] });
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z_$']/.test(char)) {
      index = readWordToken(input, index, tokens);
      continue;
    }
    throw new FormulaSyntaxError(`Unexpected character ${char}`);
  }

  return tokens;
}

/** Reads a reference, a function name, a boolean word or a `Sheet!A1` prefix at `start`. */
function readWordToken(input: string, start: number, tokens: Token[]): number {
  let index = start;
  let sheetName = "";

  if (input[index] === "'") {
    index += 1;
    let closed = false;
    while (index < input.length) {
      if (input[index] === "'") {
        if (input[index + 1] === "'") {
          sheetName += "'";
          index += 2;
          continue;
        }
        closed = true;
        index += 1;
        break;
      }
      sheetName += input[index];
      index += 1;
    }
    if (!closed || input[index] !== "!") throw new FormulaSyntaxError("Malformed sheet reference");
    index += 1;
  } else {
    const name = /^[A-Za-z_$][A-Za-z0-9_.$]*/.exec(input.slice(index))![0];
    if (input[index + name.length] !== "!") {
      return readPlainWord(input, index, name, tokens);
    }
    sheetName = name;
    index += name.length + 1;
  }

  const reference = /^\$?[A-Za-z]{1,3}\$?[1-9][0-9]*/.exec(input.slice(index));
  if (!reference || !sheetName) throw new FormulaSyntaxError("Malformed sheet reference");
  const end = index + reference[0].length;
  tokens.push({ type: "external", value: input.slice(start, end) });
  return end;
}

/**
 * A word is a function name (followed by `(`), a cell reference, or a TRUE/FALSE literal. A word
 * shaped like a reference that names no cell of the worksheet (`A0`, `AAAA1`) is an invalid
 * reference and evaluates to `#REF!`; any other bare word is an unknown name (`#NAME?`).
 */
function readPlainWord(input: string, start: number, word: string, tokens: Token[]): number {
  const end = start + word.length;
  if (input[end] === "(") {
    tokens.push({ type: "identifier", value: word });
    return end;
  }
  const bare = word.replace(/\$/g, "").toUpperCase();
  if (REFERENCE_SHAPE.test(word) && isCellCoordinate(bare)) {
    tokens.push({ type: "reference", value: bare });
    return end;
  }
  if (REFERENCE_LIKE.test(word)) {
    tokens.push({ type: "error", value: INVALID_REFERENCE });
    return end;
  }
  tokens.push({ type: "identifier", value: word });
  return end;
}

/* -------------------------------------------------------------------------- parser */

type Node =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "error"; value: string }
  | { kind: "external" }
  | { kind: "reference"; coordinate: string }
  | { kind: "range"; start: string; end: string }
  | { kind: "unary"; operator: "+" | "-"; operand: Node }
  | { kind: "binary"; operator: "+" | "-" | "*" | "/"; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] };

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    if (!this.tokens.length) throw new FormulaSyntaxError("Empty formula");
    const node = this.parseExpression();
    if (this.index < this.tokens.length) throw new FormulaSyntaxError("Unexpected trailing input");
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private next(): Token {
    const token = this.tokens[this.index];
    if (!token) throw new FormulaSyntaxError("Unexpected end of formula");
    this.index += 1;
    return token;
  }

  private isPunctuation(value: string): boolean {
    const token = this.peek();
    return token?.type === "punctuation" && token.value === value;
  }

  private parseExpression(): Node {
    let left = this.parseMultiplicative();
    while (this.peek()?.type === "operator" && (this.peek()!.value === "+" || this.peek()!.value === "-")) {
      const operator = this.next().value as "+" | "-";
      left = { kind: "binary", operator, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): Node {
    let left = this.parseUnary();
    while (this.peek()?.type === "operator" && (this.peek()!.value === "*" || this.peek()!.value === "/")) {
      const operator = this.next().value as "*" | "/";
      left = { kind: "binary", operator, left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): Node {
    const token = this.peek();
    if (token?.type === "operator" && (token.value === "-" || token.value === "+")) {
      this.next();
      return { kind: "unary", operator: token.value as "+" | "-", operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parseReferenceOrRange(coordinate: string): Node {
    if (!this.isPunctuation(":")) return { kind: "reference", coordinate };
    this.next();
    const end = this.next();
    if (end.type !== "reference") throw new FormulaSyntaxError("Malformed range");
    return { kind: "range", start: coordinate, end: end.value };
  }

  private parsePrimary(): Node {
    const token = this.next();
    switch (token.type) {
      case "number":
        return { kind: "number", value: Number(token.value) };
      case "string":
        return { kind: "string", value: token.value };
      case "error":
        return { kind: "error", value: token.value };
      case "external":
        return { kind: "external" };
      case "reference":
        return this.parseReferenceOrRange(token.value);
      case "identifier": {
        const name = token.value.toUpperCase();
        if (name === "TRUE") return { kind: "boolean", value: true };
        if (name === "FALSE") return { kind: "boolean", value: false };
        // A bare name that is not a function call has no value: an unsupported name is `#NAME?`.
        if (!this.isPunctuation("(")) return { kind: "error", value: UNKNOWN_FUNCTION };
        this.next();
        const args: Node[] = [];
        if (!this.isPunctuation(")")) {
          args.push(this.parseExpression());
          while (this.isPunctuation(",")) {
            this.next();
            args.push(this.parseExpression());
          }
        }
        if (!this.isPunctuation(")")) throw new FormulaSyntaxError("Unbalanced parenthesis");
        this.next();
        return { kind: "call", name, args };
      }
      case "punctuation": {
        if (token.value !== "(") throw new FormulaSyntaxError("Unexpected token");
        const inner = this.parseExpression();
        if (!this.isPunctuation(")")) throw new FormulaSyntaxError("Unbalanced parenthesis");
        this.next();
        return inner;
      }
      default:
        throw new FormulaSyntaxError("Unexpected token");
    }
  }
}

/* -------------------------------------------------------------------------- evaluation */

/** Values read by one aggregate argument: a range expands to every cell it covers. */
type ArgumentValues = Value[];

class Evaluator {
  private readonly memo = new Map<string, Value>();
  private readonly pending = new Set<string>();

  constructor(private readonly cells: Record<string, string>) {}

  /** Resolves one cell: a blank cell, an ordinary literal, or the result of its formula. */
  cell(coordinate: string): Value {
    const cached = this.memo.get(coordinate);
    if (cached !== undefined) return cached;
    // A direct or indirect circular reference resolves to `#REF!` instead of recursing forever.
    if (this.pending.has(coordinate)) return error(INVALID_REFERENCE);
    const raw = this.cells[coordinate];
    if (raw === undefined || raw === "") return null;
    if (!raw.startsWith("=")) return literalValue(raw);

    this.pending.add(coordinate);
    let value: Value;
    try {
      value = this.evaluate(raw);
    } finally {
      this.pending.delete(coordinate);
    }
    this.memo.set(coordinate, value);
    return value;
  }

  evaluate(formula: string): Value {
    try {
      return this.node(new Parser(tokenize(formula.slice(1))).parse());
    } catch (failure) {
      if (failure instanceof FormulaSyntaxError) return error(MALFORMED_FORMULA);
      throw failure;
    }
  }

  private node(node: Node): Value {
    switch (node.kind) {
      case "number":
        return node.value;
      case "string":
        return node.value;
      case "boolean":
        return node.value;
      case "error":
        return error(node.value);
      case "external":
        return error(INVALID_REFERENCE);
      case "reference":
        return this.cell(node.coordinate);
      case "range":
        // A rectangle has no single value outside a function argument.
        return error(INVALID_VALUE);
      case "unary": {
        const operand = toNumber(this.node(node.operand));
        if (isError(operand)) return operand;
        return node.operator === "-" ? -operand : operand;
      }
      case "binary": {
        const left = toNumber(this.node(node.left));
        if (isError(left)) return left;
        const right = toNumber(this.node(node.right));
        if (isError(right)) return right;
        switch (node.operator) {
          case "+": return left + right;
          case "-": return left - right;
          case "*": return left * right;
          default:
            return right === 0 ? error(DIVISION_BY_ZERO) : left / right;
        }
      }
      case "call":
        return this.call(node);
      default:
        return error(MALFORMED_FORMULA);
    }
  }

  /** Every value one function argument reads, in rectangle order. */
  private argumentValues(node: Node): ArgumentValues {
    if (node.kind !== "range") return [this.node(node)];
    const start = parseCellCoordinate(node.start);
    const end = parseCellCoordinate(node.end);
    if (!start || !end) return [error(INVALID_REFERENCE)];
    const values: ArgumentValues = [];
    for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
      for (let column = Math.min(start.column, end.column); column <= Math.max(start.column, end.column); column += 1) {
        values.push(this.cell(cellCoordinate(row, column)));
      }
    }
    return values;
  }

  private call(node: { kind: "call"; name: string; args: Node[] }): Value {
    const values = node.args.flatMap((argument) => this.argumentValues(argument));
    for (const value of values) {
      // `COUNT` never propagates errors of unrelated cells; the other aggregates do.
      if (isError(value) && node.name !== "COUNT") return value;
    }
    const numbers = values.filter((value): value is number => typeof value === "number");
    switch (node.name) {
      case "SUM":
        return numbers.reduce((total, value) => total + value, 0);
      case "COUNT":
        return numbers.length;
      case "AVERAGE":
        return numbers.length
          ? numbers.reduce((total, value) => total + value, 0) / numbers.length
          : error(DIVISION_BY_ZERO);
      case "MIN":
        return numbers.length ? Math.min(...numbers) : 0;
      case "MAX":
        return numbers.length ? Math.max(...numbers) : 0;
      default:
        return error(UNKNOWN_FUNCTION);
    }
  }
}

/** An ordinary (non-formula) cell read as a value: number, boolean, error literal or text. */
function literalValue(raw: string): Value {
  const trimmed = raw.trim();
  if (NUMBER_LITERAL.test(trimmed)) return Number(trimmed);
  const upper = trimmed.toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  const known = ERROR_LITERALS.find((code) => code === upper);
  if (known) return error(known);
  return raw;
}

/** Coercion used by the arithmetic operators; text that is not a number is `#VALUE!`. */
function toNumber(value: Value): number | FormulaError {
  if (isError(value)) return value;
  if (value === null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const trimmed = value.trim();
  if (NUMBER_LITERAL.test(trimmed)) return Number(trimmed);
  return error(INVALID_VALUE);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return DIVISION_BY_ZERO;
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(12)));
}

/** Text the grid shows for a computed formula value. */
export function formulaResultText(value: number | string | boolean | null | { error: string }): string {
  if (value === null || value === undefined) return "0";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return value;
  return value.error;
}

/**
 * Display text of every formula cell of one worksheet, keyed by coordinate. Plain cells are absent
 * (they display their own raw text), so callers fall back to the stored cell value.
 */
export function worksheetResults(cells: Record<string, string>): Record<string, string> {
  const evaluator = new Evaluator(cells);
  const results: Record<string, string> = {};
  for (const [coordinate, raw] of Object.entries(cells)) {
    if (!raw.startsWith("=")) continue;
    results[coordinate] = formulaResultText(evaluator.cell(coordinate));
  }
  return results;
}

/** The grid shows the result of a formula cell and the raw text of every other cell. */
export function cellDisplayText(raw: string | undefined, result: string | undefined): string {
  return result ?? raw ?? "";
}

/** Evaluates one formula against a cell map; used by the tests and by dependent features. */
export function evaluateFormula(formula: string, cells: Record<string, string> = {}): string {
  return formulaResultText(new Evaluator(cells).evaluate(formula));
}
