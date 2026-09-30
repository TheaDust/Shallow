import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fakeApi";
import type { PivotData, WorksheetData } from "../workbooks/types";

let api: FakeApi;
let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  api = createFakeApi();
  vi.stubGlobal("fetch", api.fetch);
  window.location.hash = "#/";
  user = userEvent.setup();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openSeedWorkbook() {
  render(<App />);
  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
  await screen.findByRole("heading", { name: "Q3 Sales" });
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

/** Opens the editor again through the application entry point after a page reload. */
async function reopenSeedWorkbook() {
  cleanup();
  window.location.hash = "#/";
  return openSeedWorkbook();
}

function workbook() {
  const found = api.state.workbooks[0];
  if (!found) throw new Error("the seeded workbook is missing");
  return found;
}

function sheet(): WorksheetData {
  const found = workbook().worksheets.find((worksheet) => worksheet.id === "ws_q3_sales_sheet1");
  if (!found) throw new Error("the seeded worksheet is missing");
  return found;
}

/** The pivot result worksheet the seed workbook gained; the tests only ask for it once it exists. */
function pivotSheet(): WorksheetData & { pivot: PivotData } {
  const found = workbook().worksheets.find((worksheet) => worksheet.pivot);
  if (!found?.pivot) throw new Error("the workbook has no pivot result worksheet");
  return found as WorksheetData & { pivot: PivotData };
}

function cell(grid: HTMLElement, name: string) {
  return within(grid).getByRole("gridcell", { name, hidden: true });
}

function cellText(grid: HTMLElement, name: string): string {
  return cell(grid, name).textContent ?? "";
}

/** Drags from one corner of a rectangle to the opposite corner, as the range selection does. */
function selectRange(grid: HTMLElement, from: string, to: string) {
  fireEvent.mouseDown(cell(grid, from));
  if (to !== from) fireEvent.mouseEnter(cell(grid, to));
  fireEvent.mouseUp(cell(grid, to));
}

async function openDataMenu() {
  await user.click(screen.getByRole("button", { name: "Data" }));
  return screen.findByRole("menu", { name: "Data" });
}

/** Creates a pivot table over a source range through the `Data` menu and the dialog. */
async function createPivotTable(grid: HTMLElement, from: string, to: string) {
  selectRange(grid, from, to);
  const menu = await openDataMenu();
  await user.click(within(menu).getByRole("menuitem", { name: "Create pivot table" }));
  const dialog = await screen.findByRole("dialog", { name: "Create pivot table" });
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
  await screen.findByRole("tab", { name: "Pivot1" });
  return screen.getByRole("region", { name: "Pivot table editor" });
}

async function applyFields(fields: { rows?: string; columns?: string; values: string; summarizeBy: string }) {
  const editor = screen.getByRole("region", { name: "Pivot table editor" });
  if (fields.rows !== undefined) await user.selectOptions(within(editor).getByRole("combobox", { name: "Rows" }), fields.rows);
  if (fields.columns !== undefined) {
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Columns" }), fields.columns);
  }
  await user.selectOptions(within(editor).getByRole("combobox", { name: "Values" }), fields.values);
  await user.selectOptions(within(editor).getByRole("combobox", { name: "Summarize by" }), fields.summarizeBy);
  await user.click(within(editor).getByRole("button", { name: "Apply" }));
}

async function openWorksheet(name: string) {
  await user.click(screen.getByRole("tab", { name }));
}

/** Writes one cell of the active worksheet through the formula bar, as a user would. */
async function writeCell(grid: HTMLElement, name: string, value: string) {
  await user.click(cell(grid, name));
  const bar = screen.getByRole("textbox", { name: "Formula bar" });
  await user.clear(bar);
  await user.type(bar, value);
  await user.keyboard("{Enter}");
}

describe("the Create pivot table command", () => {
  it("exposes Create pivot table as a Data menu item", async () => {
    await openSeedWorkbook();

    const menu = await openDataMenu();

    expect(within(menu).getByRole("menuitem", { name: "Create pivot table" })).toBeTruthy();
  });

  it("names the source range, offers the New worksheet radio and creates Pivot1", async () => {
    const grid = await openSeedWorkbook();

    selectRange(grid, "A1", "C4");
    const menu = await openDataMenu();
    await user.click(within(menu).getByRole("menuitem", { name: "Create pivot table" }));

    const dialog = await screen.findByRole("dialog", { name: "Create pivot table" });
    expect(within(dialog).getByText("Source range: A1:C4")).toBeTruthy();
    const radio = within(dialog).getByRole("radio", { name: "New worksheet" });
    expect((radio as HTMLInputElement).checked).toBe(true);

    const sourceBefore = JSON.stringify(sheet());
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    const tab = await screen.findByRole("tab", { name: "Pivot1" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(pivotSheet().pivot.sourceRange).toEqual({ top: 1, bottom: 4, left: 1, right: 3 });
    expect(JSON.stringify(sheet())).toBe(sourceBefore);

    const editor = screen.getByRole("region", { name: "Pivot table editor" });
    expect(within(editor).getByRole("combobox", { name: "Rows" })).toBeTruthy();
    expect(within(editor).getByRole("combobox", { name: "Columns" })).toBeTruthy();
    expect(within(editor).getByRole("combobox", { name: "Values" })).toBeTruthy();
    expect(within(editor).getByRole("combobox", { name: "Summarize by" })).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "Apply" })).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "Refresh pivot table" })).toBeTruthy();
  });

  it("uses the source header text as the option names of the field combo boxes", async () => {
    const grid = await openSeedWorkbook();
    const editor = await createPivotTable(grid, "A1", "C4");

    const rows = within(editor).getByRole("combobox", { name: "Rows" });
    const options = within(rows).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["(none)", "Region", "Sales", "Status"]);

    const summarize = within(editor).getByRole("combobox", { name: "Summarize by" });
    expect(within(summarize).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "SUM",
      "COUNT",
      "AVERAGE",
    ]);
  });

  it("asks for a data range when the selection has no header row", async () => {
    const grid = await openSeedWorkbook();

    await user.click(cell(grid, "D8"));
    const menu = await openDataMenu();
    await user.click(within(menu).getByRole("menuitem", { name: "Create pivot table" }));

    expect(screen.queryByRole("dialog", { name: "Create pivot table" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Select a range with a header row to create a pivot table.");
    expect(workbook().worksheets.some((worksheet) => worksheet.pivot)).toBe(false);
  });
});

describe("the Pivot table editor", () => {
  it("summarizes one row field by SUM and keeps the source and the result after reopening", async () => {
    const grid = await openSeedWorkbook();
    await createPivotTable(grid, "A1", "C4");

    await applyFields({ rows: "Region", values: "Sales", summarizeBy: "SUM" });
    const pivotGrid = await screen.findByRole("grid", { name: "Worksheet grid" });
    await waitFor(() => expect(cellText(pivotGrid, "B1")).toBe("SUM of Sales"));

    expect(cellText(pivotGrid, "A1")).toBe("Region");
    expect(cellText(pivotGrid, "A2")).toBe("East");
    expect(cellText(pivotGrid, "B2")).toBe("1200");
    expect(cellText(pivotGrid, "A3")).toBe("North");
    expect(cellText(pivotGrid, "B3")).toBe("800");
    expect(cellText(pivotGrid, "A4")).toBe("South");
    expect(cellText(pivotGrid, "B4")).toBe("700");
    expect(cellText(pivotGrid, "A5")).toBe("Grand Total");
    expect(cellText(pivotGrid, "B5")).toBe("2700");
    expect(sheet().cells.A2.value).toBe("East");
    expect(sheet().cells.B2.value).toBe("1200");

    const reopened = await reopenSeedWorkbook();
    expect(cellText(reopened, "B1")).toBe("SUM of Sales");
    expect(cellText(reopened, "B5")).toBe("2700");
    const selectValue = (name: string) =>
      (screen.getByRole("combobox", { name }) as HTMLSelectElement).value;
    expect(selectValue("Rows")).toBe("Region");
    expect(selectValue("Values")).toBe("Sales");
    expect(selectValue("Summarize by")).toBe("SUM");

    await openWorksheet("Sheet1");
    const sourceGrid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(cellText(sourceGrid, "A2")).toBe("East");
    expect(cellText(sourceGrid, "B4")).toBe("700");
  });

  it("arranges a column field with a Grand Total column and row", async () => {
    const grid = await openSeedWorkbook();
    await createPivotTable(grid, "A1", "C4");

    await applyFields({ rows: "Region", columns: "Status", values: "Sales", summarizeBy: "AVERAGE" });
    const pivotGrid = await screen.findByRole("grid", { name: "Worksheet grid" });
    await waitFor(() => expect(cellText(pivotGrid, "D1")).toBe("Grand Total"));

    expect(cellText(pivotGrid, "A1")).toBe("Region");
    expect(cellText(pivotGrid, "B1")).toBe("Open");
    expect(cellText(pivotGrid, "C1")).toBe("Closed");
    expect(cellText(pivotGrid, "A2")).toBe("East");
    expect(cellText(pivotGrid, "B2")).toBe("1200");
    expect(cellText(pivotGrid, "C2")).toBe("0");
    expect(cellText(pivotGrid, "A3")).toBe("North");
    expect(cellText(pivotGrid, "D3")).toBe("800");
    expect(cellText(pivotGrid, "A5")).toBe("Grand Total");
    expect(cellText(pivotGrid, "B5")).toBe("950");
    expect(cellText(pivotGrid, "C5")).toBe("800");
    expect(cellText(pivotGrid, "D5")).toBe("900");
  });

  it("counts the non-empty value fields and shows 0 for a missing combination", async () => {
    const grid = await openSeedWorkbook();
    await createPivotTable(grid, "A1", "C4");

    await applyFields({ rows: "Region", columns: "Status", values: "Status", summarizeBy: "COUNT" });
    const pivotGrid = await screen.findByRole("grid", { name: "Worksheet grid" });
    await waitFor(() => expect(cellText(pivotGrid, "B1")).toBe("Open"));

    expect(cellText(pivotGrid, "B2")).toBe("1");
    expect(cellText(pivotGrid, "C2")).toBe("0");
    expect(cellText(pivotGrid, "B3")).toBe("0");
    expect(cellText(pivotGrid, "C3")).toBe("1");
    expect(cellText(pivotGrid, "D5")).toBe("3");
  });

  it("shows the numeric value message for SUM of a nonnumeric field and stores no result", async () => {
    const grid = await openSeedWorkbook();
    await createPivotTable(grid, "A1", "C4");

    await applyFields({ rows: "Region", values: "Status", summarizeBy: "SUM" });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Value field requires numeric values");
    expect(pivotSheet().cells).toEqual({});
    expect(sheet().cells.A2.value).toBe("East");
  });

  it("rebuilds the summary from the current source data when Refresh pivot table is clicked", async () => {
    const grid = await openSeedWorkbook();
    await createPivotTable(grid, "A1", "C4");
    await applyFields({ rows: "Region", values: "Sales", summarizeBy: "SUM" });
    const pivotGrid = await screen.findByRole("grid", { name: "Worksheet grid" });
    await waitFor(() => expect(cellText(pivotGrid, "B2")).toBe("1200"));

    await openWorksheet("Sheet1");
    const sourceGrid = screen.getByRole("grid", { name: "Worksheet grid" });
    await writeCell(sourceGrid, "B2", "1500");
    await openWorksheet("Pivot1");

    const editor = screen.getByRole("region", { name: "Pivot table editor" });
    const stored = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(cellText(stored, "B2")).toBe("1200");
    expect(cellText(stored, "B5")).toBe("2700");

    await user.click(within(editor).getByRole("button", { name: "Refresh pivot table" }));
    await waitFor(() => expect(cellText(screen.getByRole("grid", { name: "Worksheet grid" }), "B2")).toBe("1500"));
    const refreshed = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(cellText(refreshed, "B5")).toBe("3000");
    expect(sheet().cells.B2.value).toBe("1500");
  });

  it("reports a deleted source header and keeps the last successful result", async () => {
    const grid = await openSeedWorkbook();
    await createPivotTable(grid, "A1", "C4");
    await applyFields({ rows: "Region", values: "Sales", summarizeBy: "SUM" });
    const pivotGrid = await screen.findByRole("grid", { name: "Worksheet grid" });
    await waitFor(() => expect(cellText(pivotGrid, "B5")).toBe("2700"));

    await openWorksheet("Sheet1");
    const header = screen.getByRole("columnheader", { name: "A" });
    fireEvent.contextMenu(header);
    const menu = await screen.findByRole("menu", { name: "Column A menu" });
    await user.click(within(menu).getByRole("menuitem", { name: "Delete column" }));
    await waitFor(() => expect(sheet().cells.A1.value).toBe("Sales"));

    await openWorksheet("Pivot1");
    expect(screen.getByRole("alert").textContent).toBe("Pivot field is no longer available. Select a new field.");
    const stored = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(cellText(stored, "A2")).toBe("East");
    expect(cellText(stored, "B5")).toBe("2700");

    const editor = screen.getByRole("region", { name: "Pivot table editor" });
    await user.click(within(editor).getByRole("button", { name: "Refresh pivot table" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Pivot field is no longer available. Select a new field."),
    );
    expect(pivotSheet().cells.B5.value).toBe("2700");
    // The removed column also shifted the source records: the Sales values now start in column A.
    expect(sheet().cells.A1.value).toBe("Sales");
    expect(sheet().cells.A2.value).toBe("1200");

    // Selecting a field that still exists replaces the refused configuration.
    await applyFields({ rows: "Sales", values: "Sales", summarizeBy: "COUNT" });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(cellText(screen.getByRole("grid", { name: "Worksheet grid" }), "B1")).toBe("COUNT of Sales");
  });
});
