import { randomUUID } from "node:crypto";

import { cellsFromRows, workbookNameFromFileName } from "./csv.mjs";
import { computeHiddenRows } from "./filter.mjs";
import { computeSheetValues } from "./formula.mjs";

export const DEFAULT_WORKBOOK_NAME = "Untitled spreadsheet";
export const DEFAULT_WORKSHEET_NAME = "Sheet1";

/** Fixed timestamp so the seeded evaluation state is deterministic. */
export const SEED_UPDATED_AT = "2026-03-14T09:32:00.000Z";

/**
 * Shared evaluation seed: workbook `Q3 Sales` with worksheets `Sheet1` and `Sheet2`.
 *
 * `Sheet1` holds the data region `A1:C4` shared by the editing, structure, sort, filter,
 * validation and pivot requirements: headers `Region/Sales/Status` with the rows
 * `East/1200/Open`, `North/800/Closed` and `South/700/Open`. `Sheet2` holds the REQ-4 formula
 * sample (`A1=2`, `B1=3`, `C1==A1+B1`, `D1==C1*2`); it cannot sit on `Sheet1`, whose `A1`
 * is `Region`, so it lives on the second worksheet of the same workbook and stays the
 * "other worksheet" of the structure, paste and range-transfer requirements.
 *
 * Later requirements add compatible entities (filters, validation rules, pivots, more rows)
 * without changing this identity; the seed ships no filter and no validation rule.
 */
export function createSeedState() {
  return {
    workbooks: [
      {
        id: "wb-q3-sales",
        name: "Q3 Sales",
        createdAt: SEED_UPDATED_AT,
        updatedAt: SEED_UPDATED_AT,
        activeSheetId: "wb-q3-sales-sheet-1",
        sheets: [
          {
            id: "wb-q3-sales-sheet-1",
            name: DEFAULT_WORKSHEET_NAME,
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
            id: "wb-q3-sales-sheet-2",
            name: "Sheet2",
            cells: { A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2" },
          },
        ],
      },
    ],
  };
}

export function createBlankWorkbook({ name, now = new Date().toISOString() }) {
  const sheetId = randomUUID();
  return {
    id: randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    activeSheetId: sheetId,
    sheets: [{ id: sheetId, name: DEFAULT_WORKSHEET_NAME, cells: {} }],
  };
}

/**
 * Creates the workbook produced by a successful CSV import: `Sheet1` holds the parsed
 * rows with the first row kept as ordinary data.
 */
export function createImportedWorkbook({ fileName, rows, now = new Date().toISOString() }) {
  const workbook = createBlankWorkbook({
    name: workbookNameFromFileName(fileName, DEFAULT_WORKBOOK_NAME),
    now,
  });
  workbook.sheets[0].cells = cellsFromRows(rows);
  return workbook;
}

export function summarizeWorkbook(workbook) {
  return { id: workbook.id, name: workbook.name, updatedAt: workbook.updatedAt };
}

/**
 * Workbook shape sent to the client: every worksheet additionally carries the computed
 * display text of its cells (`values`) and the row numbers its filter hides (`hiddenRows`),
 * both derived from the stored state on every response so neither can ever be stale. Storage
 * keeps only the raw cells, the filter definition and the validation rules.
 */
export function serializeWorkbook(workbook) {
  return {
    ...workbook,
    sheets: workbook.sheets.map((sheet) => {
      const values = computeSheetValues(sheet.cells, {
        rows: sheet.rowCount,
        columns: sheet.columnCount,
      });
      return { ...sheet, values, hiddenRows: computeHiddenRows(sheet, values) };
    }),
  };
}

export function findWorkbook(state, id) {
  return state.workbooks.find((workbook) => workbook.id === id) ?? null;
}

export function normalizeWorkbookName(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}
