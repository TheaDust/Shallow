import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fakeApi";
import type { ValidationRuleData } from "../workbooks/types";

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

function sheet() {
  const worksheet = api.state.workbooks[0].worksheets[0];
  if (!worksheet) throw new Error("the seeded worksheet is missing");
  return worksheet;
}

/** The filter view of the seeded worksheet; the tests only ask for it once it exists. */
function filterOf() {
  const filter = sheet().filter;
  if (!filter) throw new Error("the worksheet has no filter view");
  return filter;
}

function ruleAt(index: number): ValidationRuleData {
  const rule = sheet().validations?.[index];
  if (!rule) throw new Error("the worksheet has no validation rule");
  return rule;
}

/** Finds a cell even while its row is hidden by the filter view. */
function cell(grid: HTMLElement, name: string) {
  return within(grid).getByRole("gridcell", { name, hidden: true });
}

function rowOf(grid: HTMLElement, name: string) {
  const row = cell(grid, name).closest('[role="row"]');
  if (!row) throw new Error(`row of ${name} not found`);
  return row;
}

function isRowHidden(grid: HTMLElement, name: string): boolean {
  return rowOf(grid, name).hasAttribute("hidden");
}

/** Drags from one corner of a rectangle to the opposite corner, as the range selection does. */
function selectRange(grid: HTMLElement, from: string, to: string) {
  fireEvent.mouseDown(cell(grid, from));
  fireEvent.mouseEnter(cell(grid, to));
  fireEvent.mouseUp(cell(grid, to));
}

async function openDataMenu() {
  await user.click(screen.getByRole("button", { name: "Data" }));
  return screen.findByRole("menu", { name: "Data" });
}

async function createFilterOver(grid: HTMLElement, from: string, to: string) {
  selectRange(grid, from, to);
  const menu = await openDataMenu();
  await user.click(within(menu).getByRole("menuitem", { name: "Create filter" }));
  await waitFor(() => expect(sheet().filter).toBeTruthy());
}

async function openFilterDialog(name: string) {
  await user.click(screen.getByRole("button", { name }));
  return screen.findByRole("dialog", { name });
}

describe("the Data menu", () => {
  it("exposes the data commands as menu items of the toolbar Data button", async () => {
    await openSeedWorkbook();

    const menu = await openDataMenu();

    expect(within(menu).getByRole("menuitem", { name: "Create filter" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Clear filter" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Data validation" })).toBeTruthy();
  });

  it("creates a filter over the selected region and gives every header a filter button", async () => {
    const grid = await openSeedWorkbook();

    await createFilterOver(grid, "A1", "C4");

    expect(screen.getByRole("button", { name: "Filter Region" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter Sales" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter Status" })).toBeTruthy();
    expect(filterOf().region).toEqual({ top: 1, bottom: 4, left: 1, right: 3 });
    expect(filterOf().columns).toEqual([]);
  });

  it("asks for a data range when a single cell does not start a block with a header row", async () => {
    const grid = await openSeedWorkbook();

    await user.click(cell(grid, "F5"));
    const menu = await openDataMenu();
    await user.click(within(menu).getByRole("menuitem", { name: "Create filter" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Select a range with a header row");
    expect(sheet().filter).toBeNull();
  });
});

describe("filtering rows by value", () => {
  it("hides the rows of the unchecked values and keeps the filter view after reopening", async () => {
    const grid = await openSeedWorkbook();
    await createFilterOver(grid, "A1", "C4");

    const dialog = await openFilterDialog("Filter Region");
    expect(within(dialog).getByRole("checkbox", { name: "East" })).toBeTruthy();
    expect(within(dialog).getByRole("checkbox", { name: "North" })).toBeTruthy();
    expect(within(dialog).getByRole("checkbox", { name: "South" })).toBeTruthy();
    await user.click(within(dialog).getByRole("checkbox", { name: "North" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(filterOf().columns).toEqual([{ column: 1, kind: "values", selected: ["East", "South"] }]));
    expect(isRowHidden(grid, "A3")).toBe(true);
    expect(isRowHidden(grid, "A2")).toBe(false);
    expect(isRowHidden(grid, "A4")).toBe(false);
    expect(sheet().cells.A3.value).toBe("North");

    cleanup();
    const reopened = await reopenSeedWorkbook();
    expect(isRowHidden(reopened, "A3")).toBe(true);
    expect(isRowHidden(reopened, "A2")).toBe(false);
    expect(screen.getByRole("button", { name: "Filter Region" })).toBeTruthy();
  });

  it("restores every source row with Clear selection applied to no value", async () => {
    const grid = await openSeedWorkbook();
    await createFilterOver(grid, "A1", "C4");

    const dialog = await openFilterDialog("Filter Region");
    await user.click(within(dialog).getByRole("button", { name: "Clear selection" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(filterOf().columns).toEqual([{ column: 1, kind: "values", selected: [] }]));
    for (const name of ["A2", "A3", "A4"]) expect(isRowHidden(grid, name)).toBe(true);
  });
});

describe("filtering rows by condition", () => {
  it("combines the conditions of two columns with AND and hides only the nonmatching rows", async () => {
    const grid = await openSeedWorkbook();
    await createFilterOver(grid, "A1", "C4");

    const sales = await openFilterDialog("Filter Sales");
    await user.selectOptions(within(sales).getByRole("combobox", { name: "Condition" }), "Greater than");
    await user.type(within(sales).getByRole("textbox", { name: "Value" }), "900");
    await user.click(within(sales).getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(filterOf().columns).toEqual([{ column: 2, kind: "condition", condition: "greaterThan", value: "900" }]),
    );
    expect(isRowHidden(grid, "A3")).toBe(true);
    expect(isRowHidden(grid, "A4")).toBe(true);
    expect(isRowHidden(grid, "A2")).toBe(false);

    const status = await openFilterDialog("Filter Status");
    await user.selectOptions(within(status).getByRole("combobox", { name: "Condition" }), "Is not empty");
    await user.click(within(status).getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(filterOf().columns).toEqual([
        { column: 2, kind: "condition", condition: "greaterThan", value: "900" },
        { column: 3, kind: "condition", condition: "isNotEmpty", value: "" },
      ]),
    );

    // AND: North (800) and South (700) both fail "Greater than 900"; no row is deleted or reordered.
    expect(isRowHidden(grid, "A3")).toBe(true);
    expect(isRowHidden(grid, "A4")).toBe(true);
    expect(isRowHidden(grid, "A2")).toBe(false);
    expect(sheet().cells.A3.value).toBe("North");
    expect(sheet().cells.C3.value).toBe("Closed");

    const region = await openFilterDialog("Filter Region");
    await user.selectOptions(within(region).getByRole("combobox", { name: "Condition" }), "Text contains");
    await user.type(within(region).getByRole("textbox", { name: "Value" }), "north");
    await user.click(within(region).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(filterOf().columns[0]).toEqual({ column: 1, kind: "condition", condition: "textContains", value: "north" }));

    // Only North matches the region text, but it fails the sales condition: no row is left visible.
    expect(isRowHidden(grid, "A2")).toBe(true);
    expect(isRowHidden(grid, "A3")).toBe(true);
    expect(isRowHidden(grid, "A4")).toBe(true);

    const relaxed = await openFilterDialog("Filter Sales");
    expect((within(relaxed).getByRole("textbox", { name: "Value" }) as HTMLInputElement).value).toBe("900");
    await user.clear(within(relaxed).getByRole("textbox", { name: "Value" }));
    await user.type(within(relaxed).getByRole("textbox", { name: "Value" }), "700");
    await user.click(within(relaxed).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(isRowHidden(grid, "A3")).toBe(false));
    expect(isRowHidden(grid, "A2")).toBe(true);
    expect(isRowHidden(grid, "A4")).toBe(true);
    expect(sheet().cells.A2.value).toBe("East");
    expect(sheet().cells.A3.value).toBe("North");
    expect(sheet().cells.A4.value).toBe("South");
  });

  it("keeps the dialog open with a message when the condition needs a value", async () => {
    const grid = await openSeedWorkbook();
    await createFilterOver(grid, "A1", "C4");

    const dialog = await openFilterDialog("Filter Sales");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Condition" }), "Before");
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Filter Sales" })).toBeTruthy();
    expect(filterOf().columns).toEqual([]);
    expect(grid).toBeTruthy();
  });
});

describe("clearing the filter view", () => {
  it("makes every row visible again, keeps the values and stays cleared after reopening", async () => {
    const grid = await openSeedWorkbook();
    await createFilterOver(grid, "A1", "C4");
    const dialog = await openFilterDialog("Filter Region");
    await user.click(within(dialog).getByRole("checkbox", { name: "North" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(isRowHidden(grid, "A3")).toBe(true));

    const menu = await openDataMenu();
    await user.click(within(menu).getByRole("menuitem", { name: "Clear filter" }));

    await waitFor(() => expect(sheet().filter).toBeNull());
    for (const name of ["A2", "A3", "A4"]) expect(isRowHidden(grid, name)).toBe(false);
    expect(screen.queryByRole("button", { name: "Filter Region" })).toBeNull();
    expect(sheet().cells.A2.value).toBe("East");
    expect(sheet().cells.A3.value).toBe("North");
    expect(sheet().cells.A4.value).toBe("South");

    cleanup();
    const reopened = await reopenSeedWorkbook();
    expect(isRowHidden(reopened, "A3")).toBe(false);
    expect(screen.queryByRole("button", { name: "Filter Region" })).toBeNull();
  });
});

describe("data validation rules", () => {
  async function openValidationDialog(grid: HTMLElement, from: string, to: string) {
    selectRange(grid, from, to);
    const menu = await openDataMenu();
    await user.click(within(menu).getByRole("menuitem", { name: "Data validation" }));
    return screen.findByRole("dialog", { name: "Data validation" });
  }

  it("saves an inclusive number range rule for the selected range and rejects a value outside it", async () => {
    const grid = await openSeedWorkbook();
    const dialog = await openValidationDialog(grid, "B2", "B3");

    const ruleType = within(dialog).getByRole("combobox", { name: "Rule type" });
    expect(within(ruleType).getByRole("option", { name: "Dropdown" })).toBeTruthy();
    expect(within(ruleType).getByRole("option", { name: "Number range" })).toBeTruthy();
    await user.selectOptions(ruleType, "Number range");
    await user.type(within(dialog).getByRole("textbox", { name: "Minimum" }), "1000");
    await user.type(within(dialog).getByRole("textbox", { name: "Maximum" }), "2000");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sheet().validations).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: "Data validation" })).toBeNull();
    expect(ruleAt(0)).toMatchObject({ type: "numberRange", min: 1000, max: 2000 });
    expect(ruleAt(0).range).toEqual({ top: 2, bottom: 3, left: 2, right: 2 });

    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
    await user.click(cell(grid, "B3"));
    await user.clear(formulaBar);
    await user.type(formulaBar, "900{Enter}");

    expect((await screen.findByRole("alert")).textContent).toBe("Please enter a number between 1000 and 2000");
    expect(sheet().cells.B3.value).toBe("800");
    expect(cell(grid, "B3").textContent).toBe("800");
  });

  it("configures a dropdown rule with trimmed allowed values and writes through its options", async () => {
    const grid = await openSeedWorkbook();
    const dialog = await openValidationDialog(grid, "C2", "C4");

    await user.type(within(dialog).getByRole("textbox", { name: "Allowed values" }), " Open , Closed ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sheet().validations).toHaveLength(1));
    expect(ruleAt(0).allowedValues).toEqual(["Open", "Closed"]);

    const dropdown = screen.getByRole("button", { name: "Open dropdown for C4" });
    await user.click(dropdown);
    const listbox = await screen.findByRole("listbox", { name: "Options for C4" });
    expect(within(listbox).getByRole("option", { name: "Open" })).toBeTruthy();
    expect(within(listbox).getByRole("option", { name: "Closed" })).toBeTruthy();

    await user.click(within(listbox).getByRole("option", { name: "Closed" }));

    await waitFor(() => expect(sheet().cells.C4.value).toBe("Closed"));
    expect(cell(grid, "C4").textContent).toContain("Closed");
    expect(sheet().validations).toHaveLength(1);

    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
    await user.click(cell(grid, "C4"));
    await user.clear(formulaBar);
    await user.type(formulaBar, "Pending{Enter}");

    expect((await screen.findByRole("alert")).textContent).toBe("Please select one of the following values: Open, Closed");
    expect(sheet().cells.C4.value).toBe("Closed");
  });

  it("reopens an existing rule prefilled and deletes it without changing the cell values", async () => {
    const grid = await openSeedWorkbook();
    const first = await openValidationDialog(grid, "C2", "C4");
    await user.type(within(first).getByRole("textbox", { name: "Allowed values" }), "Open, Closed");
    await user.click(within(first).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sheet().validations).toHaveLength(1));

    const reopened = await openValidationDialog(grid, "C2", "C2");
    expect(within(reopened).getByRole("button", { name: "Delete rule" })).toBeTruthy();
    expect((within(reopened).getByRole("textbox", { name: "Allowed values" }) as HTMLInputElement).value).toBe("Open, Closed");
    expect((within(reopened).getByRole("combobox", { name: "Rule type" }) as HTMLSelectElement).value).toBe("dropdown");

    await user.click(within(reopened).getByRole("button", { name: "Delete rule" }));

    await waitFor(() => expect(sheet().validations).toEqual([]));
    expect(screen.queryByRole("dialog", { name: "Data validation" })).toBeNull();
    expect(sheet().cells.C2.value).toBe("Open");
    expect(sheet().cells.C4.value).toBe("Open");
    expect(screen.queryByRole("button", { name: "Open dropdown for C4" })).toBeNull();
  });

  it("keeps the dialog open with the server message when a rule cannot be saved", async () => {
    const grid = await openSeedWorkbook();
    const dialog = await openValidationDialog(grid, "C2", "C4");

    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect((await within(dialog).findByRole("alert")).textContent).toBe("Enter at least one allowed value");
    expect(sheet().validations).toEqual([]);
    expect(grid).toBeTruthy();
  });
});
