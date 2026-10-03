import type {
  CellRange,
  CellSelection,
  PivotSummarizeMethod,
  PivotTable,
  RangeTransferMode,
  SortOrder,
  ValidationRule,
  ValidationRuleInput,
  Workbook,
  WorkbookSummary,
  Worksheet,
  WorksheetFilter,
} from "../domain/types";
import { cellCoordinate, parseCoordinate } from "../domain/grid";
import { INVALID_CSV_MESSAGE, parseCsv } from "../domain/csv";
import { normalizeValidationRules, validateCellWrites } from "../domain/validation";
import { remapFilterForChange } from "../domain/filter";
import { shiftFormulaByOffset } from "../domain/references";
import { sortRangeRecords } from "../domain/sort";
import { PIVOT_FIELD_MISSING, PIVOT_SUMMARIZE_METHODS, computePivot, pivotHeaderFields } from "../domain/pivot";

type StructureOperation =
  | "insertRowAbove"
  | "insertRowBelow"
  | "deleteRow"
  | "insertColumnLeft"
  | "insertColumnRight"
  | "deleteColumn";

const STRUCTURE_OPS: Record<StructureOperation, { axis: "row" | "column"; mode: "insert" | "delete"; offset: number }> = {
  insertRowAbove: { axis: "row", mode: "insert", offset: 0 },
  insertRowBelow: { axis: "row", mode: "insert", offset: 1 },
  deleteRow: { axis: "row", mode: "delete", offset: 0 },
  insertColumnLeft: { axis: "column", mode: "insert", offset: 0 },
  insertColumnRight: { axis: "column", mode: "insert", offset: 1 },
  deleteColumn: { axis: "column", mode: "delete", offset: 0 },
};

/** Mirrors the server structure contract for value cells (no formula shifting). */
function applyStructure(worksheet: Worksheet, operation: StructureOperation, index: number): string | null {
  const spec = STRUCTURE_OPS[operation];
  const count = spec.axis === "row" ? worksheet.rowCount : worksheet.columnCount;
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    return spec.axis === "row" ? "Row index out of range" : "Column index out of range";
  }
  if (spec.mode === "delete" && count <= 1) {
    return spec.axis === "row" ? "Cannot delete the only row" : "Cannot delete the only column";
  }
  const point = index + spec.offset;
  const cells: Record<string, string> = {};
  for (const [key, value] of Object.entries(worksheet.cells)) {
    const coordinate = parseCoordinate(key);
    if (!coordinate) {
      cells[key] = value;
      continue;
    }
    let { row, col } = coordinate;
    if (spec.axis === "row") {
      if (spec.mode === "insert") {
        if (row >= point) row += 1;
      } else {
        if (row === point) continue;
        if (row > point) row -= 1;
      }
    } else if (spec.mode === "insert") {
      if (col >= point) col += 1;
    } else {
      if (col === point) continue;
      if (col > point) col -= 1;
    }
    cells[cellCoordinate(row, col)] = value;
  }
  worksheet.cells = cells;
  if (spec.axis === "row") worksheet.rowCount = count + (spec.mode === "insert" ? 1 : -1);
  else worksheet.columnCount = count + (spec.mode === "insert" ? 1 : -1);
  worksheet.filter = remapFilterForChange(
    worksheet.filter,
    { axis: spec.axis, mode: spec.mode, index: index + spec.offset },
    worksheet.rowCount,
    worksheet.columnCount,
  );
  return null;
}

/** Mirrors the server transfer contract for a copy or cut into a target cell. */
function boundsOf(selection: CellSelection) {
  return {
    minRow: Math.min(selection.anchor.row, selection.focus.row),
    maxRow: Math.max(selection.anchor.row, selection.focus.row),
    minCol: Math.min(selection.anchor.col, selection.focus.col),
    maxCol: Math.max(selection.anchor.col, selection.focus.col),
  };
}

function applyTransfer(
  worksheet: Worksheet,
  source: CellSelection,
  target: CellSelection,
  mode: RangeTransferMode,
): string | null {
  const src = boundsOf(source);
  const dst = boundsOf(target);
  const inside = (bounds: ReturnType<typeof boundsOf>) =>
    bounds.minRow >= 0 &&
    bounds.minCol >= 0 &&
    bounds.maxRow < worksheet.rowCount &&
    bounds.maxCol < worksheet.columnCount;
  if (!inside(src) || !inside(dst)) return "Invalid range";

  const height = src.maxRow - src.minRow + 1;
  const width = src.maxCol - src.minCol + 1;
  const rowDelta = dst.minRow - src.minRow;
  const colDelta = dst.minCol - src.minCol;
  const size = { rowCount: worksheet.rowCount, columnCount: worksheet.columnCount };
  const values: string[][] = [];
  for (let row = 0; row < height; row += 1) {
    const line: string[] = [];
    for (let col = 0; col < width; col += 1) {
      const raw = worksheet.cells[cellCoordinate(src.minRow + row, src.minCol + col)] ?? "";
      line.push(mode === "copy" ? shiftFormulaByOffset(raw, rowDelta, colDelta, size) : raw);
    }
    values.push(line);
  }

  const start = { row: dst.minRow, col: dst.minCol };
  const check = validateCellWrites(worksheet, start, values);
  if (!check.ok) return check.error ?? "Invalid range";

  const targetInside = (row: number, col: number) =>
    row >= dst.minRow && row < dst.minRow + height && col >= dst.minCol && col < dst.minCol + width;
  values.forEach((line, rowOffset) => {
    line.forEach((value, colOffset) => {
      const key = cellCoordinate(start.row + rowOffset, start.col + colOffset);
      if (value === "") delete worksheet.cells[key];
      else worksheet.cells[key] = value;
    });
  });
  if (mode === "cut") {
    for (let row = src.minRow; row <= src.maxRow; row += 1) {
      for (let col = src.minCol; col <= src.maxCol; col += 1) {
        if (targetInside(row, col)) continue;
        delete worksheet.cells[cellCoordinate(row, col)];
      }
    }
  }
  worksheet.rowCount = Math.max(worksheet.rowCount, dst.minRow + height);
  worksheet.columnCount = Math.max(worksheet.columnCount, dst.minCol + width);
  return null;
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** True when `range` is a rectangle inside the worksheet's grid. */
function isValidRange(range: CellRange | undefined, worksheet: Worksheet): range is CellRange {
  if (!range) return false;
  const { minRow, maxRow, minCol, maxCol } = range;
  if (![minRow, maxRow, minCol, maxCol].every((value) => Number.isInteger(value))) return false;
  if (minRow < 0 || minCol < 0 || minRow > maxRow || minCol > maxCol) return false;
  return maxRow < worksheet.rowCount && maxCol < worksheet.columnCount;
}

/** Grows a worksheet's grid so every derived pivot cell is rendered. */
function growGrid(worksheet: Worksheet, cells: Record<string, string>): void {
  let rows = worksheet.rowCount;
  let columns = worksheet.columnCount;
  for (const key of Object.keys(cells)) {
    const coordinate = parseCoordinate(key);
    if (!coordinate) continue;
    rows = Math.max(rows, coordinate.row + 1);
    columns = Math.max(columns, coordinate.col + 1);
  }
  worksheet.rowCount = rows;
  worksheet.columnCount = columns;
}

function summary(workbook: Workbook): WorkbookSummary {
  return { id: workbook.id, name: workbook.name, updatedAt: workbook.updatedAt };
}

function createBlank(name: string, id: string): Workbook {
  const worksheetId = `${id}-sheet-1`;
  return {
    id,
    name,
    createdAt: "2024-07-02T00:00:00.000Z",
    updatedAt: "2024-07-02T00:00:00.000Z",
    activeWorksheetId: worksheetId,
    worksheets: [
      {
        id: worksheetId,
        name: "Sheet1",
        rowCount: 12,
        columnCount: 8,
        cells: {},
        selection: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
      },
    ],
    pivots: [],
  };
}

function createFromRows(name: string, rows: string[][], id: string): Workbook {
  const worksheetId = `${id}-sheet-1`;
  const cells: Record<string, string> = {};
  rows.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      if (value !== "") cells[cellCoordinate(rowIndex, colIndex)] = value;
    });
  });
  const columnCount = Math.max(8, rows.reduce((max, row) => Math.max(max, row.length), 0));
  return {
    id,
    name,
    createdAt: "2024-07-02T00:00:00.000Z",
    updatedAt: "2024-07-02T00:00:00.000Z",
    activeWorksheetId: worksheetId,
    worksheets: [
      {
        id: worksheetId,
        name: "Sheet1",
        rowCount: Math.max(12, rows.length),
        columnCount,
        cells,
        selection: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
      },
    ],
    pivots: [],
  };
}

function workbookNameFromFileName(fileName: unknown): string {
  const raw = typeof fileName === "string" ? fileName.trim() : "";
  const base = raw.split(/[\\/]/).pop() ?? "";
  const withoutExtension = base.replace(/\.csv$/i, "");
  return (withoutExtension || base || "Untitled spreadsheet").trim();
}

/**
 * Minimal in-memory stand-in for the workbook API used by UI tests. It mirrors
 * the server contract (routes, validation messages, persistence semantics).
 */
export function createMockBackend(seed: Workbook[]) {
  const workbooks = structuredClone(seed);
  let counter = 0;
  /** workbookId -> session undo/redo snapshots, mirroring the server history. */
  const histories = new Map<string, { undo: Workbook[]; redo: Workbook[] }>();

  function historyEntry(id: string) {
    let found = histories.get(id);
    if (!found) {
      found = { undo: [], redo: [] };
      histories.set(id, found);
    }
    return found;
  }

  function historyFlags(id: string) {
    const found = histories.get(id);
    return { canUndo: Boolean(found?.undo.length), canRedo: Boolean(found?.redo.length) };
  }

  /** Stores a pre-made snapshot of `workbookId` and drops the redo branch. */
  function pushHistory(workbookId: string, snapshot: Workbook) {
    const found = historyEntry(workbookId);
    found.undo.push(snapshot);
    if (found.undo.length > 50) found.undo.shift();
    found.redo.length = 0;
  }

  /** Remembers the workbook and drops the redo branch, like the server does. */
  function recordHistory(workbook: Workbook) {
    pushHistory(workbook.id, structuredClone(workbook));
  }

  async function handle(path: string, method: string, body: Record<string, unknown>): Promise<Response> {
    if (path === "/api/workbooks/import") {
      if (method !== "POST") return json(405, { error: "Method not allowed" });
      if (typeof body.content !== "string") return json(422, { error: INVALID_CSV_MESSAGE });
      const rows = parseCsv(body.content);
      if (rows === null) return json(422, { error: INVALID_CSV_MESSAGE });
      counter += 1;
      const created = createFromRows(workbookNameFromFileName(body.fileName), rows, `wb-${counter}`);
      workbooks.push(created);
      return json(201, { workbook: created });
    }

    if (path === "/api/workbooks") {
      if (method === "GET") return json(200, { workbooks: workbooks.map(summary) });
      if (method === "POST") {
        const raw = body.name;
        if (raw !== undefined && (typeof raw !== "string" || raw.trim().length === 0)) {
          return json(422, { error: "Workbook name cannot be empty" });
        }
        counter += 1;
        const created = createBlank(typeof raw === "string" ? raw.trim() : "Untitled spreadsheet", `wb-${counter}`);
        workbooks.push(created);
        return json(201, { workbook: created });
      }
    }

    const worksheetsMatch = path.match(/^\/api\/workbooks\/([^/]+)\/worksheets$/);
    if (worksheetsMatch) {
      const workbook = workbooks.find((entry) => entry.id === worksheetsMatch[1]);
      if (!workbook) return json(404, { error: "Workbook not found" });
      if (method !== "POST") return json(405, { error: "Method not allowed" });
      counter += 1;
      const used = new Set(workbook.worksheets.map((entry) => entry.name));
      let index = 1;
      while (used.has(`Sheet${index}`)) index += 1;
      const worksheet: Worksheet = {
        id: `worksheet-${counter}`,
        name: `Sheet${index}`,
        rowCount: 12,
        columnCount: 8,
        cells: {},
        selection: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
      };
      workbook.worksheets.push(worksheet);
      workbook.activeWorksheetId = worksheet.id;
      workbook.updatedAt = "2024-07-03T00:00:00.000Z";
      return json(201, { workbook });
    }

    const structureMatch = path.match(/^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/structure$/);
    if (structureMatch) {
      const workbook = workbooks.find((entry) => entry.id === structureMatch[1]);
      const worksheet = workbook?.worksheets.find((entry) => entry.id === structureMatch[2]);
      if (!workbook || !worksheet) return json(404, { error: "Workbook not found" });
      if (method !== "POST") return json(405, { error: "Method not allowed" });
      const spec = STRUCTURE_OPS[body.operation as StructureOperation];
      if (!spec) return json(400, { error: "Unknown structure operation" });
      const before = structuredClone(workbook);
      const error = applyStructure(worksheet, body.operation as StructureOperation, body.index as number);
      if (error) return json(422, { error });
      pushHistory(workbook.id, before);
      workbook.updatedAt = "2024-07-03T00:00:00.000Z";
      return json(200, { worksheet, workbook, history: historyFlags(workbook.id) });
    }

    const transferMatch = path.match(/^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/transfer$/);
    if (transferMatch) {
      const workbook = workbooks.find((entry) => entry.id === transferMatch[1]);
      const worksheet = workbook?.worksheets.find((entry) => entry.id === transferMatch[2]);
      if (!workbook || !worksheet) return json(404, { error: "Workbook not found" });
      if (method !== "POST") return json(405, { error: "Method not allowed" });
      const mode = body.mode as RangeTransferMode;
      if (mode !== "copy" && mode !== "cut") return json(400, { error: "Unknown transfer mode" });
      if (!body.source || !body.target) return json(400, { error: "Invalid range" });
      const before = structuredClone(workbook);
      const error = applyTransfer(
        worksheet,
        body.source as CellSelection,
        body.target as CellSelection,
        mode,
      );
      if (error) return json(422, { error });
      pushHistory(workbook.id, before);
      workbook.updatedAt = "2024-07-03T00:00:00.000Z";
      return json(200, { worksheet, workbook, history: historyFlags(workbook.id) });
    }

    const cellsMatch = path.match(/^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/cells$/);
    if (cellsMatch) {
      const workbook = workbooks.find((entry) => entry.id === cellsMatch[1]);
      const worksheet = workbook?.worksheets.find((entry) => entry.id === cellsMatch[2]);
      if (!workbook || !worksheet) return json(404, { error: "Workbook not found" });
      if (method !== "POST") return json(405, { error: "Method not allowed" });
      const start = body.start as { row: number; col: number } | undefined;
      if (
        !start ||
        !Number.isInteger(start.row) ||
        !Number.isInteger(start.col) ||
        start.row < 0 ||
        start.col < 0 ||
        start.row >= worksheet.rowCount ||
        start.col >= worksheet.columnCount
      ) {
        return json(400, { error: "Invalid start cell" });
      }
      const rawValues = body.values as unknown;
      if (!Array.isArray(rawValues) || rawValues.length === 0) {
        return json(400, { error: "Invalid cell values" });
      }
      const rows = rawValues as string[][];
      if (rows.some((line) => !Array.isArray(line) || line.length === 0 || !line.every((v) => typeof v === "string"))) {
        return json(400, { error: "Invalid cell values" });
      }
      const width = rows.reduce((max, line) => Math.max(max, line.length), 0);
      const values = rows.map((line) => [...line, ...Array(width - line.length).fill("")]);
      const check = validateCellWrites(worksheet, start, values);
      if (!check.ok) return json(422, { error: check.error });
      recordHistory(workbook);
      values.forEach((line, rowOffset) => {
        line.forEach((value, colOffset) => {
          const key = cellCoordinate(start.row + rowOffset, start.col + colOffset);
          if (value === "") delete worksheet.cells[key];
          else worksheet.cells[key] = value;
        });
      });
      worksheet.rowCount = Math.max(worksheet.rowCount, start.row + values.length);
      worksheet.columnCount = Math.max(worksheet.columnCount, start.col + width);
      workbook.updatedAt = "2024-07-03T00:00:00.000Z";
      return json(200, { worksheet, workbook, history: historyFlags(workbook.id) });
    }

    const sortMatch = path.match(/^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/sort$/);
    if (sortMatch) {
      const workbook = workbooks.find((entry) => entry.id === sortMatch[1]);
      const worksheet = workbook?.worksheets.find((entry) => entry.id === sortMatch[2]);
      if (!workbook || !worksheet) return json(404, { error: "Workbook not found" });
      if (method !== "POST") return json(405, { error: "Method not allowed" });
      const before = structuredClone(workbook);
      const result = sortRangeRecords(worksheet, {
        range: body.range as CellRange,
        col: body.col as number,
        order: body.order as SortOrder,
        hasHeaderRow: body.hasHeaderRow === true,
      });
      if (!result.ok) return json(422, { error: result.error });
      worksheet.cells = result.worksheet.cells;
      pushHistory(workbook.id, before);
      workbook.updatedAt = "2024-07-03T00:00:00.000Z";
      return json(200, { worksheet, workbook, history: historyFlags(workbook.id) });
    }

    const filterMatch = path.match(/^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/filter$/);
    if (filterMatch) {
      const workbook = workbooks.find((entry) => entry.id === filterMatch[1]);
      const worksheet = workbook?.worksheets.find((entry) => entry.id === filterMatch[2]);
      if (!workbook || !worksheet) return json(404, { error: "Workbook not found" });
      if (method !== "POST") return json(405, { error: "Method not allowed" });
      const filter = (body.filter ?? null) as WorksheetFilter | null;
      if (filter) {
        const range = filter.range;
        if (
          !range ||
          range.minRow < 0 ||
          range.minCol < 0 ||
          range.minRow > range.maxRow ||
          range.minCol > range.maxCol ||
          range.maxRow >= worksheet.rowCount ||
          range.maxCol >= worksheet.columnCount
        ) {
          return json(422, { error: "Invalid filter range" });
        }
      }
      worksheet.filter = filter;
      workbook.updatedAt = "2024-07-03T00:00:00.000Z";
      return json(200, { worksheet, workbook, history: historyFlags(workbook.id) });
    }

    const validationsMatch = path.match(/^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/validations$/);
    if (validationsMatch) {
      const workbook = workbooks.find((entry) => entry.id === validationsMatch[1]);
      const worksheet = workbook?.worksheets.find((entry) => entry.id === validationsMatch[2]);
      if (!workbook || !worksheet) return json(404, { error: "Workbook not found" });
      if (method !== "POST") return json(405, { error: "Method not allowed" });
      const rules = normalizeValidationRules(worksheet.validations);
      if (body.action === "delete") {
        const id = body.id;
        if (typeof id !== "string" || !rules.some((rule) => rule.id === id)) {
          return json(404, { error: "Validation rule not found" });
        }
        worksheet.validations = rules.filter((rule) => rule.id !== id);
      } else if (body.action === "save") {
        const input = body.rule as ValidationRuleInput | undefined;
        const range = input?.range;
        if (
          !input ||
          !range ||
          range.minRow < 0 ||
          range.minCol < 0 ||
          range.minRow > range.maxRow ||
          range.minCol > range.maxCol ||
          range.maxRow >= worksheet.rowCount ||
          range.maxCol >= worksheet.columnCount
        ) {
          return json(422, { error: "Invalid validation rule" });
        }
        let rule: ValidationRule;
        if (input.type === "numeric") {
          if (
            !Number.isFinite(input.min) ||
            !Number.isFinite(input.max) ||
            input.min > input.max
          ) {
            return json(422, { error: "Invalid validation rule" });
          }
          rule = { id: input.id ?? `rule-${(counter += 1)}`, type: "numeric", min: input.min, max: input.max, range, style: input.style ?? "from" };
        } else if (input.type === "dropdown") {
          const values = (input.values ?? []).map((entry) => entry.trim()).filter((entry) => entry !== "");
          if (values.length === 0) return json(422, { error: "Enter at least one allowed value" });
          rule = { id: input.id ?? `rule-${(counter += 1)}`, type: "dropdown", values, range };
        } else {
          return json(422, { error: "Invalid validation rule" });
        }
        const sameRange = (entry: ValidationRule) =>
          entry.range.minRow === rule.range.minRow &&
          entry.range.maxRow === rule.range.maxRow &&
          entry.range.minCol === rule.range.minCol &&
          entry.range.maxCol === rule.range.maxCol;
        worksheet.validations = [
          ...rules.filter((entry) => entry.id !== rule.id && !sameRange(entry)),
          rule,
        ];
      } else {
        return json(400, { error: "Unknown validation action" });
      }
      workbook.updatedAt = "2024-07-03T00:00:00.000Z";
      return json(200, { worksheet, workbook, history: historyFlags(workbook.id) });
    }

    const pivotsMatch = path.match(/^\/api\/workbooks\/([^/]+)\/pivots$/);
    if (pivotsMatch) {
      const workbook = workbooks.find((entry) => entry.id === pivotsMatch[1]);
      if (!workbook) return json(404, { error: "Workbook not found" });
      if (method !== "POST") return json(405, { error: "Method not allowed" });
      const pivots = workbook.pivots ?? [];
      const action = body.action;
      if (action === "create") {
        const source = workbook.worksheets.find((entry) => entry.id === body.sourceWorksheetId);
        if (!source) return json(404, { error: "Workbook not found" });
        const range = body.range as CellRange | undefined;
        if (!isValidRange(range, source)) return json(422, { error: "Invalid source range" });
        const headers = pivotHeaderFields(source, range);
        if (headers.length === 0) return json(422, { error: "Source range has no headers" });
        counter += 1;
        const used = new Set(workbook.worksheets.map((entry) => entry.name));
        let index = 1;
        while (used.has(`Pivot${index}`)) index += 1;
        const worksheet: Worksheet = {
          id: `worksheet-${counter}`,
          name: `Pivot${index}`,
          rowCount: 12,
          columnCount: 8,
          cells: {},
          selection: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
          validations: [],
          filter: null,
        };
        workbook.worksheets.push(worksheet);
        workbook.activeWorksheetId = worksheet.id;
        const pivot: PivotTable = {
          id: `pivot-${counter}`,
          sourceWorksheetId: source.id,
          sourceRange: range,
          rowField: headers[0].name,
          columnField: null,
          valueField: (headers[1] ?? headers[0]).name,
          summarizeBy: "SUM",
          resultWorksheetId: worksheet.id,
        };
        const computed = computePivot(source, pivot);
        if (computed.ok) {
          worksheet.cells = computed.cells;
          growGrid(worksheet, computed.cells);
        }
        workbook.pivots = [...pivots, pivot];
        workbook.updatedAt = "2024-07-03T00:00:00.000Z";
        return json(201, { workbook, history: historyFlags(workbook.id) });
      }
      if (action === "apply" || action === "refresh") {
        const pivot = pivots.find((entry) => entry.id === body.pivotId);
        if (!pivot) return json(404, { error: "Pivot table not found" });
        const source = workbook.worksheets.find((entry) => entry.id === pivot.sourceWorksheetId);
        const resultSheet = workbook.worksheets.find((entry) => entry.id === pivot.resultWorksheetId);
        if (!source || !resultSheet) return json(404, { error: "Pivot table not found" });
        let candidate = pivot;
        if (action === "apply") {
          const rowField = body.rowField;
          const valueField = body.valueField;
          if (
            typeof rowField !== "string" ||
            rowField === "" ||
            typeof valueField !== "string" ||
            valueField === ""
          ) {
            return json(422, { error: PIVOT_FIELD_MISSING });
          }
          const summarizeBy = body.summarizeBy as string;
          if (!PIVOT_SUMMARIZE_METHODS.includes(summarizeBy as PivotSummarizeMethod)) {
            return json(422, { error: "Unknown summarization method" });
          }
          candidate = {
            ...pivot,
            rowField,
            columnField:
              typeof body.columnField === "string" && body.columnField !== ""
                ? body.columnField
                : null,
            valueField,
            summarizeBy: summarizeBy as PivotSummarizeMethod,
          };
        }
        const computed = computePivot(source, candidate);
        if (!computed.ok) return json(422, { error: computed.error });
        if (action === "apply") {
          pivot.rowField = candidate.rowField;
          pivot.columnField = candidate.columnField;
          pivot.valueField = candidate.valueField;
          pivot.summarizeBy = candidate.summarizeBy;
        }
        resultSheet.cells = computed.cells;
        growGrid(resultSheet, computed.cells);
        workbook.updatedAt = "2024-07-03T00:00:00.000Z";
        return json(200, { workbook, history: historyFlags(workbook.id) });
      }
      return json(400, { error: "Unknown pivot action" });
    }

    const worksheetMatch = path.match(/^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)$/);
    if (worksheetMatch) {
      const workbook = workbooks.find((entry) => entry.id === worksheetMatch[1]);
      const worksheet = workbook?.worksheets.find((entry) => entry.id === worksheetMatch[2]);
      if (!workbook || !worksheet) return json(404, { error: "Workbook not found" });
      if (method === "DELETE") {
        const index = workbook.worksheets.findIndex((entry) => entry.id === worksheet.id);
        if (workbook.worksheets.length <= 1) {
          return json(422, { error: "A workbook must contain at least one worksheet" });
        }
        const pivots = workbook.pivots ?? [];
        if (pivots.some((pivot) => pivot.sourceWorksheetId === worksheet.id)) {
          return json(422, { error: "Please delete or rebuild dependent pivot tables first" });
        }
        workbook.worksheets = workbook.worksheets.filter((entry) => entry.id !== worksheet.id);
        workbook.pivots = pivots.filter((pivot) => pivot.resultWorksheetId !== worksheet.id);
        workbook.activeWorksheetId = workbook.worksheets[Math.max(0, index - 1)].id;
        workbook.updatedAt = "2024-07-03T00:00:00.000Z";
        return json(200, { workbook, history: historyFlags(workbook.id) });
      }
      if (body.name !== undefined) {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (name.length === 0) return json(422, { error: "Worksheet name cannot be empty" });
        if (workbook.worksheets.some((entry) => entry.id !== worksheet.id && entry.name === name)) {
          return json(422, { error: "Worksheet name already exists" });
        }
        worksheet.name = name;
        workbook.updatedAt = "2024-07-03T00:00:00.000Z";
      }
      if (body.selection !== undefined) worksheet.selection = body.selection as CellSelection;
      return json(200, { worksheet, workbook, history: historyFlags(workbook.id) });
    }
    const historyMatch = path.match(/^\/api\/workbooks\/([^/]+)\/(undo|redo)$/);
    if (historyMatch) {
      const index = workbooks.findIndex((entry) => entry.id === historyMatch[1]);
      if (index < 0) return json(404, { error: "Workbook not found" });
      if (method !== "POST") return json(405, { error: "Method not allowed" });
      const workbook = workbooks[index];
      const found = historyEntry(workbook.id);
      const from = historyMatch[2] === "undo" ? found.undo : found.redo;
      const to = historyMatch[2] === "undo" ? found.redo : found.undo;
      if (from.length > 0) {
        to.push(structuredClone(workbook));
        const restored = from.pop() as Workbook;
        restored.activeWorksheetId = workbook.activeWorksheetId;
        restored.updatedAt = "2024-07-03T00:00:00.000Z";
        workbooks[index] = restored;
      }
      const current = workbooks[index];
      return json(200, { workbook: current, history: historyFlags(current.id) });
    }

    const workbookMatch = path.match(/^\/api\/workbooks\/([^/]+)$/);
    if (workbookMatch) {
      const workbook = workbooks.find((entry) => entry.id === workbookMatch[1]);
      if (!workbook) return json(404, { error: "Workbook not found" });
      if (method === "GET") return json(200, { workbook, history: historyFlags(workbook.id) });
      if (method === "PATCH") {
        if (body.name !== undefined) {
          if (typeof body.name !== "string" || body.name.trim().length === 0) {
            return json(422, { error: "Workbook name cannot be empty" });
          }
          workbook.name = body.name.trim();
        }
        if (typeof body.activeWorksheetId === "string") workbook.activeWorksheetId = body.activeWorksheetId;
        workbook.updatedAt = "2024-07-03T00:00:00.000Z";
        return json(200, { workbook, history: historyFlags(workbook.id) });
      }
    }

    return json(404, { error: "Not found" });
  }

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.split("?")[0];
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    return handle(path, method, body);
  };

  return { fetchImpl, workbooks };
}

export function seedWorkbook(): Workbook {
  const sheet1 = {
    id: "workbook-q3-sales-sheet-1",
    name: "Sheet1",
    rowCount: 12,
    columnCount: 8,
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
    selection: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
    validations: [],
    filter: null,
  };
  const sheet2 = {
    id: "workbook-q3-sales-sheet-2",
    name: "Sheet2",
    rowCount: 12,
    columnCount: 8,
    cells: {},
    selection: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
    validations: [],
    filter: null,
  };
  return {
    id: "workbook-q3-sales",
    name: "Q3 Sales",
    createdAt: "2024-07-01T09:00:00.000Z",
    updatedAt: "2024-07-01T09:00:00.000Z",
    activeWorksheetId: sheet1.id,
    worksheets: [sheet1, sheet2],
    pivots: [],
  };
}

export { cellCoordinate };
