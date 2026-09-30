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

function sheet() {
  return api.state.workbooks[0].worksheets[0];
}

function attributeOf(element: Element, name: string): string | null {
  return element.getAttribute(name);
}

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
}

describe("editing a cell through the grid", () => {
  it("opens an inline text box named after the cell and commits the typed value with Enter", async () => {
    const grid = await openSeedWorkbook();

    await user.dblClick(within(grid).getByRole("gridcell", { name: "D1" }));
    const editor = within(grid).getByRole("textbox", { name: "Edit D1" });

    await user.type(editor, "East{Enter}");

    await waitFor(() => expect(sheet().cells.D1?.value).toBe("East"));
    expect(within(grid).getByRole("gridcell", { name: "D1" }).textContent).toBe("East");
    expect(formulaBar().value).toBe("East");
    expect(within(grid).queryByRole("textbox", { name: "Edit D1" })).toBeNull();

    cleanup();
    renderApp();
    const reloaded = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(within(reloaded).getByRole("gridcell", { name: "D1" }).textContent).toBe("East");
  });

  it("commits an uncommitted grid edit when another cell is clicked", async () => {
    const grid = await openSeedWorkbook();

    await user.dblClick(within(grid).getByRole("gridcell", { name: "D1" }));
    await user.type(within(grid).getByRole("textbox", { name: "Edit D1" }), "North");
    await user.click(within(grid).getByRole("gridcell", { name: "E1" }));

    await waitFor(() => expect(sheet().cells.D1?.value).toBe("North"));
    expect(within(grid).getByRole("gridcell", { name: "D1" }).textContent).toBe("North");
    expect(attributeOf(within(grid).getByRole("gridcell", { name: "E1" }), "aria-selected")).toBe("true");
    expect(within(grid).queryByRole("textbox", { name: "Edit D1" })).toBeNull();
  });

  it("cancels an uncommitted grid edit with Escape and keeps the stored cell value", async () => {
    const grid = await openSeedWorkbook();
    const requestsBefore = api.fetch.mock.calls.length;

    await user.dblClick(within(grid).getByRole("gridcell", { name: "D1" }));
    const editor = within(grid).getByRole("textbox", { name: "Edit D1" });
    await user.type(editor, "West");
    await user.keyboard("{Escape}");

    expect(within(grid).queryByRole("textbox", { name: "Edit D1" })).toBeNull();
    expect(within(grid).getByRole("gridcell", { name: "D1" }).textContent).toBe("");
    expect(formulaBar().value).toBe("");
    expect(sheet().cells.D1).toBeUndefined();
    expect(api.fetch.mock.calls.length).toBe(requestsBefore + 1); // only the selection save
  });

  it("starts an inline edit when a printable character is typed on the focused grid", async () => {
    const grid = await openSeedWorkbook();

    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));
    await user.keyboard("7");

    const editor = within(grid).getByRole("textbox", { name: "Edit D1" });
    expect((editor as HTMLInputElement).value).toBe("7");

    await user.keyboard("{Enter}");
    await waitFor(() => expect(sheet().cells.D1?.value).toBe("7"));
  });

  it("shows the calculated result in the grid and the original formula in the formula bar", async () => {
    sheet().cells.D1 = { value: "=B2+B3", display: "2000" };
    sheet().cells.E1 = { value: "=D1*2", display: "4000" };
    const grid = await openSeedWorkbook();

    expect(within(grid).getByRole("gridcell", { name: "D1" }).textContent).toBe("2000");
    expect(within(grid).getByRole("gridcell", { name: "E1" }).textContent).toBe("4000");

    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));
    expect(formulaBar().value).toBe("=B2+B3");
  });

  it("renders the recalculated dependent results the server returns after a source edit", async () => {
    sheet().cells.D1 = { value: "=B2+B3", display: "2000" };
    sheet().cells.E1 = { value: "=D1*2", display: "4000" };
    const grid = await openSeedWorkbook();

    const realFetch = api.fetch.getMockImplementation()!;
    let patched = false;
    api.fetch.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const response = await realFetch(input, init);
      const url = typeof input === "string" ? input : input.toString();
      if (patched || !/worksheets\/[^/]+\/cells\/B2$/.test(url)) return response;
      patched = true;
      const body = (await response.clone().json()) as { workbook: (typeof api.state)["workbooks"][number] };
      body.workbook.worksheets[0].cells.E1 = { value: "=D1*2", display: "3000" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });

    await user.dblClick(within(grid).getByRole("gridcell", { name: "B2" }));
    await user.clear(within(grid).getByRole("textbox", { name: "Edit B2" }));
    await user.type(within(grid).getByRole("textbox", { name: "Edit B2" }), "1500{Enter}");

    await waitFor(() => expect(within(grid).getByRole("gridcell", { name: "E1" }).textContent).toBe("3000"));
  });

  it("reports a failed commit and keeps the last successful grid and formula bar content", async () => {
    const grid = await openSeedWorkbook();

    await user.dblClick(within(grid).getByRole("gridcell", { name: "D1" }));
    await user.type(within(grid).getByRole("textbox", { name: "Edit D1" }), "East{Enter}");
    await waitFor(() => expect(sheet().cells.D1?.value).toBe("East"));

    api.state.failCellWrites = true;
    await user.dblClick(within(grid).getByRole("gridcell", { name: "D1" }));
    await user.clear(within(grid).getByRole("textbox", { name: "Edit D1" }));
    await user.type(within(grid).getByRole("textbox", { name: "Edit D1" }), "Broken{Enter}");

    expect((await screen.findByRole("alert")).textContent).toContain("Storage unavailable");
    await waitFor(() => expect(within(grid).getByRole("gridcell", { name: "D1" }).textContent).toBe("East"));
    expect(formulaBar().value).toBe("East");
    expect(sheet().cells.D1?.value).toBe("East");
  });

  it("cancels an uncommitted formula bar edit with Escape", async () => {
    await openSeedWorkbook();
    const requestsBefore = api.fetch.mock.calls.length;

    await user.click(formulaBar());
    await user.type(formulaBar(), "West{Escape}");

    expect(formulaBar().value).toBe("Region");
    expect(sheet().cells.A1?.value).toBe("Region");
    expect(api.fetch.mock.calls.length).toBe(requestsBefore);
  });
});

describe("selecting a rectangular range", () => {
  const cell = (grid: HTMLElement, name: string) => within(grid).getByRole("gridcell", { name });

  it("selects the dragged rectangle and reports it through aria-selected", async () => {
    const grid = await openSeedWorkbook();

    fireEvent.mouseDown(cell(grid, "D1"));
    fireEvent.mouseEnter(cell(grid, "E2"));
    fireEvent.mouseUp(cell(grid, "E2"));

    for (const name of ["D1", "E1", "D2", "E2"]) {
      expect(attributeOf(cell(grid, name), "aria-selected")).toBe("true");
    }
    for (const name of ["A1", "C1", "D3", "F1"]) {
      expect(attributeOf(cell(grid, name), "aria-selected")).toBe("false");
    }

    await waitFor(() =>
      expect(sheet().selection).toEqual({ anchor: { row: 1, column: 4 }, focus: { row: 2, column: 5 } }),
    );
  });

  it("restores the saved rectangle after reopening the workbook", async () => {
    const grid = await openSeedWorkbook();

    fireEvent.mouseDown(cell(grid, "D1"));
    fireEvent.mouseEnter(cell(grid, "E2"));
    fireEvent.mouseUp(cell(grid, "E2"));
    await waitFor(() => expect(sheet().selection).toBeTruthy());

    cleanup();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });

    for (const name of ["D1", "E1", "D2", "E2"]) {
      expect(attributeOf(within(reopened).getByRole("gridcell", { name }), "aria-selected")).toBe("true");
    }
    expect(attributeOf(within(reopened).getByRole("gridcell", { name: "A1" }), "aria-selected")).toBe("false");
  });

  it("replaces the previous selection when another cell is selected", async () => {
    const grid = await openSeedWorkbook();

    fireEvent.mouseDown(cell(grid, "D1"));
    fireEvent.mouseEnter(cell(grid, "E2"));
    fireEvent.mouseUp(cell(grid, "E2"));
    fireEvent.mouseDown(cell(grid, "A1"));
    fireEvent.mouseUp(cell(grid, "A1"));

    expect(attributeOf(cell(grid, "A1"), "aria-selected")).toBe("true");
    expect(attributeOf(cell(grid, "D1"), "aria-selected")).toBe("false");
    expect(attributeOf(cell(grid, "E2"), "aria-selected")).toBe("false");
    await waitFor(() => expect(sheet().selection).toEqual({ anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } }));
  });

  it("keeps the selection of a worksheet when another worksheet is opened", async () => {
    const second = api.state.workbooks[0].worksheets[1];
    expect(second.name).toBe("Sheet2");
    second.cells = { A1: { value: "Second sheet" } };
    const grid = await openSeedWorkbook();

    fireEvent.mouseDown(cell(grid, "D1"));
    fireEvent.mouseEnter(cell(grid, "E2"));
    fireEvent.mouseUp(cell(grid, "E2"));
    await waitFor(() =>
      expect(sheet().selection).toEqual({ anchor: { row: 1, column: 4 }, focus: { row: 2, column: 5 } }),
    );

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));

    const reopened = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(attributeOf(within(reopened).getByRole("gridcell", { name: "D1" }), "aria-selected")).toBe("true");
    expect(attributeOf(within(reopened).getByRole("gridcell", { name: "A1" }), "aria-selected")).toBe("false");
    expect(sheet().selection).toEqual({ anchor: { row: 1, column: 4 }, focus: { row: 2, column: 5 } });
    expect(api.state.workbooks[0].worksheets[1].selection).toEqual({
      anchor: { row: 1, column: 1 },
      focus: { row: 1, column: 1 },
    });
  });
});

describe("pasting a two dimensional table", () => {
  it("applies the whole pasted rectangle from the clipboard event and keeps it after reopening", async () => {
    const grid = await openSeedWorkbook();
    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));

    fireEvent.paste(grid, { clipboardData: { getData: () => "East\t1200\nNorth\t800" } });

    await waitFor(() => expect(sheet().cells.D1?.value).toBe("East"));
    expect(sheet().cells.E1?.value).toBe("1200");
    expect(sheet().cells.D2?.value).toBe("North");
    expect(sheet().cells.E2?.value).toBe("800");
    expect(sheet().cells.A1?.value).toBe("Region");
    expect(within(grid).getByRole("gridcell", { name: "E2" }).textContent).toBe("800");

    cleanup();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(within(reopened).getByRole("gridcell", { name: "D2" }).textContent).toBe("North");
  });

  it("pastes from the Paste command of the grid context menu", async () => {
    const grid = await openSeedWorkbook();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: vi.fn(async () => "7\t8") },
    });

    fireEvent.contextMenu(within(grid).getByRole("gridcell", { name: "D1" }), { clientX: 40, clientY: 60 });
    const menu = await screen.findByRole("menu", { name: "Grid context menu" });
    await user.click(within(menu).getByRole("menuitem", { name: "Paste" }));

    await waitFor(() => expect(sheet().cells.D1?.value).toBe("7"));
    expect(sheet().cells.E1?.value).toBe("8");
  });

  it("reports the 0-to-100 rule message and leaves every target cell untouched when the paste is rejected", async () => {
    sheet().validations = [
      {
        id: "vr_1",
        type: "numberRange",
        range: { top: 1, bottom: 2, left: 4, right: 5 },
        min: 0,
        max: 100,
        message: "Please enter a number from 0 to 100",
      },
    ];
    const grid = await openSeedWorkbook();
    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));

    fireEvent.paste(grid, { clipboardData: { getData: () => "50\t1200" } });

    expect((await screen.findByRole("alert")).textContent).toBe("Please enter a number from 0 to 100");
    expect(sheet().cells.D1).toBeUndefined();
    expect(sheet().cells.E1).toBeUndefined();
    expect(within(grid).getByRole("gridcell", { name: "D1" }).textContent).toBe("");
  });
});
