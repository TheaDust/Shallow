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

function workbook() {
  return api.state.workbooks[0];
}

function sheet() {
  return workbook().worksheets[0];
}

function cellText(grid: HTMLElement, cellId: string): string {
  return within(grid).getByRole("gridcell", { name: cellId }).textContent ?? "";
}

async function openRowMenu(grid: HTMLElement, row: number) {
  fireEvent.contextMenu(within(grid).getByRole("rowheader", { name: String(row) }), {
    clientX: 60,
    clientY: 90,
  });
  return screen.findByRole("menu", { name: `Row ${row} menu` });
}

async function openColumnMenu(grid: HTMLElement, label: string) {
  fireEvent.contextMenu(within(grid).getByRole("columnheader", { name: label }), {
    clientX: 120,
    clientY: 40,
  });
  return screen.findByRole("menu", { name: `Column ${label} menu` });
}

describe("the row number menu", () => {
  it("opens on right-clicking a row number with the three row commands", async () => {
    const grid = await openSeedWorkbook();

    const menu = await openRowMenu(grid, 2);

    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Insert 1 row above",
      "Insert 1 row below",
      "Delete row",
    ]);
  });

  it("inserts a blank row above the target row and keeps the records after reopening", async () => {
    const grid = await openSeedWorkbook();

    const menu = await openRowMenu(grid, 2);
    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 row above" }));

    await waitFor(() => expect(sheet().cells.A3?.value).toBe("East"));
    expect(cellText(grid, "A1")).toBe("Region");
    expect(cellText(grid, "A2")).toBe("");
    expect(cellText(grid, "B2")).toBe("");
    expect(cellText(grid, "A3")).toBe("East");
    expect(cellText(grid, "B3")).toBe("1200");
    expect(cellText(grid, "A4")).toBe("North");
    expect(cellText(grid, "B5")).toBe("700");
    expect(sheet().rowCount).toBe(13);
    expect(screen.queryByRole("menu", { name: "Row 2 menu" })).toBeNull();

    cleanup();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(cellText(reopened, "A2")).toBe("");
    expect(cellText(reopened, "A3")).toBe("East");
    expect(cellText(reopened, "A5")).toBe("South");
  });

  it("inserts a blank row below the target row", async () => {
    const grid = await openSeedWorkbook();

    const menu = await openRowMenu(grid, 3);
    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 row below" }));

    await waitFor(() => expect(sheet().cells.A5?.value).toBe("South"));
    expect(cellText(grid, "A3")).toBe("North");
    expect(cellText(grid, "B3")).toBe("800");
    expect(cellText(grid, "A4")).toBe("");
    expect(cellText(grid, "A5")).toBe("South");
  });

  it("deletes the target row and moves the following records up", async () => {
    const grid = await openSeedWorkbook();
    await user.click(within(grid).getByRole("gridcell", { name: "A3" }));
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("North");

    const menu = await openRowMenu(grid, 2);
    await user.click(within(menu).getByRole("menuitem", { name: "Delete row" }));

    await waitFor(() => expect(sheet().cells.A2?.value).toBe("North"));
    expect(cellText(grid, "B2")).toBe("800");
    expect(cellText(grid, "C2")).toBe("Closed");
    expect(cellText(grid, "A3")).toBe("South");
    expect(cellText(grid, "A4")).toBe("");
    expect(sheet().cells.A4).toBeUndefined();
    // The selected cell followed the shift, so the formula bar shows the same record.
    expect(within(grid).getByRole("gridcell", { name: "A2" }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("North");

    cleanup();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(cellText(reopened, "A2")).toBe("North");
    expect(cellText(reopened, "A3")).toBe("South");
  });

  it("keeps the other worksheet of the workbook unchanged", async () => {
    const grid = await openSeedWorkbook();

    const menu = await openRowMenu(grid, 2);
    await user.click(within(menu).getByRole("menuitem", { name: "Delete row" }));
    await waitFor(() => expect(sheet().cells.A2?.value).toBe("North"));

    expect(workbook().worksheets.map((worksheet) => worksheet.name)).toEqual(["Sheet1", "Sheet2"]);
    expect(workbook().worksheets[1].cells).toEqual({});
    expect(workbook().worksheets[1].rowCount).toBe(12);
  });

  it("reports a failed command and keeps the pre-operation structure", async () => {
    const grid = await openSeedWorkbook();
    api.state.failCellWrites = true;

    const menu = await openRowMenu(grid, 2);
    await user.click(within(menu).getByRole("menuitem", { name: "Delete row" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Storage unavailable");
    expect(cellText(grid, "A2")).toBe("East");
    expect(cellText(grid, "B2")).toBe("1200");
    expect(cellText(grid, "A3")).toBe("North");
    expect(sheet().cells.A2?.value).toBe("East");
    expect(sheet().cells.A4?.value).toBe("South");
  });

  it("shows the message of a shifted 0-to-100 rule that rejects an out-of-range value", async () => {
    sheet().validations = [
      {
        id: "vr_1",
        type: "numberRange",
        range: { top: 2, bottom: 2, left: 2, right: 2 },
        min: 0,
        max: 100,
        message: "Please enter a number from 0 to 100",
      },
    ];
    const grid = await openSeedWorkbook();

    const menu = await openRowMenu(grid, 2);
    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 row above" }));
    await waitFor(() => expect(sheet().validations?.[0].range.top).toBe(3));
    expect(sheet().validations?.[0].message).toBe("Please enter a number from 0 to 100");

    await user.dblClick(within(grid).getByRole("gridcell", { name: "B3" }));
    await user.type(within(grid).getByRole("textbox", { name: "Edit B3" }), "101{Enter}");

    expect((await screen.findByRole("alert")).textContent).toBe("Please enter a number from 0 to 100");
    expect(sheet().cells.B3?.value).toBe("1200");
    expect(cellText(grid, "B3")).toBe("1200");
  });
});

describe("the column header menu", () => {
  it("opens on right-clicking a column letter with the three column commands", async () => {
    const grid = await openSeedWorkbook();

    const menu = await openColumnMenu(grid, "B");

    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Insert 1 column left",
      "Insert 1 column right",
      "Delete column",
    ]);
  });

  it("inserts a blank column left of the target column", async () => {
    const grid = await openSeedWorkbook();

    const menu = await openColumnMenu(grid, "B");
    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 column left" }));

    await waitFor(() => expect(sheet().cells.C1?.value).toBe("Sales"));
    expect(cellText(grid, "A1")).toBe("Region");
    expect(cellText(grid, "B1")).toBe("");
    expect(cellText(grid, "C1")).toBe("Sales");
    expect(cellText(grid, "C2")).toBe("1200");
    expect(cellText(grid, "D2")).toBe("Open");
    expect(sheet().columnCount).toBe(7);

    cleanup();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(cellText(reopened, "C2")).toBe("1200");
  });

  it("inserts a blank column right of the target column", async () => {
    const grid = await openSeedWorkbook();

    const menu = await openColumnMenu(grid, "A");
    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 column right" }));

    await waitFor(() => expect(sheet().cells.C1?.value).toBe("Sales"));
    expect(cellText(grid, "A1")).toBe("Region");
    expect(cellText(grid, "B1")).toBe("");
    expect(cellText(grid, "C2")).toBe("1200");
  });

  it("deletes the target column and preserves the data outside it", async () => {
    sheet().cells.F1 = { value: "=A2", display: "East" };
    const grid = await openSeedWorkbook();

    const menu = await openColumnMenu(grid, "A");
    await user.click(within(menu).getByRole("menuitem", { name: "Delete column" }));

    await waitFor(() => expect(sheet().cells.A2?.value).toBe("1200"));
    expect(cellText(grid, "A1")).toBe("Sales");
    expect(cellText(grid, "B2")).toBe("Open");
    expect(cellText(grid, "A3")).toBe("800");
    expect(sheet().cells.C2).toBeUndefined();
    // The deleted column cannot be referenced any more.
    expect(sheet().cells.E1?.value).toBe("=#REF!");

    cleanup();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(cellText(reopened, "A2")).toBe("1200");
    expect(cellText(reopened, "B2")).toBe("Open");
  });
});
