import type { CellMap } from './types';
import { cellToCoordinate, columnLetter, coordinateToCell } from './gridUtils';

// Minimal formula evaluation used by the grid display and CSV export so
// that formula cells (values beginning with '=') show their calculated
// results instead of the raw expressions. Supports arithmetic (+ - * / ^,
// parentheses, unary minus), cell references (A1), and the aggregate
// functions SUM, AVERAGE, COUNT, MIN and MAX over contiguous ranges or
// argument lists. Function names are case-insensitive. Aggregate functions
// ignore empty cells and non-numeric text (COUNT counts only numeric
// cells; SUM/AVERAGE/MIN/MAX use only numeric cells and never treat blanks
// as zero), while plain arithmetic treats a reference to an empty cell as
// zero like common spreadsheet applications.

export type FormulaValue = number | string;

type Token =
  | { type: 'number'; value: number }
  | { type: 'cell'; coord: string }
  | { type: 'ident'; name: string }
  | { type: 'op'; op: '+' | '-' | '*' | '/' | '^' }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' }
  | { type: 'colon' }
  | { type: 'eof' };

// Stable visible tokens for formula errors (REQ-4-2-2). The grid displays
// exactly these values; the stored formula text is never replaced.
export const REF_ERROR = '#REF!';
export const DIV_ZERO_ERROR = '#DIV/0!';
export const NAME_ERROR = '#NAME?';
export const ERROR_TOKEN = '#ERROR!';

const ERROR_TOKENS = [REF_ERROR, DIV_ZERO_ERROR, NAME_ERROR, ERROR_TOKEN];

function isErrorToken(value: FormulaValue): value is string {
  return typeof value === 'string' && (ERROR_TOKENS as string[]).includes(value);
}

// Returns the error token embedded in a cell's raw text, if any. Literal
// error-token text behaves like the corresponding error when referenced.
function errorTokenIn(text: string): string | null {
  return ERROR_TOKENS.find((token) => text.includes(token)) ?? null;
}

class FormulaError extends Error {
  // Optional stable token carried by a propagated error so dependents show
  // the same visible error as the failing cell.
  readonly token?: string;

  constructor(message: string, token?: string) {
    super(message);
    this.token = token;
  }
}

// Explicit error produced when a formula reference cannot be preserved
// (structural change, off-grid translation, or a circular reference chain).
class FormulaRefError extends FormulaError {}

const MAX_DEPTH = 16;

function isNumeric(text: string): boolean {
  return /^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(text.trim());
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t') {
      i += 1;
      continue;
    }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let j = i;
      while (j < n && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) {
        j += 1;
      }
      const value = Number(src.slice(i, j));
      if (Number.isNaN(value)) {
        throw new FormulaError('Invalid number');
      }
      tokens.push({ type: 'number', value });
      i = j;
      continue;
    }
    if (/[A-Za-z$]/.test(ch)) {
      // Absolute-reference markers ($) are skipped: they only matter when a
      // formula is copied to another location, and the reference resolves to
      // the same coordinate for evaluation purposes.
      let j = i;
      while (j < n && /[A-Za-z$]/.test(src[j])) {
        j += 1;
      }
      const letters = src.slice(i, j).replace(/\$/g, '');
      if (j < n && src[j] >= '0' && src[j] <= '9') {
        let k = j;
        while (k < n && src[k] >= '0' && src[k] <= '9') {
          k += 1;
        }
        tokens.push({ type: 'cell', coord: letters + src.slice(j, k) });
        i = k;
      } else {
        tokens.push({ type: 'ident', name: letters.toUpperCase() });
        i = j;
      }
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^') {
      tokens.push({ type: 'op', op: ch });
      i += 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i += 1;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma' });
      i += 1;
      continue;
    }
    if (ch === ':') {
      tokens.push({ type: 'colon' });
      i += 1;
      continue;
    }
    throw new FormulaError('Unexpected character');
  }
  tokens.push({ type: 'eof' });
  return tokens;
}

function resolveCellValue(
  coord: string,
  cells: CellMap,
  depth: number,
  visiting: string[]
): FormulaValue {
  const raw = cells[coord] ?? '';
  if (raw.startsWith('=')) {
    // A reference back to a cell whose formula is already being evaluated
    // (direct or indirect) is a circular reference.
    if (visiting.includes(coord)) {
      throw new FormulaRefError(REF_ERROR);
    }
    const value = evaluateFormula(raw, cells, depth + 1, visiting.concat(coord));
    if (isErrorToken(value)) {
      throw new FormulaError('Referenced formula errored', value);
    }
    return value;
  }
  const token = errorTokenIn(raw);
  if (token) {
    throw new FormulaError('Referenced cell errored', token);
  }
  if (isNumeric(raw)) {
    return Number(raw.trim());
  }
  if (raw === '') {
    // In plain arithmetic a reference to an empty cell acts as zero
    // (aggregate functions handle blanks separately and ignore them).
    return 0;
  }
  return raw;
}

// Pushes the numeric value of a single cell onto out. Empty and text cells
// are ignored (aggregate functions only use numeric cells and never treat
// blanks as zero); formula cells are evaluated recursively. A formula that
// evaluates to an error token (e.g. #REF!, #DIV/0!) propagates that token.
function collectCellNumber(
  coord: string,
  cells: CellMap,
  depth: number,
  visiting: string[],
  out: number[]
): void {
  const raw = cells[coord] ?? '';
  if (raw.startsWith('=')) {
    if (visiting.includes(coord)) {
      throw new FormulaRefError(REF_ERROR);
    }
    const value = evaluateFormula(raw, cells, depth + 1, visiting.concat(coord));
    if (typeof value === 'number') {
      out.push(value);
    } else if (isErrorToken(value)) {
      throw new FormulaError('Referenced formula errored', value);
    }
    return;
  }
  const token = errorTokenIn(raw);
  if (token) {
    throw new FormulaError('Referenced cell errored', token);
  }
  if (isNumeric(raw)) {
    out.push(Number(raw.trim()));
  }
  // Empty or non-numeric text: ignored by aggregates.
}

function collectRangeNumbers(
  from: string,
  to: string,
  cells: CellMap,
  depth: number,
  visiting: string[],
  out: number[]
): void {
  const a = cellToCoordinate(from);
  const b = cellToCoordinate(to);
  if (!a || !b) {
    throw new FormulaError('Invalid range');
  }
  const minRow = Math.min(a.row, b.row);
  const maxRow = Math.max(a.row, b.row);
  const minCol = Math.min(a.column, b.column);
  const maxCol = Math.max(a.column, b.column);
  for (let r = minRow; r <= maxRow; r += 1) {
    for (let c = minCol; c <= maxCol; c += 1) {
      collectCellNumber(coordinateToCell(r, c), cells, depth, visiting, out);
    }
  }
}

class FormulaParser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly cells: CellMap,
    private readonly depth: number,
    private readonly visiting: string[]
  ) {}

  peek(): Token {
    return this.tokens[this.pos];
  }

  next(): Token {
    const token = this.tokens[this.pos];
    this.pos += 1;
    return token;
  }

  expect<T extends Token['type']>(type: T): Extract<Token, { type: T }> {
    const token = this.next();
    if (token.type !== type) {
      throw new FormulaError('Unexpected token');
    }
    return token as Extract<Token, { type: T }>;
  }

  expectEnd(): void {
    if (this.peek().type !== 'eof') {
      throw new FormulaError('Unexpected trailing tokens');
    }
  }

  parseExpr(): FormulaValue {
    let left = this.parseTerm();
    for (;;) {
      const token = this.peek();
      if (token.type === 'op' && (token.op === '+' || token.op === '-')) {
        this.next();
        const right = this.parseTerm();
        left = this.applyBinary(left, right, token.op);
      } else {
        return left;
      }
    }
  }

  parseTerm(): FormulaValue {
    let left = this.parseFactor();
    for (;;) {
      const token = this.peek();
      if (token.type === 'op' && (token.op === '*' || token.op === '/')) {
        this.next();
        const right = this.parseFactor();
        left = this.applyBinary(left, right, token.op);
      } else {
        return left;
      }
    }
  }

  parseFactor(): FormulaValue {
    const token = this.peek();
    if (token.type === 'op' && token.op === '-') {
      this.next();
      const value = this.parseFactor();
      if (typeof value !== 'number') {
        throw new FormulaError('Cannot negate text');
      }
      return -value;
    }
    const base = this.parsePrimary();
    const next = this.peek();
    if (next.type === 'op' && next.op === '^') {
      this.next();
      const exponent = this.parseFactor();
      if (typeof base !== 'number' || typeof exponent !== 'number') {
        throw new FormulaError('Exponent requires numbers');
      }
      return Math.pow(base, exponent);
    }
    return base;
  }

  parsePrimary(): FormulaValue {
    const token = this.next();
    switch (token.type) {
      case 'number':
        return token.value;
      case 'cell':
        return resolveCellValue(token.coord, this.cells, this.depth, this.visiting);
      case 'ident':
        return this.parseFunction(token.name);
      case 'lparen': {
        const value = this.parseExpr();
        this.expect('rparen');
        return value;
      }
      default:
        throw new FormulaError('Unexpected token');
    }
  }

  // SUM, AVERAGE, COUNT, MIN and MAX. Arguments are contiguous ranges
  // (A1:B2) or expressions; bare cell references and range cells that are
  // empty or non-numeric are ignored, so aggregate functions never treat
  // blanks as zero. Nested expressions must evaluate to numbers.
  parseFunction(name: string): number {
    this.expect('lparen');
    const numbers: number[] = [];
    for (;;) {
      const first = this.peek();
      if (first.type === 'cell' && this.tokens[this.pos + 1]?.type === 'colon') {
        this.next();
        this.next();
        const second = this.expect('cell');
        collectRangeNumbers(first.coord, second.coord, this.cells, this.depth, this.visiting, numbers);
      } else if (first.type === 'cell') {
        // A bare cell argument: use only its numeric value when it is one.
        this.next();
        collectCellNumber(first.coord, this.cells, this.depth, this.visiting, numbers);
      } else {
        const value = this.parseExpr();
        if (typeof value === 'number') {
          numbers.push(value);
        }
      }
      const token = this.peek();
      if (token.type === 'comma') {
        this.next();
        continue;
      }
      break;
    }
    this.expect('rparen');
    switch (name) {
      case 'SUM':
        return numbers.reduce((total, n) => total + n, 0);
      case 'AVERAGE': {
        if (numbers.length === 0) {
          throw new FormulaError('Division by zero');
        }
        return numbers.reduce((total, n) => total + n, 0) / numbers.length;
      }
      case 'COUNT':
        return numbers.length;
      case 'MIN':
        return numbers.length === 0 ? 0 : Math.min(...numbers);
      case 'MAX':
        return numbers.length === 0 ? 0 : Math.max(...numbers);
      default:
        throw new FormulaError('Unknown function ' + name);
    }
  }

  applyBinary(
    left: FormulaValue,
    right: FormulaValue,
    op: '+' | '-' | '*' | '/'
  ): FormulaValue {
    if (typeof left !== 'number' || typeof right !== 'number') {
      throw new FormulaError('Arithmetic requires numbers');
    }
    switch (op) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        if (right === 0) {
          throw new FormulaError('Division by zero');
        }
        return left / right;
      default:
        throw new FormulaError('Unknown operator');
    }
  }
}

export function evaluateFormula(
  formula: string,
  cells: CellMap,
  depth = 0,
  visiting: string[] = []
): FormulaValue {
  const src = formula.trim().replace(/^=/, '');
  if (src === '') {
    return '';
  }
  if (src.includes(REF_ERROR)) {
    return REF_ERROR;
  }
  if (depth > MAX_DEPTH) {
    // Safety net: with the visiting-stack cycle detector below, exceeding
    // the depth limit indicates an unresolvable circular nesting chain.
    return REF_ERROR;
  }
  try {
    const parser = new FormulaParser(tokenize(src), cells, depth, visiting);
    const value = parser.parseExpr();
    parser.expectEnd();
    return value;
  } catch (err) {
    if (err instanceof FormulaRefError) {
      return REF_ERROR;
    }
    if (err instanceof FormulaError) {
      if (err.token) {
        return err.token;
      }
      if (err.message === 'Division by zero') {
        return DIV_ZERO_ERROR;
      }
      if (err.message.startsWith('Unknown function ')) {
        return NAME_ERROR;
      }
      return ERROR_TOKEN;
    }
    return ERROR_TOKEN;
  }
}

export function formatFormulaValue(value: FormulaValue): string {
  if (typeof value === 'number') {
    return Object.is(value, -0) ? '0' : String(value);
  }
  return value;
}

// Rewrites cell references inside a copied formula so relative references
// follow the paste offset while absolute references (marked with $) stay
// unchanged. A relative reference that would move off the grid becomes
// #REF!, matching the structural-change convention. When the optional
// bounds (the target sheet's dimensions) are given, references that would
// move beyond the bottom/right edge are also flagged as #REF!; without
// bounds only the top/left edge (row < 1 or column < 1) is enforced.
// Non-reference text (numbers, operators, function names) passes through
// untouched.
export interface FormulaTranslationBounds {
  rowCount: number;
  columnCount: number;
}

export function translateFormulaRefs(
  formula: string,
  rowOffset: number,
  colOffset: number,
  bounds?: FormulaTranslationBounds
): string {
  if (rowOffset === 0 && colOffset === 0) {
    return formula;
  }
  const maxRow = bounds ? bounds.rowCount : Number.POSITIVE_INFINITY;
  const maxCol = bounds ? bounds.columnCount : Number.POSITIVE_INFINITY;
  let out = '';
  let i = 0;
  const n = formula.length;
  while (i < n) {
    const ch = formula[i];
    if (/[A-Za-z]/.test(ch) || ch === '$') {
      let j = i;
      let colAbs = false;
      let rowAbs = false;
      if (ch === '$') {
        colAbs = true;
        j += 1;
      }
      const letterStart = j;
      while (j < n && /[A-Za-z]/.test(formula[j])) {
        j += 1;
      }
      const letters = formula.slice(letterStart, j);
      if (j < n && formula[j] === '$') {
        rowAbs = true;
        j += 1;
      }
      if (j < n && formula[j] >= '0' && formula[j] <= '9') {
        let k = j;
        while (k < n && formula[k] >= '0' && formula[k] <= '9') {
          k += 1;
        }
        const row1 = Number(formula.slice(j, k));
        const coord = cellToCoordinate(letters + '1');
        if (letters.length > 0 && coord && row1 >= 1) {
          let newCol = coord.column + 1;
          let newRow = row1;
          if (!colAbs) {
            newCol += colOffset;
          }
          if (!rowAbs) {
            newRow += rowOffset;
          }
          if (newCol < 1 || newRow < 1 || newCol > maxCol || newRow > maxRow) {
            out += REF_ERROR;
          } else {
            out +=
              (colAbs ? '$' : '') +
              columnLetter(newCol - 1) +
              (rowAbs ? '$' : '') +
              newRow;
          }
          i = k;
          continue;
        }
      }
      // Not a cell reference: copy the raw slice (preserving $ markers).
      out += formula.slice(i, j);
      i = j;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}
