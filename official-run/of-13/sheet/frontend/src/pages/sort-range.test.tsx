/**
 * REQ-5-1-1: the `Sort range` command of the `Data` menu, its dialog and the effect of a sort
 * on the grid. The workflow double mirrors `backend/src/domain/sort.mjs`.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { SHEET1, SHEET2, WORKBOOK_ID, installFakeWorkbookApi } from "../test/fake-workbook-api";

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

function dragSelect(from: string, to: string) {
  fireEvent.mouseDown(cell(from), { button: 0 });
  fireEvent.mouseEnter(cell(to));
  fireEvent.mouseUp(document.body);
}

async function openDataMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  return screen.getByRole("menu", { name: "Data" });
}

async function openSortDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(await openDataMenu(user)).getByRole("menuitem", { name: "Sort range" }));
  return screen.findByRole("dialog", { name: "Sort range" });
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

describe("the Sort range dialog", () => {
  it("offers the columns named after the header text, both orders and the header checkbox", async () => {
    installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();
    dragSelect("A1", "C4");

    const dialog = await openSortDialog(user);
    const sortBy = within(dialog).getByLabelText("Sort by") as HTMLSelectElement;
    for (const header of ["Region", "Sales", "Status"]) {
      expect(within(sortBy).getByRole("option", { name: header })).toBeTruthy();
    }
    const order = within(dialog).getByLabelText("Order") as HTMLSelectElement;
    for (const name of ["Ascending", "Descending"]) {
      expect(within(order).getByRole("option", { name })).toBeTruthy();
    }
    // The seeded rectangle starts with a header row, so the checkbox is already checked.
    expect((within(dialog).getByRole("checkbox", { name: "Data has header row" }) as HTMLInputElement).checked).toBe(true);
    expect(within(dialog).getByRole("button", { name: "Sort" })).toBeTruthy();
  });
});

describe("sorting a selected range", () => {
  it("reorders the records of the rectangle and keeps the new order after reopening", async () => {
    const api = installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();
    dragSelect("A1", "C4");

    const dialog = await openSortDialog(user);
    await user.selectOptions(within(dialog).getByLabelText("Sort by"), "B");
    await user.selectOptions(within(dialog).getByLabelText("Order"), "ascending");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    // Whole records moved: the 700 row is first, the header row stayed on top.
    await waitFor(() => expect(cell("A2").textContent).toBe("South"));
    expect(cell("A1").textContent).toBe("Region");
    expect(cell("B2").textContent).toBe("700");
    expect(cell("C2").textContent).toBe("Open");
    expect(cell("A3").textContent).toBe("North");
    expect(cell("A4").textContent).toBe("East");
    expect(api.workbooks[0].sheets[0].cells.A2).toBe("South");
    expect(api.workbooks[0].sheets[0].cells.B4).toBe("1200");

    // The other worksheet keeps its own cells.
    expect(api.workbooks[0].sheets.find((sheet) => sheet.id === SHEET2)?.cells.A1).toBe("2");

    // Reopening the workbook shows the persisted order again.
    window.location.hash = "#/";
    window.location.hash = `#/workbooks/${WORKBOOK_ID}`;
    await waitFor(() => expect(cell("A2").textContent).toBe("South"));
    expect(cell("A4").textContent).toBe("East");
  });

  it("keeps filtering and validation on the same rectangle after a sort", async () => {
    const api = installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    await user.click(within(await openDataMenu(user)).getByRole("menuitem", { name: "Create filter" }));
    await waitFor(() => expect(api.workbooks[0].sheets[0].filter).toBeDefined());
    dragSelect("B2", "B4");
    await user.click(
      within(await openDataMenu(user)).getByRole("menuitem", { name: "Data validation" }),
    );
    const validation = await screen.findByRole("dialog", { name: "Data validation" });
    await user.selectOptions(within(validation).getByLabelText("Rule type"), "number-range");
    await user.type(within(validation).getByLabelText("Minimum"), "0");
    await user.type(within(validation).getByLabelText("Maximum"), "2000");
    await user.click(within(validation).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.workbooks[0].sheets[0].validations?.[0]?.range).toBe("B2:B4"),
    );

    dragSelect("A1", "C4");
    const dialog = await openSortDialog(user);
    await user.selectOptions(within(dialog).getByLabelText("Sort by"), "B");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));
    await waitFor(() => expect(cell("A2").textContent).toBe("South"));

    // Filtering and validation still apply to the same rectangle after the sort.
    const sheet = api.workbooks[0].sheets.find((entry) => entry.id === SHEET1);
    expect(sheet?.filter?.range).toBe("A1:C4");
    expect(sheet?.validations?.[0]?.range).toBe("B2:B4");

    // Filtering by the Status column hides the North row of the sorted order.
    await user.click(screen.getByRole("button", { name: "Filter Status" }));
    const filterDialog = await screen.findByRole("dialog", { name: "Filter Status" });
    await user.click(within(filterDialog).getByRole("checkbox", { name: "Closed" }));
    await user.click(within(filterDialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(within(grid()).queryByRole("gridcell", { name: "A3" })).toBeNull());
    expect(cell("A2").textContent).toBe("South");
    expect(cell("A4").textContent).toBe("East");

    // The rule still rejects an out-of-range value after the sort.
    await user.click(cell("B2"));
    const formulaBar = screen.getByLabelText("Formula bar");
    await user.clear(formulaBar);
    await user.type(formulaBar, "5000{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("between 0 and 2000"),
    );
    expect(cell("B2").textContent).toBe("700");
    expect(api.workbooks[0].sheets[0].cells.B2).toBe("700");
  });

  it("shows the failure inside the dialog and keeps the original order", async () => {
    installFakeWorkbookApi({ sortStatus: 400, sortError: "Invalid sort column" });
    const user = userEvent.setup();
    await openEditor();
    dragSelect("A1", "C4");

    const dialog = await openSortDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toBe("Invalid sort column"),
    );
    expect(within(dialog).getByRole("combobox", { name: "Sort by" })).toBeTruthy();
    expect(cell("A2").textContent).toBe("East");
    expect(cell("A3").textContent).toBe("North");
    expect(cell("A4").textContent).toBe("South");
  });
});
