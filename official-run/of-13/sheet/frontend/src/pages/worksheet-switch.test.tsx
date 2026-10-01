/**
 * REQ-2-1-2: switching worksheets through the ARIA tabs. Clicking another tab has to bring the
 * grid, the row/column structure, the selected cell, the `Formula bar`, the filter buttons, the
 * validation entry points and the pivot-table results of the target worksheet, without modifying
 * the worksheet left behind; reopening the workbook shows the last active tab with the last
 * confirmed selection of each worksheet.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { WORKBOOK_ID, installFakeWorkbookApi } from "../test/fake-workbook-api";

async function openEditor() {
  window.location.hash = `#/workbooks/${WORKBOOK_ID}`;
  const view = render(<App />);
  await screen.findByRole("grid", { name: "Worksheet grid" });
  return view;
}

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function cell(address: string) {
  return within(grid()).getByRole("gridcell", { name: address });
}

function formulaBar() {
  return screen.getByLabelText("Formula bar") as HTMLInputElement;
}

function dragSelect(from: string, to: string) {
  fireEvent.mouseDown(cell(from), { button: 0 });
  fireEvent.mouseEnter(cell(to));
  fireEvent.mouseUp(document.body);
}

function rowNumbers(): number {
  return within(grid()).getAllByRole("rowheader").length;
}

function columnLetters(): string[] {
  return within(grid())
    .getAllByRole("columnheader")
    .map((header) => header.textContent ?? "");
}

async function openDataMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  return screen.getByRole("menu", { name: "Data" });
}

async function switchTo(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("tab", { name }));
  await waitFor(() =>
    expect(screen.getByRole("tab", { name }).getAttribute("aria-selected")).toBe("true"),
  );
}

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "#/";
});

describe("REQ-2-1-2 switching worksheets", () => {
  it("shows the grid, the selected cell and the formula bar of the target worksheet", async () => {
    const api = installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    // Sheet1 is active: its ordinary value is in the formula bar of the selected A1.
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    expect(cell("A2").textContent).toBe("East");
    expect(cell("B2").textContent).toBe("1200");
    expect(formulaBar().value).toBe("Region");

    await switchTo(user, "Sheet2");

    // The grid is the other worksheet, A1 is selected because Sheet2 has no selection history.
    expect(cell("A1").textContent).toBe("2");
    expect(cell("A2").textContent).toBe("");
    expect(cell("A1").getAttribute("aria-selected")).toBe("true");
    expect(formulaBar().value).toBe("2");

    // A formula cell keeps its original formula in the formula bar, its result in the grid.
    await user.click(cell("C1"));
    expect(formulaBar().value).toBe("=A1+B1");
    expect(cell("C1").textContent).toBe("5");

    // Switching only reads: the worksheet left behind keeps its rows untouched.
    expect(api.calls.some((call) => call.path.includes("/cells/"))).toBe(false);

    await switchTo(user, "Sheet1");
    expect(cell("A1").textContent).toBe("Region");
    expect(cell("A2").textContent).toBe("East");
    expect(cell("B2").textContent).toBe("1200");
    expect(cell("A1").getAttribute("aria-selected")).toBe("true");
    expect(formulaBar().value).toBe("Region");
    expect(api.workbooks[0].sheets[0].cells.A2).toBe("East");
  });

  it("keeps one confirmed selection per worksheet and returns to it", async () => {
    installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    await user.click(cell("B2"));
    expect(formulaBar().value).toBe("1200");

    await switchTo(user, "Sheet2");
    // First visit: the selection starts at A1.
    expect(cell("A1").getAttribute("aria-selected")).toBe("true");
    expect(formulaBar().value).toBe("2");
    await user.click(cell("D1"));
    expect(formulaBar().value).toBe("=C1*2");

    await switchTo(user, "Sheet1");
    expect(cell("B2").getAttribute("aria-selected")).toBe("true");
    expect(formulaBar().value).toBe("1200");
    expect(cell("A1").getAttribute("aria-selected")).toBe("false");

    await switchTo(user, "Sheet2");
    expect(cell("D1").getAttribute("aria-selected")).toBe("true");
    expect(formulaBar().value).toBe("=C1*2");
  });

  it("reopens on the last active tab and restores the confirmed selection of every worksheet", async () => {
    installFakeWorkbookApi();
    const user = userEvent.setup();
    const view = await openEditor();

    // One confirmed selection per worksheet before the reload.
    await user.click(cell("B2"));
    expect(formulaBar().value).toBe("1200");
    await switchTo(user, "Sheet2");
    await user.click(cell("D1"));
    expect(formulaBar().value).toBe("=C1*2");

    view.unmount();
    await openEditor();

    expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("false");
    expect(cell("D1").getAttribute("aria-selected")).toBe("true");
    expect(formulaBar().value).toBe("=C1*2");
    expect(cell("A1").textContent).toBe("2");

    // Sheet1 keeps its own confirmed cell across the reload.
    await switchTo(user, "Sheet1");
    expect(cell("B2").getAttribute("aria-selected")).toBe("true");
    expect(formulaBar().value).toBe("1200");
  });

  it("brings the row and column structure of the target worksheet", async () => {
    const api = installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    expect(rowNumbers()).toBe(50);
    expect(columnLetters()).toHaveLength(26);

    // Sheet1 grows by one row and one column; the values shift along.
    fireEvent.contextMenu(within(grid()).getByRole("rowheader", { name: "2" }), {
      clientX: 10,
      clientY: 10,
    });
    await user.click(
      within(await screen.findByRole("menu", { name: "Row 2 options" })).getByRole("menuitem", {
        name: "Insert 1 row above",
      }),
    );
    await waitFor(() => expect(rowNumbers()).toBe(51));
    fireEvent.contextMenu(
      within(grid()).getByRole("columnheader", { name: "B" }),
      { clientX: 10, clientY: 10 },
    );
    await user.click(
      within(await screen.findByRole("menu", { name: "Column B options" })).getByRole(
        "menuitem",
        { name: "Insert 1 column left" },
      ),
    );
    await waitFor(() => expect(columnLetters()).toHaveLength(27));
    expect(cell("C1").textContent).toBe("Sales");
    expect(cell("A3").textContent).toBe("East");

    // The other worksheet keeps its own default structure...
    await switchTo(user, "Sheet2");
    expect(rowNumbers()).toBe(50);
    expect(columnLetters()).toHaveLength(26);
    expect(api.workbooks[0].sheets[1].rowCount).toBeUndefined();
    expect(api.workbooks[0].sheets[1].columnCount).toBeUndefined();

    // ...and the worksheet left behind keeps the structure it was given.
    await switchTo(user, "Sheet1");
    expect(rowNumbers()).toBe(51);
    expect(columnLetters()).toHaveLength(27);
    expect(cell("A3").textContent).toBe("East");
    expect(api.workbooks[0].sheets[0].rowCount).toBe(51);
    expect(api.workbooks[0].sheets[0].columnCount).toBe(27);
  });

  it("switches the filter buttons and the validation entry points with the worksheet", async () => {
    installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    // A filter view and a dropdown rule exist on Sheet1 only.
    await user.click(within(await openDataMenu(user)).getByRole("menuitem", { name: "Create filter" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Filter Region" })).toBeTruthy());

    await user.click(cell("C2"));
    await user.click(
      within(await openDataMenu(user)).getByRole("menuitem", { name: "Data validation" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Data validation" });
    await user.type(within(dialog).getByLabelText("Allowed values"), "Open, Closed");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Data validation" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Open dropdown for C2" })).toBeTruthy();

    await switchTo(user, "Sheet2");
    expect(screen.queryByRole("button", { name: "Filter Region" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open dropdown for C2" })).toBeNull();

    await switchTo(user, "Sheet1");
    expect(screen.getByRole("button", { name: "Filter Region" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter Sales" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open dropdown for C2" })).toBeTruthy();
  });

  it("shows the pivot table editor and its results only on the pivot-result worksheet", async () => {
    installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    dragSelect("A1", "C4");
    await user.click(
      within(await openDataMenu(user)).getByRole("menuitem", { name: "Create pivot table" }),
    );
    const create = await screen.findByRole("dialog", { name: "Create pivot table" });
    await user.click(within(create).getByRole("button", { name: "Create" }));

    const editor = await screen.findByRole("region", { name: "Pivot table editor" });
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Rows" }), "Region");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Values" }), "Sales");
    await user.click(within(editor).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(cell("A1").textContent).toBe("Region"));
    expect(cell("B1").textContent).toBe("SUM of Sales");
    expect(cell("B2").textContent).toBe("1200");

    // The editor and its results belong to the pivot worksheet only.
    await switchTo(user, "Sheet1");
    expect(screen.queryByRole("region", { name: "Pivot table editor" })).toBeNull();
    expect(cell("A1").textContent).toBe("Region");
    expect(cell("A2").textContent).toBe("East");

    await switchTo(user, "Pivot1");
    expect(screen.getByRole("region", { name: "Pivot table editor" })).toBeTruthy();
    expect(cell("B1").textContent).toBe("SUM of Sales");
    expect(cell("B2").textContent).toBe("1200");
  });
});
