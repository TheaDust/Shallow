/**
 * REQ-2-1-4: deleting a worksheet through the `Delete` command of its tab menu, the `Delete
 * worksheet` confirmation, the worksheet that becomes active afterwards, and the two refusals
 * (the last remaining worksheet, and a worksheet a pivot table still reads).
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

function tabNames(): string[] {
  return screen.getAllByRole("tab").map((tab) => tab.textContent ?? "");
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

/** `Delete` in the tab menu of `sheetName`; leaves the confirmation dialog open. */
async function openDeleteDialog(user: ReturnType<typeof userEvent.setup>, sheetName: string) {
  await user.click(screen.getByRole("button", { name: `Worksheet options for ${sheetName}` }));
  const menu = await screen.findByRole("menu", { name: "Worksheet options" });
  await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
  return screen.findByRole("dialog", { name: "Delete worksheet" });
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

describe("REQ-2-1-4 deleting a worksheet", () => {
  it("offers Delete in the tab menu and removes the confirmed worksheet with its state", async () => {
    const api = installFakeWorkbookApi();
    const user = userEvent.setup();
    const view = await openEditor();

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet2" }));
    const menu = await screen.findByRole("menu", { name: "Worksheet options" });
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toBeTruthy();
    await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
    expect(within(dialog).getByText("Sheet2")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);

    const confirmed = await openDeleteDialog(user, "Sheet2");
    await user.click(within(confirmed).getByRole("button", { name: "Delete worksheet" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(tabNames()).toEqual(["Sheet1"]));
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    expect(cell("A2").textContent).toBe("East");
    expect(cell("B2").textContent).toBe("1200");
    expect(api.workbooks[0].sheets.map((sheet) => sheet.name)).toEqual(["Sheet1"]);
    expect(
      api.calls.some(
        (call) => call.method === "DELETE" && call.path.endsWith("/sheets/wb-q3-sales-sheet-2"),
      ),
    ).toBe(true);

    // The removed tab stays absent after reopening the workbook.
    view.unmount();
    await openEditor();
    expect(tabNames()).toEqual(["Sheet1"]);
  });

  it("activates an adjacent worksheet when the active tab is deleted", async () => {
    installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    const dialog = await openDeleteDialog(user, "Sheet1");
    expect(within(dialog).getByText("Sheet1")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    await waitFor(() => expect(tabNames()).toEqual(["Sheet2"]));
    expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true");
    // The grid follows the worksheet that became active.
    expect(cell("A1").textContent).toBe("2");
    expect(cell("A1").getAttribute("aria-selected")).toBe("true");
  });

  it("refuses to open a confirmation dialog for the last remaining worksheet", async () => {
    const api = installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    const first = await openDeleteDialog(user, "Sheet2");
    await user.click(within(first).getByRole("button", { name: "Delete worksheet" }));
    await waitFor(() => expect(tabNames()).toEqual(["Sheet1"]));

    const callsBefore = api.calls.filter((call) => call.method === "DELETE").length;
    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    const menu = await screen.findByRole("menu", { name: "Worksheet options" });
    await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));

    expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull();
    expect(await screen.findByText("A workbook must contain at least one worksheet")).toBeTruthy();
    expect(tabNames()).toEqual(["Sheet1"]);
    expect(api.calls.filter((call) => call.method === "DELETE").length).toBe(callsBefore);
    expect(cell("A2").textContent).toBe("East");
  });

  it("refuses to delete a worksheet a pivot table still reads and keeps both unchanged", async () => {
    installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    // A pivot table that reads Sheet1: `Pivot1` summarizes `SUM of Sales` by `Region`.
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
    await waitFor(() => expect(cell("B1").textContent).toBe("SUM of Sales"));

    // Sheet1 is still the source of Pivot1, so its deletion is refused.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    const refused = await openDeleteDialog(user, "Sheet1");
    await user.click(within(refused).getByRole("button", { name: "Delete worksheet" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      await screen.findByText("Please delete or rebuild dependent pivot tables first"),
    ).toBeTruthy();
    expect(tabNames()).toEqual(["Sheet1", "Sheet2", "Pivot1"]);
    expect(cell("A2").textContent).toBe("East");
    expect(cell("B2").textContent).toBe("1200");

    // The pivot result is intact too.
    await user.click(screen.getByRole("tab", { name: "Pivot1" }));
    expect(cell("A1").textContent).toBe("Region");
    expect(cell("B1").textContent).toBe("SUM of Sales");
    expect(cell("B2").textContent).toBe("1200");

    // Deleting the pivot-result worksheet lifts the constraint on its source.
    const removed = await openDeleteDialog(user, "Pivot1");
    await user.click(within(removed).getByRole("button", { name: "Delete worksheet" }));
    await waitFor(() => expect(tabNames()).toEqual(["Sheet1", "Sheet2"]));

    const source = await openDeleteDialog(user, "Sheet1");
    await user.click(within(source).getByRole("button", { name: "Delete worksheet" }));
    await waitFor(() => expect(tabNames()).toEqual(["Sheet2"]));
  });

  it("shows an error and keeps the worksheet when the deletion fails", async () => {
    installFakeWorkbookApi({ deleteStatus: 500, deleteError: "Unable to delete worksheet" });
    const user = userEvent.setup();
    const view = await openEditor();

    const dialog = await openDeleteDialog(user, "Sheet2");
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Unable to delete worksheet")).toBeTruthy();
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeTruthy();

    // The worksheet is still there after reopening.
    view.unmount();
    await openEditor();
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);
  });
});
