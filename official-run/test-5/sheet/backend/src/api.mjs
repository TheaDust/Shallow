import { sendJson, sendText, readJson } from "./lib/http.mjs";
import { CsvParseError, parseCsv, toCsv } from "./lib/csv.mjs";
import { applyCellUpdates } from "./domain/cells.mjs";
import { isValidCellAddress } from "./domain/coordinates.mjs";
import { normalizeFilter } from "./domain/filtering.mjs";
import { createWorkbookHistory, NOTHING_TO_REDO_MESSAGE, NOTHING_TO_UNDO_MESSAGE } from "./domain/history.mjs";
import { transferUpdates } from "./domain/transfer.mjs";
import { normalizeValidations } from "./domain/validation.mjs";
import {
  INVALID_COLUMN_MESSAGE,
  INVALID_ROW_MESSAGE,
  applyColumnOperation,
  applyRowOperation,
  normalizeColumnIndex,
  normalizeRowIndex,
} from "./domain/structure.mjs";
import {
  DEFAULT_WORKBOOK_NAME,
  LONG_WORKBOOK_NAME_MESSAGE,
  MAX_WORKBOOK_NAME_LENGTH,
  addWorksheet,
  createBlankWorkbook,
  createWorkbookFromRows,
  csvFileName,
  findWorkbook,
  normalizeWorkbookName,
  renameWorksheet,
  toWorkbookPayload,
  toWorkbookSummary,
  workbookNameFromFileName,
  worksheetToRows,
} from "./domain/workbooks.mjs";

export const INVALID_CSV_MESSAGE = "Invalid CSV file format. Import failed.";

function contentDisposition(fileName) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  const encoded = encodeURIComponent(fileName).replace(/'/g, "%27");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

class ApiFailure extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiFailure";
    this.status = status;
  }
}

function sortedSummaries(state) {
  return state.workbooks
    .map(toWorkbookSummary)
    .sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1;
      if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
      return left.name.localeCompare(right.name);
    });
}

async function readBody(request, response) {
  try {
    return await readJson(request);
  } catch {
    sendJson(response, 400, { error: "Invalid request body" });
    return null;
  }
}

/** Answers with a workbook payload: stored state plus the derived grid values. */
function sendWorkbook(response, status, workbook, history) {
  sendJson(response, status, {
    workbook: toWorkbookPayload(workbook, {
      canUndo: history ? history.canUndo(workbook.id) : false,
      canRedo: history ? history.canRedo(workbook.id) : false,
    }),
  });
}

/**
 * Applies `mutate` to the stored workbook inside the store transaction; the
 * mutation and the write succeed together or the write is skipped entirely.
 */
function updateWorkbook(store, workbookId, mutate) {
  let updated = null;
  return store
    .update((draft) => {
      const workbook = findWorkbook(draft, workbookId);
      if (!workbook) throw new ApiFailure(404, "Workbook not found");
      mutate(workbook);
      updated = workbook;
      return draft;
    })
    .then(() => updated);
}

/**
 * Handles every /api/workbooks request. Returns false when the request does not
 * match a known workbook route so the caller can answer with 404/405.
 */
export function createApiHandler(store) {
  /** Undo/redo history of this session, shared by every route of the handler. */
  const history = createWorkbookHistory();

  /** Sends a workbook together with the undo/redo availability of the session. */
  function sendBook(response, status, workbook) {
    sendWorkbook(response, status, workbook, history);
  }

  /**
   * Runs a mutation that changes the undoable state. The snapshot is taken
   * before the change and recorded only once the mutation succeeded, so a
   * rejected operation leaves the history untouched.
   */
  function updateRecorded(workbookId, mutate) {
    return updateWorkbook(store, workbookId, (workbook) => {
      const entry = history.capture(workbook);
      mutate(workbook);
      history.push(workbook.id, entry);
    });
  }

  async function handleWorkbooks(request, response, segments) {
    const rest = segments.slice(2);

    if (rest.length === 0) {
      if (request.method === "GET") {
        sendJson(response, 200, { workbooks: sortedSummaries(await store.read()) });
        return true;
      }
      if (request.method === "POST") {
        const body = await readBody(request, response);
        if (!body) return true;
        const requested = typeof body.name === "string" ? body.name.trim() : "";
        if (requested.length > MAX_WORKBOOK_NAME_LENGTH) {
          sendJson(response, 400, { error: LONG_WORKBOOK_NAME_MESSAGE });
          return true;
        }
        const workbook = createBlankWorkbook(requested === "" ? DEFAULT_WORKBOOK_NAME : requested);
        await store.update((draft) => {
          draft.workbooks.push(workbook);
        });
        sendBook(response, 201, workbook);
        return true;
      }
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }

    if (rest.length === 1 && rest[0] === "import" && request.method === "POST") {
      const body = await readBody(request, response);
      if (!body) return true;
      if (typeof body.content !== "string") {
        sendJson(response, 400, { error: INVALID_CSV_MESSAGE });
        return true;
      }
      let rows;
      try {
        rows = parseCsv(body.content);
      } catch (error) {
        if (error instanceof CsvParseError) {
          sendJson(response, 400, { error: INVALID_CSV_MESSAGE });
          return true;
        }
        throw error;
      }
      const workbook = createWorkbookFromRows(workbookNameFromFileName(body.fileName), rows);
      await store.update((draft) => {
        draft.workbooks.push(workbook);
      });
      sendBook(response, 201, workbook);
      return true;
    }

    if (rest.length === 1 && request.method === "GET") {
      const state = await store.read();
      const workbook = findWorkbook(state, rest[0]);
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendBook(response, 200, workbook);
      return true;
    }

    if (rest.length === 1 && request.method === "PATCH") {
      const body = await readBody(request, response);
      if (!body) return true;
      const hasName = typeof body.name !== "undefined";
      const hasActiveWorksheet = typeof body.activeWorksheetId !== "undefined";
      if (!hasName && !hasActiveWorksheet) {
        sendJson(response, 400, { error: "Nothing to update" });
        return true;
      }
      let name = null;
      if (hasName) {
        const normalized = normalizeWorkbookName(body.name);
        if (!normalized.ok) {
          sendJson(response, 400, { error: normalized.error });
          return true;
        }
        name = normalized.name;
      }
      const worksheetId = body.activeWorksheetId;
      if (hasActiveWorksheet && typeof worksheetId !== "string") {
        sendJson(response, 400, { error: "Unknown worksheet" });
        return true;
      }
      const workbook = await updateWorkbook(store, rest[0], (found) => {
        if (hasActiveWorksheet && !found.worksheets.some((sheet) => sheet.id === worksheetId)) {
          throw new ApiFailure(400, "Unknown worksheet");
        }
        if (hasName) {
          found.name = name;
          found.updatedAt = new Date().toISOString();
        }
        if (hasActiveWorksheet) found.activeWorksheetId = worksheetId;
      });
      sendBook(response, 200, workbook);
      return true;
    }

    if (rest.length === 2 && rest[1] === "worksheets" && request.method === "POST") {
      const workbook = await updateWorkbook(store, rest[0], (found) => {
        addWorksheet(found);
        found.updatedAt = new Date().toISOString();
      });
      sendBook(response, 201, workbook);
      return true;
    }

    if (rest.length === 2 && (rest[1] === "undo" || rest[1] === "redo") && request.method === "POST") {
      const undo = rest[1] === "undo";
      const workbook = await updateWorkbook(store, rest[0], (found) => {
        const restored = undo ? history.undo(found) : history.redo(found);
        if (!restored) throw new ApiFailure(400, undo ? NOTHING_TO_UNDO_MESSAGE : NOTHING_TO_REDO_MESSAGE);
        found.updatedAt = new Date().toISOString();
      });
      sendBook(response, 200, workbook);
      return true;
    }

    if (rest.length === 4 && rest[1] === "worksheets" && rest[3] === "export" && request.method === "GET") {
      const state = await store.read();
      const workbook = findWorkbook(state, rest[0]);
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      const worksheet = workbook.worksheets.find((sheet) => sheet.id === rest[2]);
      if (!worksheet) {
        sendJson(response, 404, { error: "Worksheet not found" });
        return true;
      }
      sendText(response, 200, toCsv(worksheetToRows(worksheet)), {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": contentDisposition(csvFileName(workbook.name, worksheet.name)),
        "cache-control": "no-store",
      });
      return true;
    }

    if (
      rest.length === 4
      && rest[1] === "worksheets"
      && (rest[3] === "rows" || rest[3] === "columns")
      && request.method === "POST"
    ) {
      const axis = rest[3] === "rows" ? "row" : "column";
      const body = await readBody(request, response);
      if (!body) return true;
      const operation = typeof body.op === "string" ? body.op : "";
      const index = axis === "row" ? normalizeRowIndex(body.row) : normalizeColumnIndex(body.column);
      if (index === null) {
        sendJson(response, 400, { error: axis === "row" ? INVALID_ROW_MESSAGE : INVALID_COLUMN_MESSAGE });
        return true;
      }
      const workbook = await updateRecorded(rest[0], (found) => {
        const worksheet = found.worksheets.find((sheet) => sheet.id === rest[2]);
        if (!worksheet) throw new ApiFailure(404, "Worksheet not found");
        const result = axis === "row"
          ? applyRowOperation(worksheet, operation, index)
          : applyColumnOperation(worksheet, operation, index);
        if (!result.ok) throw new ApiFailure(400, result.error);
        found.updatedAt = new Date().toISOString();
      });
      sendBook(response, 200, workbook);
      return true;
    }

    // Copy/cut a rectangle of the active worksheet and place it elsewhere; the
    // whole transfer (target cells plus a cleared source) is one cell write.
    if (rest.length === 4 && rest[1] === "worksheets" && rest[3] === "range-transfer" && request.method === "POST") {
      const body = await readBody(request, response);
      if (!body) return true;
      const workbook = await updateRecorded(rest[0], (found) => {
        const worksheet = found.worksheets.find((sheet) => sheet.id === rest[2]);
        if (!worksheet) throw new ApiFailure(404, "Worksheet not found");
        const transfer = transferUpdates(worksheet, body);
        if (!transfer.ok) throw new ApiFailure(400, transfer.error);
        const result = applyCellUpdates(worksheet, transfer.updates);
        if (!result.ok) throw new ApiFailure(400, result.error);
        found.updatedAt = new Date().toISOString();
      });
      sendBook(response, 200, workbook);
      return true;
    }

    if (rest.length === 4 && rest[1] === "worksheets" && rest[3] === "cells" && request.method === "POST") {
      const body = await readBody(request, response);
      if (!body) return true;
      const updates = typeof body.updates === "undefined" ? {} : body.updates;
      const workbook = await updateRecorded(rest[0], (found) => {
        const worksheet = found.worksheets.find((sheet) => sheet.id === rest[2]);
        if (!worksheet) throw new ApiFailure(404, "Worksheet not found");
        const result = applyCellUpdates(worksheet, updates);
        if (!result.ok) throw new ApiFailure(400, result.error);
        found.updatedAt = new Date().toISOString();
      });
      sendBook(response, 200, workbook);
      return true;
    }

    if (rest.length === 3 && rest[1] === "worksheets" && request.method === "PATCH") {
      const body = await readBody(request, response);
      if (!body) return true;
      const hasName = typeof body.name !== "undefined";
      const hasActiveCell = typeof body.activeCell !== "undefined";
      const hasSelectionFocus = typeof body.selectionFocus !== "undefined";
      const hasValidations = typeof body.validations !== "undefined";
      const hasFilter = typeof body.filter !== "undefined";
      if (!hasName && !hasActiveCell && !hasSelectionFocus && !hasValidations && !hasFilter) {
        sendJson(response, 400, { error: "Nothing to update" });
        return true;
      }
      const activeCell = hasActiveCell && typeof body.activeCell === "string"
        ? body.activeCell.trim().toUpperCase()
        : "";
      if (hasActiveCell && !isValidCellAddress(activeCell)) {
        sendJson(response, 400, { error: "Invalid cell address" });
        return true;
      }
      const selectionFocus = hasSelectionFocus && typeof body.selectionFocus === "string"
        ? body.selectionFocus.trim().toUpperCase()
        : "";
      if (hasSelectionFocus && !isValidCellAddress(selectionFocus)) {
        sendJson(response, 400, { error: "Invalid cell address" });
        return true;
      }
      let rules = null;
      if (hasValidations) {
        const normalized = normalizeValidations(body.validations);
        if (!normalized.ok) {
          sendJson(response, 400, { error: normalized.error });
          return true;
        }
        rules = normalized.rules;
      }
      let filter = null;
      if (hasFilter) {
        const normalized = normalizeFilter(body.filter);
        if (!normalized.ok) {
          sendJson(response, 400, { error: normalized.error });
          return true;
        }
        filter = normalized.filter;
      }
      // A filter is part of the undoable state (cells, rules, filter); the other
      // fields of this route keep their own behaviour.
      const mutate = (found) => {
        const worksheet = found.worksheets.find((sheet) => sheet.id === rest[2]);
        if (!worksheet) throw new ApiFailure(404, "Worksheet not found");
        if (hasName) {
          const renamed = renameWorksheet(found, worksheet, body.name);
          if (!renamed.ok) throw new ApiFailure(400, renamed.error);
          found.updatedAt = new Date().toISOString();
        }
        if (hasValidations) {
          worksheet.validations = rules;
          found.updatedAt = new Date().toISOString();
        }
        if (hasFilter) {
          worksheet.filter = filter;
          found.updatedAt = new Date().toISOString();
        }
        if (hasActiveCell) {
          worksheet.activeCell = activeCell;
          if (!hasSelectionFocus) worksheet.selectionFocus = activeCell;
        }
        if (hasSelectionFocus) worksheet.selectionFocus = selectionFocus;
      };
      const workbook = hasFilter
        ? await updateRecorded(rest[0], mutate)
        : await updateWorkbook(store, rest[0], mutate);
      sendBook(response, 200, workbook);
      return true;
    }

    return false;
  }

  return async function handleApi(request, response, url) {
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] !== "api" || segments[1] !== "workbooks") return false;
    try {
      return await handleWorkbooks(request, response, segments);
    } catch (error) {
      if (error instanceof ApiFailure) {
        sendJson(response, error.status, { error: error.message });
        return true;
      }
      throw error;
    }
  };
}
