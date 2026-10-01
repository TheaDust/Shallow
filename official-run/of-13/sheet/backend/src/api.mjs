import { readJson, sendJson } from "./lib/http.mjs";
import { cellAddress, parseAddress } from "./domain/address.mjs";
import { setCellValue } from "./domain/cells.mjs";
import { INVALID_CSV_MESSAGE, parseCsv } from "./domain/csv.mjs";
import { applyPaste } from "./domain/paste.mjs";
import {
  createBlankWorkbook,
  createImportedWorkbook,
  DEFAULT_WORKBOOK_NAME,
  findWorkbook,
  normalizeWorkbookName,
  serializeWorkbook,
  summarizeWorkbook,
} from "./domain/workbooks.mjs";
import {
  adjacentWorksheetId,
  createBlankWorksheet,
  isPivotSource,
  isWorksheetNameTaken,
  normalizeWorksheetName,
  WORKSHEET_LAST_REMAINING_MESSAGE,
  WORKSHEET_NAME_DUPLICATE_MESSAGE,
  WORKSHEET_NAME_EMPTY_MESSAGE,
  WORKSHEET_PIVOT_DEPENDENCY_MESSAGE,
} from "./domain/worksheets.mjs";
import { applyColumnOperation, applyRowOperation, sheetColumnCount, sheetRowCount } from "./domain/structure.mjs";
import {
  computePivotCells,
  createPivotWorksheet,
  normalizePivotConfig,
  normalizePivotRange,
  PIVOT_CONFIG_INVALID_MESSAGE,
  PIVOT_RANGE_INVALID_MESSAGE,
  shiftPivotSourceRange,
} from "./domain/pivot.mjs";
import { applyRangeTransfer } from "./domain/range-transfer.mjs";
import { sortWorksheetRange } from "./domain/sort.mjs";
import { FILTER_INVALID_MESSAGE, normalizeFilter } from "./domain/filter.mjs";
import {
  normalizeValidationRule,
  replaceWorksheetState,
  WORKSHEET_STATE_VALIDATIONS_MESSAGE,
} from "./domain/worksheet-state.mjs";

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

const INVALID_SELECTION_MESSAGE = "Invalid cell selection";

/** Normalizes a submitted `{ start, end }` selection, or returns null when it is unusable. */
function normalizeSelection(selection) {
  if (!selection || typeof selection !== "object") return null;
  const start = parseAddress(typeof selection.start === "string" ? selection.start : "");
  const end = parseAddress(typeof selection.end === "string" ? selection.end : "");
  if (!start || !end) return null;
  return {
    start: cellAddress(start.row, start.column),
    end: cellAddress(end.row, end.column),
  };
}

/**
 * Handles every `/api/**` request. Returns true when the request was handled so the
 * caller never falls through to static file resolution for API paths.
 */
export function createApiHandler({ store }) {
  return async function handleApi(request, response, url) {
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] !== "api") return false;
    const method = request.method ?? "GET";

    if (segments.length === 2 && segments[1] === "health" && method === "GET") {
      sendJson(response, 200, { ok: true });
      return true;
    }

    if (segments.length === 2 && segments[1] === "workbooks") {
      if (method === "GET") {
        const state = await store.read();
        sendJson(response, 200, { workbooks: state.workbooks.map(summarizeWorkbook) });
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
        const name = normalizeWorkbookName(body?.name) || DEFAULT_WORKBOOK_NAME;
        const workbook = createBlankWorkbook({ name });
        await store.update((state) => {
          state.workbooks.push(workbook);
        });
        sendJson(response, 201, { workbook: serializeWorkbook(workbook) });
        return true;
      }
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }

    // `POST /api/workbooks/import` creates the workbook described by an uploaded CSV file.
    // Nothing is written when the CSV cannot be parsed, so no partial import survives.
    if (segments.length === 3 && segments[1] === "workbooks" && segments[2] === "import") {
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
      const content = typeof body?.content === "string" ? body.content : null;
      const parsed = content === null ? null : parseCsv(content);
      if (!parsed || !parsed.ok) {
        sendJson(response, 400, { error: INVALID_CSV_MESSAGE });
        return true;
      }
      const workbook = createImportedWorkbook({ fileName: body?.fileName, rows: parsed.rows });
      await store.update((state) => {
        state.workbooks.push(workbook);
      });
      sendJson(response, 201, { workbook: serializeWorkbook(workbook) });
      return true;
    }

    // `POST /api/workbooks/:id/pivots` creates the pivot-result worksheet of a source range:
    // `{ sourceSheetId, sourceRange }`. The new worksheet is named after the first unused
    // `PivotN`, holds the pending configuration and no summary yet, and becomes active. The
    // source worksheet is only read, so its cells and order stay untouched.
    if (segments.length === 4 && segments[1] === "workbooks" && segments[3] === "pivots") {
      if (method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" });
        return true;
      }
      const id = decodeURIComponent(segments[2]);
      let body;
      try {
        body = await readJson(request);
      } catch {
        sendJson(response, 400, { error: "Invalid request body" });
        return true;
      }

      const sourceRange = normalizePivotRange(body?.sourceRange);
      if (!sourceRange) {
        sendJson(response, 400, { error: PIVOT_RANGE_INVALID_MESSAGE });
        return true;
      }

      let failure = null;
      let created = null;
      const state = await store.update((draft) => {
        const workbook = findWorkbook(draft, id);
        if (!workbook) {
          failure = { status: 404, error: "Workbook not found" };
          return draft;
        }
        const source = workbook.sheets.find((sheet) => sheet.id === body?.sourceSheetId);
        if (!source) {
          failure = { status: 400, error: "Worksheet not found" };
          return draft;
        }
        created = createPivotWorksheet({
          sheets: workbook.sheets,
          sourceSheetId: source.id,
          sourceRange,
        });
        workbook.sheets.push(created);
        workbook.activeSheetId = created.id;
        workbook.updatedAt = new Date().toISOString();
        return draft;
      });

      if (failure) {
        sendJson(response, failure.status, { error: failure.error });
        return true;
      }
      const workbook = findWorkbook(state, id);
      sendJson(response, 201, {
        workbook: serializeWorkbook(workbook),
        worksheet: workbook.sheets.find((sheet) => sheet.id === created.id),
      });
      return true;
    }

    // Worksheet lifecycle inside one workbook:
    // Worksheet lifecycle inside one workbook:
    // `POST /api/workbooks/:id/sheets` adds a blank worksheet and activates it,
    // `PATCH /api/workbooks/:id/sheets/:sheetId` renames an existing worksheet,
    // `DELETE /api/workbooks/:id/sheets/:sheetId` removes it and its whole state.
    if (segments.length >= 4 && segments[1] === "workbooks" && segments[3] === "sheets") {
      const id = decodeURIComponent(segments[2]);

      if (segments.length === 4 && method === "POST") {
        let failure = null;
        const state = await store.update((draft) => {
          const workbook = findWorkbook(draft, id);
          if (!workbook) {
            failure = { status: 404, error: "Workbook not found" };
            return draft;
          }
          const worksheet = createBlankWorksheet(workbook.sheets);
          workbook.sheets.push(worksheet);
          workbook.activeSheetId = worksheet.id;
          workbook.updatedAt = new Date().toISOString();
          return draft;
        });
        if (failure) {
          sendJson(response, failure.status, { error: failure.error });
          return true;
        }
        const workbook = findWorkbook(state, id);
        sendJson(response, 201, {
          workbook: serializeWorkbook(workbook),
          worksheet: workbook.sheets.at(-1),
        });
        return true;
      }

      if (segments.length === 5 && method === "PATCH") {
        const sheetId = decodeURIComponent(segments[4]);
        let body;
        try {
          body = await readJson(request);
        } catch {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }

        let failure = null;
        const state = await store.update((draft) => {
          const workbook = findWorkbook(draft, id);
          if (!workbook) {
            failure = { status: 404, error: "Workbook not found" };
            return draft;
          }
          const worksheet = workbook.sheets.find((sheet) => sheet.id === sheetId);
          if (!worksheet) {
            failure = { status: 404, error: "Worksheet not found" };
            return draft;
          }
          const wantsName = hasOwn(body ?? {}, "name");
          const wantsSelection = hasOwn(body ?? {}, "selection");
          if (!wantsName && !wantsSelection) {
            failure = { status: 400, error: "No supported fields to update" };
            return draft;
          }
          if (wantsName) {
            const name = normalizeWorksheetName(body?.name);
            if (!name) {
              failure = { status: 400, error: WORKSHEET_NAME_EMPTY_MESSAGE };
              return draft;
            }
            if (isWorksheetNameTaken(workbook.sheets, name, worksheet.id)) {
              failure = { status: 400, error: WORKSHEET_NAME_DUPLICATE_MESSAGE };
              return draft;
            }
            worksheet.name = name;
            workbook.updatedAt = new Date().toISOString();
          }
          if (wantsSelection) {
            const selection = normalizeSelection(body?.selection);
            if (!selection) {
              failure = { status: 400, error: INVALID_SELECTION_MESSAGE };
              return draft;
            }
            // Selection is a view state, not a data change: `updatedAt` stays untouched.
            worksheet.selection = selection;
          }
          return draft;
        });

        if (failure) {
          sendJson(response, failure.status, { error: failure.error });
          return true;
        }
        sendJson(response, 200, { workbook: serializeWorkbook(findWorkbook(state, id)) });
        return true;
      }

      // `DELETE /api/workbooks/:id/sheets/:sheetId` removes one worksheet with its cells,
      // formulas, filters, validation rules and pivot state; an adjacent worksheet becomes
      // active when the removed one was. The last remaining worksheet cannot be removed, and a
      // worksheet still used as the source of a pivot table cannot either: both refusals leave
      // the workbook exactly as it was.
      if (segments.length === 5 && method === "DELETE") {
        const sheetId = decodeURIComponent(segments[4]);

        let failure = null;
        const state = await store.update((draft) => {
          const workbook = findWorkbook(draft, id);
          if (!workbook) {
            failure = { status: 404, error: "Workbook not found" };
            return draft;
          }
          const worksheet = workbook.sheets.find((sheet) => sheet.id === sheetId);
          if (!worksheet) {
            failure = { status: 404, error: "Worksheet not found" };
            return draft;
          }
          if (workbook.sheets.length <= 1) {
            failure = { status: 400, error: WORKSHEET_LAST_REMAINING_MESSAGE };
            return draft;
          }
          if (isPivotSource(workbook.sheets, worksheet.id)) {
            failure = { status: 400, error: WORKSHEET_PIVOT_DEPENDENCY_MESSAGE };
            return draft;
          }
          const nextActive = adjacentWorksheetId(workbook.sheets, worksheet.id);
          workbook.sheets = workbook.sheets.filter((sheet) => sheet.id !== worksheet.id);
          if (workbook.activeSheetId === worksheet.id && nextActive) {
            workbook.activeSheetId = nextActive;
          }
          if (!workbook.sheets.some((sheet) => sheet.id === workbook.activeSheetId)) {
            workbook.activeSheetId = workbook.sheets[0].id;
          }
          workbook.updatedAt = new Date().toISOString();
          return draft;
        });

        if (failure) {
          sendJson(response, failure.status, { error: failure.error });
          return true;
        }
        sendJson(response, 200, { workbook: serializeWorkbook(findWorkbook(state, id)) });
        return true;
      }

      // One cell of one worksheet: `PUT /api/workbooks/:id/sheets/:sheetId/cells/:address`
      // with `{ value }`. The write either replaces the cell (recalculating every dependent
      // formula on the next read) or is rejected, leaving the worksheet untouched.
      if (segments.length === 7 && segments[5] === "cells") {
        if (method !== "PUT") {
          sendJson(response, 405, { error: "Method not allowed" });
          return true;
        }
        const sheetId = decodeURIComponent(segments[4]);
        const address = decodeURIComponent(segments[6]);
        let body;
        try {
          body = await readJson(request);
        } catch {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }

        let failure = null;
        const state = await store.update((draft) => {
          const workbook = findWorkbook(draft, id);
          if (!workbook) {
            failure = { status: 404, error: "Workbook not found" };
            return draft;
          }
          const worksheet = workbook.sheets.find((sheet) => sheet.id === sheetId);
          if (!worksheet) {
            failure = { status: 404, error: "Worksheet not found" };
            return draft;
          }
          const result = setCellValue(worksheet, address, body?.value);
          if (!result.ok) {
            failure = { status: 400, error: result.error };
            return draft;
          }
          workbook.updatedAt = new Date().toISOString();
          return draft;
        });

        if (failure) {
          sendJson(response, failure.status, { error: failure.error });
          return true;
        }
        sendJson(response, 200, { workbook: serializeWorkbook(findWorkbook(state, id)) });
        return true;
      }

      // Bulk clipboard paste: `POST /api/workbooks/:id/sheets/:sheetId/paste` with
      // `{ start, text }`. The whole rectangle is validated before anything is written.
      if (segments.length === 6 && segments[5] === "paste") {
        if (method !== "POST") {
          sendJson(response, 405, { error: "Method not allowed" });
          return true;
        }
        const sheetId = decodeURIComponent(segments[4]);
        let body;
        try {
          body = await readJson(request);
        } catch {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }

        let failure = null;
        const state = await store.update((draft) => {
          const workbook = findWorkbook(draft, id);
          if (!workbook) {
            failure = { status: 404, error: "Workbook not found" };
            return draft;
          }
          const worksheet = workbook.sheets.find((sheet) => sheet.id === sheetId);
          if (!worksheet) {
            failure = { status: 404, error: "Worksheet not found" };
            return draft;
          }
          const result = applyPaste(worksheet, { start: body?.start, text: body?.text });
          if (!result.ok) {
            failure = { status: 400, error: result.error };
            return draft;
          }
          workbook.updatedAt = new Date().toISOString();
          return draft;
        });

        if (failure) {
          sendJson(response, failure.status, { error: failure.error });
          return true;
        }
        sendJson(response, 200, { workbook: serializeWorkbook(findWorkbook(state, id)) });
        return true;
      }

      // Copy/cut + paste of one rectangular selection inside the active worksheet:
      // `POST /api/workbooks/:id/sheets/:sheetId/range-transfer` with
      // `{ source: { start, end }, target: { start, end }, mode: "copy" | "cut" }`.
      // The whole transfer is validated before a cell is written, so a rejected request
      // leaves both rectangles in their original state.
      if (segments.length === 6 && segments[5] === "range-transfer") {
        if (method !== "POST") {
          sendJson(response, 405, { error: "Method not allowed" });
          return true;
        }
        const sheetId = decodeURIComponent(segments[4]);
        let body;
        try {
          body = await readJson(request);
        } catch {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }

        let failure = null;
        const state = await store.update((draft) => {
          const workbook = findWorkbook(draft, id);
          if (!workbook) {
            failure = { status: 404, error: "Workbook not found" };
            return draft;
          }
          const worksheet = workbook.sheets.find((sheet) => sheet.id === sheetId);
          if (!worksheet) {
            failure = { status: 404, error: "Worksheet not found" };
            return draft;
          }
          const result = applyRangeTransfer(worksheet, body ?? {});
          if (!result.ok) {
            failure = { status: 400, error: result.error };
            return draft;
          }
          workbook.updatedAt = new Date().toISOString();
          return draft;
        });

        if (failure) {
          sendJson(response, failure.status, { error: failure.error });
          return true;
        }
        sendJson(response, 200, { workbook: serializeWorkbook(findWorkbook(state, id)) });
        return true;
      }

      // Restoring one worksheet's stored state (cells, formula text, grid size, rules):
      // `PUT /api/workbooks/:id/sheets/:sheetId/state`. Undo/redo uses it to put the whole
      // worksheet back; an unusable payload changes nothing.
      if (segments.length === 6 && segments[5] === "state") {
        if (method !== "PUT") {
          sendJson(response, 405, { error: "Method not allowed" });
          return true;
        }
        const sheetId = decodeURIComponent(segments[4]);
        let body;
        try {
          body = await readJson(request);
        } catch {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }

        let failure = null;
        const state = await store.update((draft) => {
          const workbook = findWorkbook(draft, id);
          if (!workbook) {
            failure = { status: 404, error: "Workbook not found" };
            return draft;
          }
          const worksheet = workbook.sheets.find((sheet) => sheet.id === sheetId);
          if (!worksheet) {
            failure = { status: 404, error: "Worksheet not found" };
            return draft;
          }
          const result = replaceWorksheetState(worksheet, body);
          if (!result.ok) {
            failure = { status: 400, error: result.error };
            return draft;
          }
          workbook.updatedAt = new Date().toISOString();
          return draft;
        });

        if (failure) {
          sendJson(response, failure.status, { error: failure.error });
          return true;
        }
        sendJson(response, 200, { workbook: serializeWorkbook(findWorkbook(state, id)) });
        return true;
      }

      // Sorting one rectangular range of a worksheet:
      // `POST /api/workbooks/:id/sheets/:sheetId/sort` with
      // `{ range, column, order, hasHeader }`. `domain/sort.mjs` validates the range, the column
      // inside it and the direction, then moves every record of the data rows (header row on
      // top) together with the formulas they carry; a rejected request leaves the sheet as it
      // was, so the grid keeps its previous order. Filter and validation ranges are not touched.
      if (segments.length === 6 && segments[5] === "sort") {
        if (method !== "POST") {
          sendJson(response, 405, { error: "Method not allowed" });
          return true;
        }
        const sheetId = decodeURIComponent(segments[4]);
        let body;
        try {
          body = await readJson(request);
        } catch {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }

        let failure = null;
        const state = await store.update((draft) => {
          const workbook = findWorkbook(draft, id);
          if (!workbook) {
            failure = { status: 404, error: "Workbook not found" };
            return draft;
          }
          const worksheet = workbook.sheets.find((sheet) => sheet.id === sheetId);
          if (!worksheet) {
            failure = { status: 404, error: "Worksheet not found" };
            return draft;
          }
          const result = sortWorksheetRange(worksheet, body ?? {});
          if (!result.ok) {
            failure = { status: 400, error: result.error };
            return draft;
          }
          workbook.updatedAt = new Date().toISOString();
          return draft;
        });

        if (failure) {
          sendJson(response, failure.status, { error: failure.error });
          return true;
        }
        sendJson(response, 200, { workbook: serializeWorkbook(findWorkbook(state, id)) });
        return true;
      }

      // Pivot table of one worksheet: `PUT .../pivot` with the chosen fields
      // (`{ rowField, columnField, valueField, method }`) recomputes the summary and stores the
      // configuration with it, `POST .../pivot/refresh` recomputes it from the stored fields and
      // the current source range. Both only write the pivot worksheet: an unusable source range
      // or a deleted header is refused and leaves the last successful summary and the source
      // worksheet untouched.
      if (
        (segments.length === 6 && segments[5] === "pivot") ||
        (segments.length === 7 && segments[5] === "pivot" && segments[6] === "refresh")
      ) {
        const refreshing = segments.length === 7;
        if ((!refreshing && method !== "PUT") || (refreshing && method !== "POST")) {
          sendJson(response, 405, { error: "Method not allowed" });
          return true;
        }
        const sheetId = decodeURIComponent(segments[4]);
        let body = null;
        if (!refreshing) {
          try {
            body = await readJson(request);
          } catch {
            sendJson(response, 400, { error: "Invalid request body" });
            return true;
          }
          if (!normalizePivotConfig(body)) {
            sendJson(response, 400, { error: PIVOT_CONFIG_INVALID_MESSAGE });
            return true;
          }
        }

        let failure = null;
        const state = await store.update((draft) => {
          const workbook = findWorkbook(draft, id);
          if (!workbook) {
            failure = { status: 404, error: "Workbook not found" };
            return draft;
          }
          const worksheet = workbook.sheets.find((sheet) => sheet.id === sheetId);
          if (!worksheet) {
            failure = { status: 404, error: "Worksheet not found" };
            return draft;
          }
          if (!worksheet.pivot) {
            failure = { status: 400, error: "This worksheet is not a pivot table" };
            return draft;
          }
          const config = refreshing ? normalizePivotConfig(worksheet.pivot) : normalizePivotConfig(body);
          const source = workbook.sheets.find((entry) => entry.id === worksheet.pivot.sourceSheetId);
          const result = computePivotCells({
            sourceSheet: source,
            config: { ...worksheet.pivot, ...config },
          });
          if (!result.ok) {
            failure = { status: 400, error: result.error };
            return draft;
          }
          worksheet.pivot = { ...worksheet.pivot, ...config };
          worksheet.cells = result.cells;
          workbook.updatedAt = new Date().toISOString();
          return draft;
        });

        if (failure) {
          sendJson(response, failure.status, { error: failure.error });
          return true;
        }
        sendJson(response, 200, { workbook: serializeWorkbook(findWorkbook(state, id)) });
        return true;
      }

      // Filter view of one worksheet: `PUT /api/workbooks/:id/sheets/:sheetId/filter` with
      // `{ filter: null | { range, columns } }`. The definition is stored on the worksheet and
      // every response derives the hidden row numbers from it, so data is never modified —
      // hidden rows keep their values and stay part of CSV exports and pivot sources.
      if (segments.length === 6 && segments[5] === "filter") {
        if (method !== "PUT") {
          sendJson(response, 405, { error: "Method not allowed" });
          return true;
        }
        const sheetId = decodeURIComponent(segments[4]);
        let body;
        try {
          body = await readJson(request);
        } catch {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }

        let failure = null;
        const state = await store.update((draft) => {
          const workbook = findWorkbook(draft, id);
          if (!workbook) {
            failure = { status: 404, error: "Workbook not found" };
            return draft;
          }
          const worksheet = workbook.sheets.find((sheet) => sheet.id === sheetId);
          if (!worksheet) {
            failure = { status: 404, error: "Worksheet not found" };
            return draft;
          }
          if (!hasOwn(body ?? {}, "filter")) {
            failure = { status: 400, error: FILTER_INVALID_MESSAGE };
            return draft;
          }
          if (body.filter === null) {
            delete worksheet.filter;
          } else {
            const result = normalizeFilter(body.filter);
            if (!result.ok) {
              failure = { status: 400, error: result.error };
              return draft;
            }
            worksheet.filter = result.filter;
          }
          // A filter is a view state, like the selection: `updatedAt` stays untouched.
          return draft;
        });

        if (failure) {
          sendJson(response, failure.status, { error: failure.error });
          return true;
        }
        sendJson(response, 200, { workbook: serializeWorkbook(findWorkbook(state, id)) });
        return true;
      }

      // Data-validation rules of one worksheet: `PUT /api/workbooks/:id/sheets/:sheetId/validations`
      // with `{ validations: [{ range, type, min?, max?, values? }] }` replacing the whole list,
      // so saving, modifying and deleting a rule are one atomic write.
      if (segments.length === 6 && segments[5] === "validations") {
        if (method !== "PUT") {
          sendJson(response, 405, { error: "Method not allowed" });
          return true;
        }
        const sheetId = decodeURIComponent(segments[4]);
        let body;
        try {
          body = await readJson(request);
        } catch {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }

        let failure = null;
        const state = await store.update((draft) => {
          const workbook = findWorkbook(draft, id);
          if (!workbook) {
            failure = { status: 404, error: "Workbook not found" };
            return draft;
          }
          const worksheet = workbook.sheets.find((sheet) => sheet.id === sheetId);
          if (!worksheet) {
            failure = { status: 404, error: "Worksheet not found" };
            return draft;
          }
          if (!Array.isArray(body?.validations)) {
            failure = { status: 400, error: WORKSHEET_STATE_VALIDATIONS_MESSAGE };
            return draft;
          }
          const rules = [];
          for (const rule of body.validations) {
            const normalized = normalizeValidationRule(rule);
            if (!normalized) {
              failure = { status: 400, error: WORKSHEET_STATE_VALIDATIONS_MESSAGE };
              return draft;
            }
            const existing = rules.findIndex((item) => item.id === normalized.id);
            if (existing >= 0) rules[existing] = normalized;
            else rules.push(normalized);
          }
          worksheet.validations = rules;
          workbook.updatedAt = new Date().toISOString();
          return draft;
        });

        if (failure) {
          sendJson(response, failure.status, { error: failure.error });
          return true;
        }
        sendJson(response, 200, { workbook: serializeWorkbook(findWorkbook(state, id)) });
        return true;
      }

      // Row/column structure of one worksheet:
      // `POST /api/workbooks/:id/sheets/:sheetId/rows` with `{ action, row }` and
      // `POST /api/workbooks/:id/sheets/:sheetId/columns` with `{ action, column }`.
      // The whole shift happens inside one serialized store update, so a rejected request
      // never leaves a partially moved worksheet behind.
      if (segments.length === 6 && (segments[5] === "rows" || segments[5] === "columns")) {
        if (method !== "POST") {
          sendJson(response, 405, { error: "Method not allowed" });
          return true;
        }
        const sheetId = decodeURIComponent(segments[4]);
        let body;
        try {
          body = await readJson(request);
        } catch {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }
        const operation = segments[5] === "rows" ? applyRowOperation : applyColumnOperation;

        let failure = null;
        const state = await store.update((draft) => {
          const workbook = findWorkbook(draft, id);
          if (!workbook) {
            failure = { status: 404, error: "Workbook not found" };
            return draft;
          }
          const worksheet = workbook.sheets.find((sheet) => sheet.id === sheetId);
          if (!worksheet) {
            failure = { status: 404, error: "Worksheet not found" };
            return draft;
          }
          const result = operation(worksheet, body ?? {});
          if (!result.ok) {
            failure = { status: 400, error: result.error };
            return draft;
          }
          // Pivot tables that read this worksheet keep their last summary but follow the
          // adjusted source range, so the next `Refresh pivot table` uses the moved data.
          const change = {
            axis: segments[5] === "rows" ? "row" : "column",
            action: body?.action,
            index: segments[5] === "rows" ? body?.row : body?.column,
          };
          for (const sheet of workbook.sheets) {
            if (sheet.pivot && sheet.pivot.sourceSheetId === worksheet.id) {
              sheet.pivot = {
                ...sheet.pivot,
                sourceRange: shiftPivotSourceRange(sheet.pivot.sourceRange, change),
              };
            }
          }
          if (worksheet.selection) {
            const start = parseAddress(worksheet.selection.start);
            const end = parseAddress(worksheet.selection.end);
            const limitRow = sheetRowCount(worksheet);
            const limitColumn = sheetColumnCount(worksheet);
            const clamp = (position) =>
              cellAddress(
                Math.min(position.row, limitRow - 1),
                Math.min(position.column, limitColumn - 1),
              );
            if (start && end) worksheet.selection = { start: clamp(start), end: clamp(end) };
          }
          workbook.updatedAt = new Date().toISOString();
          return draft;
        });

        if (failure) {
          sendJson(response, failure.status, { error: failure.error });
          return true;
        }
        sendJson(response, 200, { workbook: serializeWorkbook(findWorkbook(state, id)) });
        return true;
      }

      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }

    if (segments.length === 3 && segments[1] === "workbooks") {
      const id = decodeURIComponent(segments[2]);

      if (method === "GET") {
        const state = await store.read();
        const workbook = findWorkbook(state, id);
        if (!workbook) {
          sendJson(response, 404, { error: "Workbook not found" });
          return true;
        }
        sendJson(response, 200, { workbook: serializeWorkbook(workbook) });
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
        if (!body || typeof body !== "object") {
          sendJson(response, 400, { error: "Invalid request body" });
          return true;
        }

        let failure = null;
        const state = await store.update((draft) => {
          const workbook = findWorkbook(draft, id);
          if (!workbook) {
            failure = { status: 404, error: "Workbook not found" };
            return draft;
          }
          if (!hasOwn(body, "name") && !hasOwn(body, "activeSheetId")) {
            failure = { status: 400, error: "No supported fields to update" };
            return draft;
          }
          if (hasOwn(body, "name")) {
            const name = normalizeWorkbookName(body.name);
            if (!name) {
              failure = { status: 400, error: "Workbook name cannot be empty" };
              return draft;
            }
            workbook.name = name;
            workbook.updatedAt = new Date().toISOString();
          }
          if (hasOwn(body, "activeSheetId")) {
            if (!workbook.sheets.some((sheet) => sheet.id === body.activeSheetId)) {
              failure = { status: 400, error: "Unknown worksheet" };
              return draft;
            }
            workbook.activeSheetId = body.activeSheetId;
          }
          return draft;
        });

        if (failure) {
          sendJson(response, failure.status, { error: failure.error });
          return true;
        }
        sendJson(response, 200, { workbook: serializeWorkbook(findWorkbook(state, id)) });
        return true;
      }

      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }

    sendJson(response, 404, { error: "Not found" });
    return true;
  };
}
