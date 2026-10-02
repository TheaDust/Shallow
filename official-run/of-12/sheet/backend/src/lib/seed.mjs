import { normalizeWorksheet, normalizeWorkbook } from "./workbooks.mjs";

export const SEED_TIMESTAMP = "2026-01-15T09:30:00.000Z";

/**
 * Shared evaluation seed: workbook `Q3 Sales` with worksheet `Sheet1` (headers `Region`/`Sales`/
 * `Status` and the records `East/1200/Open`, `North/800/Closed`, `South/700/Open`) plus a blank
 * `Sheet2`. Scenario-specific states (extra worksheets, ranges, filters, validation rules, pivots)
 * are built through the public workbook operations instead of being merged into this default record.
 */
export function createInitialState() {
  return {
    workbooks: [
      normalizeWorkbook({
        id: "wb-q3-sales",
        name: "Q3 Sales",
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
        activeWorksheetId: "ws-q3-sales-sheet1",
        worksheets: [
          normalizeWorksheet({
            id: "ws-q3-sales-sheet1",
            name: "Sheet1",
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
            selection: { anchor: "A1", focus: "A1" },
          }, 0),
          normalizeWorksheet({
            id: "ws-q3-sales-sheet2",
            name: "Sheet2",
            selection: { anchor: "A1", focus: "A1" },
          }, 1),
        ],
      }),
    ],
  };
}
