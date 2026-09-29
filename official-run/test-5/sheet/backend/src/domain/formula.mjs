/**
 * Spreadsheet formula engine shared by every read path of a worksheet.
 *
 * `worksheet.cells` keeps the raw text the user typed (a formula is stored as
 * the plain string beginning with `=`); `worksheetValues` derives the displayed
 * value of every non-empty cell from it, so the grid, formula dependencies and
 * the CSV export all read the same result. Evaluation is memoised per worksheet
 * and circular references resolve to `#REF!`, which keeps any write a single
 * pass over the stored data.
 */

import { cellAddress, parseCellAddress } from "./coordinates.mjs";
import { GRID_COLUMN_COUNT, GRID_ROW_COUNT } from "./structure.mjs";

export const FORMULA_ERROR = "#ERROR!";
export const DIVIDE_BY_ZERO_ERROR = "#DIV/0!";
export const VALUE_ERROR = "#VALUE!";
export const NAME_ERROR = "#NAME?";
export const REF_ERROR = "#REF!";

export const AGGREGATE_FUNCTIONS = Object.freeze(["SUM", "AVERAGE", "COUNT", "MIN", "MAX"]);

/**
 * Error codes a formula may carry as a literal. A reference that a copy or a
 * structure change could not preserve is stored as `#REF!` inside the formula
 * text (REQ-4-1-2, REQ-2-2-1/2-2-2), so the engine reads such a literal back
 * and propagates it like any other error value.
 */
export const ERROR_CODES = Object.freeze([
  REF_ERROR,
  DIVIDE_BY_ZERO_ERROR,
  VALUE_ERROR,
  NAME_ERROR,
  FORMULA_ERROR,
]);

const NUMBER_PATTERN = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const TOKEN_PATTERN = /^(?:\s+)|^(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|^("(?:[^"]|"")*")|^(\$?[A-Za-z]{1,3}\$?\d{1,7})|^([A-Za-z_][A-Za-z0-9_.]*)|^([+\-*/^(),:])|^(#[A-Za-z0-9/]*[!?])/;

export function isFormula(text) {
  return typeof text === "string" && text.startsWith("=");
}

class FormulaError extends Error {
  constructor(code) {
    super(code);
    this.name = "FormulaError";
    this.code = code;
  }
}

/** Rounds away binary-floating-point noise so `0.1+0.2` displays as `0.3`. */
export function formatNumber(value) {
  if (!Number.isFinite(value)) return VALUE_ERROR;
  const rounded = Math.round(value * 1e10) / 1e10;
  return String(rounded === 0 ? 0 : rounded);
}

const EMPTY_VALUE = Object.freeze({ type: "empty" });

function numberValue(value) {
  return { type: "number", value };
}

function textValue(value) {
  return { type: "text", value };
}

function errorValue(code) {
  return { type: "error", value: code };
}

function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const match = TOKEN_PATTERN.exec(source.slice(index));
    if (!match) throw new FormulaError(FORMULA_ERROR);
    index += match[0].length;
    if (typeof match[1] === "string") tokens.push({ type: "number", value: Number(match[1]) });
    else if (typeof match[2] === "string") {
      tokens.push({ type: "string", value: match[2].slice(1, -1).replace(/""/g, '"') });
    } else if (typeof match[3] === "string") {
      tokens.push({ type: "ref", value: match[3].replace(/\$/g, "").toUpperCase() });
    } else if (typeof match[4] === "string") tokens.push({ type: "name", value: match[4] });
    else if (typeof match[5] === "string") tokens.push({ type: "op", value: match[5] });
    else if (typeof match[6] === "string") {
      const code = match[6].toUpperCase();
      // Anything else spelled like an error code is just malformed text.
      if (!ERROR_CODES.includes(code)) throw new FormulaError(FORMULA_ERROR);
      tokens.push({ type: "error", value: code });
    }
    // Whitespace-only matches push nothing.
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}

function parseFormula(body) {
  const tokens = tokenize(body);
  const state = { tokens, index: 0 };

  const peek = () => state.tokens[state.index];
  const next = () => state.tokens[state.index++];
  const eat = (value) => {
    const token = peek();
    if ((token.type === "op" || token.type === "eof") && token.value === value) {
      state.index += 1;
      return true;
    }
    return false;
  };
  const expect = (value) => {
    if (!eat(value)) throw new FormulaError(FORMULA_ERROR);
  };

  function parsePrimary() {
    const token = next();
    if (token.type === "number") return { kind: "number", value: token.value };
    if (token.type === "string") return { kind: "text", value: token.value };
    if (token.type === "ref") return { kind: "ref", address: token.value };
    if (token.type === "error") return { kind: "error", code: token.value };
    if (token.type === "name") {
      if (peek().type === "op" && peek().value === "(") {
        next();
        const args = [];
        if (!eat(")")) {
          for (;;) {
            args.push(parseArgument());
            if (eat(",")) continue;
            expect(")");
            break;
          }
        }
        return { kind: "call", name: token.value.toUpperCase(), args };
      }
      const upper = token.value.toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") return { kind: "text", value: upper };
      throw new FormulaError(NAME_ERROR);
    }
    if (token.type === "op" && token.value === "(") {
      const inner = parseExpression();
      expect(")");
      return inner;
    }
    throw new FormulaError(FORMULA_ERROR);
  }

  /** A function argument is an expression or one `first:last` rectangular range. */
  function parseArgument() {
    const first = parseExpression();
    if (first.kind === "ref" && eat(":")) {
      const token = next();
      if (token.type !== "ref") throw new FormulaError(FORMULA_ERROR);
      return { kind: "range", start: first.address, end: token.value };
    }
    return first;
  }

  function parseUnary() {
    const token = peek();
    if (token.type === "op" && (token.value === "-" || token.value === "+")) {
      next();
      const operand = parseUnary();
      return token.value === "-" ? { kind: "unary", op: "-", operand } : operand;
    }
    return parsePrimary();
  }

  function parsePower() {
    const left = parseUnary();
    if (eat("^")) return { kind: "binary", op: "^", left, right: parsePower() };
    return left;
  }

  function parseTerm() {
    let left = parsePower();
    for (;;) {
      const token = peek();
      if (token.type !== "op" || (token.value !== "*" && token.value !== "/")) return left;
      next();
      left = { kind: "binary", op: token.value, left, right: parsePower() };
    }
  }

  function parseExpression() {
    let left = parseTerm();
    for (;;) {
      const token = peek();
      if (token.type !== "op" || (token.value !== "+" && token.value !== "-")) return left;
      next();
      left = { kind: "binary", op: token.value, left, right: parseTerm() };
    }
  }

  const tree = parseExpression();
  if (peek().type !== "eof") throw new FormulaError(FORMULA_ERROR);
  return tree;
}

function toNumber(value) {
  if (value.type === "number") return value.value;
  if (value.type === "empty") return 0;
  if (value.type === "error") throw new FormulaError(value.value);
  const trimmed = value.value.trim();
  if (trimmed === "") return 0;
  if (!NUMBER_PATTERN.test(trimmed)) throw new FormulaError(VALUE_ERROR);
  return Number(trimmed);
}

function cellCoordinates(address) {
  const coordinate = parseCellAddress(address);
  if (!coordinate || coordinate.column > GRID_COLUMN_COUNT || coordinate.row > GRID_ROW_COUNT) return null;
  return coordinate;
}

function referenceValue(context, address) {
  const coordinate = cellCoordinates(address);
  if (!coordinate) throw new FormulaError(REF_ERROR);
  return evaluateCell(context, cellAddress(coordinate.column, coordinate.row));
}

/** Every cell value of a rectangular range, in row-major order. */
function rangeValues(context, start, end) {
  const from = cellCoordinates(start);
  const to = cellCoordinates(end);
  if (!from || !to) throw new FormulaError(REF_ERROR);
  const values = [];
  for (let row = Math.min(from.row, to.row); row <= Math.max(from.row, to.row); row += 1) {
    for (let column = Math.min(from.column, to.column); column <= Math.max(from.column, to.column); column += 1) {
      values.push(evaluateCell(context, cellAddress(column, row)));
    }
  }
  return values;
}

function evaluateRange(context, node) {
  return rangeValues(context, node.start, node.end);
}

/** Numbers contributed by the arguments, skipping blanks and text inside ranges. */
function collectNumbers(context, args) {
  const numbers = [];
  for (const argument of args) {
    if (argument.kind === "range") {
      for (const value of evaluateRange(context, argument)) {
        if (value.type === "error") throw new FormulaError(value.value);
        if (value.type === "number") numbers.push(value.value);
      }
      continue;
    }
    const value = evaluateNode(context, argument);
    if (value.type === "error") throw new FormulaError(value.value);
    if (value.type === "empty") continue;
    if (value.type === "number") numbers.push(value.value);
    else if (NUMBER_PATTERN.test(value.value.trim())) numbers.push(Number(value.value.trim()));
    else throw new FormulaError(VALUE_ERROR);
  }
  return numbers;
}

/** Numeric cells only: `COUNT` never coerces text into a number. */
function countNumbers(context, args) {
  let count = 0;
  for (const argument of args) {
    if (argument.kind === "range") {
      for (const value of evaluateRange(context, argument)) {
        if (value.type === "error") throw new FormulaError(value.value);
        if (value.type === "number") count += 1;
      }
      continue;
    }
    const value = evaluateNode(context, argument);
    if (value.type === "error") throw new FormulaError(value.value);
    if (value.type === "number") count += 1;
  }
  return count;
}

function callFunction(context, node) {
  const { name, args } = node;
  if (!AGGREGATE_FUNCTIONS.includes(name)) throw new FormulaError(NAME_ERROR);
  if (args.length === 0) throw new FormulaError(FORMULA_ERROR);
  if (name === "COUNT") return numberValue(countNumbers(context, args));
  const numbers = collectNumbers(context, args);
  switch (name) {
    case "SUM":
      return numberValue(numbers.reduce((total, value) => total + value, 0));
    case "AVERAGE": {
      if (numbers.length === 0) throw new FormulaError(DIVIDE_BY_ZERO_ERROR);
      return numberValue(numbers.reduce((total, value) => total + value, 0) / numbers.length);
    }
    case "MIN":
      return numberValue(numbers.length === 0 ? 0 : Math.min(...numbers));
    case "MAX":
      return numberValue(numbers.length === 0 ? 0 : Math.max(...numbers));
    default:
      throw new FormulaError(NAME_ERROR);
  }
}

function evaluateNode(context, node) {
  switch (node.kind) {
    case "number":
      return numberValue(node.value);
    case "text":
      return textValue(node.value);
    case "ref":
      return referenceValue(context, node.address);
    case "error":
      return errorValue(node.code);
    case "call":
      return callFunction(context, node);
    case "unary": {
      const operand = toNumber(evaluateNode(context, node.operand));
      return node.op === "-" ? numberValue(-operand) : numberValue(operand);
    }
    case "binary": {
      const left = toNumber(evaluateNode(context, node.left));
      const right = toNumber(evaluateNode(context, node.right));
      if (node.op === "+") return numberValue(left + right);
      if (node.op === "-") return numberValue(left - right);
      if (node.op === "*") return numberValue(left * right);
      if (node.op === "^") return numberValue(left ** right);
      if (right === 0) throw new FormulaError(DIVIDE_BY_ZERO_ERROR);
      return numberValue(left / right);
    }
    default:
      throw new FormulaError(FORMULA_ERROR);
  }
}

function evaluateCell(context, address) {
  const cached = context.memo.get(address);
  if (cached) return cached;
  const raw = context.worksheet.cells?.[address];
  if (typeof raw !== "string" || raw === "") {
    context.memo.set(address, EMPTY_VALUE);
    return EMPTY_VALUE;
  }
  if (!isFormula(raw)) {
    const trimmed = raw.trim();
    const value = NUMBER_PATTERN.test(trimmed) ? numberValue(Number(trimmed)) : textValue(raw);
    context.memo.set(address, value);
    return value;
  }
  if (context.stack.has(address)) throw new FormulaError(REF_ERROR);
  context.stack.add(address);
  let value;
  try {
    value = evaluateNode(context, parseFormula(raw.slice(1)));
  } catch (error) {
    value = errorValue(error instanceof FormulaError ? error.code : FORMULA_ERROR);
  } finally {
    context.stack.delete(address);
  }
  context.memo.set(address, value);
  return value;
}

/** Displayed text of one evaluated value; a formula landing on nothing shows `0`. */
export function displayValue(value) {
  if (value.type === "number") return formatNumber(value.value);
  if (value.type === "text") return value.value;
  if (value.type === "empty") return "0";
  return value.value;
}

/**
 * Displayed value of every non-empty cell of a worksheet. Ordinary cells keep
 * the exact text the user typed; formula cells show the calculated result (or
 * the error code when the expression cannot be evaluated).
 */
export function worksheetValues(worksheet) {
  const context = { worksheet, memo: new Map(), stack: new Set() };
  const values = {};
  for (const [address, raw] of Object.entries(worksheet.cells ?? {})) {
    if (typeof raw !== "string" || raw === "") continue;
    values[address] = isFormula(raw) ? displayValue(evaluateCell(context, address)) : raw;
  }
  return values;
}
