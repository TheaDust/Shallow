import type { Workbook, WorkbookSummary } from "../domain/types";

export const seededWorkbook: Workbook = {
  id: "wb-seed-q3",
  name: "Q3 Sales",
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z",
  activeSheetId: "ws-seed-q3-1",
  sheets: [
    {
      id: "ws-seed-q3-1",
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
    { id: "ws-seed-q3-2", name: "Sheet2", cells: {} },
  ],
};

export const seededSummary: WorkbookSummary = {
  id: seededWorkbook.id,
  name: seededWorkbook.name,
  updatedAt: seededWorkbook.updatedAt,
};

export const blankWorkbook: Workbook = {
  id: "wb-blank",
  name: "Untitled workbook",
  createdAt: "2026-09-02T08:00:00.000Z",
  updatedAt: "2026-09-02T08:00:00.000Z",
  activeSheetId: "ws-blank-1",
  sheets: [{ id: "ws-blank-1", name: "Sheet1", cells: {} }],
};
