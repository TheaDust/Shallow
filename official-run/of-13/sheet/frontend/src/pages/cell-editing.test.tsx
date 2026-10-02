import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import type { WorkbookState, WorksheetState } from "../domain/workbook";

const SEED_UPDATED_AT = "2026-03-14T09:32:00.000Z";
const WORKBOOK_ID = "wb-q3-sales";
const SHEET1 = "wb-q3-sales-sheet-1";
const SHEET2 = "wb-q3-sales-sheet-2";

function seedWorkbook(): WorkbookState {
  return {
    id: WORKBOOK_ID,
    name: "Q3 Sales",
    createdAt: SEED_UPDATED_AT,
    updatedAt: SEED_UPDATED_AT,
    activeSheetId: SHEET1,
    sheets: [
      {
        id: SHEET1,
        name: "Sheet1",
        cells: { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" },
        values: { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" },
      },
      { id: SHEET2, name: "Sheet2", cells: {}, values: {} },
    ],
  };
}

/** Minimal two-operand evaluator so the fake server can answer with recalculated values. */
function recalculated(cells: Record<string, string>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [address, raw] of Object.entries(cells)) {
    if (!raw.startsWith("=")) {
      values[address] = raw;
      continue;
    }
    const match = /^=([A-Z]+\d+)([+*])([A-Z]+\d+)$/.exec(raw);
    if (!match) {
      values[address] = "#ERROR!";
      continue;
    }
    const left = Number(cells[match[1]] ?? 0);
    const right = Number(cells[match[3]] ?? 0);
    values[address] = String(match[2] === "+" ? left + right : left * right);
  }
  return values;
}

interface FakeApiOptions {
  /** HTTP status returned by a cell commit. */
  cellStatus?: number;
  /** HTTP status returned by a paste. */
  pasteStatus?: number;
  /** Error text returned by a refused paste. */
  pasteError?: string;
}

function installFakeApi(options: FakeApiOptions = {}) {
  const workbooks = [seedWorkbook()];
  const calls: { method: string; path: string; body: unknown }[] = [];

  const json = (status: number, payload: unknown) => ({
    ok: status < 400,
    status,
    headers: { get: () => "application/json" },
    // The real server serializes the workbook, so every response is a fresh object graph.
    json: async () => JSON.parse(JSON.stringify(payload)) as unknown,
    text: async () => JSON.stringify(payload),
  });

  const findSheet = (workbook: WorkbookState, sheetId: string): WorksheetState | undefined =>
    workbook.sheets.find((sheet) => sheet.id === sheetId);

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path, body });

    if (path === "/api/workbooks" && method === "GET") {
      return json(200, {
        workbooks: workbooks.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })),
      });
    }

    const cellMatch = /^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/cells\/([^/]+)$/.exec(path);
    if (cellMatch) {
      const workbook = workbooks.find((entry) => entry.id === cellMatch[1]);
      const sheet = workbook && findSheet(workbook, cellMatch[2]);
      if (!workbook || !sheet) return json(404, { error: "Worksheet not found" });
      if (options.cellStatus && options.cellStatus >= 400) {
        return json(options.cellStatus, { error: "Please enter a number from 0 to 100" });
      }
      const address = decodeURIComponent(cellMatch[3]).toUpperCase();
      const value = String((body as { value?: unknown })?.value ?? "");
      if (value === "") delete sheet.cells[address];
      else sheet.cells[address] = value;
      sheet.values = recalculated(sheet.cells);
      workbook.updatedAt = "2026-04-01T10:00:00.000Z";
      return json(200, { workbook });
    }

    const pasteMatch = /^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/paste$/.exec(path);
    if (pasteMatch) {
      const workbook = workbooks.find((entry) => entry.id === pasteMatch[1]);
      const sheet = workbook && findSheet(workbook, pasteMatch[2]);
      if (!workbook || !sheet) return json(404, { error: "Worksheet not found" });
      if (options.pasteStatus && options.pasteStatus >= 400) {
        return json(options.pasteStatus, { error: options.pasteError ?? "Unable to paste" });
      }
      const start = String((body as { start?: unknown })?.start ?? "");
      const text = String((body as { text?: unknown })?.text ?? "");
      const origin = /^([A-Z]+)(\d+)$/.exec(start.toUpperCase());
      const columnOffset = origin ? origin[1].charCodeAt(0) - 65 : 0;
      const rowOffset = origin ? Number(origin[2]) - 1 : 0;
      text.split("\n").forEach((line, row) => {
        line.split("\t").forEach((field, column) => {
          const address = `${String.fromCharCode(65 + columnOffset + column)}${rowOffset + row + 1}`;
          if (field === "") delete sheet.cells[address];
          else sheet.cells[address] = field;
        });
      });
      sheet.values = recalculated(sheet.cells);
      workbook.updatedAt = "2026-04-01T10:00:00.000Z";
      return json(200, { workbook });
    }

    const sheetMatch = /^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)$/.exec(path);
    if (sheetMatch && method === "PATCH") {
      const workbook = workbooks.find((entry) => entry.id === sheetMatch[1]);
      const sheet = workbook && findSheet(workbook, sheetMatch[2]);
      if (!workbook || !sheet) return json(404, { error: "Worksheet not found" });
      const patch = body as { name?: string; selection?: { start: string; end: string } };
      if (patch?.name) sheet.name = patch.name;
      if (patch?.selection) sheet.selection = patch.selection;
      return json(200, { workbook });
    }

    const workbookMatch = /^\/api\/workbooks\/([^/]+)$/.exec(path);
    if (workbookMatch) {
      const workbook = workbooks.find((entry) => entry.id === workbookMatch[1]);
      if (!workbook) return json(404, { error: "Workbook not found" });
      if (method === "PATCH") {
        const patch = body as { activeSheetId?: string };
        if (patch?.activeSheetId) workbook.activeSheetId = patch.activeSheetId;
      }
      return json(200, { workbook });
    }

    return json(404, { error: "Not found" });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { workbooks, calls };
}

async function openEditor() {
  window.location.hash = `#/workbooks/${WORKBOOK_ID}`;
  const view = render(<App />);
  await screen.findByRole("grid", { name: "Worksheet grid" });
  return view;
}

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function cell(address: string) {
  return within(grid()).getByRole("gridcell", { name: address });
}

function formulaBar() {
  return screen.getByLabelText("Formula bar") as HTMLInputElement;
}

function dragSelect(from: string, to: string) {
  fireEvent.mouseDown(cell(from), { button: 0 });
  fireEvent.mouseEnter(cell(to));
  fireEvent.mouseUp(document.body);
}

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (navigator as unknown as Record<string, unknown>).clipboard;
  window.location.hash = "#/";
});

describe("editing a cell through the grid or the formula bar", () => {
  it("commits text typed in the Formula bar with Enter and keeps grid and bar consistent", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    await openEditor();

    await user.click(cell("D1"));
    expect(formulaBar().value).toBe("");
    await user.type(formulaBar(), "East");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(cell("D1").textContent).toBe("East"));
    expect(formulaBar().value).toBe("East");
    const commit = api.calls.find((call) => call.method === "PUT");
    expect(commit?.path).toBe(`/api/workbooks/${WORKBOOK_ID}/sheets/${SHEET1}/cells/D1`);
    expect(commit?.body).toEqual({ value: "East" });
    expect(cell("D1").getAttribute("aria-selected")).toBe("true");
  });

  it("opens an inline text box named Edit <cell coordinate> on double click and commits with Enter", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    await openEditor();

    await user.dblClick(cell("D2"));
    const editor = await screen.findByRole("textbox", { name: "Edit D2" });
    await user.type(editor, "North");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(cell("D2").textContent).toBe("North"));
    expect(api.calls.find((call) => call.method === "PUT")?.body).toEqual({ value: "North" });
    expect(screen.queryByRole("textbox", { name: "Edit D2" })).toBeNull();
  });

  it("cancels an uncommitted change with Escape and keeps the last successful value", async () => {    const api = installFakeApi();
    const user = userEvent.setup();
    await openEditor();

    await user.dblClick(cell("A1"));
    const editor = await screen.findByRole("textbox", { name: "Edit A1" });
    await user.clear(editor);
    await user.type(editor, "Discarded");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("textbox", { name: "Edit A1" })).toBeNull();
    expect(cell("A1").textContent).toBe("Region");
    await user.click(cell("A1"));
    expect(formulaBar().value).toBe("Region");
    expect(api.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("starts an inline edit with the typed character while the grid has focus", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    await openEditor();

    await user.click(cell("D1"));
    expect(document.activeElement).toBe(grid());
    await user.keyboard("Q");

    const editor = await screen.findByRole("textbox", { name: "Edit D1" });
    expect((editor as HTMLInputElement).value).toBe("Q");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(cell("D1").textContent).toBe("Q"));
    expect(api.calls.find((call) => call.method === "PUT")?.body).toEqual({ value: "Q" });
  });

  it("cancels an uncommitted formula bar change with Escape", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    await openEditor();

    await user.click(cell("B2"));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "999");
    await user.keyboard("{Escape}");

    expect(formulaBar().value).toBe("1200");
    expect(cell("B2").textContent).toBe("1200");
    expect(api.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("commits the open edit when another cell is clicked", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    await openEditor();

    await user.dblClick(cell("D1"));
    const editor = await screen.findByRole("textbox", { name: "Edit D1" });
    await user.type(editor, "Item/Qty");
    await user.click(cell("E2"));

    await waitFor(() => expect(cell("D1").textContent).toBe("Item/Qty"));
    expect(cell("E2").getAttribute("aria-selected")).toBe("true");
    expect(api.calls.find((call) => call.method === "PUT")?.body).toEqual({ value: "Item/Qty" });
  });

  it("shows the calculated result in the grid and the original formula in the formula bar", async () => {
    const api = installFakeApi();
    api.workbooks[0].sheets[0].cells.C1 = "=B2+B3";
    api.workbooks[0].sheets[0].values = recalculated(api.workbooks[0].sheets[0].cells);

    const user = userEvent.setup();
    await openEditor();

    await user.click(cell("C1"));
    expect(cell("C1").textContent).toBe("2000");
    expect(formulaBar().value).toBe("=B2+B3");

    // Committing a new source value updates the dependent result shown in the grid.
    await user.click(cell("B3"));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "100");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(cell("C1").textContent).toBe("1300"));
    await user.click(cell("C1"));
    expect(formulaBar().value).toBe("=B2+B3");
  });

  it("keeps the last successful value and shows the error when a commit is rejected", async () => {
    installFakeApi({ cellStatus: 400 });
    const user = userEvent.setup();
    await openEditor();

    await user.click(cell("A1"));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "101");
    await user.keyboard("{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Please enter a number from 0 to 100");
    expect(cell("A1").textContent).toBe("Region");
    expect(formulaBar().value).toBe("Region");
    expect(cell("B2").textContent).toBe("1200");
  });
});

describe("pasting tab separated rows into a worksheet", () => {
  it("applies the whole pasted rectangle from the selected starting cell", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    await openEditor();

    await user.click(cell("D1"));
    const notPrevented = fireEvent.paste(grid(), {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? "East\t1200\nNorth\t800" : ""),
      },
    });

    await waitFor(() => expect(cell("D1").textContent).toBe("East"));
    expect(notPrevented).toBe(false);
    expect(cell("E1").textContent).toBe("1200");
    expect(cell("D2").textContent).toBe("North");
    expect(cell("E2").textContent).toBe("800");
    expect(cell("A1").textContent).toBe("Region");
    expect(cell("B2").textContent).toBe("1200");

    const paste = api.calls.find((call) => call.method === "POST");
    expect(paste?.path).toBe(`/api/workbooks/${WORKBOOK_ID}/sheets/${SHEET1}/paste`);
    expect(paste?.body).toEqual({ start: "D1", text: "East\t1200\nNorth\t800" });
  });

  it("offers a Paste menuitem in the grid context menu that pastes the clipboard", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    const readText = vi.fn(async () => "South\t700");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText },
    });
    await openEditor();

    fireEvent.contextMenu(cell("D1"));
    const menuItem = await screen.findByRole("menuitem", { name: "Paste" });
    await user.click(menuItem);

    await waitFor(() => expect(cell("D1").textContent).toBe("South"));
    expect(readText).toHaveBeenCalled();
    expect(cell("E1").textContent).toBe("700");
    expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({
      start: "D1",
      text: "South\t700",
    });
  });

  it("shows the rejection message and keeps every target cell when a paste is refused", async () => {
    installFakeApi({ pasteStatus: 400, pasteError: "Please enter a number from 0 to 100" });
    const user = userEvent.setup();
    await openEditor();

    await user.click(cell("D1"));
    fireEvent.paste(grid(), { clipboardData: { getData: () => "1\t101" } });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Please enter a number from 0 to 100");
    expect(cell("D1").textContent).toBe("");
    expect(cell("E1").textContent).toBe("");
  });

  it("keeps the pasted values when the workbook is reopened", async () => {
    installFakeApi();
    const user = userEvent.setup();
    await openEditor();

    await user.click(cell("D1"));
    fireEvent.paste(grid(), { clipboardData: { getData: () => "East\t1200" } });
    await waitFor(() => expect(cell("E1").textContent).toBe("1200"));

    window.location.hash = "#/";
    window.location.hash = `#/workbooks/${WORKBOOK_ID}`;
    await waitFor(() => expect(cell("E1").textContent).toBe("1200"));
  });
});

describe("selecting a rectangular range", () => {
  it("selects a single cell and marks exactly that gridcell as selected", async () => {
    installFakeApi();
    const user = userEvent.setup();
    await openEditor();

    await user.click(cell("B2"));
    expect(cell("B2").getAttribute("aria-selected")).toBe("true");
    expect(cell("A1").getAttribute("aria-selected")).toBe("false");
    expect(cell("B3").getAttribute("aria-selected")).toBe("false");
    expect(grid().getAttribute("aria-multiselectable")).toBe("true");
  });

  it("drags from one corner to the opposite one and persists the whole rectangle", async () => {
    const api = installFakeApi();
    await openEditor();

    dragSelect("D1", "E2");

    expect(cell("D1").getAttribute("aria-selected")).toBe("true");
    expect(cell("E1").getAttribute("aria-selected")).toBe("true");
    expect(cell("D2").getAttribute("aria-selected")).toBe("true");
    expect(cell("E2").getAttribute("aria-selected")).toBe("true");
    expect(cell("A1").getAttribute("aria-selected")).toBe("false");
    expect(cell("E3").getAttribute("aria-selected")).toBe("false");

    await waitFor(() => {
      const saved = api.calls.find(
        (call) => call.method === "PATCH" && String(call.path).endsWith(`/sheets/${SHEET1}`),
      );
      expect(saved?.body).toEqual({ selection: { start: "D1", end: "E2" } });
    });
  });

  it("restores the saved rectangle of the active worksheet when the workbook is reopened", async () => {
    const api = installFakeApi();
    api.workbooks[0].sheets[0].selection = { start: "D1", end: "E2" };
    await openEditor();

    expect(cell("D1").getAttribute("aria-selected")).toBe("true");
    expect(cell("E2").getAttribute("aria-selected")).toBe("true");
    expect(cell("A1").getAttribute("aria-selected")).toBe("false");
    expect(cell("E3").getAttribute("aria-selected")).toBe("false");
  });

  it("replaces the previous selection and keeps one rectangle per worksheet", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    await openEditor();

    dragSelect("D1", "E2");
    await waitFor(() =>
      expect(api.workbooks[0].sheets[0].selection).toEqual({ start: "D1", end: "E2" }),
    );

    await user.click(cell("A1"));
    expect(cell("A1").getAttribute("aria-selected")).toBe("true");
    expect(cell("D1").getAttribute("aria-selected")).toBe("false");
    expect(cell("E2").getAttribute("aria-selected")).toBe("false");

    // Switching worksheets shows the other worksheet's own rectangle and restores this one.
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(cell("A1").getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(cell("A1").getAttribute("aria-selected")).toBe("true"));
    expect(cell("D1").getAttribute("aria-selected")).toBe("false");
  });
});
