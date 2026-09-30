import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fakeApi";

let api: FakeApi;
let user: ReturnType<typeof userEvent.setup>;

function renderApp() {
  return render(<App />);
}

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
  renderApp();
  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
  await screen.findByRole("heading", { name: "Q3 Sales" });
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function workbookOf() {
  return api.state.workbooks[0];
}

function attributeOf(element: Element, name: string): string | null {
  return element.getAttribute(name);
}

async function openWorksheetMenu(name: string) {
  await user.click(screen.getByRole("button", { name: `Worksheet options for ${name}` }));
  return screen.getByRole("menu", { name: `Options for ${name}` });
}

/** Finds a cell even while its row is hidden by the filter view. */
function cell(grid: HTMLElement, name: string) {
  return within(grid).getByRole("gridcell", { name, hidden: true });
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

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
}

function worksheetByName(name: string) {
  const worksheet = workbookOf().worksheets.find((candidate) => candidate.name === name);
  if (!worksheet) throw new Error(`the workbook has no worksheet named ${name}`);
  return worksheet;
}

/** Creates a filter view over one range of the active worksheet through the `Data` menu. */
async function createFilterOver(grid: HTMLElement, from: string, to: string) {
  selectRange(grid, from, to);
  const menu = await openDataMenu();
  await user.click(within(menu).getByRole("menuitem", { name: "Create filter" }));
  await waitFor(() => expect(workbookOf().worksheets.some((worksheet) => worksheet.filter)).toBe(true));
}

/** Creates a pivot table over one source range through the `Data` menu and its dialog. */
async function createPivotTable(grid: HTMLElement, from: string, to: string) {
  selectRange(grid, from, to);
  const menu = await openDataMenu();
  await user.click(within(menu).getByRole("menuitem", { name: "Create pivot table" }));
  const dialog = await screen.findByRole("dialog", { name: "Create pivot table" });
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
  await screen.findByRole("tab", { name: "Pivot1" });
  return screen.getByRole("region", { name: "Pivot table editor" });
}

async function applyPivotFields(fields: { rows?: string; columns?: string; values: string; summarizeBy: string }) {
  const editor = screen.getByRole("region", { name: "Pivot table editor" });
  if (fields.rows !== undefined) {
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Rows" }), fields.rows);
  }
  if (fields.columns !== undefined) {
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Columns" }), fields.columns);
  }
  await user.selectOptions(within(editor).getByRole("combobox", { name: "Values" }), fields.values);
  await user.selectOptions(within(editor).getByRole("combobox", { name: "Summarize by" }), fields.summarizeBy);
  await user.click(within(editor).getByRole("button", { name: "Apply" }));
}

/** The pivot result worksheet the workbook gained; the tests only ask for it once it exists. */
function pivotSheet() {
  const worksheet = workbookOf().worksheets.find((candidate) => candidate.pivot);
  if (!worksheet?.pivot) throw new Error("the workbook has no pivot result worksheet");
  return worksheet;
}

async function deleteWorksheetThroughMenu(name: string) {
  const menu = await openWorksheetMenu(name);
  await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
  return screen.findByRole("dialog", { name: "Delete worksheet" });
}

describe("adding a worksheet", () => {
  it("adds the next SheetN tab, activates it blank with A1 selected and keeps the other worksheets", async () => {
    const grid = await openSeedWorkbook();
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    const added = await screen.findByRole("tab", { name: "Sheet3" });
    expect(attributeOf(added, "aria-selected")).toBe("true");
    expect(attributeOf(screen.getByRole("tab", { name: "Sheet1" }), "aria-selected")).toBe("false");

    const blank = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(blank).not.toBe(grid);
    expect(within(blank).getByRole("gridcell", { name: "A1" }).textContent).toBe("");
    expect(attributeOf(within(blank).getByRole("gridcell", { name: "A1" }), "aria-selected")).toBe("true");
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("");

    // The created worksheet is blank and carries no data of Sheet1.
    expect(workbookOf().worksheets).toHaveLength(3);
    expect(workbookOf().worksheets[2].cells).toEqual({});
    expect(workbookOf().worksheets[0].cells.A1.value).toBe("Region");
    expect(workbookOf().activeWorksheetId).toBe(workbookOf().worksheets[2].id);

    // Sheet1 still holds its data after switching back.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    const first = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(first).getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(within(first).getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");
  });

  it("keeps the added tab after reopening the workbook", async () => {
    await openSeedWorkbook();
    await user.click(screen.getByRole("button", { name: "Add worksheet" }));
    await screen.findByRole("tab", { name: "Sheet3" });

    cleanup();
    renderApp();

    const reopened = await screen.findByRole("tab", { name: "Sheet3" });
    expect(attributeOf(reopened, "aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeTruthy();
  });

  it("shows an error and adds nothing when the worksheet cannot be created", async () => {
    await openSeedWorkbook();
    api.fetch.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: "Storage unavailable" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Storage unavailable");
    expect(api.state.workbooks[0].worksheets).toHaveLength(2);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2"]);
    expect(attributeOf(screen.getByRole("tab", { name: "Sheet1" }), "aria-selected")).toBe("true");
  });

  it("reuses the first free SheetN name when a number is missing", async () => {
    const workbook = workbookOf();
    workbook.worksheets[1].name = "Data";
    await openSeedWorkbook();

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Sheet1", "Data", "Sheet2"]);
  });
});

describe("renaming a worksheet", () => {
  it("opens Rename from the tab menu, prefills the current name and renames the tab", async () => {
    await openSeedWorkbook();

    const menu = await openWorksheetMenu("Sheet2");
    await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));

    const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
    const input = within(dialog).getByRole("textbox", { name: "Worksheet name" }) as HTMLInputElement;
    expect(input.value).toBe("Sheet2");

    await user.clear(input);
    await user.type(input, "Q3 Actuals");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    const tab = await screen.findByRole("tab", { name: "Q3 Actuals" });
    expect(tab).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Sheet2" })).toBeNull();
    expect(workbookOf().worksheets[1].name).toBe("Q3 Actuals");
    expect(screen.queryByRole("dialog", { name: "Rename worksheet" })).toBeNull();
  });

  it("shows the trimmed name after reopening the workbook", async () => {
    await openSeedWorkbook();
    const menu = await openWorksheetMenu("Sheet1");
    await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
    const input = within(dialog).getByRole("textbox", { name: "Worksheet name" });
    await user.clear(input);
    await user.type(input, "  Regions  ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findByRole("tab", { name: "Regions" });

    cleanup();
    renderApp();

    expect(attributeOf(await screen.findByRole("tab", { name: "Regions" }), "aria-selected")).toBe("true");
    expect(screen.queryByRole("tab", { name: "Sheet1" })).toBeNull();
    expect(workbookOf().worksheets[0].name).toBe("Regions");
    // The renamed worksheet keeps its grid.
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
  });

  it("reports an empty name beside the text box and keeps the original name", async () => {
    await openSeedWorkbook();
    const menu = await openWorksheetMenu("Sheet2");
    await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
    const input = within(dialog).getByRole("textbox", { name: "Worksheet name" });
    const requestsBefore = api.fetch.mock.calls.length;

    await user.clear(input);
    await user.type(input, "   ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(within(dialog).getByRole("alert").textContent).toBe("Worksheet name cannot be empty");
    expect(api.fetch.mock.calls.length).toBe(requestsBefore);
    expect(workbookOf().worksheets[1].name).toBe("Sheet2");
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeTruthy();
  });

  it("reports a duplicate name and keeps the original name", async () => {
    await openSeedWorkbook();
    const menu = await openWorksheetMenu("Sheet2");
    await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
    const input = within(dialog).getByRole("textbox", { name: "Worksheet name" });

    await user.clear(input);
    await user.type(input, "Sheet1");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toBe("Worksheet name already exists"),
    );
    expect(screen.getByRole("dialog", { name: "Rename worksheet" })).toBeTruthy();
    expect(workbookOf().worksheets[1].name).toBe("Sheet2");
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Sheet1" })).toBeTruthy();
  });

  it("keeps the stored name when the save request fails", async () => {
    await openSeedWorkbook();
    const menu = await openWorksheetMenu("Sheet2");
    await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
    const input = within(dialog).getByRole("textbox", { name: "Worksheet name" });
    await user.clear(input);
    await user.type(input, "Broken");
    api.fetch.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: "Storage unavailable" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );

    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(within(dialog).getByRole("alert").textContent).toContain("Storage unavailable");
    expect(workbookOf().worksheets[1].name).toBe("Sheet2");
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeTruthy();
  });
});

describe("worksheet independence", () => {
  it("writes a cell of one worksheet without changing the other one", async () => {
    await openSeedWorkbook();
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));

    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
    await user.type(formulaBar, "Only here{Enter}");

    await waitFor(() => expect(workbookOf().worksheets[1].cells.A1?.value).toBe("Only here"));
    expect(workbookOf().worksheets[0].cells.A1.value).toBe("Region");

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    const first = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(first).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    const second = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(second).getByRole("gridcell", { name: "A1" }).textContent).toBe("Only here");
  });

  it("offers an options button for every worksheet tab", async () => {
    await openSeedWorkbook();

    expect(screen.getByRole("button", { name: "Worksheet options for Sheet1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Worksheet options for Sheet2" })).toBeTruthy();
    for (const button of screen.getAllByRole("button", { name: /^Worksheet options for / })) {
      expect(attributeOf(button, "aria-expanded")).toBe("false");
    }
  });
});

describe("switching worksheets", () => {
  it("switches the grid, the formula bar and the selected cell to the target worksheet", async () => {
    const grid = await openSeedWorkbook();
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(formulaBar().value).toBe("Region");

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));

    const second = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(second).not.toBe(grid);
    expect(attributeOf(screen.getByRole("tab", { name: "Sheet2" }), "aria-selected")).toBe("true");
    expect(attributeOf(screen.getByRole("tab", { name: "Sheet1" }), "aria-selected")).toBe("false");
    // A worksheet without a selection history starts at A1, which is still empty.
    expect(attributeOf(within(second).getByRole("gridcell", { name: "A1" }), "aria-selected")).toBe("true");
    expect(formulaBar().value).toBe("");

    // B2 of Sheet2 holds a formula: the grid shows its result, the formula bar its original text.
    await user.click(within(second).getByRole("gridcell", { name: "B2" }));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "=2+3{Enter}");
    await waitFor(() => expect(worksheetByName("Sheet2").cells.B2?.display).toBe("5"));
    expect(within(second).getByRole("gridcell", { name: "B2" }).textContent).toBe("5");
    expect(formulaBar().value).toBe("=2+3");
    await waitFor(() =>
      expect(worksheetByName("Sheet2").selection).toEqual({
        anchor: { row: 2, column: 2 },
        focus: { row: 2, column: 2 },
      }),
    );

    // Switching back restores the state of Sheet1 and modifies neither worksheet.
    const stored = JSON.stringify(workbookOf().worksheets);
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    const first = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(first).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(within(first).getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(formulaBar().value).toBe("Region");

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(JSON.stringify(workbookOf().worksheets)).toBe(stored);

    // Sheet2 comes back with its own data and its own selected cell.
    const again = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(again).getByRole("gridcell", { name: "B2" }).textContent).toBe("5");
    expect(attributeOf(within(again).getByRole("gridcell", { name: "B2" }), "aria-selected")).toBe("true");
    expect(formulaBar().value).toBe("=2+3");
  });

  it("selects A1 of a worksheet that has no selection history", async () => {
    delete api.state.workbooks[0].worksheets[1].selection;
    await openSeedWorkbook();

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));

    const second = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(attributeOf(within(second).getByRole("gridcell", { name: "A1" }), "aria-selected")).toBe("true");
    expect(formulaBar().value).toBe("");
    expect(within(second).getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe("false");
  });

  it("shows the target worksheet while the switch is still being stored", async () => {
    await openSeedWorkbook();

    // The request that stores the active worksheet never settles: the view still follows the click.
    api.fetch.mockImplementationOnce(() => new Promise<Response>(() => {}));
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));

    expect(attributeOf(screen.getByRole("tab", { name: "Sheet2" }), "aria-selected")).toBe("true");
    expect(attributeOf(screen.getByRole("tab", { name: "Sheet1" }), "aria-selected")).toBe("false");
    const second = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(second).getByRole("gridcell", { name: "A1" }).textContent).toBe("");
    expect(formulaBar().value).toBe("");
  });

  it("reopens at the last active tab and restores the stored selection of every worksheet", async () => {
    const grid = await openSeedWorkbook();
    await user.click(cell(grid, "A2"));
    await waitFor(() =>
      expect(worksheetByName("Sheet1").selection).toEqual({
        anchor: { row: 2, column: 1 },
        focus: { row: 2, column: 1 },
      }),
    );

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    const second = screen.getByRole("grid", { name: "Worksheet grid" });
    await user.click(within(second).getByRole("gridcell", { name: "C3" }));
    await waitFor(() =>
      expect(worksheetByName("Sheet2").selection).toEqual({
        anchor: { row: 3, column: 3 },
        focus: { row: 3, column: 3 },
      }),
    );

    cleanup();
    renderApp();

    await screen.findByRole("heading", { name: "Q3 Sales" });
    expect(attributeOf(screen.getByRole("tab", { name: "Sheet2" }), "aria-selected")).toBe("true");
    const reopened = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(attributeOf(within(reopened).getByRole("gridcell", { name: "C3" }), "aria-selected")).toBe("true");

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    const first = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(attributeOf(within(first).getByRole("gridcell", { name: "A2" }), "aria-selected")).toBe("true");
    expect(formulaBar().value).toBe("East");
  });

  it("shows the filter buttons and the validation entry points of the active worksheet only", async () => {
    const grid = await openSeedWorkbook();
    await createFilterOver(grid, "A1", "C4");
    expect(screen.getByRole("button", { name: "Filter Region" })).toBeTruthy();

    selectRange(grid, "A2", "A4");
    const menu = await openDataMenu();
    await user.click(within(menu).getByRole("menuitem", { name: "Data validation" }));
    const dialog = await screen.findByRole("dialog", { name: "Data validation" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Rule type" }), "Dropdown");
    await user.type(within(dialog).getByRole("textbox", { name: "Allowed values" }), "East, North, South");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(worksheetByName("Sheet1").validations).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Open dropdown for A2" })).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(screen.queryByRole("button", { name: "Filter Region" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open dropdown for A2" })).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(screen.getByRole("button", { name: "Filter Region" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open dropdown for A2" })).toBeTruthy();
    // The filter view and the rule stayed on Sheet1.
    expect(worksheetByName("Sheet1").filter).toBeTruthy();
    expect(worksheetByName("Sheet2").filter ?? null).toBeNull();
    expect(worksheetByName("Sheet2").validations ?? []).toEqual([]);
  });

  it("shows the pivot table editor and its results only on the pivot result worksheet", async () => {
    const grid = await openSeedWorkbook();
    await createPivotTable(grid, "A1", "C4");
    await applyPivotFields({ rows: "Region", values: "Sales", summarizeBy: "SUM" });
    await waitFor(() => expect(pivotSheet().cells.B1?.value).toBe("SUM of Sales"));

    const pivotGrid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(pivotGrid).getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(screen.queryByRole("region", { name: "Pivot table editor" })).toBeNull();
    const source = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(source).getByRole("gridcell", { name: "A2" }).textContent).toBe("East");

    await user.click(screen.getByRole("tab", { name: "Pivot1" }));
    expect(screen.getByRole("region", { name: "Pivot table editor" })).toBeTruthy();
    const back = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(back).getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(within(back).getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");
  });
});

describe("deleting a worksheet", () => {
  it("removes the confirmed tab with its data, activates an adjacent worksheet and stays gone", async () => {
    const grid = await openSeedWorkbook();
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.type(formulaBar(), "Temporary{Enter}");
    await waitFor(() => expect(worksheetByName("Sheet2").cells.A1?.value).toBe("Temporary"));

    const dialog = await deleteWorksheetThroughMenu("Sheet2");
    expect(dialog.textContent).toContain("Sheet2");
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    await waitFor(() => expect(screen.queryByRole("tab", { name: "Sheet2" })).toBeNull());
    expect(workbookOf().worksheets.map((worksheet) => worksheet.name)).toEqual(["Sheet1"]);
    expect(workbookOf().activeWorksheetId).toBe(worksheetByName("Sheet1").id);
    expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull();
    expect(attributeOf(screen.getByRole("tab", { name: "Sheet1" }), "aria-selected")).toBe("true");
    const remaining = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(remaining).not.toBe(grid);
    expect(within(remaining).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");

    cleanup();
    renderApp();

    await screen.findByRole("heading", { name: "Q3 Sales" });
    expect(await screen.findByRole("tab", { name: "Sheet1" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Sheet2" })).toBeNull();
    expect(workbookOf().worksheets.map((worksheet) => worksheet.name)).toEqual(["Sheet1"]);
  });

  it("deletes an inactive tab without changing the active worksheet", async () => {
    await openSeedWorkbook();

    const dialog = await deleteWorksheetThroughMenu("Sheet2");
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    await waitFor(() => expect(screen.queryByRole("tab", { name: "Sheet2" })).toBeNull());
    expect(workbookOf().activeWorksheetId).toBe(worksheetByName("Sheet1").id);
    expect(attributeOf(screen.getByRole("tab", { name: "Sheet1" }), "aria-selected")).toBe("true");
  });

  it("does not open a dialog for the last worksheet and reports the reason", async () => {
    await openSeedWorkbook();
    const dialog = await deleteWorksheetThroughMenu("Sheet2");
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Sheet2" })).toBeNull());

    const menu = await openWorksheetMenu("Sheet1");
    await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));

    expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "A workbook must contain at least one worksheet",
    );
    expect(workbookOf().worksheets.map((worksheet) => worksheet.name)).toEqual(["Sheet1"]);
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeTruthy();
  });

  it("keeps the tab and its grid when the deletion request fails", async () => {
    await openSeedWorkbook();
    const dialog = await deleteWorksheetThroughMenu("Sheet2");
    api.fetch.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: "Storage unavailable" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );

    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    expect(within(dialog).getByRole("alert").textContent).toContain("Storage unavailable");
    expect(workbookOf().worksheets.map((worksheet) => worksheet.name)).toEqual(["Sheet1", "Sheet2"]);
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeTruthy();
    expect(screen.getByRole("grid", { name: "Worksheet grid" })).toBeTruthy();
  });

  it("refuses to delete a worksheet a pivot table still reads and keeps both worksheets", async () => {
    const grid = await openSeedWorkbook();
    await createPivotTable(grid, "A1", "C4");
    await applyPivotFields({ rows: "Region", values: "Sales", summarizeBy: "SUM" });
    await waitFor(() => expect(pivotSheet().cells.B1?.value).toBe("SUM of Sales"));
    const pivotCells = JSON.stringify(pivotSheet().cells);

    const dialog = await deleteWorksheetThroughMenu("Sheet1");
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Please delete or rebuild dependent pivot tables first",
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull());
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Pivot1" })).toBeTruthy();
    expect(worksheetByName("Sheet1").cells.A2.value).toBe("East");
    expect(JSON.stringify(pivotSheet().cells)).toBe(pivotCells);

    // Deleting the pivot result releases the source worksheet.
    const pivotDialog = await deleteWorksheetThroughMenu("Pivot1");
    await user.click(within(pivotDialog).getByRole("button", { name: "Delete worksheet" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Pivot1" })).toBeNull());
    expect(workbookOf().worksheets.map((worksheet) => worksheet.name)).toEqual(["Sheet1", "Sheet2"]);

    const sourceDialog = await deleteWorksheetThroughMenu("Sheet1");
    await user.click(within(sourceDialog).getByRole("button", { name: "Delete worksheet" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Sheet1" })).toBeNull());
    expect(workbookOf().worksheets.map((worksheet) => worksheet.name)).toEqual(["Sheet2"]);
  });
});
