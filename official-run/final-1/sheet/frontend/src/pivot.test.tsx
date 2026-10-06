import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import { SEED_WORKBOOK_ID, SEED_WORKSHEET_ID, installFakeApi, type FakeApi } from "./test/fake-api";

const CREATE_PATH = `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}/pivot`;

let api: FakeApi | undefined;

beforeEach(() => {
  window.location.hash = `#/workbooks/${SEED_WORKBOOK_ID}`;
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function cellText(name: string): string | null {
  return screen.queryByRole("gridcell", { name })?.textContent ?? null;
}

function editor() {
  return screen.findByRole("region", { name: "Pivot table editor" });
}

async function openDataCommand(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name }));
}

/** Opens "Create pivot table" and confirms the dialog. */
async function createPivot(user: ReturnType<typeof userEvent.setup>) {
  await openDataCommand(user, "Create pivot table");
  const dialog = await screen.findByRole("dialog", { name: "Create pivot table" });
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create pivot table" })).toBeNull());
}

test("the Data menu creates a Pivot1 worksheet holding the summary of the selected range", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  await openDataCommand(user, "Create pivot table");
  const dialog = await screen.findByRole("dialog", { name: "Create pivot table" });
  expect(within(dialog).getByText("Source range: A1:C4")).toBeTruthy();
  const destination = within(dialog).getByRole("radio", { name: "New worksheet" }) as HTMLInputElement;
  expect(destination.checked).toBe(true);
  await user.click(within(dialog).getByRole("button", { name: "Create" }));

  await waitFor(() =>
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2", "Pivot1"]),
  );
  expect(screen.getByRole("tab", { name: "Pivot1" }).getAttribute("aria-selected")).toBe("true");

  // The result worksheet shows the summary; the source records are untouched.
  expect(cellText("A1")).toBe("Region");
  expect(cellText("B1")).toBe("SUM of Sales");
  expect(cellText("A2")).toBe("East");
  expect(cellText("B2")).toBe("1200");
  expect(cellText("A3")).toBe("North");
  expect(cellText("B3")).toBe("800");
  expect(cellText("A4")).toBe("South");
  expect(cellText("B4")).toBe("700");
  expect(cellText("A5")).toBe("Grand Total");
  expect(cellText("B5")).toBe("2700");

  const region = await editor();
  expect(within(region).getByLabelText("Rows")).toBeTruthy();
  expect(within(region).getByRole("button", { name: "Apply" })).toBeTruthy();
  expect(within(region).getByRole("button", { name: "Refresh pivot table" })).toBeTruthy();

  // Switching back to the source worksheet keeps its values and order.
  await user.click(screen.getByRole("tab", { name: "Sheet1" }));
  await waitFor(() => expect(cellText("A2")).toBe("East"));
  expect(cellText("A3")).toBe("North");
  expect(cellText("A4")).toBe("South");
  expect(api!.workbooks[0].worksheets.find((worksheet) => worksheet.name === "Pivot1")!.cells.B5).toBe("2700");

  await user.click(screen.getByRole("tab", { name: "Pivot1" }));
  await waitFor(() => expect(cellText("A1")).toBe("Region"));

  // The pivot worksheet, its layout and its results survive a refresh.
  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getByRole("tab", { name: "Pivot1" }).getAttribute("aria-selected")).toBe("true");
  expect(cellText("A1")).toBe("Region");
  expect(cellText("B5")).toBe("2700");
  expect((within(await editor()).getByLabelText("Values") as HTMLSelectElement).value).toBe("Sales");
});

test("the editor adds a column field and COUNT fills combinations without records with 0", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();
  await createPivot(user);
  const region = await editor();

  await user.selectOptions(within(region).getByLabelText("Columns"), "Status");
  // The mixed combobox also works by clicking the visible option of the open list.
  await user.click(within(region).getByLabelText("Summarize by"));
  const listbox = await screen.findByRole("listbox", { name: "Summarize by" });
  await user.click(within(listbox).getByRole("option", { name: "COUNT" }));
  await user.click(within(region).getByRole("button", { name: "Apply" }));

  await waitFor(() => expect(cellText("B1")).toBe("Open"));
  expect(cellText("A1")).toBe("Region");
  expect(cellText("C1")).toBe("Closed");
  expect(cellText("D1")).toBe("Grand Total");
  expect(cellText("A2")).toBe("East");
  expect(cellText("B2")).toBe("1");
  expect(cellText("C2")).toBe("0");
  expect(cellText("D2")).toBe("1");
  expect(cellText("A3")).toBe("North");
  expect(cellText("B3")).toBe("0");
  expect(cellText("C3")).toBe("1");
  expect(cellText("A5")).toBe("Grand Total");
  expect(cellText("B5")).toBe("2");
  expect(cellText("C5")).toBe("1");
  expect(cellText("D5")).toBe("3");
  // The applied layout is stored with the pivot worksheet.
  const pivot = api!.workbooks[0].worksheets.find((worksheet) => worksheet.name === "Pivot1")!;
  expect(pivot.pivot).toMatchObject({
    sourceWorksheetId: SEED_WORKSHEET_ID,
    rowField: "Region",
    columnField: "Status",
    valueField: "Sales",
    summarizeBy: "COUNT",
  });
});

test("Refresh pivot table recomputes from the edited source and never edits it", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();
  await createPivot(user);

  await user.click(screen.getByRole("tab", { name: "Sheet1" }));
  await waitFor(() => expect(cellText("A2")).toBe("East"));
  await user.dblClick(screen.getByRole("gridcell", { name: "B2" }));
  const inline = screen.getByRole("textbox", { name: "Edit B2" });
  await user.clear(inline);
  await user.type(inline, "1500{Enter}");
  await waitFor(() => expect(cellText("B2")).toBe("1500"));

  await user.click(screen.getByRole("tab", { name: "Pivot1" }));
  const region = await editor();
  // Before the refresh the old summary is still shown.
  expect(cellText("B2")).toBe("1200");
  await user.click(within(region).getByRole("button", { name: "Refresh pivot table" }));
  await waitFor(() => expect(cellText("B2")).toBe("1500"));
  expect(cellText("B5")).toBe("3000");

  // The source worksheet keeps its own value and is not part of the summary.
  const source = api!.workbooks[0].worksheets.find((worksheet) => worksheet.id === SEED_WORKSHEET_ID)!;
  expect(source.cells.B2).toBe("1500");
  expect(source.cells.A2).toBe("East");
  expect(source.cells.A5).toBeUndefined();
});

test("a deleted source header shows the required error and preserves the last result", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();
  await createPivot(user);

  await user.click(screen.getByRole("tab", { name: "Sheet1" }));
  await waitFor(() => expect(cellText("A2")).toBe("East"));
  fireEvent.contextMenu(screen.getByRole("columnheader", { name: "B" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Delete column" }));
  await waitFor(() => expect(cellText("B1")).toBe("Status"));

  await user.click(screen.getByRole("tab", { name: "Pivot1" }));
  const region = await editor();
  const alert = await within(region).findByRole("alert");
  expect(alert.textContent).toBe("Pivot field is no longer available. Select a new field.");

  await user.click(within(region).getByRole("button", { name: "Refresh pivot table" }));
  await waitFor(() => expect(within(region).getByRole("alert").textContent).toBe(
    "Pivot field is no longer available. Select a new field.",
  ));
  // The last successful summary and the source worksheet are both preserved.
  expect(cellText("A2")).toBe("East");
  expect(cellText("B5")).toBe("2700");
  const pivot = api!.workbooks[0].worksheets.find((worksheet) => worksheet.name === "Pivot1")!;
  expect(pivot.cells.B5).toBe("2700");
  const source = api!.workbooks[0].worksheets.find((worksheet) => worksheet.id === SEED_WORKSHEET_ID)!;
  expect(source.cells.A2).toBe("East");
  expect(source.cells.B1).toBe("Status");
});

test("a selection without header cells reports an error and a failed creation keeps the tabs", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  await user.click(screen.getByRole("gridcell", { name: "F10" }));
  await openDataCommand(user, "Create pivot table");
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Select a range with header cells to create a pivot table");
  expect(screen.queryByRole("dialog", { name: "Create pivot table" })).toBeNull();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2"]);

  // A rejected creation reports the failure inside the dialog and adds no tab.
  api.failOnce("POST", CREATE_PATH);
  await user.click(screen.getByRole("gridcell", { name: "A1" }));
  await openDataCommand(user, "Create pivot table");
  const dialog = await screen.findByRole("dialog", { name: "Create pivot table" });
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
  expect((await within(dialog).findByRole("alert")).textContent).toBe("Server error");
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2"]);
  expect(api!.workbooks[0].worksheets.map((worksheet) => worksheet.name)).toEqual(["Sheet1", "Sheet2"]);
});
