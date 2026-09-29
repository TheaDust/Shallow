import type { CellRange, ColumnFilter, SummarizeBy, Workbook, WorkbookSummary } from "../domain/types";
import type { SheetSnapshot } from "../domain/history";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    credentials: init.credentials ?? "same-origin",
    headers,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body
      ? String(body.error)
      : `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, body);
  }
  return body as T;
}

export async function listWorkbooks(): Promise<WorkbookSummary[]> {
  const body = await apiRequest<{ workbooks: WorkbookSummary[] }>("/api/workbooks");
  return body.workbooks;
}

export async function getWorkbook(id: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(`/api/workbooks/${encodeURIComponent(id)}`);
  return body.workbook;
}

export async function createWorkbook(): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>("/api/workbooks", {
    method: "POST",
    body: JSON.stringify({}),
  });
  return body.workbook;
}

export async function renameWorkbook(id: string, name: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(`/api/workbooks/${encodeURIComponent(id)}/rename`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return body.workbook;
}

export async function setActiveSheet(id: string, sheetId: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(`/api/workbooks/${encodeURIComponent(id)}/active-sheet`, {
    method: "POST",
    body: JSON.stringify({ sheetId }),
  });
  return body.workbook;
}

export async function addWorksheet(id: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(`/api/workbooks/${encodeURIComponent(id)}/sheets`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return body.workbook;
}

export async function renameSheet(id: string, sheetId: string, name: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/rename`,
    {
      method: "POST",
      body: JSON.stringify({ name }),
    },
  );
  return body.workbook;
}

/** Deletes a worksheet and everything it owns; the workbook returned has the new sheet list. */
export async function deleteSheet(id: string, sheetId: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/delete`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return body.workbook;
}

export type SheetStructureOp =
  | "insert-row-above"
  | "insert-row-below"
  | "delete-row"
  | "insert-column-left"
  | "insert-column-right"
  | "delete-column";

export async function changeSheetStructure(id: string, sheetId: string, op: SheetStructureOp, index: number): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/structure`,
    {
      method: "POST",
      body: JSON.stringify({ op, index }),
    },
  );
  return body.workbook;
}

/** Writes cell values/formulas (`"=..."` becomes a formula) into a worksheet. */
export async function updateCells(id: string, sheetId: string, cells: Record<string, string>): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/cells`,
    {
      method: "POST",
      body: JSON.stringify({ cells }),
    },
  );
  return body.workbook;
}

/** Copies or cuts `source` onto the rectangle anchored at `target.start`. */
export async function transferRange(
  id: string,
  sheetId: string,
  payload: { source: CellRange; target: CellRange; mode: "copy" | "cut" },
): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/range-transfer`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  return body.workbook;
}

/** Restores a complete worksheet state from an undo/redo snapshot. */
export async function restoreSheet(id: string, sheetId: string, sheet: SheetSnapshot): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/restore`,
    {
      method: "POST",
      body: JSON.stringify({ sheet }),
    },
  );
  return body.workbook;
}

/** Persists the complete selection rectangle of one worksheet (or null). */
export async function setSheetSelection(id: string, sheetId: string, selection: CellRange | null): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/selection`,
    {
      method: "POST",
      body: JSON.stringify({ selection }),
      // keepalive lets the save finish even when the page reloads right after
      // the user made the selection.
      keepalive: true,
    },
  );
  return body.workbook;
}

/** Creates or replaces the filter view of one worksheet (`{clear: true}` removes it). */
export async function setFilter(
  id: string,
  sheetId: string,
  payload: { range: CellRange; conditions?: ColumnFilter[] } | { clear: true },
): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/filter`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  return body.workbook;
}

/** Creates a pivot-result worksheet reading a source range (first unused PivotN). */
export async function createPivot(
  id: string,
  payload: { sourceSheetId: string; sourceRange: CellRange; summarizeBy?: SummarizeBy },
): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(`/api/workbooks/${encodeURIComponent(id)}/pivots`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return body.workbook;
}

/** Applies a field layout to an existing pivot worksheet and replaces its result. */
export async function applyPivot(
  id: string,
  sheetId: string,
  payload: { rowField: string; columnField: string | null; valueField: string; summarizeBy: SummarizeBy },
): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/pivot`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  return body.workbook;
}

/** Recomputes the pivot result from the stored configuration and current source data. */
export async function refreshPivot(id: string, sheetId: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/pivot-refresh`,
    { method: "POST" },
  );
  return body.workbook;
}

/** Saves or deletes a validation rule on one worksheet (atomic). */
export async function setValidation(
  id: string,
  sheetId: string,
  payload: { range: CellRange; rule: { type: "dropdown" | "number"; allowedValues?: string[]; min?: number; max?: number } } | { deleteRuleId: string },
): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/validation`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  return body.workbook;
}

/** Sorts the rows of a range by one absolute column (atomic). */
export async function sortRange(
  id: string,
  sheetId: string,
  payload: { range: CellRange; sortBy: number; order: "ascending" | "descending"; hasHeaderRow: boolean },
): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/sort`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  return body.workbook;
}

export async function importWorkbook(fileName: string, csv: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>("/api/workbooks/import", {
    method: "POST",
    body: JSON.stringify({ fileName, csv }),
  });
  return body.workbook;
}

export function exportWorkbookUrl(id: string): string {
  return `/api/workbooks/${encodeURIComponent(id)}/export`;
}
