import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { parseCsv, serializeCsv, CsvError } from "./lib/csv.mjs";
import { FormulaSyntaxError, adjustFormulaForCopy, evaluateFormula, formulaReferences, parseFormula } from "./lib/formula.mjs";
import { createJsonStore } from "./lib/json-store.mjs";
import {
  STRUCTURE_OPS,
  cellCoordinate as refCellCoordinate,
  columnLabel as refColumnLabel,
  normalizeRange,
  parseCoordinate,
  rangeContains,
  rewriteFormulaReferences,
  shiftCells,
  shiftRange,
} from "./lib/refs.mjs";

/** 0-based column index -> spreadsheet column label (A, B, ..., Z, AA, ...). */
export const columnLabel = refColumnLabel;

/** 1-based row/column -> cell coordinate such as A1. */
export const cellCoordinate = refCellCoordinate;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

const EMPTY_WORKSHEET_NAME_MESSAGE = "Worksheet name cannot be empty";
const DUPLICATE_WORKSHEET_NAME_MESSAGE = "Worksheet name already exists";
const MIN_ONE_WORKSHEET_MESSAGE = "A workbook must contain at least one worksheet";
const DEPENDENT_PIVOT_MESSAGE = "Please delete or rebuild dependent pivot tables first";
const NUMERIC_RULE_MESSAGE = "Please enter a number from 0 to 100";
const PIVOT_FIELD_UNAVAILABLE = "Pivot field is no longer available. Select a new field.";
const PIVOT_NUMERIC_REQUIRED = "Value field requires numeric values";
const PIVOT_SELECT_FIELDS = "Select a row field and a value field";

function seedState() {
  const seededAt = "2026-09-01T08:00:00.000Z";
  const sheet1Id = "ws-seed-q3-1";
  const sheet2Id = "ws-seed-q3-2";
  return {
    workbooks: [
      {
        id: "wb-seed-q3",
        name: "Q3 Sales",
        createdAt: seededAt,
        updatedAt: seededAt,
        activeSheetId: sheet1Id,
        sheets: [
          {
            id: sheet1Id,
            name: "Sheet1",
            cells: {
              A1: { value: "Region" },
              B1: { value: "Sales" },
              C1: { value: "Status" },
              A2: { value: "East" },
              B2: { value: "1200" },
              C2: { value: "Open" },
              A3: { value: "North" },
              B3: { value: "800" },
              C3: { value: "Closed" },
              A4: { value: "South" },
              B4: { value: "700" },
              C4: { value: "Open" },
            },
          },
          {
            id: sheet2Id,
            name: "Sheet2",
            cells: {},
          },
        ],
      },
    ],
  };
}

function findWorkbook(state, id) {
  const workbook = state.workbooks.find((item) => item.id === id);
  if (!workbook) throw new HttpError(404, "Workbook not found");
  return workbook;
}

function findSheet(workbook, sheetId) {
  const sheet = workbook.sheets.find((item) => item.id === sheetId);
  if (!sheet) throw new HttpError(404, "Worksheet not found");
  return sheet;
}

function activeSheet(workbook) {
  return workbook.sheets.find((sheet) => sheet.id === workbook.activeSheetId) ?? workbook.sheets[0];
}

/** First unused SheetN name in positive-integer order. */
function nextSheetName(sheets) {
  const names = new Set(sheets.map((sheet) => sheet.name));
  let n = 1;
  while (names.has(`Sheet${n}`)) n += 1;
  return `Sheet${n}`;
}

/** First unused PivotN name in positive-integer order. */
function nextPivotName(sheets) {
  const names = new Set(sheets.map((sheet) => sheet.name));
  let n = 1;
  while (names.has(`Pivot${n}`)) n += 1;
  return `Pivot${n}`;
}

function shiftRules(rules, op) {
  if (!Array.isArray(rules) || rules.length === 0) return rules;
  const shifted = [];
  for (const rule of rules) {
    const range = shiftRange(rule.range, op);
    if (range === null) continue;
    shifted.push({ ...rule, range });
  }
  return shifted;
}

function shiftFilterViews(filterViews, op) {
  if (!Array.isArray(filterViews) || filterViews.length === 0) return filterViews;
  const next = [];
  for (const view of filterViews) {
    const range = shiftRange(view.range, op);
    if (range === null) continue;
    const conditions = (view.conditions ?? []).flatMap((condition) => {
      if (op.type === "delete-column") {
        if (condition.column === op.at) return [];
        if (condition.column > op.at) return [{ ...condition, column: condition.column - 1 }];
        return [condition];
      }
      if (op.type === "insert-column-left") {
        return condition.column >= op.at ? [{ ...condition, column: condition.column + 1 }] : [condition];
      }
      if (op.type === "insert-column-right") {
        return condition.column > op.at ? [{ ...condition, column: condition.column + 1 }] : [condition];
      }
      return [condition];
    });
    next.push({ ...view, range, conditions });
  }
  return next;
}

function shiftPivot(pivot, op) {
  if (!pivot) return pivot;
  const sourceRange = shiftRange(pivot.sourceRange, op);
  let broken = Boolean(pivot.broken);
  let columns = pivot.columns;
  let rows = pivot.rows;
  if (Array.isArray(columns) && (op.type === "insert-column-left" || op.type === "insert-column-right" || op.type === "delete-column")) {
    columns = columns.map((field) => {
      if (op.type === "delete-column" && field.sourceColumn === op.at) {
        broken = true;
        return field;
      }
      if (op.type === "insert-column-left" && field.sourceColumn >= op.at) {
        return { ...field, sourceColumn: field.sourceColumn + 1 };
      }
      if (op.type === "insert-column-right" && field.sourceColumn > op.at) {
        return { ...field, sourceColumn: field.sourceColumn + 1 };
      }
      if (op.type === "delete-column" && field.sourceColumn > op.at) {
        return { ...field, sourceColumn: field.sourceColumn - 1 };
      }
      return field;
    });
  }
  if (Array.isArray(rows) && (op.type === "insert-row-above" || op.type === "insert-row-below" || op.type === "delete-row")) {
    rows = rows.map((field) => {
      if (op.type === "delete-row" && field.sourceRow === op.at) {
        broken = true;
        return field;
      }
      if (op.type === "insert-row-above" && field.sourceRow >= op.at) {
        return { ...field, sourceRow: field.sourceRow + 1 };
      }
      if (op.type === "insert-row-below" && field.sourceRow > op.at) {
        return { ...field, sourceRow: field.sourceRow + 1 };
      }
      if (op.type === "delete-row" && field.sourceRow > op.at) {
        return { ...field, sourceRow: field.sourceRow - 1 };
      }
      return field;
    });
  }
  // Pivot fields in the new model are stored as absolute source columns; they
  // shift with source-column structure changes and break when the header
  // column they point at is deleted.
  let rowFieldColumn = pivot.rowFieldColumn;
  let columnFieldColumn = pivot.columnFieldColumn;
  let valueFieldColumn = pivot.valueFieldColumn;
  if (op.type === "insert-column-left" || op.type === "insert-column-right" || op.type === "delete-column") {
    const shift = (col) => {
      if (col == null) return col;
      if (op.type === "delete-column") {
        if (col === op.at) {
          broken = true;
          return col;
        }
        return col > op.at ? col - 1 : col;
      }
      if (op.type === "insert-column-left") return col >= op.at ? col + 1 : col;
      return col > op.at ? col + 1 : col;
    };
    rowFieldColumn = shift(rowFieldColumn);
    columnFieldColumn = shift(columnFieldColumn);
    valueFieldColumn = shift(valueFieldColumn);
  }
  return { ...pivot, sourceRange, columns, rows, broken, rowFieldColumn, columnFieldColumn, valueFieldColumn };
}

/**
 * Shifts the part of a pivot config that lives inside the pivot sheet itself.
 * A structure change on the pivot worksheet moves the cached result grid with
 * the sheet cells but never touches the source range or source field columns.
 * Legacy same-sheet pivots (no sourceSheetId) keep the old behavior: the whole
 * config shifts with the sheet.
 */
function shiftOwnPivot(pivot, op) {
  if (!pivot) return pivot;
  if (pivot.sourceSheetId === undefined) return shiftPivot(pivot, op);
  const resultRange = shiftRange(pivot.resultRange, op);
  return { ...pivot, resultRange };
}

/** Applies a structure change to one worksheet; cells and formulas shift atomically. */
function applyStructureChange(sheet, op) {
  const nextCells = {};
  for (const [coordinate, cell] of Object.entries(shiftCells(sheet.cells ?? {}, op))) {
    const moved = { ...cell };
    if (typeof moved.formula === "string") {
      moved.formula = rewriteFormulaReferences(moved.formula, op);
      if (moved.formula.includes("#REF!")) moved.value = "#REF!";
    }
    nextCells[coordinate] = moved;
  }
  return {
    ...sheet,
    cells: nextCells,
    validationRules: shiftRules(sheet.validationRules, op),
    filterViews: shiftFilterViews(sheet.filterViews, op),
    pivot: shiftOwnPivot(sheet.pivot, op),
  };
}

function parseStructureOp(body) {
  if (!body || typeof body.op !== "string" || !STRUCTURE_OPS.has(body.op)) {
    throw new HttpError(400, "Invalid structure operation");
  }
  const index = Number(body.index);
  if (!Number.isInteger(index) || index < 1) {
    throw new HttpError(400, "Invalid row or column index");
  }
  return { type: body.op, at: index };
}

const ALLOWED_FILTER_CONDITIONS = new Set(["text-contains", "greater-than", "before", "is-empty", "is-not-empty"]);

/** Validates filter conditions; columns are 1-based absolute column indices. */
function parseFilterConditions(raw, range) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, "Invalid filter conditions");
  const conditions = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, "Invalid filter conditions");
    }
    const column = Number(item.column);
    if (!Number.isInteger(column) || column < range.start.column || column > range.end.column) {
      throw new HttpError(400, "Invalid filter column");
    }
    if (item.mode === "values") {
      if (!Array.isArray(item.values)) throw new HttpError(400, "Invalid filter values");
      conditions.push({ column, mode: "values", values: item.values.map((value) => String(value)) });
    } else if (item.mode === "condition") {
      const name = item.condition;
      if (typeof name !== "string" || !ALLOWED_FILTER_CONDITIONS.has(name)) {
        throw new HttpError(400, "Invalid filter condition");
      }
      const entry = { column, mode: "condition", condition: name };
      if (name !== "is-empty" && name !== "is-not-empty") {
        entry.value = typeof item.value === "string" ? item.value : String(item.value ?? "");
      }
      conditions.push(entry);
    } else {
      throw new HttpError(400, "Invalid filter mode");
    }
  }
  return conditions;
}

function cellValueAt(sheet, row, column) {
  return sheet.cells?.[cellCoordinate(row, column)]?.value ?? "";
}

function parseNumeric(text) {
  const trimmed = String(text).trim();
  if (trimmed === "") return null;
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function formatPivotNumber(value) {
  if (!Number.isFinite(value)) return "#NUM!";
  if (Object.is(value, -0) || value === 0) return "0";
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  return String(Number(value.toPrecision(12)));
}

/**
 * Resolves pivot field names to source columns by matching header text inside
 * the source range's header row. Missing or renamed headers make the pivot
 * unusable until the field is reselected.
 */
function resolvePivotConfig(workbook, config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new HttpError(400, "Invalid pivot configuration");
  }
  const sourceSheet = workbook.sheets.find((sheet) => sheet.id === config.sourceSheetId);
  if (!sourceSheet) throw new HttpError(400, PIVOT_FIELD_UNAVAILABLE);
  const range = normalizeRange(config.sourceRange);
  if (!range) throw new HttpError(400, "Invalid source range");
  const headers = [];
  for (let column = range.start.column; column <= range.end.column; column += 1) {
    headers.push(cellValueAt(sourceSheet, range.start.row, column));
  }
  const findColumn = (field) => {
    if (typeof field !== "string" || field === "") return null;
    const index = headers.indexOf(field);
    return index === -1 ? null : range.start.column + index;
  };
  const rowField = typeof config.rowField === "string" ? config.rowField : "";
  const valueField = typeof config.valueField === "string" ? config.valueField : "";
  const columnField = config.columnField == null ? "" : String(config.columnField);
  if (rowField === "" || valueField === "") {
    throw new HttpError(400, PIVOT_SELECT_FIELDS);
  }
  const rowFieldColumn = findColumn(rowField);
  const valueFieldColumn = findColumn(valueField);
  const columnFieldColumn = columnField === "" ? null : findColumn(columnField);
  if (rowFieldColumn === null || valueFieldColumn === null || (columnField !== "" && columnFieldColumn === null)) {
    throw new HttpError(400, PIVOT_FIELD_UNAVAILABLE);
  }
  return {
    ...config,
    rowField,
    valueField,
    columnField: columnField === "" ? null : columnField,
    rowFieldColumn,
    valueFieldColumn,
    columnFieldColumn,
  };
}

/**
 * Computes the pivot result grid (array of rows of display strings) from the
 * current source data. Only rows inside the source range with any content are
 * records; SUM/AVERAGE aggregate parseable numbers, COUNT counts non-empty
 * value fields. Throws when the value field has no parseable numbers.
 */
function computePivotGrid(workbook, config) {
  const sourceSheet = workbook.sheets.find((sheet) => sheet.id === config.sourceSheetId);
  if (!sourceSheet) throw new HttpError(400, PIVOT_FIELD_UNAVAILABLE);
  const range = normalizeRange(config.sourceRange);
  if (!range) throw new HttpError(400, "Invalid source range");
  const summarizeBy = config.summarizeBy ?? "SUM";
  const records = [];
  let hasNumeric = false;
  for (let row = range.start.row + 1; row <= range.end.row; row += 1) {
    const rowFieldValue = cellValueAt(sourceSheet, row, config.rowFieldColumn);
    const valueFieldValue = cellValueAt(sourceSheet, row, config.valueFieldColumn);
    const columnFieldValue = config.columnFieldColumn == null ? "" : cellValueAt(sourceSheet, row, config.columnFieldColumn);
    if (rowFieldValue === "" && valueFieldValue === "" && columnFieldValue === "") continue;
    const num = parseNumeric(valueFieldValue);
    if (num !== null) hasNumeric = true;
    records.push({ rowField: rowFieldValue, columnField: columnFieldValue, value: valueFieldValue, num });
  }
  if ((summarizeBy === "SUM" || summarizeBy === "AVERAGE") && !hasNumeric) {
    throw new HttpError(400, PIVOT_NUMERIC_REQUIRED);
  }
  const aggregate = (items) => {
    if (summarizeBy === "COUNT") {
      return formatPivotNumber(items.filter((record) => record.value !== "").length);
    }
    const numbers = items.map((record) => record.num).filter((num) => num !== null);
    if (numbers.length === 0) return "0";
    if (summarizeBy === "SUM") return formatPivotNumber(numbers.reduce((a, b) => a + b, 0));
    if (summarizeBy === "AVERAGE") return formatPivotNumber(numbers.reduce((a, b) => a + b, 0) / numbers.length);
    return "0";
  };
  const rowGroups = [];
  const columnGroups = [];
  for (const record of records) {
    if (!rowGroups.includes(record.rowField)) rowGroups.push(record.rowField);
    if (config.columnFieldColumn != null && record.columnField !== "" && !columnGroups.includes(record.columnField)) {
      columnGroups.push(record.columnField);
    }
  }
  const grid = [];
  if (config.columnFieldColumn == null || config.columnField === null) {
    grid.push([config.rowField, `${summarizeBy} of ${config.valueField}`]);
    for (const group of rowGroups) {
      grid.push([group, aggregate(records.filter((record) => record.rowField === group))]);
    }
    grid.push(["Grand Total", aggregate(records)]);
  } else {
    grid.push([config.rowField, ...columnGroups, "Grand Total"]);
    for (const group of rowGroups) {
      const line = [group];
      for (const columnGroup of columnGroups) {
        line.push(aggregate(records.filter((record) => record.rowField === group && record.columnField === columnGroup)));
      }
      line.push(aggregate(records.filter((record) => record.rowField === group)));
      grid.push(line);
    }
    const totalLine = ["Grand Total"];
    for (const columnGroup of columnGroups) {
      totalLine.push(aggregate(records.filter((record) => record.columnField === columnGroup)));
    }
    totalLine.push(aggregate(records));
    grid.push(totalLine);
  }
  return grid;
}

/** Replaces the previous result rectangle with a fresh result grid. */
function applyPivotResultToSheet(sheet, config, grid) {
  const old = config.resultRange;
  if (old && old.start && old.end) {
    for (let row = old.start.row; row <= old.end.row; row += 1) {
      for (let column = old.start.column; column <= old.end.column; column += 1) {
        delete sheet.cells[cellCoordinate(row, column)];
      }
    }
  }
  grid.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      sheet.cells[cellCoordinate(rowIndex + 1, columnIndex + 1)] = { value: String(value) };
    });
  });
  const resultRange =
    grid.length > 0 && grid[0].length > 0
      ? { start: { row: 1, column: 1 }, end: { row: grid.length, column: grid[0].length } }
      : null;
  return { ...config, resultRange };
}

function parsePivotConfigBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Invalid pivot configuration");
  }
  const sourceRange = normalizeRange(body.sourceRange);
  if (!sourceRange) throw new HttpError(400, "Invalid source range");
  if (typeof body.sourceSheetId !== "string") throw new HttpError(400, "Invalid source worksheet");
  const summarizeBy = body.summarizeBy ?? "SUM";
  if (!["SUM", "COUNT", "AVERAGE"].includes(summarizeBy)) {
    throw new HttpError(400, "Invalid summarization method");
  }
  return { sourceSheetId: body.sourceSheetId, sourceRange, summarizeBy };
}

/** Recognizes a 0-to-100 numeric validation rule (any common shape). */
function isNumericZeroToHundredRule(rule) {
  if (!rule || typeof rule !== "object") return false;
  const type = rule.type ?? rule.criteria ?? rule.validationType ?? rule.ruleType;
  if (type !== "number" && type !== "numeric") return false;
  const min = Number(rule.min);
  const max = Number(rule.max);
  return Number.isFinite(min) && Number.isFinite(max) && min === 0 && max === 100;
}

function ruleTypeOf(rule) {
  return rule?.type ?? rule?.criteria ?? rule?.validationType ?? rule?.ruleType ?? null;
}

/** Parses a rule value into a finite number or null (empty/non-numeric input). */
function ruleNumber(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (text === "") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/**
 * Returns the rejection message for one written value under one validation
 * rule, or null when the value passes. Empty values are allowed. Dropdown
 * rules require the exact trimmed allowed value; number rules accept any
 * parseable number inside the inclusive [min, max] interval. The persisted
 * 0-to-100 boundary rule keeps its historical "from 0 to 100" wording.
 */
function ruleViolationForValue(rule, value) {
  const type = ruleTypeOf(rule);
  if (type === "dropdown") {
    const allowed = Array.isArray(rule.allowedValues) ? rule.allowedValues.map(String) : [];
    if (!allowed.includes(value)) {
      return `Please select one of the following values: ${allowed.join(", ")}`;
    }
    return null;
  }
  if (type === "number" || type === "numeric") {
    const min = ruleNumber(rule.min);
    const max = ruleNumber(rule.max);
    if (min === null || max === null) return null;
    const numeric = /^-?\d+(\.\d+)?$/.test(value.trim());
    if (!numeric) {
      return isNumericZeroToHundredRule(rule)
        ? NUMERIC_RULE_MESSAGE
        : `Please enter a number between ${min} and ${max}`;
    }
    const number = Number(value.trim());
    if (number < min || number > max) {
      return isNumericZeroToHundredRule(rule)
        ? NUMERIC_RULE_MESSAGE
        : `Please enter a number between ${min} and ${max}`;
    }
    return null;
  }
  return null;
}

/**
 * Checks written coordinates against every validation rule on the sheet
 * (dropdown and number rules). Returns the rejection message or null. Empty
 * values are allowed. Rules constrain future writes only; existing cell
 * values are never rewritten when a rule is created.
 */
function validationViolation(sheet, coordinates) {
  const rules = sheet.validationRules ?? [];
  if (rules.length === 0) return null;
  for (const coordinate of coordinates) {
    const position = parseCoordinate(coordinate);
    if (!position) continue;
    for (const rule of rules) {
      if (!rangeContains(rule.range, position.row, position.column)) continue;
      const cell = sheet.cells[coordinate];
      if (!cell) continue;
      const value = String(cell.value ?? "");
      if (value === "") continue;
      const message = ruleViolationForValue(rule, value);
      if (message !== null) return message;
    }
  }
  return null;
}

function formulaContext(workbook, sheet) {
  return {
    hasSheet(name) {
      return workbook.sheets.some((item) => item.name === name);
    },
    getCell(sheetName, position) {
      if (sheetName) {
        const other = workbook.sheets.find((item) => item.name === sheetName);
        return other?.cells?.[cellCoordinate(position.row, position.column)];
      }
      return sheet.cells?.[cellCoordinate(position.row, position.column)];
    },
  };
}

/**
 * Recomputes every formula cell in every worksheet until stable. Formula cells
 * that participate in a direct or indirect circular reference are pinned to
 * `#REF!`; malformed stored expressions evaluate to `#ERROR!`. Every other
 * formula is re-evaluated in dependency order so results match current source
 * values after any write.
 */
function recalculateWorkbook(workbook) {
  const cycleKeys = findCircularFormulaCells(workbook);
  for (const sheet of workbook.sheets) {
    for (const [coordinate, cell] of Object.entries(sheet.cells ?? {})) {
      if (typeof cell.formula === "string" && cycleKeys.has(`${sheet.id}:${coordinate}`)) {
        sheet.cells[coordinate] = { ...cell, value: "#REF!" };
      }
    }
  }
  for (const sheet of workbook.sheets) {
    const formulaCells = Object.entries(sheet.cells ?? {}).filter(
      ([coordinate, cell]) =>
        typeof cell.formula === "string" && !cycleKeys.has(`${sheet.id}:${coordinate}`),
    );
    if (formulaCells.length === 0) continue;
    const context = formulaContext(workbook, sheet);
    const maxIterations = formulaCells.length * 2 + 5;
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      let changed = false;
      for (const [coordinate, cell] of formulaCells) {
        let next;
        try {
          next = evaluateFormula(cell.formula, context);
        } catch (error) {
          if (error instanceof FormulaSyntaxError) {
            next = "#ERROR!";
          } else {
            throw error;
          }
        }
        if (next !== cell.value) {
          sheet.cells[coordinate] = { ...cell, value: next };
          changed = true;
        }
      }
      if (!changed) break;
    }
  }
}

/**
 * Returns the set of `${sheetId}:${coordinate}` formula cells that lie on a
 * direct or indirect circular reference (including self references). The
 * dependency graph covers references inside any worksheet of the workbook.
 */
function findCircularFormulaCells(workbook) {
  const nodeKey = (sheetId, coordinate) => `${sheetId}:${coordinate}`;
  const nodes = new Set();
  const sheetByCoordinate = new Map();
  for (const sheet of workbook.sheets) {
    for (const [coordinate, cell] of Object.entries(sheet.cells ?? {})) {
      if (typeof cell.formula !== "string") continue;
      const key = nodeKey(sheet.id, coordinate);
      nodes.add(key);
      sheetByCoordinate.set(key, { sheet, coordinate, formula: cell.formula });
    }
  }
  if (nodes.size === 0) return nodes;
  const adjacency = new Map();
  for (const key of nodes) {
    const node = sheetByCoordinate.get(key);
    let refs;
    try {
      parseFormula(node.formula);
      refs = formulaReferences(node.formula);
    } catch (error) {
      if (error instanceof FormulaSyntaxError) continue;
      throw error;
    }
    const edges = [];
    for (const ref of refs) {
      let targetSheet;
      if (ref.sheet === "") {
        targetSheet = node.sheet;
      } else {
        targetSheet = workbook.sheets.find((sheet) => sheet.name === ref.sheet);
      }
      if (!targetSheet) continue;
      const targetKey = nodeKey(targetSheet.id, cellCoordinate(ref.row, ref.column));
      if (nodes.has(targetKey)) edges.push(targetKey);
    }
    adjacency.set(key, edges);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map();
  const stack = [];
  const inCycle = new Set();
  const visit = (key) => {
    color.set(key, GRAY);
    stack.push(key);
    for (const next of adjacency.get(key) ?? []) {
      const current = color.get(next) ?? WHITE;
      if (current === WHITE) {
        visit(next);
      } else if (current === GRAY) {
        const index = stack.indexOf(next);
        for (let i = index; i < stack.length; i += 1) inCycle.add(stack[i]);
      }
    }
    color.set(key, BLACK);
    stack.pop();
  };
  for (const key of nodes) {
    if ((color.get(key) ?? WHITE) === WHITE) visit(key);
  }
  return inCycle;
}

/**
 * Parses user cell inputs (`"=..."` becomes a formula). Formulas that cannot
 * be parsed are still stored so the grid can display the stable `#ERROR!`
 * value while the formula bar keeps the submitted expression; recalculation
 * resolves them to `#ERROR!`.
 */
function parseCellInputs(cellsMap) {
  if (!cellsMap || typeof cellsMap !== "object" || Array.isArray(cellsMap)) {
    throw new HttpError(400, "Invalid cell data");
  }
  const parsed = {};
  for (const [coordinate, raw] of Object.entries(cellsMap)) {
    if (!parseCoordinate(coordinate)) throw new HttpError(400, "Invalid cell coordinate");
    const input = typeof raw === "string" ? raw : String(raw);
    if (input.startsWith("=")) {
      parsed[coordinate] = { value: "", formula: input };
    } else {
      parsed[coordinate] = { value: input };
    }
  }
  return parsed;
}

function parseRangeBody(body, field) {
  const raw = body?.[field];
  const range = normalizeRange(raw);
  if (!range) throw new HttpError(400, `Invalid ${field}`);
  return range;
}

/** True when two normalized ranges share at least one cell. */
function rangesOverlap(a, b) {
  return (
    Math.max(a.start.row, b.start.row) <= Math.min(a.end.row, b.end.row) &&
    Math.max(a.start.column, b.start.column) <= Math.min(a.end.column, b.end.column)
  );
}

/**
 * Validates a `{range, rule}` payload and normalizes the rule. Dropdown
 * allowed values are trimmed of leading/trailing spaces and empty items are
 * dropped; number rules need finite `min`/`max` with `min <= max`. Returns
 * null for malformed input.
 */
function parseValidationRuleBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const range = normalizeRange(body.range);
  if (!range) return null;
  const rule = body.rule;
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null;
  const type = ruleTypeOf(rule);
  if (type === "dropdown") {
    if (!Array.isArray(rule.allowedValues)) return null;
    const allowed = rule.allowedValues.map((item) => String(item).trim()).filter((item) => item !== "");
    if (allowed.length === 0) return null;
    return { range, rule: { id: randomUUID(), type: "dropdown", range, allowedValues: allowed } };
  }
  if (type === "number" || type === "numeric") {
    const min = ruleNumber(rule.min);
    const max = ruleNumber(rule.max);
    if (min === null || max === null || min > max) return null;
    return { range, rule: { id: randomUUID(), type: "number", range, min, max } };
  }
  return null;
}

/**
 * Validates a `{range, sortBy, order, hasHeaderRow}` sort payload. `sortBy`
 * is a 1-based absolute column inside the range; `order` is `ascending` or
 * `descending`.
 */
function parseSortBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Invalid sort request");
  }
  const range = normalizeRange(body.range);
  if (!range) throw new HttpError(400, "Invalid sort range");
  const sortBy = Number(body.sortBy);
  if (!Number.isInteger(sortBy) || sortBy < range.start.column || sortBy > range.end.column) {
    throw new HttpError(400, "Invalid sort column");
  }
  const order = body.order;
  if (order !== "ascending" && order !== "descending") {
    throw new HttpError(400, "Invalid sort order");
  }
  const hasHeaderRow = body.hasHeaderRow === true;
  return { range, sortBy, order, hasHeaderRow };
}

/**
 * Classifies a displayed value for sorting: numbers (rank 0), parseable
 * dates (rank 1) and text (rank 2) are compared within their own type;
 * blanks (rank 3) always sort last in either direction.
 */
function sortKeyFor(value) {
  const text = String(value ?? "").trim();
  if (text === "") return { rank: 3, key: 0 };
  if (/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(text)) {
    const number = Number(text);
    if (Number.isFinite(number)) return { rank: 0, key: number };
  }
  const time = Date.parse(text);
  if (Number.isFinite(time)) return { rank: 1, key: time };
  return { rank: 2, key: text };
}

function compareSortKeys(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.rank === 2) return a.key.localeCompare(b.key);
  return a.key - b.key;
}

export function createWorkbookService({ dataDir }) {
  const store = createJsonStore(join(dataDir, "state.json"), seedState());

  return {
    async listWorkbooks() {
      const state = await store.read();
      return state.workbooks.map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
    },

    async getWorkbook(id) {
      const state = await store.read();
      return findWorkbook(state, id);
    },

    async createBlankWorkbook() {
      const sheetId = randomUUID();
      const now = new Date().toISOString();
      const workbook = {
        id: randomUUID(),
        name: "Untitled workbook",
        createdAt: now,
        updatedAt: now,
        activeSheetId: sheetId,
        sheets: [{ id: sheetId, name: "Sheet1", cells: {} }],
      };
      await store.update((state) => {
        state.workbooks.push(workbook);
      });
      return workbook;
    },

    async renameWorkbook(id, name) {
      const trimmed = typeof name === "string" ? name.trim() : "";
      if (trimmed === "") throw new HttpError(400, "Workbook name cannot be empty");
      const now = new Date().toISOString();
      let result;
      await store.update((state) => {
        const workbook = findWorkbook(state, id);
        workbook.name = trimmed;
        workbook.updatedAt = now;
        result = workbook;
      });
      return result;
    },

    async setActiveSheet(id, sheetId) {
      const now = new Date().toISOString();
      let result;
      await store.update((state) => {
        const workbook = findWorkbook(state, id);
        if (!workbook.sheets.some((sheet) => sheet.id === sheetId)) {
          throw new HttpError(404, "Worksheet not found");
        }
        workbook.activeSheetId = sheetId;
        workbook.updatedAt = now;
        result = workbook;
      });
      return result;
    },

    async addWorksheet(id) {
      const now = new Date().toISOString();
      let result;
      await store.update((state) => {
        const workbook = findWorkbook(state, id);
        const sheet = {
          id: randomUUID(),
          name: nextSheetName(workbook.sheets),
          cells: {},
        };
        workbook.sheets.push(sheet);
        workbook.activeSheetId = sheet.id;
        workbook.updatedAt = now;
        result = workbook;
      });
      return result;
    },

    async renameSheet(id, sheetId, name) {
      const trimmed = typeof name === "string" ? name.trim() : "";
      if (trimmed === "") throw new HttpError(400, EMPTY_WORKSHEET_NAME_MESSAGE);
      const now = new Date().toISOString();
      let result;
      await store.update((state) => {
        const workbook = findWorkbook(state, id);
        const sheet = findSheet(workbook, sheetId);
        if (workbook.sheets.some((other) => other.id !== sheetId && other.name === trimmed)) {
          throw new HttpError(400, DUPLICATE_WORKSHEET_NAME_MESSAGE);
        }
        sheet.name = trimmed;
        workbook.updatedAt = now;
        result = workbook;
      });
      return result;
    },

    /**
     * Deletes a worksheet and everything it owns (cells, formulas, filters,
     * validation rules, pivot config/results). Rejects when it is the last
     * worksheet or when another worksheet's pivot table reads it as its source.
     * Atomic: on any failure the store stays unchanged. When the active sheet
     * is removed, an adjacent worksheet becomes active.
     */
    async deleteSheet(id, sheetId) {
      const now = new Date().toISOString();
      let result;
      await store.update((state) => {
        const workbook = findWorkbook(state, id);
        const sheet = findSheet(workbook, sheetId);
        if (workbook.sheets.length <= 1) {
          throw new HttpError(400, MIN_ONE_WORKSHEET_MESSAGE);
        }
        const dependent = workbook.sheets.find(
          (other) => other.id !== sheetId && other.pivot && other.pivot.sourceSheetId === sheetId,
        );
        if (dependent) {
          throw new HttpError(400, DEPENDENT_PIVOT_MESSAGE);
        }
        const wasActive = workbook.activeSheetId === sheetId;
        const index = workbook.sheets.indexOf(sheet);
        workbook.sheets.splice(index, 1);
        if (wasActive) {
          workbook.activeSheetId = workbook.sheets[Math.min(index, workbook.sheets.length - 1)].id;
        }
        // Formulas on remaining sheets that referenced the deleted worksheet
        // resolve to #REF! instead of leaking stale values.
        recalculateWorkbook(workbook);
        workbook.updatedAt = now;
        result = workbook;
      });
      return result;
    },

    async changeSheetStructure(id, sheetId, body) {
      const op = parseStructureOp(body);
      const now = new Date().toISOString();
      let result;
      await store.update((state) => {
        const workbook = findWorkbook(state, id);
        const sheet = findSheet(workbook, sheetId);
        const index = workbook.sheets.indexOf(sheet);
        const shifted = applyStructureChange(sheet, op);
        workbook.sheets.splice(index, 1, shifted);
        // Pivot tables that read this worksheet as their source keep their
        // last result but move their source range and field columns with the
        // change, so a later refresh recomputes over the adjusted range.
        for (const other of workbook.sheets) {
          if (other.id === sheet.id) continue;
          if (other.pivot && other.pivot.sourceSheetId === sheet.id) {
            other.pivot = shiftPivot(other.pivot, op);
          }
        }
        recalculateWorkbook(workbook);
        workbook.updatedAt = now;
        result = workbook;
      });
      return result;
    },

    /**
     * Creates or clears the active filter view of one worksheet. With
     * `{clear: true}` every filter view is removed; otherwise the view is set
     * from `{range, conditions}`. Atomic: invalid input leaves the store
     * unchanged.
     */
    async setFilter(id, sheetId, body) {
      const now = new Date().toISOString();
      let result;
      await store.update((state) => {
        const workbook = findWorkbook(state, id);
        const sheet = findSheet(workbook, sheetId);
        if (body?.clear === true) {
          sheet.filterViews = [];
        } else {
          const range = normalizeRange(body?.range);
          if (!range) throw new HttpError(400, "Invalid filter range");
          const conditions = parseFilterConditions(body?.conditions, range);
          sheet.filterViews = [{ id: randomUUID(), range, conditions }];
        }
        workbook.updatedAt = now;
        result = workbook;
      });
      return result;
    },

    /**
     * Creates a pivot-result worksheet (first unused PivotN) that reads the
     * given source range. The sheet becomes active; the field layout is empty
     * until the user applies a configuration in the pivot table editor.
     */
    async createPivot(id, body) {
      const { sourceSheetId, sourceRange, summarizeBy } = parsePivotConfigBody(body);
      const now = new Date().toISOString();
      let result;
      await store.update((state) => {
        const workbook = findWorkbook(state, id);
        if (!workbook.sheets.some((sheet) => sheet.id === sourceSheetId)) {
          throw new HttpError(400, "Invalid source worksheet");
        }
        const sheet = {
          id: randomUUID(),
          name: nextPivotName(workbook.sheets),
          cells: {},
          pivot: {
            sourceSheetId,
            sourceRange,
            rowField: "",
            rowFieldColumn: null,
            columnField: null,
            columnFieldColumn: null,
            valueField: "",
            valueFieldColumn: null,
            summarizeBy,
            resultRange: null,
            broken: false,
            lastError: null,
          },
        };
        workbook.sheets.push(sheet);
        workbook.activeSheetId = sheet.id;
        workbook.updatedAt = now;
        result = workbook;
      });
      return result;
    },

    /**
     * Applies a field layout to an existing pivot worksheet and replaces its
     * result. Body fields override the stored configuration; on any error the
     * store (including the last successful result and the source worksheet)
     * stays unchanged.
     */
    async applyPivot(id, sheetId, body) {
      const now = new Date().toISOString();
      let result;
      await store.update((state) => {
        const workbook = findWorkbook(state, id);
        const sheet = findSheet(workbook, sheetId);
        const existing = sheet.pivot;
        if (!existing) throw new HttpError(400, "No pivot table on this worksheet");
        const merged = {
          ...existing,
          rowField: typeof body?.rowField === "string" ? body.rowField : (existing.rowField ?? ""),
          valueField: typeof body?.valueField === "string" ? body.valueField : (existing.valueField ?? ""),
          columnField:
            body?.columnField === undefined
              ? (existing.columnField ?? null)
              : body.columnField === "" || body.columnField == null
                ? null
                : String(body.columnField),
          summarizeBy: body?.summarizeBy ?? existing.summarizeBy ?? "SUM",
        };
        const resolved = resolvePivotConfig(workbook, merged);
        const grid = computePivotGrid(workbook, resolved);
        const nextConfig = applyPivotResultToSheet(sheet, resolved, grid);
        sheet.pivot = { ...nextConfig, broken: false, lastError: null };
        workbook.updatedAt = now;
        result = workbook;
      });
      return result;
    },

    /**
     * Recomputes the pivot result of a pivot worksheet from its stored
     * configuration and the current source data. The old result rectangle is
     * replaced completely. Field or numeric failures leave the store unchanged
     * (the last successful result and the source worksheet are preserved).
     */
    async refreshPivot(id, sheetId) {
      const now = new Date().toISOString();
      let result;
      await store.update((state) => {
        const workbook = findWorkbook(state, id);
        const sheet = findSheet(workbook, sheetId);
        const config = sheet.pivot;
        if (!config) throw new HttpError(400, "No pivot table on this worksheet");
        const resolved = resolvePivotConfig(workbook, config);
        const grid = computePivotGrid(workbook, resolved);
        const nextConfig = applyPivotResultToSheet(sheet, resolved, grid);
        sheet.pivot = { ...nextConfig, broken: false, lastError: null };
        workbook.updatedAt = now;
        result = workbook;
      });
      return result;
    },

    /**
     * Writes cell values/formulas into a worksheet. The whole update is atomic:
     * every cell is validated first, formulas are evaluated, all sheets are
     * recalculated, and the result is persisted. On any failure the store is
     * left unchanged.
     */
    async updateCells(id, sheetId, body) {
      const parsed = parseCellInputs(body?.cells);
      if (Object.keys(parsed).length === 0) {
        throw new HttpError(400, "Invalid cell data");
      }
      const now = new Date().toISOString();
      let result;
      await store.update((state) => {
        const workbook = findWorkbook(state, id);
        const sheet = findSheet(workbook, sheetId);
        for (const [coordinate, cell] of Object.entries(parsed)) {
          sheet.cells[coordinate] = cell;
        }
        recalculateWorkbook(workbook);
        const violation = validationViolation(sheet, Object.keys(parsed));
        if (violation) throw new HttpError(400, violation);
        workbook.updatedAt = now;
        result = workbook;
      });
      return result;
    },

    /**
     * Copies or cuts a source rectangle onto a target rectangle in the same
     * worksheet. `target.start` is the paste anchor; the rectangle dimensions
     * come from the source. Relative formula references are adjusted by the
     * offset; absolute parts stay fixed. Atomic: either everything updates and
     * persists, or nothing changes.
     */
    async transferRange(id, sheetId, body) {
      const mode = body?.mode;
      if (mode !== "copy" && mode !== "cut") {
        throw new HttpError(400, "Invalid transfer mode");
      }
      const source = parseRangeBody(body, "source");
      const target = parseRangeBody(body, "target");
      const rowOffset = target.start.row - source.start.row;
      const columnOffset = target.start.column - source.start.column;
      const now = new Date().toISOString();
      let result;
      await store.update((state) => {
        const workbook = findWorkbook(state, id);
        const sheet = findSheet(workbook, sheetId);
        const sourceCells = [];
        for (let row = source.start.row; row <= source.end.row; row += 1) {
          for (let column = source.start.column; column <= source.end.column; column += 1) {
            const coordinate = cellCoordinate(row, column);
            if (sheet.cells[coordinate]) {
              sourceCells.push({ coordinate, row, column, cell: sheet.cells[coordinate] });
            }
          }
        }
        const targetCells = [];
        for (const entry of sourceCells) {
          const targetRow = entry.row + rowOffset;
          const targetColumn = entry.column + columnOffset;
          if (targetRow < 1 || targetColumn < 1) continue;
          const moved = { ...entry.cell };
          if (typeof moved.formula === "string") {
            moved.formula = adjustFormulaForCopy(moved.formula, rowOffset, columnOffset);
          }
          targetCells.push({ coordinate: cellCoordinate(targetRow, targetColumn), cell: moved });
        }
        if (mode === "cut") {
          for (const entry of sourceCells) {
            delete sheet.cells[entry.coordinate];
          }
        }
        for (const entry of targetCells) {
          sheet.cells[entry.coordinate] = entry.cell;
        }
        recalculateWorkbook(workbook);
        const violation = validationViolation(
          sheet,
          targetCells.map((entry) => entry.coordinate),
        );
        if (violation) throw new HttpError(400, violation);
        workbook.updatedAt = now;
        result = workbook;
      });
      return result;
    },

    /**
     * Saves or deletes a validation rule on one worksheet. Saving a rule
     * (`{range, rule}`) replaces every stored rule that intersects the range
     * with the new inclusive rule and never rewrites existing cell values;
     * deleting (`{deleteRuleId}`) removes the named rule. Atomic: on any
     * failure the store stays unchanged.
     */
    async setValidation(id, sheetId, body) {
      const now = new Date().toISOString();
      let result;
      await store.update((state) => {
        const workbook = findWorkbook(state, id);
        const sheet = findSheet(workbook, sheetId);
        if (body?.deleteRuleId !== undefined) {
          const existing = sheet.validationRules ?? [];
          const next = existing.filter((rule) => rule.id !== body.deleteRuleId);
          if (next.length === existing.length) {
            throw new HttpError(404, "Validation rule not found");
          }
          sheet.validationRules = next;
          workbook.updatedAt = now;
          result = workbook;
          return;
        }
        const parsed = parseValidationRuleBody(body);
        if (!parsed) throw new HttpError(400, "Invalid validation rule");
        const { range, rule } = parsed;
        sheet.validationRules = [
          ...(sheet.validationRules ?? []).filter((existing) => !rangesOverlap(existing.range, range)),
          rule,
        ];
        workbook.updatedAt = now;
        result = workbook;
      });
      return result;
    },

    /**
     * Sorts the rows of a rectangular range by one absolute column. When the
     * first row is declared a header it stays in place; otherwise every row in
     * the range participates. Numbers, parseable dates and text are compared
     * by their respective types and equal sort keys keep their original
     * relative order. Cells outside the range are never touched; formulas move
     * with their rows and are recalculated. Atomic: on failure the grid keeps
     * its original order.
     */
    async sortRange(id, sheetId, body) {
      const parsed = parseSortBody(body);
      const now = new Date().toISOString();
      let result;
      await store.update((state) => {
        const workbook = findWorkbook(state, id);
        const sheet = findSheet(workbook, sheetId);
        const { range, sortBy, order, hasHeaderRow } = parsed;
        const lines = [];
        for (let row = range.start.row; row <= range.end.row; row += 1) {
          const line = [];
          for (let column = range.start.column; column <= range.end.column; column += 1) {
            line.push(sheet.cells?.[cellCoordinate(row, column)]);
          }
          lines.push({ row, line });
        }
        const bodyLines = hasHeaderRow ? lines.slice(1) : lines;
        const keyed = bodyLines.map((entry) => ({
          entry,
          key: sortKeyFor(entry.line[sortBy - range.start.column]?.value ?? ""),
        }));
        const orderFactor = order === "descending" ? -1 : 1;
        keyed.sort((a, b) => {
          const compared = compareSortKeys(a.key, b.key);
          if (compared !== 0) {
            // Blank rows always sort last, in both directions.
            if (a.key.rank === 3 || b.key.rank === 3) return compared;
            return compared * orderFactor;
          }
          return keyed.indexOf(a) - keyed.indexOf(b);
        });
        const sorted = keyed.map((item) => item.entry);
        const nextLines = hasHeaderRow ? [lines[0], ...sorted] : sorted;
        const nextCells = { ...sheet.cells };
        nextLines.forEach((entry, offset) => {
          const targetRow = range.start.row + offset;
          for (let column = range.start.column; column <= range.end.column; column += 1) {
            const coordinate = cellCoordinate(targetRow, column);
            const cell = entry.line[column - range.start.column];
            if (cell) nextCells[coordinate] = cell;
            else delete nextCells[coordinate];
          }
        });
        sheet.cells = nextCells;
        recalculateWorkbook(workbook);
        workbook.updatedAt = now;
        result = workbook;
      });
      return result;
    },

    /**
     * Restores a complete worksheet state (cells, validation rules, filter
     * views and pivot config) from a snapshot. Atomic: the whole sheet is
     * replaced and recalculated, or the store is left unchanged. Used by
     * undo/redo so the restored state persists after refresh.
     */
    async restoreSheet(id, sheetId, body) {
      const snapshot = body?.sheet;
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
        throw new HttpError(400, "Invalid sheet state");
      }
      if (!snapshot.cells || typeof snapshot.cells !== "object" || Array.isArray(snapshot.cells)) {
        throw new HttpError(400, "Invalid sheet state");
      }
      const cells = {};
      for (const [coordinate, cell] of Object.entries(snapshot.cells)) {
        if (!parseCoordinate(coordinate)) throw new HttpError(400, "Invalid cell coordinate");
        if (!cell || typeof cell !== "object") throw new HttpError(400, "Invalid cell data");
        const restored = { value: typeof cell.value === "string" ? cell.value : String(cell.value ?? "") };
        if (typeof cell.formula === "string") restored.formula = cell.formula;
        cells[coordinate] = restored;
      }
      const validationRules = Array.isArray(snapshot.validationRules) ? structuredClone(snapshot.validationRules) : undefined;
      const filterViews = Array.isArray(snapshot.filterViews) ? structuredClone(snapshot.filterViews) : undefined;
      const pivot = snapshot.pivot === undefined ? undefined : structuredClone(snapshot.pivot);
      const now = new Date().toISOString();
      let result;
      await store.update((state) => {
        const workbook = findWorkbook(state, id);
        const sheet = findSheet(workbook, sheetId);
        sheet.cells = cells;
        if (validationRules !== undefined) sheet.validationRules = validationRules;
        if (filterViews !== undefined) sheet.filterViews = filterViews;
        if (pivot !== undefined) sheet.pivot = pivot;
        recalculateWorkbook(workbook);
        const violation = validationViolation(sheet, Object.keys(cells));
        if (violation) throw new HttpError(400, violation);
        workbook.updatedAt = now;
        result = workbook;
      });
      return result;
    },

    /** Persists the complete selection rectangle of one worksheet (or null). */
    async setSelection(id, sheetId, body) {
      const raw = body?.selection;
      let normalized = null;
      if (raw !== null && raw !== undefined) {
        normalized = normalizeRange(raw);
        if (!normalized) throw new HttpError(400, "Invalid selection");
      }
      let result;
      await store.update((state) => {
        const workbook = findWorkbook(state, id);
        const sheet = findSheet(workbook, sheetId);
        sheet.selection = normalized;
        result = workbook;
      });
      return result;
    },

    async importWorkbook({ fileName, csv }) {
      let rows;
      try {
        rows = parseCsv(csv);
      } catch (error) {
        if (error instanceof CsvError) {
          throw new HttpError(400, error.message);
        }
        throw error;
      }
      const base = typeof fileName === "string" ? fileName.replace(/\.csv$/i, "") : "";
      const name = base.trim() === "" ? "Imported workbook" : base.trim();
      const now = new Date().toISOString();
      const sheetId = randomUUID();
      const cells = {};
      rows.forEach((row, rowIndex) => {
        row.forEach((field, columnIndex) => {
          cells[cellCoordinate(rowIndex + 1, columnIndex + 1)] = { value: String(field) };
        });
      });
      const workbook = {
        id: randomUUID(),
        name,
        createdAt: now,
        updatedAt: now,
        activeSheetId: sheetId,
        sheets: [{ id: sheetId, name: "Sheet1", cells }],
      };
      await store.update((state) => {
        state.workbooks.push(workbook);
      });
      return workbook;
    },

    async exportActiveSheet(id) {
      const state = await store.read();
      const workbook = findWorkbook(state, id);
      const sheet = activeSheet(workbook);
      const cells = sheet.cells ?? {};
      let maxRow = 0;
      let maxColumn = 0;
      for (const coordinate of Object.keys(cells)) {
        const parsed = parseCoordinate(coordinate);
        if (!parsed) continue;
        maxRow = Math.max(maxRow, parsed.row);
        maxColumn = Math.max(maxColumn, parsed.column);
      }
      const rows = [];
      for (let row = 1; row <= maxRow; row += 1) {
        const line = [];
        for (let column = 1; column <= maxColumn; column += 1) {
          const cell = cells[cellCoordinate(row, column)];
          line.push(cell ? cell.value : "");
        }
        rows.push(line);
      }
      return {
        text: serializeCsv(rows),
        fileName: `${workbook.name}.csv`,
      };
    },
  };
}
