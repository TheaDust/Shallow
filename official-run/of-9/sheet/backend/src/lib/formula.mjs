/**
 * Spreadsheet formula parsing and evaluation. Pure functions; no I/O.
 *
 * Supported syntax: numbers, double-quoted strings, cell references
 * (relative / absolute / mixed, optional `Sheet!` prefix), ranges
 * (`A1:B2`), arithmetic (`+ - * /` with parentheses and unary minus),
 * and the functions SUM, AVERAGE, MIN, MAX, COUNT, COUNTA.
 */

import { columnIndex, columnLabel } from "./refs.mjs";

export class FormulaSyntaxError extends Error {
  constructor(message) {
    super(message);
    this.name = "FormulaSyntaxError";
  }
}

const REF_RE = /([A-Za-z_][A-Za-z0-9_. ]*!)?(\$?)([A-Za-z]+)(\$?)(\d+)/g;
const NUMBER_RE = /^\d+(\.\d+)?/;
const STRING_RE = /^"(?:""|[^"])*"/;
const ERROR_RE = /^#(?:REF!|VALUE!|DIV\/0!|NAME\?|N\/A|NULL!|NUM!|CYCLE!)/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_.]*/;

/** Tokens with absolute positions inside the formula text. */
function tokenize(formula) {
  const tokens = [];
  let cursor = 0;
  if (formula[0] === "=") cursor = 1;
  REF_RE.lastIndex = cursor;
  let match;
  while ((match = REF_RE.exec(formula))) {
    if (match.index > cursor) emitSegment(formula, cursor, match.index, tokens);
    tokens.push({
      type: "ref",
      start: match.index,
      end: match.index + match[0].length,
      sheet: match[1] ? match[1].slice(0, -1) : "",
      absCol: match[2],
      column: columnIndex(match[3]),
      absRow: match[4],
      row: Number(match[5]),
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < formula.length) emitSegment(formula, cursor, formula.length, tokens);
  return tokens;
}

function emitSegment(formula, start, end, tokens) {
  const text = formula.slice(start, end);
  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    if (/\s/.test(ch)) {
      index += 1;
      continue;
    }
    const rest = text.slice(index);
    const number = NUMBER_RE.exec(rest);
    if (number) {
      tokens.push({ type: "number", value: Number(number[0]), start: start + index, end: start + index + number[0].length });
      index += number[0].length;
      continue;
    }
    const string = STRING_RE.exec(rest);
    if (string) {
      const raw = string[0].slice(1, -1).replace(/""/g, '"');
      tokens.push({ type: "string", value: raw, start: start + index, end: start + index + string[0].length });
      index += string[0].length;
      continue;
    }
    const error = ERROR_RE.exec(rest);
    if (error) {
      tokens.push({ type: "error", value: error[0], start: start + index, end: start + index + error[0].length });
      index += error[0].length;
      continue;
    }
    const ident = IDENT_RE.exec(rest);
    if (ident) {
      let after = start + index + ident[0].length;
      while (after < formula.length && /\s/.test(formula[after])) after += 1;
      const isFunction = formula[after] === "(";
      tokens.push({
        type: isFunction ? "function" : "name",
        value: ident[0],
        start: start + index,
        end: start + index + ident[0].length,
      });
      index += ident[0].length;
      continue;
    }
    if ("+-*/(),:".includes(ch)) {
      tokens.push({ type: "op", value: ch, start: start + index, end: start + index + 1 });
      index += 1;
      continue;
    }
    throw new FormulaSyntaxError(`Unexpected character "${ch}"`);
  }
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
  }

  peek() {
    return this.tokens[this.index] ?? null;
  }

  next() {
    const token = this.tokens[this.index];
    if (!token) throw new FormulaSyntaxError("Unexpected end of formula");
    this.index += 1;
    return token;
  }

  expectOp(value) {
    const token = this.peek();
    if (!token || token.type !== "op" || token.value !== value) {
      throw new FormulaSyntaxError(`Expected "${value}"`);
    }
    this.index += 1;
    return token;
  }

  parseExpression() {
    let left = this.parseTerm();
    while (this.peek()?.type === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.next().value;
      const right = this.parseTerm();
      left = { kind: "binop", op, left, right };
    }
    return left;
  }

  parseTerm() {
    let left = this.parseUnary();
    while (this.peek()?.type === "op" && (this.peek().value === "*" || this.peek().value === "/")) {
      const op = this.next().value;
      const right = this.parseUnary();
      left = { kind: "binop", op, left, right };
    }
    return left;
  }

  parseUnary() {
    const token = this.peek();
    if (token?.type === "op" && (token.value === "-" || token.value === "+")) {
      this.next();
      return { kind: "neg", operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.peek();
    if (!token) throw new FormulaSyntaxError("Unexpected end of formula");
    if (token.type === "number") {
      this.next();
      return { kind: "num", value: token.value };
    }
    if (token.type === "string") {
      this.next();
      return { kind: "str", value: token.value };
    }
    if (token.type === "error") {
      this.next();
      return { kind: "error", value: token.value };
    }
    if (token.type === "name") {
      this.next();
      const upper = token.value.toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") return { kind: "str", value: upper };
      return { kind: "error", value: "#NAME?" };
    }
    if (token.type === "op" && token.value === "(") {
      this.next();
      const node = this.parseExpression();
      this.expectOp(")");
      return node;
    }
    if (token.type === "ref") {
      this.next();
      if (this.peek()?.type === "op" && this.peek().value === ":") {
        this.next();
        const endToken = this.peek();
        if (!endToken || endToken.type !== "ref") throw new FormulaSyntaxError("Expected range end");
        this.next();
        return { kind: "range", start: token, end: endToken };
      }
      return { kind: "ref", ref: token };
    }
    if (token.type === "function") {
      this.next();
      this.expectOp("(");
      const args = [];
      if (!(this.peek()?.type === "op" && this.peek().value === ")")) {
        args.push(this.parseExpression());
        while (this.peek()?.type === "op" && this.peek().value === ",") {
          this.next();
          args.push(this.parseExpression());
        }
      }
      this.expectOp(")");
      return { kind: "func", name: token.value.toUpperCase(), args };
    }
    throw new FormulaSyntaxError("Unexpected token");
  }
}

export function parseFormula(formula) {
  if (typeof formula !== "string" || formula === "") {
    throw new FormulaSyntaxError("Empty formula");
  }
  const tokens = tokenize(formula);
  const parser = new Parser(tokens);
  const node = parser.parseExpression();
  if (parser.peek() !== null) {
    throw new FormulaSyntaxError("Unexpected trailing content");
  }
  return node;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "#NUM!";
  if (Object.is(value, -0) || value === 0) return "0";
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const rounded = Number(value.toPrecision(12));
  return String(rounded);
}

function numericValue(text) {
  const trimmed = String(text).trim();
  if (trimmed === "") return null;
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function toArithmetic(value) {
  if (value.type === "num") return { ok: true, value: value.value };
  if (value.type === "error") return { ok: false, error: value.value };
  if (value.type === "empty") return { ok: true, value: 0 };
  if (value.type === "text") {
    const number = numericValue(value.value);
    if (number !== null) return { ok: true, value: number };
    return { ok: false, error: "#VALUE!" };
  }
  return { ok: false, error: "#VALUE!" };
}

function evaluateNode(node, context, state) {
  switch (node.kind) {
    case "num":
      return { type: "num", value: node.value };
    case "str":
      return { type: "text", value: node.value };
    case "error":
      return { type: "error", value: node.value };
    case "ref":
      return evaluateRef(node.ref, context, state);
    case "range":
      return evaluateRange(node.start, node.end, context, state);
    case "neg": {
      const operand = evaluateNode(node.operand, context, state);
      const coerced = toArithmetic(operand);
      if (!coerced.ok) return { type: "error", value: coerced.error };
      return { type: "num", value: -coerced.value };
    }
    case "binop": {
      const left = evaluateNode(node.left, context, state);
      const right = evaluateNode(node.right, context, state);
      const a = toArithmetic(left);
      if (!a.ok) return { type: "error", value: a.error };
      const b = toArithmetic(right);
      if (!b.ok) return { type: "error", value: b.error };
      let result;
      if (node.op === "+") result = a.value + b.value;
      else if (node.op === "-") result = a.value - b.value;
      else if (node.op === "*") result = a.value * b.value;
      else {
        if (b.value === 0) return { type: "error", value: "#DIV/0!" };
        result = a.value / b.value;
      }
      return { type: "num", value: result };
    }
    case "func":
      return evaluateFunction(node, context, state);
    default:
      return { type: "error", value: "#ERROR!" };
  }
}

function cellFromContext(context, sheetName, position) {
  if (!context || typeof context.getCell !== "function") return undefined;
  return context.getCell(sheetName, position);
}

function evaluateRef(ref, context, state) {
  if (ref.sheet !== "" && context && typeof context.hasSheet === "function" && !context.hasSheet(ref.sheet)) {
    return { type: "error", value: "#REF!" };
  }
  if (ref.row < 1 || ref.column < 1) return { type: "error", value: "#REF!" };
  const cell = cellFromContext(context, ref.sheet || null, { row: ref.row, column: ref.column });
  const value = cell && typeof cell.value === "string" ? cell.value : "";
  if (value === "") return { type: "empty" };
  if (value.startsWith("#")) return { type: "error", value };
  const number = numericValue(value);
  if (number !== null) return { type: "num", value: number };
  return { type: "text", value };
}

function evaluateRange(startRef, endRef, context, state) {
  const start = {
    row: Math.min(startRef.row, endRef.row),
    column: Math.min(startRef.column, endRef.column),
  };
  const end = {
    row: Math.max(startRef.row, endRef.row),
    column: Math.max(startRef.column, endRef.column),
  };
  if (start.row < 1 || start.column < 1) return { type: "error", value: "#REF!" };
  const items = [];
  for (let row = start.row; row <= end.row; row += 1) {
    for (let column = start.column; column <= end.column; column += 1) {
      const cell = cellFromContext(context, startRef.sheet || null, { row, column });
      const raw = cell && typeof cell.value === "string" ? cell.value : "";
      items.push(raw.startsWith("#") ? { type: "error", value: raw } : { type: "text", value: raw });
    }
  }
  return { type: "array", items };
}

function numberOf(value) {
  if (value.type === "num") return { ok: true, value: value.value };
  if (value.type === "error") return { ok: false, error: value.value };
  if (value.type === "empty") return { ok: false, ignore: true };
  if (value.type === "text") {
    const number = numericValue(value.value);
    return number !== null ? { ok: true, value: number } : { ok: false, ignore: true };
  }
  return { ok: false, ignore: true };
}

function flattenArgs(args, state) {
  const values = [];
  for (const arg of args) {
    const value = evaluateNode(arg, state.context, state);
    if (value.type === "array") values.push(...value.items);
    else values.push(value);
  }
  return values;
}

function evaluateFunction(node, context, state) {
  const values = flattenArgs(node.args, { context });
  const numbers = [];
  for (const value of values) {
    const parsed = numberOf(value);
    if (!parsed.ok) {
      if (parsed.error) return { type: "error", value: parsed.error };
      continue;
    }
    numbers.push(parsed.value);
  }
  switch (node.name) {
    case "SUM":
      return { type: "num", value: numbers.reduce((sum, value) => sum + value, 0) };
    case "AVERAGE":
      if (numbers.length === 0) return { type: "error", value: "#DIV/0!" };
      return { type: "num", value: numbers.reduce((sum, value) => sum + value, 0) / numbers.length };
    case "MIN":
      return { type: "num", value: numbers.length ? Math.min(...numbers) : 0 };
    case "MAX":
      return { type: "num", value: numbers.length ? Math.max(...numbers) : 0 };
    case "COUNT":
      return { type: "num", value: numbers.length };
    case "COUNTA": {
      let count = 0;
      for (const value of values) {
        if (value.type === "text" && value.value !== "") count += 1;
        else if (value.type === "num") count += 1;
        else if (value.type === "error") return { type: "error", value: value.value };
      }
      return { type: "num", value: count };
    }
    default:
      return { type: "error", value: "#NAME?" };
  }
}

function formatResult(value) {
  if (value.type === "num") return formatNumber(value.value);
  if (value.type === "text") return value.value;
  if (value.type === "empty") return "0";
  if (value.type === "error") return value.value;
  return "#VALUE!";
}

/**
 * Evaluates a formula and returns the string result.
 * context: `{ hasSheet(name), getCell(sheetName|null, {row, column}) }`.
 */
export function evaluateFormula(formula, context) {
  const node = parseFormula(formula);
  return formatResult(evaluateNode(node, context, {}));
}

/**
 * Adjusts relative references in a copied formula by a target offset.
 * Absolute parts stay fixed; sheet-prefixed references stay untouched;
 * references that would move outside the sheet become `#REF!`.
 */
export function adjustFormulaForCopy(formula, rowOffset, columnOffset) {
  if (typeof formula !== "string" || formula === "") return formula;
  const tokens = tokenize(formula);
  const refs = tokens.filter((token) => token.type === "ref");
  if (refs.length === 0) return formula;

  for (let i = 1; i < refs.length; i += 1) {
    if (formula.slice(refs[i - 1].end, refs[i].start).trim() === ":") {
      refs[i - 1].rangeEnd = refs[i];
      refs[i].rangeStart = refs[i - 1];
    }
  }

  const renderRef = (ref, row, column) =>
    `${ref.sheet ? `${ref.sheet}!` : ""}${ref.absCol}${columnLabel(column - 1)}${ref.absRow}${row}`;

  let out = "";
  let cursor = 0;
  for (const ref of refs) {
    if (ref.rangeStart) {
      cursor = ref.end;
      continue;
    }
    out += formula.slice(cursor, ref.start);
    cursor = ref.end;
    if (ref.sheet !== "") {
      out += formula.slice(ref.start, ref.end);
      continue;
    }
    const targetRow = ref.row + (ref.absRow ? 0 : rowOffset);
    const targetColumn = ref.column + (ref.absCol ? 0 : columnOffset);
    const renderSingle = (row, column) =>
      row < 1 || column < 1 ? "#REF!" : renderRef(ref, row, column);
    if (ref.rangeEnd) {
      const end = ref.rangeEnd;
      const endRow = end.row + (end.absRow ? 0 : rowOffset);
      const endColumn = end.column + (end.absCol ? 0 : columnOffset);
      const startRendered = renderSingle(targetRow, targetColumn);
      const endRendered = renderSingle(endRow, endColumn);
      out +=
        startRendered === "#REF!" || endRendered === "#REF!"
          ? "#REF!"
          : `${startRendered}:${endRendered}`;
      continue;
    }
    out += renderSingle(targetRow, targetColumn);
  }
  out += formula.slice(cursor);
  return out;
}

/** Exported for tests: extracts `{row, column}` of every reference in a formula. */
export function formulaReferences(formula) {
  const tokens = tokenize(formula);
  return tokens.filter((token) => token.type === "ref").map((token) => ({
    sheet: token.sheet,
    absCol: Boolean(token.absCol),
    absRow: Boolean(token.absRow),
    row: token.row,
    column: token.column,
  }));
}
