import { vi } from "vitest";

import type { WorkbookData, WorkbookSummary, WorksheetData } from "../types";

export interface StubRequest {
  method: string;
  path: string;
  url: string;
  body: any;
}

export interface StubResult {
  status?: number;
  body: unknown;
}

export type StubHandler = (request: StubRequest) => StubResult | undefined | Promise<StubResult | undefined>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Installs a fetch stub that answers from `handler` and records every request. */
export function stubFetch(handler: StubHandler) {
  const calls: StubRequest[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(raw, "http://localhost").pathname;
    const request: StubRequest = {
      method: (init?.method ?? "GET").toUpperCase(),
      path,
      url: raw,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(request);
    const result = await handler(request);
    if (!result) return jsonResponse(404, { error: "Not found" });
    return jsonResponse(result.status ?? 200, result.body);
  });
  vi.stubGlobal("fetch", mock);
  return { mock, calls };
}

export const SEED_UPDATED_AT = "2026-09-15T08:30:00.000Z";
export const SEED_UPDATED_TEXT = "2026-09-15 08:30 UTC";

export function workbookFixture(overrides: Partial<WorkbookData> = {}): WorkbookData {
  return {
    id: "wb-q3-sales",
    name: "Q3 Sales",
    createdAt: "2026-09-10T08:00:00.000Z",
    updatedAt: SEED_UPDATED_AT,
    activeWorksheetId: "ws-q3-sheet1",
    worksheets: [
      {
        id: "ws-q3-sheet1",
        name: "Sheet1",
        activeCell: "A1",
        selectionFocus: "A1",
        cells: { ...SEEDED_CELLS },
        values: { ...SEEDED_CELLS },
        validations: [],
        filter: null,
      },
      {
        id: "ws-q3-sheet2",
        name: "Sheet2",
        activeCell: "A1",
        selectionFocus: "A1",
        cells: {},
        values: {},
        validations: [],
        filter: null,
      },
    ],
    ...overrides,
  };
}

/** The seeded data region A1:C6 of the workbook "Q3 Sales". */
export const SEEDED_CELLS: Record<string, string> = {
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
};

/** Sheet1 of a fixture whose stored cells and displayed values are both `cells`. */
export function sheetWithCells(cells: Record<string, string>): WorksheetData {
  return {
    id: "ws-q3-sheet1",
    name: "Sheet1",
    activeCell: "A1",
    selectionFocus: "A1",
    cells: { ...cells },
    values: { ...cells },
    validations: [],
  };
}

/** Fixture of the seeded workbook, i.e. the data the evaluation seed holds. */
export function seededWorkbook(overrides: Partial<WorkbookData> = {}): WorkbookData {
  return workbookFixture(overrides);
}

export function summaryFixture(overrides: Partial<WorkbookSummary> = {}): WorkbookSummary {
  const { id, name, createdAt, updatedAt } = workbookFixture();
  return { id, name, createdAt, updatedAt, ...overrides };
}
