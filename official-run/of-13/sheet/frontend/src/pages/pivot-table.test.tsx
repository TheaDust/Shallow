/**
 * REQ-5-3-1: creating a pivot table from the selected source range through the `Data` menu,
 * configuring it in the `Pivot table editor` region, refreshing it after the source changed and
 * the two contract refusals. The server double mirrors `backend/src/domain/pivot.mjs`.
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

function dragSelect(from: string, to: string) {
  fireEvent.mouseDown(cell(from), { button: 0 });
  fireEvent.mouseEnter(cell(to));
  fireEvent.mouseUp(document.body);
}

async function openDataMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  return screen.getByRole("menu", { name: "Data" });
}

async function createPivot(user: ReturnType<typeof userEvent.setup>) {
  dragSelect("A1", "C4");
  const menu = await openDataMenu(user);
  await user.click(within(menu).getByRole("menuitem", { name: "Create pivot table" }));
  const dialog = await screen.findByRole("dialog", { name: "Create pivot table" });
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
  return screen.findByRole("region", { name: "Pivot table editor" });
}

async function pickField(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) {
  const editor = screen.getByRole("region", { name: "Pivot table editor" });
  await user.selectOptions(within(editor).getByRole("combobox", { name: label }), option);
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

describe("creating a pivot table", () => {
  it("offers the command in the Data menu and creates Pivot1 from the selected range", async () => {
    installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    dragSelect("A1", "C4");
    const menu = await openDataMenu(user);
    expect(within(menu).getByRole("menuitem", { name: "Create pivot table" })).toBeTruthy();

    await user.click(within(menu).getByRole("menuitem", { name: "Create pivot table" }));
    const dialog = await screen.findByRole("dialog", { name: "Create pivot table" });
    expect(within(dialog).getByText("Source range: A1:C4")).toBeTruthy();
    const target = within(dialog).getByRole("radio", { name: "New worksheet" }) as HTMLInputElement;
    expect(target.checked).toBe(true);

    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    // The pivot-result worksheet is created, becomes the active tab and shows its editor.
    const editor = await screen.findByRole("region", { name: "Pivot table editor" });
    expect(screen.getByRole("tab", { name: "Pivot1" }).getAttribute("aria-selected")).toBe("true");
    for (const label of ["Rows", "Columns", "Values", "Summarize by"]) {
      expect(within(editor).getByRole("combobox", { name: label })).toBeTruthy();
    }
    for (const label of ["Rows", "Columns", "Values"]) {
      const options = within(within(editor).getByRole("combobox", { name: label }))
        .getAllByRole("option")
        .map((option) => option.textContent);
      for (const name of ["Region", "Sales", "Status"]) {
        expect(options).toContain(name);
      }
    }
    const summarize = within(editor).getByRole("combobox", { name: "Summarize by" });
    expect(within(summarize).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "SUM",
      "COUNT",
      "AVERAGE",
    ]);
    expect(within(editor).getByRole("button", { name: "Apply" })).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "Refresh pivot table" })).toBeTruthy();
  });

  it("summarizes the source range, keeps the source worksheet and persists the result", async () => {
    installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();
    const editor = await createPivot(user);

    await pickField(user, "Rows", "Region");
    await pickField(user, "Values", "Sales");
    await pickField(user, "Summarize by", "SUM");
    await user.click(within(editor).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(cell("A1").textContent).toBe("Region"));
    expect(cell("B1").textContent).toBe("SUM of Sales");
    expect(cell("A2").textContent).toBe("East");
    expect(cell("B2").textContent).toBe("1200");
    expect(cell("A4").textContent).toBe("South");
    expect(cell("B4").textContent).toBe("700");
    expect(cell("A5").textContent).toBe("Grand Total");
    expect(cell("B5").textContent).toBe("2700");

    // The source worksheet was only read: its cells and order are still the seeded ones.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(cell("A1").textContent).toBe("Region"));
    expect(cell("B2").textContent).toBe("1200");
    expect(cell("B5").textContent).toBe("");

    // Switching back reopens the pivot worksheet with its editor and summary.
    await user.click(screen.getByRole("tab", { name: "Pivot1" }));
    await waitFor(() => expect(cell("B5").textContent).toBe("2700"));
    expect(screen.getByRole("region", { name: "Pivot table editor" })).toBeTruthy();
  });

  it("refreshes the stored summary after the source data changed", async () => {
    installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();
    const editor = await createPivot(user);
    await pickField(user, "Rows", "Region");
    await pickField(user, "Values", "Sales");
    await user.click(within(editor).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(cell("B5").textContent).toBe("2700"));

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(cell("A1").textContent).toBe("Region"));
    await user.dblClick(cell("B2"));
    const inline = screen.getByRole("textbox", { name: "Edit B2" });
    await user.clear(inline);
    await user.type(inline, "1500{Enter}");
    await waitFor(() => expect(cell("B2").textContent).toBe("1500"));

    await user.click(screen.getByRole("tab", { name: "Pivot1" }));
    const pivotEditor = await screen.findByRole("region", { name: "Pivot table editor" });
    // The old summary stays until the explicit refresh.
    await waitFor(() => expect(cell("B2").textContent).toBe("1200"));
    await user.click(within(pivotEditor).getByRole("button", { name: "Refresh pivot table" }));
    await waitFor(() => expect(cell("B2").textContent).toBe("1500"));
    expect(cell("B5").textContent).toBe("3000");
  });

  it("reports a deleted source header instead of recomputing, keeping the last result", async () => {
    installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();
    const editor = await createPivot(user);
    await pickField(user, "Rows", "Region");
    await pickField(user, "Values", "Sales");
    await user.click(within(editor).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(cell("B5").textContent).toBe("2700"));

    // Delete the header row of the source worksheet through its row-number menu.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(cell("A1").textContent).toBe("Region"));
    fireEvent.contextMenu(within(grid()).getByRole("rowheader", { name: "1" }), {
      clientX: 10,
      clientY: 10,
    });
    await user.click(await screen.findByRole("menuitem", { name: "Delete row" }));

    await user.click(screen.getByRole("tab", { name: "Pivot1" }));
    const pivotEditor = await screen.findByRole("region", { name: "Pivot table editor" });
    await user.click(within(pivotEditor).getByRole("button", { name: "Refresh pivot table" }));
    expect(
      await screen.findByText("Pivot field is no longer available. Select a new field."),
    ).toBeTruthy();
    // The last successful summary survives the refused refresh.
    expect(cell("B5").textContent).toBe("2700");
  });
});
