import { cellName, parseCellName } from "./cells.mjs";

/** Stable visible values for formula errors. */
export const DIVIDE_BY_ZERO_ERROR = "#DIV/0!";
export const INVALID_REFERENCE_ERROR = "#REF!";
export const UNKNOWN_FUNCTION_ERROR = "#NAME?";
export const MALFORMED_EXPRESSION_ERROR = "#ERROR!";

const NUMERIC_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const BOOLEAN_TEXT = /^(?:true|false)$/i;
const SUPPORTED_FUNCTIONS = new Set(["SUM", "AVERAGE", "COUNT", "MIN", "MAX"]);
const MAX_RANGE_SIZE = 100000;

class FormulaError extends Error {
  constructor(code) {
    super(code);
    this.name = "FormulaError";
    this.code = code;
  }
}

/** `$A$1` and `A1` address the same cell; the `$` only anchors a reference against copying. */
function stripAbsolute(name) {
  return String(name ?? "").replace(/\$/g, "");
}

const isErrorValue = (value) => typeof value === "object" && value !== null && typeof value.error === "string";
const asError = (code) => ({ error: code });

/** True when the raw input starts with `=`, i.e. it is submitted as a formula. */
export function isFormulaText(text) {
  return typeof text === "string" && text.startsWith("=");
}

export function isFormulaCell(cell) {
  return typeof cell?.formula === "string" && cell.formula !== "";
}

/** Numeric meaning of a literal value; numbers and boolean text convert, other text is `null`. */
export function numericCellValue(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") return null;
  if (NUMERIC_TEXT.test(text)) return Number(text);
  if (BOOLEAN_TEXT.test(text)) return text.toLowerCase() === "true" ? 1 : 0;
  return null;
}

/** Display text of a calculated number, without floating point noise. */
export function formatNumber(value) {
  if (!Number.isFinite(value)) return MALFORMED_EXPRESSION_ERROR;
  return String(Math.round(value * 1e10) / 1e10);
}

function tokenize(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '"') {
      const end = text.indexOf('"', index + 1);
      if (end === -1) throw new FormulaError(MALFORMED_EXPRESSION_ERROR);
      tokens.push({ type: "string", value: text.slice(index + 1, end) });
      index = end + 1;
      continue;
    }
    if (character === "#") {
      const match = /^#(?:REF!|DIV\/0!|NAME\?|ERROR!|VALUE!)/.exec(text.slice(index));
      if (!match) throw new FormulaError(MALFORMED_EXPRESSION_ERROR);
      const code = match[0] === "#VALUE!" ? MALFORMED_EXPRESSION_ERROR : match[0];
      tokens.push({ type: "error", value: code });
      index += match[0].length;
      continue;
    }
    if (/[0-9.]/.test(character)) {
      const match = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(text.slice(index));
      if (!match) throw new FormulaError(MALFORMED_EXPRESSION_ERROR);
      tokens.push({ type: "number", value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const rest = text.slice(index);
      const reference = /^\$?[A-Za-z]{1,3}\$?[1-9][0-9]*/.exec(rest);
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
      // `A1` is a reference; `SUM` is a function name; `LOG10` stays a reference.
      if (reference && (!name || reference[0].length >= name[0].length)) {
        tokens.push({ type: "ref", value: reference[0] });
        index += reference[0].length;
        continue;
      }
      tokens.push({ type: "name", value: name[0] });
      index += name[0].length;
      continue;
    }
    if ("+-*/():,".includes(character)) {
      tokens.push({ type: character });
      index += 1;
      continue;
    }
    throw new FormulaError(MALFORMED_EXPRESSION_ERROR);
  }
  return tokens;
}

function toNumber(value) {
  if (isErrorValue(value)) return value;
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const numeric = numericCellValue(value);
    return numeric === null ? asError(MALFORMED_EXPRESSION_ERROR) : numeric;
  }
  return asError(MALFORMED_EXPRESSION_ERROR);
}

function entryOf(value) {
  if (isErrorValue(value)) return { error: value.error };
  if (typeof value === "number") return { number: value };
  if (value === null || value === undefined) return { blank: true };
  const text = String(value);
  const numeric = numericCellValue(text);
  return numeric === null ? { text } : { number: numeric };
}

function aggregate(name, entries) {
  let count = 0;
  let sum = 0;
  let min = null;
  let max = null;
  for (const entry of entries) {
    if (entry?.error) return asError(entry.error);
    if (typeof entry?.number !== "number") continue;
    count += 1;
    sum += entry.number;
    min = min === null ? entry.number : Math.min(min, entry.number);
    max = max === null ? entry.number : Math.max(max, entry.number);
  }
  switch (name) {
    case "SUM":
      return sum;
    case "COUNT":
      return count;
    case "AVERAGE":
      return count === 0 ? asError(DIVIDE_BY_ZERO_ERROR) : sum / count;
    case "MIN":
      return min ?? 0;
    case "MAX":
      return max ?? 0;
    default:
      return asError(UNKNOWN_FUNCTION_ERROR);
  }
}

/** Recursive-descent evaluator over the token stream; `context` resolves cells, ranges and functions. */
function parseAndEvaluate(tokens, context) {
  let position = 0;

  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const expect = (type) => {
    const token = take();
    if (!token || token.type !== type) throw new FormulaError(MALFORMED_EXPRESSION_ERROR);
    return token;
  };

  function parsePrimary() {
    const token = take();
    if (!token) throw new FormulaError(MALFORMED_EXPRESSION_ERROR);
    switch (token.type) {
      case "number":
        return token.value;
      case "string":
        return token.value;
      case "error":
        return asError(token.value);
      case "(": {
        const value = parseExpression();
        expect(")");
        return value;
      }
      case "ref": {
        if (peek()?.type === "(") throw new FormulaError(UNKNOWN_FUNCTION_ERROR);
        if (peek()?.type === ":") {
          take();
          const end = expect("ref");
          return { range: context.rangeValues(token.value, end.value) };
        }
        return context.reference(token.value);
      }
      case "name": {
        const upper = token.value.toUpperCase();
        if (peek()?.type !== "(") {
          if (upper === "TRUE") return 1;
          if (upper === "FALSE") return 0;
          throw new FormulaError(UNKNOWN_FUNCTION_ERROR);
        }
        take();
        const args = [];
        if (peek()?.type !== ")") {
          args.push(parseExpression());
          while (peek()?.type === ",") {
            take();
            args.push(parseExpression());
          }
        }
        expect(")");
        return context.call(upper, args);
      }
      default:
        throw new FormulaError(MALFORMED_EXPRESSION_ERROR);
    }
  }

  function applyOperator(left, operator, right) {
    const first = toNumber(left);
    if (isErrorValue(first)) return first;
    const second = toNumber(right);
    if (isErrorValue(second)) return second;
    switch (operator) {
      case "+":
        return first + second;
      case "-":
        return first - second;
      case "*":
        return first * second;
      case "/":
        return second === 0 ? asError(DIVIDE_BY_ZERO_ERROR) : first / second;
      default:
        return asError(MALFORMED_EXPRESSION_ERROR);
    }
  }

  function parseFactor() {
    if (peek()?.type === "-") {
      take();
      return applyOperator(0, "-", parseFactor());
    }
    if (peek()?.type === "+") {
      take();
      return parseFactor();
    }
    return parsePrimary();
  }

  function parseTerm() {
    let value = parseFactor();
    while (peek()?.type === "*" || peek()?.type === "/") {
      const operator = take().type;
      value = applyOperator(value, operator, parseFactor());
    }
    return value;
  }

  function parseExpression() {
    let value = parseTerm();
    while (peek()?.type === "+" || peek()?.type === "-") {
      const operator = take().type;
      value = applyOperator(value, operator, parseTerm());
    }
    return value;
  }

  const result = parseExpression();
  if (position < tokens.length) throw new FormulaError(MALFORMED_EXPRESSION_ERROR);
  return result;
}

function normalizeRange(first, last) {
  const start = parseCellName(stripAbsolute(first));
  const end = parseCellName(stripAbsolute(last));
  if (!start || !end) return null;
  const top = Math.min(start.row, end.row);
  const bottom = Math.max(start.row, end.row);
  const left = Math.min(start.column, end.column);
  const right = Math.max(start.column, end.column);
  if ((bottom - top + 1) * (right - left + 1) > MAX_RANGE_SIZE) return null;
  return { top, bottom, left, right };
}

function resultText(value) {
  if (isErrorValue(value)) return value.error;
  if (typeof value === "number") return formatNumber(value);
  if (value === null || value === undefined) return "0";
  if (typeof value === "string") return value;
  return MALFORMED_EXPRESSION_ERROR;
}

/** Evaluates one formula body (with or without the leading `=`) against a context. */
export function evaluateFormulaText(formula, context) {
  const tokens = tokenize(String(formula ?? "").replace(/^=/, ""));
  if (!tokens.length) throw new FormulaError(MALFORMED_EXPRESSION_ERROR);
  return parseAndEvaluate(tokens, context);
}

/**
 * Recomputes the stored display value of every cell: formula cells get the result of
 * their expression, ordinary cells keep the text the user submitted. References inside
 * one worksheet only, in dependency order, with circular references reported as `#REF!`.
 * `bounds` (optional `{rowCount, columnCount}`) marks a single reference that points
 * outside the worksheet as `#REF!`.
 */
export function recalculateCells(cells = {}, bounds = null) {
  const source = cells ?? {};
  const computed = new Map();
  const visiting = new Set();

  function cellResult(name) {
    const cell = source[name];
    if (!cell) return { blank: true };
    if (isFormulaCell(cell)) {
      const value = computeFormula(name, cell.formula);
      return isErrorValue(value) ? { error: value.error } : entryOf(value);
    }
    return entryOf(cell.value ?? "");
  }

  function computeFormula(name, formula) {
    if (computed.has(name)) return computed.get(name);
    if (visiting.has(name)) return asError(INVALID_REFERENCE_ERROR);
    visiting.add(name);
    let result;
    try {
      result = evaluateFormulaText(formula, context);
    } catch (error) {
      result = asError(error instanceof FormulaError ? error.code : MALFORMED_EXPRESSION_ERROR);
    }
    visiting.delete(name);
    computed.set(name, result);
    return result;
  }

  const context = {
    reference(name) {
      const clean = stripAbsolute(name);
      const position = parseCellName(clean);
      if (bounds && position && (position.row >= bounds.rowCount || position.column >= bounds.columnCount)) {
        return asError(INVALID_REFERENCE_ERROR);
      }
      const result = cellResult(clean);
      if (result.error) return asError(result.error);
      if (result.blank) return null;
      if (typeof result.number === "number") return result.number;
      return result.text;
    },
    rangeValues(first, last) {
      const bounds = normalizeRange(first, last);
      if (!bounds) return [{ error: INVALID_REFERENCE_ERROR }];
      const values = [];
      for (let row = bounds.top; row <= bounds.bottom; row += 1) {
        for (let column = bounds.left; column <= bounds.right; column += 1) {
          values.push(cellResult(cellName(row, column)));
        }
      }
      return values;
    },
    call(name, args) {
      if (!SUPPORTED_FUNCTIONS.has(name)) return asError(UNKNOWN_FUNCTION_ERROR);
      const entries = [];
      for (const arg of args) {
        if (arg && typeof arg === "object" && Array.isArray(arg.range)) entries.push(...arg.range);
        else entries.push(entryOf(arg));
      }
      return aggregate(name, entries);
    },
  };

  const result = {};
  for (const [name, cell] of Object.entries(source)) {
    if (isFormulaCell(cell)) {
      result[name] = { ...cell, value: resultText(computeFormula(name, cell.formula)) };
    } else {
      result[name] = { ...cell };
    }
  }
  return result;
}
