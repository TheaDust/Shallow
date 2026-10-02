import type { PivotTable, ValidationRule, Workbook, WorkbookSummary, Worksheet, WorksheetFilter } from "../domain/workbook";

/**
 * Minimal in-memory stand-in for the workbook HTTP API used by component tests.
 * It mirrors the request/response shapes of the backend without a network or DOM server.
 */
export interface FakeBackend {
  workbooks: Workbook[];
  calls: Array<{ method: string; path: string }>;
  fetch: typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "workbook";
}

const INVALID_CSV = "Invalid CSV file format. Import failed.";

/** Compact RFC 4180 parser mirroring the server's rules for component tests. */
function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  while (index < text.length) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 2; continue; }
        inQuotes = false; index += 1; continue;
      }
      field += character; index += 1; continue;
    }
    if (character === '"' && field === "") { inQuotes = true; index += 1; continue; }
    if (character === ",") { endField(); index += 1; continue; }
    if (character === "\r") { if (text[index + 1] === "\n") index += 1; endRow(); index += 1; continue; }
    if (character === "\n") { endRow(); index += 1; continue; }
    field += character; index += 1;
  }
  if (inQuotes) throw new Error(INVALID_CSV);
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

function columnLabel(col: number): string {
  let label = "";
  let value = col;
  do { label = String.fromCharCode(65 + (value % 26)) + label; value = Math.floor(value / 26) - 1; } while (value >= 0);
  return label;
}

interface FakeCellRef { row: number; col: number; }

function countOf(value: unknown): number {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : 0;
}

function readCellName(name: string): FakeCellRef | null {
  const match = /^([A-Z]{1,3})([1-9][0-9]*)$/.exec(name.toUpperCase());
  if (!match) return null;
  let col = 0;
  for (const character of match[1]) col = col * 26 + (character.charCodeAt(0) - 64);
  return { row: Number(match[2]) - 1, col: col - 1 };
}

/**
 * A1-style reference (optionally an `A1:B2` pair) inside a formula; mirrors the
 * server pattern so the fixture rewrites references the same way.
 */
const FAKE_REFERENCE = /(?<![A-Za-z0-9_])(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*)(?::(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*))?(?![A-Za-z0-9_(])/g;

/**
 * Formula rewrite of one structure change, mirroring `adjustCellReferences`
 * (`backend/src/domain/structure.mjs`): an insert moves every reference at or
 * after the insertion point, a delete drops the removed coordinate (`#REF!`)
 * and pulls the later ones up/left. `at` is the insertion point for an insert
 * and the removed coordinate for a delete.
 */
function rewriteReferences(value: string, axis: "row" | "column", at: number, deleting: boolean): string {
  const key = axis === "row" ? "row" : "col";
  const render = (point: FakeCellRef, absCol: string, absRow: string) =>
    `${absCol}${columnLabel(point.col)}${absRow}${point.row + 1}`;
  const shift = (point: FakeCellRef, delta: number): FakeCellRef => (key === "row"
    ? { row: point.row + delta, col: point.col }
    : { row: point.row, col: point.col + delta });
  const single = (point: FakeCellRef): FakeCellRef | null => {
    if (!deleting) return point[key] >= at ? shift(point, 1) : point;
    if (point[key] > at) return shift(point, -1);
    return point[key] === at ? null : point;
  };
  return value.replace(
    FAKE_REFERENCE,
    (match, absCol1: string, letters1: string, absRow1: string, digits1: string,
      absCol2?: string, letters2?: string, absRow2?: string, digits2?: string) => {
      const first = readCellName(`${letters1}${digits1}`);
      if (!first) return match;
      if (letters2 === undefined || digits2 === undefined || absCol2 === undefined || absRow2 === undefined) {
        const moved = single(first);
        return moved ? render(moved, absCol1, absRow1) : "#REF!";
      }
      const second = readCellName(`${letters2}${digits2}`);
      if (!second) return match;
      const low = Math.min(first[key], second[key]);
      const high = Math.max(first[key], second[key]);
      if (high < at) return match;
      if (!deleting) {
        if (low >= at) {
          return `${render(shift(first, 1), absCol1, absRow1)}:${render(shift(second, 1), absCol2, absRow2)}`;
        }
        const movedFirst = single(first);
        const movedSecond = single(second);
        return movedFirst && movedSecond
          ? `${render(movedFirst, absCol1, absRow1)}:${render(movedSecond, absCol2, absRow2)}`
          : "#REF!";
      }
      if (low > at) {
        return `${render(shift(first, -1), absCol1, absRow1)}:${render(shift(second, -1), absCol2, absRow2)}`;
      }
      if (high - 1 < low) return "#REF!";
      const shrink = (point: FakeCellRef) => (point[key] === high ? shift(point, -1) : point);
      return `${render(shrink(first), absCol1, absRow1)}:${render(shrink(second), absCol2, absRow2)}`;
    },
  );
}

/** Formula text: only `=`-prefixed input is rewritten, other values stay as they are. */
function adjustFakeFormula(value: string, axis: "row" | "column", at: number, deleting: boolean): string {
  if (typeof value !== "string" || !value.startsWith("=")) return value;
  return rewriteReferences(value, axis, at, deleting);
}

/** Worksheet fields the structure shift and the rule enforcement touch. */
interface FakeWorksheet {
  cells: Record<string, string>;
  rowCount: number;
  columnCount: number;
  usedRows?: number;
  usedCols?: number;
  validations?: ValidationRule[];
  filter?: WorksheetFilter;
  pivot?: FakePivot;
}

/** Stored pivot configuration of one result worksheet (REQ-5-3-1). */
type FakePivot = PivotTable;

const PIVOT_MISSING_FIELD = "Pivot field is no longer available. Select a new field.";
const PIVOT_NON_NUMERIC = "Value field requires numeric values";
const PIVOT_SOURCE_RANGE = "The pivot source range is no longer available. Select a new range.";
const PIVOT_SELECT_FIELDS = "Select a row field and a value field.";
const PIVOT_NUMBER_TEXT = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Header row of a pivot source range, mirroring `pivotHeaderColumns`. */
function fakePivotHeaders(worksheet: FakeWorksheet, rangeText: string) {
  const region = readRange(rangeText);
  const headers: Array<{ name: string; col: number }> = [];
  if (!region) return { region: null, headers };
  const seen = new Set<string>();
  for (let col = region.minCol; col <= region.maxCol; col += 1) {
    const name = (worksheet.cells[`${columnLabel(col)}${region.minRow + 1}`] ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    headers.push({ name, col });
  }
  return { region, headers };
}

function fakePivotBucket() {
  return { numbers: [] as number[], count: 0 };
}

function fakePivotAdd(bucket: { numbers: number[]; count: number }, text: string): void {
  const trimmed = text.trim();
  if (trimmed === "") return;
  bucket.count += 1;
  if (PIVOT_NUMBER_TEXT.test(trimmed)) bucket.numbers.push(Number(trimmed));
}

function fakePivotAggregate(bucket: { numbers: number[]; count: number }, summarizeBy: string): string {
  if (summarizeBy === "COUNT") return String(bucket.count);
  if (!bucket.numbers.length) return "0";
  const total = bucket.numbers.reduce((sum, value) => sum + value, 0);
  const result = summarizeBy === "AVERAGE" ? total / bucket.numbers.length : total;
  return String(Math.round(result * 1e12) / 1e12);
}

/**
 * Mirrors `computePivotResult` (`backend/src/domain/pivot.mjs`) so component
 * tests see the same layout, aggregation and rejection messages.
 */
function fakeComputePivot(
  worksheet: FakeWorksheet,
  pivot: FakePivot,
): { error?: string; cells?: Record<string, string>; usedRows?: number; usedCols?: number } {
  const { region, headers } = fakePivotHeaders(worksheet, pivot.sourceRange);
  if (!region) return { error: PIVOT_SOURCE_RANGE };
  const columnOf = new Map(headers.map((header) => [header.name, header.col]));
  const { rowField, valueField, columnField } = pivot;
  const summarizeBy = pivot.summarizeBy.trim().toUpperCase();
  if (!rowField || !valueField) return { error: PIVOT_SELECT_FIELDS };
  if (!["SUM", "COUNT", "AVERAGE"].includes(summarizeBy)) return { error: `Unknown summarization method: ${pivot.summarizeBy}` };
  const rowCol = columnOf.get(rowField);
  const valueCol = columnOf.get(valueField);
  if (rowCol === undefined || valueCol === undefined) return { error: PIVOT_MISSING_FIELD };
  let columnCol: number | null = null;
  if (columnField) {
    const found = columnOf.get(columnField);
    if (found === undefined) return { error: PIVOT_MISSING_FIELD };
    columnCol = found;
  }
  const rowLabels: string[] = [];
  const columnLabels: string[] = [];
  const cellsByKey = new Map<string, { numbers: number[]; count: number }>();
  const rowTotals: Array<{ numbers: number[]; count: number }> = [];
  const columnTotals: Array<{ numbers: number[]; count: number }> = [];
  const grand = fakePivotBucket();
  let numericCount = 0;
  const bucketFor = (key: string): { numbers: number[]; count: number } => {
    const existing = cellsByKey.get(key);
    if (existing) return existing;
    const bucket = fakePivotBucket();
    cellsByKey.set(key, bucket);
    return bucket;
  };
  for (let row = region.minRow + 1; row <= region.maxRow; row += 1) {
    const values: string[] = [];
    let empty = true;
    for (let col = region.minCol; col <= region.maxCol; col += 1) {
      const text = worksheet.cells[`${columnLabel(col)}${row + 1}`] ?? "";
      if (text.trim() !== "") empty = false;
      values.push(text);
    }
    if (empty) continue;
    const rowGroup = values[rowCol - region.minCol].trim();
    const columnGroup = columnCol === null ? "" : values[columnCol - region.minCol].trim();
    const valueText = values[valueCol - region.minCol];
    if (valueText.trim() !== "" && PIVOT_NUMBER_TEXT.test(valueText.trim())) numericCount += 1;
    let rowIndex = rowLabels.indexOf(rowGroup);
    if (rowIndex === -1) { rowLabels.push(rowGroup); rowIndex = rowLabels.length - 1; }
    let columnIndex = 0;
    if (columnCol !== null) {
      columnIndex = columnLabels.indexOf(columnGroup);
      if (columnIndex === -1) { columnLabels.push(columnGroup); columnIndex = columnLabels.length - 1; }
    }
    fakePivotAdd(bucketFor(`${rowIndex}|${columnIndex}`), valueText);
    rowTotals[rowIndex] ??= fakePivotBucket();
    fakePivotAdd(rowTotals[rowIndex], valueText);
    if (columnCol !== null) {
      columnTotals[columnIndex] ??= fakePivotBucket();
      fakePivotAdd(columnTotals[columnIndex], valueText);
    }
    fakePivotAdd(grand, valueText);
  }
  if (summarizeBy !== "COUNT" && numericCount === 0) return { error: PIVOT_NON_NUMERIC };
  const method = summarizeBy as PivotTable["summarizeBy"];

  const cells: Record<string, string> = {};
  const set = (row: number, col: number, text: string) => {
    if (text !== "") cells[`${columnLabel(col)}${row + 1}`] = text;
  };
  set(0, 0, rowField);
  if (columnCol === null) {
    set(0, 1, `${method} of ${valueField}`);
    rowLabels.forEach((label, rowIndex) => {
      set(rowIndex + 1, 0, label);
      set(rowIndex + 1, 1, fakePivotAggregate(rowTotals[rowIndex], method));
    });
    set(rowLabels.length + 1, 0, "Grand Total");
    set(rowLabels.length + 1, 1, fakePivotAggregate(grand, method));
    return { cells, usedRows: rowLabels.length + 2, usedCols: 2 };
  }
  columnLabels.forEach((label, columnIndex) => set(0, columnIndex + 1, label));
  set(0, columnLabels.length + 1, "Grand Total");
  rowLabels.forEach((label, rowIndex) => {
    set(rowIndex + 1, 0, label);
    columnLabels.forEach((_, columnIndex) => {
      set(rowIndex + 1, columnIndex + 1, fakePivotAggregate(bucketFor(`${rowIndex}|${columnIndex}`), method));
    });
    set(rowIndex + 1, columnLabels.length + 1, fakePivotAggregate(rowTotals[rowIndex], method));
  });
  set(rowLabels.length + 1, 0, "Grand Total");
  columnLabels.forEach((_, columnIndex) => {
    set(rowLabels.length + 1, columnIndex + 1, fakePivotAggregate(columnTotals[columnIndex], method));
  });
  set(rowLabels.length + 1, columnLabels.length + 1, fakePivotAggregate(grand, method));
  return { cells, usedRows: rowLabels.length + 2, usedCols: columnLabels.length + 2 };
}

/** Replaces the whole summary of one pivot worksheet with a fresh computation. */
function applyFakePivotResult(
  worksheet: FakeWorksheet,
  result: { cells?: Record<string, string>; usedRows?: number; usedCols?: number },
): void {
  worksheet.cells = result.cells ?? {};
  worksheet.usedRows = result.usedRows ?? 0;
  worksheet.usedCols = result.usedCols ?? 0;
  worksheet.rowCount = Math.max(20, worksheet.usedRows + 1);
  worksheet.columnCount = Math.max(8, worksheet.usedCols + 1);
}

/**
 * Mirrors the server's range sort (`backend/src/domain/sort.mjs`): the rows of
 * the selected rectangle are permuted (a declared header row stays in place),
 * whole records move together, and coordinates outside the rectangle keep their
 * value. Values are compared by the type of the key column.
 */
const FAKE_NUMBER_TEXT = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function fakeColumnType(values: string[]): "number" | "date" | "text" {
  const present = values.filter((value) => value.trim() !== "");
  if (!present.length) return "text";
  if (present.every((value) => FAKE_NUMBER_TEXT.test(value.trim()))) return "number";
  if (present.every((value) => Number.isFinite(Date.parse(value.trim())))) return "date";
  return "text";
}

function fakeCompare(left: string, right: string, type: "number" | "date" | "text"): number {
  const leftBlank = left.trim() === "";
  const rightBlank = right.trim() === "";
  if (leftBlank || rightBlank) {
    if (leftBlank && rightBlank) return 0;
    return leftBlank ? 1 : -1;
  }
  if (type === "number") return Number(left.trim()) - Number(right.trim());
  if (type === "date") return Date.parse(left.trim()) - Date.parse(right.trim());
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function applyFakeSort(worksheet: FakeWorksheet, body: Record<string, unknown>): string | null {
  const range = readRange(String(body.range ?? ""));
  if (!range) return `Invalid sort range: ${String(body.range)}`;
  const order = String(body.order ?? "").toLowerCase();
  if (order !== "ascending" && order !== "descending") return `Unknown sort order: ${String(body.order)}`;
  const hasHeaderRow = body.hasHeaderRow === true;
  const firstDataRow = range.minRow + (hasHeaderRow ? 1 : 0);
  if (firstDataRow > range.maxRow) return "Select a range with data rows to sort";
  const column = Number(body.column);
  if (!Number.isInteger(column) || column < range.minCol || column > range.maxCol) {
    return "Sort column is outside the selected range";
  }
  const rows: string[][] = [];
  for (let row = range.minRow; row <= range.maxRow; row += 1) {
    const values: string[] = [];
    for (let col = range.minCol; col <= range.maxCol; col += 1) {
      values.push(worksheet.cells[`${columnLabel(col)}${row + 1}`] ?? "");
    }
    rows.push(values);
  }
  const header = hasHeaderRow ? rows.slice(0, 1) : [];
  const data = hasHeaderRow ? rows.slice(1) : rows;
  const keyOffset = column - range.minCol;
  const type = fakeColumnType(data.map((values) => values[keyOffset]));
  const sorted = data
    .map((values, index) => ({ values, index }))
    .sort((left, right) => {
      const key = fakeCompare(left.values[keyOffset], right.values[keyOffset], type);
      const directional = left.values[keyOffset].trim() === "" || right.values[keyOffset].trim() === ""
        ? key
        : (order === "descending" ? -key : key);
      return directional || left.index - right.index;
    })
    .map((entry) => entry.values);
  [...header, ...sorted].forEach((values, offset) => {
    const row = range.minRow + offset;
    values.forEach((value, colOffset) => {
      const name = `${columnLabel(range.minCol + colOffset)}${row + 1}`;
      if (value === "") delete worksheet.cells[name];
      else worksheet.cells[name] = value;
    });
  });
  return null;
}

/**
 * Mirrors the server's shift of the stored validation rule ranges and filter
 * region (`shiftWorksheetStructure`): an insert moves or grows a range, a delete
 * pulls it up/left, and a range that no longer exists drops its rule/filter.
 */
function applyFakeRanges(worksheet: FakeWorksheet, axis: "row" | "column", at: number, deleting: boolean): void {
  if (Array.isArray(worksheet.validations)) {
    worksheet.validations = worksheet.validations.flatMap((rule) => {
      const range = rewriteReferences(String(rule.range ?? ""), axis, at, deleting);
      return range === "#REF!" ? [] : [{ ...rule, range }];
    });
  }
  if (worksheet.filter) {
    const range = rewriteReferences(String(worksheet.filter.range ?? ""), axis, at, deleting);
    if (range === "#REF!") delete worksheet.filter;
    else worksheet.filter = { ...worksheet.filter, range };
  }
}

/**
 * Mirrors the server's row/column shift for component tests: values move with
 * their coordinates, the target coordinate is dropped on delete, formulas keep
 * adjusted references (an unpreservable one becomes `#REF!`), and the stored
 * validation/filter ranges travel with the cells they constrain.
 */
function applyFakeStructure(
  worksheet: FakeWorksheet,
  axis: "row" | "column",
  action: string,
  index: number,
): void {
  const key = axis === "row" ? "row" : "col";
  const deleting = action === "delete";
  const at = deleting
    ? index
    : (action === "insert-above" || action === "insert-left" ? index : index + 1);
  const cells: Record<string, string> = {};
  for (const [name, value] of Object.entries(worksheet.cells)) {
    const ref = readCellName(name);
    if (!ref) continue;
    if (deleting && ref[key] === index) continue;
    if (deleting && ref[key] > index) ref[key] -= 1;
    if (!deleting && ref[key] >= at) ref[key] += 1;
    cells[`${columnLabel(ref.col)}${ref.row + 1}`] = adjustFakeFormula(value, axis, at, deleting);
  }
  worksheet.cells = cells;
  if (axis === "row") {
    const used = worksheet.usedRows ?? 0;
    worksheet.usedRows = deleting
      ? (index < used ? Math.max(used - 1, 0) : used)
      : (at < used ? used + 1 : used);
    if (!deleting) worksheet.rowCount = Math.max(worksheet.rowCount, at + 1, (worksheet.usedRows ?? 0) + 1);
  } else {
    const used = worksheet.usedCols ?? 0;
    worksheet.usedCols = deleting
      ? (index < used ? Math.max(used - 1, 0) : used)
      : (at < used ? used + 1 : used);
    if (!deleting) worksheet.columnCount = Math.max(worksheet.columnCount, at + 1, (worksheet.usedCols ?? 0) + 1);
  }
  applyFakeRanges(worksheet, axis, at, deleting);
}

/** Allowed values of a dropdown rule, trimmed and without empty entries. */
function fakeAllowedValues(rule: ValidationRule): string[] {
  if (!Array.isArray(rule.values)) return [];
  return rule.values.map((value) => String(value).trim()).filter((value) => value !== "");
}

/** Rejection message of one rule, mirroring `validationMessage` on the server. */
function fakeValidationMessage(rule: ValidationRule): string {
  const stored = typeof rule.message === "string" ? rule.message.trim() : "";
  if (stored) return stored;
  if (rule.type === "list") {
    const values = fakeAllowedValues(rule);
    if (values.length) return `Please select one of the following values: ${values.join(", ")}`;
  }
  const min = Number(rule.min);
  const max = Number(rule.max);
  if (rule.type === "number-between" && Number.isFinite(min) && Number.isFinite(max)) {
    return `Please enter a number from ${min} to ${max}`;
  }
  return "Please enter a valid value";
}

function readRange(text: string): { minRow: number; maxRow: number; minCol: number; maxCol: number } | null {
  const parts = String(text ?? "").trim().toUpperCase().split(":");
  if (parts.length > 2) return null;
  const first = readCellName(parts[0]);
  if (!first) return null;
  const second = parts.length === 2 ? readCellName(parts[1]) : first;
  if (!second) return null;
  return {
    minRow: Math.min(first.row, second.row),
    maxRow: Math.max(first.row, second.row),
    minCol: Math.min(first.col, second.col),
    maxCol: Math.max(first.col, second.col),
  };
}

/**
 * Mirrors `checkValidationError` (`backend/src/domain/validation.mjs`) so the
 * component tests see the same atomic rejection a real write gets.
 */
function fakeValidationError(worksheet: FakeWorksheet, ref: FakeCellRef, value: string | null): string | null {
  const text = value === null ? "" : String(value);
  for (const rule of worksheet.validations ?? []) {
    const region = readRange(rule.range);
    if (!region) continue;
    const inside = ref.row >= region.minRow && ref.row <= region.maxRow
      && ref.col >= region.minCol && ref.col <= region.maxCol;
    if (!inside) continue;
    if (text.trim() === "") {
      if (rule.allowBlank === false) return fakeValidationMessage(rule);
      continue;
    }
    const numeric = Number(text);
    if (rule.type === "number-between") {
      const min = Number(rule.min);
      const max = Number(rule.max);
      if (!Number.isFinite(numeric) || numeric < min || numeric > max) return fakeValidationMessage(rule);
    } else if (rule.type === "number") {
      if (!Number.isFinite(numeric)) return fakeValidationMessage(rule);
    } else if (rule.type === "list") {
      const values = fakeAllowedValues(rule);
      if (values.length && !values.includes(text.trim())) return fakeValidationMessage(rule);
    }
  }
  return null;
}

export function seedWorkbook(overrides: Partial<Workbook> = {}): Workbook {
  return {
    id: "q3-sales",
    name: "Q3 Sales",
    updatedAt: "2026-09-29T09:15:00.000Z",
    activeWorksheetId: "q3-sales-sheet1",
    worksheets: [
      {
        id: "q3-sales-sheet1",
        name: "Sheet1",
        rowCount: 20,
        columnCount: 8,
        cells: {
          A1: "Region",
          B1: "Sales",
          C1: "Status",
          A2: "East",
          B2: "1200",
          C2: "Open",
          A3: "North",
          B3: "800",
          C3: "Closed",
          A4: "South",
          B4: "700",
          C4: "Open",
        },
      },
      {
        id: "q3-sales-sheet2",
        name: "Sheet2",
        rowCount: 20,
        columnCount: 8,
        // Formula seed of the same workbook (REQ-4): `=A1+B1` (5) and the
        // directly dependent `=C1*2` (10).
        cells: { A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2" },
      },
    ],
    selections: {
      "q3-sales-sheet1": { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
      "q3-sales-sheet2": { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
    },
    ...overrides,
  };
}

export function installFakeBackend(initial: Workbook[] = [seedWorkbook()]): FakeBackend {
  let nextWorksheetSeq = 1;
  const backend: FakeBackend = {
    workbooks: structuredClone(initial),
    calls: [],
    fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init.method ?? "GET").toUpperCase();
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      backend.calls.push({ method, path });
      const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};

      if (path === "/api/workbooks" && method === "GET") {
        const workbooks: WorkbookSummary[] = backend.workbooks.map((workbook) => ({
          id: workbook.id,
          name: workbook.name,
          updatedAt: workbook.updatedAt,
          worksheetCount: workbook.worksheets.length,
        }));
        return jsonResponse(200, { workbooks });
      }

      if (path === "/api/workbooks" && method === "POST") {
        const requested = typeof body.name === "string" ? body.name.trim() : "";
        const name = requested || "Untitled workbook";
        const requestedId = typeof body.id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(body.id)
          ? body.id
          : "";
        if (requestedId) {
          // Replaying the same client id must not create a second record.
          const existing = backend.workbooks.find((workbook) => workbook.id === requestedId);
          if (existing) return jsonResponse(201, { workbook: structuredClone(existing) });
        }
        const worksheetId = `ws-${backend.workbooks.length + 1}`;
        const taken = new Set(backend.workbooks.map((workbook) => workbook.id));
        let id = requestedId;
        if (!id) {
          id = slugify(name);
          let index = 2;
          while (taken.has(id)) {
            id = `${slugify(name)}-${index}`;
            index += 1;
          }
        }
        const workbook: Workbook = {
          id,
          name,
          updatedAt: new Date().toISOString(),
          activeWorksheetId: worksheetId,
          worksheets: [{ id: worksheetId, name: "Sheet1", rowCount: 20, columnCount: 8, cells: {} }],
          selections: { [worksheetId]: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } } },
        };
        backend.workbooks.push(workbook);
        return jsonResponse(201, { workbook });
      }

      if (path === "/api/workbooks/import" && method === "POST") {
        let grid: string[][];
        try {
          grid = parseCsvText(String(body.content ?? ""));
        } catch {
          return jsonResponse(400, { error: INVALID_CSV });
        }
        const fileName = String(body.fileName ?? "").split(/[\\/]/).pop() ?? "";
        const name = fileName.replace(/\.csv$/i, "").trim() || "Untitled workbook";
        const cells: Record<string, string> = {};
        let cols = 0;
        grid.forEach((values, rowIndex) => {
          cols = Math.max(cols, values.length);
          values.forEach((value, colIndex) => {
            if (value !== "") cells[`${columnLabel(colIndex)}${rowIndex + 1}`] = value;
          });
        });
        const worksheetId = `ws-import-${backend.workbooks.length + 1}`;
        const takenIds = new Set(backend.workbooks.map((workbook) => workbook.id));
        let id = slugify(name);
        let suffix = 2;
        while (takenIds.has(id)) { id = `${slugify(name)}-${suffix}`; suffix += 1; }
        const workbook: Workbook = {
          id,
          name,
          updatedAt: new Date().toISOString(),
          activeWorksheetId: worksheetId,
          worksheets: [{
            id: worksheetId,
            name: "Sheet1",
            rowCount: Math.max(20, grid.length),
            columnCount: Math.max(8, cols),
            usedRows: grid.length,
            usedCols: cols,
            cells,
          }],
          selections: { [worksheetId]: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } } },
        };
        backend.workbooks.push(workbook);
        return jsonResponse(201, { workbook: structuredClone(workbook) });
      }

      const workbookMatch = /^\/api\/workbooks\/([^/]+)(\/state)?$/.exec(path);
      if (workbookMatch) {
        const workbook = backend.workbooks.find((candidate) => candidate.id === decodeURIComponent(workbookMatch[1]));
        if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
        const isState = Boolean(workbookMatch[2]);
        if (method === "PATCH" && !isState && typeof body.name === "string") {
          const name = body.name.trim();
          if (!name) return jsonResponse(400, { error: "Workbook name cannot be empty" });
          workbook.name = name;
          workbook.updatedAt = new Date().toISOString();
        } else if (method === "PATCH") {
          if (typeof body.activeWorksheetId === "string") workbook.activeWorksheetId = body.activeWorksheetId;
          const selection = body.selection as {
            worksheetId: string;
            anchor?: FakeCellRef;
            focus?: FakeCellRef;
            row?: number;
            col?: number;
          } | undefined;
          if (selection) {
            const anchor = selection.anchor ?? { row: selection.row ?? 0, col: selection.col ?? 0 };
            const focus = selection.focus ?? anchor;
            workbook.selections = {
              ...workbook.selections,
              [selection.worksheetId]: { anchor: { ...anchor }, focus: { ...focus } },
            };
          }
        }
        return jsonResponse(200, { workbook: structuredClone(workbook) });
      }

      const worksheetsMatch = /^\/api\/workbooks\/([^/]+)\/worksheets$/.exec(path);
      if (worksheetsMatch) {
        const workbook = backend.workbooks.find((candidate) => candidate.id === decodeURIComponent(worksheetsMatch[1]));
        if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
        if (method === "POST") {
          const taken = new Set(workbook.worksheets.map((worksheet) => worksheet.name.trim().toLowerCase()));
          let index = 1;
          while (taken.has(`sheet${index}`)) index += 1;
          const worksheetId = `ws-new-${nextWorksheetSeq}`;
          nextWorksheetSeq += 1;
          workbook.worksheets.push({
            id: worksheetId,
            name: `Sheet${index}`,
            rowCount: 20,
            columnCount: 8,
            cells: {},
          });
          workbook.activeWorksheetId = worksheetId;
          workbook.selections = {
            ...workbook.selections,
            [worksheetId]: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
          };
          workbook.updatedAt = new Date().toISOString();
          return jsonResponse(201, { workbook: structuredClone(workbook) });
        }
        return jsonResponse(404, { error: "Not found" });
      }

      const worksheetMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)$/.exec(path);
      if (worksheetMatch) {
        const workbook = backend.workbooks.find((candidate) => candidate.id === decodeURIComponent(worksheetMatch[1]));
        if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
        const worksheet = workbook.worksheets.find(
          (candidate) => candidate.id === decodeURIComponent(worksheetMatch[2]),
        );
        if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
        if (method === "PATCH") {
          const name = typeof body.name === "string" ? body.name.trim() : "";
          if (!name) return jsonResponse(400, { error: "Worksheet name cannot be empty" });
          const key = name.toLowerCase();
          const clash = workbook.worksheets.some(
            (candidate) => candidate.id !== worksheet.id && candidate.name.trim().toLowerCase() === key,
          );
          if (clash) return jsonResponse(400, { error: "Worksheet name already exists" });
          worksheet.name = name;
          workbook.updatedAt = new Date().toISOString();
          return jsonResponse(200, { workbook: structuredClone(workbook) });
        }
        if (method === "PUT") {
          // Undo/redo restore (REQ-3-2-2): replace the whole worksheet content.
          const incoming = (body.cells ?? {}) as Record<string, string | null>;
          const cells: Record<string, string> = {};
          let rows = 0;
          let cols = 0;
          for (const [name, value] of Object.entries(incoming)) {
            if (!value) continue;
            const ref = readCellName(name);
            if (!ref) return jsonResponse(400, { error: `Invalid cell reference: ${name}` });
            if (typeof value !== "string") return jsonResponse(400, { error: `Invalid cell value for ${name}` });
            cells[`${columnLabel(ref.col)}${ref.row + 1}`] = value;
            rows = Math.max(rows, ref.row + 1);
            cols = Math.max(cols, ref.col + 1);
          }
          const usedRows = Math.max(rows, countOf(body.usedRows));
          const usedCols = Math.max(cols, countOf(body.usedCols));
          worksheet.cells = cells;
          worksheet.usedRows = usedRows;
          worksheet.usedCols = usedCols;
          worksheet.rowCount = Math.max(20, usedRows + 1, countOf(body.rowCount));
          worksheet.columnCount = Math.max(8, usedCols + 1, countOf(body.columnCount));
          if (Array.isArray(body.validations)) worksheet.validations = structuredClone(body.validations);
          if (body && Object.prototype.hasOwnProperty.call(body, "filter")) {
            if (body.filter) worksheet.filter = structuredClone(body.filter) as WorksheetFilter;
            else delete worksheet.filter;
          }
          workbook.updatedAt = new Date().toISOString();
          return jsonResponse(200, { workbook: structuredClone(workbook) });
        }
        if (method === "DELETE") {
          // Worksheet lifecycle (REQ-2-1-4): mirrors the server rules before it
          // touches the record, so a rejected deletion keeps every worksheet.
          const index = workbook.worksheets.findIndex((candidate) => candidate.id === worksheet.id);
          if (workbook.worksheets.length <= 1) {
            return jsonResponse(400, { error: "A workbook must contain at least one worksheet" });
          }
          const dependent = workbook.worksheets.some(
            (candidate) => candidate.pivot && candidate.pivot.sourceWorksheetId === worksheet.id,
          );
          if (dependent) {
            return jsonResponse(400, { error: "Please delete or rebuild dependent pivot tables first" });
          }
          workbook.worksheets.splice(index, 1);
          if (workbook.selections) delete workbook.selections[worksheet.id];
          if (workbook.activeWorksheetId === worksheet.id) {
            workbook.activeWorksheetId = workbook.worksheets[Math.min(index, workbook.worksheets.length - 1)].id;
          }
          workbook.updatedAt = new Date().toISOString();
          return jsonResponse(200, { workbook: structuredClone(workbook) });
        }
        return jsonResponse(404, { error: "Not found" });
      }

      const rulesMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/(validations|filter)$/.exec(path);
      if (rulesMatch) {
        const workbook = backend.workbooks.find((candidate) => candidate.id === decodeURIComponent(rulesMatch[1]));
        if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(rulesMatch[2]));
        if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
        if (method === "PUT") {
          if (rulesMatch[3] === "filter") {
            const filter = body.filter as WorksheetFilter | null | undefined;
            if (filter === null || filter === undefined) delete worksheet.filter;
            else worksheet.filter = structuredClone(filter);
          } else if (Array.isArray(body.validations)) {
            if (body.validations.length) worksheet.validations = structuredClone(body.validations) as ValidationRule[];
            else delete worksheet.validations;
          }
          workbook.updatedAt = new Date().toISOString();
          return jsonResponse(200, { workbook: structuredClone(workbook) });
        }
        return jsonResponse(404, { error: "Not found" });
      }

      const cellsMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/cells$/.exec(path);
      if (cellsMatch) {
        const workbook = backend.workbooks.find((candidate) => candidate.id === decodeURIComponent(cellsMatch[1]));
        if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(cellsMatch[2]));
        if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
        // Validate the complete batch before writing: one rejected cell leaves
        // every target cell at its previous value (REQ-5-2-1).
        const incomingCells = body.cells as Record<string, string | null>;
        for (const [name, value] of Object.entries(incomingCells)) {
          const ref = readCellName(name);
          if (!ref) return jsonResponse(400, { error: `Invalid cell reference: ${name}` });
          const message = fakeValidationError(worksheet, ref, value);
          if (message) return jsonResponse(400, { error: message });
        }
        for (const [name, value] of Object.entries(incomingCells)) {
          if (!value) delete worksheet.cells[name];
          else worksheet.cells[name] = value;
        }
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook: structuredClone(workbook) });
      }

      const sortMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/sort$/.exec(path);
      if (sortMatch && method === "POST") {
        const workbook = backend.workbooks.find((candidate) => candidate.id === decodeURIComponent(sortMatch[1]));
        if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
        const worksheet = workbook.worksheets.find(
          (candidate) => candidate.id === decodeURIComponent(sortMatch[2]),
        );
        if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
        const failure = applyFakeSort(worksheet, body);
        if (failure) return jsonResponse(400, { error: failure });
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook: structuredClone(workbook) });
      }

      const structureMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/(rows|columns)$/.exec(path);
      if (structureMatch && method === "POST") {
        const workbook = backend.workbooks.find((candidate) => candidate.id === decodeURIComponent(structureMatch[1]));
        if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
        const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(structureMatch[2]));
        if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
        const axis = structureMatch[3] === "rows" ? "row" : "column";
        const action = String(body.action ?? "");
        const index = Number(body.index);
        const limit = axis === "row" ? worksheet.rowCount : worksheet.columnCount;
        const actions = axis === "row"
          ? ["insert-above", "insert-below", "delete"]
          : ["insert-left", "insert-right", "delete"];
        if (!actions.includes(action)) {
          return jsonResponse(400, { error: axis === "row" ? "Unknown row action" : "Unknown column action" });
        }
        if (!Number.isInteger(index) || index < 0 || index >= limit) {
          return jsonResponse(400, { error: "Structure index out of range" });
        }
        applyFakeStructure(worksheet, axis, action, index);
        // A pivot reading this worksheet keeps its source range in step with the
        // moved cells, exactly like `shiftPivotSourceRange` on the server.
        const deletingAxis = action === "delete";
        const at = deletingAxis
          ? index
          : (action === "insert-above" || action === "insert-left" ? index : index + 1);
        for (const candidate of workbook.worksheets) {
          if (!candidate.pivot || candidate.pivot.sourceWorksheetId !== worksheet.id) continue;
          const shifted = rewriteReferences(candidate.pivot.sourceRange, axis, at, deletingAxis);
          candidate.pivot = { ...candidate.pivot, sourceRange: shifted === "#REF!" ? "" : shifted };
        }
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook: structuredClone(workbook) });
      }

      const pivotCreateMatch = /^\/api\/workbooks\/([^/]+)\/pivot$/.exec(path);
      if (pivotCreateMatch && method === "POST") {
        const workbook = backend.workbooks.find((candidate) => candidate.id === decodeURIComponent(pivotCreateMatch[1]));
        if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
        const requestedSource = String(body.sourceWorksheetId ?? "");
        const source = workbook.worksheets.find((candidate) => candidate.id === requestedSource)
          ?? workbook.worksheets.find((candidate) => candidate.id === workbook.activeWorksheetId);
        if (!source) return jsonResponse(404, { error: "Worksheet not found" });
        const range = String(body.range ?? "").trim().toUpperCase();
        const { region, headers } = fakePivotHeaders(source, range);
        if (!region || region.maxRow >= source.rowCount || region.maxCol >= source.columnCount) {
          return jsonResponse(400, { error: PIVOT_SOURCE_RANGE });
        }
        if (!headers.length) return jsonResponse(400, { error: "The pivot source range needs a header row" });
        const taken = new Set(workbook.worksheets.map((candidate) => candidate.name.trim().toLowerCase()));
        let index = 1;
        while (taken.has(`pivot${index}`)) index += 1;
        const worksheetId = `ws-pivot-${nextWorksheetSeq}`;
        nextWorksheetSeq += 1;
        const worksheet: Worksheet = {
          id: worksheetId,
          name: `Pivot${index}`,
          rowCount: 20,
          columnCount: 8,
          cells: {},
          pivot: {
            sourceWorksheetId: source.id,
            sourceRange: range,
            rowField: "",
            columnField: "",
            valueField: "",
            summarizeBy: "SUM",
          },
        };
        workbook.worksheets.push(worksheet);
        workbook.activeWorksheetId = worksheetId;
        workbook.selections = {
          ...workbook.selections,
          [worksheetId]: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
        };
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(201, { workbook: structuredClone(workbook) });
      }

      const pivotMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/pivot(\/refresh)?$/.exec(path);
      if (pivotMatch) {
        const workbook = backend.workbooks.find((candidate) => candidate.id === decodeURIComponent(pivotMatch[1]));
        if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
        const worksheet = workbook.worksheets.find(
          (candidate) => candidate.id === decodeURIComponent(pivotMatch[2]),
        );
        if (!worksheet) return jsonResponse(404, { error: "Worksheet not found" });
        if (!worksheet.pivot) return jsonResponse(400, { error: "This worksheet is not a pivot table" });
        let next: PivotTable;
        if (pivotMatch[3]) {
          if (method !== "POST") return jsonResponse(404, { error: "Not found" });
          next = worksheet.pivot;
        } else if (method === "PUT") {
          const summarizeBy = String(body.summarizeBy ?? "").trim().toUpperCase();
          if (!["SUM", "COUNT", "AVERAGE"].includes(summarizeBy)) {
            return jsonResponse(400, { error: `Unknown summarization method: ${String(body.summarizeBy)}` });
          }
          next = {
            ...worksheet.pivot,
            rowField: String(body.rowField ?? "").trim(),
            columnField: String(body.columnField ?? "").trim(),
            valueField: String(body.valueField ?? "").trim(),
            summarizeBy: summarizeBy as PivotTable["summarizeBy"],
          };
        } else {
          return jsonResponse(404, { error: "Not found" });
        }
        const source = workbook.worksheets.find((candidate) => candidate.id === next.sourceWorksheetId);
        if (!source) return jsonResponse(400, { error: PIVOT_SOURCE_RANGE });
        const result = fakeComputePivot(source, next);
        if (result.error) return jsonResponse(400, { error: result.error });
        worksheet.pivot = next;
        applyFakePivotResult(worksheet, result);
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook: structuredClone(workbook) });
      }

      return jsonResponse(404, { error: "Not found" });
    }) as typeof fetch,
  };
  return backend;
}
