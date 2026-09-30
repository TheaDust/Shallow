import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { createFakeApi, type FakeApi } from "../test/fakeApi";

let api: FakeApi;
let user: ReturnType<typeof userEvent.setup>;
let clipboardText = "";

function renderApp() {
  return render(<App />);
}

beforeEach(() => {
  api = createFakeApi();
  vi.stubGlobal("fetch", api.fetch);
  window.location.hash = "#/";
  clipboardText = "";
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

function sheet(workbookIndex = 0, worksheetIndex = 0) {
  return api.state.workbooks[workbookIndex].worksheets[worksheetIndex];
}

const cell = (grid: HTMLElement, name: string) => within(grid).getByRole("gridcell", { name });

function dragSelect(grid: HTMLElement, from: string, to: string) {
  fireEvent.mouseDown(cell(grid, from));
  fireEvent.mouseEnter(cell(grid, to));
  fireEvent.mouseUp(cell(grid, to));
}

/** The browser copy event the grid answers with the tab separated rectangle. */
function copyEvent(grid: HTMLElement) {
  const setData = vi.fn();
  fireEvent.copy(grid, { clipboardData: { setData } });
  return setData;
}

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
}

/** jsdom has no system clipboard: the tests that paste external text install one. */
function defineClipboard() {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      readText: async () => clipboardText,
      writeText: async () => undefined,
    },
  });
}

async function openGridMenu(grid: HTMLElement, name: string) {
  fireEvent.contextMenu(cell(grid, name), { clientX: 40, clientY: 60 });
  return screen.findByRole("menu", { name: "Grid context menu" });
}

describe("copying and pasting a rectangular range", () => {
  it("copies the dragged rectangle with Ctrl+C and pastes it with Ctrl+V, keeping both after reopening", async () => {
    const grid = await openSeedWorkbook();

    dragSelect(grid, "A2", "B3");
    const setData = copyEvent(grid);
    expect(setData).toHaveBeenCalledWith("text/plain", "East\t1200\nNorth\t800");

    await user.click(cell(grid, "D1"));
    fireEvent.keyDown(grid, { key: "v", ctrlKey: true });

    await waitFor(() => expect(sheet().cells.D1?.value).toBe("East"));
    expect(sheet().cells.E1?.value).toBe("1200");
    expect(sheet().cells.D2?.value).toBe("North");
    expect(sheet().cells.E2?.value).toBe("800");
    expect(cell(grid, "D2").textContent).toBe("North");
    // The source range keeps its values, and nothing outside the two rectangles changes.
    expect(sheet().cells.A2?.value).toBe("East");
    expect(sheet().cells.B2?.value).toBe("1200");
    expect(sheet().cells.A3?.value).toBe("North");
    expect(sheet().cells.B3?.value).toBe("800");
    expect(sheet().cells.A1?.value).toBe("Region");

    cleanup();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(cell(reopened, "D1").textContent).toBe("East");
    expect(cell(reopened, "E2").textContent).toBe("800");
    expect(cell(reopened, "A2").textContent).toBe("East");
  });

  it("copies from the toolbar and pastes at the selected target without a keyboard", async () => {
    const grid = await openSeedWorkbook();

    dragSelect(grid, "A2", "B2");
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await user.click(cell(grid, "D1"));
    await user.click(screen.getByRole("button", { name: "Paste" }));

    await waitFor(() => expect(sheet().cells.D1?.value).toBe("East"));
    expect(sheet().cells.E1?.value).toBe("1200");
    expect(sheet().cells.A2?.value).toBe("East");
    expect(sheet().cells.B2?.value).toBe("1200");
  });

  it("moves a cut range from the context menu and clears the source cells", async () => {
    const grid = await openSeedWorkbook();

    dragSelect(grid, "A2", "B2");
    const menu = await openGridMenu(grid, "A2");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Cut", "Copy", "Paste"]);
    await user.click(within(menu).getByRole("menuitem", { name: "Cut" }));

    await user.click(cell(grid, "D1"));
    const pasteMenu = await openGridMenu(grid, "D1");
    await user.click(within(pasteMenu).getByRole("menuitem", { name: "Paste" }));

    await waitFor(() => expect(sheet().cells.D1?.value).toBe("East"));
    expect(sheet().cells.E1?.value).toBe("1200");
    expect(sheet().cells.A2).toBeUndefined();
    expect(sheet().cells.B2).toBeUndefined();
    expect(cell(grid, "A2").textContent).toBe("");
    expect(cell(grid, "E1").textContent).toBe("1200");

    cleanup();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(cell(reopened, "E1").textContent).toBe("1200");
    expect(cell(reopened, "A2").textContent).toBe("");
  });

  it("adjusts relative references of a copied formula and shows the adjusted formula in the formula bar", async () => {
    sheet().cells.D1 = { value: "=B2+$B$2", display: "2400" };
    const grid = await openSeedWorkbook();

    await user.click(cell(grid, "D1"));
    copyEvent(grid);
    await user.click(cell(grid, "F1"));
    fireEvent.paste(grid, { clipboardData: { getData: () => "" } });

    await waitFor(() => expect(sheet().cells.F1?.value).toBe("=D2+$B$2"));
    // The copied source keeps its own formula.
    expect(sheet().cells.D1?.value).toBe("=B2+$B$2");

    await user.click(cell(grid, "F1"));
    expect(formulaBar().value).toBe("=D2+$B$2");
  });

  it("reports the 0-to-100 rule and leaves every cell untouched when the target rejects the operation", async () => {
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

    dragSelect(grid, "A1", "B2");
    copyEvent(grid);
    await user.click(cell(grid, "D1"));
    fireEvent.paste(grid, { clipboardData: { getData: () => "" } });

    expect((await screen.findByRole("alert")).textContent).toBe("Please enter a number from 0 to 100");
    expect(sheet().cells.D1).toBeUndefined();
    expect(sheet().cells.E1).toBeUndefined();
    expect(sheet().cells.D2).toBeUndefined();
    expect(sheet().cells.E2).toBeUndefined();
    expect(sheet().cells.A1?.value).toBe("Region");
    expect(cell(grid, "D1").textContent).toBe("");

    // A refused cut keeps its source range as well.
    dragSelect(grid, "A1", "B2");
    await user.click(screen.getByRole("button", { name: "Cut" }));
    await user.click(cell(grid, "D1"));
    fireEvent.paste(grid, { clipboardData: { getData: () => "" } });

    expect((await screen.findAllByRole("alert")).at(-1)?.textContent).toBe("Please enter a number from 0 to 100");
    expect(sheet().cells.A1?.value).toBe("Region");
    expect(sheet().cells.A2?.value).toBe("East");
    expect(sheet().cells.B2?.value).toBe("1200");
    expect(sheet().cells.D1).toBeUndefined();
    expect(cell(grid, "A1").textContent).toBe("Region");
  });

  it("refuses to paste a rectangle copied in another worksheet", async () => {
    const secondSheet = api.state.workbooks[0].worksheets[1];
    expect(secondSheet.name).toBe("Sheet2");
    secondSheet.cells = { A1: { value: "Second sheet" } };
    const grid = await openSeedWorkbook();

    await user.click(cell(grid, "A2"));
    copyEvent(grid);
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));

    const second = screen.getByRole("grid", { name: "Worksheet grid" });
    await user.click(within(second).getByRole("gridcell", { name: "B2" }));
    fireEvent.paste(second, { clipboardData: { getData: () => "" } });

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Ranges can only be copied and pasted inside the same worksheet.",
    );
    expect(sheet(0, 1).cells.B2).toBeUndefined();
    expect(within(second).getByRole("gridcell", { name: "B2" }).textContent).toBe("");
  });

  it("still pastes external clipboard text when no range was copied", async () => {
    const grid = await openSeedWorkbook();
    await user.click(cell(grid, "D1"));

    fireEvent.paste(grid, { clipboardData: { getData: () => "West\t900" } });

    await waitFor(() => expect(sheet().cells.D1?.value).toBe("West"));
    expect(sheet().cells.E1?.value).toBe("900");
    expect(sheet().cells.A1?.value).toBe("Region");
  });

  it("pastes the external clipboard table at the cell the context menu was opened on", async () => {
    const grid = await openSeedWorkbook();
    clipboardText = "East\t1200\nNorth\t800";
    defineClipboard();

    // The menu is opened on B2, the bottom right cell of the selected rectangle.
    dragSelect(grid, "A1", "B2");
    const menu = await openGridMenu(grid, "B2");
    await user.click(within(menu).getByRole("menuitem", { name: "Paste" }));

    await waitFor(() => expect(sheet().cells.B2?.value).toBe("East"));
    expect(sheet().cells.C2?.value).toBe("1200");
    expect(sheet().cells.B3?.value).toBe("North");
    expect(sheet().cells.C3?.value).toBe("800");
    // Only the target rectangle changes: the cells of the rectangle the menu was opened inside stay.
    expect(sheet().cells.A1?.value).toBe("Region");
    expect(cell(grid, "A1").textContent).toBe("Region");
    expect(sheet().cells.A2?.value).toBe("East");
    expect(sheet().cells.A3?.value).toBe("North");
    expect(cell(grid, "B2").textContent).toBe("East");

    cleanup();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(cell(reopened, "B2").textContent).toBe("East");
    expect(cell(reopened, "C3").textContent).toBe("800");
  });

  it("keeps pasting at the selection when the external table comes from the keyboard", async () => {
    const grid = await openSeedWorkbook();

    dragSelect(grid, "A1", "B2");
    fireEvent.paste(grid, { clipboardData: { getData: () => "West\t900\nSouth\t700" } });

    await waitFor(() => expect(sheet().cells.A1?.value).toBe("West"));
    expect(sheet().cells.B1?.value).toBe("900");
    expect(sheet().cells.A2?.value).toBe("South");
    expect(sheet().cells.B2?.value).toBe("700");
    expect(sheet().cells.B3?.value).toBe("800");
  });
});
