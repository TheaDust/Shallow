import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { readJson, sendJson } from "./lib/http.mjs";
import { DomainError } from "./lib/workbooks.mjs";
import { createWorkbookService } from "./lib/service.mjs";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
]);

const routes = [
  { method: "GET", pattern: /^\/api\/workbooks$/, handle: (service) => service.list() },
  { method: "POST", pattern: /^\/api\/workbooks$/, handle: (service, _params, body) => service.create(body) },
  { method: "POST", pattern: /^\/api\/workbooks\/import$/, handle: (service, _params, body) => service.importCsv(body) },
  { method: "GET", pattern: /^\/api\/workbooks\/([^/]+)$/, handle: (service, [id]) => service.get(id) },
  { method: "PATCH", pattern: /^\/api\/workbooks\/([^/]+)$/, handle: (service, [id], body) => service.rename(id, body) },
  {
    method: "POST",
    pattern: /^\/api\/workbooks\/([^/]+)\/worksheets$/,
    handle: (service, [id]) => service.addWorksheet(id),
  },
  {
    method: "PATCH",
    pattern: /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)$/,
    handle: (service, [id, worksheetId], body) => service.renameWorksheet(id, worksheetId, body),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)$/,
    handle: (service, [id, worksheetId]) => service.deleteWorksheet(id, worksheetId),
  },
  { method: "PUT", pattern: /^\/api\/workbooks\/([^/]+)\/cells$/, handle: (service, [id], body) => service.setCell(id, body) },
  { method: "PUT", pattern: /^\/api\/workbooks\/([^/]+)\/active-worksheet$/, handle: (service, [id], body) => service.setActiveWorksheet(id, body) },
  { method: "PUT", pattern: /^\/api\/workbooks\/([^/]+)\/paste$/, handle: (service, [id], body) => service.paste(id, body) },
  {
    method: "POST",
    pattern: /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/range-transfer$/,
    handle: (service, [id, worksheetId], body) => service.transferRange(id, worksheetId, body),
  },
  { method: "POST", pattern: /^\/api\/workbooks\/([^/]+)\/undo$/, handle: (service, [id]) => service.undo(id) },
  { method: "POST", pattern: /^\/api\/workbooks\/([^/]+)\/redo$/, handle: (service, [id]) => service.redo(id) },
  {
    method: "POST",
    pattern: /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/rows$/,
    handle: (service, [id, worksheetId], body) => service.changeRows(id, worksheetId, body),
  },
  {
    method: "POST",
    pattern: /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/columns$/,
    handle: (service, [id, worksheetId], body) => service.changeColumns(id, worksheetId, body),
  },
  {
    method: "POST",
    pattern: /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/sort-range$/,
    handle: (service, [id, worksheetId], body) => service.sortRange(id, worksheetId, body),
  },
  {
    method: "PUT",
    pattern: /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/selection$/,
    handle: (service, [id, worksheetId], body) => service.setSelection(id, worksheetId, body),
  },
  {
    method: "POST",
    pattern: /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/pivot$/,
    handle: (service, [id, worksheetId], body) => service.createPivot(id, worksheetId, body),
  },
  {
    method: "PUT",
    pattern: /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/pivot$/,
    handle: (service, [id, worksheetId], body) => service.applyPivot(id, worksheetId, body),
  },
  {
    method: "POST",
    pattern: /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/pivot\/refresh$/,
    handle: (service, [id, worksheetId]) => service.refreshPivot(id, worksheetId),
  },
  {
    method: "POST",
    pattern: /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/filters$/,
    handle: (service, [id, worksheetId], body) => service.createFilter(id, worksheetId, body),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/filters$/,
    handle: (service, [id, worksheetId]) => service.clearFilter(id, worksheetId),
  },
  {
    method: "PUT",
    pattern: /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/filters\/([^/]+)\/columns\/([^/]+)$/,
    handle: (service, [id, worksheetId, filterId, column], body) =>
      service.setColumnFilter(id, worksheetId, { ...body, filterId, column }),
  },
  {
    method: "POST",
    pattern: /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/validations$/,
    handle: (service, [id, worksheetId], body) => service.saveValidation(id, worksheetId, body),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/validations\/([^/]+)$/,
    handle: (service, [id, worksheetId, ruleId]) => service.deleteValidation(id, worksheetId, { ruleId }),
  },
];

export function createRequestHandler({ store, staticRoot }) {
  const service = createWorkbookService(store);

  async function handleApi(request, url) {
    const method = request.method ?? "GET";
    const matching = routes
      .map((route) => ({ route, match: route.pattern.exec(url.pathname) }))
      .filter(({ match }) => match !== null);
    if (!matching.length) return null;
    const exact = matching.find(({ route }) => route.method === method);
    if (!exact) return { status: 405, body: { error: "Method not allowed" } };
    const params = exact.match.slice(1).map((value) => decodeURIComponent(value));
    const body = method === "GET" ? {} : await readJson(request);
    const result = await exact.route.handle(service, params, body);
    return { status: result.status ?? 200, body: result.body };
  }

  async function handleStatic(request, response, url) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!relative || relative.includes("..")) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    try {
      const content = await readFile(join(staticRoot, relative));
      response.writeHead(200, {
        "content-type": contentTypes.get(extname(relative)) ?? "application/octet-stream",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "EISDIR") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      throw error;
    }
  }

  return function handler(request, response) {
    void (async () => {
      try {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname === "/health" || url.pathname === "/api/health") {
          sendJson(response, 200, { ok: true });
          return;
        }
        if (url.pathname.startsWith("/api/")) {
          const result = await handleApi(request, url);
          if (!result) {
            sendJson(response, 404, { error: "Not found" });
            return;
          }
          sendJson(response, result.status, result.body);
          return;
        }
        await handleStatic(request, response, url);
      } catch (error) {
        if (error instanceof DomainError) {
          sendJson(response, error.status, { error: error.message });
          return;
        }
        if (error instanceof SyntaxError) {
          sendJson(response, 400, { error: "Invalid JSON request body" });
          return;
        }
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  };
}
