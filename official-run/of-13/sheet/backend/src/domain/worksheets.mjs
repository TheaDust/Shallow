import { randomUUID } from "node:crypto";

/** Contract error strings for worksheet name validation. */
export const WORKSHEET_NAME_EMPTY_MESSAGE = "Worksheet name cannot be empty";
export const WORKSHEET_NAME_DUPLICATE_MESSAGE = "Worksheet name already exists";

/** Contract error strings for worksheet deletion. */
export const WORKSHEET_LAST_REMAINING_MESSAGE =
  "A workbook must contain at least one worksheet";
export const WORKSHEET_PIVOT_DEPENDENCY_MESSAGE =
  "Please delete or rebuild dependent pivot tables first";

/** Worksheet names are compared after trimming and ignoring letter case. */
function nameKey(name) {
  return name.trim().toLowerCase();
}

export function normalizeWorksheetName(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}

export function isWorksheetNameTaken(sheets, name, exceptSheetId = null) {
  const key = nameKey(name);
  return sheets.some((sheet) => sheet.id !== exceptSheetId && nameKey(sheet.name) === key);
}

/**
 * First unused `SheetN` name in positive-integer order within the workbook, so
 * `Sheet1` + `Sheet2` yield `Sheet3` while a freed `Sheet1` is reused.
 */
export function nextWorksheetName(sheets) {
  const used = new Set(sheets.map((sheet) => sheet.name.trim()));
  let index = 1;
  while (used.has(`Sheet${index}`)) index += 1;
  return `Sheet${index}`;
}

/**
 * A brand new worksheet: blank cells, and no filters, validation rules or pivot
 * selections inherited from any other worksheet.
 */
export function createBlankWorksheet(sheets) {
  return { id: randomUUID(), name: nextWorksheetName(sheets), cells: {} };
}

/**
 * True when a pivot table of another worksheet of the same workbook reads `sheetId` as its
 * source. Such a worksheet is only read, so it cannot be removed while a pivot still needs it;
 * deleting the pivot-result worksheet itself removes that constraint.
 */
export function isPivotSource(sheets, sheetId) {
  return sheets.some((sheet) => sheet.id !== sheetId && sheet.pivot?.sourceSheetId === sheetId);
}

/**
 * Worksheet that becomes active after `sheetId` is removed: the neighbour before it, or the
 * first remaining worksheet when the removed one was first. `null` when nothing remains.
 */
export function adjacentWorksheetId(sheets, sheetId) {
  const remaining = sheets.filter((sheet) => sheet.id !== sheetId);
  if (remaining.length === 0) return null;
  const index = sheets.findIndex((sheet) => sheet.id === sheetId);
  return index > 0 ? remaining[index - 1].id : remaining[0].id;
}
