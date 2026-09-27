import type { Sheet, Workbook, WorkbookSummary } from "../types";
import { parseCsv } from "../csv";
import { cellCoordinate, columnNumber } from "../coords";
import { parsePasteText } from "../paste";
import { normalizeRect, applyRangeTransfer, type TransferOperation } from "../transfer";
import { ROW_ACTIONS, shiftCells, shiftCoordinateRow, type RowAction } from "../structure";
import {
  COLUMN_ACTIONS,
  shiftCellsColumn,
  shiftCoordinateColumn,
  type ColumnAction,
} from "../structure";

interface FakeResponse<T> {
  ok: boolean;
  status: number;
  json: () => Promise<T>;
}

function jsonResponse<T>(status: number, body: T): FakeResponse<T> {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function seedWorkbooks(): Workbook[] {
  const now = new Date().toISOString();
  return [
    {
      id: "wb-q3-sales",
      name: "Q3 Sales",
      createdAt: now,
      updatedAt: now,
      activeSheetId: "sheet-1",
      sheets: [
        {
          id: "sheet-1",
          name: "Sheet1",
          activeCell: "A1",
          selection: { current: "A1", end: "A1" },
          cells: { A1: "Item", B1: "Qty", A2: "Pen", B2: "4" },
        },
        {
          id: "sheet-2",
          name: "Sheet2",
          activeCell: "A1",
          selection: { current: "A1", end: "A1" },
          cells: {},
        },
      ],
    },
  ];
}

function firstUnusedSheetName(sheets: Sheet[]): string {
  const used = new Set(sheets.map((s) => String(s.name ?? "").toLowerCase()));
  let n = 1;
  while (used.has(`sheet${n}`)) n += 1;
  return `Sheet${n}`;
}

export interface ApiMock {
  reset: () => void;
  workbooks: () => Workbook[];
  addWorkbook: (wb: Workbook) => void;
  /** When set, the next add-sheet request fails with this message. */
  failNextAddSheet: string | null;
  /** When set, the next row-operation request fails with this message. */
  failNextRowOp: string | null;
  /** When set, the next column-operation request fails with this message. */
  failNextColOp: string | null;
  /** When set, the next cell-value commit fails with this message. */
  failNextCellOp: string | null;
  /** When set, the next paste request fails with this message. */
  failNextPasteOp: string | null;
  /** When set, the next range-transfer request fails with this message. */
  failNextTransferOp: string | null;
}

/** Stub for the backend REST API used by the frontend tests. */
export function installApiMock(): ApiMock {
  let workbooks = seedWorkbooks();

  const mock: ApiMock = {
    reset: () => {
      workbooks = seedWorkbooks();
      mock.failNextAddSheet = null;
      mock.failNextRowOp = null;
      mock.failNextColOp = null;
      mock.failNextCellOp = null;
      mock.failNextPasteOp = null;
      mock.failNextTransferOp = null;
    },
    workbooks: () => workbooks,
    addWorkbook: (wb) => {
      workbooks.push(wb);
    },
    failNextAddSheet: null,
    failNextRowOp: null,
    failNextColOp: null,
    failNextCellOp: null,
    failNextPasteOp: null,
    failNextTransferOp: null,
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const jsonBody = init?.body ? JSON.parse(String(init.body)) : undefined;

    if (path === "/api/import-csv" && method === "POST") {
      const { fileName, csv } = (jsonBody ?? {}) as { fileName?: string; csv?: string };
      const parsed = parseCsv(typeof csv === "string" ? csv : "");
      if ("error" in parsed) {
        return jsonResponse(400, { error: { code: "INVALID_CSV", message: parsed.error } });
      }
      const now = new Date().toISOString();
      const sheetId = `sheet-import-${now}`;
      const rows = parsed.rows;
      const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
      const cells: Record<string, string> = {};
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          if (value !== "") cells[cellCoordinate(c, r)] = value;
        });
      });
      const wb: Workbook = {
        id: `wb-import-${now}-${Math.random().toString(36).slice(2, 8)}`,
        name: String(fileName ?? "").trim().replace(/\.csv$/i, "") || "Imported workbook",
        createdAt: now,
        updatedAt: now,
        activeSheetId: sheetId,
        sheets: [
          {
            id: sheetId,
            name: "Sheet1",
            activeCell: "A1",
            selection: { current: "A1", end: "A1" },
            rowCount: rows.length,
            columnCount,
            cells,
          },
        ],
      };
      workbooks.push(wb);
      return jsonResponse(201, { workbook: { ...wb } });
    }

    if (path === "/api/workbooks" && method === "GET") {
      const summaries: WorkbookSummary[] = workbooks
        .slice()
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
        .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
      return jsonResponse(200, { workbooks: summaries });
    }

    if (path === "/api/workbooks" && method === "POST") {
      const now = new Date().toISOString();
      const sheetId = `sheet-new-${now}`;
      const wb: Workbook = {
        id: `wb-new-${now}-${Math.random().toString(36).slice(2, 8)}`,
        name: (jsonBody?.name || "").trim() || "Untitled workbook",
        createdAt: now,
        updatedAt: now,
        activeSheetId: sheetId,
        sheets: [{ id: sheetId, name: "Sheet1", activeCell: "A1", selection: { current: "A1", end: "A1" }, cells: {} }],
      };
      workbooks.push(wb);
      return jsonResponse(201, { workbook: wb });
    }

    const match = path.match(/^\/api\/workbooks\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const wb = workbooks.find((w) => w.id === id);
      if (!wb) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Workbook not found" } });
      }
      if (method === "GET") {
        return jsonResponse(200, { workbook: { ...wb } });
      }
      if (method === "PATCH") {
        const trimmed = String(jsonBody?.name ?? "").trim();
        if (!trimmed) {
          return jsonResponse(400, {
            error: { code: "EMPTY_NAME", message: "Workbook name cannot be empty" },
          });
        }
        wb.name = trimmed;
        wb.updatedAt = new Date().toISOString();
        return jsonResponse(200, { workbook: { ...wb } });
      }
    }

    const sheetsMatch = path.match(/^\/api\/workbooks\/([^/]+)\/sheets$/);
    if (sheetsMatch && method === "POST") {
      const id = decodeURIComponent(sheetsMatch[1]);
      const wb = workbooks.find((w) => w.id === id);
      if (!wb) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Workbook not found" } });
      }
      if (mock.failNextAddSheet) {
        const message = mock.failNextAddSheet;
        mock.failNextAddSheet = null;
        return jsonResponse(500, { error: { code: "ADD_FAILED", message } });
      }
      const sheetId = `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      wb.sheets.push({
        id: sheetId,
        name: firstUnusedSheetName(wb.sheets),
        activeCell: "A1",
        selection: { current: "A1", end: "A1" },
        cells: {},
      });
      wb.activeSheetId = sheetId;
      wb.updatedAt = new Date().toISOString();
      return jsonResponse(201, { workbook: { ...wb } });
    }

    const rowsMatch = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/rows$/);
    if (rowsMatch && method === "POST") {
      const wb = workbooks.find((w) => w.id === decodeURIComponent(rowsMatch[1]));
      if (!wb) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Workbook not found" } });
      }
      const sheet = wb.sheets.find((s) => s.id === decodeURIComponent(rowsMatch[2]));
      if (!sheet) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Worksheet not found" } });
      }
      const { action, row } = (jsonBody ?? {}) as { action?: string; row?: unknown };
      if (
        !ROW_ACTIONS.includes(action as RowAction) ||
        !Number.isInteger(Number(row)) ||
        Number(row) < 1
      ) {
        return jsonResponse(400, {
          error: { code: "INVALID_ROW", message: "Invalid row operation" },
        });
      }
      if (mock.failNextRowOp) {
        const message = mock.failNextRowOp;
        mock.failNextRowOp = null;
        return jsonResponse(500, { error: { code: "ROW_OP_FAILED", message } });
      }
      const actionValue = action as RowAction;
      const rowValue = Number(row);
      const shifted = shiftCells(sheet.cells, actionValue, rowValue);
      sheet.cells = shifted.cells;
      sheet.activeCell = shiftCoordinateRow(sheet.activeCell, actionValue, rowValue);
      if (sheet.selection) {
        sheet.selection = {
          current: shiftCoordinateRow(sheet.selection.current, actionValue, rowValue),
          end: shiftCoordinateRow(sheet.selection.end, actionValue, rowValue),
        };
      }
      sheet.rowCount = Math.max(sheet.rowCount ?? 0, shifted.maxRow);
      wb.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook: { ...wb } });
    }

    const columnsMatch = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/columns$/);    if (columnsMatch && method === "POST") {
      const wb = workbooks.find((w) => w.id === decodeURIComponent(columnsMatch[1]));
      if (!wb) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Workbook not found" } });
      }
      const sheet = wb.sheets.find((s) => s.id === decodeURIComponent(columnsMatch[2]));
      if (!sheet) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Worksheet not found" } });
      }
      const { action, column } = (jsonBody ?? {}) as { action?: string; column?: unknown };
      if (
        !COLUMN_ACTIONS.includes(action as ColumnAction) ||
        !Number.isInteger(Number(column)) ||
        Number(column) < 1
      ) {
        return jsonResponse(400, {
          error: { code: "INVALID_COLUMN", message: "Invalid column operation" },
        });
      }
      if (mock.failNextColOp) {
        const message = mock.failNextColOp;
        mock.failNextColOp = null;
        return jsonResponse(500, { error: { code: "COLUMN_OP_FAILED", message } });
      }
      const actionValue = action as ColumnAction;
      const columnValue = Number(column);
      const shifted = shiftCellsColumn(sheet.cells, actionValue, columnValue);
      sheet.cells = shifted.cells;
      sheet.activeCell = shiftCoordinateColumn(sheet.activeCell, actionValue, columnValue);
      if (sheet.selection) {
        sheet.selection = {
          current: shiftCoordinateColumn(sheet.selection.current, actionValue, columnValue),
          end: shiftCoordinateColumn(sheet.selection.end, actionValue, columnValue),
        };
      }
      sheet.columnCount = Math.max(sheet.columnCount ?? 0, shifted.maxCol);
      wb.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook: { ...wb } });
    }

    const pasteMatch = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/paste$/);
    if (pasteMatch && method === "POST") {
      const wb = workbooks.find((w) => w.id === decodeURIComponent(pasteMatch[1]));
      if (!wb) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Workbook not found" } });
      }
      const sheet = wb.sheets.find((s) => s.id === decodeURIComponent(pasteMatch[2]));
      if (!sheet) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Worksheet not found" } });
      }
      const { start, text } = (jsonBody ?? {}) as { start?: unknown; text?: unknown };
      const normalizedStart = String(start ?? "").toUpperCase();
      if (!/^[A-Z]+\d+$/.test(normalizedStart) || Number(normalizedStart.match(/\d+$/)?.[0]) < 1) {
        return jsonResponse(400, {
          error: { code: "INVALID_COORD", message: "Invalid cell coordinate" },
        });
      }
      if (typeof text !== "string") {
        return jsonResponse(400, {
          error: { code: "INVALID_VALUE", message: "Invalid paste content" },
        });
      }
      if (mock.failNextPasteOp) {
        const message = mock.failNextPasteOp;
        mock.failNextPasteOp = null;
        return jsonResponse(500, { error: { code: "PASTE_FAILED", message } });
      }
      const rows = parsePasteText(text);
      const startMatch = normalizedStart.match(/^([A-Z]+)(\d+)$/);
      const startCol = columnNumber(startMatch![1]);
      const startRow = Number(startMatch![2]);
      const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
      const next: Record<string, string> = { ...sheet.cells };
      rows.forEach((row, r) => {
        for (let c = 0; c < width; c += 1) {
          const value = row[c] ?? "";
          const coord = cellCoordinate(startCol - 1 + c, startRow - 1 + r);
          if (value === "") delete next[coord];
          else next[coord] = value;
        }
      });
      const endCoord = cellCoordinate(startCol - 1 + width - 1, startRow - 1 + rows.length - 1);
      sheet.cells = next;
      sheet.activeCell = normalizedStart;
      sheet.selection = { current: normalizedStart, end: endCoord };
      wb.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook: { ...wb } });
    }

    const transferMatch = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/transfer$/);
    if (transferMatch && method === "POST") {
      const wb = workbooks.find((w) => w.id === decodeURIComponent(transferMatch[1]));
      if (!wb) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Workbook not found" } });
      }
      const sheet = wb.sheets.find((s) => s.id === decodeURIComponent(transferMatch[2]));
      if (!sheet) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Worksheet not found" } });
      }
      const { operation, source, target } = (jsonBody ?? {}) as {
        operation?: unknown;
        source?: { current?: unknown; end?: unknown };
        target?: unknown;
      };
      if (operation !== "copy" && operation !== "cut") {
        return jsonResponse(400, {
          error: { code: "INVALID_OPERATION", message: "Invalid transfer operation" },
        });
      }
      const sourceRect = normalizeRect(
        String(source?.current ?? ""),
        String(source?.end ?? ""),
      );
      if (!sourceRect) {
        return jsonResponse(400, {
          error: { code: "INVALID_COORD", message: "Invalid source range" },
        });
      }
      const targetMatch = /^([A-Z]+)(\d+)$/.exec(String(target ?? "").toUpperCase());
      if (!targetMatch || Number(targetMatch[2]) < 1) {
        return jsonResponse(400, {
          error: { code: "INVALID_COORD", message: "Invalid target cell" },
        });
      }
      if (mock.failNextTransferOp) {
        const message = mock.failNextTransferOp;
        mock.failNextTransferOp = null;
        return jsonResponse(500, { error: { code: "TRANSFER_FAILED", message } });
      }
      const targetTopLeft = {
        col: columnNumber(targetMatch[1]),
        row: Number(targetMatch[2]),
      };
      const targetStart = `${targetMatch[1]}${targetMatch[2]}`;
      const applied = applyRangeTransfer(
        sheet.cells,
        operation as TransferOperation,
        sourceRect,
        targetTopLeft,
      );
      sheet.cells = applied.cells;
      sheet.activeCell = targetStart;
      sheet.selection = { current: targetStart, end: applied.end };
      wb.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook: { ...wb } });
    }

    const cellMatch = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/cells\/([^/]+)$/);
    if (cellMatch && method === "PATCH") {
      const wb = workbooks.find((w) => w.id === decodeURIComponent(cellMatch[1]));
      if (!wb) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Workbook not found" } });
      }
      const sheet = wb.sheets.find((s) => s.id === decodeURIComponent(cellMatch[2]));
      if (!sheet) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Worksheet not found" } });
      }
      const coord = String(decodeURIComponent(cellMatch[3]) ?? "").toUpperCase();
      if (!/^[A-Z]+\d+$/.test(coord)) {
        return jsonResponse(400, { error: { code: "INVALID_COORD", message: "Invalid cell coordinate" } });
      }
      const { value } = (jsonBody ?? {}) as { value?: unknown };
      if (typeof value !== "string") {
        return jsonResponse(400, { error: { code: "INVALID_VALUE", message: "Invalid cell value" } });
      }
      if (mock.failNextCellOp) {
        const message = mock.failNextCellOp;
        mock.failNextCellOp = null;
        return jsonResponse(500, { error: { code: "CELL_OP_FAILED", message } });
      }
      if (value === "") {
        const next = { ...sheet.cells };
        delete next[coord];
        sheet.cells = next;
      } else {
        sheet.cells = { ...sheet.cells, [coord]: value };
      }
      sheet.activeCell = coord;
      sheet.selection = { current: coord, end: coord };
      wb.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook: { ...wb } });
    }

    const selectionMatch = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/selection$/);
    if (selectionMatch && method === "PATCH") {
      const wb = workbooks.find((w) => w.id === decodeURIComponent(selectionMatch[1]));
      if (!wb) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Workbook not found" } });
      }
      const sheet = wb.sheets.find((s) => s.id === decodeURIComponent(selectionMatch[2]));
      if (!sheet) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Worksheet not found" } });
      }
      const current = String((jsonBody as { current?: unknown })?.current ?? "").toUpperCase();
      const end = String((jsonBody as { end?: unknown })?.end ?? "").toUpperCase();
      if (!/^[A-Z]+\d+$/.test(current) || !/^[A-Z]+\d+$/.test(end)) {
        return jsonResponse(400, { error: { code: "INVALID_COORD", message: "Invalid cell coordinate" } });
      }
      sheet.selection = { current, end };
      sheet.activeCell = current;
      return jsonResponse(200, { workbook: { ...wb } });
    }

    const sheetMatch = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)$/);
    if (sheetMatch && method === "PATCH") {
      const wb = workbooks.find((w) => w.id === decodeURIComponent(sheetMatch[1]));
      if (!wb) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Workbook not found" } });
      }
      const sheet = wb.sheets.find((s) => s.id === decodeURIComponent(sheetMatch[2]));
      if (!sheet) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Worksheet not found" } });
      }
      const trimmed = String(jsonBody?.name ?? "").trim();
      if (!trimmed) {
        return jsonResponse(400, {
          error: { code: "EMPTY_NAME", message: "Worksheet name cannot be empty" },
        });
      }
      const duplicate = wb.sheets.some(
        (s) => s.id !== sheet.id && s.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (duplicate) {
        return jsonResponse(400, {
          error: { code: "DUPLICATE_SHEET_NAME", message: "Worksheet name already exists" },
        });
      }
      sheet.name = trimmed;
      wb.updatedAt = new Date().toISOString();
      return jsonResponse(200, { workbook: { ...wb } });
    }

    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  }) as typeof fetch;

  return mock;
}
