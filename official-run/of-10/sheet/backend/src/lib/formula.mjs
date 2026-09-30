import { MAX_COLUMN_INDEX, MAX_ROW_INDEX, columnIndexToLabel, columnLabelToIndex, makeCellId } from "./cells.mjs";

/**
 * Formula engine for one worksheet. Cells keep the text the user submitted as `value`; the grid
 * shows the calculated `display`. Supported subset (REQ-4-1-1): numeric constants, string and
 * boolean literals, parentheses, `+ - * / ^`, `&`, comparisons, A1 references (relative or with
 * `$`), `A1:B2` ranges, and the functions SUM, AVERAGE, COUNT, MIN, MAX plus IF, ROUND and ABS.
 */

const NUMBER_LITERAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const TOKEN_ERROR_LITERAL = /^#(?:REF!|DIV\/0!|NAME\?|ERROR!|VALUE!|N\/A|NUM!)/;
const TOKEN_REF = /^\$?([A-Za-z]{1,3})\$?([1-9][0-9]{0,6})(?![A-Za-z0-9_])/;
const REF_LITERAL = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]{0,6})$/;
const TOKEN_NAME = /^[A-Za-z_][A-Za-z0-9_.]*/;

export class CellError {
  constructor(code) {
    this.code = code;
  }
}

class RangeValue {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class FormulaSyntaxError extends Error {}

export function isFormulaText(text) {
  return typeof text === "string" && text.length > 1 && text.startsWith("=");
}

export function formatNumber(value) {
  if (!Number.isFinite(value)) return "#NUM!";
  const rounded = Number(value.toPrecision(12));
  return String(rounded);
}

/** Renders a calculated value the way the grid shows it. An empty result is shown as 0. */
export function formatValue(value) {
  if (value instanceof CellError) return value.code;
  if (value === null || value === undefined) return "0";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

/**
 * Rewrites the A1 references of a formula for a copy that moves it by `rowOffset`/`columnOffset`:
 * a relative row or column follows the target while a part written with `$` stays where it was. Text
 * literals are left untouched, and a value that is not a formula is returned unchanged. An offset
 * that moves a relative reference outside the sheet cannot be expressed, so the whole copied formula
 * becomes `=#REF!` (the grid then shows `#REF!`).
 */
export function translateFormulaReferences(text, rowOffset, columnOffset) {
  if (!isFormulaText(text)) return text;
  let movedOutside = false;
  const translated = rewriteFormulaReferences(text, (reference) => {
    const target = translateReference(reference, rowOffset, columnOffset);
    // Only an offset that moves a reference that used to be inside the sheet counts: an address that
    // already lies outside it keeps its own #REF! inside the rest of the expression.
    if (target === "#REF!" && referenceInsideSheet(reference)) movedOutside = true;
    return target;
  });
  return movedOutside ? "=#REF!" : translated;
}

/** True when the address a reference token names lies inside the sheet limits. */
function referenceInsideSheet(reference) {
  const match = REF_LITERAL.exec(reference);
  if (!match) return false;
  const column = columnLabelToIndex(match[2]);
  const row = Number(match[4]);
  return column >= 1 && column <= MAX_COLUMN_INDEX && row >= 1 && row <= MAX_ROW_INDEX;
}

/**
 * Rewrites the A1 references of a formula through a structural change of the sheet: `mapReference`
 * returns the address a reference moved to, or null when it cannot be preserved (the referenced row
 * or column was removed) and the reference becomes `#REF!`. Both absolute and relative references
 * follow the moved cells here, and the `$` parts keep their original form.
 */
export function remapFormulaReferences(text, mapReference) {
  return rewriteFormulaReferences(text, (reference) => remapReference(reference, mapReference));
}

/** Walks the formula body and rewrites every A1 reference; text literals are left untouched. */
function rewriteFormulaReferences(text, rewrite) {
  if (!isFormulaText(text)) return text;
  const body = text.slice(1);
  let result = "";
  let index = 0;
  while (index < body.length) {
    const rest = body.slice(index);
    if (body[index] === '"') {
      const literal = readTextLiteral(rest);
      result += literal;
      index += literal.length;
      continue;
    }
    const refMatch = TOKEN_REF.exec(rest);
    if (refMatch) {
      result += rewrite(refMatch[0]);
      index += refMatch[0].length;
      continue;
    }
    result += body[index];
    index += 1;
  }
  return `=${result}`;
}

function remapReference(reference, mapReference) {
  const match = REF_LITERAL.exec(reference);
  if (!match) return reference;
  const [, columnDollar, columnLabel, rowDollar, rowText] = match;
  const moved = mapReference({ row: Number(rowText), column: columnLabelToIndex(columnLabel) });
  if (!moved) return "#REF!";
  const row = Number(moved.row);
  const column = Number(moved.column);
  if (!Number.isInteger(row) || !Number.isInteger(column)) return "#REF!";
  if (column < 1 || column > MAX_COLUMN_INDEX || row < 1 || row > MAX_ROW_INDEX) return "#REF!";
  return `${columnDollar}${columnIndexToLabel(column)}${rowDollar}${row}`;
}

function readTextLiteral(rest) {
  let literal = '"';
  let cursor = 1;
  while (cursor < rest.length) {
    if (rest[cursor] === '"') {
      if (rest[cursor + 1] === '"') {
        literal += '""';
        cursor += 2;
        continue;
      }
      return literal + '"';
    }
    literal += rest[cursor];
    cursor += 1;
  }
  return literal;
}

function translateReference(reference, rowOffset, columnOffset) {
  const match = REF_LITERAL.exec(reference);
  if (!match) return reference;
  const [, columnDollar, columnLabel, rowDollar, rowText] = match;
  let column = columnLabelToIndex(columnLabel);
  let row = Number(rowText);
  if (columnDollar === "") column += columnOffset;
  if (rowDollar === "") row += rowOffset;
  if (column < 1 || column > MAX_COLUMN_INDEX || row < 1 || row > MAX_ROW_INDEX) return "#REF!";
  return `${columnDollar}${columnIndexToLabel(column)}${rowDollar}${row}`;
}

/** Value of a plain (non formula) cell: numeric looking text is a number, TRUE/FALSE a boolean. */
export function parseLiteral(text) {
  const trimmed = text.trim();
  if (trimmed !== "" && NUMBER_LITERAL.test(trimmed)) return Number(trimmed);
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;
  return text;
}

function toNumber(value) {
  if (value instanceof CellError) return value;
  if (value instanceof RangeValue) return new CellError("#VALUE!");
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const trimmed = String(value).trim();
  if (trimmed === "") return 0;
  if (NUMBER_LITERAL.test(trimmed)) return Number(trimmed);
  return new CellError("#VALUE!");
}

function toText(value) {
  if (value instanceof CellError) return value;
  if (value instanceof RangeValue) return new CellError("#VALUE!");
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return formatNumber(value);
  return String(value);
}

function toBoolean(value) {
  if (value instanceof CellError) return value;
  if (value instanceof RangeValue) return new CellError("#VALUE!");
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return value !== 0;
  return String(value).length > 0;
}

function addressOf(ref) {
  const column = ref.column;
  if (column > MAX_COLUMN_INDEX || ref.row > MAX_ROW_INDEX) return null;
  return ref;
}

function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    const errorMatch = TOKEN_ERROR_LITERAL.exec(rest);
    if (errorMatch) {
      tokens.push({ type: "error", value: errorMatch[0] });
      index += errorMatch[0].length;
      continue;
    }
    if (character === '"') {
      let value = "";
      let cursor = index + 1;
      let closed = false;
      while (cursor < source.length) {
        if (source[cursor] === '"') {
          if (source[cursor + 1] === '"') {
            value += '"';
            cursor += 2;
            continue;
          }
          cursor += 1;
          closed = true;
          break;
        }
        value += source[cursor];
        cursor += 1;
      }
      if (!closed) throw new FormulaSyntaxError("Unterminated text literal");
      tokens.push({ type: "string", value });
      index = cursor;
      continue;
    }
    const numberMatch = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(rest);
    if (numberMatch) {
      tokens.push({ type: "number", value: Number(numberMatch[0]) });
      index += numberMatch[0].length;
      continue;
    }
    const refMatch = TOKEN_REF.exec(rest);
    if (refMatch) {
      tokens.push({ type: "ref", value: refMatch[0], column: refMatch[1], row: Number(refMatch[2]) });
      index += refMatch[0].length;
      continue;
    }
    const nameMatch = TOKEN_NAME.exec(rest);
    if (nameMatch) {
      tokens.push({ type: "name", value: nameMatch[0] });
      index += nameMatch[0].length;
      continue;
    }
    const twoCharacter = rest.slice(0, 2);
    if (twoCharacter === "<=" || twoCharacter === ">=" || twoCharacter === "<>") {
      tokens.push({ type: "operator", value: twoCharacter });
      index += 2;
      continue;
    }
    if ("+-*/^&=<>(),:".includes(character)) {
      tokens.push({ type: "operator", value: character });
      index += 1;
      continue;
    }
    throw new FormulaSyntaxError(`Unexpected character ${character}`);
  }
  return tokens;
}

function compare(operator, left, right) {
  if (left instanceof CellError) return left;
  if (right instanceof CellError) return right;
  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);
  let ordering;
  if (typeof leftNumber === "number" && typeof rightNumber === "number") {
    ordering = leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
  } else {
    const leftText = String(toText(left));
    const rightText = String(toText(right));
    ordering = leftText === rightText ? 0 : leftText < rightText ? -1 : 1;
  }
  switch (operator) {
    case "=":
      return ordering === 0;
    case "<>":
      return ordering !== 0;
    case "<":
      return ordering < 0;
    case ">":
      return ordering > 0;
    case "<=":
      return ordering <= 0;
    default:
      return ordering >= 0;
  }
}

function arithmetic(operator, left, right) {
  if (left instanceof CellError) return left;
  if (right instanceof CellError) return right;
  const a = toNumber(left);
  const b = toNumber(right);
  if (a instanceof CellError) return a;
  if (b instanceof CellError) return b;
  switch (operator) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return b === 0 ? new CellError("#DIV/0!") : a / b;
    default:
      return a ** b;
  }
}

function collect(args, readCell) {
  const values = [];
  for (const argument of args) {
    if (argument instanceof RangeValue) {
      for (let row = argument.start.row; row <= argument.end.row; row += 1) {
        for (let column = argument.start.column; column <= argument.end.column; column += 1) {
          values.push(readCell(makeCellId(row, column)));
        }
      }
    } else {
      values.push(argument);
    }
  }
  return values;
}

function firstValue(args) {
  const [argument] = args;
  if (argument instanceof RangeValue) return argument;
  return argument;
}

function numbersOf(values) {
  return values.filter((value) => typeof value === "number");
}

function firstError(values) {
  return values.find((value) => value instanceof CellError) ?? null;
}

function callFunction(name, args, readCell) {
  const upper = name.toUpperCase();
  if (!["SUM", "AVERAGE", "COUNT", "MIN", "MAX", "IF", "ROUND", "ABS"].includes(upper)) {
    return new CellError("#NAME?");
  }
  if (upper === "IF") {
    const [condition, whenTrue, whenFalse] = args;
    const test = toBoolean(scalar(condition, readCell));
    if (test instanceof CellError) return test;
    const chosen = test ? whenTrue : whenFalse;
    if (chosen === undefined) return false;
    return scalar(chosen, readCell);
  }
  if (upper === "ROUND" || upper === "ABS") {
    const value = toNumber(scalar(args[0], readCell));
    if (value instanceof CellError) return value;
    if (upper === "ABS") return Math.abs(value);
    const digits = toNumber(scalar(args[1] ?? 0, readCell));
    if (digits instanceof CellError) return digits;
    const factor = 10 ** Math.trunc(digits);
    return Math.round(value * factor) / factor;
  }

  const values = collect(args, readCell);
  const error = firstError(values);
  if (error) return error;
  const numbers = numbersOf(values);
  if (upper === "COUNT") return numbers.length;
  if (numbers.length === 0) return upper === "AVERAGE" ? new CellError("#DIV/0!") : 0;
  if (upper === "SUM") return numbers.reduce((total, value) => total + value, 0);
  if (upper === "AVERAGE") return numbers.reduce((total, value) => total + value, 0) / numbers.length;
  if (upper === "MIN") return Math.min(...numbers);
  return Math.max(...numbers);
}

function scalar(value, readCell) {
  if (value instanceof RangeValue) {
    const values = collect([value], readCell);
    return values.length === 0 ? null : values[0];
  }
  return value;
}

class Parser {
  constructor(tokens, readCell) {
    this.tokens = tokens;
    this.index = 0;
    this.readCell = readCell;
  }

  peek() {
    return this.tokens[this.index];
  }

  next() {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }

  matchOperator(value) {
    const token = this.peek();
    if (token && token.type === "operator" && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  expectOperator(value) {
    if (!this.matchOperator(value)) throw new FormulaSyntaxError(`Expected ${value}`);
  }

  parse() {
    const value = this.expression();
    if (this.index !== this.tokens.length) throw new FormulaSyntaxError("Unexpected trailing input");
    return value;
  }

  expression() {
    return this.comparison();
  }

  comparison() {
    let left = this.concat();
    for (;;) {
      const token = this.peek();
      if (!token || token.type !== "operator" || !["=", "<>", "<", ">", "<=", ">="].includes(token.value)) return left;
      this.index += 1;
      left = compare(token.value, left, this.concat());
    }
  }

  concat() {
    let left = this.additive();
    while (this.matchOperator("&")) {
      const right = toText(this.additive());
      const leftText = toText(left);
      if (leftText instanceof CellError) return leftText;
      if (right instanceof CellError) return right;
      left = `${leftText}${right}`;
    }
    return left;
  }

  additive() {
    let left = this.multiplicative();
    for (;;) {
      const token = this.peek();
      if (!token || token.type !== "operator" || (token.value !== "+" && token.value !== "-")) return left;
      this.index += 1;
      left = arithmetic(token.value, left, this.multiplicative());
    }
  }

  multiplicative() {
    let left = this.power();
    for (;;) {
      const token = this.peek();
      if (!token || token.type !== "operator" || (token.value !== "*" && token.value !== "/")) return left;
      this.index += 1;
      left = arithmetic(token.value, left, this.power());
    }
  }

  power() {
    let left = this.unary();
    while (this.matchOperator("^")) {
      left = arithmetic("^", left, this.unary());
    }
    return left;
  }

  unary() {
    if (this.matchOperator("-")) {
      const value = toNumber(this.unary());
      return value instanceof CellError ? value : -value;
    }
    if (this.matchOperator("+")) return toNumber(this.unary());
    return this.primary();
  }

  primary() {
    const token = this.next();
    if (!token) throw new FormulaSyntaxError("Unexpected end of formula");
    if (token.type === "number" || token.type === "string") return token.value;
    if (token.type === "error") return new CellError(token.value);
    if (token.type === "ref") return this.reference(token);
    if (token.type === "name") {
      if (this.matchOperator("(")) {
        const args = [];
        if (!this.peek() || this.peek().value !== ")") {
          args.push(this.expression());
          while (this.matchOperator(",")) args.push(this.expression());
        }
        if (this.matchOperator(")") === false) throw new FormulaSyntaxError("Expected )");
        return callFunction(token.value, args, this.readCell);
      }
      if (/^true$/i.test(token.value)) return true;
      if (/^false$/i.test(token.value)) return false;
      throw new FormulaSyntaxError(`Unknown name ${token.value}`);
    }
    if (token.type === "operator" && token.value === "(") {
      const value = this.expression();
      this.expectOperator(")");
      return value;
    }
    throw new FormulaSyntaxError("Unexpected token");
  }

  reference(token) {
    const column = columnIndexFor(token.column);
    const start = addressOf({ row: token.row, column });
    if (!start) return new CellError("#REF!");
    if (this.matchOperator(":")) {
      const endToken = this.next();
      if (!endToken || endToken.type !== "ref") return new CellError("#REF!");
      const endColumn = columnIndexFor(endToken.column);
      const end = addressOf({ row: endToken.row, column: endColumn });
      if (!end) return new CellError("#REF!");
      return new RangeValue(
        { row: Math.min(start.row, end.row), column: Math.min(start.column, end.column) },
        { row: Math.max(start.row, end.row), column: Math.max(start.column, end.column) },
      );
    }
    return this.readCell(makeCellId(start.row, start.column));
  }
}

function columnIndexFor(label) {
  let index = 0;
  for (const character of String(label).toUpperCase()) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index;
}

/** Evaluates the body of a formula (without the leading `=`). */
export function evaluateFormula(source, readCell) {
  try {
    const tokens = tokenize(source);
    if (tokens.length === 0) return new CellError("#ERROR!");
    const value = new Parser(tokens, readCell).parse();
    if (value instanceof RangeValue) return new CellError("#VALUE!");
    return value;
  } catch {
    return new CellError("#ERROR!");
  }
}

/**
 * Recalculates a worksheet's cells: every cell keeps its submitted `value` and gains the `display`
 * the grid shows. Formulas are evaluated in dependency order with memoization; a cell that takes
 * part in a circular reference displays #REF!.
 */
export function computeWorksheetCells(cells) {
  const raw = new Map();
  for (const [cellId, cell] of Object.entries(cells ?? {})) {
    const text = cell?.value;
    if (typeof text === "string" && text !== "") raw.set(cellId, text);
  }

  const memo = new Map();
  const visiting = new Set();

  const readCell = (cellId) => {
    const key = String(cellId).toUpperCase();
    if (memo.has(key)) return memo.get(key);
    const text = raw.get(key);
    if (text === undefined) return null;
    if (isFormulaText(text)) {
      if (visiting.has(key)) return new CellError("#REF!");
      visiting.add(key);
      const value = evaluateFormula(text.slice(1), readCell);
      visiting.delete(key);
      memo.set(key, value);
      return value;
    }
    const value = parseLiteral(text);
    memo.set(key, value);
    return value;
  };

  const next = {};
  for (const [cellId, text] of raw) {
    if (isFormulaText(text)) next[cellId] = { value: text, display: formatValue(readCell(cellId)) };
    else next[cellId] = { value: text, display: text };
  }
  return next;
}
