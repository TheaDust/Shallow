/**
 * Worksheet formula engine: parses and evaluates the formulas stored in a worksheet's
 * raw cell map (`=A1+B1`, `=SUM(A1:B10)`, …) and produces the text the grid displays.
 *
 * The raw cell text stays the single source of truth (that is what the formula bar shows
 * and what is persisted); computed results are derived on every read through
 * `computeSheetValues`, so dependent formulas always follow the current source values and
 * structure changes never leave a stale cached result behind.
 *
 * Error values are the stable visible strings used across the editor:
 * `#DIV/0!` (division by zero), `#REF!` (invalid or circular reference, including an
 * A1-shaped address outside the grid such as `A0` or `ZZ1`),
 * `#NAME?` (unsupported function), `#ERROR!` (malformed expression or operand).
 */

export const DIV_ZERO_ERROR = "#DIV/0!";
export const REF_ERROR = "#REF!";
export const NAME_ERROR = "#NAME?";
export const EXPRESSION_ERROR = "#ERROR!";

const AGGREGATE_FUNCTIONS = new Set(["SUM", "AVERAGE", "COUNT", "MIN", "MAX"]);
const NUMBER_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

function isError(value) {
  return typeof value === "object" && value !== null && typeof value.error === "string";
}

function errorValue(code) {
  return { error: code };
}

function isRange(value) {
  return typeof value === "object" && value !== null && Array.isArray(value.values);
}

/** Formats a numeric result without floating-point noise and without trailing zeros. */
export function formatNumber(value) {
  if (!Number.isFinite(value)) return EXPRESSION_ERROR;
  const rounded = Number(value.toPrecision(12));
  return String(rounded);
}

/** Display text of one evaluated value (empty cell → ""). */
export function displayValue(value) {
  if (isError(value)) return value.error;
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return formatNumber(value);
  return String(value);
}

/* ------------------------------------------------------------------ tokenizer */

function isDigit(char) {
  return char >= "0" && char <= "9";
}

function isLetter(char) {
  return (char >= "A" && char <= "Z") || (char >= "a" && char <= "z");
}

function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      index += 1;
      continue;
    }
    // An error literal such as `#REF!` (a copied formula whose reference left the grid)
    // is a value of its own and propagates like any other error.
    if (char === "#") {
      const literal = /^#(REF!|DIV\/0!|NAME\?|ERROR!)/.exec(source.slice(index));
      if (!literal) return { ok: false };
      tokens.push({ type: "error", value: literal[1] === "REF!" ? REF_ERROR : literal[0] });
      index += literal[0].length;
      continue;
    }
    if (char === '"') {
      let text = "";
      index += 1;
      while (index < source.length && source[index] !== '"') {
        text += source[index];
        index += 1;
      }
      if (index >= source.length) return { ok: false };
      index += 1;
      tokens.push({ type: "text", value: text });
      continue;
    }
    if (isDigit(char) || (char === "." && isDigit(source[index + 1] ?? ""))) {
      let text = "";
      while (index < source.length && (isDigit(source[index]) || source[index] === ".")) {
        text += source[index];
        index += 1;
      }
      tokens.push({ type: "number", value: Number(text) });
      continue;
    }
    if (char === "$" || isLetter(char)) {
      const start = index;
      while (index < source.length && (isLetter(source[index]) || isDigit(source[index]) || source[index] === "$")) {
        index += 1;
      }
      const text = source.slice(start, index).replace(/\$/g, "");
      // An A1-shaped token is always a reference, even with an impossible row
      // (`A0`, `$A$0`): the evaluator turns an out-of-grid address into `#REF!`
      // instead of leaving it to fail as a malformed expression.
      if (/^[A-Za-z]+\d+$/.test(text)) {
        tokens.push({ type: "ref", value: text.toUpperCase() });
        continue;
      }
      if (/^[A-Za-z]+$/.test(text)) {
        tokens.push({ type: "name", value: text.toUpperCase() });
        continue;
      }
      return { ok: false };
    }
    if ("+-*/(),:".includes(char)) {
      tokens.push({ type: "op", value: char });
      index += 1;
      continue;
    }
    return { ok: false };
  }
  return { ok: true, tokens };
}

/* --------------------------------------------------------------------- parser */

function createParser(tokens) {
  let position = 0;
  const peek = () => tokens[position] ?? null;
  const matchOp = (value) => peek()?.type === "op" && peek().value === value;

  function parseExpression() {
    let node = parseTerm();
    if (!node) return null;
    while (matchOp("+") || matchOp("-")) {
      const operator = tokens[position].value;
      position += 1;
      const right = parseTerm();
      if (!right) return null;
      node = { type: "binary", operator, left: node, right };
    }
    return node;
  }

  function parseTerm() {
    let node = parseUnary();
    if (!node) return null;
    while (matchOp("*") || matchOp("/")) {
      const operator = tokens[position].value;
      position += 1;
      const right = parseUnary();
      if (!right) return null;
      node = { type: "binary", operator, left: node, right };
    }
    return node;
  }

  function parseUnary() {
    if (matchOp("-") || matchOp("+")) {
      const operator = tokens[position].value;
      position += 1;
      const operand = parseUnary();
      if (!operand) return null;
      return { type: "unary", operator, operand };
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const token = peek();
    if (!token) return null;
    if (token.type === "number") {
      position += 1;
      return { type: "number", value: token.value };
    }
    if (token.type === "text") {
      position += 1;
      return { type: "text", value: token.value };
    }
    if (token.type === "error") {
      position += 1;
      return { type: "error", value: token.value };
    }
    if (token.type === "ref") {
      position += 1;
      let end = null;
      if (matchOp(":")) {
        position += 1;
        const next = peek();
        if (!next || next.type !== "ref") return null;
        end = next.value;
        position += 1;
      }
      return { type: "ref", start: token.value, end };
    }
    if (token.type === "name") {
      position += 1;
      if (!matchOp("(")) return { type: "unknown", name: token.value };
      position += 1;
      const args = [];
      if (!matchOp(")")) {
        for (;;) {
          const argument = parseExpression();
          if (!argument) return null;
          args.push(argument);
          if (matchOp(",")) {
            position += 1;
            continue;
          }
          break;
        }
      }
      if (!matchOp(")")) return null;
      position += 1;
      return { type: "call", name: token.value, args };
    }
    if (matchOp("(")) {
      position += 1;
      const inner = parseExpression();
      if (!inner) return null;
      if (!matchOp(")")) return null;
      position += 1;
      return inner;
    }
    return null;
  }

  const root = parseExpression();
  if (!root || position !== tokens.length) return null;
  return root;
}

/* --------------------------------------------------------------- evaluation */

function parseLiteral(raw) {
  const text = raw.trim();
  if (text !== "" && NUMBER_PATTERN.test(text)) return Number(text);
  return raw;
}

function numericValue(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && NUMBER_PATTERN.test(value.trim()) && value.trim() !== "") {
    return Number(value.trim());
  }
  return null;
}

/** Evaluator over one worksheet's raw cell map. */
function createEvaluator(cells, size) {
  const memo = new Map();
  const visiting = new Set();

  function inGrid(address) {
    const match = /^([A-Z]+)(\d+)$/.exec(address);
    if (!match) return false;
    let column = 0;
    for (const letter of match[1]) column = column * 26 + (letter.charCodeAt(0) - 64);
    const row = Number(match[2]);
    return row >= 1 && column <= size.columns && row <= size.rows;
  }

  function valueAt(address) {
    if (memo.has(address)) return memo.get(address);
    if (!inGrid(address)) return errorValue(REF_ERROR);
    if (visiting.has(address)) return errorValue(REF_ERROR);
    const raw = cells?.[address];
    if (raw === undefined || raw === null || raw === "") {
      memo.set(address, null);
      return null;
    }
    if (typeof raw !== "string" || !raw.startsWith("=")) {
      const literal = parseLiteral(String(raw));
      memo.set(address, literal);
      return literal;
    }
    visiting.add(address);
    const value = evaluateNode(createParserFrom(raw.slice(1)));
    visiting.delete(address);
    memo.set(address, value);
    return value;
  }

  function createParserFrom(source) {
    const lexed = tokenize(source);
    if (!lexed.ok) return null;
    return createParser(lexed.tokens);
  }

  function rangeValues(start, end) {
    const from = /^([A-Z]+)(\d+)$/.exec(start);
    const to = /^([A-Z]+)(\d+)$/.exec(end);
    if (!from || !to) return { error: REF_ERROR };
    const columnIndex = (letters) => {
      let value = 0;
      for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64);
      return value;
    };
    const values = [];
    for (let row = Number(from[2]); row <= Number(to[2]); row += 1) {
      for (let column = columnIndex(from[1]); column <= columnIndex(to[1]); column += 1) {
        let label = "";
        for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) {
          label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
        }
        values.push(valueAt(`${label}${row}`));
      }
    }
    return { values };
  }

  function evaluateArgument(node) {
    if (node.type === "ref" && node.end) return rangeValues(node.start, node.end);
    return evaluateNode(node);
  }

  function flattenArguments(node) {
    const values = [];
    for (const argument of node.args) {
      const value = evaluateArgument(argument);
      if (isError(value)) return value;
      if (isRange(value)) values.push(...value.values);
      else values.push(value);
    }
    return values;
  }

  function evaluateCall(node) {
    if (!AGGREGATE_FUNCTIONS.has(node.name)) return errorValue(NAME_ERROR);
    const flattened = flattenArguments(node);
    if (isError(flattened)) return flattened;
    // `COUNT` counts numeric cells and ignores text, blanks and error values; the other
    // aggregates propagate an error found inside their range instead of hiding it.
    if (node.name !== "COUNT") {
      const failed = flattened.find((value) => isError(value));
      if (failed) return failed;
    }
    const numbers = [];
    for (const value of flattened) {
      const numeric = numericValue(value);
      if (numeric !== null) numbers.push(numeric);
    }
    switch (node.name) {
      case "SUM":
        return numbers.reduce((total, value) => total + value, 0);
      case "AVERAGE":
        return numbers.length === 0
          ? errorValue(DIV_ZERO_ERROR)
          : numbers.reduce((total, value) => total + value, 0) / numbers.length;
      case "COUNT":
        return numbers.length;
      case "MIN":
        return numbers.length === 0 ? 0 : Math.min(...numbers);
      case "MAX":
        return numbers.length === 0 ? 0 : Math.max(...numbers);
      default:
        return errorValue(NAME_ERROR);
    }
  }

  function evaluateNode(node) {
    if (!node) return errorValue(EXPRESSION_ERROR);
    switch (node.type) {
      case "number":
        return node.value;
      case "text":
        return node.value;
      case "unknown":
        return errorValue(NAME_ERROR);
      case "error":
        return errorValue(node.value);
      case "ref": {
        if (node.end) return errorValue(EXPRESSION_ERROR);
        return valueAt(node.start);
      }
      case "call":
        return evaluateCall(node);
      case "unary": {
        const operand = evaluateNode(node.operand);
        if (isError(operand)) return operand;
        const numeric = numericValue(operand);
        if (numeric === null) return errorValue(EXPRESSION_ERROR);
        return node.operator === "-" ? -numeric : numeric;
      }
      case "binary": {
        const left = evaluateNode(node.left);
        if (isError(left)) return left;
        const right = evaluateNode(node.right);
        if (isError(right)) return right;
        const a = numericValue(left ?? 0);
        const b = numericValue(right ?? 0);
        if (a === null || b === null) return errorValue(EXPRESSION_ERROR);
        switch (node.operator) {
          case "+":
            return a + b;
          case "-":
            return a - b;
          case "*":
            return a * b;
          case "/":
            return b === 0 ? errorValue(DIV_ZERO_ERROR) : a / b;
          default:
            return errorValue(EXPRESSION_ERROR);
        }
      }
      default:
        return errorValue(EXPRESSION_ERROR);
    }
  }

  return { valueAt, evaluate: (source) => evaluateNode(createParserFrom(source)) };
}

/**
 * Computed display text for every non-empty cell of a worksheet, keyed by A1 coordinate.
 * Ordinary cells keep their submitted text; formula cells hold their result or error.
 *
 * @param {Record<string, string>} cells raw cell text keyed by A1 coordinate
 * @param {{ rows?: number, columns?: number }} [size] grid bounds, defaulting to 50 × 26
 */
export function computeSheetValues(cells, size = {}) {
  const bounds = { rows: size.rows ?? 50, columns: size.columns ?? 26 };
  const evaluator = createEvaluator(cells ?? {}, bounds);
  const values = {};
  for (const [address, raw] of Object.entries(cells ?? {})) {
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw !== "string" || !raw.startsWith("=")) {
      values[address] = String(raw);
      continue;
    }
    values[address] = displayValue(evaluator.evaluate(raw.slice(1)));
  }
  return values;
}
