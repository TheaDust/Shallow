/**
 * Small spreadsheet calculation engine used to render and export cell values.
 *
 * A cell whose raw text starts with `=` is a formula: the grid and the CSV
 * export show its calculated result while the formula bar keeps the original
 * expression. Supported syntax: numeric constants, parentheses, `+ - * /`,
 * unary signs, same-sheet A1 references, ranges (`A1:B4`), the aggregate
 * functions SUM, AVERAGE, COUNT, MIN and MAX (case-insensitive) and the
 * workbook's named ranges, which resolve to the sheet-qualified area they were
 * saved with. Aggregate functions ignore empty and non-numeric cells, so blanks
 * are never counted as zero and a formula cell counts only through a numeric
 * result. Errors are rendered as spreadsheet error codes.
 */

import { parseNamedRangeReference, type NamedRangeReference } from "./named-ranges";
import type { NamedRange } from "./types";

export const FORMULA_ERROR = {
  parse: "#ERROR!",
  name: "#NAME?",
  value: "#VALUE!",
  number: "#NUM!",
  divideByZero: "#DIV/0!",
  reference: "#REF!",
} as const;

export type CellValues = Record<string, string>;

type BinaryOperator = "+" | "-" | "*" | "/";

type Node =
  | { kind: "number"; value: number }
  | { kind: "ref"; coordinate: string }
  | { kind: "range"; start: string; end: string }
  | { kind: "named"; sheet: string; start: string; end: string }
  | { kind: "unary"; operator: "+" | "-"; operand: Node }
  | { kind: "binary"; operator: BinaryOperator; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] };

export class FormulaError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "FormulaError";
  }
}

// A cell reference may anchor its column and/or row with `$` (for example
// `$A$1` or `B$2`); the anchor only matters when a formula is copied.
const CELL_PATTERN = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*)$/;
// A token shaped like a cell address (`A1`, `$B$12`, but also an out-of-range
// address such as `A0` or `AAAA1`). Such a token that does not resolve to a
// real cell is an invalid reference (#REF!), not an unknown name (#NAME?).
const REFERENCE_SHAPE = /^\$?[A-Za-z]+\$?[0-9]+$/;
const NUMBER_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

interface Token {
  type: "number" | "name" | "operator" | "paren" | "comma" | "colon";
  value: string;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      index += 1;
      continue;
    }
    // A formula rewritten by a row/column deletion keeps an explicit `#REF!`
    // marker, which renders as the spreadsheet reference error.
    if (source.startsWith("#REF!", index)) throw new FormulaError(FORMULA_ERROR.reference);
    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(source[index + 1] ?? ""))) {
      let end = index;
      while (end < source.length && /[0-9.]/.test(source[end])) end += 1;
      if (/[eE]/.test(source[end] ?? "") && /[0-9+-]/.test(source[end + 1] ?? "")) {
        end += 1;
        if (/[+-]/.test(source[end] ?? "")) end += 1;
        while (end < source.length && /[0-9]/.test(source[end])) end += 1;
      }
      tokens.push({ type: "number", value: source.slice(index, end) });
      index = end;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      let end = index;
      while (end < source.length && /[A-Za-z0-9_$.]/.test(source[end])) end += 1;
      tokens.push({ type: "name", value: source.slice(index, end) });
      index = end;
      continue;
    }
    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      index += 1;
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "comma", value: char });
      index += 1;
      continue;
    }
    if (char === ":") {
      tokens.push({ type: "colon", value: char });
      index += 1;
      continue;
    }
    throw new FormulaError(FORMULA_ERROR.parse);
  }
  return tokens;
}

function reference(text: string): string | null {
  const match = CELL_PATTERN.exec(text);
  return match ? `${match[2].toUpperCase()}${match[4]}` : null;
}

function parseFormula(source: string, names?: Map<string, NamedRangeReference>): Node {
  const tokens = tokenize(source);
  let position = 0;
  const peek = (): Token | undefined => tokens[position];

  function parseExpression(): Node {
    let node = parseTerm();
    while (peek()?.type === "operator" && (peek()?.value === "+" || peek()?.value === "-")) {
      const operator = tokens[position].value as "+" | "-";
      position += 1;
      node = { kind: "binary", operator, left: node, right: parseTerm() };
    }
    return node;
  }

  function parseTerm(): Node {
    let node = parseFactor();
    while (peek()?.type === "operator" && (peek()?.value === "*" || peek()?.value === "/")) {
      const operator = tokens[position].value as "*" | "/";
      position += 1;
      node = { kind: "binary", operator, left: node, right: parseFactor() };
    }
    return node;
  }

  function parseFactor(): Node {
    const token = peek();
    if (!token) throw new FormulaError(FORMULA_ERROR.parse);
    if (token.type === "operator" && (token.value === "-" || token.value === "+")) {
      position += 1;
      return { kind: "unary", operator: token.value, operand: parseFactor() };
    }
    if (token.type === "number") {
      position += 1;
      return { kind: "number", value: Number(token.value) };
    }
    if (token.type === "name") {
      position += 1;
      if (peek()?.type === "paren" && peek()?.value === "(") {
        position += 1;
        const args: Node[] = [];
        if (!(peek()?.type === "paren" && peek()?.value === ")")) {
          args.push(parseExpression());
          while (peek()?.type === "comma") {
            position += 1;
            args.push(parseExpression());
          }
        }
        const close = peek();
        if (!(close?.type === "paren" && close.value === ")")) throw new FormulaError(FORMULA_ERROR.parse);
        position += 1;
        return { kind: "call", name: token.value.toUpperCase(), args };
      }
      const start = reference(token.value);
      if (!start) {
        // A saved name of the workbook resolves to the sheet-qualified area it
        // refers to, so `=SUM(CapacityPlan)` sums the cells of that area.
        const named = names?.get(token.value.toLowerCase());
        if (named) {
          return { kind: "named", sheet: named.sheet, start: named.start, end: named.end };
        }
        // An address-shaped token that is not a valid cell is a broken
        // reference; any other bare name is an unsupported function/name.
        throw new FormulaError(
          REFERENCE_SHAPE.test(token.value) ? FORMULA_ERROR.reference : FORMULA_ERROR.name,
        );
      }
      if (peek()?.type === "colon") {
        position += 1;
        const last = peek();
        const end = last?.type === "name" ? reference(last.value) : null;
        if (!end) {
          if (last?.type === "name" && REFERENCE_SHAPE.test(last.value)) {
            throw new FormulaError(FORMULA_ERROR.reference);
          }
          throw new FormulaError(FORMULA_ERROR.parse);
        }
        position += 1;
        return { kind: "range", start, end };
      }
      return { kind: "ref", coordinate: start };
    }
    if (token.type === "paren" && token.value === "(") {
      position += 1;
      const node = parseExpression();
      const close = peek();
      if (!(close?.type === "paren" && close.value === ")")) throw new FormulaError(FORMULA_ERROR.parse);
      position += 1;
      return node;
    }
    throw new FormulaError(FORMULA_ERROR.parse);
  }

  const node = parseExpression();
  if (position !== tokens.length) throw new FormulaError(FORMULA_ERROR.parse);
  return node;
}

interface Engine {
  /** Raw cells of the worksheet this engine calculates. */
  cells: CellValues;
  /** Name of that worksheet, used to recognise its own named ranges. */
  sheetName: string;
  /** Raw cells of every known worksheet, keyed by lowercase sheet name. */
  sheetCells: Record<string, CellValues>;
  /** Named ranges of the workbook, keyed by lowercase name. */
  names: Map<string, NamedRangeReference>;
  /** Engines of the other worksheets, so a name on another sheet resolves once. */
  sheetEngines: Map<string, Engine>;
  /** Sheets already being resolved, so a circular name cannot recurse. */
  visitingSheets: Set<string>;
  memo: Map<string, number>;
  visiting: Set<string>;
}

/**
 * Workbook context of a calculation: the worksheet the cells belong to plus the
 * workbook's named ranges and the raw cells of its other worksheets, so a saved
 * name that refers to another sheet still resolves.
 */
export interface FormulaScope {
  /** Name of the worksheet `cells` belong to. */
  sheetName?: string;
  /** Saved names of the workbook; each works as a range reference. */
  namedRanges?: NamedRange[];
  /** Raw cells per worksheet name, used by a name on another sheet. */
  worksheetCells?: Record<string, CellValues>;
}

function createEngine(
  cells: CellValues,
  options: {
    sheetName?: string;
    names?: Map<string, NamedRangeReference>;
    sheetCells?: Record<string, CellValues>;
    sheetEngines?: Map<string, Engine>;
    visitingSheets?: Set<string>;
  } = {},
): Engine {
  return {
    cells,
    sheetName: options.sheetName ?? "",
    names: options.names ?? new Map(),
    sheetCells: options.sheetCells ?? {},
    sheetEngines: options.sheetEngines ?? new Map(),
    visitingSheets: options.visitingSheets ?? new Set(),
    memo: new Map(),
    visiting: new Set(),
  };
}

/** Engine of one calculation scope: its cells, names and sibling worksheets. */
function scopeEngine(cells: CellValues, scope: FormulaScope): Engine {
  const sheetCells: Record<string, CellValues> = {};
  for (const [name, map] of Object.entries(scope.worksheetCells ?? {})) {
    sheetCells[name.toLowerCase()] = map;
  }
  const names = new Map<string, NamedRangeReference>();
  for (const entry of scope.namedRanges ?? []) {
    const reference = parseNamedRangeReference(entry?.range);
    if (reference && typeof entry?.name === "string") names.set(entry.name.toLowerCase(), reference);
  }
  const sheetName = scope.sheetName ?? "";
  const visitingSheets = new Set<string>();
  if (sheetName !== "") {
    const key = sheetName.toLowerCase();
    if (sheetCells[key] === undefined) sheetCells[key] = cells;
    visitingSheets.add(key);
  }
  return createEngine(cells, { sheetName, names, sheetCells, visitingSheets });
}

/**
 * Engine reading the worksheet a named range lives on: this engine when the
 * range names the current sheet, otherwise a cached engine over that sheet's
 * cells. `null` means the sheet is unknown or the resolution is circular, which
 * surfaces as a reference error instead of an endless recursion.
 */
function namedRangeEngine(engine: Engine, sheet: string): Engine | null {
  const key = sheet.toLowerCase();
  if (engine.sheetName !== "" && engine.sheetName.toLowerCase() === key) return engine;
  const cached = engine.sheetEngines.get(key);
  if (cached) return cached;
  const cells = engine.sheetCells[key];
  if (!cells || engine.visitingSheets.has(key)) return null;
  engine.visitingSheets.add(key);
  const nested = createEngine(cells, {
    sheetName: sheet,
    names: engine.names,
    sheetCells: engine.sheetCells,
    sheetEngines: engine.sheetEngines,
    visitingSheets: engine.visitingSheets,
  });
  engine.sheetEngines.set(key, nested);
  return nested;
}

function parseNode(engine: Engine, raw: string): Node {
  return parseFormula(raw.slice(1), engine.names);
}

function parseNumber(raw: string): number | null {
  const text = raw.trim();
  if (!text || !NUMBER_PATTERN.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Numeric value of a referenced cell used in arithmetic; blanks count as zero. */
function cellNumber(engine: Engine, coordinate: string): number {
  const raw = engine.cells[coordinate];
  if (raw === undefined || raw.trim() === "") return 0;
  if (raw.startsWith("=")) return evaluateFormula(engine, coordinate, raw);
  const parsed = parseNumber(raw);
  if (parsed === null) throw new FormulaError(FORMULA_ERROR.value);
  return parsed;
}

/** Numeric values contributed by one argument of an aggregate function. */
function aggregateNumbers(engine: Engine, node: Node): number[] {
  if (node.kind === "number") return [node.value];
  if (node.kind === "ref") {
    const value = aggregateCellValue(engine, node.coordinate);
    return value === null ? [] : [value];
  }
  if (node.kind === "range") {
    const values: number[] = [];
    for (const coordinate of rangeCoordinates(node.start, node.end)) {
      const value = aggregateCellValue(engine, coordinate);
      if (value !== null) values.push(value);
    }
    return values;
  }
  if (node.kind === "named") {
    const nested = namedRangeEngine(engine, node.sheet);
    if (!nested) throw new FormulaError(FORMULA_ERROR.reference);
    const values: number[] = [];
    for (const coordinate of rangeCoordinates(node.start, node.end)) {
      const value = aggregateCellValue(nested, coordinate);
      if (value !== null) values.push(value);
    }
    return values;
  }
  return [evaluateNumber(engine, node)];
}

/**
 * Numeric value one referenced cell contributes to an aggregate, or `null` when
 * the cell is not numeric. Aggregates see only numeric cells: blanks and text
 * are skipped instead of counted as zero, and a formula cell counts through its
 * calculated result, so a formula whose result is text is skipped as well. A
 * referenced error still propagates, exactly as the error would in the grid.
 */
function aggregateCellValue(engine: Engine, coordinate: string): number | null {
  const raw = engine.cells[coordinate];
  if (raw === undefined || raw.trim() === "") return null;
  if (!raw.startsWith("=")) return parseNumber(raw);
  const node = parseNode(engine, raw);
  // A bare reference becomes the referenced value, so a formula that only
  // forwards a text cell is skipped like the text cell itself.
  if (node.kind === "ref") {
    return parseNumber(referenceDisplay(engine, node.coordinate, new Set([coordinate])));
  }
  return evaluateFormula(engine, coordinate, raw);
}

function rangeCoordinates(start: string, end: string): string[] {
  const a = /^([A-Z]+)([0-9]+)$/.exec(start);
  const b = /^([A-Z]+)([0-9]+)$/.exec(end);
  if (!a || !b) throw new FormulaError(FORMULA_ERROR.reference);
  const toIndex = (letters: string) => {
    let value = 0;
    for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64);
    return value;
  };
  const toLetters = (column: number) => {
    let value = column;
    let name = "";
    while (value > 0) {
      const remainder = (value - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      value = Math.floor((value - 1) / 26);
    }
    return name;
  };
  const top = Math.min(Number(a[2]), Number(b[2]));
  const bottom = Math.max(Number(a[2]), Number(b[2]));
  const left = Math.min(toIndex(a[1]), toIndex(b[1]));
  const right = Math.max(toIndex(a[1]), toIndex(b[1]));
  const coordinates: string[] = [];
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      coordinates.push(`${toLetters(column)}${row}`);
    }
  }
  return coordinates;
}

function evaluateNumber(engine: Engine, node: Node): number {
  switch (node.kind) {
    case "number":
      return node.value;
    case "ref":
      return cellNumber(engine, node.coordinate);
    case "unary": {
      const value = evaluateNumber(engine, node.operand);
      return node.operator === "-" ? -value : value;
    }
    case "binary": {
      const left = evaluateNumber(engine, node.left);
      const right = evaluateNumber(engine, node.right);
      switch (node.operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        default:
          if (right === 0) throw new FormulaError(FORMULA_ERROR.divideByZero);
          return left / right;
      }
    }
    case "range":
      throw new FormulaError(FORMULA_ERROR.value);
    case "named": {
      const nested = namedRangeEngine(engine, node.sheet);
      if (!nested) throw new FormulaError(FORMULA_ERROR.reference);
      // Only a single-cell name is a value; an area needs an aggregate around it.
      if (node.start !== node.end) throw new FormulaError(FORMULA_ERROR.value);
      return cellNumber(nested, node.start);
    }
    default:
      return evaluateCall(engine, node.name, node.args);
  }
}

function evaluateCall(engine: Engine, name: string, args: Node[]): number {
  if (!["SUM", "AVERAGE", "COUNT", "MIN", "MAX"].includes(name)) {
    throw new FormulaError(FORMULA_ERROR.name);
  }
  const values = args.flatMap((argument) => aggregateNumbers(engine, argument));
  switch (name) {
    case "COUNT":
      return values.length;
    case "SUM":
      return values.reduce((total, value) => total + value, 0);
    case "AVERAGE":
      if (values.length === 0) throw new FormulaError(FORMULA_ERROR.divideByZero);
      return values.reduce((total, value) => total + value, 0) / values.length;
    case "MIN":
      return values.length === 0 ? 0 : Math.min(...values);
    default:
      return values.length === 0 ? 0 : Math.max(...values);
  }
}

/**
 * Display text of a referenced cell when a formula's result *is* that
 * reference. A bare `=A1` shows the referenced cell's value: its text for a
 * text cell, its formatted number for a numeric one, its calculated result for
 * a formula, and `0` for a blank (the same blank-as-zero rule arithmetic uses).
 * References used inside arithmetic keep the stricter numeric rules.
 */
function referenceDisplay(engine: Engine, coordinate: string, seen: Set<string>): string {
  const raw = engine.cells[coordinate];
  if (raw === undefined || raw.trim() === "") return "0";
  if (raw.startsWith("=")) {
    if (seen.has(coordinate)) throw new FormulaError(FORMULA_ERROR.reference);
    seen.add(coordinate);
    try {
      return formulaDisplay(engine, coordinate, raw, seen);
    } finally {
      seen.delete(coordinate);
    }
  }
  const parsed = parseNumber(raw);
  return parsed === null ? raw : formatNumber(parsed);
}

/** Result text of one formula cell: a referenced cell's value or a number. */
function formulaDisplay(engine: Engine, coordinate: string, raw: string, seen: Set<string>): string {
  const node = parseNode(engine, raw);
  if (node.kind === "ref") return referenceDisplay(engine, node.coordinate, seen);
  if (node.kind === "named" && node.start === node.end) {
    const nested = namedRangeEngine(engine, node.sheet);
    if (!nested) throw new FormulaError(FORMULA_ERROR.reference);
    return referenceDisplay(nested, node.start, seen);
  }
  return formatNumber(evaluateNumber(engine, node));
}

function evaluateFormula(engine: Engine, coordinate: string, raw: string): number {
  const cached = engine.memo.get(coordinate);
  if (cached !== undefined) return cached;
  if (engine.visiting.has(coordinate)) throw new FormulaError(FORMULA_ERROR.reference);
  engine.visiting.add(coordinate);
  try {
    const value = evaluateNumber(engine, parseNode(engine, raw));
    engine.memo.set(coordinate, value);
    return value;
  } finally {
    engine.visiting.delete(coordinate);
  }
}

/** Spreadsheet text for a calculated number, trimmed of floating point noise. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return FORMULA_ERROR.number;
  return String(Number(value.toPrecision(12)));
}

/**
 * Calculates the text the grid and the CSV export display for every cell.
 * Non-formula cells keep their raw text; formula cells render their result or
 * an error code, and referencing cells see the calculated result too.
 */
export function computeDisplayValues(cells: CellValues, scope: FormulaScope = {}): CellValues {
  const engine = scopeEngine(cells, scope);
  const values: CellValues = {};
  for (const [coordinate, raw] of Object.entries(cells)) {
    if (!raw.startsWith("=")) {
      values[coordinate] = raw;
      continue;
    }
    try {
      values[coordinate] = formulaDisplay(engine, coordinate, raw, new Set([coordinate]));
    } catch (error) {
      if (error instanceof FormulaError) {
        values[coordinate] = error.code;
        continue;
      }
      throw error;
    }
  }
  return values;
}
