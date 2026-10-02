import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFakeBackend, type FakeBackend } from "../test/fake-backend";
import { WorkbookEditorPage } from "./WorkbookEditorPage";

/** Runs one `Data` menu command (its items use the ARIA menuitem role). */
async function runDataCommand(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu", { name: "Data" });
  await user.click(within(menu).getByRole("menuitem", { name }));
}

function cellText(name: string): string | null {
  const cell = screen.queryByRole("gridcell", { name });
  return cell ? cell.textContent : null;
}

/**
 * Creates the pivot worksheet from the seeded selection (A1 → the used sales
 * region A1:C4) and returns its "Pivot table editor" region.
 */
async function createPivot(user: ReturnType<typeof userEvent.setup>) {
  await runDataCommand(user, "Create pivot table");
  const dialog = await screen.findByRole("dialog", { name: "Create pivot table" });
  expect(within(dialog).getByText("Source range: A1:C4")).toBeTruthy();
  const destination = within(dialog).getByRole("radio", { name: "New worksheet" }) as HTMLInputElement;
  expect(destination.checked).toBe(true);
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
  return screen.findByRole("region", { name: "Pivot table editor" });
}

/** Chooses the pivot fields and clicks `Apply`. */
async function applyPivotFields(
  user: ReturnType<typeof userEvent.setup>,
  editor: HTMLElement,
  fields: { rows?: string; columns?: string; values?: string; summarizeBy?: string },
): Promise<void> {
  if (fields.rows !== undefined) await user.selectOptions(within(editor).getByRole("combobox", { name: "Rows" }), fields.rows);
  if (fields.columns !== undefined) await user.selectOptions(within(editor).getByRole("combobox", { name: "Columns" }), fields.columns);
  if (fields.values !== undefined) await user.selectOptions(within(editor).getByRole("combobox", { name: "Values" }), fields.values);
  if (fields.summarizeBy !== undefined) {
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Summarize by" }), fields.summarizeBy);
  }
  await user.click(within(editor).getByRole("button", { name: "Apply" }));
}

describe("pivot table", () => {
  let backend: FakeBackend;

  beforeEach(() => {
    backend = installFakeBackend();
    vi.stubGlobal("fetch", backend.fetch);
    window.location.hash = "#/workbooks/q3-sales";
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("creates Pivot1 from the Data menu and summarizes the source range", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    const editor = await createPivot(user);
    // The new result worksheet is the active tab and starts blank.
    expect(screen.getByRole("tab", { name: "Pivot1" }).getAttribute("aria-selected")).toBe("true");
    expect(cellText("A1")).toBe("");

    // Rows/Values options use the source header text as their accessible name.
    expect(within(within(editor).getByRole("combobox", { name: "Rows" })).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Region", "Sales", "Status",
    ]);
    expect(within(within(editor).getByRole("combobox", { name: "Summarize by" })).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "SUM", "COUNT", "AVERAGE",
    ]);

    await applyPivotFields(user, editor, { rows: "Region", values: "Sales", summarizeBy: "SUM" });
    await waitFor(() => expect(cellText("A1")).toBe("Region"));
    expect(cellText("B1")).toBe("SUM of Sales");
    expect(cellText("A2")).toBe("East");
    expect(cellText("B2")).toBe("1200");
    expect(cellText("A3")).toBe("North");
    expect(cellText("B3")).toBe("800");
    expect(cellText("A4")).toBe("South");
    expect(cellText("B4")).toBe("700");
    expect(cellText("A5")).toBe("Grand Total");
    expect(cellText("B5")).toBe("2700");

    // The source worksheet keeps every value and its order.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(cellText("A2")).toBe("East");
    expect(cellText("B4")).toBe("700");

    // Reopening shows the same pivot worksheet, layout and results.
    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });
    await user.click(screen.getByRole("tab", { name: "Pivot1" }));
    await waitFor(() => expect(cellText("A1")).toBe("Region"));
    expect(cellText("B5")).toBe("2700");
    const reopened = screen.getByRole("region", { name: "Pivot table editor" });
    expect((within(reopened).getByRole("combobox", { name: "Rows" }) as HTMLSelectElement).value).toBe("Region");
    expect((within(reopened).getByRole("combobox", { name: "Values" }) as HTMLSelectElement).value).toBe("Sales");
    expect((within(reopened).getByRole("combobox", { name: "Summarize by" }) as HTMLSelectElement).value).toBe("SUM");
  });

  it("summarizes COUNT and AVERAGE including an empty combination as 0", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    const editor = await createPivot(user);
    await applyPivotFields(user, editor, { rows: "Region", values: "Sales", summarizeBy: "COUNT" });
    await waitFor(() => expect(cellText("B2")).toBe("1"));
    expect(cellText("B1")).toBe("COUNT of Sales");
    expect(cellText("B5")).toBe("3");

    // A column field arranges its values from B1 and adds the Grand Total column.
    await applyPivotFields(user, editor, { columns: "Status", summarizeBy: "SUM" });
    await waitFor(() => expect(cellText("A1")).toBe("Region"));
    expect(cellText("B1")).toBe("Open");
    expect(cellText("C1")).toBe("Closed");
    expect(cellText("D1")).toBe("Grand Total");
    expect(cellText("B2")).toBe("1200");
    expect(cellText("C2")).toBe("0");
    expect(cellText("D2")).toBe("1200");
    expect(cellText("C3")).toBe("800");
    expect(cellText("B3")).toBe("0");
    expect(cellText("A5")).toBe("Grand Total");
    expect(cellText("D5")).toBe("2700");

    await applyPivotFields(user, editor, { summarizeBy: "AVERAGE" });
    await waitFor(() => expect(cellText("D5")).toBe("900"));
    expect(cellText("B5")).toBe("950");
  });

  it("refreshes the summary after the source data changed and keeps the source sheet", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });
    const editor = await createPivot(user);
    await applyPivotFields(user, editor, { rows: "Region", values: "Sales", summarizeBy: "SUM" });
    await waitFor(() => expect(cellText("B5")).toBe("2700"));

    // Edit one source value, then refresh the pivot from its own worksheet.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await user.dblClick(screen.getByRole("gridcell", { name: "B2" }));
    const inline = screen.getByRole("textbox", { name: "Edit B2" });
    await user.clear(inline);
    await user.type(inline, "2000{Enter}");
    await waitFor(() => expect(cellText("B2")).toBe("2000"));

    await user.click(screen.getByRole("tab", { name: "Pivot1" }));
    await user.click(screen.getByRole("button", { name: "Refresh pivot table" }));
    await waitFor(() => expect(cellText("B2")).toBe("2000"));
    expect(cellText("B5")).toBe("3500");
    // The refresh does not modify the source worksheet.
    expect(backend.workbooks[0].worksheets[0].cells.B2).toBe("2000");
    expect(backend.workbooks[0].worksheets[0].cells.A3).toBe("North");
  });

  it("reports a deleted source header on refresh and keeps the last result", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });
    const editor = await createPivot(user);
    await applyPivotFields(user, editor, { rows: "Region", values: "Sales", summarizeBy: "SUM" });
    await waitFor(() => expect(cellText("B5")).toBe("2700"));

    // Deleting the value column removes the header the pivot was built on.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "B" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete column" }));

    await user.click(screen.getByRole("tab", { name: "Pivot1" }));
    await screen.findByRole("region", { name: "Pivot table editor" });
    // Opening the editor already reports the unusable field.
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Pivot field is no longer available. Select a new field.",
    );
    await user.click(screen.getByRole("button", { name: "Refresh pivot table" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Pivot field is no longer available. Select a new field.",
    );
    // The last successful summary and the source worksheet both survive.
    expect(cellText("B5")).toBe("2700");
    expect(cellText("A2")).toBe("East");
  });

  it("rejects a nonnumeric value field and preserves the previous summary", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });
    const editor = await createPivot(user);
    await applyPivotFields(user, editor, { rows: "Region", values: "Sales", summarizeBy: "SUM" });
    await waitFor(() => expect(cellText("B5")).toBe("2700"));

    // Region holds no numbers, so SUM cannot summarize it.
    await applyPivotFields(user, editor, { values: "Region" });
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Value field requires numeric values");
    expect(within(editor).getByRole("combobox", { name: "Values" })).toHaveProperty("value", "Region");
    expect(cellText("B5")).toBe("2700");
    expect(backend.workbooks[0].worksheets[0].cells.A3).toBe("North");
  });
});
