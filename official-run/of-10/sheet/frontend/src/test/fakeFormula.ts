import { columnLabelToIndex, makeCellId } from "../lib/cells";
import type { CellData } from "../workbooks/types";

/**
 * Small mirror of the server formula engine (`backend/src/lib/formula.mjs`) for the subset the
 * visible editing tests need (REQ-4-1-1 / REQ-4-2-2): numeric constants, parentheses, `+ - * /`,
 * A1-style references, `A1:B2` ranges and SUM, AVERAGE, COUNT, MIN, MAX. The fake server uses it to
 * fill the `display` of the cells it writes, so a grid test observes the same calculated result the
 * real server returns, and the documented error values `#DIV/0!`, `#REF!`, `#NAME?` and `#ERROR!`.
 */

/** Sheet limits of the fake engine, mirroring `backend/src/lib/cells.mjs`. */
export const MAX_ROW_INDEX = 1_048_576;
export const MAX_COLUMN_INDEX = 16_384;
const NUMBER_LITERAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const TOKEN_ERROR_LITERAL = /^#(?:REF!|DIV\/0!|NAME\?|ERROR!|VALUE!)/;
const TOKEN_NUMBER = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/;
const TOKEN_REF = /^\$?([A-Za-z]{1,3})\$?([1-9][0-9]{0,6})(?![A-Za-z0-9_])/;
const TOKEN_NAME = /^[A-Za-z_][A-Za-z0-9_.]*/;
const FUNCTIONS = ["SUM", "AVERAGE", "COUNT", "MIN", "MAX"];

/** A formula error: the grid shows `code` and the formula bar keeps the submitted expression. */
export class FormulaError {
  constructor(readonly code: string) {}
}

interface CellAddress {
  row: number;
  column: number;
}

interface CellRange {
  start: CellAddress;
  end: CellAddress;
}

type CellValue = number | string | boolean | FormulaError | null;
type ParsedValue = CellValue | CellRange;

type Token =
  | { kind: "number"; value: number }
  | { kind: "ref"; column: string; row: number }
  | { kind: "name"; value: string }
  | { kind: "error"; value: string }
  | { kind: "operator"; value: string };

function isFormulaText(text: string): boolean {
  return text.length > 1 && text.startsWith("=");
}

/** Value of a plain cell, like the server: numeric looking text is a number, TRUE/FALSE a boolean. */
function parseLiteral(text: string): CellValue {
  const trimmed = text.trim();
  if (trimmed !== "" && NUMBER_LITERAL.test(trimmed)) return Number(trimmed);
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;
  return text;
}

function formatNumber(value: number): string {
  return String(Number(value.toPrecision(12)));
}

function formatValue(value: CellValue): string {
  if (value instanceof FormulaError) return value.code;
  if (value === null) return "0";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    const error = TOKEN_ERROR_LITERAL.exec(rest);
    if (error) {
      tokens.push({ kind: "error", value: error[0] });
      index += error[0].length;
      continue;
    }
    const number = TOKEN_NUMBER.exec(rest);
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const ref = TOKEN_REF.exec(rest);
    if (ref) {
      tokens.push({ kind: "ref", column: ref[1], row: Number(ref[2]) });
      index += ref[0].length;
      continue;
    }
    const name = TOKEN_NAME.exec(rest);
    if (name) {
      tokens.push({ kind: "name", value: name[0] });
      index += name[0].length;
      continue;
    }
    if ("+-*/^(),:".includes(character)) {
      tokens.push({ kind: "operator", value: character });
      index += 1;
      continue;
    }
    throw new Error(`Unexpected character ${character}`);
  }
  return tokens;
}

function toNumber(value: ParsedValue): number | FormulaError {
  if (value instanceof FormulaError) return value;
  if (value === null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return 0;
    if (NUMBER_LITERAL.test(trimmed)) return Number(trimmed);
  }
  return new FormulaError("#VALUE!");
}

function arithmetic(operator: string, left: ParsedValue, right: ParsedValue): CellValue {
  if (left instanceof FormulaError) return left;
  if (right instanceof FormulaError) return right;
  const a = toNumber(left);
  const b = toNumber(right);
  if (a instanceof FormulaError) return a;
  if (b instanceof FormulaError) return b;
  if (operator === "+") return a + b;
  if (operator === "-") return a - b;
  if (operator === "*") return a * b;
  return b === 0 ? new FormulaError("#DIV/0!") : a / b;
}

/** Flattens the arguments of an aggregate; an empty cell stays empty and is never a zero. */
function collect(args: ParsedValue[], readCell: (cellId: string) => CellValue): CellValue[] {
  const values: CellValue[] = [];
  for (const argument of args) {
    if (argument && typeof argument === "object" && "start" in argument) {
      for (let row = argument.start.row; row <= argument.end.row; row += 1) {
        for (let column = argument.start.column; column <= argument.end.column; column += 1) {
          values.push(readCell(makeCellId(row, column)));
        }
      }
      continue;
    }
    values.push(argument);
  }
  return values;
}

function callFunction(name: string, args: ParsedValue[], readCell: (cellId: string) => CellValue): CellValue {
  const upper = name.toUpperCase();
  if (!FUNCTIONS.includes(upper)) return new FormulaError("#NAME?");
  const values = collect(args, readCell);
  const error = values.find((value) => value instanceof FormulaError);
  if (error) return error;
  const numbers = values.filter((value): value is number => typeof value === "number");
  if (upper === "COUNT") return numbers.length;
  if (numbers.length === 0) return upper === "AVERAGE" ? new FormulaError("#DIV/0!") : 0;
  const total = numbers.reduce((sum, value) => sum + value, 0);
  if (upper === "SUM") return total;
  if (upper === "AVERAGE") return total / numbers.length;
  return upper === "MIN" ? Math.min(...numbers) : Math.max(...numbers);
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly readCell: (cellId: string) => CellValue,
  ) {}

  parse(): ParsedValue {
    const value = this.additive();
    if (this.index !== this.tokens.length) throw new Error("Unexpected trailing input");
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private matchOperator(value: string): boolean {
    const token = this.peek();
    if (token && token.kind === "operator" && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private additive(): ParsedValue {
    let left = this.multiplicative();
    for (;;) {
      const token = this.peek();
      if (!token || token.kind !== "operator" || (token.value !== "+" && token.value !== "-")) return left;
      this.index += 1;
      left = arithmetic(token.value, left, this.multiplicative());
    }
  }

  private multiplicative(): ParsedValue {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (!token || token.kind !== "operator" || (token.value !== "*" && token.value !== "/")) return left;
      this.index += 1;
      left = arithmetic(token.value, left, this.unary());
    }
  }

  private unary(): ParsedValue {
    if (this.matchOperator("-")) {
      const value = toNumber(this.unary());
      return value instanceof FormulaError ? value : -value;
    }
    if (this.matchOperator("+")) return toNumber(this.unary());
    return this.primary();
  }

  private primary(): ParsedValue {
    const token = this.tokens[this.index];
    this.index += 1;
    if (!token) throw new Error("Unexpected end of formula");
    if (token.kind === "number") return token.value;
    if (token.kind === "error") return new FormulaError(token.value);
    if (token.kind === "ref") return this.reference(token);
    if (token.kind === "name") return this.call(token.value);
    if (token.kind === "operator" && token.value === "(") {
      const value = this.additive();
      if (!this.matchOperator(")")) throw new Error("Expected )");
      return value;
    }
    throw new Error("Unexpected token");
  }

  private call(name: string): CellValue {
    if (!this.matchOperator("(")) throw new Error(`Unknown name ${name}`);
    const args: ParsedValue[] = [];
    const next = this.peek();
    if (!next || next.kind !== "operator" || next.value !== ")") {
      args.push(this.additive());
      while (this.matchOperator(",")) args.push(this.additive());
    }
    if (!this.matchOperator(")")) throw new Error("Expected )");
    return callFunction(name, args, this.readCell);
  }

  private reference(token: { column: string; row: number }): ParsedValue {
    const column = columnLabelToIndex(token.column);
    const start = this.addressOf({ row: token.row, column });
    if (!start) return new FormulaError("#REF!");
    if (!this.matchOperator(":")) return this.readCell(makeCellId(start.row, start.column));
    const endToken = this.tokens[this.index];
    this.index += 1;
    if (!endToken || endToken.kind !== "ref") return new FormulaError("#REF!");
    const end = this.addressOf({ row: endToken.row, column: columnLabelToIndex(endToken.column) });
    if (!end) return new FormulaError("#REF!");
    return {
      start: { row: Math.min(start.row, end.row), column: Math.min(start.column, end.column) },
      end: { row: Math.max(start.row, end.row), column: Math.max(start.column, end.column) },
    };
  }

  private addressOf(address: CellAddress): CellAddress | null {
    if (address.row > MAX_ROW_INDEX || address.column > MAX_COLUMN_INDEX) return null;
    if (address.row < 1 || address.column < 1) return null;
    return address;
  }
}

function evaluateFormula(source: string, readCell: (cellId: string) => CellValue): CellValue {
  try {
    const tokens = tokenize(source);
    if (tokens.length === 0) return new FormulaError("#ERROR!");
    const value = new Parser(tokens, readCell).parse();
    if (value && typeof value === "object" && "start" in value) return new FormulaError("#VALUE!");
    return value;
  } catch {
    return new FormulaError("#ERROR!");
  }
}

/**
 * Recalculates the cells of one worksheet like the server does: every cell keeps its submitted
 * `value` and gains the `display` the grid shows. A cell that takes part in a circular reference
 * displays #REF!.
 */
export function computeFakeDisplays(cells: Record<string, CellData>): Record<string, CellData> {
  const entries: { cellId: string; key: string; text: string }[] = [];
  for (const [cellId, cell] of Object.entries(cells ?? {})) {
    const text = cell?.value;
    if (typeof text === "string" && text !== "") entries.push({ cellId, key: cellId.toUpperCase(), text });
  }

  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const memo = new Map<string, CellValue>();
  const visiting = new Set<string>();
  const readCell = (cellId: string): CellValue => {
    const key = cellId.toUpperCase();
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const entry = byKey.get(key);
    if (!entry) return null;
    if (isFormulaText(entry.text)) {
      if (visiting.has(key)) return new FormulaError("#REF!");
      visiting.add(key);
      const value = evaluateFormula(entry.text.slice(1), readCell);
      visiting.delete(key);
      memo.set(key, value);
      return value;
    }
    const value = parseLiteral(entry.text);
    memo.set(key, value);
    return value;
  };

  const next: Record<string, CellData> = {};
  for (const entry of entries) {
    next[entry.cellId] = isFormulaText(entry.text)
      ? { value: entry.text, display: formatValue(readCell(entry.cellId)) }
      : { value: entry.text, display: entry.text };
  }
  return next;
}
