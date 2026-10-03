import { readJson, sendJson } from "../lib/http.mjs";
import { randomUUID } from "node:crypto";
import {
  WORKSHEET_NAME_DUPLICATE,
  WORKSHEET_NAME_REQUIRED,
  cellCoordinate,
  createBlankWorkbook,
  createWorkbookFromRows,
  createWorksheet,
  isWorksheetNameTaken,
  nextPivotName,
  nextWorksheetName,
  removeWorksheet,
  normalizeWorkbookName,
  normalizeWorksheetName,
  occupiedBounds,
  workbookNameFromFileName,
  workbookSummary,
} from "../domain/workbook-model.mjs";
import { INVALID_CSV_MESSAGE, parseCsv } from "../domain/csv.mjs";
import { createHistory } from "../lib/history.mjs";
import { isTransferMode, transferRange } from "../domain/transfer.mjs";
import {
  MAX_COLUMN_COUNT,
  MAX_ROW_COUNT,
  applyStructureOperation,
  isStructureOperation,
} from "../domain/structure.mjs";
import { validateCellWrites, normalizeRulePayload, saveValidationRule, deleteValidationRule } from "../domain/validation.mjs";
import { validateFilterPayload } from "../domain/filter.mjs";
import { sortRangeRecords } from "../domain/sort.mjs";
import {
  PIVOT_FIELD_MISSING,
  PIVOT_SUMMARIZE_METHODS,
  computePivot,
  pivotHeaderFields,
} from "../domain/pivot.mjs";

/** Imported files are larger than ordinary JSON payloads. */
const IMPORT_BODY_LIMIT_BYTES = 8_000_000;

function sendNotFound(response) {
  sendJson(response, 404, { error: "Workbook not found" });
}

function isValidCoordinate(value, worksheet) {
  return (
    value !== null &&
    typeof value === "object" &&
    Number.isInteger(value.row) &&
    Number.isInteger(value.col) &&
    value.row >= 0 &&
    value.col >= 0 &&
    value.row < worksheet.rowCount &&
    value.col < worksheet.columnCount
  );
}

function normalizeSelection(raw, worksheet) {
  if (raw === null || typeof raw !== "object") return null;
  if (!isValidCoordinate(raw.anchor, worksheet)) return null;
  if (!isValidCoordinate(raw.focus, worksheet)) return null;
  return {
    anchor: { row: raw.anchor.row, col: raw.anchor.col },
    focus: { row: raw.focus.row, col: raw.focus.col },
  };
}

/** A source rectangle inside the worksheet, or null when it is malformed. */
function normalizeSourceRange(raw, worksheet) {
  if (raw === null || typeof raw !== "object") return null;
  const { minRow, maxRow, minCol, maxCol } = raw;
  if (![minRow, maxRow, minCol, maxCol].every((value) => Number.isInteger(value))) return null;
  if (minRow < 0 || minCol < 0 || minRow > maxRow || minCol > maxCol) return null;
  if (maxRow >= worksheet.rowCount || maxCol >= worksheet.columnCount) return null;
  return { minRow, maxRow, minCol, maxCol };
}

/**
 * Normalizes a rectangular write into equal-length rows of raw text, or null
 * when the payload is not a rectangle of strings.
 */
function normalizeCellValues(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const rows = [];
  let width = 0;
  for (const line of raw) {
    if (!Array.isArray(line) || line.length === 0) return null;
    if (!line.every((value) => typeof value === "string")) return null;
    width = Math.max(width, line.length);
    rows.push([...line]);
  }
  return rows.map((line) => [...line, ...Array(width - line.length).fill("")]);
}

/**
 * Builds the request handler for the workbook API. Returns true when the
 * request was handled so the server can fall back to static assets otherwise.
 *
 * Modifications (cell writes, range transfers and row/column changes) remember
 * the workbook as it was beforehand so `POST .../undo` and `.../redo` can
 * restore it; mutation responses and the workbook detail carry the `history`
 * flags the toolbar uses for its Undo/Redo buttons.
 */
export function createWorkbookApi(store) {
  const history = createHistory();

  const historyFlags = (workbookId) => history.flags(workbookId);

  return async function handleWorkbookApi(request, response, url) {
    const method = request.method ?? "GET";
    const { pathname } = url;

    if (pathname === "/api/workbooks/import") {
      if (method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" });
        return true;
      }
      let body;
      try {
        body = await readJson(request, { limitBytes: IMPORT_BODY_LIMIT_BYTES });
      } catch {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      if (typeof body.content !== "string") {
        sendJson(response, 422, { error: INVALID_CSV_MESSAGE });
        return true;
      }
      const parsed = parseCsv(body.content);
      if (!parsed.ok) {
        sendJson(response, 422, { error: INVALID_CSV_MESSAGE });
        return true;
      }
      const workbook = createWorkbookFromRows(workbookNameFromFileName(body.fileName), parsed.rows);
      await store.update((state) => {
        state.workbooks.push(workbook);
      });
      sendJson(response, 201, { workbook });
      return true;
    }

    if (pathname === "/api/workbooks") {
      if (method === "GET") {
        const state = await store.read();
        sendJson(response, 200, { workbooks: state.workbooks.map(workbookSummary) });
        return true;
      }
      if (method === "POST") {
        let body;
        try {
          body = await readJson(request);
        } catch {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }
        let name;
        if (body.name !== undefined) {
          name = normalizeWorkbookName(body.name);
          if (name === null) {
            sendJson(response, 422, { error: "Workbook name cannot be empty" });
            return true;
          }
        }
        const workbook = createBlankWorkbook(name);
        await store.update((state) => {
          state.workbooks.push(workbook);
        });
        sendJson(response, 201, { workbook });
        return true;
      }
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }

    const worksheetsMatch = pathname.match(/^\/api\/workbooks\/([^/]+)\/worksheets$/);
    if (worksheetsMatch) {
      const workbookId = decodeURIComponent(worksheetsMatch[1]);
      if (method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" });
        return true;
      }
      const state = await store.read();
      const workbook = state.workbooks.find((entry) => entry.id === workbookId);
      if (!workbook) {
        sendNotFound(response);
        return true;
      }
      await store.update((draft) => {
        const target = draft.workbooks.find((entry) => entry.id === workbookId);
        if (!target) return;
        const worksheet = createWorksheet(nextWorksheetName(target.worksheets));
        target.worksheets.push(worksheet);
        target.activeWorksheetId = worksheet.id;
        target.updatedAt = new Date().toISOString();
      });
      const updated = await store.read();
      sendJson(response, 201, {
        workbook: updated.workbooks.find((entry) => entry.id === workbookId),
      });
      return true;
    }

    const structureMatch = pathname.match(
      /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/structure$/,
    );
    if (structureMatch) {
      const workbookId = decodeURIComponent(structureMatch[1]);
      const worksheetId = decodeURIComponent(structureMatch[2]);
      if (method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" });
        return true;
      }
      let body;
      try {
        body = await readJson(request);
      } catch {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const state = await store.read();
      const workbook = state.workbooks.find((entry) => entry.id === workbookId);
      const worksheet = workbook?.worksheets.find((entry) => entry.id === worksheetId);
      if (!worksheet) {
        sendNotFound(response);
        return true;
      }
      if (!isStructureOperation(body.operation)) {
        sendJson(response, 400, { error: "Unknown structure operation" });
        return true;
      }
      const result = applyStructureOperation(worksheet, body.operation, body.index);
      if (!result.ok) {
        sendJson(response, 422, { error: result.error });
        return true;
      }
      history.record(workbookId, workbook);
      await store.update((draft) => {
        const targetWorkbook = draft.workbooks.find((entry) => entry.id === workbookId);
        const target = targetWorkbook?.worksheets.find((entry) => entry.id === worksheetId);
        if (!targetWorkbook || !target) return;
        target.rowCount = result.worksheet.rowCount;
        target.columnCount = result.worksheet.columnCount;
        target.cells = result.worksheet.cells;
        target.selection = result.worksheet.selection;
        target.validations = result.worksheet.validations;
        target.filter = result.worksheet.filter;
        targetWorkbook.updatedAt = new Date().toISOString();
      });
      const updated = await store.read();
      const updatedWorkbook = updated.workbooks.find((entry) => entry.id === workbookId);
      sendJson(response, 200, {
        worksheet: updatedWorkbook?.worksheets.find((entry) => entry.id === worksheetId),
        workbook: updatedWorkbook,
        history: historyFlags(workbookId),
      });
      return true;
    }

    const cellsMatch = pathname.match(/^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/cells$/);
    if (cellsMatch) {
      const workbookId = decodeURIComponent(cellsMatch[1]);
      const worksheetId = decodeURIComponent(cellsMatch[2]);
      if (method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" });
        return true;
      }
      let body;
      try {
        body = await readJson(request);
      } catch {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const state = await store.read();
      const workbook = state.workbooks.find((entry) => entry.id === workbookId);
      const worksheet = workbook?.worksheets.find((entry) => entry.id === worksheetId);
      if (!worksheet) {
        sendNotFound(response);
        return true;
      }
      if (!isValidCoordinate(body.start, worksheet)) {
        sendJson(response, 400, { error: "Invalid start cell" });
        return true;
      }
      const values = normalizeCellValues(body.values);
      if (values === null) {
        sendJson(response, 400, { error: "Invalid cell values" });
        return true;
      }
      // A write may grow the grid so no pasted value is ever dropped silently.
      const rowCount = Math.max(worksheet.rowCount, body.start.row + values.length);
      const columnCount = Math.max(worksheet.columnCount, body.start.col + values[0].length);
      if (rowCount > MAX_ROW_COUNT || columnCount > MAX_COLUMN_COUNT) {
        sendJson(response, 422, { error: "The pasted data does not fit in the worksheet" });
        return true;
      }
      const check = validateCellWrites(worksheet, body.start, values);
      if (!check.ok) {
        sendJson(response, 422, { error: check.error });
        return true;
      }
      // Taken after validation, so a rejected write is never undoable.
      history.record(workbookId, workbook);
      await store.update((draft) => {
        const targetWorkbook = draft.workbooks.find((entry) => entry.id === workbookId);
        const target = targetWorkbook?.worksheets.find((entry) => entry.id === worksheetId);
        if (!targetWorkbook || !target) return;
        values.forEach((line, rowOffset) => {
          line.forEach((value, colOffset) => {
            const key = cellCoordinate(body.start.row + rowOffset, body.start.col + colOffset);
            if (value === "") delete target.cells[key];
            else target.cells[key] = value;
          });
        });
        target.rowCount = rowCount;
        target.columnCount = columnCount;
        targetWorkbook.updatedAt = new Date().toISOString();
      });
      const updated = await store.read();
      const updatedWorkbook = updated.workbooks.find((entry) => entry.id === workbookId);
      sendJson(response, 200, {
        worksheet: updatedWorkbook?.worksheets.find((entry) => entry.id === worksheetId),
        workbook: updatedWorkbook,
        history: historyFlags(workbookId),
      });
      return true;
    }

    const transferMatch = pathname.match(
      /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/transfer$/,
    );
    if (transferMatch) {
      const workbookId = decodeURIComponent(transferMatch[1]);
      const worksheetId = decodeURIComponent(transferMatch[2]);
      if (method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" });
        return true;
      }
      let body;
      try {
        body = await readJson(request);
      } catch {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const state = await store.read();
      const workbook = state.workbooks.find((entry) => entry.id === workbookId);
      const worksheet = workbook?.worksheets.find((entry) => entry.id === worksheetId);
      if (!worksheet) {
        sendNotFound(response);
        return true;
      }
      if (!isTransferMode(body.mode)) {
        sendJson(response, 400, { error: "Unknown transfer mode" });
        return true;
      }
      const source = normalizeSelection(body.source, worksheet);
      const target = normalizeSelection(body.target, worksheet);
      if (!source || !target) {
        sendJson(response, 400, { error: "Invalid range" });
        return true;
      }
      const result = transferRange(worksheet, source, target, body.mode);
      if (!result.ok) {
        sendJson(response, 422, { error: result.error });
        return true;
      }
      history.record(workbookId, workbook);
      await store.update((draft) => {
        const targetWorkbook = draft.workbooks.find((entry) => entry.id === workbookId);
        const targetWorksheet = targetWorkbook?.worksheets.find((entry) => entry.id === worksheetId);
        if (!targetWorkbook || !targetWorksheet) return;
        targetWorksheet.rowCount = result.worksheet.rowCount;
        targetWorksheet.columnCount = result.worksheet.columnCount;
        targetWorksheet.cells = result.worksheet.cells;
        targetWorkbook.updatedAt = new Date().toISOString();
      });
      const updated = await store.read();
      const updatedWorkbook = updated.workbooks.find((entry) => entry.id === workbookId);
      sendJson(response, 200, {
        worksheet: updatedWorkbook?.worksheets.find((entry) => entry.id === worksheetId),
        workbook: updatedWorkbook,
        history: historyFlags(workbookId),
      });
      return true;
    }

    const sortMatch = pathname.match(/^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/sort$/);
    if (sortMatch) {
      const workbookId = decodeURIComponent(sortMatch[1]);
      const worksheetId = decodeURIComponent(sortMatch[2]);
      if (method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" });
        return true;
      }
      let body;
      try {
        body = await readJson(request);
      } catch {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const state = await store.read();
      const workbook = state.workbooks.find((entry) => entry.id === workbookId);
      const worksheet = workbook?.worksheets.find((entry) => entry.id === worksheetId);
      if (!worksheet) {
        sendNotFound(response);
        return true;
      }
      const result = sortRangeRecords(worksheet, {
        range: body.range,
        col: body.col,
        order: body.order,
        hasHeaderRow: body.hasHeaderRow,
      });
      if (!result.ok) {
        sendJson(response, 422, { error: result.error });
        return true;
      }
      // Taken before the write, so a rejected sort is never undoable either.
      history.record(workbookId, workbook);
      await store.update((draft) => {
        const targetWorkbook = draft.workbooks.find((entry) => entry.id === workbookId);
        const target = targetWorkbook?.worksheets.find((entry) => entry.id === worksheetId);
        if (!targetWorkbook || !target) return;
        target.cells = result.worksheet.cells;
        targetWorkbook.updatedAt = new Date().toISOString();
      });
      const updated = await store.read();
      const updatedWorkbook = updated.workbooks.find((entry) => entry.id === workbookId);
      sendJson(response, 200, {
        worksheet: updatedWorkbook?.worksheets.find((entry) => entry.id === worksheetId),
        workbook: updatedWorkbook,
        history: historyFlags(workbookId),
      });
      return true;
    }

    const filterMatch = pathname.match(
      /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/filter$/,
    );
    if (filterMatch) {
      const workbookId = decodeURIComponent(filterMatch[1]);
      const worksheetId = decodeURIComponent(filterMatch[2]);
      if (method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" });
        return true;
      }
      let body;
      try {
        body = await readJson(request);
      } catch {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const state = await store.read();
      const workbook = state.workbooks.find((entry) => entry.id === workbookId);
      const worksheet = workbook?.worksheets.find((entry) => entry.id === worksheetId);
      if (!worksheet) {
        sendNotFound(response);
        return true;
      }
      const check = validateFilterPayload(body.filter, worksheet);
      if (!check.ok) {
        sendJson(response, 422, { error: check.error });
        return true;
      }
      await store.update((draft) => {
        const targetWorkbook = draft.workbooks.find((entry) => entry.id === workbookId);
        const target = targetWorkbook?.worksheets.find((entry) => entry.id === worksheetId);
        if (!targetWorkbook || !target) return;
        target.filter = check.filter;
        targetWorkbook.updatedAt = new Date().toISOString();
      });
      const updated = await store.read();
      const updatedWorkbook = updated.workbooks.find((entry) => entry.id === workbookId);
      sendJson(response, 200, {
        worksheet: updatedWorkbook?.worksheets.find((entry) => entry.id === worksheetId),
        workbook: updatedWorkbook,
        history: historyFlags(workbookId),
      });
      return true;
    }

    const validationsMatch = pathname.match(
      /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/validations$/,
    );
    if (validationsMatch) {
      const workbookId = decodeURIComponent(validationsMatch[1]);
      const worksheetId = decodeURIComponent(validationsMatch[2]);
      if (method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" });
        return true;
      }
      let body;
      try {
        body = await readJson(request);
      } catch {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const state = await store.read();
      const workbook = state.workbooks.find((entry) => entry.id === workbookId);
      const worksheet = workbook?.worksheets.find((entry) => entry.id === worksheetId);
      if (!worksheet) {
        sendNotFound(response);
        return true;
      }
      let validations;
      if (body.action === "delete") {
        const next = typeof body.id === "string" ? deleteValidationRule(worksheet, body.id) : null;
        if (next === null) {
          sendJson(response, 404, { error: "Validation rule not found" });
          return true;
        }
        validations = next;
      } else if (body.action === "save") {
        const check = normalizeRulePayload(body.rule, worksheet);
        if (!check.ok) {
          sendJson(response, 422, { error: check.error });
          return true;
        }
        validations = saveValidationRule(worksheet, check.rule);
      } else {
        sendJson(response, 400, { error: "Unknown validation action" });
        return true;
      }
      await store.update((draft) => {
        const targetWorkbook = draft.workbooks.find((entry) => entry.id === workbookId);
        const target = targetWorkbook?.worksheets.find((entry) => entry.id === worksheetId);
        if (!targetWorkbook || !target) return;
        target.validations = validations;
        targetWorkbook.updatedAt = new Date().toISOString();
      });
      const updated = await store.read();
      const updatedWorkbook = updated.workbooks.find((entry) => entry.id === workbookId);
      sendJson(response, 200, {
        worksheet: updatedWorkbook?.worksheets.find((entry) => entry.id === worksheetId),
        workbook: updatedWorkbook,
        history: historyFlags(workbookId),
      });
      return true;
    }

    const pivotsMatch = pathname.match(/^\/api\/workbooks\/([^/]+)\/pivots$/);
    if (pivotsMatch) {
      const workbookId = decodeURIComponent(pivotsMatch[1]);
      if (method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" });
        return true;
      }
      let body;
      try {
        body = await readJson(request);
      } catch {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const state = await store.read();
      const workbook = state.workbooks.find((entry) => entry.id === workbookId);
      if (!workbook) {
        sendNotFound(response);
        return true;
      }
      const pivots = Array.isArray(workbook.pivots) ? workbook.pivots : [];

      if (body.action === "create") {
        const source = workbook.worksheets.find((entry) => entry.id === body.sourceWorksheetId);
        if (!source) {
          sendJson(response, 404, { error: "Workbook not found" });
          return true;
        }
        const range = normalizeSourceRange(body.range, source);
        if (!range) {
          sendJson(response, 422, { error: "Invalid source range" });
          return true;
        }
        const headers = pivotHeaderFields(source, range);
        if (headers.length === 0) {
          sendJson(response, 422, { error: "Source range has no headers" });
          return true;
        }
        const rowField = headers[0].name;
        const valueField = (headers[1] ?? headers[0]).name;
        const pivot = {
          id: randomUUID(),
          sourceWorksheetId: source.id,
          sourceRange: range,
          rowField,
          columnField: null,
          valueField,
          summarizeBy: "SUM",
          resultWorksheetId: "",
        };
        await store.update((draft) => {
          const target = draft.workbooks.find((entry) => entry.id === workbookId);
          if (!target) return;
          const worksheet = createWorksheet(nextPivotName(target.worksheets));
          target.worksheets.push(worksheet);
          target.activeWorksheetId = worksheet.id;
          pivot.resultWorksheetId = worksheet.id;
          // A first successful default summary gives the new worksheet content;
          // an inapplicable default (for example a text-only value field) still
          // creates the worksheet so the editor can be configured.
          const computed = computePivot(source, pivot);
          if (computed.ok) {
            worksheet.cells = computed.cells;
            const bounds = occupiedBounds(computed.cells);
            worksheet.rowCount = Math.max(worksheet.rowCount, bounds.rows);
            worksheet.columnCount = Math.max(worksheet.columnCount, bounds.columns);
          }
          target.pivots = [...(Array.isArray(target.pivots) ? target.pivots : []), pivot];
          target.updatedAt = new Date().toISOString();
        });
        const updated = await store.read();
        sendJson(response, 201, {
          workbook: updated.workbooks.find((entry) => entry.id === workbookId),
          history: historyFlags(workbookId),
        });
        return true;
      }

      if (body.action === "apply" || body.action === "refresh") {
        const pivot = pivots.find((entry) => entry.id === body.pivotId);
        if (!pivot) {
          sendJson(response, 404, { error: "Pivot table not found" });
          return true;
        }
        const source = workbook.worksheets.find((entry) => entry.id === pivot.sourceWorksheetId);
        const resultSheet = workbook.worksheets.find((entry) => entry.id === pivot.resultWorksheetId);
        if (!source || !resultSheet) {
          sendJson(response, 404, { error: "Pivot table not found" });
          return true;
        }
        let candidate = pivot;
        if (body.action === "apply") {
          if (
            typeof body.rowField !== "string" ||
            body.rowField === "" ||
            typeof body.valueField !== "string" ||
            body.valueField === ""
          ) {
            sendJson(response, 422, { error: PIVOT_FIELD_MISSING });
            return true;
          }
          if (!PIVOT_SUMMARIZE_METHODS.includes(body.summarizeBy)) {
            sendJson(response, 422, { error: "Unknown summarization method" });
            return true;
          }
          candidate = {
            ...pivot,
            rowField: body.rowField,
            columnField:
              typeof body.columnField === "string" && body.columnField !== ""
                ? body.columnField
                : null,
            valueField: body.valueField,
            summarizeBy: body.summarizeBy,
          };
        }
        const computed = computePivot(source, candidate);
        if (!computed.ok) {
          sendJson(response, 422, { error: computed.error });
          return true;
        }
        const bounds = occupiedBounds(computed.cells);
        await store.update((draft) => {
          const target = draft.workbooks.find((entry) => entry.id === workbookId);
          if (!target) return;
          const stored = (Array.isArray(target.pivots) ? target.pivots : []).find(
            (entry) => entry.id === pivot.id,
          );
          if (stored && body.action === "apply") {
            stored.rowField = candidate.rowField;
            stored.columnField = candidate.columnField;
            stored.valueField = candidate.valueField;
            stored.summarizeBy = candidate.summarizeBy;
          }
          const sheet = target.worksheets.find((entry) => entry.id === pivot.resultWorksheetId);
          if (sheet) {
            sheet.cells = computed.cells;
            sheet.rowCount = Math.max(sheet.rowCount, bounds.rows);
            sheet.columnCount = Math.max(sheet.columnCount, bounds.columns);
          }
          target.updatedAt = new Date().toISOString();
        });
        const updated = await store.read();
        sendJson(response, 200, {
          workbook: updated.workbooks.find((entry) => entry.id === workbookId),
          history: historyFlags(workbookId),
        });
        return true;
      }

      sendJson(response, 400, { error: "Unknown pivot action" });
      return true;
    }

    const worksheetMatch = pathname.match(/^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)$/);
    if (worksheetMatch) {
      const workbookId = decodeURIComponent(worksheetMatch[1]);
      const worksheetId = decodeURIComponent(worksheetMatch[2]);
      if (method === "DELETE") {
        const state = await store.read();
        const workbook = state.workbooks.find((entry) => entry.id === workbookId);
        const worksheet = workbook?.worksheets.find((entry) => entry.id === worksheetId);
        if (!workbook || !worksheet) {
          sendNotFound(response);
          return true;
        }
        const result = removeWorksheet(workbook, worksheetId);
        if (!result.ok) {
          sendJson(response, 422, { error: result.error });
          return true;
        }
        await store.update((draft) => {
          const target = draft.workbooks.find((entry) => entry.id === workbookId);
          if (!target) return;
          target.worksheets = result.worksheets;
          target.pivots = result.pivots;
          target.activeWorksheetId = result.activeWorksheetId;
          target.updatedAt = new Date().toISOString();
        });
        const updated = await store.read();
        sendJson(response, 200, {
          workbook: updated.workbooks.find((entry) => entry.id === workbookId),
          history: historyFlags(workbookId),
        });
        return true;
      }
      if (method !== "PATCH") {
        sendJson(response, 405, { error: "Method not allowed" });
        return true;
      }
      let body;
      try {
        body = await readJson(request);
      } catch {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }
      const state = await store.read();
      const workbook = state.workbooks.find((entry) => entry.id === workbookId);
      const worksheet = workbook?.worksheets.find((entry) => entry.id === worksheetId);
      if (!worksheet) {
        sendNotFound(response);
        return true;
      }
      let name;
      if (body.name !== undefined) {
        name = normalizeWorksheetName(body.name);
        if (name === null) {
          sendJson(response, 422, { error: WORKSHEET_NAME_REQUIRED });
          return true;
        }
        if (isWorksheetNameTaken(workbook.worksheets, name, worksheetId)) {
          sendJson(response, 422, { error: WORKSHEET_NAME_DUPLICATE });
          return true;
        }
      }
      let selection;
      if (body.selection !== undefined) {
        selection = normalizeSelection(body.selection, worksheet);
        if (selection === null) {
          sendJson(response, 400, { error: "Invalid selection" });
          return true;
        }
      }
      await store.update((draft) => {
        const targetWorkbook = draft.workbooks.find((entry) => entry.id === workbookId);
        const target = targetWorkbook?.worksheets.find((entry) => entry.id === worksheetId);
        if (!targetWorkbook || !target) return;
        if (name !== undefined) target.name = name;
        if (selection !== undefined) target.selection = selection;
        if (name !== undefined) targetWorkbook.updatedAt = new Date().toISOString();
      });
      const updated = await store.read();
      const updatedWorkbook = updated.workbooks.find((entry) => entry.id === workbookId);
      sendJson(response, 200, {
        worksheet: updatedWorkbook?.worksheets.find((entry) => entry.id === worksheetId),
        workbook: updatedWorkbook,
        history: historyFlags(workbookId),
      });
      return true;
    }

    const historyMatch = pathname.match(/^\/api\/workbooks\/([^/]+)\/(undo|redo)$/);
    if (historyMatch) {
      const workbookId = decodeURIComponent(historyMatch[1]);
      const action = historyMatch[2];
      if (method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" });
        return true;
      }
      const state = await store.read();
      const workbook = state.workbooks.find((entry) => entry.id === workbookId);
      if (!workbook) {
        sendNotFound(response);
        return true;
      }
      const restored =
        action === "undo" ? history.undo(workbookId, workbook) : history.redo(workbookId, workbook);
      if (restored) {
        // Restoring is content-only: the worksheet the user is looking at stays
        // open, and the restored workbook becomes the stored state.
        const activeWorksheetId = workbook.activeWorksheetId;
        const next = {
          ...restored,
          activeWorksheetId: restored.worksheets.some((entry) => entry.id === activeWorksheetId)
            ? activeWorksheetId
            : restored.activeWorksheetId,
          updatedAt: new Date().toISOString(),
        };
        await store.update((draft) => {
          const index = draft.workbooks.findIndex((entry) => entry.id === workbookId);
          if (index >= 0) draft.workbooks[index] = next;
        });
      }
      const updated = await store.read();
      sendJson(response, 200, {
        workbook: updated.workbooks.find((entry) => entry.id === workbookId),
        history: historyFlags(workbookId),
      });
      return true;
    }

    const workbookMatch = pathname.match(/^\/api\/workbooks\/([^/]+)$/);
    if (workbookMatch) {
      const workbookId = decodeURIComponent(workbookMatch[1]);
      if (method === "GET") {
        const state = await store.read();
        const workbook = state.workbooks.find((entry) => entry.id === workbookId);
        if (!workbook) {
          sendNotFound(response);
          return true;
        }
        sendJson(response, 200, { workbook, history: historyFlags(workbookId) });
        return true;
      }
      if (method === "PATCH") {
        let body;
        try {
          body = await readJson(request);
        } catch {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }
        let name;
        if (body.name !== undefined) {
          name = normalizeWorkbookName(body.name);
          if (name === null) {
            sendJson(response, 422, { error: "Workbook name cannot be empty" });
            return true;
          }
        }
        const state = await store.read();
        const existing = state.workbooks.find((entry) => entry.id === workbookId);
        if (!existing) {
          sendNotFound(response);
          return true;
        }
        let activeWorksheetId;
        if (body.activeWorksheetId !== undefined) {
          const found = existing.worksheets.some((entry) => entry.id === body.activeWorksheetId);
          if (!found) {
            sendJson(response, 400, { error: "Unknown worksheet" });
            return true;
          }
          activeWorksheetId = body.activeWorksheetId;
        }
        await store.update((draft) => {
          const workbook = draft.workbooks.find((entry) => entry.id === workbookId);
          if (!workbook) return;
          if (name !== undefined) workbook.name = name;
          if (activeWorksheetId !== undefined) workbook.activeWorksheetId = activeWorksheetId;
          workbook.updatedAt = new Date().toISOString();
        });
        const updated = await store.read();
        sendJson(response, 200, {
          workbook: updated.workbooks.find((entry) => entry.id === workbookId),
          history: historyFlags(workbookId),
        });
        return true;
      }
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }

    return false;
  };
}
