import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

interface Sheet {
  id: string;
  name: string;
  cells: Record<string, string>;
  selectedCell: string;
  selectedRange?: { start: string; end: string };
  /** Pivot configuration (REQ-5-3-1); present on pivot-result worksheets. */
  pivot?: { sourceSheetId: string } | null;
}

interface Workbook {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeSheetId: string;
  sheets: Sheet[];
  undoAvailable?: boolean;
  redoAvailable?: boolean;
  clipboard?: { sheetId: string; kind: "copy" | "cut"; range: { start: string; end: string } } | null;
}

let sequence = 0;

function makeWorkbook(name: string, cells: Record<string, string> = {}): Workbook {
  const now = new Date(2026, 8, 27, 10, 30, 0).toISOString();
  sequence += 1;
  return {
    id: `wb_${sequence}`,
    name,
    createdAt: now,
    updatedAt: now,
    activeSheetId: "s1",
    sheets: [
      {
        id: "s1",
        name: "Sheet1",
        cells,
        selectedCell: "A1",
        selectedRange: { start: "A1", end: "A1" },
      },
    ],
  };
}

/** Attach derived formula results and normalized selection like the backend. */
function serializeWorkbook(
  workbook: Workbook,
  extra?: {
    undoAvailable?: boolean;
    redoAvailable?: boolean;
    clipboard?: { sheetId: string; kind: "copy" | "cut"; range: { start: string; end: string } } | null;
  },
): Workbook {
  const clone = cloneWorkbook(workbook);
  clone.sheets = clone.sheets.map((sheet) => {
    const selectedCell = sheet.selectedCell ?? "A1";
    return {
      ...sheet,
      selectedRange: sheet.selectedRange ?? { start: selectedCell, end: selectedCell },
      results: fakeResults(sheet.cells),
    };
  });
  if (extra) {
    clone.undoAvailable = extra.undoAvailable ?? false;
    clone.redoAvailable = extra.redoAvailable ?? false;
    clone.clipboard = extra.clipboard ?? null;
  }
  return clone;
}

/**
 * Minimal formula evaluator mirroring the backend engine for the formulas
 * used by these tests (arithmetic, A1 refs, SUM/AVERAGE/COUNT/MIN/MAX over
 * ranges). Expected values are asserted against the real engine.
 */
function fakeResults(cells: Record<string, string>): Record<string, string> {
  const results: Record<string, string> = {};
  const memo = new Map<string, number | string>();

  const coordOf = (token: string): { row: number; col: number } | null => {
    const match = /^\$?([A-Za-z]+)\$?([1-9]\d*)$/.exec(token);
    if (!match) return null;
    let col = 0;
    for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    return { row: Number(match[2]), col: col - 1 };
  };
  const nameOf = (row: number, col: number): string => {
    let n = col + 1;
    let letters = "";
    while (n > 0) {
      const remainder = (n - 1) % 26;
      letters = String.fromCharCode(65 + remainder) + letters;
      n = Math.floor((n - 1) / 26);
    }
    return `${letters}${row}`;
  };
  const numberAt = (coord: string): number | null => {
    const raw = cells[coord];
    if (raw === undefined || raw === "") return null;
    if (raw.startsWith("=")) {
      const value = memo.get(coord);
      return typeof value === "number" ? value : null;
    }
    const number = Number(raw.trim());
    return Number.isFinite(number) && raw.trim() !== "" ? number : null;
  };
  const numbersIn = (start: string, end: string): number[] => {
    const from = coordOf(start);
    const to = coordOf(end);
    if (!from || !to) return [];
    const values: number[] = [];
    for (let row = Math.min(from.row, to.row); row <= Math.max(from.row, to.row); row += 1) {
      for (let col = Math.min(from.col, to.col); col <= Math.max(from.col, to.col); col += 1) {
        const value = numberAt(nameOf(row, col));
        if (value !== null) values.push(value);
      }
    }
    return values;
  };

  const evaluate = (text: string, coord: string, depth: number): number | string => {
    if (!text.startsWith("=")) return "#ERROR!";
    if (depth > 20) return "#REF!";
    const body = text.slice(1).trim();
    const tokens = body.match(/\$?[A-Za-z]+\$?\d+|\d+(?:\.\d+)?|[A-Za-z]+|[-+*/(),:]|#[A-Z0-9/?!]+/g) ?? [];
    let index = 0;
    const peek = () => tokens[index];
    const take = () => tokens[index++];
    const expect = (token: string) => {
      const got = take();
      if (got !== token) throw new Error("parse");
    };
    const factor = (): number | string => {
      const token = peek();
      if (token === "-") {
        take();
        const value = factor();
        return typeof value === "string" ? value : -value;
      }
      if (token === "(") {
        take();
        const value = expression();
        expect(")");
        return value;
      }
      if (token === undefined) throw new Error("parse");
      if (/^#/.test(token)) {
        // literal error tokens (#REF! from an out-of-bounds copy) propagate
        take();
        return token;
      }
      if (/^\d/.test(token)) {
        take();
        return Number(token);
      }
      if (/^\$?[A-Za-z]+\$?\d+$/.test(token)) {
        take();
        const coord = token.replace(/\$/g, "").toUpperCase();
        const raw = cells[coord];
        if (raw !== undefined && raw !== "") {
          if (raw.startsWith("=")) {
            // mirror the backend formula engine: a referenced error cell
            // propagates its error token instead of resolving to zero
            const known = memo.get(coord);
            if (typeof known === "string") return known;
          } else if (raw.trim() !== "" && !Number.isFinite(Number(raw.trim()))) {
            return "#ERROR!"; // non-numeric text operand
          }
        }
        const number = numberAt(coord);
        return number ?? 0;
      }
      if (/^[A-Za-z]+$/.test(token)) {
        const name = take().toUpperCase();
        expect("(");
        const args: number[] = [];
        if (peek() !== ")") {
          for (;;) {
            const next = peek();
            if (next !== undefined && /^\$?[A-Za-z]+\$?\d+$/.test(next) && tokens[index + 1] === ":") {
              const start = take();
              expect(":");
              const end = take();
              args.push(...numbersIn(start.replace(/\$/g, "").toUpperCase(), end.replace(/\$/g, "").toUpperCase()));
            } else {
              const value = expression();
              if (typeof value === "number") args.push(value);
            }
            if (peek() === ",") {
              take();
              continue;
            }
            break;
          }
        }
        expect(")");
        if (name === "SUM") return args.reduce((sum, value) => sum + value, 0);
        if (name === "COUNT") return args.length;
        if (name === "MIN") return args.length === 0 ? 0 : Math.min(...args);
        if (name === "MAX") return args.length === 0 ? 0 : Math.max(...args);
        if (name === "AVERAGE") {
          return args.length === 0 ? "#DIV/0!" : args.reduce((sum, value) => sum + value, 0) / args.length;
        }
        return "#NAME?";
      }
      throw new Error("parse");
    };
    const term = (): number | string => {
      let value = factor();
      for (;;) {
        const token = peek();
        if (token === "*" || token === "/") {
          take();
          const right = factor();
          if (typeof value === "string") continue;
          if (typeof right === "string") {
            value = right;
            continue;
          }
          if (token === "*") value *= right;
          else value = right === 0 ? "#DIV/0!" : value / right;
          continue;
        }
        break;
      }
      return value;
    };
    const expression = (): number | string => {
      let value = term();
      for (;;) {
        const token = peek();
        if (token === "+" || token === "-") {
          take();
          const right = term();
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
    };
    try {
      return expression();
    } catch {
      return "#ERROR!";
    }
  };

  for (const [coord, text] of Object.entries(cells)) {
    if (!text.startsWith("=")) continue;
    const outcome = evaluate(text, coord, 0);
    memo.set(coord, outcome);
    results[coord] =
      typeof outcome === "number"
        ? Number.isInteger(outcome)
          ? String(outcome)
          : String(Number(outcome.toPrecision(12)))
        : outcome;
  }
  return results;
}

function cloneWorkbook(workbook: Workbook): Workbook {
  return JSON.parse(JSON.stringify(workbook));
}

function csvResponse(content: string) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? "text/csv; charset=utf-8" : null,
    },
    text: async () => content,
    json: async () => ({}),
  };
}

/** Minimal mirror of the backend CSV serialization for the test sheets. */
function fakeCsv(sheet: Sheet): string {
  let maxRow = 1;
  let maxCol = 0;
  for (const coord of Object.keys(sheet.cells)) {
    const match = /^([A-Z]+)(\d+)$/.exec(coord);
    if (!match) continue;
    let col = 0;
    for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    maxRow = Math.max(maxRow, Number(match[2]));
    maxCol = Math.max(maxCol, col - 1);
  }
  const rows: string[][] = [];
  for (let row = 1; row <= maxRow; row += 1) {
    const fields: string[] = [];
    for (let col = 0; col <= maxCol; col += 1) {
      const coord = `${String.fromCharCode(65 + col)}${row}`;
      const value = sheet.cells[coord] ?? "";
      fields.push(/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    }
    rows.push(fields);
  }
  return `${rows.map((row) => row.join(",")).join("\r\n")}\r\n`;
}

function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

interface FakeBackend {
  store: Workbook[];
  fetchMock: ReturnType<typeof vi.fn>;
}

interface FakeBackendOptions {
  /** Make every column structure operation fail with a 500. */
  failColumns?: boolean;
  /** Make every cell update (single and paste) fail with a 500. */
  failCells?: boolean;
}

function columnNameForTest(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function parseColumn(letters: string): number {
  let col = 0;
  for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64);
  return col - 1;
}

function shiftInsertRow(cells: Record<string, string>, targetRow: number): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [coord, value] of Object.entries(cells)) {
    const match = /^([A-Z]+)(\d+)$/.exec(coord);
    if (!match) {
      next[coord] = value;
      continue;
    }
    const row = Number(match[2]);
    next[row >= targetRow ? `${match[1]}${row + 1}` : coord] = value;
  }
  return next;
}

function shiftDeleteRow(cells: Record<string, string>, row: number): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [coord, value] of Object.entries(cells)) {
    const match = /^([A-Z]+)(\d+)$/.exec(coord);
    if (!match) {
      next[coord] = value;
      continue;
    }
    const current = Number(match[2]);
    if (current === row) continue;
    next[current > row ? `${match[1]}${current - 1}` : coord] = value;
  }
  return next;
}

function shiftInsertColumn(
  cells: Record<string, string>,
  targetCol: number,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [coord, value] of Object.entries(cells)) {
    const match = /^([A-Z]+)(\d+)$/.exec(coord);
    if (!match) {
      next[coord] = value;
      continue;
    }
    const col = parseColumn(match[1]);
    next[col >= targetCol ? `${columnNameForTest(col + 1)}${match[2]}` : coord] = value;
  }
  return next;
}

function shiftDeleteColumn(cells: Record<string, string>, col: number): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [coord, value] of Object.entries(cells)) {
    const match = /^([A-Z]+)(\d+)$/.exec(coord);
    if (!match) {
      next[coord] = value;
      continue;
    }
    const current = parseColumn(match[1]);
    if (current === col) continue;
    next[current > col ? `${columnNameForTest(current - 1)}${match[2]}` : coord] = value;
  }
  return next;
}

function nextSheetName(sheets: Sheet[]): string {
  for (let n = 1; ; n += 1) {
    const name = `Sheet${n}`;
    if (!sheets.some((sheet) => sheet.name === name)) return name;
  }
}

function installFakeBackend(initial: Workbook[], options: FakeBackendOptions = {}): FakeBackend {
  const store: Workbook[] = initial.map(cloneWorkbook);

  // Session-only per-workbook clipboard and undo/redo history mirrors.
  const clipboards = new Map<
    string,
    {
      sheetId: string;
      kind: "copy" | "cut";
      range: { start: string; end: string };
      content: Record<string, string>;
    }
  >();
  const histories = new Map<string, { undo: Workbook[]; redo: Workbook[] }>();

  function historyOf(id: string) {
    let history = histories.get(id);
    if (!history) {
      history = { undo: [], redo: [] };
      histories.set(id, history);
    }
    return history;
  }

  function pushHistory(workbook: Workbook) {
    const history = historyOf(workbook.id);
    history.undo.push(cloneWorkbook(workbook));
    history.redo = [];
  }

  function respond(workbook: Workbook, status = 200) {
    const history = histories.get(workbook.id);
    const clipboard = clipboards.get(workbook.id);
    return jsonResponse(
      status,
      serializeWorkbook(workbook, {
        undoAvailable: Boolean(history && history.undo.length > 0),
        redoAvailable: Boolean(history && history.redo.length > 0),
        clipboard: clipboard
          ? { sheetId: clipboard.sheetId, kind: clipboard.kind, range: { ...clipboard.range } }
          : null,
      }),
    );
  }

  function pasteCoord(coord: string, rowOffset: number, colOffset: number): string {
    const match = /^([A-Z]+)(\d+)$/.exec(coord);
    if (!match) return coord;
    const row = Number(match[2]) + rowOffset;
    const col = parseColumn(match[1]) + colOffset;
    return `${columnNameForTest(col)}${row}`;
  }

  /**
   * Mirror of the backend translateFormulaRefs (REQ-3-2-1/REQ-4-1-2): relative
   * references shift by the paste offset, absolute $A$1 locks stay unchanged,
   * and a reference that leaves the worksheet bounds becomes #REF!.
   */
  function translateFormulaForTest(text: string, rowOffset: number, colOffset: number): string {
    if (typeof text !== "string" || !text.startsWith("=")) return text;
    return text.replace(
      /(\$?[A-Za-z]{1,3}\$?[1-9]\d*)(?::(\$?[A-Za-z]{1,3}\$?[1-9]\d*))?/g,
      (whole, ref1: string, ref2?: string) => {
        const shift = (token: string): string | null => {
          const match = /^(\$?)([A-Za-z]+)(\$?)([1-9]\d*)$/.exec(token);
          if (!match) return null;
          let col = 0;
          for (const ch of match[2]) col = col * 26 + (ch.charCodeAt(0) - 64);
          col -= 1;
          const colLocked = match[1] === "$";
          const rowLocked = match[3] === "$";
          const newCol = colLocked ? col : col + colOffset;
          const newRow = rowLocked ? Number(match[4]) : Number(match[4]) + rowOffset;
          if (newCol < 0 || newRow < 1) return null;
          return `${colLocked ? "$" : ""}${columnNameForTest(newCol)}${rowLocked ? "$" : ""}${newRow}`;
        };
        const shifted1 = shift(ref1);
        if (!shifted1) return "#REF!";
        if (ref2 === undefined) return shifted1;
        const shifted2 = shift(ref2);
        if (!shifted2) return "#REF!";
        return `${shifted1}:${shifted2}`;
      },
    );
  }

  function jsonResponse(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null,
      },
      json: async () => body,
    };
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const segments = url.pathname.split("/").filter(Boolean);
    const bodyText = typeof init?.body === "string" ? init.body : "{}";
    const body = JSON.parse(bodyText);

    if (segments[0] !== "api") return jsonResponse(404, { error: "Not found" });

    const findById = (id: string) => store.find((entry) => entry.id === id);
    const summary = (entry: Workbook) => ({
      id: entry.id,
      name: entry.name,
      updatedAt: entry.updatedAt,
    });

    if (segments[1] === "workbooks" && segments.length === 2) {
      if (method === "GET") {
        return jsonResponse(200, {
          workbooks: [...store]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map(summary),
        });
      }
      if (method === "POST") {
        const name = String(body.name ?? "").trim();
        if (name === "") {
          return jsonResponse(400, { error: "Workbook name cannot be empty" });
        }
        const workbook = makeWorkbook(name);
        store.push(workbook);
        return respond(workbook, 201);
      }
      return jsonResponse(404, { error: "Not found" });
    }

    if (segments[1] === "import-csv" && method === "POST") {
      const content: string = String(body.content ?? "");
      const quoteCount = content.match(/"/g)?.length ?? 0;
      if (quoteCount % 2 === 1) {
        return jsonResponse(400, { error: "Invalid CSV file format. Import failed." });
      }
      const workbook = makeWorkbook(String(body.fileName ?? "").replace(/\.csv$/i, ""));
      const rows = content.split("\n").filter((row) => row !== "");
      rows.forEach((row, rowIndex) => {
        row.split(",").forEach((value, colIndex) => {
          if (value !== "") {
            const letter = String.fromCharCode(65 + colIndex);
            workbook.sheets[0].cells[`${letter}${rowIndex + 1}`] = value.replace(/"/g, "");
          }
        });
      });
      store.push(workbook);
      return respond(workbook, 201);
    }

    const id = decodeURIComponent(segments[2] ?? "");
    const workbook = findById(id);
    if (!workbook) return jsonResponse(404, { error: "Workbook not found" });

    if (segments.length === 3) {
      if (method === "GET") return respond(workbook);
      if (method === "PATCH") {
        const name = String(body.name ?? "").trim();
        if (name === "") {
          return jsonResponse(400, { error: "Workbook name cannot be empty" });
        }
        workbook.name = name;
        workbook.updatedAt = new Date(2026, 8, 27, 11, 0, 0).toISOString();
        return respond(workbook);
      }
      return jsonResponse(404, { error: "Not found" });
    }

    if (segments[3] === "sheets") {
      if (segments.length === 4 && method === "POST") {
        const sheet: Sheet = {
          id: `s${store.length + 1}`,
          name: nextSheetName(workbook.sheets),
          cells: {},
          selectedCell: "A1",
          selectedRange: { start: "A1", end: "A1" },
        };
        workbook.sheets.push(sheet);
        workbook.activeSheetId = sheet.id;
        workbook.updatedAt = new Date(2026, 8, 27, 11, 0, 0).toISOString();
        return respond(workbook);
      }
      if (segments.length === 5 && method === "PATCH") {
        const sheetId = decodeURIComponent(segments[4]);
        const sheet = workbook.sheets.find((entry) => entry.id === sheetId);
        if (!sheet) return jsonResponse(400, { error: "Worksheet not found" });
        const name = String(body.name ?? "").trim();
        if (name === "") {
          return jsonResponse(400, { error: "Worksheet name cannot be empty" });
        }
        const duplicate = workbook.sheets.some(
          (other) => other.id !== sheetId && other.name.toLowerCase() === name.toLowerCase(),
        );
        if (duplicate) {
          return jsonResponse(400, { error: "Worksheet name already exists" });
        }
        sheet.name = name;
        workbook.updatedAt = new Date(2026, 8, 27, 11, 0, 0).toISOString();
        return respond(workbook);
      }
      if (segments.length === 5 && method === "DELETE") {
        const sheetId = decodeURIComponent(segments[4]);
        const index = workbook.sheets.findIndex((entry) => entry.id === sheetId);
        if (index === -1) return jsonResponse(400, { error: "Worksheet not found" });
        if (workbook.sheets.length <= 1) {
          return jsonResponse(400, { error: "A workbook must contain at least one worksheet" });
        }
        const dependent = workbook.sheets.some(
          (other) =>
            other.id !== sheetId &&
            Boolean(other.pivot) &&
            other.pivot!.sourceSheetId === sheetId,
        );
        if (dependent) {
          return jsonResponse(400, {
            error: "Please delete or rebuild dependent pivot tables first",
          });
        }
        const wasActive = workbook.activeSheetId === sheetId;
        workbook.sheets.splice(index, 1);
        if (wasActive) {
          workbook.activeSheetId = workbook.sheets[Math.min(index, workbook.sheets.length - 1)].id;
        }
        workbook.updatedAt = new Date(2026, 8, 27, 11, 0, 0).toISOString();
        return respond(workbook);
      }
      return jsonResponse(404, { error: "Not found" });
    }

    if (segments[3] === "rows") {
      const sheet = workbook.sheets.find((entry) => entry.id === body.sheetId);
      if (!sheet) return jsonResponse(400, { error: "Worksheet not found" });
      pushHistory(workbook);
      if (method === "POST") {
        const targetRow = body.position === "above" ? body.index : body.index + 1;
        sheet.cells = shiftInsertRow(sheet.cells, Number(targetRow));
        workbook.updatedAt = new Date(2026, 8, 27, 11, 0, 0).toISOString();
        return respond(workbook);
      }
      if (method === "DELETE") {
        sheet.cells = shiftDeleteRow(sheet.cells, Number(body.index));
        workbook.updatedAt = new Date(2026, 8, 27, 11, 0, 0).toISOString();
        return respond(workbook);
      }
      return jsonResponse(404, { error: "Not found" });
    }

    if (segments[3] === "columns") {
      const sheet = workbook.sheets.find((entry) => entry.id === body.sheetId);
      if (!sheet) return jsonResponse(400, { error: "Worksheet not found" });
      if (options.failColumns) {
        return jsonResponse(500, { error: "Column operation failed" });
      }
      pushHistory(workbook);
      if (method === "POST") {
        const targetCol = body.position === "left" ? Number(body.index) - 1 : Number(body.index);
        sheet.cells = shiftInsertColumn(sheet.cells, targetCol);
        workbook.updatedAt = new Date(2026, 8, 27, 11, 0, 0).toISOString();
        return respond(workbook);
      }
      if (method === "DELETE") {
        sheet.cells = shiftDeleteColumn(sheet.cells, Number(body.index) - 1);
        workbook.updatedAt = new Date(2026, 8, 27, 11, 0, 0).toISOString();
        return respond(workbook);
      }
      return jsonResponse(404, { error: "Not found" });
    }

    if (segments[3] === "cells" && method === "PATCH") {
      const sheet = workbook.sheets.find((entry) => entry.id === body.sheetId);
      if (!sheet) return jsonResponse(400, { error: "Worksheet not found" });
      if (options.failCells) {
        return jsonResponse(500, { error: "Cell update failed" });
      }
      pushHistory(workbook);
      for (const [coord, value] of Object.entries(body.updates ?? {})) {
        sheet.cells[coord] = String(value);
      }
      workbook.updatedAt = new Date(2026, 8, 27, 11, 0, 0).toISOString();
      return respond(workbook);
    }

    if (segments[3] === "clipboard" && method === "POST") {
      const sheet = workbook.sheets.find((entry) => entry.id === body.sheetId);
      if (!sheet) return jsonResponse(400, { error: "Worksheet not found" });
      const kind: "copy" | "cut" = body.kind === "cut" ? "cut" : "copy";
      const range = { start: String(body.range?.start ?? ""), end: String(body.range?.end ?? "") };
      const content: Record<string, string> = {};
      for (const [coord, value] of Object.entries(sheet.cells)) {
        const match = /^([A-Z]+)(\d+)$/.exec(coord);
        if (!match) continue;
        const row = Number(match[2]);
        const col = parseColumn(match[1]);
        const from = /^([A-Z]+)(\d+)$/.exec(range.start);
        const to = /^([A-Z]+)(\d+)$/.exec(range.end);
        if (!from || !to) continue;
        const rowMin = Math.min(Number(from[2]), Number(to[2]));
        const rowMax = Math.max(Number(from[2]), Number(to[2]));
        const colMin = Math.min(parseColumn(from[1]), parseColumn(to[1]));
        const colMax = Math.max(parseColumn(from[1]), parseColumn(to[1]));
        if (row >= rowMin && row <= rowMax && col >= colMin && col <= colMax) {
          content[coord] = value;
        }
      }
      clipboards.set(workbook.id, { sheetId: body.sheetId, kind, range, content });
      return respond(workbook);
    }

    if (segments[3] === "paste" && method === "POST") {
      const sheet = workbook.sheets.find((entry) => entry.id === body.sheetId);
      if (!sheet) return jsonResponse(400, { error: "Worksheet not found" });
      const clipboard = clipboards.get(workbook.id);
      if (!clipboard) return jsonResponse(400, { error: "Nothing to paste" });
      if (clipboard.sheetId !== body.sheetId) {
        return jsonResponse(400, { error: "Clipboard belongs to another worksheet" });
      }
      const targetMatch = /^([A-Z]+)(\d+)$/.exec(String(body.target ?? ""));
      const sourceMatch = /^([A-Z]+)(\d+)$/.exec(clipboard.range.start);
      if (!targetMatch || !sourceMatch) {
        return jsonResponse(400, { error: "Invalid paste target" });
      }
      const rowOffset = Number(targetMatch[2]) - Number(sourceMatch[2]);
      const colOffset = parseColumn(targetMatch[1]) - parseColumn(sourceMatch[1]);
      pushHistory(workbook);
      for (const coord of Object.keys(clipboard.content)) {
        if (clipboard.kind === "cut") sheet.cells[coord] = "";
      }
      for (const [coord, value] of Object.entries(clipboard.content)) {
        sheet.cells[pasteCoord(coord, rowOffset, colOffset)] = translateFormulaForTest(
          value,
          rowOffset,
          colOffset,
        );
      }
      workbook.updatedAt = new Date(2026, 8, 27, 11, 0, 0).toISOString();
      return respond(workbook);
    }

    if (segments[3] === "undo" && method === "POST") {
      const history = histories.get(workbook.id);
      if (!history || history.undo.length === 0) {
        return jsonResponse(400, { error: "Nothing to undo" });
      }
      const snapshot = history.undo.pop();
      if (!snapshot) return jsonResponse(400, { error: "Nothing to undo" });
      history.redo.push(cloneWorkbook(workbook));
      const index = store.findIndex((entry) => entry.id === workbook.id);
      if (index >= 0) store[index] = snapshot;
      const restored = findById(workbook.id);
      if (restored) {
        restored.updatedAt = new Date(2026, 8, 27, 11, 0, 0).toISOString();
        return respond(restored);
      }
      return jsonResponse(404, { error: "Workbook not found" });
    }

    if (segments[3] === "redo" && method === "POST") {
      const history = histories.get(workbook.id);
      if (!history || history.redo.length === 0) {
        return jsonResponse(400, { error: "Nothing to redo" });
      }
      const snapshot = history.redo.pop();
      if (!snapshot) return jsonResponse(400, { error: "Nothing to redo" });
      history.undo.push(cloneWorkbook(workbook));
      const index = store.findIndex((entry) => entry.id === workbook.id);
      if (index >= 0) store[index] = snapshot;
      const restored = findById(workbook.id);
      if (restored) {
        restored.updatedAt = new Date(2026, 8, 27, 11, 0, 0).toISOString();
        return respond(restored);
      }
      return jsonResponse(404, { error: "Workbook not found" });
    }

    if (segments[3] === "export-csv" && method === "GET") {
      const active =
        workbook.sheets.find((entry) => entry.id === workbook.activeSheetId) ??
        workbook.sheets[0];
      return csvResponse(fakeCsv(active));
    }

    if (segments[3] === "state" && method === "PATCH") {
      const sheet = workbook.sheets.find((entry) => entry.id === body.sheetId);
      if (!sheet) return jsonResponse(400, { error: "Worksheet not found" });
      workbook.activeSheetId = body.sheetId;
      sheet.selectedCell = body.selectedCell;
      if (body.selectedRange && body.selectedRange.start && body.selectedRange.end) {
        sheet.selectedRange = {
          start: body.selectedRange.start,
          end: body.selectedRange.end,
        };
      }
      return respond(workbook);
    }

    return jsonResponse(404, { error: "Not found" });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { store, fetchMock };
}

const seededWorkbook = () => makeWorkbook("Q3 Sales", { A1: "Region" });

function seededTwoSheetWorkbook(): Workbook {
  const workbook = makeWorkbook("Q3 Sales", {
    A1: "Region",
    A2: "East",
    B2: "1200",
    A3: "North",
    B3: "800",
  });
  workbook.sheets.push({ id: "s2", name: "Sheet2", cells: {}, selectedCell: "A1" });
  return workbook;
}

function renderHome() {
  window.location.hash = "#/";
  return render(<App />);
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
  await screen.findByRole("heading", { name: "Q3 Sales" });
}

beforeEach(() => {
  sequence = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("App workbook flows", () => {
  it("lists the seeded workbook on the home page", async () => {
    installFakeBackend([seededWorkbook()]);
    renderHome();
    const link = await screen.findByRole("link", { name: "Q3 Sales" });
    expect(link.getAttribute("href")).toBe("#/workbooks/wb_1");
    const record = link.closest("article");
    expect(record && within(record as HTMLElement).getByText(/Last updated: /)).toBeTruthy();
  });

  it("opens the workbook editor with tabs, grid, and formula bar", async () => {
    installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    expect(screen.getByText(/Last updated: /)).toBeTruthy();
    const tab = screen.getByRole("tab", { name: "Sheet1" });
    expect(tab.getAttribute("aria-selected")).toBe("true");

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(grid.getAttribute("aria-multiselectable")).toBe("true");

    const cellA1 = screen.getByRole("gridcell", { name: "A1" });
    expect(cellA1.getAttribute("aria-selected")).toBe("true");
    expect(within(cellA1).getByText("Region")).toBeTruthy();
    const cellB1 = screen.getByRole("gridcell", { name: "B1" });
    expect(cellB1.getAttribute("aria-selected")).toBe("false");

    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    expect((formulaBar as HTMLInputElement).value).toBe("Region");
  });

  it("restores the same workbook when its entry is revisited directly", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);
    const entry = `#/workbooks/${backend.store[0].id}`;
    expect(window.location.hash).toBe(entry);

    cleanup();
    window.location.hash = entry;
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Q3 Sales" })).toBeTruthy();
    expect(screen.getByRole("grid", { name: "Worksheet grid" })).toBeTruthy();
  });

  it("renames the workbook and updates the home list", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("button", { name: "Rename workbook" }));
    const nameBox = screen.getByRole("textbox", { name: "Workbook name" });
    expect((nameBox as HTMLInputElement).value).toBe("Q3 Sales");
    await user.clear(nameBox);
    await user.type(nameBox, "Q3 Sales Revised");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByRole("heading", { name: "Q3 Sales Revised" });
    expect(backend.store[0].name).toBe("Q3 Sales Revised");

    await user.click(screen.getByRole("link", { name: "Back to home" }));
    await screen.findByRole("link", { name: "Q3 Sales Revised" });
  });

  it("rejects an empty rename and keeps the original name", async () => {
    installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("button", { name: "Rename workbook" }));
    const nameBox = screen.getByRole("textbox", { name: "Workbook name" });
    await user.clear(nameBox);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Workbook name cannot be empty",
    );
    expect(screen.getByRole("heading", { name: "Q3 Sales" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Rename workbook" })).toBeTruthy();
  });

  it("creates a blank workbook with Sheet1 active and A1 selected", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
    expect(await screen.findByRole("heading", { name: "New workbook" })).toBeTruthy();
    const nameBox = screen.getByRole("textbox", { name: "Workbook name" });
    expect((nameBox as HTMLInputElement).value).toBe("Untitled workbook");

    await user.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByRole("heading", { name: "Untitled workbook" });
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    const cellA1 = screen.getByRole("gridcell", { name: "A1" });
    expect(cellA1.getAttribute("aria-selected")).toBe("true");
    expect(within(cellA1).queryByText("Region")).toBeNull();
    expect(backend.store.some((entry) => entry.name === "Untitled workbook")).toBe(true);
  });

  it("edits a cell through the formula bar and persists it", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    const cellA2 = screen.getByRole("gridcell", { name: "A2" });
    await user.click(cellA2);
    expect(cellA2.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe(
      "false",
    );

    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.type(formulaBar, "East");
    await user.keyboard("{Enter}");

    await screen.findByText("East");
    expect(backend.store[0].sheets[0].cells.A2).toBe("East");
    expect(backend.store[0].sheets[0].cells.A1).toBe("Region");
  });

  it("imports a CSV file as a new workbook and opens Sheet1", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Import CSV" }));
    const dialog = await screen.findByRole("dialog", { name: "Import CSV" });
    const fileInput = within(dialog).getByLabelText("CSV file");
    await user.upload(
      fileInput,
      new File(["Region,Amount\nEast,1200\nNorth,800\n"], "quarterly.csv", {
        type: "text/csv",
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));

    await screen.findByRole("heading", { name: "quarterly" });
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toContain("Region");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toContain("1200");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toContain("North");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toContain("800");
    expect(backend.store.some((entry) => entry.name === "quarterly")).toBe(true);
  });

  it("rejects invalid CSV without creating a workbook record", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Import CSV" }));
    const dialog = await screen.findByRole("dialog", { name: "Import CSV" });
    const fileInput = within(dialog).getByLabelText("CSV file");
    await user.upload(fileInput, new File(['a,"unclosed\nb,c\n'], "broken.csv", { type: "text/csv" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));

    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "Invalid CSV file format. Import failed.",
    );
    expect(backend.store.some((entry) => entry.name === "broken")).toBe(false);
    expect(screen.queryByRole("link", { name: "broken" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Import CSV" })).toBeTruthy();
  });

  it("shows the Export CSV button on the editor toolbar", async () => {
    installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);
    const button = screen.getByRole("button", { name: "Export CSV" });
    expect(button).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rename workbook" })).toBeTruthy();
  });

  it("exports the active worksheet as a CSV download and keeps the state unchanged", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    const enter = async (coord: string, value: string) => {
      await user.click(screen.getByRole("gridcell", { name: coord }));
      await user.type(formulaBar, value);
      await user.keyboard("{Enter}");
    };
    await enter("A2", "East");
    await enter("B2", "1200");
    await enter("A3", "North");
    await enter("B3", "800");

    let downloadedBlob: Blob | null = null;
    let downloadedName = "";
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      downloadedBlob = blob;
      return "blob:mock";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadedName = this.download;
      });
    try {
      await user.click(screen.getByRole("button", { name: "Export CSV" }));
      await waitFor(() => expect(downloadedBlob).not.toBeNull());
      expect(downloadedName).toBe("Sheet1.csv");
      expect(await blobText(downloadedBlob!)).toBe("Region,\r\nEast,1200\r\nNorth,800\r\n");
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }

    // Export must not change grid values, formula bar, tabs, or selection.
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toContain("Region");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toContain("1200");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toContain("North");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toContain("800");
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("800");
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "B3" }).getAttribute("aria-selected")).toBe("true");

    // Refresh keeps the same workbook and values.
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Q3 Sales" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toContain("Region");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toContain("1200");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toContain("North");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toContain("800");
  });

  it("flushes a pending formula-bar edit before exporting", async () => {
    installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("gridcell", { name: "A2" }));
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.type(formulaBar, "East");

    let downloadedBlob: Blob | null = null;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      downloadedBlob = blob;
      return "blob:mock";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        // no-op
      });
    try {
      await user.click(screen.getByRole("button", { name: "Export CSV" }));
      await waitFor(() => expect(downloadedBlob).not.toBeNull());
      expect(await blobText(downloadedBlob!)).toBe("Region\r\nEast\r\n");
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("East");
  });

  it("exposes row headers and column headers with the required roles and names", async () => {
    installFakeBackend([seededTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    expect(screen.getByRole("rowheader", { name: "1" })).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "3" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "A" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "B" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Z" })).toBeTruthy();
  });

  it("adds a worksheet with the first unused SheetN name and activates it", async () => {
    const backend = installFakeBackend([seededTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));
    const tab3 = await screen.findByRole("tab", { name: "Sheet3" });
    expect(tab3.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe(
      "false",
    );

    // the new worksheet is blank and A1 is selected
    const cellA1 = screen.getByRole("gridcell", { name: "A1" });
    expect(cellA1.getAttribute("aria-selected")).toBe("true");
    expect(within(cellA1).queryByText("Region")).toBeNull();
    expect(backend.store[0].sheets.map((sheet) => sheet.name)).toEqual([
      "Sheet1",
      "Sheet2",
      "Sheet3",
    ]);
    expect(backend.store[0].sheets[0].cells.A2).toBe("East");
    expect(backend.store[0].sheets[0].cells.B2).toBe("1200");
    expect(backend.store[0].activeSheetId).toBe(backend.store[0].sheets[2].id);

    // refresh keeps the new tab and the other sheets' data
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("tab", { name: "Sheet3" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).not.toContain("Region");
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toContain("1200");
  });

  it("renames a worksheet through the tab options menu", async () => {
    const backend = installFakeBackend([seededTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));

    const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
    const nameBox = within(dialog).getByRole("textbox", { name: "Worksheet name" });
    expect((nameBox as HTMLInputElement).value).toBe("Sheet1");
    await user.clear(nameBox);
    await user.type(nameBox, "  Sales Data  ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("tab", { name: "Sales Data" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Sheet1" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeTruthy();
    expect(backend.store[0].sheets[0].name).toBe("Sales Data");

    // refresh shows the saved name
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("tab", { name: "Sales Data" })).toBeTruthy();
  });

  it("rejects empty and duplicate worksheet names and keeps the original", async () => {
    const backend = installFakeBackend([seededTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
    const nameBox = within(dialog).getByRole("textbox", { name: "Worksheet name" });

    await user.clear(nameBox);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "Worksheet name cannot be empty",
    );
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeTruthy();

    await user.type(nameBox, "Sheet2");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "Worksheet name already exists",
    );
    expect(screen.getByRole("dialog", { name: "Rename worksheet" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeTruthy();
    expect(backend.store[0].sheets[0].name).toBe("Sheet1");
  });

  it("deletes a worksheet through the tab menu with confirmation, activating an adjacent tab", async () => {
    const backend = installFakeBackend([seededTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    // make Sheet2 the active tab first
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet2" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
    expect(dialog.textContent).toContain("Sheet2");
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    // the deleted tab and its data are gone, Sheet1 becomes active
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Sheet2" })).toBeNull());
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    expect(backend.store[0].sheets.map((sheet) => sheet.name)).toEqual(["Sheet1"]);
    expect(backend.store[0].activeSheetId).toBe(backend.store[0].sheets[0].id);
    // the remaining worksheet keeps its data
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toContain("1200");

    // refresh: the target tab stays absent and the remaining data persists
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("tab", { name: "Sheet1" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Sheet2" })).toBeNull();
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toContain("800");
  });

  it("refuses to open the dialog when only one worksheet remains and shows the message", async () => {
    const backend = installFakeBackend([makeWorkbook("Q3 Sales", { A1: "Region" })]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "A workbook must contain at least one worksheet",
    );
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeTruthy();
    expect(backend.store[0].sheets.length).toBe(1);
  });

  it("rejects deleting a pivot source worksheet, closes the dialog, and keeps both worksheets", async () => {
    const backend = installFakeBackend([seededTwoSheetWorkbook()]);
    // Pivot1 reads Sheet1, so Sheet1 is still a pivot source
    backend.store[0].sheets.push({
      id: "s3",
      name: "Pivot1",
      cells: { A1: "Region", B1: "SUM of Sales" },
      selectedCell: "A1",
      pivot: { sourceSheetId: "s1" },
    });
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
    expect(dialog.textContent).toContain("Sheet1");
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    // the dialog closes, the error is displayed, both worksheets remain
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull(),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Please delete or rebuild dependent pivot tables first",
    );
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Pivot1" })).toBeTruthy();
    expect(backend.store[0].sheets.map((sheet) => sheet.name)).toEqual([
      "Sheet1",
      "Sheet2",
      "Pivot1",
    ]);

    // the target tab and grid remain visible after refresh
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("tab", { name: "Sheet1" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
  });

  it("inserts a row above the target row through the row header menu", async () => {
    const backend = installFakeBackend([seededTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "3" }));
    await user.click(await screen.findByRole("menuitem", { name: "Insert 1 row above" }));

    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toContain("North"),
    );
    expect(screen.getByRole("gridcell", { name: "B4" }).textContent).toContain("800");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("");
    expect(backend.store[0].sheets[0].cells.A4).toBe("North");
    expect(backend.store[0].sheets[0].cells.B4).toBe("800");

    // refresh keeps the shifted structure
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "A4" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toContain("North");
  });

  it("inserts a row below and deletes a row through the row header menu", async () => {
    const backend = installFakeBackend([seededTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "2" }));
    await user.click(await screen.findByRole("menuitem", { name: "Insert 1 row below" }));
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toContain("North"),
    );
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("");

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "2" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete row" }));
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toContain("North"),
    );
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toContain("800");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("");
    expect(backend.store[0].sheets[0].cells.A3).toBe("North");
    expect(backend.store[0].sheets[0].cells.B3).toBe("800");
  });

  it("inserts a column through the column header menu", async () => {
    const backend = installFakeBackend([seededTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "B" }));
    await user.click(await screen.findByRole("menuitem", { name: "Insert 1 column left" }));

    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toContain("1200"),
    );
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "C3" }).textContent).toContain("800");
    expect(backend.store[0].sheets[0].cells.C2).toBe("1200");
  });

  it("shows the three required commands in the column header menu", async () => {
    installFakeBackend([seededTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "B" }));
    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Insert 1 column left",
      "Insert 1 column right",
      "Delete column",
    ]);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("inserts a column right and deletes a column, preserving the data after refresh", async () => {
    const backend = installFakeBackend([seededTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    // Insert 1 column right of A: the Amount values move from B to C.
    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "A" }));
    await user.click(await screen.findByRole("menuitem", { name: "Insert 1 column right" }));
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toContain("1200"),
    );
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "C3" }).textContent).toContain("800");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toContain("North");

    // Delete the blank column B: the shifted data moves back to B.
    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "B" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete column" }));
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toContain("1200"),
    );
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toContain("800");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toContain("North");
    expect(backend.store[0].sheets[0].cells.B2).toBe("1200");
    expect(backend.store[0].sheets[0].cells.B3).toBe("800");

    // Refresh keeps the restored structure and values.
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "B2" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toContain("1200");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toContain("North");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toContain("800");
  });

  it("shows an error and keeps the pre-operation grid when a column operation fails", async () => {
    const backend = installFakeBackend([seededTwoSheetWorkbook()], { failColumns: true });
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "B" }));
    await user.click(await screen.findByRole("menuitem", { name: "Insert 1 column left" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Column operation failed",
    );
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toContain("1200");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toContain("North");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toContain("800");
    expect(backend.store[0].sheets[0].cells).toEqual({
      A1: "Region",
      A2: "East",
      B2: "1200",
      A3: "North",
      B3: "800",
    });

    // Refreshing the page shows the same pre-operation structure.
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "B2" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toContain("1200");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toContain("North");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toContain("800");
  });

  it("keeps other worksheets unchanged after structure operations", async () => {
    const backend = installFakeBackend([seededTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "3" }));
    await user.click(await screen.findByRole("menuitem", { name: "Insert 1 row above" }));
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toContain("North"),
    );

    expect(backend.store[0].sheets[1].name).toBe("Sheet2");
    expect(backend.store[0].sheets[1].cells).toEqual({});

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("");
    expect(screen.queryByRole("gridcell", { name: "A4" })?.textContent ?? "").not.toContain(
      "North",
    );
  });
});

describe("REQ-2-1-2 worksheet switching", () => {
  /** Sheet1 carries the seeded formulas and records; Sheet2 is blank. */
  function formulaTwoSheetWorkbook(): Workbook {
    const workbook = makeWorkbook("Q3 Sales", {
      A1: "2",
      B1: "3",
      C1: "=A1+B1",
      A2: "East",
      B2: "1200",
      A3: "North",
      B3: "800",
    });
    workbook.sheets.push({ id: "s2", name: "Sheet2", cells: {}, selectedCell: "A1" });
    return workbook;
  }

  it("clicking another tab switches grid, selection, and formula bar to that worksheet", async () => {
    const backend = installFakeBackend([formulaTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    // Sheet1 is active; A1 is selected and its ordinary value fills the formula bar.
    const formulaBar = () => screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");
    expect(formulaBar().value).toBe("2");

    // Selecting a formula cell shows the result in the grid and the original formula in the bar.
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    await waitFor(() => expect(formulaBar().value).toBe("=A1+B1"));
    expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toContain("5");

    // Switch to Sheet2: blank grid, A1 selected, empty formula bar.
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toBe("");
    expect(formulaBar().value).toBe("");

    // Edit on Sheet2; the source worksheet must stay untouched.
    await user.type(formulaBar(), "Sales");
    fireEvent.keyDown(formulaBar(), { key: "Enter" });
    await waitFor(() => expect(backend.store[0].sheets[1].cells.A1).toBe("Sales"));
    expect(backend.store[0].sheets[0].cells.A1).toBe("2");
    expect(backend.store[0].sheets[0].cells.C1).toBe("=A1+B1");

    // Returning to Sheet1 restores its most recent successful state: C1 selected,
    // formula bar showing the original formula, grid values intact.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(screen.getByRole("gridcell", { name: "C1" }).getAttribute("aria-selected")).toBe("true");
    expect(formulaBar().value).toBe("=A1+B1");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toContain("800");
  });

  it("reopening the workbook shows the last active tab and each worksheet's own selection", async () => {
    const backend = installFakeBackend([formulaTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    // C1 on Sheet1, then switch to Sheet2 and select B2 there.
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(screen.getByRole("gridcell", { name: "B2" }));
    await waitFor(() => expect(backend.store[0].sheets[1].selectedCell).toBe("B2"));

    // Reopen directly: the last active tab (Sheet2) is displayed with its selection.
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    const tab2 = await screen.findByRole("tab", { name: "Sheet2" });
    expect(tab2.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("");
    // the persisted workbook keeps Sheet2 active and each sheet's own selection
    expect(backend.store[0].activeSheetId).toBe("s2");
    expect(backend.store[0].sheets[0].selectedCell).toBe("C1");
    expect(backend.store[0].sheets[1].selectedCell).toBe("B2");

    // Each worksheet keeps its own last confirmed selection.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(screen.getByRole("gridcell", { name: "C1" }).getAttribute("aria-selected")).toBe("true");
    expect(
      (screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value,
    ).toBe("=A1+B1");
  });
});

describe("REQ-3-1-1 cell editing through grid and formula bar", () => {
  async function openWorkbook(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(await screen.findByRole("link", { name }));
    await screen.findByRole("heading", { name });
  }

  it("double-clicking a cell shows an inline editor named Edit <coord> and Enter commits", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    const cellA2 = screen.getByRole("gridcell", { name: "A2" });
    await user.dblClick(cellA2);
    const editor = screen.getByRole("textbox", { name: "Edit A2" });
    await user.type(editor, "East");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East"),
    );
    expect(backend.store[0].sheets[0].cells.A2).toBe("East");
    // the formula bar reflects the committed ordinary value
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "East",
    );
  });

  it("clicking another cell commits the pending inline edit and selects the new cell", async () => {
    installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.dblClick(screen.getByRole("gridcell", { name: "A1" }));
    const editor = screen.getByRole("textbox", { name: "Edit A1" });
    await user.clear(editor);
    await user.type(editor, "Item");
    await user.click(screen.getByRole("gridcell", { name: "B1" }));

    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toContain("Item"),
    );
    expect(screen.getByRole("gridcell", { name: "B1" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("Escape cancels an uncommitted inline edit", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.dblClick(screen.getByRole("gridcell", { name: "A1" }));
    const editor = screen.getByRole("textbox", { name: "Edit A1" });
    await user.type(editor, "changed");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("textbox", { name: "Edit A1" })).toBeNull();
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toContain("Region");
    expect(backend.store[0].sheets[0].cells.A1).toBe("Region");
  });

  it("Escape cancels an uncommitted formula-bar change", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("gridcell", { name: "A2" }));
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.type(formulaBar, "East");
    await user.keyboard("{Escape}");

    expect((formulaBar as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("");
    expect(backend.store[0].sheets[0].cells.A2).toBeUndefined();
  });

  it("formula cells show results in the grid and the original formula in the formula bar", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    const enter = async (coord: string, value: string) => {
      await user.click(screen.getByRole("gridcell", { name: coord }));
      await user.clear(formulaBar);
      await user.type(formulaBar, value);
      await user.keyboard("{Enter}");
    };
    await enter("A1", "2");
    await enter("B1", "3");
    await enter("C1", "=A1+B1");
    await enter("D1", "=C1*2");

    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toContain("5"),
    );
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("10"),
    );

    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "=A1+B1",
    );
    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "=C1*2",
    );

    // original formulas and results persist after refresh
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "C1" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toContain("5");
    expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("10");
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "=A1+B1",
    );
  }, 20000);

  it("committing a source value recalculates directly and indirectly dependent formulas", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    const enter = async (coord: string, value: string) => {
      await user.click(screen.getByRole("gridcell", { name: coord }));
      await user.clear(formulaBar);
      await user.type(formulaBar, value);
      await user.keyboard("{Enter}");
    };
    await enter("A1", "2");
    await enter("B1", "3");
    await enter("C1", "=A1+B1");
    await enter("D1", "=C1*2");
    await enter("A1", "2");
    await enter("B1", "3");
    await enter("C1", "=A1+B1");
    await enter("D1", "=C1*2");
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("10"),
    );

    await enter("A1", "4");
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toContain("7"),
    );
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("14"),
    );
  }, 20000);

  it("a failed commit shows an error and keeps the last successful value", async () => {
    const backend = installFakeBackend([seededWorkbook()], { failCells: true });
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("gridcell", { name: "A2" }));
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.type(formulaBar, "East");
    await user.keyboard("{Enter}");

    expect((await screen.findByRole("alert")).textContent).toContain("Cell update failed");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("");
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "",
    );
    expect(backend.store[0].sheets[0].cells.A2).toBeUndefined();
  });
});

describe("REQ-4-1-1 basic expressions and aggregate functions", () => {
  it("evaluates arithmetic, references, and aggregate functions through the formula bar", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    const enter = async (coord: string, value: string) => {
      await user.click(screen.getByRole("gridcell", { name: coord }));
      await user.clear(formulaBar);
      await user.type(formulaBar, value);
      await user.keyboard("{Enter}");
    };
    await enter("A1", "2");
    await enter("B1", "3");
    await enter("A2", "4");
    await enter("B2", "5");
    await enter("C1", "=A1+B1");
    await enter("C2", "=(A1+B1)*2");
    await enter("D1", "=SUM(A1:B2)");
    await enter("D2", "=AVERAGE(A1:B2)");
    await enter("D3", "=COUNT(A1:B2)");
    await enter("D4", "=MIN(A1:B2)");
    await enter("D5", "=MAX(A1:B2)");
    await enter("E1", "=sum(a1:b1)");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toContain("5"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toContain("10"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("14"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toContain("3.5"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D3" }).textContent).toContain("4"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D4" }).textContent).toContain("2"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D5" }).textContent).toContain("5"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toContain("5"));

    // selecting a formula cell shows the original expression in the formula bar
    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "=SUM(A1:B2)",
    );
    await user.click(screen.getByRole("gridcell", { name: "E1" }));
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "=sum(a1:b1)",
    );

    // formulas and results persist after refresh
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "D1" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("14");
    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "=SUM(A1:B2)",
    );
  }, 20000);

  it("aggregate functions ignore empty and non-numeric cells; COUNT counts numbers only", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    const enter = async (coord: string, value: string) => {
      await user.click(screen.getByRole("gridcell", { name: coord }));
      await user.clear(formulaBar);
      await user.type(formulaBar, value);
      await user.keyboard("{Enter}");
    };
    await enter("A1", "10");
    await enter("A2", "East");
    await enter("B2", "30");
    await enter("C1", "=SUM(A1:B2)");
    await enter("C2", "=AVERAGE(A1:B2)");
    await enter("C3", "=COUNT(A1:B2)");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toContain("40"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toContain("20"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C3" }).textContent).toContain("2"));
  }, 20000);
});

describe("REQ-4-2-2 display and fix formula errors", () => {
  it("shows stable error tokens in the grid and the original formula in the formula bar", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    const enter = async (coord: string, value: string) => {
      await user.click(screen.getByRole("gridcell", { name: coord }));
      await user.clear(formulaBar);
      await user.type(formulaBar, value);
      await user.keyboard("{Enter}");
    };
    await enter("A1", "1");
    await enter("B1", "0");
    await enter("C1", "=A1/B1"); // #DIV/0!
    await enter("D1", "=FOO(1)"); // #NAME?
    await enter("E1", "=1+"); // #ERROR!
    await enter("F1", "=1+1"); // unrelated healthy cell

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toContain("#DIV/0!"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("#NAME?"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toContain("#ERROR!"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "F1" }).textContent).toContain("2"));

    // selecting an error cell keeps the original submitted formula in the bar
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "=A1/B1",
    );
    await user.click(screen.getByRole("gridcell", { name: "E1" }));
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "=1+",
    );

    // errors and formulas persist after refresh
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "C1" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toContain("#DIV/0!");
    expect(screen.getByRole("gridcell", { name: "F1" }).textContent).toContain("2");
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "=A1/B1",
    );
  }, 20000);

  it("fixing a failing source or formula updates the grid and removes the error after refresh", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    const enter = async (coord: string, value: string) => {
      await user.click(screen.getByRole("gridcell", { name: coord }));
      await user.clear(formulaBar);
      await user.type(formulaBar, value);
      await user.keyboard("{Enter}");
    };
    await enter("A1", "1");
    await enter("B1", "0");
    await enter("C1", "=A1/B1");
    await enter("D1", "=C1+1"); // dependent of the error

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toContain("#DIV/0!"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("#DIV/0!"));

    // fixing the source value recalculates the error cell and its dependents
    await enter("B1", "2");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toContain("0.5"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("1.5"));

    // replacing the formula with a valid one also removes the error
    await enter("C1", "=A1+1");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toContain("2"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("3"));

    // the error no longer appears after refresh
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "C1" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toContain("2");
    expect(screen.getByRole("gridcell", { name: "C1" }).textContent).not.toContain("#DIV/0!");
    expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("3");
  }, 20000);
});

describe("REQ-3-1-2 paste two-dimensional table data", () => {
  it("pastes tab-separated rows into the starting cell and persists after refresh", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    fireEvent.paste(grid, {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? "East\t1200\nNorth\t800" : ""),
      },
    });

    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("East"),
    );
    expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toContain("1200");
    expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toContain("North");
    expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toContain("800");
    // the seeded range is untouched
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toContain("Region");
    expect(backend.store[0].sheets[0].cells.D1).toBe("East");
    expect(backend.store[0].sheets[0].cells.E1).toBe("1200");
    expect(backend.store[0].sheets[0].cells.D2).toBe("North");
    expect(backend.store[0].sheets[0].cells.E2).toBe("800");

    // refresh keeps the pasted rectangle
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "D1" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toContain("800");
  });

  it("preserves empty fields and overwrites only the target rectangle", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    fireEvent.paste(grid, {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? "a\t\tb\nc\t3\n" : ""),
      },
    });

    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("a"),
    );
    expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "F1" }).textContent).toContain("b");
    expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toContain("c");
    expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toContain("3");
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toContain("Region");
    expect(backend.store[0].sheets[0].cells.D1).toBe("a");
    expect(backend.store[0].sheets[0].cells.E1).toBe("");
    expect(backend.store[0].sheets[0].cells.F1).toBe("b");
    expect(backend.store[0].sheets[0].cells.D2).toBe("c");
    expect(backend.store[0].sheets[0].cells.E2).toBe("3");
  });

  it("the grid context menu provides a Paste command that pastes clipboard content", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    fireEvent.contextMenu(screen.getByRole("gridcell", { name: "D1" }));
    const menu = await screen.findByRole("menu");
    const pasteItem = within(menu).getByRole("menuitem", { name: "Paste" });
    expect(pasteItem).toBeTruthy();

    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: async () => "East\t1200\nNorth\t800" },
      configurable: true,
    });
    try {
      await user.click(pasteItem);
      await waitFor(() =>
        expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("East"),
      );
      expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toContain("800");
      expect(backend.store[0].sheets[0].cells.E2).toBe("800");
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
      } else {
        delete (navigator as { clipboard?: unknown }).clipboard;
      }
    }
  });

  it("a rejected paste shows an error and all target cells keep their original values", async () => {
    const backend = installFakeBackend([seededWorkbook()], { failCells: true });
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    fireEvent.paste(grid, {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? "East\t1200\nNorth\t800" : ""),
      },
    });

    expect((await screen.findByRole("alert")).textContent).toContain("Cell update failed");
    expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toBe("");
    expect(backend.store[0].sheets[0].cells.D1).toBeUndefined();
    expect(backend.store[0].sheets[0].cells.E2).toBeUndefined();
  });
});

describe("REQ-3-1-3 rectangular range selection", () => {
  it("clicking selects a single cell and updates aria-selected", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    await user.click(screen.getByRole("gridcell", { name: "B2" }));
    expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe(
      "false",
    );
    expect(backend.store[0].sheets[0].selectedCell).toBe("B2");
    expect(backend.store[0].sheets[0].selectedRange).toEqual({ start: "B2", end: "B2" });
  });

  it("dragging selects the whole rectangle and persists it after refresh", async () => {
    const backend = installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    fireEvent.mouseDown(screen.getByRole("gridcell", { name: "A1" }));
    fireEvent.mouseEnter(screen.getByRole("gridcell", { name: "C3" }));
    fireEvent.mouseUp(window);

    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "C3" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    for (const coord of ["A1", "B1", "C1", "A2", "B2", "C2", "A3", "B3", "C3"]) {
      expect(screen.getByRole("gridcell", { name: coord }).getAttribute("aria-selected")).toBe(
        "true",
      );
    }
    expect(screen.getByRole("gridcell", { name: "D1" }).getAttribute("aria-selected")).toBe(
      "false",
    );
    expect(screen.getByRole("gridcell", { name: "A4" }).getAttribute("aria-selected")).toBe(
      "false",
    );
    expect(backend.store[0].sheets[0].selectedRange).toEqual({ start: "A1", end: "C3" });

    // refresh restores the whole rectangle, not just the anchor
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "C3" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("gridcell", { name: "C3" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("gridcell", { name: "D1" }).getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("selecting another cell replaces the previous selection", async () => {
    installFakeBackend([seededWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    fireEvent.mouseDown(screen.getByRole("gridcell", { name: "A1" }));
    fireEvent.mouseEnter(screen.getByRole("gridcell", { name: "C3" }));
    fireEvent.mouseUp(window);
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );

    await user.click(screen.getByRole("gridcell", { name: "A1" }));
    expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("gridcell", { name: "C3" }).getAttribute("aria-selected")).toBe(
      "false",
    );
    expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("switching worksheets preserves each worksheet's own selection rectangle", async () => {
    const backend = installFakeBackend([seededTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    fireEvent.mouseDown(screen.getByRole("gridcell", { name: "A1" }));
    fireEvent.mouseEnter(screen.getByRole("gridcell", { name: "C3" }));
    fireEvent.mouseUp(window);
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    await user.click(screen.getByRole("gridcell", { name: "B2" }));
    expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe(
      "true",
    );

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("gridcell", { name: "C3" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("gridcell", { name: "D1" }).getAttribute("aria-selected")).toBe(
      "false",
    );
    expect(backend.store[0].sheets[0].selectedRange).toEqual({ start: "A1", end: "C3" });
    expect(backend.store[0].sheets[1].selectedRange).toEqual({ start: "B2", end: "B2" });
  });
});

describe("REQ-3-2-1 copy, cut, and paste cell ranges", () => {
  const rangeWorkbook = () =>
    makeWorkbook("Q3 Sales", { A1: "East", B1: "1200", A2: "North", B2: "800" });

  function dragSelect(start: string, end: string) {
    fireEvent.mouseDown(screen.getByRole("gridcell", { name: start }));
    fireEvent.mouseEnter(screen.getByRole("gridcell", { name: end }));
    fireEvent.mouseUp(window);
  }

  async function waitForClipboardCall(backend: FakeBackend) {
    await waitFor(() =>
      expect(
        backend.fetchMock.mock.calls.some(([input]) => String(input).includes("/clipboard")),
      ).toBe(true),
    );
  }

  it("copies a selected rectangle with Ctrl+C and pastes it with Ctrl+V", async () => {
    const backend = installFakeBackend([rangeWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    dragSelect("A1", "B2");
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    fireEvent.keyDown(grid, { key: "c", ctrlKey: true });
    await waitForClipboardCall(backend);
    // after copy the source range is unchanged
    expect(backend.store[0].sheets[0].cells.A1).toBe("East");
    expect(backend.store[0].sheets[0].cells.B2).toBe("800");

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    fireEvent.paste(grid, { clipboardData: { getData: () => "" } });

    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("East"),
    );
    expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toContain("1200");
    expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toContain("North");
    expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toContain("800");
    // the source and everything outside the rectangle are untouched
    expect(backend.store[0].sheets[0].cells.A1).toBe("East");
    expect(backend.store[0].sheets[0].cells.B2).toBe("800");
    expect(backend.store[0].sheets[0].cells.F1).toBeUndefined();

    // refresh keeps the pasted rectangle
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "D1" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("East");
    expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toContain("800");
  });

  it("cutting with Ctrl+X clears the source only after the paste lands", async () => {
    const backend = installFakeBackend([rangeWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    dragSelect("A1", "B2");
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    fireEvent.keyDown(grid, { key: "x", ctrlKey: true });
    await waitForClipboardCall(backend);
    // cut alone leaves the source intact
    expect(backend.store[0].sheets[0].cells.A1).toBe("East");
    expect(backend.store[0].sheets[0].cells.B2).toBe("800");

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    fireEvent.paste(grid, { clipboardData: { getData: () => "" } });
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("East"),
    );
    expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toContain("1200");
    expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toContain("North");
    expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toContain("800");
    // the source range is cleared now that the target is displayed
    expect(backend.store[0].sheets[0].cells.A1).toBe("");
    expect(backend.store[0].sheets[0].cells.B1).toBe("");
    expect(backend.store[0].sheets[0].cells.A2).toBe("");
    expect(backend.store[0].sheets[0].cells.B2).toBe("");
    expect(backend.store[0].sheets[0].cells.D1).toBe("East");
  });

  it("the cell context menu provides Copy, Cut, and Paste commands", async () => {
    const backend = installFakeBackend([rangeWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    dragSelect("A1", "B2");
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );

    fireEvent.contextMenu(screen.getByRole("gridcell", { name: "A1" }));
    let menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Copy" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Cut" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Paste" })).toBeTruthy();

    await user.click(within(menu).getByRole("menuitem", { name: "Copy" }));
    await waitForClipboardCall(backend);
    expect(backend.store[0].sheets[0].cells.A1).toBe("East");

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    fireEvent.contextMenu(screen.getByRole("gridcell", { name: "D1" }));
    menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: "Paste" }));
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("East"),
    );
    expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toContain("1200");
    expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toContain("North");
    expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toContain("800");
    expect(backend.store[0].sheets[0].cells.D1).toBe("East");
  });
});

describe("REQ-4-1-2 copy formulas and adjust relative references", () => {
  const formulaWorkbook = () =>
    makeWorkbook("Q3 Sales", {
      A1: "2",
      B1: "3",
      C1: "=A1+B1",
      D1: "=C1*2",
    });

  function dragSelect(start: string, end: string) {
    fireEvent.mouseDown(screen.getByRole("gridcell", { name: start }));
    fireEvent.mouseEnter(screen.getByRole("gridcell", { name: end }));
    fireEvent.mouseUp(window);
  }

  async function waitForClipboardCall(backend: FakeBackend) {
    await waitFor(() =>
      expect(
        backend.fetchMock.mock.calls.some(([input]) => String(input).includes("/clipboard")),
      ).toBe(true),
    );
  }

  it("copied formulas shift relative refs, keep the source unchanged, and persist after refresh", async () => {
    const backend = installFakeBackend([formulaWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    // the seed-like formulas show results in the grid and formulas in the bar
    expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toContain("5");
    expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("10");
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "=A1+B1",
    );

    // copy C1 (=A1+B1) and paste it at E1 (offset +2 columns)
    dragSelect("C1", "C1");
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    fireEvent.keyDown(grid, { key: "c", ctrlKey: true });
    await waitForClipboardCall(backend);

    await user.click(screen.getByRole("gridcell", { name: "E1" }));
    fireEvent.paste(grid, { clipboardData: { getData: () => "" } });

    // the target grid displays the result computed from the new references
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toContain("15"),
    );
    // the target formula bar shows the adjusted original formula
    await user.click(screen.getByRole("gridcell", { name: "E1" }));
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "=C1+D1",
    );
    // the source formula and result remain unchanged
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toContain("5");
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "=A1+B1",
    );
    expect(backend.store[0].sheets[0].cells.E1).toBe("=C1+D1");

    // refresh: the adjusted formula, its result, and the source all persist
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "E1" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toContain("15");
    await user.click(screen.getByRole("gridcell", { name: "E1" }));
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "=C1+D1",
    );
    expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toContain("5");
  }, 20000);

  it("absolute references stay unchanged when a formula is copied", async () => {
    const backend = installFakeBackend([
      makeWorkbook("Q3 Sales", { A1: "2", B1: "3", C1: "=A1+B1", D1: "=$A$1*2" }),
    ]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("4");

    dragSelect("D1", "D1");
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    fireEvent.keyDown(grid, { key: "c", ctrlKey: true });
    await waitForClipboardCall(backend);

    await user.click(screen.getByRole("gridcell", { name: "D3" }));
    fireEvent.paste(grid, { clipboardData: { getData: () => "" } });

    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "D3" }).textContent).toContain("4"),
    );
    await user.click(screen.getByRole("gridcell", { name: "D3" }));
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "=$A$1*2",
    );
    expect(backend.store[0].sheets[0].cells.D3).toBe("=$A$1*2");
  }, 20000);

  it("an offset that moves a relative reference out of bounds shows #REF!", async () => {
    const backend = installFakeBackend([formulaWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    dragSelect("C1", "C1");
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    fireEvent.keyDown(grid, { key: "c", ctrlKey: true });
    await waitForClipboardCall(backend);

    // pasting =A1+B1 two columns left of its source moves both refs out of bounds
    await user.click(screen.getByRole("gridcell", { name: "A1" }));
    fireEvent.paste(grid, { clipboardData: { getData: () => "" } });

    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toContain("#REF!"),
    );
    await user.click(screen.getByRole("gridcell", { name: "A1" }));
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "=#REF!+#REF!",
    );
    expect(backend.store[0].sheets[0].cells.A1).toBe("=#REF!+#REF!");

    // the error value and adjusted formula persist after refresh
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "A1" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toContain("#REF!");
    await user.click(screen.getByRole("gridcell", { name: "A1" }));
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      "=#REF!+#REF!",
    );
  }, 20000);
});

describe("REQ-3-2-2 undo and redo recent operations", () => {
  it("the toolbar exposes Undo and Redo buttons that start disabled", async () => {
    installFakeBackend([seededTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect((undo as HTMLButtonElement).disabled).toBe(true);
    expect((redo as HTMLButtonElement).disabled).toBe(true);
  });

  it("Undo restores a cell edit and Redo reapplies it through the toolbar", async () => {
    const backend = installFakeBackend([seededTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });

    await user.click(screen.getByRole("gridcell", { name: "A2" }));
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.clear(formulaBar);
    await user.type(formulaBar, "edited");
    await user.keyboard("{Enter}");
    await screen.findByText("edited");
    expect(backend.store[0].sheets[0].cells.A2).toBe("edited");

    await waitFor(() => expect((undo as HTMLButtonElement).disabled).toBe(false));
    await user.click(undo);
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East"),
    );
    expect(backend.store[0].sheets[0].cells.A2).toBe("East");

    await waitFor(() => expect((redo as HTMLButtonElement).disabled).toBe(false));
    await user.click(redo);
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("edited"),
    );
    expect(backend.store[0].sheets[0].cells.A2).toBe("edited");
  });

  it("Ctrl+Z undoes and Ctrl+Y redoes the latest operation", async () => {
    const backend = installFakeBackend([seededTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("gridcell", { name: "A2" }));
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.clear(formulaBar);
    await user.type(formulaBar, "edited");
    await user.keyboard("{Enter}");
    await screen.findByText("edited");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East"),
    );
    expect(backend.store[0].sheets[0].cells.A2).toBe("East");

    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("edited"),
    );
    expect(backend.store[0].sheets[0].cells.A2).toBe("edited");
  });

  it("undo restores the grid after a range paste and the state persists after refresh", async () => {
    const backend = installFakeBackend([
      makeWorkbook("Q3 Sales", { A1: "East", A2: "1200", B1: "North", B2: "800" }),
    ]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    fireEvent.mouseDown(screen.getByRole("gridcell", { name: "A1" }));
    fireEvent.mouseEnter(screen.getByRole("gridcell", { name: "B2" }));
    fireEvent.mouseUp(window);
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    fireEvent.keyDown(grid, { key: "c", ctrlKey: true });
    await waitFor(() =>
      expect(
        backend.fetchMock.mock.calls.some(([input]) => String(input).includes("/clipboard")),
      ).toBe(true),
    );
    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    fireEvent.paste(grid, { clipboardData: { getData: () => "" } });
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toContain("East"),
    );

    const undo = screen.getByRole("button", { name: "Undo" });
    await waitFor(() => expect((undo as HTMLButtonElement).disabled).toBe(false));
    await user.click(undo);
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe(""),
    );
    expect(backend.store[0].sheets[0].cells.A1).toBe("East");

    // the undone state persists after refresh
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    expect(await screen.findByRole("gridcell", { name: "D1" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toContain("East");
  });

  it("a new modification after undo disables Redo and Ctrl+Y cannot restore the branch", async () => {
    const backend = installFakeBackend([seededTwoSheetWorkbook()]);
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    const redo = screen.getByRole("button", { name: "Redo" });
    await user.click(screen.getByRole("gridcell", { name: "A2" }));
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.clear(formulaBar);
    await user.type(formulaBar, "one");
    await user.keyboard("{Enter}");
    await screen.findByText("one");
    await user.click(screen.getByRole("gridcell", { name: "A2" }));
    await user.clear(formulaBar);
    await user.type(formulaBar, "two");
    await user.keyboard("{Enter}");
    await screen.findByText("two");

    // undo the second edit
    const undo = screen.getByRole("button", { name: "Undo" });
    await user.click(undo);
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("one"),
    );
    await waitFor(() => expect((redo as HTMLButtonElement).disabled).toBe(false));

    // a new edit replaces the branch: redo is disabled and Ctrl+Y does nothing
    await user.click(screen.getByRole("gridcell", { name: "A2" }));
    await user.clear(formulaBar);
    await user.type(formulaBar, "branch");
    await user.keyboard("{Enter}");
    await screen.findByText("branch");
    await waitFor(() => expect((redo as HTMLButtonElement).disabled).toBe(true));
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(backend.store[0].sheets[0].cells.A2).toBe("branch");
  });
});
