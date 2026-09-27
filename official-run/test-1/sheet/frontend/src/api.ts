import type { Workbook, WorkbookSummary } from "./types";
import type { RowAction, ColumnAction } from "./structure";
import type { TransferOperation } from "./transfer";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // keep default message
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function listWorkbooks(): Promise<{ workbooks: WorkbookSummary[] }> {
  return request("/api/workbooks");
}

export function getWorkbook(id: string): Promise<{ workbook: Workbook }> {
  return request(`/api/workbooks/${encodeURIComponent(id)}`);
}

export function createWorkbook(name?: string): Promise<{ workbook: Workbook }> {
  return request("/api/workbooks", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  });
}

export function renameWorkbook(id: string, name: string): Promise<{ workbook: Workbook }> {
  return request(`/api/workbooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  });
}

/** Add a blank worksheet (first unused SheetN name); the new sheet becomes active. */
export function addSheet(workbookId: string): Promise<{ workbook: Workbook }> {
  return request(`/api/workbooks/${encodeURIComponent(workbookId)}/sheets`, {
    method: "POST",
    headers: JSON_HEADERS,
  });
}

/** Rename a worksheet; the new name must be non-empty and unique in the workbook. */
export function renameSheet(
  workbookId: string,
  sheetId: string,
  name: string,
): Promise<{ workbook: Workbook }> {
  return request(
    `/api/workbooks/${encodeURIComponent(workbookId)}/sheets/${encodeURIComponent(sheetId)}`,
    {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name }),
    },
  );
}

/** Insert/delete a row in a worksheet (REQ-2-2-1). Returns the updated workbook. */
export function modifyRows(
  workbookId: string,
  sheetId: string,
  action: RowAction,
  row: number,
): Promise<{ workbook: Workbook }> {
  return request(
    `/api/workbooks/${encodeURIComponent(workbookId)}/sheets/${encodeURIComponent(sheetId)}/rows`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ action, row }),
    },
  );
}

/** Insert/delete a column in a worksheet (REQ-2-2-2). Returns the updated workbook. */
export function modifyColumns(
  workbookId: string,
  sheetId: string,
  action: ColumnAction,
  column: number,
): Promise<{ workbook: Workbook }> {
  return request(
    `/api/workbooks/${encodeURIComponent(workbookId)}/sheets/${encodeURIComponent(sheetId)}/columns`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ action, column }),
    },
  );
}

/** Set one cell's value in a worksheet (REQ-3-1-1). Returns the updated workbook. */
export function setCellValue(
  workbookId: string,
  sheetId: string,
  coord: string,
  value: string,
): Promise<{ workbook: Workbook }> {
  return request(
    `/api/workbooks/${encodeURIComponent(workbookId)}/sheets/${encodeURIComponent(sheetId)}/cells/${encodeURIComponent(coord)}`,
    {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ value }),
    },
  );
}

/** Persist the selected rectangle of a worksheet (REQ-3-1-3). */
export function setSheetSelection(
  workbookId: string,
  sheetId: string,
  current: string,
  end: string,
): Promise<{ workbook: Workbook }> {
  return request(
    `/api/workbooks/${encodeURIComponent(workbookId)}/sheets/${encodeURIComponent(sheetId)}/selection`,
    {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ current, end }),
    },
  );
}

/** Paste tab/newline table text starting at a cell (REQ-3-1-2). */
export function pasteCells(
  workbookId: string,
  sheetId: string,
  start: string,
  text: string,
): Promise<{ workbook: Workbook }> {
  return request(
    `/api/workbooks/${encodeURIComponent(workbookId)}/sheets/${encodeURIComponent(sheetId)}/paste`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ start, text }),
    },
  );
}

/** Copy or cut a range to a target cell in the same worksheet (REQ-3-2-1). */
export function transferCells(
  workbookId: string,
  sheetId: string,
  operation: TransferOperation,
  sourceCurrent: string,
  sourceEnd: string,
  target: string,
): Promise<{ workbook: Workbook }> {
  return request(
    `/api/workbooks/${encodeURIComponent(workbookId)}/sheets/${encodeURIComponent(sheetId)}/transfer`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        operation,
        source: { current: sourceCurrent, end: sourceEnd },
        target,
      }),
    },
  );
}

export function importCsv(fileName: string, csv: string): Promise<{ workbook: Workbook }> {
  return request("/api/import-csv", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ fileName, csv }),
  });
}
