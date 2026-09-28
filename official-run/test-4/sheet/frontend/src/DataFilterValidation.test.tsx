import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

interface Sheet {
  id: string;
  name: string;
  cells: Record<string, string>;
  selectedCell: string;
  selectedRange?: { start: string; end: string };
  validationRules: ValidationRule[];
  filter: SheetFilter | null;
}

interface Workbook {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeSheetId: string;
  sheets: Sheet[];
}

interface ValidationRule {
  id: string;
  start: string;
  end: string;
  type: "dropdown" | "number";
  allowed?: string[];
  min?: number;
  max?: number;
}

interface SheetFilter {
  start: string;
  end: string;
  columns: Record<string, { kind: "values"; selected: string[] } | { kind: "condition"; condition: string; value: string }>;
}

let sequence = 0;

function makeWorkbook(): Workbook {
  const now = new Date(2026, 8, 27, 10, 30, 0).toISOString();
  sequence += 1;
  return {
    id: `wb_${sequence}`,
    name: "Q3 Sales",
    createdAt: now,
    updatedAt: now,
    activeSheetId: "s1",
    sheets: [
      {
        id: "s1",
        name: "Sheet1",
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
        selectedCell: "A1",
        selectedRange: { start: "A1", end: "A1" },
        validationRules: [],
        filter: null,
      },
    ],
  };
}

function ruleMessage(rule: ValidationRule): string {
  if (rule.type === "number" && rule.min === 0 && rule.max === 100) {
    return "Please enter a number from 0 to 100";
  }
  if (rule.type === "number") {
    return `Please enter a number between ${rule.min} and ${rule.max}`;
  }
  return `Please select one of the following values: ${rule.allowed?.join(", ") ?? ""}`;
}

function ruleRejects(rule: ValidationRule, value: string): boolean {
  if (value === "") return false;
  if (rule.type === "number") {
    const number = Number(value);
    if (value.trim() === "" || !Number.isFinite(number)) return true;
    return number < (rule.min ?? 0) || number > (rule.max ?? 0);
  }
  return !(rule.allowed ?? []).includes(value);
}

function rangeInside(rule: ValidationRule, coord: string): boolean {
  const parse = (text: string) => {
    const match = /^([A-Z]+)(\d+)$/.exec(text);
    if (!match) return null;
    let col = 0;
    for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    return { row: Number(match[2]), col: col - 1 };
  };
  const from = parse(rule.start);
  const to = parse(rule.end);
  const position = parse(coord);
  if (!from || !to || !position) return false;
  const rowMin = Math.min(from.row, to.row);
  const rowMax = Math.max(from.row, to.row);
  const colMin = Math.min(from.col, to.col);
  const colMax = Math.max(from.col, to.col);
  return position.row >= rowMin && position.row <= rowMax && position.col >= colMin && position.col <= colMax;
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null,
    },
    json: async () => body,
  };
}

function csvResponse(content: string) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? "text/csv; charset=utf-8" : null,
    },
    text: async () => content,
    json: async () => ({}),
  };
}

function fakeCsv(sheet: Sheet): string {
  let maxRow = 1;
  let maxCol = 0;
  for (const coord of Object.keys(sheet.cells)) {
    const match = /^([A-Z]+)(\d+)$/.exec(coord);
    if (!match) continue;
    let col = 0;
    for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    maxRow = Math.max(maxRow, Number(match[2]));
    maxCol = Math.max(maxCol, col - 1);
  }
  const rows: string[][] = [];
  for (let row = 1; row <= maxRow; row += 1) {
    const fields: string[] = [];
    for (let col = 0; col <= maxCol; col += 1) {
      const coord = `${String.fromCharCode(65 + col)}${row}`;
      fields.push(sheet.cells[coord] ?? "");
    }
    rows.push(fields);
  }
  return `${rows.map((row) => row.join(",")).join("\r\n")}\r\n`;
}

function serialize(workbook: Workbook) {
  const clone: Workbook = JSON.parse(JSON.stringify(workbook));
  clone.sheets = clone.sheets.map((sheet) => ({
    ...sheet,
    selectedRange: sheet.selectedRange ?? { start: sheet.selectedCell, end: sheet.selectedCell },
    validationRules: sheet.validationRules ?? [],
    filter: sheet.filter ?? null,
    results: {},
  }));
  return clone;
}

function installFakeBackend(): { store: Workbook[]; fetchMock: ReturnType<typeof vi.fn> } {
  const store: Workbook[] = [makeWorkbook()];
  let ruleSequence = 0;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const segments = url.pathname.split("/").filter(Boolean);
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    if (segments[0] !== "api") return jsonResponse(404, { error: "Not found" });

    if (segments[1] === "workbooks" && segments.length === 2 && method === "GET") {
      return jsonResponse(200, {
        workbooks: store.map((entry) => ({ id: entry.id, name: entry.name, updatedAt: entry.updatedAt })),
      });
    }

    const id = decodeURIComponent(segments[2] ?? "");
    const workbook = store.find((entry) => entry.id === id);
    if (!workbook) return jsonResponse(404, { error: "Workbook not found" });

    if (segments.length === 3 && method === "GET") {
      return jsonResponse(200, serialize(workbook));
    }

    if (segments[3] === "state" && method === "PATCH") {
      const sheet = workbook.sheets.find((entry) => entry.id === body.sheetId);
      if (!sheet) return jsonResponse(400, { error: "Worksheet not found" });
      workbook.activeSheetId = body.sheetId;
      sheet.selectedCell = body.selectedCell;
      if (body.selectedRange && body.selectedRange.start && body.selectedRange.end) {
        sheet.selectedRange = { start: body.selectedRange.start, end: body.selectedRange.end };
      }
      return jsonResponse(200, serialize(workbook));
    }

    if (segments[3] === "filter" && method === "PATCH") {
      const sheet = workbook.sheets.find((entry) => entry.id === body.sheetId);
      if (!sheet) return jsonResponse(400, { error: "Worksheet not found" });
      sheet.filter = body.filter ?? null;
      return jsonResponse(200, serialize(workbook));
    }

    if (segments[3] === "validation") {
      const sheet = workbook.sheets.find((entry) => entry.id === body.sheetId);
      if (!sheet) return jsonResponse(400, { error: "Worksheet not found" });
      if (method === "PATCH") {
        const rules = sheet.validationRules ?? [];
        const existing = body.ruleId
          ? rules.find((entry) => entry.id === body.ruleId)
          : rules.find((entry) => entry.start === body.start && entry.end === body.end);
        if (body.ruleId && !existing) return jsonResponse(400, { error: "Rule not found" });
        const rule: ValidationRule =
          existing ??
          (() => {
            const created: ValidationRule = {
              id: `r_${++ruleSequence}`,
              start: body.start,
              end: body.end,
              type: body.type,
            };
            rules.push(created);
            return created;
          })();
        rule.start = body.start;
        rule.end = body.end;
        rule.type = body.type;
        if (body.type === "dropdown") {
          rule.allowed = body.allowed.map((value: string) => value.trim()).filter((value: string) => value !== "");
          delete rule.min;
          delete rule.max;
        } else {
          rule.min = Number(body.min);
          rule.max = Number(body.max);
          delete rule.allowed;
        }
        sheet.validationRules = rules;
        return jsonResponse(200, serialize(workbook));
      }
      if (method === "DELETE") {
        const before = sheet.validationRules?.length ?? 0;
        sheet.validationRules = (sheet.validationRules ?? []).filter((rule) => rule.id !== body.ruleId);
        if (sheet.validationRules.length === before) return jsonResponse(400, { error: "Rule not found" });
        return jsonResponse(200, serialize(workbook));
      }
      return jsonResponse(404, { error: "Not found" });
    }

    if (segments[3] === "cells" && method === "PATCH") {
      const sheet = workbook.sheets.find((entry) => entry.id === body.sheetId);
      if (!sheet) return jsonResponse(400, { error: "Worksheet not found" });
      for (const [coord, value] of Object.entries(body.updates ?? {}) as [string, string][]) {
        const rule = (sheet.validationRules ?? []).find((entry) => rangeInside(entry, coord));
        if (rule && ruleRejects(rule, value)) {
          return jsonResponse(400, { error: ruleMessage(rule) });
        }
      }
      for (const [coord, value] of Object.entries(body.updates ?? {}) as [string, string][]) {
        sheet.cells[coord] = value;
      }
      return jsonResponse(200, serialize(workbook));
    }

    if (segments[3] === "export-csv" && method === "GET") {
      const sheet = workbook.sheets.find((entry) => entry.id === workbook.activeSheetId) ?? workbook.sheets[0];
      return csvResponse(fakeCsv(sheet));
    }

    return jsonResponse(404, { error: "Not found" });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { store, fetchMock };
}

function renderHome() {
  window.location.hash = "#/";
  return render(<App />);
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
  await screen.findByRole("heading", { name: "Q3 Sales" });
}

/** Drag-select a rectangle A1..C6 using pointer events on the grid. */
async function selectRange(user: ReturnType<typeof userEvent.setup>, start: string, end: string) {
  const grid = screen.getByRole("grid", { name: "Worksheet grid" });
  const from = within(grid).getByRole("gridcell", { name: start });
  const to = within(grid).getByRole("gridcell", { name: end });
  fireEvent.mouseDown(from);
  fireEvent.mouseEnter(to);
  fireEvent.mouseUp(window);
  await waitFor(() =>
    expect(from.getAttribute("aria-selected")).toBe("true"),
  );
  expect(to.getAttribute("aria-selected")).toBe("true");
}

beforeEach(() => {
  sequence = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-5-1-2 filter rows by value or condition", () => {
  it("provides the Data menu with menuitem commands", async () => {
    installFakeBackend();
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    const dataButton = screen.getByRole("button", { name: "Data" });
    expect(dataButton.getAttribute("aria-haspopup")).toBe("menu");
    await user.click(dataButton);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Create filter",
      "Data validation",
      "Sort range",
      "Create pivot table",
    ]);
  });

  it("creates a filter, hides nonmatching rows, persists, exports hidden rows, and clears", async () => {
    const backend = installFakeBackend();
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await selectRange(user, "A1", "C6");
    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create filter" }));

    // each header gets a "Filter <header text>" button
    const filterRegion = await screen.findByRole("button", { name: "Filter Region" });
    expect(screen.getByRole("button", { name: "Filter Sales" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter Status" })).toBeTruthy();

    // value-filter dialog: checkboxes named by source values
    await user.click(filterRegion);
    const dialog = await screen.findByRole("dialog", { name: "Filter Region" });
    expect(within(dialog).getByRole("combobox", { name: "Condition" })).toBeTruthy();
    expect(within(dialog).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "None",
      "Text contains",
      "Greater than",
      "Before",
      "Is empty",
      "Is not empty",
    ]);
    const checkboxes = within(dialog).getAllByRole("checkbox");
    expect(checkboxes.map((box) => box.getAttribute("aria-label"))).toEqual(["East", "North", "South"]);
    expect(within(dialog).getByRole("button", { name: "Clear selection" })).toBeTruthy();

    // keep only East, apply, then rows 3..6 disappear
    await user.click(within(dialog).getByRole("checkbox", { name: "North" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "South" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.queryByRole("gridcell", { name: "A3" })).toBeNull();
    expect(screen.queryByRole("rowheader", { name: "3" })).toBeNull();
    expect(screen.queryByRole("gridcell", { name: "A4" })).toBeNull();
    // the header row and cells outside the range stay visible
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toContain("Region");

    // same rows remain hidden after refresh
    cleanup();
    window.location.hash = `#/workbooks/${backend.store[0].id}`;
    render(<App />);
    await screen.findByRole("heading", { name: "Q3 Sales" });
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");
    expect(screen.queryByRole("gridcell", { name: "A3" })).toBeNull();

    // CSV export still includes hidden rows within the filtered range
    let downloadedBlob: Blob | null = null;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      downloadedBlob = blob;
      return "blob:mock";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        // no-op
      });
    try {
      await user.click(screen.getByRole("button", { name: "Export CSV" }));
      await waitFor(() => expect(downloadedBlob).not.toBeNull());
      const text = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(downloadedBlob!);
      });
      expect(text).toContain("North");
      expect(text).toContain("South");
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }

    // Clear filter restores every source row
    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Clear filter" }));
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toContain("North"),
    );
    expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toContain("South");
    expect(screen.queryByRole("button", { name: "Filter Region" })).toBeNull();
  });

  it("applies the Text contains condition and persists it", async () => {
    installFakeBackend();
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await selectRange(user, "A1", "C6");
    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create filter" }));
    await user.click(await screen.findByRole("button", { name: "Filter Region" }));

    const dialog = await screen.findByRole("dialog", { name: "Filter Region" });
    const conditionCombo = within(dialog).getByRole("combobox", { name: "Condition" });
    await user.selectOptions(conditionCombo, "Text contains");
    const valueBox = within(dialog).getByRole("textbox", { name: "Value" });
    await user.type(valueBox, "orth");
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    // only North matches "orth"
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toContain("North"),
    );
    expect(screen.queryByRole("gridcell", { name: "A2" })).toBeNull();
    expect(screen.queryByRole("gridcell", { name: "A4" })).toBeNull();

    // refresh keeps the same condition view
    cleanup();
    window.location.hash = "#/workbooks/wb_1";
    render(<App />);
    await screen.findByRole("heading", { name: "Q3 Sales" });
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toContain("North");
    expect(screen.queryByRole("gridcell", { name: "A2" })).toBeNull();
  });
});

describe("REQ-5-2-1 dropdown and numeric validation", () => {
  it("saves a dropdown rule, offers option-role choices, and rejects invalid input", async () => {
    installFakeBackend();
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await selectRange(user, "A1", "A2");
    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Data validation" }));

    const dialog = await screen.findByRole("dialog", { name: "Data validation" });
    const ruleType = within(dialog).getByRole("combobox", { name: "Rule type" });
    expect(within(dialog).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Dropdown",
      "Number range",
    ]);
    const allowed = within(dialog).getByRole("textbox", { name: "Allowed values" });
    await user.type(allowed, "East, North,  South ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // dropdown buttons appear with the required accessible names
    const openA1 = await screen.findByRole("button", { name: "Open dropdown for A1" });
    expect(screen.getByRole("button", { name: "Open dropdown for A2" })).toBeTruthy();

    // options use the ARIA option role and trimmed allowed values as names
    await user.click(openA1);
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "East",
      "North",
      "South",
    ]);
    await user.click(within(listbox).getByRole("option", { name: "East" }));
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toContain("East"),
    );

    // an invalid value through the formula bar is rejected; the original remains
    await user.click(screen.getByRole("gridcell", { name: "A2" }));
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.clear(formulaBar);
    await user.type(formulaBar, "West");
    await user.keyboard("{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Please select one of the following values: East, North, South",
    );
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("East");

    // a valid dropdown value still commits
    await user.click(screen.getByRole("gridcell", { name: "A2" }));
    await user.clear(formulaBar);
    await user.type(formulaBar, "North");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("North"),
    );

    // rules remain active after refresh
    cleanup();
    window.location.hash = "#/workbooks/wb_1";
    render(<App />);
    await screen.findByRole("heading", { name: "Q3 Sales" });
    expect(await screen.findByRole("button", { name: "Open dropdown for A1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open dropdown for A2" })).toBeTruthy();
  });

  it("enforces the 0-to-100 boundary wording and number-range messages", async () => {
    installFakeBackend();
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole("gridcell", { name: "B3" }));
    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Data validation" }));

    const dialog = await screen.findByRole("dialog", { name: "Data validation" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Rule type" }), "Number range");
    await user.type(within(dialog).getByRole("textbox", { name: "Minimum" }), "0");
    await user.type(within(dialog).getByRole("textbox", { name: "Maximum" }), "100");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // 101 is rejected with the exact 0-to-100 wording; the original 800 remains
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.clear(formulaBar);
    await user.type(formulaBar, "101");
    await user.keyboard("{Enter}");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Please enter a number from 0 to 100",
    );
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toContain("800");

    await user.clear(formulaBar);
    await user.type(formulaBar, "50");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toContain("50"),
    );
  });

  it("reopens an existing rule prefilled with Delete rule, and deleting removes the constraint", async () => {
    installFakeBackend();
    renderHome();
    const user = userEvent.setup();
    await openEditor(user);

    await selectRange(user, "A1", "A2");
    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Data validation" }));
    const dialog = await screen.findByRole("dialog", { name: "Data validation" });
    await user.type(within(dialog).getByRole("textbox", { name: "Allowed values" }), "East, North");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // reopen: dialog is prefilled and offers Delete rule
    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Data validation" }));
    const reopened = await screen.findByRole("dialog", { name: "Data validation" });
    expect((within(reopened).getByRole("textbox", { name: "Allowed values" }) as HTMLInputElement).value).toBe(
      "East, North",
    );
    await user.click(within(reopened).getByRole("button", { name: "Delete rule" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // the constraint is gone: a formerly invalid value now commits
    expect(screen.queryByRole("button", { name: "Open dropdown for A1" })).toBeNull();
    await user.click(screen.getByRole("gridcell", { name: "A2" }));
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.clear(formulaBar);
    await user.type(formulaBar, "West");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toContain("West"),
    );
  });
});
