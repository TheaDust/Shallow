import { DEFAULT_COLUMN_COUNT, DEFAULT_ROW_COUNT } from "./cells.mjs";

export const SEED_WORKBOOK_ID = "wb_q3_sales";
export const SEED_WORKSHEET_ID = "ws_q3_sales_sheet1";
export const SEED_SECOND_WORKSHEET_ID = "ws_q3_sales_sheet2";
export const SEED_CREATED_AT = "2026-09-28T09:45:00.000Z";
export const SEED_UPDATED_AT = "2026-09-28T10:15:00.000Z";

/**
 * Shared initial state of the application. Workbooks declared as pre-existing by the
 * requirements are seeded here; incompatible scenario specific states are created through
 * the public workbook operations instead of being merged into this record.
 *
 * `Sheet1` holds the evaluation seed range `A1:C4`: headers `Region/Sales/Status` over the
 * rows `East/1200/Open`, `North/800/Closed`, `South/700/Open`. `Sheet2` is the second seeded
 * worksheet and is blank: the seed has no validation rule and no filter, so rules and filter
 * views are created through their write endpoints.
 */
export function createSeedState() {
  return {
    workbooks: [
      {
        id: SEED_WORKBOOK_ID,
        name: "Q3 Sales",
        createdAt: SEED_CREATED_AT,
        updatedAt: SEED_UPDATED_AT,
        activeWorksheetId: SEED_WORKSHEET_ID,
        worksheets: [
          {
            id: SEED_WORKSHEET_ID,
            name: "Sheet1",
            rowCount: DEFAULT_ROW_COUNT,
            columnCount: DEFAULT_COLUMN_COUNT,
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
            selection: { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } },
          },
          {
            id: SEED_SECOND_WORKSHEET_ID,
            name: "Sheet2",
            rowCount: DEFAULT_ROW_COUNT,
            columnCount: DEFAULT_COLUMN_COUNT,
            cells: {},
            validations: [],
            filter: null,
            selection: { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } },
          },
        ],
      },
    ],
  };
}
