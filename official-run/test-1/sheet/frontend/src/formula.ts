/**
 * Spreadsheet formula evaluation (REQ-3-1-1 formula cells; REQ-4-1-1 language).
 *
 * Formulas begin with "=". Supported: numeric constants, parentheses,
 * addition/subtraction/multiplication/division, A1-style references within
 * the same worksheet, and SUM/AVERAGE/COUNT/MIN/MAX over contiguous ranges
 * (A1:B2) or value lists. Function names are case-insensitive; aggregates
 * ignore empty and non-numeric cells, COUNT counts only numeric cells, and
 * SUM/AVERAGE/MIN/MAX use only numeric cells (blanks are not treated as 0).
 * Literal error tokens such as "#REF!" (produced by row/column shifts) pass
 * through unchanged. Direct references to text cells return that text; using
 * text in arithmetic yields "#ERROR!"; division by zero yields "#DIV/0!";
 * circular references yield "#ERROR!".
 */

import { cellCoordinate, columnNumber } from "./coords";

export type EvalResult = number | string;

const ERROR = "#ERROR!";
const DIV_ZERO = "#DIV/0!";
const COORD_TOKEN = /^[A-Za-z]+\d+$/;

function parseNumeric(raw: string): number | null {
  const t = String(raw).trim();
  if (t === "") return null;
  if (/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(t)) return Number(t);
  return null;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(value);
}

type CellContent =
  | { kind: "number"; value: number }
  | { kind: "text"; value: string }
  | { kind: "empty" }
  | { kind: "error"; value: string };

/** Resolve one cell's content, recursing into formula cells it may hold. */
function resolveCell(
  coord: string,
  cells: Record<string, string>,
  visiting: Set<string>,
): CellContent {
  const raw = cells[coord];
  if (raw === undefined || raw === "") return { kind: "empty" };
  if (raw.startsWith("=")) {
    const body = raw.slice(1).trim();
    if (body.startsWith("#")) return { kind: "error", value: body };
    if (visiting.has(coord)) return { kind: "error", value: ERROR };
    const next = new Set(visiting);
    next.add(coord);
    const result = evaluateBody(body, cells, next);
    if (typeof result === "number") return { kind: "number", value: result };
    if (result.startsWith("#")) return { kind: "error", value: result };
    return { kind: "text", value: result };
  }
  const num = parseNumeric(raw);
  if (num !== null) return { kind: "number", value: num };
  return { kind: "text", value: raw };
}

type Arg = { kind: "value"; value: EvalResult } | { kind: "range"; coords: string[] };

function expandRange(a: string, b: string): string[] {
  const m1 = a.match(/^([A-Z]+)(\d+)$/)!;
  const m2 = b.match(/^([A-Z]+)(\d+)$/)!;
  const colMin = Math.min(columnNumber(m1[1]), columnNumber(m2[1]));
  const colMax = Math.max(columnNumber(m1[1]), columnNumber(m2[1]));
  const rowMin = Math.min(Number(m1[2]), Number(m2[2]));
  const rowMax = Math.max(Number(m1[2]), Number(m2[2]));
  const coords: string[] = [];
  for (let r = rowMin; r <= rowMax; r += 1) {
    for (let c = colMin; c <= colMax; c += 1) {
      coords.push(cellCoordinate(c - 1, r - 1));
    }
  }
  return coords;
}

function applyArith(op: string, left: EvalResult, right: EvalResult): EvalResult {
  const err = [left, right].find((v) => typeof v === "string" && v.startsWith("#"));
  if (err !== undefined) return err as string;
  if (typeof left !== "number" || typeof right !== "number") return ERROR;
  switch (op) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return right === 0 ? DIV_ZERO : left / right;
    default:
      return ERROR;
  }
}

function applyFunction(
  name: string,
  args: Arg[],
  cells: Record<string, string>,
  visiting: Set<string>,
): EvalResult {
  const numerics: number[] = [];
  let rangeError: string | null = null;
  for (const arg of args) {
    if (arg.kind === "value") {
      if (typeof arg.value === "number") numerics.push(arg.value);
      else if (typeof arg.value === "string" && arg.value.startsWith("#")) {
        rangeError = rangeError ?? arg.value;
      }
    } else {
      for (const coord of arg.coords) {
        const content = resolveCell(coord, cells, visiting);
        if (content.kind === "number") numerics.push(content.value);
        else if (content.kind === "error") rangeError = rangeError ?? content.value;
      }
    }
  }
  if (rangeError) return rangeError;
  switch (name) {
    case "SUM":
      return numerics.reduce((a, b) => a + b, 0);
    case "AVERAGE":
      if (numerics.length === 0) return DIV_ZERO;
      return numerics.reduce((a, b) => a + b, 0) / numerics.length;
    case "COUNT":
      return numerics.length;
    case "MIN":
      return numerics.length ? Math.min(...numerics) : 0;
    case "MAX":
      return numerics.length ? Math.max(...numerics) : 0;
    default:
      return ERROR;
  }
}

class Parser {
  private i = 0;

  constructor(
    private text: string,
    private cells: Record<string, string>,
    private visiting: Set<string>,
  ) {}

  private peek(): string {
    return this.text[this.i] ?? "";
  }

  private skipWs() {
    while (this.i < this.text.length && /\s/.test(this.text[this.i])) this.i += 1;
  }

  parseExpression(): EvalResult {
    let left = this.parseTerm();
    for (;;) {
      this.skipWs();
      const op = this.peek();
      if (op !== "+" && op !== "-") break;
      this.i += 1;
      left = applyArith(op, left, this.parseTerm());
    }
    return left;
  }

  private parseTerm(): EvalResult {
    let left = this.parseUnary();
    for (;;) {
      this.skipWs();
      const op = this.peek();
      if (op !== "*" && op !== "/") break;
      this.i += 1;
      left = applyArith(op, left, this.parseUnary());
    }
    return left;
  }

  private parseUnary(): EvalResult {
    this.skipWs();
    const op = this.peek();
    if (op === "+" || op === "-") {
      this.i += 1;
      const v = this.parseUnary();
      if (typeof v !== "number") return ERROR;
      return op === "-" ? -v : v;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): EvalResult {
    this.skipWs();
    const ch = this.peek();
    if (ch === "(") {
      this.i += 1;
      const v = this.parseExpression();
      this.skipWs();
      if (this.peek() !== ")") throw new Error("expected )");
      this.i += 1;
      return v;
    }
    if (/[0-9.]/.test(ch)) return this.parseNumber();
    if (/[A-Za-z]/.test(ch)) return this.parseIdent();
    throw new Error("unexpected character");
  }

  private parseNumber(): EvalResult {
    const start = this.i;
    if (this.peek() === ".") {
      this.i += 1;
      if (!/[0-9]/.test(this.peek())) throw new Error("bad number");
      while (/[0-9]/.test(this.peek())) this.i += 1;
    } else {
      while (/[0-9]/.test(this.peek())) this.i += 1;
      if (this.peek() === ".") {
        this.i += 1;
        while (/[0-9]/.test(this.peek())) this.i += 1;
      }
    }
    return Number(this.text.slice(start, this.i));
  }

  private parseIdent(): EvalResult {
    const start = this.i;
    while (/[A-Za-z0-9]/.test(this.peek())) this.i += 1;
    const token = this.text.slice(start, this.i);
    if (COORD_TOKEN.test(token)) {
      return this.resolveRef(token.toUpperCase());
    }
    this.skipWs();
    if (this.peek() !== "(") throw new Error("expected (");
    this.i += 1;
    const args = this.parseArgs();
    return applyFunction(token.toUpperCase(), args, this.cells, this.visiting);
  }

  private parseArgs(): Arg[] {
    const args: Arg[] = [];
    this.skipWs();
    if (this.peek() === ")") {
      this.i += 1;
      return args;
    }
    for (;;) {
      this.skipWs();
      const range = this.tryParseRange();
      if (range) {
        args.push({ kind: "range", coords: range });
      } else {
        args.push({ kind: "value", value: this.parseExpression() });
      }
      this.skipWs();
      const ch = this.peek();
      if (ch === ",") {
        this.i += 1;
        continue;
      }
      if (ch === ")") {
        this.i += 1;
        break;
      }
      throw new Error("expected , or )");
    }
    return args;
  }

  private tryParseRange(): string[] | null {
    const save = this.i;
    try {
      const first = this.parseCoordToken();
      this.skipWs();
      if (this.peek() !== ":") {
        this.i = save;
        return null;
      }
      this.i += 1;
      this.skipWs();
      const second = this.parseCoordToken();
      return expandRange(first, second);
    } catch {
      this.i = save;
      return null;
    }
  }

  private parseCoordToken(): string {
    this.skipWs();
    const start = this.i;
    while (/[A-Za-z0-9]/.test(this.peek())) this.i += 1;
    const token = this.text.slice(start, this.i);
    if (!COORD_TOKEN.test(token)) throw new Error("bad coordinate");
    return token.toUpperCase();
  }

  private resolveRef(coord: string): EvalResult {
    const content = resolveCell(coord, this.cells, this.visiting);
    switch (content.kind) {
      case "number":
        return content.value;
      case "text":
        return content.value;
      case "empty":
        return 0;
      case "error":
        return content.value;
    }
  }
}

function evaluateBody(
  body: string,
  cells: Record<string, string>,
  visiting: Set<string>,
): EvalResult {
  try {
    return new Parser(body, cells, visiting).parseExpression();
  } catch {
    return ERROR;
  }
}

/**
 * Display value of a stored cell text: formula cells ("=" prefix) evaluate to
 * their current result; ordinary cells show the stored text unchanged.
 */
export function evaluateFormula(raw: string, cells: Record<string, string>): string {
  const text = String(raw ?? "");
  if (!text.startsWith("=")) return text;
  const body = text.slice(1).trim();
  if (body === "") return ERROR;
  if (body.startsWith("#")) return body;
  const result = evaluateBody(body, cells, new Set());
  return typeof result === "number" ? formatNumber(result) : result;
}

/** Display text for one raw cell value (formula cells show their result). */
export function displayValue(raw: string | undefined, cells: Record<string, string>): string {
  const text = raw ?? "";
  if (text.startsWith("=")) return evaluateFormula(text, cells);
  return text;
}

/** Compute the display value for every non-empty cell of a worksheet. */
export function computeDisplayCells(cells: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [coord, raw] of Object.entries(cells)) {
    out[coord] = displayValue(raw, cells);
  }
  return out;
}
