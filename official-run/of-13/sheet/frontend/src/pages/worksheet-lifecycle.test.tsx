import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import type { WorkbookState, WorksheetState } from "../domain/workbook";

const SEED_UPDATED_AT = "2026-03-14T09:32:00.000Z";
const RENAMED_AT = "2026-04-01T10:00:00.000Z";

function seedSheets(): WorksheetState[] {
  return [
    {
      id: "wb-q3-sales-sheet-1",
      name: "Sheet1",
      cells: { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" },
    },
    { id: "wb-q3-sales-sheet-2", name: "Sheet2", cells: {} },
  ];
}

function seedWorkbook(): WorkbookState {
  return {
    id: "wb-q3-sales",
    name: "Q3 Sales",
    createdAt: SEED_UPDATED_AT,
    updatedAt: SEED_UPDATED_AT,
    activeSheetId: "wb-q3-sales-sheet-1",
    sheets: seedSheets(),
  };
}

interface SheetCall {
  method: string;
  path: string;
  body: unknown;
}

function installFakeApi(options: { addStatus?: number } = {}) {
  const workbook = seedWorkbook();
  const calls: SheetCall[] = [];
  let nextSheetNumber = 3;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });

    const json = (status: number, payload: unknown) => ({
      ok: status < 400,
      status,
      headers: { get: () => "application/json" },
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    });

    if (path === "/api/workbooks" && method === "GET") {
      return json(200, {
        workbooks: [
          { id: workbook.id, name: workbook.name, updatedAt: workbook.updatedAt },
        ],
      });
    }

    if (path === "/api/workbooks/wb-q3-sales/sheets" && method === "POST") {
      if (options.addStatus && options.addStatus >= 400) {
        return json(options.addStatus, { error: "Unable to add worksheet" });
      }
      const created: WorksheetState = {
        id: `wb-q3-sales-sheet-${nextSheetNumber}`,
        name: `Sheet${nextSheetNumber}`,
        cells: {},
      };
      nextSheetNumber += 1;
      workbook.sheets.push(created);
      workbook.activeSheetId = created.id;
      workbook.updatedAt = RENAMED_AT;
      return json(201, { workbook, worksheet: created });
    }

    const sheetMatch = /^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)$/.exec(path);
    if (sheetMatch) {
      const sheet = workbook.sheets.find((entry) => entry.id === decodeURIComponent(sheetMatch[2]));
      if (!sheet) return json(404, { error: "Worksheet not found" });
      if (method === "PATCH") {
        const name = String((body as { name?: string }).name ?? "").trim();
        if (!name) return json(400, { error: "Worksheet name cannot be empty" });
        const taken = workbook.sheets.some(
          (entry) => entry.id !== sheet.id && entry.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (taken) return json(400, { error: "Worksheet name already exists" });
        sheet.name = name;
        workbook.updatedAt = RENAMED_AT;
        return json(200, { workbook });
      }
      return json(405, { error: "Method not allowed" });
    }

    const workbookMatch = /^\/api\/workbooks\/([^/]+)$/.exec(path);
    if (workbookMatch) {
      if (method === "PATCH") {
        const patch = body as { activeSheetId?: string };
        if (patch.activeSheetId && workbook.sheets.some((sheet) => sheet.id === patch.activeSheetId)) {
          workbook.activeSheetId = patch.activeSheetId;
        }
        return json(200, { workbook });
      }
      return json(200, { workbook });
    }

    return json(404, { error: "Not found" });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { workbook, calls };
}

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

function tabNames(): string[] {
  return screen.getAllByRole("tab").map((tab) => tab.textContent ?? "");
}

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "#/";
});

describe("REQ-2-1-1 add a worksheet", () => {
  it("adds a blank SheetN tab, activates it and selects A1", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    renderAt("#/workbooks/wb-q3-sales");

    const grid = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");

    const tabBar = await screen.findByRole("tablist", { name: "Worksheets" });
    await user.click(within(tabBar).getByRole("button", { name: "Add worksheet" }));

    const newTab = await screen.findByRole("tab", { name: "Sheet3" });
    expect(newTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("false");
    await waitFor(() => expect(tabNames()).toEqual(["Sheet1", "Sheet2", "Sheet3"]));

    const newGrid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(newGrid).getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");
    expect(within(newGrid).getByRole("gridcell", { name: "A1" }).textContent).toBe("");
    expect(within(newGrid).getByRole("gridcell", { name: "A2" }).textContent).toBe("");

    expect(api.calls.some((call) => call.method === "POST" && call.path === "/api/workbooks/wb-q3-sales/sheets")).toBe(true);
    expect(api.calls.some((call) => call.method === "PATCH" || call.path.includes("/sheets/"))).toBe(false);
  });

  it("keeps the added worksheet after reopening the editor", async () => {
    installFakeApi();
    const user = userEvent.setup();
    const first = renderAt("#/workbooks/wb-q3-sales");
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));
    await screen.findByRole("tab", { name: "Sheet3" });

    first.unmount();
    renderAt("#/workbooks/wb-q3-sales");

    await screen.findByRole("tab", { name: "Sheet3" });
    expect(tabNames()).toEqual(["Sheet1", "Sheet2", "Sheet3"]);
    expect(screen.getByRole("tab", { name: "Sheet3" }).getAttribute("aria-selected")).toBe("true");
  });

  it("shows an error and no new tab when adding fails", async () => {
    installFakeApi({ addStatus: 500 });
    const user = userEvent.setup();
    renderAt("#/workbooks/wb-q3-sales");
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add worksheet" })).toHaveProperty("disabled", false),
    );
  });
});

describe("REQ-2-1-3 rename a worksheet", () => {
  async function openRenameDialog(user: ReturnType<typeof userEvent.setup>, sheetName: string) {
    await user.click(screen.getByRole("button", { name: `Worksheet options for ${sheetName}` }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    return screen.findByRole("dialog", { name: "Rename worksheet" });
  }

  it("opens the tab menu with a Rename menuitem and prefills the current name", async () => {
    installFakeApi();
    const user = userEvent.setup();
    renderAt("#/workbooks/wb-q3-sales");
    await screen.findByRole("grid", { name: "Worksheet grid" });

    const trigger = screen.getByRole("button", { name: "Worksheet options for Sheet2" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));

    const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
    expect((within(dialog).getByLabelText("Worksheet name") as HTMLInputElement).value).toBe("Sheet2");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("renames the worksheet after trimming the name and keeps it after reopening", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    const view = renderAt("#/workbooks/wb-q3-sales");
    await screen.findByRole("grid", { name: "Worksheet grid" });

    const dialog = await openRenameDialog(user, "Sheet1");
    const input = within(dialog).getByLabelText("Worksheet name");
    await user.clear(input);
    await user.type(input, "  Q3 Revenue  ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tabNames()).toEqual(["Q3 Revenue", "Sheet2"]);
    expect(screen.getByRole("tab", { name: "Q3 Revenue" }).getAttribute("aria-selected")).toBe("true");
    const patch = api.calls.find((call) => call.method === "PATCH" && call.path.includes("/sheets/"));
    expect(patch?.path).toBe("/api/workbooks/wb-q3-sales/sheets/wb-q3-sales-sheet-1");
    expect(patch?.body).toEqual({ name: "Q3 Revenue" });

    // The renamed worksheet keeps the grid data of the worksheet it renamed.
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(within(grid).getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");

    view.unmount();
    renderAt("#/workbooks/wb-q3-sales");
    await screen.findByRole("tab", { name: "Q3 Revenue" });
    expect(tabNames()).toEqual(["Q3 Revenue", "Sheet2"]);
  });

  it("rejects an empty name beside the control and keeps the original name", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    renderAt("#/workbooks/wb-q3-sales");
    await screen.findByRole("grid", { name: "Worksheet grid" });

    const dialog = await openRenameDialog(user, "Sheet1");
    const input = within(dialog).getByLabelText("Worksheet name");
    await user.clear(input);
    await user.type(input, "   ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Worksheet name cannot be empty")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Rename worksheet" })).toBeTruthy();
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);
    expect(api.calls.some((call) => call.method === "PATCH" && call.path.includes("/sheets/"))).toBe(false);
  });

  it("rejects a duplicate name, keeps the original name and keeps the dialog open", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    renderAt("#/workbooks/wb-q3-sales");
    await screen.findByRole("grid", { name: "Worksheet grid" });

    const dialog = await openRenameDialog(user, "Sheet1");
    const input = within(dialog).getByLabelText("Worksheet name");
    await user.clear(input);
    await user.type(input, "Sheet2");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Worksheet name already exists")).toBeTruthy();
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);
    expect(api.calls.some((call) => call.method === "PATCH" && call.path.includes("/sheets/"))).toBe(false);
  });

  it("keeps the name when the same worksheet is saved with its current name", async () => {
    installFakeApi();
    const user = userEvent.setup();
    renderAt("#/workbooks/wb-q3-sales");
    await screen.findByRole("grid", { name: "Worksheet grid" });

    const dialog = await openRenameDialog(user, "Sheet2");
    const input = within(dialog).getByLabelText("Worksheet name");
    await user.clear(input);
    await user.type(input, "Sheet2");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);
  });
});
