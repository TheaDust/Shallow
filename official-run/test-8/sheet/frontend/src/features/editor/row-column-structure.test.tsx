import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { createMockBackend, seedWorkbook } from "../../test/mock-backend";

let backend: ReturnType<typeof createMockBackend>;

beforeEach(() => {
  backend = createMockBackend([seedWorkbook()]);
  vi.stubGlobal("fetch", backend.fetchImpl);
  window.location.hash = "#/";
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

async function openEditor() {
  window.location.hash = "#/workbooks/workbook-q3-sales";
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
  return { user, view };
}

function activeWorksheet() {
  return backend.workbooks[0].worksheets[0];
}

function gridCell(name: string): HTMLElement {
  return within(screen.getByRole("grid", { name: "Worksheet grid" })).getByRole("gridcell", { name });
}

async function openRowMenu(rowNumber: number) {
  const header = within(screen.getByRole("grid", { name: "Worksheet grid" })).getByRole("rowheader", {
    name: String(rowNumber),
  });
  fireEvent.contextMenu(header);
  return screen.findByRole("menu", { name: `Row ${rowNumber} menu` });
}

async function openColumnMenu(letter: string) {
  const header = within(screen.getByRole("grid", { name: "Worksheet grid" })).getByRole("columnheader", {
    name: letter,
  });
  fireEvent.contextMenu(header);
  return screen.findByRole("menu", { name: `Column ${letter} menu` });
}

describe("grid header roles", () => {
  it("exposes decimal row numbers and column letters as header accessible names", async () => {
    await openEditor();
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("rowheader", { name: "1" }).textContent).toBe("1");
    expect(within(grid).getByRole("rowheader", { name: "3" })).not.toBeNull();
    expect(within(grid).getByRole("columnheader", { name: "A" })).not.toBeNull();
    expect(within(grid).getByRole("columnheader", { name: "C" }).textContent).toBe("C");
  });
});

describe("row-number menu", () => {
  it("offers the three row commands and inserts a row below the target", async () => {
    const { user } = await openEditor();
    expect(gridCell("B3").textContent).toBe("800");

    const menu = await openRowMenu(2);
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Insert 1 row above",
      "Insert 1 row below",
      "Delete row",
    ]);

    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 row below" }));

    await waitFor(() => expect(gridCell("B4").textContent).toBe("800"));
    expect(gridCell("B3").textContent).toBe("");
    expect(gridCell("A2").textContent).toBe("East");
    expect(gridCell("A4").textContent).toBe("North");
    expect(screen.queryByRole("menu")).toBeNull();

    await waitFor(() => expect(activeWorksheet().cells.B4).toBe("800"));
    expect(activeWorksheet().rowCount).toBe(13);
    expect(backend.workbooks[0].worksheets[1].cells).toEqual({});
  });

  it("keeps the inserted row after reopening the workbook", async () => {
    const { user, view } = await openEditor();
    const menu = await openRowMenu(2);
    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 row above" }));

    await waitFor(() => expect(gridCell("B3").textContent).toBe("1200"));
    expect(gridCell("B4").textContent).toBe("800");

    view.unmount();
    render(<App />);
    expect((await screen.findByRole("heading", { level: 1, name: "Q3 Sales" }))).not.toBeNull();
    expect(gridCell("B3").textContent).toBe("1200");
    expect(gridCell("B4").textContent).toBe("800");
  });

  it("deletes the target row and shifts subsequent rows up", async () => {
    const { user } = await openEditor();
    expect(gridCell("A1").textContent).toBe("Region");

    const menu = await openRowMenu(1);
    await user.click(within(menu).getByRole("menuitem", { name: "Delete row" }));

    await waitFor(() => expect(gridCell("A1").textContent).toBe("East"));
    expect(gridCell("A2").textContent).toBe("North");
    expect(gridCell("A3").textContent).toBe("South");

    await waitFor(() => expect(activeWorksheet().cells.A1).toBe("East"));
    expect(activeWorksheet().cells.A4).toBeUndefined();
  });
});

describe("column-header menu", () => {
  it("offers the three column commands and inserts a column to the right", async () => {
    const { user } = await openEditor();
    expect(gridCell("C1").textContent).toBe("Status");

    const menu = await openColumnMenu("B");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Insert 1 column left",
      "Insert 1 column right",
      "Delete column",
    ]);

    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 column right" }));

    await waitFor(() => expect(gridCell("D1").textContent).toBe("Status"));
    expect(gridCell("C1").textContent).toBe("");
    expect(gridCell("B1").textContent).toBe("Sales");

    await waitFor(() => expect(activeWorksheet().cells.D1).toBe("Status"));
    expect(activeWorksheet().columnCount).toBe(9);
    expect(backend.workbooks[0].worksheets[1].cells).toEqual({});
  });

  it("deletes the target column and shifts subsequent columns left", async () => {
    const { user } = await openEditor();

    const menu = await openColumnMenu("B");
    await user.click(within(menu).getByRole("menuitem", { name: "Delete column" }));

    await waitFor(() => expect(gridCell("B1").textContent).toBe("Status"));
    expect(gridCell("A1").textContent).toBe("Region");
    expect(gridCell("B2").textContent).toBe("Open");
    expect(gridCell("C2").textContent).toBe("");

    await waitFor(() => expect(activeWorksheet().cells.B2).toBe("Open"));
    expect(activeWorksheet().cells.C2).toBeUndefined();
  });
});
