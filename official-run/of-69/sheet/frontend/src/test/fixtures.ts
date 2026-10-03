import type { Workbook, WorkbookSummary } from "../domain/types";

export const SEEDED_UPDATED_AT = "2026-10-01T08:00:00.000Z";
export const SEEDED_LAST_UPDATED = "Last updated: 2026-10-01 08:00";

export const seededSummary: WorkbookSummary = {
  id: "wb-q3-sales",
  name: "Q3 Sales",
  updatedAt: SEEDED_UPDATED_AT,
};

export const seededWorkbook: Workbook = {
  id: "wb-q3-sales",
  name: "Q3 Sales",
  createdAt: SEEDED_UPDATED_AT,
  updatedAt: SEEDED_UPDATED_AT,
  activeWorksheetId: "ws-q3-sales-sheet1",
  worksheets: [
    {
      id: "ws-q3-sales-sheet1",
      name: "Sheet1",
      rowCount: 30,
      columnCount: 26,
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
      selection: { anchor: "A1", focus: "A1" },
    },
    {
      id: "ws-q3-sales-sheet2",
      name: "Sheet2",
      rowCount: 30,
      columnCount: 26,
      cells: {},
      selection: { anchor: "A1", focus: "A1" },
    },
  ],
};

export const importedWorkbook: Workbook = {
  id: "wb-imported",
  name: "regional sales",
  createdAt: "2026-10-03T10:30:00.000Z",
  updatedAt: "2026-10-03T10:30:00.000Z",
  activeWorksheetId: "ws-imported-sheet1",
  worksheets: [
    {
      id: "ws-imported-sheet1",
      name: "Sheet1",
      rowCount: 30,
      columnCount: 26,
      cells: {
        A1: { value: "Region" },
        B1: { value: "Revenue" },
        A2: { value: "East" },
        B2: { value: "1200" },
        A3: { value: "North" },
        B3: { value: "800" },
      },
      selection: { anchor: "A1", focus: "A1" },
    },
  ],
};

export const twoSheetWorkbook: Workbook = {
  ...seededWorkbook,
  activeWorksheetId: "ws-q3-sales-sheet1",
  worksheets: [
    seededWorkbook.worksheets[0],
    {
      ...seededWorkbook.worksheets[1],
      cells: { A1: { value: "Gross" }, B1: { value: "900" } },
    },
  ],
};

export const blankWorkbook: Workbook = {
  id: "wb-created",
  name: "Untitled workbook",
  createdAt: "2026-10-03T09:00:00.000Z",
  updatedAt: "2026-10-03T09:00:00.000Z",
  activeWorksheetId: "ws-created-sheet1",
  worksheets: [
    {
      id: "ws-created-sheet1",
      name: "Sheet1",
      rowCount: 30,
      columnCount: 26,
      cells: {},
      selection: { anchor: "A1", focus: "A1" },
    },
  ],
};
