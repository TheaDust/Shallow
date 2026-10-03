import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import type { CellInput, FilterRule, Selection, ValidationRule, Workbook, Worksheet } from "../domain/types";
import { installFetchStub, type StubRequest } from "../test/fetch-stub";
import { seededWorkbook } from "../test/fixtures";

const WORKBOOK_URL = "/api/workbooks/wb-q3-sales";
const SHEET = "ws-q3-sales-sheet1";
const SHEET_URL = `${WORKBOOK_URL}/worksheets/${SHEET}`;
const FILTER_URL = `${SHEET_URL}/filter`;
const VALIDATIONS_URL = `${SHEET_URL}/validations`;
const CELLS_URL = `${SHEET_URL}/cells`;
const SELECTION_URL = `${SHEET_URL}/selection`;

function reset() {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
}

function parseCoordinate(name: string): { row: number; column: number } | null {
  const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(name.trim());
  if (!match) return null;
  let column = 0;
  for (const character of match[1].toUpperCase()) column = column * 26 + (character.charCodeAt(0) - 64);
  return { row: Number(match[2]) - 1, column: column - 1 };
}

function columnLetters(column: number): string {
  let index = column;
  let label = "";
  do {
    label = String.fromCharCode(65 + (index % 26)) + label;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return label;
}

function coordinateName(row: number, column: number): string {
  return `${columnLetters(column)}${row + 1}`;
}

function rangeBounds(range: string) {
  const [first, last] = String(range ?? "").split(":");
  const start = parseCoordinate(first ?? "");
  const end = parseCoordinate(last ?? first ?? "");
  if (!start || !end) return null;
  return {
    top: Math.min(start.row, end.row),
    bottom: Math.max(start.row, end.row),
    left: Math.min(start.column, end.column),
    right: Math.max(start.column, end.column),
  };
}

/** Mirrors the backend rule check so a rejected write keeps every cell as it was. */
function validationMessage(worksheet: Worksheet, name: string, value: string): string | null {
  const position = parseCoordinate(name);
  if (!position) return null;
  for (const rule of worksheet.validations ?? []) {
    const bounds = rangeBounds(rule.range);
    if (!bounds) continue;
    if (
      position.row < bounds.top ||
      position.row > bounds.bottom ||
      position.column < bounds.left ||
      position.column > bounds.right
    ) {
      continue;
    }
    if (rule.type === "list") {
      const values = (rule.values ?? []).map((item) => item.trim());
      if (!values.includes(value.trim())) {
        return `Please select one of the following values: ${values.join(", ")}`;
      }
      continue;
    }
    if (value.trim() === "") continue;
    const numeric = Number(value.trim());
    const min = Number(rule.min);
    const max = Number(rule.max);
    if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
      if (min === 0 && max === 100) return "Please enter a number from 0 to 100";
      return `Please enter a number between ${min} and ${max}`;
    }
  }
  return null;
}

interface DataToolsOptions {
  workbook?: Workbook;
  cellsError?: string;
  filterError?: string;
}

/** Stateful API double mirroring the filter, validation, cell and selection endpoints. */
function stubDataTools(options: DataToolsOptions = {}) {
  let current: Workbook = structuredClone(options.workbook ?? seededWorkbook);
  const requests: StubRequest[] = [];

  const updateSheet = (worksheetId: string, update: (worksheet: Worksheet) => Worksheet) => {
    current = {
      ...current,
      updatedAt: "2026-10-04T10:00:00.000Z",
      worksheets: current.worksheets.map((worksheet) =>
        worksheet.id === worksheetId ? update(worksheet) : worksheet,
      ),
    };
  };

  installFetchStub((request) => {
    requests.push(request);
    if (request.url === WORKBOOK_URL && request.method === "GET") {
      return { body: { workbook: current } };
    }
    if (request.url === FILTER_URL && request.method === "POST") {
      if (options.filterError) return { status: 400, body: { error: options.filterError } };
      const body = request.body as { range: string; rules: FilterRule[] };
      updateSheet(SHEET, (worksheet) => ({ ...worksheet, filter: { range: body.range, rules: body.rules } }));
      return { body: { workbook: current } };
    }
    if (request.url === FILTER_URL && request.method === "DELETE") {
      updateSheet(SHEET, (worksheet) => {
        const { filter: _dropped, ...rest } = worksheet;
        return rest;
      });
      return { body: { workbook: current } };
    }
    if (request.url === VALIDATIONS_URL && request.method === "POST") {
      const body = request.body as { range: string; type: "list" | "number"; values?: string[]; min?: number; max?: number };
      const rule: ValidationRule =
        body.type === "list"
          ? { range: body.range, type: "list", values: body.values }
          : { range: body.range, type: "number", min: body.min, max: body.max };
      updateSheet(SHEET, (worksheet) => ({ ...worksheet, validations: [...(worksheet.validations ?? []), rule] }));
      return { body: { workbook: current } };
    }
    if (request.url.startsWith(`${VALIDATIONS_URL}?range=`) && request.method === "DELETE") {
      const range = decodeURIComponent(request.url.split("range=")[1] ?? "");
      updateSheet(SHEET, (worksheet) => ({
        ...worksheet,
        validations: (worksheet.validations ?? []).filter((rule) => rule.range !== range),
      }));
      return { body: { workbook: current } };
    }
    if (request.url === CELLS_URL && request.method === "PATCH") {
      if (options.cellsError) return { status: 400, body: { error: options.cellsError } };
      const body = request.body as { updates: CellInput[]; selection?: Selection };
      const worksheet = current.worksheets.find((candidate) => candidate.id === SHEET);
      if (!worksheet) return { status: 404, body: { error: "Worksheet not found" } };
      const cells = structuredClone(worksheet.cells);
      for (const update of body.updates) {
        const input = update.input;
        if (input === "") delete cells[update.name];
        else cells[update.name] = { value: input };
        const message = validationMessage(worksheet, update.name, input);
        if (message) return { status: 400, body: { error: message } };
      }
      updateSheet(SHEET, (target) => ({ ...target, cells, selection: body.selection ?? target.selection }));
      return { body: { workbook: current } };
    }
    if (request.url === SELECTION_URL && request.method === "PATCH") {
      const selection = request.body as Selection;
      updateSheet(SHEET, (worksheet) => ({ ...worksheet, selection }));
      return { body: { workbook: current } };
    }
    return { status: 404, body: { error: "Not found" } };
  });
  return { requests, workbook: () => current };
}

async function openEditor() {
  window.location.hash = "#/workbooks/wb-q3-sales";
  render(<App />);
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
}

/** Replaces the formula bar content of the selected cell and commits it. */
async function enterFormula(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = screen.getByRole("textbox", { name: "Formula bar" });
  await user.clear(input);
  await user.type(input, text);
  await user.keyboard("{Enter}");
}

async function selectRange(user: ReturnType<typeof userEvent.setup>, from: string, to: string) {
  fireEvent.mouseDown(screen.getByRole("gridcell", { name: from }));
  fireEvent.mouseEnter(screen.getByRole("gridcell", { name: to }));
  fireEvent.mouseUp(window);
  await waitFor(() => expect(screen.getByRole("gridcell", { name: from })).toHaveAttribute("aria-selected", "true"));
  await user.click(screen.getByRole("button", { name: "Data" }));
}

describe("data menu, filters and validation", () => {
  afterEach(reset);

  it("opens the Data menu with its sort, filter and validation commands", async () => {
    stubDataTools();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Data" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Sort range",
      "Create filter",
      "Clear filter",
      "Data validation",
      "Create pivot table",
    ]);
  });

  it("creates a filter for the data region and exposes one button per header", async () => {
    const stub = stubDataTools();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(screen.getByRole("menuitem", { name: "Create filter" }));

    expect(await screen.findByRole("button", { name: "Filter Region" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter Sales" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter Status" })).toBeInTheDocument();
    const posted = stub.requests.find((request) => request.url === FILTER_URL && request.method === "POST");
    expect(posted?.body).toEqual({ range: "A1:C4", rules: [] });
  });

  it("hides the unchecked rows, keeps their values and persists the filter view", async () => {
    const stub = stubDataTools();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(screen.getByRole("menuitem", { name: "Create filter" }));
    await user.click(await screen.findByRole("button", { name: "Filter Region" }));

    const dialog = screen.getByRole("dialog", { name: "Filter Region" });
    // The condition combo box keeps the requirement's option names, plus a no-condition default.
    for (const label of ["Text contains", "Greater than", "Before", "Is empty", "Is not empty"]) {
      expect(within(dialog).getByRole("option", { name: label })).toBeInTheDocument();
    }
    expect(within(dialog).getByRole("checkbox", { name: "East" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "North" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "South" })).toBeChecked();
    expect(within(dialog).getByRole("combobox", { name: "Condition" })).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Value" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("checkbox", { name: "North" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(screen.queryByRole("gridcell", { name: "A3" })).toBeNull());
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
    expect(screen.getByRole("gridcell", { name: "A4" })).toHaveTextContent("South");
    expect(screen.queryByRole("dialog")).toBeNull();
    const posted = stub.requests.filter((request) => request.url === FILTER_URL && request.method === "POST").pop();
    expect(posted?.body).toEqual({
      range: "A1:C4",
      rules: [{ column: 0, mode: "values", values: ["East", "South"] }],
    });
    expect(stub.workbook().worksheets[0].cells.A3.value).toBe("North");

    // Refreshing restores the same visible rows.
    cleanup();
    await openEditor();
    await waitFor(() => expect(screen.queryByRole("gridcell", { name: "A3" })).toBeNull());
    expect(screen.getByRole("gridcell", { name: "A4" })).toHaveTextContent("South");
    expect(screen.getByRole("button", { name: "Filter Region" })).toBeInTheDocument();
  });

  it("filters one column by condition without touching the other rows", async () => {
    stubDataTools();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(screen.getByRole("menuitem", { name: "Create filter" }));
    await user.click(await screen.findByRole("button", { name: "Filter Sales" }));

    const dialog = screen.getByRole("dialog", { name: "Filter Sales" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Condition" }), "greater-than");
    await user.type(within(dialog).getByRole("textbox", { name: "Value" }), "1000");
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(screen.queryByRole("gridcell", { name: "A3" })).toBeNull());
    expect(screen.queryByRole("gridcell", { name: "A4" })).toBeNull();
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
    expect(screen.getByRole("gridcell", { name: "B2" })).toHaveTextContent("1200");
  });

  it("clears the filter and restores every source record in order", async () => {
    stubDataTools();
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(screen.getByRole("menuitem", { name: "Create filter" }));
    await user.click(await screen.findByRole("button", { name: "Filter Region" }));
    const dialog = screen.getByRole("dialog", { name: "Filter Region" });
    await user.click(within(dialog).getByRole("button", { name: "Clear selection" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByRole("gridcell", { name: "A2" })).toBeNull());

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(screen.getByRole("menuitem", { name: "Clear filter" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East"));
    expect(screen.getByRole("gridcell", { name: "A3" })).toHaveTextContent("North");
    expect(screen.getByRole("gridcell", { name: "A4" })).toHaveTextContent("South");
    expect(screen.getByRole("gridcell", { name: "B3" })).toHaveTextContent("800");
    expect(screen.queryByRole("button", { name: "Filter Region" })).toBeNull();
  });

  it("keeps the previous view and shows an error when saving a filter fails", async () => {
    stubDataTools({ filterError: "Unable to update the filter" });
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(screen.getByRole("menuitem", { name: "Create filter" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to update the filter");
    expect(screen.queryByRole("button", { name: "Filter Region" })).toBeNull();
    expect(screen.getByRole("gridcell", { name: "A3" })).toHaveTextContent("North");
  });

  it("saves a dropdown rule, offers the dropdown button and writes the chosen option", async () => {
    const stub = stubDataTools();
    const user = userEvent.setup();
    await openEditor();

    await selectRange(user, "A2", "A3");
    await user.click(screen.getByRole("menuitem", { name: "Data validation" }));

    const dialog = await screen.findByRole("dialog", { name: "Data validation" });
    expect(within(dialog).getByRole("combobox", { name: "Rule type" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "Dropdown" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "Number range" })).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Rule type" }), "list");
    await user.type(within(dialog).getByRole("textbox", { name: "Allowed values" }), " Open , Closed ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const saved = stub.requests.find((request) => request.url === VALIDATIONS_URL && request.method === "POST");
    expect(saved?.body).toEqual({ range: "A2:A3", type: "list", values: ["Open", "Closed"] });
    expect(stub.workbook().worksheets[0].validations).toEqual([
      { range: "A2:A3", type: "list", values: ["Open", "Closed"] },
    ]);

    const dropdown = screen.getByRole("button", { name: "Open dropdown for A2" });
    await user.click(dropdown);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Open", "Closed"]);
    await user.click(screen.getByRole("option", { name: "Closed" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("Closed"));
    const written = stub.requests.filter((request) => request.url === CELLS_URL).pop();
    expect(written?.body).toEqual({ updates: [{ name: "A2", input: "Closed" }] });
  });

  it("rejects an invalid dropdown value, keeps the cell and reports the allowed values", async () => {
    stubDataTools({
      workbook: {
        ...structuredClone(seededWorkbook),
        worksheets: [
          {
            ...structuredClone(seededWorkbook.worksheets[0]),
            validations: [{ range: "A2:A3", type: "list", values: ["Open", "Closed"] }],
          },
          structuredClone(seededWorkbook.worksheets[1]),
        ],
      },
    });
    const user = userEvent.setup();
    await openEditor();

    await user.click(screen.getByRole("gridcell", { name: "A2" }));
    await enterFormula(user, "Pending");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please select one of the following values: Open, Closed",
    );
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
  });

  it("enforces an inclusive number rule and reports the 101 rejection", async () => {
    stubDataTools();
    const user = userEvent.setup();
    await openEditor();

    await selectRange(user, "B2", "B3");
    await user.click(screen.getByRole("menuitem", { name: "Data validation" }));
    const dialog = await screen.findByRole("dialog", { name: "Data validation" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Rule type" }), "number");
    await user.type(within(dialog).getByRole("textbox", { name: "Minimum" }), "0");
    await user.type(within(dialog).getByRole("textbox", { name: "Maximum" }), "100");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getByRole("gridcell", { name: "B3" }));
    await enterFormula(user, "101");
    expect(await screen.findByRole("alert")).toHaveTextContent("Please enter a number from 0 to 100");
    expect(screen.getByRole("gridcell", { name: "B3" })).toHaveTextContent("800");

    // The rule is still active after a refresh and the boundary value is accepted.
    cleanup();
    await openEditor();
    await user.click(screen.getByRole("gridcell", { name: "B3" }));
    await enterFormula(user, "100");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B3" })).toHaveTextContent("100"));
  });

  it("reopens an existing rule prefilled and deletes it without changing cell values", async () => {
    const stub = stubDataTools({
      workbook: {
        ...structuredClone(seededWorkbook),
        worksheets: [
          {
            ...structuredClone(seededWorkbook.worksheets[0]),
            validations: [{ range: "B2:B3", type: "number", min: 0, max: 100 }],
          },
          structuredClone(seededWorkbook.worksheets[1]),
        ],
      },
    });
    const user = userEvent.setup();
    await openEditor();

    await selectRange(user, "B2", "B3");
    await user.click(screen.getByRole("menuitem", { name: "Data validation" }));
    const dialog = await screen.findByRole("dialog", { name: "Data validation" });
    expect(within(dialog).getByRole("combobox", { name: "Rule type" })).toHaveValue("number");
    expect(within(dialog).getByRole("textbox", { name: "Minimum" })).toHaveValue("0");
    expect(within(dialog).getByRole("textbox", { name: "Maximum" })).toHaveValue("100");

    await user.click(within(dialog).getByRole("button", { name: "Delete rule" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(stub.requests.some((request) => request.method === "DELETE" && request.url.startsWith(`${VALIDATIONS_URL}?range=`))).toBe(true);
    expect(screen.getByRole("gridcell", { name: "B2" })).toHaveTextContent("1200");
    expect(screen.getByRole("gridcell", { name: "B3" })).toHaveTextContent("800");

    // The constraint is gone: a previously rejected value is accepted now.
    await user.click(screen.getByRole("gridcell", { name: "B3" }));
    await enterFormula(user, "101");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B3" })).toHaveTextContent("101"));
  });

  it("keeps an invalid rule in the dialog and stores nothing", async () => {
    const stub = stubDataTools();
    const user = userEvent.setup();
    await openEditor();

    await selectRange(user, "A2", "A2");
    await user.click(screen.getByRole("menuitem", { name: "Data validation" }));
    const dialog = await screen.findByRole("dialog", { name: "Data validation" });
    await user.type(within(dialog).getByRole("textbox", { name: "Allowed values" }), "   ,  ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Enter at least one allowed value");
    expect(stub.requests.some((request) => request.url === VALIDATIONS_URL && request.method === "POST")).toBe(false);
  });
});
