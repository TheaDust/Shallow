import type { Workbook, WorkbookSummary } from './types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new ApiError(
      'Cannot reach the server. Please try again.',
      0
    );
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body && typeof body.error === 'string') {
        message = body.error;
      }
    } catch (err) {
      // keep the generic message when the body is not JSON
    }
    throw new ApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

export function listWorkbooks(): Promise<WorkbookSummary[]> {
  return request<WorkbookSummary[]>('/api/workbooks');
}

export function getWorkbook(id: string): Promise<Workbook> {
  return request<Workbook>(`/api/workbooks/${encodeURIComponent(id)}`);
}

export function createWorkbook(name: string): Promise<Workbook> {
  return request<Workbook>('/api/workbooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function importCsv(name: string, csv: string): Promise<Workbook> {
  return request<Workbook>('/api/import-csv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, csv }),
  });
}

export function saveWorkbook(id: string, workbook: Workbook): Promise<Workbook> {
  const payload = {
    name: workbook.name,
    activeSheetId: workbook.activeSheetId,
    sheets: workbook.sheets,
    pivots: workbook.pivots,
  };
  return request<Workbook>(`/api/workbooks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
