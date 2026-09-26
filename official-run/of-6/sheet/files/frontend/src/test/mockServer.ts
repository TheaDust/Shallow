import type { CellMap, Sheet, Workbook, WorkbookSummary } from '../types';
import { columnLetter } from '../gridUtils';

export function seedWorkbook(): Workbook {
  return {
    id: 'q3-sales',
    name: 'Q3 Sales',
    lastUpdated: '2026-09-25T10:00:00.000Z',
    activeSheetId: 'sheet1',
    sheets: [
      {
        id: 'sheet1',
        name: 'Sheet1',
        rowCount: 4,
        columnCount: 4,
        cells: { A1: 'Region', A2: 'East', B2: '1200', A3: 'North', B3: '800' },
        filterViews: [],
        validationRules: [],
      },
      {
        id: 'sheet2',
        name: 'Sheet2',
        rowCount: 4,
        columnCount: 4,
        cells: {},
        filterViews: [],
        validationRules: [],
      },
    ],
    pivots: [],
  };
}

export interface MockServer {
  workbooks: Map<string, Workbook>;
  failNextSave: boolean;
  failNextCreate: boolean;
  failNextImport: boolean;
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

function parseCsvForMock(text: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"' && field === '') {
      inQuotes = true;
      i += 1;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (inQuotes) {
    return null;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function cellName(row: number, column: number): string {
  return columnLetter(column) + (row + 1);
}

export function createMockServer(initial?: Workbook[]): MockServer {
  const server: MockServer = {
    workbooks: new Map(),
    failNextSave: false,
    failNextCreate: false,
    failNextImport: false,
    fetch: () => Promise.reject(new Error('stub not wired')),
  };

  server.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init && init.method) || 'GET';
    const json = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

    if (url.pathname === '/api/workbooks' && method === 'GET') {
      const summaries: WorkbookSummary[] = Array.from(server.workbooks.values()).map(
        (wb) => ({ id: wb.id, name: wb.name, lastUpdated: wb.lastUpdated })
      );
      return Promise.resolve(json(200, summaries));
    }

    if (url.pathname === '/api/workbooks' && method === 'POST') {
      if (server.failNextCreate) {
        server.failNextCreate = false;
        return Promise.resolve(json(500, { error: 'Create failed' }));
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { name?: string };
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        return Promise.resolve(json(400, { error: 'Workbook name cannot be empty' }));
      }
      const workbook: Workbook = {
        id: 'wb-' + Math.random().toString(36).slice(2, 10),
        name,
        lastUpdated: '2026-09-25T11:00:00.000Z',
        activeSheetId: 'sheet1',
        sheets: [
          {
            id: 'sheet1',
            name: 'Sheet1',
            rowCount: 4,
            columnCount: 4,
            cells: {},
            filterViews: [],
            validationRules: [],
          },
        ],
        pivots: [],
      };
      server.workbooks.set(workbook.id, workbook);
      return Promise.resolve(json(201, workbook));
    }

    if (url.pathname === '/api/import-csv' && method === 'POST') {
      if (server.failNextImport) {
        server.failNextImport = false;
        return Promise.resolve(json(500, { error: 'Import failed' }));
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { name?: string; csv?: string };
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        return Promise.resolve(json(400, { error: 'Workbook name cannot be empty' }));
      }
      const rows = parseCsvForMock(typeof body.csv === 'string' ? body.csv : '');
      if (rows === null) {
        return Promise.resolve(json(400, { error: 'Invalid CSV file format. Import failed.' }));
      }
      const workbookName = name.replace(/\.csv$/i, '').trim() || name.trim();
      const cells: CellMap = {};
      let maxColumns = 0;
      rows.forEach((row, r) => {
        if (row.length > maxColumns) {
          maxColumns = row.length;
        }
        row.forEach((value, c) => {
          if (value !== '') {
            cells[cellName(r, c)] = value;
          }
        });
      });
      const imported: Workbook = {
        id: 'wb-import-' + Math.random().toString(36).slice(2, 10),
        name: workbookName,
        lastUpdated: '2026-09-25T12:00:00.000Z',
        activeSheetId: 'sheet1',
        sheets: [
          {
            id: 'sheet1',
            name: 'Sheet1',
            rowCount: Math.max(rows.length, 1),
            columnCount: Math.max(maxColumns, 1),
            cells,
            filterViews: [],
            validationRules: [],
          },
        ],
        pivots: [],
      };
      server.workbooks.set(imported.id, imported);
      return Promise.resolve(json(201, imported));
    }

    const match = /^\/api\/workbooks\/([^/]+)$/.exec(url.pathname);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const existing = server.workbooks.get(id);
      if (!existing) {
        return Promise.resolve(json(404, { error: 'Workbook not found' }));
      }
      if (method === 'GET') {
        return Promise.resolve(json(200, existing));
      }
      if (method === 'PUT') {
        if (server.failNextSave) {
          server.failNextSave = false;
          return Promise.resolve(json(500, { error: 'Save failed' }));
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          name?: string;
          activeSheetId?: string;
          sheets?: Sheet[];
          pivots?: Workbook['pivots'];
        };
        if (typeof body.name === 'string' && body.name.trim() === '') {
          return Promise.resolve(json(400, { error: 'Workbook name cannot be empty' }));
        }
        let sheets = existing.sheets;
        if (Array.isArray(body.sheets)) {
          const seenNames = new Set<string>();
          for (const sheet of body.sheets) {
            const trimmedName = typeof sheet.name === 'string' ? sheet.name.trim() : '';
            if (!trimmedName) {
              return Promise.resolve(json(400, { error: 'Worksheet name cannot be empty' }));
            }
            if (seenNames.has(trimmedName)) {
              return Promise.resolve(json(400, { error: 'Worksheet name already exists' }));
            }
            seenNames.add(trimmedName);
          }
          sheets = body.sheets.map((sheet) => ({ ...sheet, name: sheet.name.trim() }));
        }
        const updated: Workbook = {
          ...existing,
          name: typeof body.name === 'string' ? body.name.trim() : existing.name,
          activeSheetId:
            typeof body.activeSheetId === 'string' ? body.activeSheetId : existing.activeSheetId,
          sheets,
          pivots: Array.isArray(body.pivots) ? body.pivots : existing.pivots,
          lastUpdated: '2026-09-25T11:00:00.000Z',
        };
        server.workbooks.set(id, updated);
        return Promise.resolve(json(200, updated));
      }
      return Promise.resolve(json(405, { error: 'Method not allowed' }));
    }

    return Promise.resolve(json(404, { error: 'Not found' }));
  };

  if (initial) {
    initial.forEach((wb) => server.workbooks.set(wb.id, wb));
  }
  return server;
}

export function cellsOf(server: MockServer, id: string): CellMap {
  const wb = server.workbooks.get(id);
  if (!wb) {
    return {};
  }
  const sheet = wb.sheets.find((s) => s.id === wb.activeSheetId) ?? wb.sheets[0];
  return sheet ? sheet.cells : {};
}
