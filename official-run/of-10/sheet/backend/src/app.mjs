import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CsvFormatError } from "./lib/csv.mjs";
import { readJson, sendJson } from "./lib/http.mjs";
import { WorkbookError } from "./lib/workbook-store.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const staticRoot = resolve(here, "../../frontend/dist");
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

const WORKBOOK_PATH = /^\/api\/workbooks\/([^/]+)$/;
const CELL_PATH = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/cells\/([^/]+)$/;
const PASTE_PATH = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/paste$/;
const TRANSFER_PATH = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/transfer$/;
const WORKSHEET_PATH = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)$/;
const WORKSHEETS_PATH = /^\/api\/workbooks\/([^/]+)\/worksheets$/;
const HISTORY_PATH = /^\/api\/workbooks\/([^/]+)\/(undo|redo)$/;
const STRUCTURE_PATH = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/structure$/;
const SORT_PATH = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/sort$/;
const VALIDATION_PATH = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/validations$/;
const VALIDATION_RULE_PATH = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/validations\/([^/]+)$/;
const FILTER_PATH = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/filter$/;
const PIVOT_PATH = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/pivot$/;
const PIVOT_REFRESH_PATH = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/pivot\/refresh$/;
const PIVOTS_PATH = /^\/api\/workbooks\/([^/]+)\/pivots$/;

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Every response that carries a workbook also reports whether the session history of that workbook
 * has a change to undo or redo, so the editor toolbar can enable its buttons (REQ-3-2-2).
 */
function workbookPayload(repository, workbook) {
  const { canUndo, canRedo } = repository.historyState(workbook.id);
  return { workbook, canUndo, canRedo };
}

async function readJsonBody(request, response, limitBytes) {
  try {
    return await readJson(request, limitBytes ? { limitBytes } : undefined);
  } catch {
    sendJson(response, 400, { error: "Invalid request body" });
    return null;
  }
}

async function serveStatic(response, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!relative || relative.includes("..")) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  try {
    const content = await readFile(join(staticRoot, relative));
    response.writeHead(200, {
      "content-type": contentTypes.get(extname(relative)) ?? "application/octet-stream",
    });
    response.end(content);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    throw error;
  }
}

async function handleApi(repository, request, response, url, method) {
  const { pathname } = url;

  if (method === "GET" && (pathname === "/health" || pathname === "/api/health")) {
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return false;

  if (pathname === "/api/workbooks") {
    if (method === "GET") {
      sendJson(response, 200, { workbooks: await repository.list() });
      return true;
    }
    if (method === "POST") {
      const body = await readJsonBody(request, response);
      if (body === null) return true;
      const workbook = await repository.create(body.name);
      sendJson(response, 201, workbookPayload(repository, workbook));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  if (pathname === "/api/workbooks/import") {
    if (method === "POST") {
      const body = await readJsonBody(request, response, 8_000_000);
      if (body === null) return true;
      const workbook = await repository.importCsv(body.fileName, body.content);
      sendJson(response, 201, workbookPayload(repository, workbook));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const pasteMatch = PASTE_PATH.exec(pathname);
  if (pasteMatch) {
    if (method === "POST") {
      const body = await readJsonBody(request, response, 8_000_000);
      if (body === null) return true;
      const workbook = await repository.pasteRange(
        decodeSegment(pasteMatch[1]),
        decodeSegment(pasteMatch[2]),
        body.cell,
        body.values,
      );
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendJson(response, 200, workbookPayload(repository, workbook));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const transferMatch = TRANSFER_PATH.exec(pathname);
  if (transferMatch) {
    if (method === "POST") {
      const body = await readJsonBody(request, response, 8_000_000);
      if (body === null) return true;
      const workbook = await repository.transferRange(
        decodeSegment(transferMatch[1]),
        decodeSegment(transferMatch[2]),
        body,
      );
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendJson(response, 200, workbookPayload(repository, workbook));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const historyMatch = HISTORY_PATH.exec(pathname);
  if (historyMatch) {
    if (method === "POST") {
      const id = decodeSegment(historyMatch[1]);
      const workbook =
        historyMatch[2] === "undo" ? await repository.undo(id) : await repository.redo(id);
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendJson(response, 200, workbookPayload(repository, workbook));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const validationRuleMatch = VALIDATION_RULE_PATH.exec(pathname);
  if (validationRuleMatch) {
    if (method === "DELETE") {
      const workbook = await repository.deleteValidation(
        decodeSegment(validationRuleMatch[1]),
        decodeSegment(validationRuleMatch[2]),
        decodeSegment(validationRuleMatch[3]),
      );
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendJson(response, 200, workbookPayload(repository, workbook));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const pivotRefreshMatch = PIVOT_REFRESH_PATH.exec(pathname);
  if (pivotRefreshMatch) {
    if (method === "POST") {
      const workbook = await repository.savePivot(
        decodeSegment(pivotRefreshMatch[1]),
        decodeSegment(pivotRefreshMatch[2]),
        null,
      );
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendJson(response, 200, workbookPayload(repository, workbook));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const pivotMatch = PIVOT_PATH.exec(pathname);
  if (pivotMatch) {
    if (method === "PUT") {
      const body = await readJsonBody(request, response);
      if (body === null) return true;
      const workbook = await repository.savePivot(
        decodeSegment(pivotMatch[1]),
        decodeSegment(pivotMatch[2]),
        body,
      );
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendJson(response, 200, workbookPayload(repository, workbook));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const pivotsMatch = PIVOTS_PATH.exec(pathname);
  if (pivotsMatch) {
    if (method === "POST") {
      const body = await readJsonBody(request, response);
      if (body === null) return true;
      const workbook = await repository.createPivot(decodeSegment(pivotsMatch[1]), body);
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendJson(response, 201, workbookPayload(repository, workbook));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const filterMatch = FILTER_PATH.exec(pathname);
  if (filterMatch) {
    if (method === "PUT" || method === "DELETE") {
      const body = method === "PUT" ? await readJsonBody(request, response) : null;
      if (method === "PUT" && body === null) return true;
      const workbook =
        method === "PUT"
          ? await repository.saveFilter(
              decodeSegment(filterMatch[1]),
              decodeSegment(filterMatch[2]),
              body,
            )
          : await repository.clearFilter(decodeSegment(filterMatch[1]), decodeSegment(filterMatch[2]));
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendJson(response, 200, workbookPayload(repository, workbook));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const structureMatch = STRUCTURE_PATH.exec(pathname);
  if (structureMatch) {
    if (method === "POST") {
      const body = await readJsonBody(request, response);
      if (body === null) return true;
      const workbook = await repository.changeStructure(
        decodeSegment(structureMatch[1]),
        decodeSegment(structureMatch[2]),
        body,
      );
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendJson(response, 200, workbookPayload(repository, workbook));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const sortMatch = SORT_PATH.exec(pathname);
  if (sortMatch) {
    if (method === "POST") {
      const body = await readJsonBody(request, response);
      if (body === null) return true;
      const workbook = await repository.sortRange(
        decodeSegment(sortMatch[1]),
        decodeSegment(sortMatch[2]),
        body,
      );
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendJson(response, 200, workbookPayload(repository, workbook));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const validationMatch = VALIDATION_PATH.exec(pathname);
  if (validationMatch) {
    if (method === "PUT") {
      const body = await readJsonBody(request, response);
      if (body === null) return true;
      const workbook = await repository.saveValidation(
        decodeSegment(validationMatch[1]),
        decodeSegment(validationMatch[2]),
        body,
      );
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendJson(response, 200, workbookPayload(repository, workbook));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const worksheetsMatch = WORKSHEETS_PATH.exec(pathname);
  if (worksheetsMatch) {
    if (method === "POST") {
      const workbook = await repository.createWorksheet(decodeSegment(worksheetsMatch[1]));
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendJson(response, 201, workbookPayload(repository, workbook));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const worksheetMatch = WORKSHEET_PATH.exec(pathname);
  if (worksheetMatch) {
    if (method === "DELETE") {
      const workbook = await repository.deleteWorksheet(
        decodeSegment(worksheetMatch[1]),
        decodeSegment(worksheetMatch[2]),
      );
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendJson(response, 200, workbookPayload(repository, workbook));
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request, response);
      if (body === null) return true;
      const workbook =
        body.name !== undefined
          ? await repository.renameWorksheet(
              decodeSegment(worksheetMatch[1]),
              decodeSegment(worksheetMatch[2]),
              body.name,
            )
          : await repository.updateWorksheetSelection(
              decodeSegment(worksheetMatch[1]),
              decodeSegment(worksheetMatch[2]),
              body.selection,
            );
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendJson(response, 200, workbookPayload(repository, workbook));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const cellMatch = CELL_PATH.exec(pathname);
  if (cellMatch) {
    if (method === "PUT") {
      const body = await readJsonBody(request, response);
      if (body === null) return true;
      const workbook = await repository.setCell(
        decodeSegment(cellMatch[1]),
        decodeSegment(cellMatch[2]),
        decodeSegment(cellMatch[3]),
        body.value,
      );
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendJson(response, 200, workbookPayload(repository, workbook));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const workbookMatch = WORKBOOK_PATH.exec(pathname);
  if (workbookMatch) {
    const id = decodeSegment(workbookMatch[1]);
    if (method === "GET") {
      const workbook = await repository.get(id);
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendJson(response, 200, workbookPayload(repository, workbook));
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request, response);
      if (body === null) return true;
      const workbook = await repository.update(id, { name: body.name, activeWorksheetId: body.activeWorksheetId });
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return true;
      }
      sendJson(response, 200, workbookPayload(repository, workbook));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  sendJson(response, 404, { error: "Not found" });
  return true;
}

export function createApp(repository) {
  return async function handleRequest(request, response) {
    let url;
    try {
      url = new URL(request.url ?? "/", "http://localhost");
    } catch {
      sendJson(response, 400, { error: "Invalid request URL" });
      return;
    }
    const method = (request.method ?? "GET").toUpperCase();

    try {
      if (await handleApi(repository, request, response, url, method)) return;
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof CsvFormatError) {
        sendJson(response, 400, { error: error.message });
        return;
      }
      if (error instanceof WorkbookError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    try {
      await serveStatic(response, url.pathname);
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}
