import { vi } from "vitest";

import { cellName, parseCellName } from "../domain/grid";
import type { SummarizeMethod, Worksheet, Workbook } from "../domain/types";

export const SEED_WORKBOOK_ID = "wb-q3-sales";
export const SEED_WORKSHEET_ID = "ws-q3-sheet1";
export const SEED_SECOND_WORKSHEET_ID = "ws-q3-sheet2";
export const SEED_UPDATED_AT = "2026-09-28T14:05:00.000Z";

export function seedWorkbooks(): Workbook[] {
  return [
    {
      id: SEED_WORKBOOK_ID,
      name: "Q3 Sales",
      createdAt: "2026-09-21T09:00:00.000Z",
      updatedAt: SEED_UPDATED_AT,
      activeWorksheetId: SEED_WORKSHEET_ID,
      worksheets: [
        {
          id: SEED_WORKSHEET_ID,
          name: "Sheet1",
          selection: { anchor: "A1", focus: "A1" },
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
          id: SEED_SECOND_WORKSHEET_ID,
          name: "Sheet2",
          selection: { anchor: "A1", focus: "A1" },
          cells: {},
        },
      ],
    },
  ];
}

export interface FakeApi {
  readonly workbooks: Workbook[];
  /** Make the next matching request fail with a 500 response. */
  failOnce(method: string, pathname: string): void;
  restore(): void;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function summary(workbook: Workbook) {
  return {
    id: workbook.id,
    name: workbook.name,
    createdAt: workbook.createdAt,
    updatedAt: workbook.updatedAt,
    activeWorksheetId: workbook.activeWorksheetId,
    worksheetCount: workbook.worksheets.length,
  };
}

function nextSheetName(workbook: Workbook): string {
  const used = new Set(workbook.worksheets.map((worksheet) => worksheet.name));
  let index = 1;
  while (used.has(`Sheet${index}`)) index += 1;
  return `Sheet${index}`;
}

/**
 * Test-double mirror of `backend/src/domain/structure.mjs`: shifts plain values
 * for the inserted or deleted line (the authoritative implementation also
 * rewrites formula references and lives on the server).
 */
function shiftCells(
  cells: Record<string, string>,
  axis: "row" | "column",
  mode: string,
  index: number,
): Record<string, string> {
  const at = mode === "insert-after" ? index + 1 : index;
  const next: Record<string, string> = {};
  for (const [coordinate, raw] of Object.entries(cells)) {
    const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(coordinate);
    if (!match) continue;
    let column = 0;
    for (const letter of match[1].toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64);
    let row = Number(match[2]);
    if (mode === "delete") {
      if (axis === "row" ? row === index : column === index) continue;
      if (axis === "row" ? row > index : column > index) {
        if (axis === "row") row -= 1;
        else column -= 1;
      }
    } else if (axis === "row" ? row >= at : column >= at) {
      if (axis === "row") row += 1;
      else column += 1;
    }
    next[cellName(row, column)] = raw;
  }
  return next;
}

/** Canonical `A1`/`A1:B2` area, or `null` when the range is malformed. */
function normalizeArea(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parts = value.trim().split(":");
  if (parts.length < 1 || parts.length > 2) return null;
  const first = parseCellName(parts[0]);
  const last = parts.length === 2 ? parseCellName(parts[1]) : first;
  if (!first || !last) return null;
  const top = Math.min(first.row, last.row);
  const bottom = Math.max(first.row, last.row);
  const left = Math.min(first.column, last.column);
  const right = Math.max(first.column, last.column);
  const start = cellName(top, left);
  const end = cellName(bottom, right);
  return start === end ? start : `${start}:${end}`;
}

/** Test-double mirror of the backend validation rules used by write endpoints. */
function validationMessage(
  worksheet: Worksheet,
  updates: Array<{ coordinate: string; value: string }>,
): string | null {
  const rules = worksheet.validationRules;
  if (!Array.isArray(rules) || rules.length === 0) return null;
  for (const update of updates) {
    const position = parseCellName(update.coordinate);
    if (!position) continue;
    for (const rule of rules) {
      const [start, end = start] = String(rule?.range ?? "").split(":");
      const first = parseCellName(start);
      const last = parseCellName(end);
      if (!first || !last) continue;
      const top = Math.min(first.row, last.row);
      const bottom = Math.max(first.row, last.row);
      const left = Math.min(first.column, last.column);
      const right = Math.max(first.column, last.column);
      if (position.row < top || position.row > bottom || position.column < left || position.column > right) continue;
      if (rule.type === "number-range") {
        const text = update.value.trim();
        if (!text) continue;
        const number = Number(text);
        if (!Number.isFinite(number) || number < (rule.min ?? 0) || number > (rule.max ?? 0)) {
          return rule.min === 0 && rule.max === 100
            ? "Please enter a number from 0 to 100"
            : `Please enter a number between ${rule.min} and ${rule.max}`;
        }
      } else if (rule.type === "dropdown") {
        const allowed = Array.isArray(rule.values) ? rule.values : [];
        if (update.value !== "" && !allowed.includes(update.value)) {
          return `Please select one of the following values: ${allowed.join(", ")}`;
        }
      }
    }
  }
  return null;
}

/** Test-double mirror of the backend pivot domain: derived summary cell maps. */
function parseCellNumber(text: unknown): number | null {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function formatCellNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

interface Bounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function areaBounds(value: unknown): Bounds | null {
  const text = typeof value === "string" ? value.trim() : "";
  const parts = text.split(":");
  if (parts.length < 1 || parts.length > 2) return null;
  const first = parseCellName(parts[0]);
  const last = parts.length === 2 ? parseCellName(parts[1]) : first;
  if (!first || !last) return null;
  return {
    top: Math.min(first.row, last.row),
    bottom: Math.max(first.row, last.row),
    left: Math.min(first.column, last.column),
    right: Math.max(first.column, last.column),
  };
}

function boundsText(bounds: Bounds): string {
  const start = cellName(bounds.top, bounds.left);
  const end = cellName(bounds.bottom, bounds.right);
  return start === end ? start : `${start}:${end}`;
}

/** Moves an A1 area with its cells; `null` when a deleted line covered it. */
function shiftArea(area: unknown, axis: "row" | "column", mode: string, at: number): string | null {
  const bounds = areaBounds(area);
  if (!bounds) return null;
  const next = { ...bounds };
  if (axis === "row") {
    if (mode === "delete") {
      next.top = next.top > at ? next.top - 1 : next.top;
      next.bottom = next.bottom >= at ? next.bottom - 1 : next.bottom;
    } else {
      next.top = next.top >= at ? next.top + 1 : next.top;
      next.bottom = next.bottom >= at ? next.bottom + 1 : next.bottom;
    }
  } else if (mode === "delete") {
    next.left = next.left > at ? next.left - 1 : next.left;
    next.right = next.right >= at ? next.right - 1 : next.right;
  } else {
    next.left = next.left >= at ? next.left + 1 : next.left;
    next.right = next.right >= at ? next.right + 1 : next.right;
  }
  if (next.bottom < next.top || next.right < next.left) return null;
  return boundsText(next);
}

function nextPivotName(workbook: Workbook): string {
  const used = new Set(workbook.worksheets.map((worksheet) => worksheet.name));
  let index = 1;
  while (used.has(`Pivot${index}`)) index += 1;
  return `Pivot${index}`;
}

/** Mirror of the backend pivot builder; returns the message instead of throwing. */
function buildPivotCells(
  cells: Record<string, string>,
  range: string,
  config: { rowField: string; columnField: string; valueField: string; summarizeBy: SummarizeMethod },
): { cells: Record<string, string> } | { error: string } {
  const bounds = areaBounds(range);
  if (!bounds) return { error: "Invalid pivot table configuration" };
  const headers: Array<{ column: number; header: string }> = [];
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    const header = cells[cellName(bounds.top, column)] ?? "";
    if (header !== "") headers.push({ column, header });
  }
  const columnOf = (field: string) => headers.find((header) => header.header === field)?.column ?? null;
  const rowColumn = columnOf(config.rowField);
  const valueColumn = columnOf(config.valueField);
  const columnColumn = config.columnField === "" ? null : columnOf(config.columnField);
  if (rowColumn === null || valueColumn === null || (config.columnField !== "" && columnColumn === null)) {
    return { error: "Pivot field is no longer available. Select a new field." };
  }
  const records: Array<{ row: string; column: string | null; value: string }> = [];
  for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
    const group = cells[cellName(row, rowColumn)] ?? "";
    if (group === "") continue;
    records.push({
      row: group,
      column: columnColumn === null ? null : cells[cellName(row, columnColumn)] ?? "",
      value: cells[cellName(row, valueColumn)] ?? "",
    });
  }
  const summarize = (values: string[]) => {
    if (config.summarizeBy === "COUNT") return values.filter((value) => value !== "").length;
    const numbers = values.map(parseCellNumber).filter((value): value is number => value !== null);
    if (config.summarizeBy === "AVERAGE") {
      return numbers.length === 0 ? 0 : numbers.reduce((total, value) => total + value, 0) / numbers.length;
    }
    return numbers.reduce((total, value) => total + value, 0);
  };
  if (config.summarizeBy !== "COUNT" && !records.some((record) => parseCellNumber(record.value) !== null)) {
    return { error: "Value field requires numeric values" };
  }
  const firstAppearance = (values: string[]) => [...new Set(values)];
  const rowGroups = firstAppearance(records.map((record) => record.row));
  const result: Record<string, string> = { A1: config.rowField };
  if (columnColumn === null) {
    result.B1 = `${config.summarizeBy} of ${config.valueField}`;
    rowGroups.forEach((group, index) => {
      result[cellName(index + 2, 1)] = group;
      result[cellName(index + 2, 2)] = formatCellNumber(
        summarize(records.filter((record) => record.row === group).map((record) => record.value)),
      );
    });
    result[cellName(rowGroups.length + 2, 1)] = "Grand Total";
    result[cellName(rowGroups.length + 2, 2)] = formatCellNumber(summarize(records.map((record) => record.value)));
    return { cells: result };
  }
  const columnGroups = firstAppearance(records.map((record) => record.column ?? ""));
  columnGroups.forEach((group, index) => {
    result[cellName(1, index + 2)] = group;
  });
  const totalColumn = columnGroups.length + 2;
  result[cellName(1, totalColumn)] = "Grand Total";
  rowGroups.forEach((group, index) => {
    const line = index + 2;
    const rowRecords = records.filter((record) => record.row === group);
    result[cellName(line, 1)] = group;
    columnGroups.forEach((group2, columnIndex) => {
      result[cellName(line, columnIndex + 2)] = formatCellNumber(
        summarize(rowRecords.filter((record) => record.column === group2).map((record) => record.value)),
      );
    });
    result[cellName(line, totalColumn)] = formatCellNumber(summarize(rowRecords.map((record) => record.value)));
  });
  const totalLine = rowGroups.length + 2;
  result[cellName(totalLine, 1)] = "Grand Total";
  columnGroups.forEach((group, columnIndex) => {
    result[cellName(totalLine, columnIndex + 2)] = formatCellNumber(
      summarize(records.filter((record) => record.column === group).map((record) => record.value)),
    );
  });
  result[cellName(totalLine, totalColumn)] = formatCellNumber(summarize(records.map((record) => record.value)));
  return { cells: result };
}

/** Mirror of the backend default layout: first header groups, first numeric header sums. */
function defaultPivotConfig(
  cells: Record<string, string>,
  range: string,
): { rowField: string; columnField: string; valueField: string; summarizeBy: SummarizeMethod } | null {
  const bounds = areaBounds(range);
  if (!bounds) return null;
  const headers: Array<{ column: number; header: string }> = [];
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    const header = cells[cellName(bounds.top, column)] ?? "";
    if (header !== "") headers.push({ column, header });
  }
  if (headers.length === 0) return null;
  const rowField = headers[0].header;
  const numeric = headers.find((header) => {
    for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
      if (parseCellNumber(cells[cellName(row, header.column)]) !== null) return true;
    }
    return false;
  });
  if (numeric) return { rowField, columnField: "", valueField: numeric.header, summarizeBy: "SUM" };
  const counted = headers.find((header) => header.header !== rowField) ?? headers[0];
  return { rowField, columnField: "", valueField: counted.header, summarizeBy: "COUNT" };
}

/**
 * Test-double mirror of the backend range sort: reorders whole records by one
 * column (numbers and dates by value, otherwise text, stable ties). The
 * authoritative implementation also rewrites formula row references.
 */
function compareSortValues(left: string | undefined, right: string | undefined): number {
  const leftText = String(left ?? "");
  const rightText = String(right ?? "");
  const leftNumber = leftText.trim() === "" ? null : Number(leftText.trim());
  const rightNumber = rightText.trim() === "" ? null : Number(rightText.trim());
  if (leftNumber !== null && rightNumber !== null && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  const leftDate = leftText.trim() === "" ? null : Date.parse(leftText.trim());
  const rightDate = rightText.trim() === "" ? null : Date.parse(rightText.trim());
  if (leftDate !== null && rightDate !== null && !Number.isNaN(leftDate) && !Number.isNaN(rightDate)) {
    return leftDate - rightDate;
  }
  return leftText.trim().localeCompare(rightText.trim());
}

function sortCells(
  cells: Record<string, string>,
  bounds: Bounds,
  column: number,
  order: string,
  hasHeaderRow: boolean,
): Record<string, string> {
  const firstDataRow = hasHeaderRow ? bounds.top + 1 : bounds.top;
  if (firstDataRow > bounds.bottom) return { ...cells };
  const dataRows: number[] = [];
  for (let row = firstDataRow; row <= bounds.bottom; row += 1) dataRows.push(row);
  const decorated = dataRows.map((row, index) => ({ row, index }));
  const isBlank = (row: number) => String(cells[cellName(row, column)] ?? "").trim() === "";
  decorated.sort((a, b) => {
    const leftBlank = isBlank(a.row);
    const rightBlank = isBlank(b.row);
    if (leftBlank !== rightBlank) return leftBlank ? 1 : -1;
    const primary = compareSortValues(cells[cellName(a.row, column)], cells[cellName(b.row, column)]);
    if (primary !== 0) return order === "desc" ? -primary : primary;
    return a.index - b.index;
  });
  const next = { ...cells };
  decorated.forEach(({ row: sourceRow }, position) => {
    const targetRow = firstDataRow + position;
    for (let c = bounds.left; c <= bounds.right; c += 1) {
      const raw = cells[cellName(sourceRow, c)];
      const target = cellName(targetRow, c);
      if (raw === undefined) delete next[target];
      else next[target] = raw;
    }
  });
  return next;
}

/** Installs an in-memory fetch double implementing the workbook API contract. */
export function installFakeApi(initial: Workbook[] = seedWorkbooks()): FakeApi {
  const workbooks = structuredClone(initial);
  const failures = new Set<string>();
  let counter = 0;

  const handle = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url.pathname}`;
    if (failures.has(key)) {
      failures.delete(key);
      return jsonResponse(500, { error: "Server error" });
    }

    if (url.pathname === "/api/workbooks") {
      if (method === "GET") {
        const sorted = [...workbooks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return jsonResponse(200, { workbooks: sorted.map(summary) });
      }
      if (method === "POST") {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const now = new Date().toISOString();
        counter += 1;
        const workbook: Workbook = {
          id: `wb-new-${counter}`,
          name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Untitled workbook",
          createdAt: now,
          updatedAt: now,
          activeWorksheetId: `ws-new-${counter}`,
          worksheets: [{ id: `ws-new-${counter}`, name: "Sheet1", cells: {} }],
        };
        workbooks.push(workbook);
        return jsonResponse(201, { workbook });
      }
    }

    if (url.pathname === "/api/workbooks/import" && method === "POST") {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
      const rows: unknown = body.rows;
      if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row) || row.some((cell) => typeof cell !== "string"))) {
        return jsonResponse(400, { error: "Invalid CSV file format. Import failed." });
      }
      const cells: Record<string, string> = {};
      (rows as string[][]).forEach((row, rowIndex) => {
        row.forEach((value, columnIndex) => {
          cells[cellName(rowIndex + 1, columnIndex + 1)] = value;
        });
      });
      const now = new Date().toISOString();
      counter += 1;
      const workbook: Workbook = {
        id: `wb-import-${counter}`,
        name: fileName.replace(/\.csv$/i, "").trim() || "Untitled workbook",
        createdAt: now,
        updatedAt: now,
        activeWorksheetId: `ws-import-${counter}`,
        worksheets: [{ id: `ws-import-${counter}`, name: "Sheet1", cells }],
      };
      workbooks.push(workbook);
      return jsonResponse(201, { workbook });
    }

    const structureMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/structure$/.exec(url.pathname);
    if (structureMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(structureMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      if (method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(structureMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const axis: unknown = body.axis;
      const mode: unknown = body.mode;
      const index: unknown = body.index;
      if (axis !== "row" && axis !== "column") return jsonResponse(400, { error: "Invalid row or column change" });
      if (mode !== "insert-before" && mode !== "insert-after" && mode !== "delete") {
        return jsonResponse(400, { error: "Invalid row or column change" });
      }
      if (!Number.isInteger(index) || (index as number) < 1) {
        return jsonResponse(400, { error: "Invalid row or column change" });
      }
      worksheet.cells = shiftCells(worksheet.cells, axis, mode, index as number);
      // Pivot tables reading this worksheet move their source range with it.
      const at = mode === "insert-after" ? (index as number) + 1 : (index as number);
      for (const other of workbook.worksheets) {
        if (!other.pivot || other.pivot.sourceWorksheetId !== worksheet.id) continue;
        const moved = shiftArea(other.pivot.range, axis, mode as string, at);
        if (moved) other.pivot = { ...other.pivot, range: moved };
      }
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const sortMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/sort$/.exec(url.pathname);
    if (sortMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(sortMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      if (method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(sortMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const bounds = areaBounds(body.range);
      const column: unknown = body.column;
      if (
        !bounds ||
        !Number.isInteger(column) ||
        (column as number) < bounds.left ||
        (column as number) > bounds.right ||
        (body.order !== "asc" && body.order !== "desc") ||
        typeof body.hasHeaderRow !== "boolean"
      ) {
        return jsonResponse(400, { error: "Invalid sort request" });
      }
      worksheet.cells = sortCells(worksheet.cells, bounds, column as number, body.order, body.hasHeaderRow);
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const transferMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/range-transfer$/.exec(url.pathname);
    if (transferMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(transferMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      if (method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(transferMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const target = String(body.target ?? "").trim().toUpperCase();
      const origin = /^([A-Z]+)([1-9][0-9]*)$/.exec(target);
      const rows: unknown = body.rows;
      if (!origin || !Array.isArray(rows) || rows.some((row) => !Array.isArray(row) || row.some((cell) => typeof cell !== "string"))) {
        return jsonResponse(400, { error: "Invalid range transfer" });
      }
      const toColumn = (letters: string) => [...letters].reduce((value, letter) => value * 26 + (letter.charCodeAt(0) - 64), 0);
      const column = toColumn(origin[1]);
      const row = Number(origin[2]);
      const updates: Array<{ coordinate: string; value: string }> = [];
      (rows as string[][]).forEach((values, rowIndex) => {
        values.forEach((value, columnIndex) => {
          updates.push({ coordinate: cellName(row + rowIndex, column + columnIndex), value });
        });
      });
      const violation = validationMessage(worksheet, updates);
      if (violation) return jsonResponse(400, { error: violation });
      const sourceText = typeof body.source === "string" && body.source.trim() ? body.source.trim().toUpperCase() : null;
      let sourceBounds: { top: number; bottom: number; left: number; right: number } | null = null;
      if (sourceText) {
        const [start, end = start] = sourceText.split(":");
        const first = /^([A-Z]+)([1-9][0-9]*)$/.exec(start);
        const last = /^([A-Z]+)([1-9][0-9]*)$/.exec(end);
        if (!first || !last) return jsonResponse(400, { error: "Invalid range transfer" });
        sourceBounds = {
          top: Math.min(Number(first[2]), Number(last[2])),
          bottom: Math.max(Number(first[2]), Number(last[2])),
          left: Math.min(toColumn(first[1]), toColumn(last[1])),
          right: Math.max(toColumn(first[1]), toColumn(last[1])),
        };
      }
      const written = new Set(updates.map((update) => update.coordinate));
      for (const update of updates) {
        if (update.value === "") delete worksheet.cells[update.coordinate];
        else worksheet.cells[update.coordinate] = update.value;
      }
      if (sourceBounds) {
        for (let r = sourceBounds.top; r <= sourceBounds.bottom; r += 1) {
          for (let c = sourceBounds.left; c <= sourceBounds.right; c += 1) {
            const coordinate = cellName(r, c);
            if (!written.has(coordinate)) delete worksheet.cells[coordinate];
          }
        }
      }
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const stateMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/state$/.exec(url.pathname);
    if (stateMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(stateMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      if (method !== "PUT") return jsonResponse(405, { error: "Method not allowed" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(stateMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const cells: unknown = body.cells;
      if (cells === null || typeof cells !== "object" || Array.isArray(cells)) {
        return jsonResponse(400, { error: "Invalid worksheet state" });
      }
      const next: Record<string, string> = {};
      for (const [coordinate, value] of Object.entries(cells as Record<string, unknown>)) {
        if (typeof value !== "string" || value === "") continue;
        const parsed = parseCellName(coordinate);
        if (!parsed) continue;
        next[cellName(parsed.row, parsed.column)] = value;
      }
      worksheet.cells = next;
      if (Array.isArray(body.validationRules)) worksheet.validationRules = body.validationRules;
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const batchMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/cells\/batch$/.exec(url.pathname);
    if (batchMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(batchMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(batchMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      if (method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const start = String(body.start ?? "").trim().toUpperCase();
      const origin = /^([A-Z]+)([1-9][0-9]*)$/.exec(start);
      const rows: unknown = body.rows;
      if (!origin || !Array.isArray(rows) || rows.some((row) => !Array.isArray(row) || row.some((cell) => typeof cell !== "string"))) {
        return jsonResponse(400, { error: "Invalid cell range update" });
      }
      const toColumn = (letters: string) => [...letters].reduce((value, letter) => value * 26 + (letter.charCodeAt(0) - 64), 0);
      const column = toColumn(origin[1]);
      const row = Number(origin[2]);
      const updates: Array<{ coordinate: string; value: string }> = [];
      (rows as string[][]).forEach((values, rowIndex) => {
        values.forEach((value, columnIndex) => {
          updates.push({ coordinate: cellName(row + rowIndex, column + columnIndex), value });
        });
      });
      const batchViolation = validationMessage(worksheet, updates);
      if (batchViolation) return jsonResponse(400, { error: batchViolation });
      for (const update of updates) {
        if (update.value === "") delete worksheet.cells[update.coordinate];
        else worksheet.cells[update.coordinate] = update.value;
      }
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const ruleMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/validation-rule$/.exec(url.pathname);
    if (ruleMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(ruleMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(ruleMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (method === "PUT") {
        const range = normalizeArea(body.range);
        if (!range) return jsonResponse(400, { error: "Invalid validation rule" });
        let rule: { range: string; type: string; min?: number; max?: number; values?: string[] };
        if (body.type === "number-range") {
          const low = Number(body.min);
          const high = Number(body.max);
          if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) {
            return jsonResponse(400, { error: "Invalid validation rule" });
          }
          rule = { range, type: "number-range", min: low, max: high };
        } else if (body.type === "dropdown") {
          const values = Array.isArray(body.values)
            ? (body.values as unknown[]).map((value) => String(value).trim()).filter((value) => value !== "")
            : [];
          if (values.length === 0) return jsonResponse(400, { error: "Invalid validation rule" });
          rule = { range, type: "dropdown", values };
        } else {
          return jsonResponse(400, { error: "Invalid validation rule" });
        }
        const kept = (Array.isArray(worksheet.validationRules) ? worksheet.validationRules : []).filter(
          (existing) => normalizeArea(existing?.range) !== range,
        );
        worksheet.validationRules = [...kept, rule];
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook });
      }
      if (method === "DELETE") {
        const range = normalizeArea(body.range);
        if (!range) return jsonResponse(400, { error: "Invalid validation rule" });
        const kept = (Array.isArray(worksheet.validationRules) ? worksheet.validationRules : []).filter(
          (existing) => normalizeArea(existing?.range) !== range,
        );
        if (kept.length === 0) delete worksheet.validationRules;
        else worksheet.validationRules = kept;
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook });
      }
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const filterMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/filter$/.exec(url.pathname);
    if (filterMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(filterMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(filterMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      if (method === "PUT") {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const filter: unknown = body.filter;
        const range = normalizeArea((filter as { range?: unknown } | null)?.range);
        const columns = (filter as { columns?: unknown } | null)?.columns;
        if (!range || !Array.isArray(columns)) return jsonResponse(400, { error: "Invalid filter" });
        worksheet.filter = { range, columns };
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook });
      }
      if (method === "DELETE") {
        delete worksheet.filter;
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook });
      }
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const pivotRefreshMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/pivot\/refresh$/.exec(url.pathname);
    if (pivotRefreshMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(pivotRefreshMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      if (method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(pivotRefreshMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      if (!worksheet.pivot) return jsonResponse(400, { error: "Invalid pivot table configuration" });
      const source = workbook.worksheets.find((candidate) => candidate.id === worksheet.pivot!.sourceWorksheetId);
      if (!source) return jsonResponse(400, { error: "The pivot table source is no longer available" });
      const built = buildPivotCells(source.cells, worksheet.pivot.range, worksheet.pivot);
      if ("error" in built) return jsonResponse(400, { error: built.error });
      worksheet.cells = built.cells;
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const pivotMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/pivot$/.exec(url.pathname);
    if (pivotMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(pivotMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(pivotMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (method === "POST") {
        const bounds = areaBounds(body.range);
        if (!bounds) return jsonResponse(400, { error: "Invalid pivot table configuration" });
        const range = boundsText(bounds);
        const config = defaultPivotConfig(worksheet.cells, range);
        if (!config) return jsonResponse(400, { error: "Select a range with header cells to create a pivot table" });
        const built = buildPivotCells(worksheet.cells, range, config);
        if ("error" in built) return jsonResponse(400, { error: built.error });
        counter += 1;
        const created: Worksheet = {
          id: `ws-pivot-${counter}`,
          name: nextPivotName(workbook),
          selection: { anchor: "A1", focus: "A1" },
          cells: built.cells,
          pivot: { sourceWorksheetId: worksheet.id, range, ...config },
        };
        workbook.worksheets.push(created);
        workbook.activeWorksheetId = created.id;
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(201, { workbook });
      }
      if (method === "PUT") {
        if (!worksheet.pivot) return jsonResponse(400, { error: "Invalid pivot table configuration" });
        const summarizeBy = String(body.summarizeBy ?? "").toUpperCase() as SummarizeMethod;
        if (
          typeof body.rowField !== "string" ||
          body.rowField === "" ||
          typeof body.valueField !== "string" ||
          body.valueField === "" ||
          !["SUM", "COUNT", "AVERAGE"].includes(summarizeBy)
        ) {
          return jsonResponse(400, { error: "Invalid pivot table configuration" });
        }
        const columnField = body.columnField === undefined || body.columnField === null ? "" : body.columnField;
        if (typeof columnField !== "string") return jsonResponse(400, { error: "Invalid pivot table configuration" });
        const config = {
          rowField: body.rowField as string,
          columnField,
          valueField: body.valueField as string,
          summarizeBy,
        };
        const source = workbook.worksheets.find((candidate) => candidate.id === worksheet.pivot!.sourceWorksheetId);
        if (!source) return jsonResponse(400, { error: "The pivot table source is no longer available" });
        const built = buildPivotCells(source.cells, worksheet.pivot.range, config);
        if ("error" in built) return jsonResponse(400, { error: built.error });
        worksheet.cells = built.cells;
        worksheet.pivot = { ...worksheet.pivot, ...config };
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook });
      }
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const selectionMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/selection$/.exec(url.pathname);
    if (selectionMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(selectionMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(selectionMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      if (method !== "PATCH") return jsonResponse(405, { error: "Method not allowed" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const anchor = String(body.anchor ?? "").trim().toUpperCase();
      const focus = String(body.focus ?? "").trim().toUpperCase();
      if (!/^[A-Z]+[1-9][0-9]*$/.test(anchor) || !/^[A-Z]+[1-9][0-9]*$/.test(focus)) {
        return jsonResponse(400, { error: "Unknown cell reference" });
      }
      worksheet.selection = { anchor, focus };
      return jsonResponse(200, { workbook });
    }

    const cellMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/cells$/.exec(url.pathname);
    if (cellMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(cellMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const worksheet = workbook.worksheets.find((candidate) => candidate.id === decodeURIComponent(cellMatch[2]));
      if (!worksheet) return jsonResponse(400, { error: "Unknown worksheet" });
      if (method !== "PATCH") return jsonResponse(405, { error: "Method not allowed" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const coordinate = String(body.coordinate ?? "").trim().toUpperCase();
      if (!/^[A-Z]+[1-9][0-9]*$/.test(coordinate)) return jsonResponse(400, { error: "Unknown cell reference" });
      if (typeof body.value !== "string") return jsonResponse(400, { error: "Cell value must be a string" });
      const cellViolation = validationMessage(worksheet, [{ coordinate, value: body.value }]);
      if (cellViolation) return jsonResponse(400, { error: cellViolation });
      if (body.value === "") {
        delete worksheet.cells[coordinate];
      } else {
        worksheet.cells[coordinate] = body.value;
      }
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const worksheetMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)$/.exec(url.pathname);
    if (worksheetMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(worksheetMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      const index = workbook.worksheets.findIndex(
        (candidate) => candidate.id === decodeURIComponent(worksheetMatch[2]),
      );
      if (index === -1) return jsonResponse(400, { error: "Unknown worksheet" });
      const worksheet = workbook.worksheets[index];
      if (method === "DELETE") {
        if (workbook.worksheets.length <= 1) {
          return jsonResponse(400, { error: "A workbook must contain at least one worksheet" });
        }
        if (
          workbook.worksheets.some(
            (candidate) => candidate.id !== worksheet.id && candidate.pivot?.sourceWorksheetId === worksheet.id,
          )
        ) {
          return jsonResponse(400, { error: "Please delete or rebuild dependent pivot tables first" });
        }
        workbook.worksheets.splice(index, 1);
        if (workbook.activeWorksheetId === worksheet.id) {
          const neighbour = workbook.worksheets[Math.max(0, index - 1)] ?? workbook.worksheets[0];
          workbook.activeWorksheetId = neighbour.id;
        }
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook });
      }
      if (method !== "PATCH") return jsonResponse(405, { error: "Method not allowed" });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return jsonResponse(400, { error: "Worksheet name cannot be empty" });
      if (workbook.worksheets.some((candidate) => candidate.id !== worksheet.id && candidate.name === name)) {
        return jsonResponse(400, { error: "Worksheet name already exists" });
      }
      worksheet.name = name;
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook });
    }

    const worksheetsMatch = /^\/api\/workbooks\/([^/]+)\/worksheets$/.exec(url.pathname);
    if (worksheetsMatch) {
      const workbook = workbooks.find((candidate) => candidate.id === decodeURIComponent(worksheetsMatch[1]));
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      if (method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
      counter += 1;
      const worksheet = { id: `ws-added-${counter}`, name: nextSheetName(workbook), cells: {} };
      workbook.worksheets.push(worksheet);
      workbook.activeWorksheetId = worksheet.id;
      workbook.updatedAt = new Date().toISOString();
      return jsonResponse(201, { workbook });
    }

    const match = /^\/api\/workbooks\/([^/]+)$/.exec(url.pathname);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const workbook = workbooks.find((candidate) => candidate.id === id);
      if (!workbook) return jsonResponse(404, { error: "Workbook not found" });
      if (method === "GET") return jsonResponse(200, { workbook });
      if (method === "PATCH") {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (body.name !== undefined) {
          const name = String(body.name).trim();
          if (!name) return jsonResponse(400, { error: "Workbook name cannot be empty" });
          workbook.name = name;
        }
        if (body.activeWorksheetId !== undefined) {
          const target = workbook.worksheets.find((worksheet) => worksheet.id === body.activeWorksheetId);
          if (!target) return jsonResponse(400, { error: "Unknown worksheet" });
          workbook.activeWorksheetId = target.id;
        }
        workbook.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook });
      }
    }

    return jsonResponse(404, { error: "Not found" });
  };

  vi.stubGlobal("fetch", vi.fn(handle));

  return {
    get workbooks() {
      return workbooks;
    },
    failOnce(method, pathname) {
      failures.add(`${method.toUpperCase()} ${pathname}`);
    },
    restore() {
      vi.unstubAllGlobals();
    },
  };
}
