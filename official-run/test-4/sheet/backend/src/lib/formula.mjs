/**
 * Formula engine for the current active worksheet (REQ-3-1).
 *
 * Evaluates formulas submitted through the grid or "Formula bar". Supported
 * syntax: numeric constants, parentheses, + - * /, A1-style references within
 * the same worksheet (absolute $A$1 markers are tolerated), and the
 * case-insensitive aggregate functions SUM, AVERAGE, COUNT, MIN, MAX over
 * contiguous ranges or single cells. Aggregate functions ignore empty cells;
 * COUNT counts only numeric cells; SUM/AVERAGE/MIN/MAX use only numeric cells
 * and do not treat blanks as zero.
 *
 * Results are derived from the stored cell text (the original formula is kept
 * in `cells`), so after refresh results are recomputed and stay consistent
 * with the current source values. Errors use stable visible values:
 * #DIV/0! (division by zero), #REF! (invalid or circular reference),
 * #NAME? (unsupported function), #ERROR! (malformed expression).
 */

const NUMBER_PATTERN = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/;

/** Error tokens that may appear literally inside formula text (from structure ops). */
const ERROR_TOKENS = new Set(["#REF!", "#DIV/0!", "#NAME?", "#ERROR!", "#VALUE!"]);

export function parseCoord(coord) {
  const match = /^([A-Za-z]+)([1-9]\d*)$/.exec(coord);
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { row: Number(match[2]), col: col - 1 };
}

export function cellName(row, columnIndex) {
  let n = columnIndex + 1;
  let name = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return `${name}${row}`;
}

/** Format a numeric result for display: integers plain, floats cleaned up. */
export function formatNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  const cleaned = Number(value.toPrecision(12));
  return String(Object.is(cleaned, -0) ? 0 : cleaned);
}

export function isFormula(text) {
  return typeof text === "string" && text.startsWith("=");
}

/**
 * @param {string} token a cell reference token like "A1" or "$B$2".
 * @returns {{row: number, col: number} | null}
 */
function parseRefToken(token) {
  const match = /^\$?([A-Za-z]+)\$?([1-9]\d*)$/.exec(token);
  if (!match) return null;
  const parsed = parseCoord(`${match[1]}${match[2]}`);
  return parsed;
}

/**
 * Resolve the numeric value of a cell for arithmetic. Formula cells are
 * evaluated recursively; non-numeric ordinary cells have no numeric value.
 *
 * @param {Record<string, string>} cells
 * @param {string} coord
 * @param {Set<string>} stack coords currently being evaluated (cycle guard).
 * @param {Map<string, unknown>} memo evaluated formula results.
 * @returns {{ value: number } | { error: string } | { text: string } | null}
 *   null when the cell is empty; `text` when it holds a non-numeric value.
 */
function resolveCell(cells, coord, stack, memo) {
  const raw = cells[coord];
  if (raw === undefined || raw === "") return null;
  if (!isFormula(raw)) {
    if (NUMBER_PATTERN.test(raw.trim())) {
      return { value: Number(raw.trim()) };
    }
    return { text: raw };
  }
  if (memo.has(coord)) {
    const value = memo.get(coord);
    return typeof value === "number" ? { value } : { error: value };
  }
  if (stack.has(coord)) {
    return { error: "#REF!" };
  }
  stack.add(coord);
  const outcome = evaluateFormulaText(raw, cells, coord, stack, memo);
  stack.delete(coord);
  if (typeof outcome === "number") memo.set(coord, outcome);
  else memo.set(coord, outcome);
  return typeof outcome === "number" ? { value: outcome } : { error: outcome };
}

/**
 * Collect numeric values covered by one aggregate argument: a range, a single
 * cell, or a numeric constant. Text and error cells are ignored; empty cells
 * are ignored.
 *
 * @returns {number[]}
 */
function collectArgument(tokenOrResult, cells, stack, memo) {
  const values = [];
  const pushCell = (coord) => {
    const resolved = resolveCell(cells, coord, stack, memo);
    if (resolved !== null && "value" in resolved) {
      values.push(resolved.value);
    }
  };
  if (Array.isArray(tokenOrResult)) {
    // range tokens [startCoord, endCoord]
    const [start, end] = tokenOrResult;
    const from = parseCoord(start);
    const to = parseCoord(end);
    if (!from || !to) return values;
    const rowMin = Math.min(from.row, to.row);
    const rowMax = Math.max(from.row, to.row);
    const colMin = Math.min(from.col, to.col);
    const colMax = Math.max(from.col, to.col);
    for (let row = rowMin; row <= rowMax; row += 1) {
      for (let col = colMin; col <= colMax; col += 1) {
        pushCell(cellName(row, col));
      }
    }
    return values;
  }
  if (typeof tokenOrResult === "number") {
    values.push(tokenOrResult);
    return values;
  }
  if (typeof tokenOrResult === "string" && !isFormula(tokenOrResult)) {
    if (parseCoord(tokenOrResult)) pushCell(tokenOrResult);
    return values;
  }
  return values;
}

function aggregate(name, args, cells, stack, memo) {
  const numeric = [];
  for (const arg of args) {
    if (typeof arg === "number") {
      numeric.push(arg);
      continue;
    }
    // Literal error tokens (for example a range rewritten to #REF! when a
    // copied relative reference moves outside the worksheet bounds, REQ-4-1-2)
    // propagate instead of being treated as empty arguments.
    if (typeof arg === "string" && ERROR_TOKENS.has(arg)) {
      return arg;
    }
    numeric.push(...collectArgument(arg, cells, stack, memo));
  }
  switch (name) {
    case "SUM":
      return numeric.reduce((sum, value) => sum + value, 0);
    case "COUNT":
      return numeric.length;
    case "MIN":
      return numeric.length === 0 ? 0 : Math.min(...numeric);
    case "MAX":
      return numeric.length === 0 ? 0 : Math.max(...numeric);
    case "AVERAGE":
      return numeric.length === 0 ? "#DIV/0!" : numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
    default:
      return "#NAME?";
  }
}

class ParseFailure extends Error {}

/**
 * Tokenize a formula body (without the leading "=").
 * @returns {string[]}
 */
function tokenize(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    if (/\s/.test(ch)) {
      index += 1;
      continue;
    }
    if ("+-*/(),:".includes(ch)) {
      tokens.push(ch);
      index += 1;
      continue;
    }
    if (ch === "#") {
      const match = /^#[A-Z0-9/?!]+/.exec(text.slice(index));
      if (!match) throw new ParseFailure("unexpected character");
      tokens.push(match[0]);
      index += match[0].length;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const match = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)/.exec(text.slice(index));
      if (!match) throw new ParseFailure("invalid number");
      tokens.push(match[0]);
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(ch) || ch === "$") {
      // A1-style reference tokens may carry $ column/row locks ($A$1, $A1, A$1).
      const refMatch = /^\$?[A-Za-z]+\$?[1-9]\d*/.exec(text.slice(index));
      if (refMatch) {
        tokens.push(refMatch[0]);
        index += refMatch[0].length;
        continue;
      }
      if (ch === "$") throw new ParseFailure("unexpected character");
      const match = /^[A-Za-z]+/.exec(text.slice(index));
      const word = match[0];
      index += word.length;
      const next = text[index];
      if (next === "(") {
        tokens.push(word.toUpperCase());
        continue;
      }
      if (next !== undefined && /[0-9]/.test(next)) {
        const digits = /^[0-9]+/.exec(text.slice(index));
        index += digits[0].length;
        tokens.push(`${word}${digits[0]}`);
        continue;
      }
      // bare word that is not a function call: unknown name
      tokens.push(word.toUpperCase());
      continue;
    }
    throw new ParseFailure(`unexpected character ${JSON.stringify(ch)}`);
  }
  return tokens;
}

/**
 * Evaluate one formula expression (recursive descent over tokens).
 *
 * @param {string} coord the cell being evaluated (context only).
 * @returns {number | string} numeric result or error string.
 */
function evaluateTokens(tokens, cells, coord, stack, memo) {
  let index = 0;

  function peek() {
    return tokens[index];
  }

  function take() {
    const token = tokens[index];
    index += 1;
    return token;
  }

  function expect(expected) {
    const token = take();
    if (token !== expected) throw new ParseFailure(`expected ${expected}`);
    return token;
  }

  function parseRange() {
    // RANGE = CELL ':' CELL; $ locks are stripped for lookup but the original
    // tokens were already validated by the tokenizer.
    const start = take();
    expect(":");
    const end = take();
    const startClean = start.replace(/\$/g, "");
    const endClean = end.replace(/\$/g, "");
    if (!parseCoord(startClean) || !parseCoord(endClean)) throw new ParseFailure("invalid range");
    return [startClean.toUpperCase(), endClean.toUpperCase()];
  }

  function parseFactor() {
    const token = peek();
    if (token === "-") {
      take();
      const value = parseFactor();
      if (typeof value === "string") return value;
      return -value;
    }
    if (token === "+") {
      take();
      return parseFactor();
    }
    if (token === "(") {
      take();
      const value = parseExpression();
      expect(")");
      return value;
    }
    if (token === undefined) throw new ParseFailure("unexpected end of expression");
    if (ERROR_TOKENS.has(token)) {
      take();
      return token;
    }
    if (NUMBER_PATTERN.test(token)) {
      take();
      return Number(token);
    }
    if (/^\$?[A-Za-z]+\$?[1-9]\d*$/.test(token)) {
      take();
      const parsed = parseRefToken(token);
      if (!parsed) throw new ParseFailure("invalid reference");
      // Strip $ locks so the cell lookup uses the plain coordinate.
      const coord = token.replace(/\$/g, "").toUpperCase();
      const resolved = resolveCell(cells, coord, stack, memo);
      if (resolved === null) return 0;
      if ("error" in resolved) return resolved.error;
      if ("value" in resolved) return resolved.value;
      return "#ERROR!";
    }
    if (/^[A-Za-z]+$/.test(token)) {
      // function call
      const name = take();
      expect("(");
      const args = [];
      if (peek() !== ")") {
        for (;;) {
          const next = peek();
          if (next !== undefined && /^\$?[A-Za-z]+\$?[1-9]\d*$/.test(next) && tokens[index + 1] === ":") {
            args.push(parseRange());
          } else {
            args.push(parseExpression());
          }
          if (peek() === ",") {
            take();
            continue;
          }
          break;
        }
      }
      expect(")");
      if (!["SUM", "AVERAGE", "COUNT", "MIN", "MAX"].includes(name)) return "#NAME?";
      return aggregate(name, args, cells, stack, memo);
    }
    throw new ParseFailure(`unexpected token ${JSON.stringify(token)}`);
  }

  function parseTerm() {
    let value = parseFactor();
    for (;;) {
      const token = peek();
      if (token === "*" || token === "/") {
        take();
        const right = parseFactor();
        if (typeof value === "string") continue;
        if (typeof right === "string") {
          value = right;
          continue;
        }
        if (token === "*") {
          value *= right;
        } else {
          if (right === 0) return "#DIV/0!";
          value /= right;
        }
        continue;
      }
      break;
    }
    return value;
  }

  function parseExpression() {
    let value = parseTerm();
    for (;;) {
      const token = peek();
      if (token === "+" || token === "-") {
        take();
        const right = parseTerm();
        if (typeof value === "string") continue;
        if (typeof right === "string") {
          value = right;
          continue;
        }
        value = token === "+" ? value + right : value - right;
        continue;
      }
      break;
    }
    return value;
  }

  const result = parseExpression();
  if (index !== tokens.length) throw new ParseFailure("trailing tokens");
  return result;
}

/**
 * Evaluate a formula cell value and return a number or an error string.
 * `text` must start with "=".
 */
export function evaluateFormulaText(text, cells, coord, stack = new Set(), memo = new Map()) {
  if (typeof text !== "string" || !text.startsWith("=")) {
    return "#ERROR!";
  }
  const body = text.slice(1).trim();
  if (body === "") return "#ERROR!";
  try {
    const tokens = tokenize(body);
    if (tokens.length === 0) return "#ERROR!";
    const result = evaluateTokens(tokens, cells, coord, stack, memo);
    return result;
  } catch (error) {
    if (error instanceof ParseFailure) return "#ERROR!";
    throw error;
  }
}

/**
 * Compute the display results of every formula cell in a sheet.
 *
 * @param {Record<string, string>} cells stored cell text.
 * @returns {Record<string, string>} coord -> formatted result/error for
 *   formula cells only.
 */
export function computeSheetResults(cells) {
  const results = {};
  const memo = new Map();
  for (const [coord, text] of Object.entries(cells)) {
    if (!isFormula(text)) continue;
    const stack = new Set();
    const outcome = evaluateFormulaText(text, cells, coord, stack, memo);
    results[coord] = typeof outcome === "number" ? formatNumber(outcome) : outcome;
  }
  return results;
}
