import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fakeApi";

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

/** Finds a cell even while its row is hidden by a filter view. */
function cell(grid: HTMLElement, name: string) {
  return within(grid).getByRole("gridcell", { name, hidden: true });
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

/** Opens the `Sort range` dialog over the currently selected rectangle. */
async function openSortDialog() {
  const menu = await openDataMenu();
  await user.click(within(menu).getByRole("menuitem", { name: "Sort range" }));
  return screen.findByRole("dialog", { name: "Sort range" });
}

/** The first visible texts of the seeded range, row by row, as the grid shows them. */
function gridRows(grid: HTMLElement, rows: string[]) {
  return rows.map((row) => ["A", "B", "C"].map((column) => cell(grid, `${column}${row}`).textContent ?? ""));
}

describe("sorting a selected range", () => {
  it("offers the sort command, names the columns by their header text and sorts the range", async () => {
    const grid = await openSeedWorkbook();
    selectRange(grid, "A1", "C4");

    const dialog = await openSortDialog();

    const sortBy = within(dialog).getByRole("combobox", { name: "Sort by" });
    expect(within(sortBy).getByRole("option", { name: "Region" })).toBeTruthy();
    expect(within(sortBy).getByRole("option", { name: "Sales" })).toBeTruthy();
    expect(within(sortBy).getByRole("option", { name: "Status" })).toBeTruthy();
    const order = within(dialog).getByRole("combobox", { name: "Order" });
    expect(within(order).getByRole("option", { name: "Ascending" })).toBeTruthy();
    expect(within(order).getByRole("option", { name: "Descending" })).toBeTruthy();
    // The seeded first row holds texts in every column, so it is offered as a header row.
    expect((within(dialog).getByRole("checkbox", { name: "Data has header row" }) as HTMLInputElement).checked).toBe(
      true,
    );

    await user.selectOptions(sortBy, "Sales");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() =>
      expect(gridRows(grid, ["1", "2", "3", "4"])).toEqual([
        ["Region", "Sales", "Status"],
        ["South", "700", "Open"],
        ["North", "800", "Closed"],
        ["East", "1200", "Open"],
      ]),
    );
    expect(screen.queryByRole("dialog", { name: "Sort range" })).toBeNull();
  });

  it("sorts descending and keeps the sorted order through a reload of the workbook", async () => {
    const grid = await openSeedWorkbook();
    selectRange(grid, "A1", "C4");

    const dialog = await openSortDialog();
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Sort by" }), "Region");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Order" }), "Descending");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() => expect(sheet().cells.A2.value).toBe("South"));

    const reopened = await reopenSeedWorkbook();
    expect(gridRows(reopened, ["1", "2", "3", "4"])).toEqual([
      ["Region", "Sales", "Status"],
      ["South", "700", "Open"],
      ["North", "800", "Closed"],
      ["East", "1200", "Open"],
    ]);
    expect(reopened).toBeTruthy();
  });

  it("sorts a range whose first row is data when the header checkbox is off", async () => {
    const grid = await openSeedWorkbook();
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
    await user.click(cell(grid, "F1"));
    await user.type(formulaBar, "5{Enter}");
    await user.click(cell(grid, "F2"));
    await user.type(formulaBar, "3{Enter}");
    await waitFor(() => expect(sheet().cells.F1.value).toBe("5"));

    selectRange(grid, "F1", "F2");
    const dialog = await openSortDialog();

    expect((within(dialog).getByRole("checkbox", { name: "Data has header row" }) as HTMLInputElement).checked).toBe(
      false,
    );
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    // Both rows take part, so the numbers come back in ascending order.
    await waitFor(() => expect(sheet().cells.F1.value).toBe("3"));
    expect(sheet().cells.F2.value).toBe("5");
    expect(cell(grid, "F1").textContent).toBe("3");
  });

  it("keeps the dialog open with the failure message and the grid order unchanged", async () => {
    const grid = await openSeedWorkbook();
    selectRange(grid, "A1", "C4");
    const dialog = await openSortDialog();
    api.state.failCellWrites = true;

    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    expect((await within(dialog).findByRole("alert")).textContent).toBe("Storage unavailable");
    expect(screen.getByRole("dialog", { name: "Sort range" })).toBeTruthy();
    expect(gridRows(grid, ["2", "3", "4"])).toEqual([
      ["East", "1200", "Open"],
      ["North", "800", "Closed"],
      ["South", "700", "Open"],
    ]);
  });
});
