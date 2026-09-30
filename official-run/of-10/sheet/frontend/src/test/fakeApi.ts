import { vi } from "vitest";

import type { CellAddress, CellRegion } from "../lib/cells";
import type {
  ColumnFilterData,
  FilterCondition,
  PivotData,
  PivotSummary,
  ValidationRuleData,
  WorkbookData,
  WorksheetData,
} from "../workbooks/types";
import { MAX_COLUMN_INDEX, MAX_ROW_INDEX, computeFakeDisplays } from "./fakeFormula";
import { computeFakePivot, fakeSourceHeaders, shiftFakePivotSources } from "./fakePivot";
import { applyFakeSort, readFakeSortChange } from "./fakeSort";
import { applyStructure, cellId, parseAddress } from "./fakeStructure";

const SEED_UPDATED_AT = "2026-09-28T10:15:00.000Z";
const FILTER_CONDITION_IDS: FilterCondition[] = [
  "textContains",
  "greaterThan",
  "before",
  "isEmpty",
  "isNotEmpty",
];

export interface FakeApi {
  state: { workbooks: WorkbookData[]; failCellWrites: boolean };
  fetch: ReturnType<typeof vi.fn>;
}

/** One undoable operation of the fake server: the worksheet state before and after it (REQ-3-2-2). */
interface HistoryEntry {
  worksheetId: string;
  before: WorksheetData;
  after: WorksheetData;
}

/** Domain data of the fake server is plain JSON, so a deep copy can be a JSON copy. */
function cloneWorksheet(worksheet: WorksheetData): WorksheetData {
  return JSON.parse(JSON.stringify(worksheet)) as WorksheetData;
}

/**
 * Writes one batch of cell values and recalculates the displays, like the server does after every
 * write: a formula cell keeps the submitted text and gains the result (or error) it calculates.
 */
function writeCells(worksheet: WorksheetData, writes: { cellId: string; value: string }[]): void {
  for (const write of writes) {
    if (write.value === "") delete worksheet.cells[write.cellId];
    else worksheet.cells[write.cellId] = { value: write.value };
  }
  worksheet.cells = computeFakeDisplays(worksheet.cells);
}

function seedWorkbook(): WorkbookData {
  return {
    id: "wb_q3_sales",
    name: "Q3 Sales",
    createdAt: SEED_UPDATED_AT,
    updatedAt: SEED_UPDATED_AT,
    activeWorksheetId: "ws_q3_sales_sheet1",
    worksheets: [
      {
        id: "ws_q3_sales_sheet1",
        name: "Sheet1",
        rowCount: 12,
        columnCount: 6,
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
        validations: [],
        filter: null,
        selection: { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } },
      },
      {
        id: "ws_q3_sales_sheet2",
        name: "Sheet2",
        rowCount: 12,
        columnCount: 6,
        cells: {},
        validations: [],
        filter: null,
        selection: { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } },
      },
    ],
  };
}

function ruleMessage(rule: ValidationRuleData): string {
  if (rule.message) return rule.message;
  if (rule.type === "dropdown") return `Please select one of the following values: ${(rule.allowedValues ?? []).join(", ")}`;
  return `Please enter a number between ${rule.min} and ${rule.max}`;
}

function ruleViolation(rule: ValidationRuleData, value: string): string | null {
  if (value === "") return null;
  if (rule.type === "dropdown") return (rule.allowedValues ?? []).includes(value) ? null : ruleMessage(rule);
  const number = Number(value);
  if (!Number.isFinite(number)) return ruleMessage(rule);
  const min = rule.min ?? Number.NEGATIVE_INFINITY;
  const max = rule.max ?? Number.POSITIVE_INFINITY;
  return number >= min && number <= max ? null : ruleMessage(rule);
}

function splitCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (inQuotes) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field === "") {
      inQuotes = true;
      continue;
    }
    if (character === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (character === "\n" || character === "\r") {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += character;
  }
  if (inQuotes) throw new Error("invalid csv");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Mirrors `firstUnusedSheetName` of the server: the first unused `SheetN` in integer order. */
function nextWorksheetName(workbook: WorkbookData): string {
  const used = new Set<number>();
  for (const worksheet of workbook.worksheets) {
    const match = /^sheet(\d+)$/i.exec(worksheet.name.trim());
    if (match) used.add(Number(match[1]));
  }
  let index = 1;
  while (used.has(index)) index += 1;
  return `Sheet${index}`;
}

/** Mirrors `firstUnusedPivotName` of the server: the first unused `PivotN` in integer order. */
function nextPivotName(workbook: WorkbookData): string {
  const used = new Set<number>();
  for (const worksheet of workbook.worksheets) {
    const match = /^pivot(\d+)$/i.exec(worksheet.name.trim());
    if (match) used.add(Number(match[1]));
  }
  let index = 1;
  while (used.has(index)) index += 1;
  return `Pivot${index}`;
}

function blankWorksheet(id: string, name: string): WorksheetData {
  return {
    id,
    name,
    rowCount: 12,
    columnCount: 6,
    cells: {},
    validations: [],
    filter: null,
    selection: { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } },
  };
}

/** Parses an `A1:B2` reference or a `{top,bottom,left,right}` rectangle like the server does. */
function parseRegion(value: unknown): CellRegion | null {
  if (typeof value === "string") {
    const parts = value.trim().split(":");
    if (parts.length > 2) return null;
    const start = parseAddress(parts[0]);
    if (!start) return null;
    const end = parts.length === 2 ? parseAddress(parts[1]) : start;
    if (!end) return null;
    return {
      top: Math.min(start.row, end.row),
      bottom: Math.max(start.row, end.row),
      left: Math.min(start.column, end.column),
      right: Math.max(start.column, end.column),
    };
  }
  const region = value as CellRegion | undefined;
  if (!region) return null;
  const edges = [region.top, region.bottom, region.left, region.right];
  if (!edges.every((edge) => Number.isInteger(edge))) return null;
  if (region.top < 1 || region.left < 1 || region.bottom < region.top || region.right < region.left) return null;
  return { top: region.top, bottom: region.bottom, left: region.left, right: region.right };
}

/** Mirrors `normalizeValidationRule` of the server, including the generated rule message. */
function normalizeRule(raw: Record<string, unknown>, id: string): ValidationRuleData | { error: string } {
  const range = parseRegion(raw.range);
  if (!range) return { error: "Enter a valid range such as A1:B2" };
  if (raw.type === "dropdown") {
    const allowedValues: string[] = [];
    for (const value of Array.isArray(raw.allowedValues) ? raw.allowedValues : []) {
      const text = String(value).trim();
      if (text !== "" && !allowedValues.includes(text)) allowedValues.push(text);
    }
    if (allowedValues.length === 0) return { error: "Enter at least one allowed value" };
    return { id, type: "dropdown", range, allowedValues };
  }
  const min = Number(raw.min);
  const max = Number(raw.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { error: "Enter a numeric minimum and maximum" };
  return { id, type: "numberRange", range, min, max };
}

/** Mirrors `normalizeFilter` of the server: a rectangle region and one filter per used column. */
function normalizeFilterInput(raw: Record<string, unknown>): { region: CellRegion; columns: ColumnFilterData[] } | { error: string } {
  const region = parseRegion(raw.region);
  if (!region) return { error: "Enter a valid range such as A1:B2" };
  const byColumn = new Map<number, ColumnFilterData>();
  for (const entry of Array.isArray(raw.columns) ? (raw.columns as Record<string, unknown>[]) : []) {
    const column = Number(entry?.column);
    if (!Number.isInteger(column) || column < region.left || column > region.right) {
      return { error: "The filtered column is outside the filtered range" };
    }
    if (entry.kind === "values") {
      const selected: string[] = [];
      for (const value of Array.isArray(entry.selected) ? entry.selected : []) {
        const text = String(value);
        if (!selected.includes(text)) selected.push(text);
      }
      byColumn.set(column, { column, kind: "values", selected });
      continue;
    }
    if (entry.kind === "condition") {
      const condition = String(entry.condition ?? "") as FilterCondition;
      if (!FILTER_CONDITION_IDS.includes(condition)) return { error: "Unknown filter condition" };
      const needsValue = condition === "textContains" || condition === "greaterThan" || condition === "before";
      byColumn.set(column, { column, kind: "condition", condition, value: needsValue ? String(entry.value ?? "").trim() : "" });
      continue;
    }
    return { error: "Unknown filter type" };
  }
  return { region, columns: [...byColumn.values()].sort((left, right) => left.column - right.column) };
}

function isInRegion(region: CellRegion, address: CellAddress): boolean {
  return (
    address.row >= region.top &&
    address.row <= region.bottom &&
    address.column >= region.left &&
    address.column <= region.right
  );
}

/**
 * Mirrors the server: a copied formula follows the target offset, an absolute part stays put, and an
 * offset that moves a relative reference outside the sheet makes the whole formula `=#REF!`.
 */
function translateFormula(text: string, rowOffset: number, columnOffset: number): string {
  if (!(text.length > 1 && text.startsWith("="))) return text;
  let movedOutside = false;
  const translated = `=${text.slice(1).replace(/(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]{0,6})(?![A-Za-z0-9_])/g, (match, columnDollar, columnLabel, rowDollar, rowText) => {
    let column = 0;
    for (const character of String(columnLabel).toUpperCase()) column = column * 26 + (character.charCodeAt(0) - 64);
    const insideSheet =
      column >= 1 && column <= MAX_COLUMN_INDEX && Number(rowText) >= 1 && Number(rowText) <= MAX_ROW_INDEX;
    let row = Number(rowText);
    if (columnDollar === "") column += columnOffset;
    if (rowDollar === "") row += rowOffset;
    if (column < 1 || row < 1 || column > MAX_COLUMN_INDEX || row > MAX_ROW_INDEX) {
      if (insideSheet) movedOutside = true;
      return "#REF!";
    }
    let label = "";
    for (let rest = column; rest > 0; rest = Math.floor((rest - 1) / 26)) {
      label = String.fromCharCode(65 + ((rest - 1) % 26)) + label;
    }
    return `${columnDollar}${label}${rowDollar}${row}`;
  })}`;
  return movedOutside ? "=#REF!" : translated;
}

function ruleOf(worksheet: WorksheetData, address: CellAddress, value: string): string | null {
  for (const rule of worksheet.validations ?? []) {
    if (!isInRegion(rule.range, address)) continue;
    const violation = ruleViolation(rule, value);
    if (violation) return violation;
  }
  return null;
}

export function createFakeApi(): FakeApi {
  const state: FakeApi["state"] = { workbooks: [seedWorkbook()], failCellWrites: false };
  let sequence = 0;

  /** Session history of the fake server: one undo/redo stack per workbook (REQ-3-2-2). */
  const history = new Map<string, { undo: HistoryEntry[]; redo: HistoryEntry[] }>();

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const findWorkbook = (id: string) => state.workbooks.find((workbook) => workbook.id === id) ?? null;

  const logOf = (workbookId: string) => {
    let log = history.get(workbookId);
    if (!log) {
      log = { undo: [], redo: [] };
      history.set(workbookId, log);
    }
    return log;
  };

  /** Every workbook response carries the availability of undo and redo, like the server does. */
  const respond = (workbook: WorkbookData, status = 200) => {
    const log = history.get(workbook.id);
    return json(status, {
      workbook,
      canUndo: Boolean(log && log.undo.length > 0),
      canRedo: Boolean(log && log.redo.length > 0),
    });
  };

  /** Keeps one worksheet scoped operation, dropping the redo branch a new change replaces. */
  const recordChange = (workbookId: string, worksheetId: string, before: WorksheetData, after: WorksheetData) => {
    const log = logOf(workbookId);
    log.undo.push({ worksheetId, before, after });
    log.redo.length = 0;
  };

  /** Recomputes one pivot worksheet; a refused configuration writes nothing. */
  const applyFakePivot = (
    workbook: WorkbookData,
    worksheet: WorksheetData,
    config: PivotData,
  ): { ok: true } | { error: string } => {
    const source = workbook.worksheets.find((candidate) => candidate.id === config.sourceWorksheetId);
    if (!source) return { error: "The pivot source range is no longer available." };
    const result = computeFakePivot(source, config);
    if ("error" in result) return result;
    worksheet.pivot = config;
    worksheet.cells = result.cells;
    worksheet.rowCount = Math.max(worksheet.rowCount, result.rowCount);
    worksheet.columnCount = Math.max(worksheet.columnCount, result.columnCount);
    workbook.updatedAt = "2026-09-29T09:56:00.000Z";
    return { ok: true };
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

    if (segments[0] !== "api" || segments[1] !== "workbooks") return json(404, { error: "Not found" });

    if (segments.length === 2) {
      if (method === "GET") {
        return json(200, {
          workbooks: [...state.workbooks]
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name))
            .map(({ id, name, updatedAt }) => ({ id, name, updatedAt })),
        });
      }
      if (method === "POST") {
        sequence += 1;
        const name = typeof body.name === "string" && body.name.trim() !== "" ? body.name.trim() : "Untitled workbook";
        const worksheet: WorksheetData = {
          id: `ws_new_${sequence}`,
          name: "Sheet1",
          rowCount: 12,
          columnCount: 4,
          cells: {},
          validations: [],
          selection: { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } },
        };
        const workbook: WorkbookData = {
          id: `wb_new_${sequence}`,
          name,
          createdAt: "2026-09-29T08:00:00.000Z",
          updatedAt: "2026-09-29T08:00:00.000Z",
          activeWorksheetId: worksheet.id,
          worksheets: [worksheet],
        };
        state.workbooks.push(workbook);
        return respond(workbook, 201);
      }
    }

    if (segments.length === 3 && segments[2] === "import" && method === "POST") {
      const fileName = typeof body.fileName === "string" ? body.fileName : "";
      const content = typeof body.content === "string" ? body.content : "";
      let rows: string[][];
      try {
        rows = splitCsv(content);
      } catch {
        return json(400, { error: "Invalid CSV file format. Import failed." });
      }
      sequence += 1;
      const cells: WorksheetData["cells"] = {};
      let columnCount = 4;
      rows.forEach((row, rowIndex) => {
        columnCount = Math.max(columnCount, row.length);
        row.forEach((text, columnIndex) => {
          if (text !== "") cells[cellId(rowIndex + 1, columnIndex + 1)] = { value: text };
        });
      });
      const worksheet: WorksheetData = {
        id: `ws_import_${sequence}`,
        name: "Sheet1",
        rowCount: Math.max(12, rows.length),
        columnCount,
        cells: computeFakeDisplays(cells),
        validations: [],
        selection: { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } },
      };
      const workbook: WorkbookData = {
        id: `wb_import_${sequence}`,
        name: fileName.replace(/\.[cC][sS][vV]$/, "") || "Imported workbook",
        createdAt: "2026-09-29T08:05:00.000Z",
        updatedAt: "2026-09-29T08:05:00.000Z",
        activeWorksheetId: worksheet.id,
        worksheets: [worksheet],
      };
      state.workbooks.push(workbook);
      return respond(workbook, 201);
    }

    const workbook = findWorkbook(segments[2]);
    if (!workbook) return json(404, { error: "Workbook not found" });

    if (segments.length === 4 && (segments[3] === "undo" || segments[3] === "redo") && method === "POST") {
      const log = logOf(workbook.id);
      const step = segments[3];
      const stack = step === "undo" ? log.undo : log.redo;
      const branch = step === "undo" ? log.redo : log.undo;
      const entry = stack.pop();
      if (!entry) return json(409, { error: step === "undo" ? "There is nothing to undo" : "There is nothing to redo" });
      branch.push(entry);
      const index = workbook.worksheets.findIndex((candidate) => candidate.id === entry.worksheetId);
      if (index !== -1) workbook.worksheets[index] = cloneWorksheet(step === "undo" ? entry.before : entry.after);
      workbook.updatedAt = "2026-09-29T10:05:00.000Z";
      return respond(workbook);
    }

    if (segments.length === 4 && segments[3] === "worksheets" && method === "POST") {
      sequence += 1;
      const worksheet = blankWorksheet(`ws_added_${sequence}`, nextWorksheetName(workbook));
      workbook.worksheets.push(worksheet);
      workbook.activeWorksheetId = worksheet.id;
      workbook.updatedAt = "2026-09-29T09:40:00.000Z";
      return respond(workbook, 201);
    }

    if (segments.length === 3) {
      if (method === "GET") return respond(workbook);
      if (method === "PATCH") {
        if (typeof body.name === "string") {
          const name = body.name.trim();
          if (name === "") return json(400, { error: "Workbook name cannot be empty" });
          workbook.name = name;
          workbook.updatedAt = "2026-09-29T09:30:00.000Z";
        }
        if (typeof body.activeWorksheetId === "string") workbook.activeWorksheetId = body.activeWorksheetId;
        return respond(workbook);
      }
    }

    if (segments.length === 5 && segments[3] === "worksheets" && method === "PATCH") {      const worksheet = workbook.worksheets.find((candidate) => candidate.id === segments[4]);
      if (!worksheet) return json(404, { error: "Unknown worksheet" });
      if (body.name !== undefined) {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (name === "") return json(400, { error: "Worksheet name cannot be empty" });
        const taken = workbook.worksheets.some(
          (candidate) => candidate.id !== worksheet.id && candidate.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (taken) return json(400, { error: "Worksheet name already exists" });
        worksheet.name = name;
        workbook.updatedAt = "2026-09-29T09:45:00.000Z";
        return respond(workbook);
      }
      const selection = body.selection as WorksheetData["selection"] | undefined;
      if (!selection || !Number.isInteger(selection.anchor?.row) || !Number.isInteger(selection.focus?.row)) {
        return json(400, { error: "Invalid selection" });
      }
      worksheet.selection = selection;
      return respond(workbook);
    }

    if (segments.length === 5 && segments[3] === "worksheets" && method === "DELETE") {
      const index = workbook.worksheets.findIndex((candidate) => candidate.id === segments[4]);
      if (index === -1) return json(404, { error: "Unknown worksheet" });
      if (workbook.worksheets.length <= 1) {
        return json(400, { error: "A workbook must contain at least one worksheet" });
      }
      const reader = workbook.worksheets.find(
        (candidate) => candidate.pivot && candidate.pivot.sourceWorksheetId === segments[4],
      );
      if (reader) {
        return json(400, { error: "Please delete or rebuild dependent pivot tables first" });
      }
      const wasActive = workbook.activeWorksheetId === segments[4];
      workbook.worksheets.splice(index, 1);
      if (wasActive) {
        workbook.activeWorksheetId = workbook.worksheets[Math.min(index, workbook.worksheets.length - 1)].id;
      }
      workbook.updatedAt = "2026-09-29T09:58:00.000Z";
      return respond(workbook);
    }

    if (segments.length === 6 && segments[3] === "worksheets" && segments[5] === "structure" && method === "POST") {
      if (state.failCellWrites) return json(500, { error: "Storage unavailable" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === segments[4]);
      if (!worksheet) return json(404, { error: "Unknown worksheet" });
      const axis = body.axis === "row" || body.axis === "column" ? body.axis : null;
      const op = body.op === "insert" || body.op === "delete" ? body.op : null;
      const index = Number(body.index);
      const count = axis === "column" ? worksheet.columnCount : worksheet.rowCount;
      if (!axis || !op || !Number.isInteger(index) || index < 1 || index > count) {
        return json(400, {
          error: axis === "column" ? "The column is outside the worksheet" : "The row is outside the worksheet",
        });
      }
      const before = cloneWorksheet(worksheet);
      applyStructure(worksheet, { axis, op, index, side: body.side === "after" ? "after" : "before" });
      shiftFakePivotSources(workbook, worksheet.id, {
        axis,
        op,
        index,
        side: body.side === "after" ? "after" : "before",
      });
      workbook.updatedAt = "2026-09-29T09:50:00.000Z";
      recordChange(workbook.id, worksheet.id, before, cloneWorksheet(worksheet));
      return respond(workbook);
    }

    if (segments.length === 6 && segments[3] === "worksheets" && segments[5] === "sort" && method === "POST") {
      if (state.failCellWrites) return json(500, { error: "Storage unavailable" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === segments[4]);
      if (!worksheet) return json(404, { error: "Unknown worksheet" });
      const change = readFakeSortChange(worksheet, body);
      if ("error" in change) return json(400, { error: change.error });
      const before = cloneWorksheet(worksheet);
      applyFakeSort(worksheet, change);
      worksheet.cells = computeFakeDisplays(worksheet.cells);
      workbook.updatedAt = "2026-09-29T09:20:00.000Z";
      recordChange(workbook.id, worksheet.id, before, cloneWorksheet(worksheet));
      return respond(workbook);
    }

    if (segments.length === 6 && segments[3] === "worksheets" && segments[5] === "paste" && method === "POST") {
      if (state.failCellWrites) return json(500, { error: "Storage unavailable" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === segments[4]);
      if (!worksheet) return json(404, { error: "Unknown worksheet" });
      const start = parseAddress(String(body.cell ?? ""));
      if (!start) return json(400, { error: "Invalid cell address" });
      const values = Array.isArray(body.values) ? (body.values as unknown[][]) : [];
      if (values.length === 0) return json(400, { error: "Nothing to paste" });

      const writes: { cellId: string; value: string }[] = [];
      values.forEach((row, rowIndex) => {
        if (!Array.isArray(row)) return;
        row.forEach((text, columnIndex) => {
          writes.push({
            cellId: cellId(start.row + rowIndex, start.column + columnIndex),
            value: text === null || text === undefined ? "" : String(text),
          });
        });
      });
      for (const write of writes) {
        const address = parseAddress(write.cellId);
        if (!address) continue;
        for (const rule of worksheet.validations ?? []) {
          const inRange =
            address.row >= rule.range.top &&
            address.row <= rule.range.bottom &&
            address.column >= rule.range.left &&
            address.column <= rule.range.right;
          const violation = inRange ? ruleViolation(rule, write.value) : null;
          if (violation) return json(400, { error: violation });
        }
      }
      const before = cloneWorksheet(worksheet);
      writeCells(worksheet, writes);
      workbook.updatedAt = "2026-09-29T09:10:00.000Z";
      recordChange(workbook.id, worksheet.id, before, cloneWorksheet(worksheet));
      return respond(workbook);
    }

    if (segments.length === 6 && segments[3] === "worksheets" && segments[5] === "transfer" && method === "POST") {
      if (state.failCellWrites) return json(500, { error: "Storage unavailable" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === segments[4]);
      if (!worksheet) return json(404, { error: "Unknown worksheet" });
      const mode = body.mode === "cut" ? "cut" : body.mode === "copy" ? "copy" : null;
      if (!mode) return json(400, { error: "Unknown range operation" });
      const source = body.source as CellRegion | undefined;
      if (
        !source ||
        ![source.top, source.bottom, source.left, source.right].every((value) => Number.isInteger(value)) ||
        source.top < 1 ||
        source.left < 1 ||
        source.bottom < source.top ||
        source.right < source.left
      ) {
        return json(400, { error: "Select a range to copy or cut" });
      }
      const target = parseAddress(String(body.target ?? ""));
      if (!target) return json(400, { error: "Invalid target cell" });

      const height = source.bottom - source.top + 1;
      const width = source.right - source.left + 1;
      const rowOffset = target.row - source.top;
      const columnOffset = target.column - source.left;
      const targetRegion: CellRegion = {
        top: target.row,
        bottom: target.row + height - 1,
        left: target.column,
        right: target.column + width - 1,
      };
      const writes: { cellId: string; value: string }[] = [];
      const clears: string[] = [];
      for (let row = source.top; row <= source.bottom; row += 1) {
        for (let column = source.left; column <= source.right; column += 1) {
          const from = cellId(row, column);
          const text = worksheet.cells[from]?.value ?? "";
          writes.push({
            cellId: cellId(row + rowOffset, column + columnOffset),
            value: mode === "copy" ? translateFormula(text, rowOffset, columnOffset) : text,
          });
          if (mode === "cut" && !isInRegion(targetRegion, { row, column })) clears.push(from);
        }
      }
      for (const write of writes) {
        const address = parseAddress(write.cellId);
        if (!address) continue;
        const violation = ruleOf(worksheet, address, write.value);
        if (violation) return json(400, { error: violation });
      }
      const before = cloneWorksheet(worksheet);
      writeCells(worksheet, writes);
      writeCells(worksheet, clears.map((cellId) => ({ cellId, value: "" })));
      workbook.updatedAt = "2026-09-29T09:15:00.000Z";
      recordChange(workbook.id, worksheet.id, before, cloneWorksheet(worksheet));
      return respond(workbook);
    }

    if (segments.length === 4 && segments[3] === "pivots" && method === "POST") {
      const source = workbook.worksheets.find((candidate) => candidate.id === body.sourceWorksheetId);
      if (!source) return json(404, { error: "Unknown worksheet" });
      const range = parseRegion(body.sourceRange);
      if (!range) return json(400, { error: "Enter a valid range such as A1:B2" });
      if (
        range.bottom <= range.top ||
        range.bottom > source.rowCount ||
        range.right > source.columnCount ||
        fakeSourceHeaders(source, range).length === 0
      ) {
        return json(400, { error: "Select a range with a header row to create a pivot table." });
      }
      sequence += 1;
      const worksheet = blankWorksheet(`ws_pivot_${sequence}`, nextPivotName(workbook));
      worksheet.pivot = {
        sourceWorksheetId: source.id,
        sourceRange: range,
        rows: null,
        columns: null,
        values: null,
        summarizeBy: "SUM",
      };
      workbook.worksheets.push(worksheet);
      workbook.activeWorksheetId = worksheet.id;
      workbook.updatedAt = "2026-09-29T09:55:00.000Z";
      return respond(workbook, 201);
    }

    if (segments.length === 6 && segments[3] === "worksheets" && segments[5] === "pivot" && method === "PUT") {
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === segments[4]);
      if (!worksheet) return json(404, { error: "Unknown worksheet" });
      const stored = worksheet.pivot;
      if (!stored) return json(400, { error: "This worksheet is not a pivot table." });
      const summarizeBy = String(body.summarizeBy ?? stored.summarizeBy).trim().toUpperCase() as PivotSummary;
      if (!["SUM", "COUNT", "AVERAGE"].includes(summarizeBy)) {
        return json(400, { error: "Unknown summarization method" });
      }
      const field = (value: unknown, fallback: string | null) => {
        if (typeof value !== "string") return fallback;
        const trimmed = value.trim();
        return trimmed === "" ? null : trimmed;
      };
      const config: PivotData = {
        ...stored,
        rows: field(body.rows, stored.rows),
        columns: field(body.columns, stored.columns),
        values: field(body.values, stored.values),
        summarizeBy,
      };
      const result = applyFakePivot(workbook, worksheet, config);
      if ("error" in result) return json(400, { error: result.error });
      return respond(workbook);
    }

    if (
      segments.length === 7 &&
      segments[3] === "worksheets" &&
      segments[5] === "pivot" &&
      segments[6] === "refresh" &&
      method === "POST"
    ) {
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === segments[4]);
      if (!worksheet) return json(404, { error: "Unknown worksheet" });
      const stored = worksheet.pivot;
      if (!stored) return json(400, { error: "This worksheet is not a pivot table." });
      const result = applyFakePivot(workbook, worksheet, stored);
      if ("error" in result) return json(400, { error: result.error });
      return respond(workbook);
    }

    if (segments.length === 6 && segments[3] === "worksheets" && segments[5] === "filter") {
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === segments[4]);
      if (!worksheet) return json(404, { error: "Unknown worksheet" });
      if (method === "DELETE") {
        worksheet.filter = null;
        return respond(workbook);
      }
      if (method === "PUT") {
        const normalized = normalizeFilterInput(body);
        if ("error" in normalized) return json(400, { error: normalized.error });
        worksheet.filter = normalized;
        return respond(workbook);
      }
      return json(405, { error: "Method not allowed" });
    }

    if (segments.length === 7 && segments[3] === "worksheets" && segments[5] === "validations" && method === "DELETE") {
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === segments[4]);
      if (!worksheet) return json(404, { error: "Unknown worksheet" });
      worksheet.validations = (worksheet.validations ?? []).filter((rule) => rule.id !== segments[6]);
      return respond(workbook);
    }

    if (segments.length === 6 && segments[3] === "worksheets" && segments[5] === "validations" && method === "PUT") {
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === segments[4]);
      if (!worksheet) return json(404, { error: "Unknown worksheet" });
      const rule = normalizeRule(body, `vr_${(worksheet.validations ?? []).length + 1}`);
      if ("error" in rule) return json(400, { error: rule.error });
      worksheet.validations = [
        ...(worksheet.validations ?? []).filter(
          (existing) =>
            existing.type !== rule.type ||
            existing.range.top !== rule.range.top ||
            existing.range.bottom !== rule.range.bottom ||
            existing.range.left !== rule.range.left ||
            existing.range.right !== rule.range.right,
        ),
        rule,
      ];
      return respond(workbook);
    }

    if (segments.length === 7 && segments[3] === "worksheets" && segments[5] === "cells" && method === "PUT") {
      if (state.failCellWrites) return json(500, { error: "Storage unavailable" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === segments[4]);
      if (!worksheet) return json(404, { error: "Unknown worksheet" });
      const value = typeof body.value === "string" ? body.value : "";
      const address = parseAddress(segments[6]);
      if (address) {
        for (const rule of worksheet.validations ?? []) {
          const inRange =
            address.row >= rule.range.top &&
            address.row <= rule.range.bottom &&
            address.column >= rule.range.left &&
            address.column <= rule.range.right;
          const violation = inRange ? ruleViolation(rule, value) : null;
          if (violation) return json(400, { error: violation });
        }
      }
      const before = cloneWorksheet(worksheet);
      writeCells(worksheet, [{ cellId: segments[6], value }]);
      workbook.updatedAt = "2026-09-29T09:00:00.000Z";
      recordChange(workbook.id, worksheet.id, before, cloneWorksheet(worksheet));
      return respond(workbook);
    }

    return json(404, { error: "Not found" });
  });

  return { state, fetch: fetchMock };
}
