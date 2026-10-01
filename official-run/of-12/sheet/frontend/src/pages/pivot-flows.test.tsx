import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { installFakeBackend } from "../test/fake-backend";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

type Harness = ReturnType<typeof installFakeBackend>;

async function openSeededEditor() {
  window.location.hash = "#/";
  const backend = installFakeBackend();
  const view = render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
  return { ...backend, user, view };
}

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function cellValue(coordinate: string) {
  return within(grid()).getByRole("gridcell", { name: coordinate }).textContent;
}

function selectRectangle(from: string, to: string) {
  const start = within(grid()).getByRole("gridcell", { name: from });
  const end = within(grid()).getByRole("gridcell", { name: to });
  fireEvent.mouseDown(start, { button: 0 });
  fireEvent.mouseMove(end);
  fireEvent.mouseUp(end);
}

async function chooseDataCommand(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name }));
}

/** Creates `Pivot1` from the seeded range through the visible `Data` menu flow. */
async function createPivot(user: ReturnType<typeof userEvent.setup>) {
  selectRectangle("A1", "C4");
  await waitFor(() => {
    expect(within(grid()).getByRole("gridcell", { name: "C4" }).getAttribute("aria-selected")).toBe("true");
  });
  await chooseDataCommand(user, "Create pivot table");
  const dialog = await screen.findByRole("dialog", { name: "Create pivot table" });
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
  await screen.findByRole("region", { name: "Pivot table editor" });
}

function editor() {
  return screen.getByRole("region", { name: "Pivot table editor" });
}

function reopenEditor(backend: Harness) {
  cleanup();
  backend.install();
  window.location.hash = "#/workbooks/wb-q3-sales";
  render(<App />);
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

describe("creating a pivot table", () => {
  it("creates Pivot1 from the selected range with the default summary and keeps the source intact", async () => {
    const { user } = await openSeededEditor();

    await chooseDataCommand(user, "Create pivot table");
    // Without a selection `Create pivot table` works on the data block around the active cell.
    const dialog = await screen.findByRole("dialog", { name: "Create pivot table" });
    expect(within(dialog).getByText("Source range: A1:C4")).toBeTruthy();
    expect((within(dialog).getByRole("radio", { name: "New worksheet" }) as HTMLInputElement).checked).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    const tab = await screen.findByRole("tab", { name: "Pivot1" });
    await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"));
    expect(screen.getAllByRole("tab").map((item) => item.textContent)).toEqual(["Sheet1", "Sheet2", "Pivot1"]);

    // The editor is prefilled with the stored configuration and the grid shows the summary.
    expect((within(editor()).getByLabelText("Rows") as HTMLSelectElement).value).toBe("Region");
    expect((within(editor()).getByLabelText("Columns") as HTMLSelectElement).value).toBe("");
    expect((within(editor()).getByLabelText("Values") as HTMLSelectElement).value).toBe("Sales");
    expect((within(editor()).getByLabelText("Summarize by") as HTMLSelectElement).value).toBe("SUM");
    expect(within(editor()).getByRole("button", { name: "Apply" })).toBeTruthy();
    expect(within(editor()).getByRole("button", { name: "Refresh pivot table" })).toBeTruthy();

    expect(cellValue("A1")).toBe("Region");
    expect(cellValue("B1")).toBe("SUM of Sales");
    expect(cellValue("A2")).toBe("East");
    expect(cellValue("B2")).toBe("1200");
    expect(cellValue("A3")).toBe("North");
    expect(cellValue("B3")).toBe("800");
    expect(cellValue("A4")).toBe("South");
    expect(cellValue("B4")).toBe("700");
    expect(cellValue("A5")).toBe("Grand Total");
    expect(cellValue("B5")).toBe("2700");

    // Rows and columns expose the source header texts and the summarization methods.
    expect([...within(editor()).getByLabelText("Rows").querySelectorAll("option")].map((option) => option.textContent))
      .toEqual(["Region", "Sales", "Status"]);
    expect([...within(editor()).getByLabelText("Columns").querySelectorAll("option")].map((option) => option.textContent))
      .toEqual(["None", "Region", "Sales", "Status"]);
    expect([...within(editor()).getByLabelText("Summarize by").querySelectorAll("option")].map((option) => option.textContent))
      .toEqual(["SUM", "COUNT", "AVERAGE"]);

    // Switching back to the source worksheet shows the unchanged values and order.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(cellValue("A2")).toBe("East"));
    expect(cellValue("A4")).toBe("South");
    expect(cellValue("B4")).toBe("700");
  });

  it("applies the chosen fields and method and replaces the previous summary", async () => {
    const { user } = await openSeededEditor();
    await createPivot(user);

    await user.selectOptions(within(editor()).getByLabelText("Summarize by"), "COUNT");
    await user.click(within(editor()).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(cellValue("B1")).toBe("COUNT of Sales"));
    expect(cellValue("B2")).toBe("1");
    expect(cellValue("B5")).toBe("3");

    await user.selectOptions(within(editor()).getByLabelText("Summarize by"), "AVERAGE");
    await user.click(within(editor()).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(cellValue("B1")).toBe("AVERAGE of Sales"));
    expect(cellValue("B5")).toBe("900");

    // A column field arranges the column values from B1 onward and closes with Grand Total.
    await user.selectOptions(within(editor()).getByLabelText("Summarize by"), "SUM");
    await user.selectOptions(within(editor()).getByLabelText("Columns"), "Status");
    await user.click(within(editor()).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(cellValue("B1")).toBe("Open"));

    expect(cellValue("A1")).toBe("Region");
    expect(cellValue("C1")).toBe("Closed");
    expect(cellValue("D1")).toBe("Grand Total");
    expect(cellValue("A2")).toBe("East");
    expect(cellValue("B2")).toBe("1200");
    expect(cellValue("C2")).toBe("0");
    expect(cellValue("D2")).toBe("1200");
    expect(cellValue("A5")).toBe("Grand Total");
    expect(cellValue("B5")).toBe("1900");
    expect(cellValue("C5")).toBe("800");
    expect(cellValue("D5")).toBe("2700");
  });

  it("keeps the worksheet, the layout and the result after reopening the workbook", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    await createPivot(user);
    await user.selectOptions(within(editor()).getByLabelText("Columns"), "Status");
    await user.click(within(editor()).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(cellValue("D5")).toBe("2700"));

    await reopenEditor(backend);
    expect(await screen.findByRole("tab", { name: "Pivot1" })).toBeTruthy();
    await waitFor(() => expect(cellValue("D1")).toBe("Grand Total"));
    expect((within(editor()).getByLabelText("Columns") as HTMLSelectElement).value).toBe("Status");
    expect(cellValue("B1")).toBe("Open");
    expect(cellValue("D5")).toBe("2700");
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });
});

describe("refreshing a pivot table", () => {
  it("replaces the summary with the current source values on Refresh pivot table", async () => {
    const { user } = await openSeededEditor();
    await createPivot(user);

    // The source is edited on Sheet1; the stored result only changes on an explicit refresh.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(cellValue("A2")).toBe("East"));
    await user.click(within(grid()).getByRole("gridcell", { name: "B3" }));
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.clear(formulaBar);
    await user.type(formulaBar, "1000{Enter}");
    await waitFor(() => expect(cellValue("B3")).toBe("1000"));

    await user.click(screen.getByRole("tab", { name: "Pivot1" }));
    await waitFor(() => expect(cellValue("B5")).toBe("2700"));
    await user.click(within(editor()).getByRole("button", { name: "Refresh pivot table" }));
    await waitFor(() => expect(cellValue("B5")).toBe("2900"));
    expect(cellValue("B3")).toBe("1000");

    // The refresh never writes through to the source worksheet.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(cellValue("B3")).toBe("1000"));
    expect(cellValue("A2")).toBe("East");
  });

  it("reports a deleted source field on refresh and preserves the last successful result", async () => {
    const { user } = await openSeededEditor();
    await createPivot(user);

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(cellValue("A2")).toBe("East"));
    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "B" }));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Delete column" }));
    // Deleting the value column moves the remaining data left: `Status` becomes the second header.
    await waitFor(() => expect(cellValue("B1")).toBe("Status"));
    expect(cellValue("B2")).toBe("Open");
    expect(cellValue("A2")).toBe("East");

    await user.click(screen.getByRole("tab", { name: "Pivot1" }));
    await waitFor(() => expect(cellValue("B5")).toBe("2700"));
    // The editor reports the missing field and keeps offering the deleted field for reselection.
    expect(await screen.findByText("Pivot field is no longer available. Select a new field.")).toBeTruthy();
    await user.click(within(editor()).getByRole("button", { name: "Refresh pivot table" }));
    await waitFor(() => expect(screen.getAllByText("Pivot field is no longer available. Select a new field.")).toHaveLength(1));
    expect(cellValue("A1")).toBe("Region");
    expect(cellValue("B5")).toBe("2700");

    // Choosing an available field and applying again replaces the summary.
    await user.selectOptions(within(editor()).getByLabelText("Values"), "Status");
    await user.selectOptions(within(editor()).getByLabelText("Summarize by"), "COUNT");
    await user.click(within(editor()).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(cellValue("B1")).toBe("COUNT of Status"));
    expect(cellValue("B5")).toBe("3");
    expect(screen.queryByText("Pivot field is no longer available. Select a new field.")).toBeNull();
  });

  it("refuses SUM and AVERAGE on a value field without numbers and keeps the old result", async () => {
    const { user } = await openSeededEditor();
    await createPivot(user);

    await user.selectOptions(within(editor()).getByLabelText("Values"), "Status");
    await user.selectOptions(within(editor()).getByLabelText("Summarize by"), "AVERAGE");
    await user.click(within(editor()).getByRole("button", { name: "Apply" }));

    expect(await screen.findByText("Value field requires numeric values")).toBeTruthy();
    expect(cellValue("B1")).toBe("SUM of Sales");
    expect(cellValue("B5")).toBe("2700");

    // COUNT has no numeric requirement: it counts the non-empty records of the value field.
    await user.selectOptions(within(editor()).getByLabelText("Summarize by"), "COUNT");
    await user.click(within(editor()).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(cellValue("B1")).toBe("COUNT of Status"));
    expect(cellValue("B5")).toBe("3");
    expect(screen.queryByText("Value field requires numeric values")).toBeNull();
  });
});
