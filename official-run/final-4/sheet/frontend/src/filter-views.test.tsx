import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import { installFakeApi, type FakeApi } from "./test/fake-api";
import type { Workbook, WorksheetFilterView } from "./domain/types";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

/** Cells of the `Workload` worksheet: range D3:F7 with headers in row 3. */
const WORKLOAD_CELLS = {
  D3: "Workstream",
  E3: "Phase",
  F3: "Load",
  D4: "Atlas",
  E4: "Queued",
  F4: "17",
  D5: "Atlas",
  E5: "Active",
  F5: "31",
  D6: "Beacon",
  E6: "Queued",
  F6: "22",
  D7: "Cirrus",
  E7: "Queued",
  F7: "9",
};

/** The pre-provisioned `Queued lanes` view: Phase accepts only `Queued`. */
function queuedLanesView(id: string): WorksheetFilterView {
  return {
    id,
    name: "Queued lanes",
    range: "D3:F7",
    columns: [{ column: 5, header: "Phase", mode: "values", values: ["Queued"] }],
  };
}

function workloadWorkbook(id: string, views: WorksheetFilterView[] = []): Workbook {
  return {
    id,
    name: id,
    createdAt: "2026-09-05T08:50:00.000Z",
    updatedAt: "2026-09-06T08:50:00.000Z",
    activeWorksheetId: `${id}-sheet`,
    worksheets: [
      {
        id: `${id}-sheet`,
        name: "Workload",
        selection: { anchor: "A1", focus: "A1" },
        cells: { ...WORKLOAD_CELLS },
        ...(views.length ? { filterViews: views } : {}),
      },
    ],
  };
}

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function cellText(name: string): string | null {
  return screen.queryByRole("gridcell", { name })?.textContent ?? null;
}

/** Selects a rectangle by dragging, the way a visitor marks a range. */
async function selectRange(anchor: string, focus: string) {
  await grid();
  fireEvent.mouseDown(screen.getByRole("gridcell", { name: anchor }));
  fireEvent.mouseOver(screen.getByRole("gridcell", { name: focus }), { buttons: 1 });
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: focus }));
}

async function openDataCommand(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name }));
}

/** Applies a condition to one filtered column through its `Filter <header>` dialog. */
async function applyCondition(
  user: ReturnType<typeof userEvent.setup>,
  header: string,
  condition: string,
  value: string,
) {
  await user.click(screen.getByRole("button", { name: `Filter ${header}` }));
  const dialog = await screen.findByRole("dialog", { name: `Filter ${header}` });
  await user.selectOptions(within(dialog).getByLabelText("Condition"), condition);
  if (value) await user.type(within(dialog).getByLabelText("Value"), value);
  await user.click(within(dialog).getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: `Filter ${header}` })).toBeNull());
}

async function openFilterViews(user: ReturnType<typeof userEvent.setup>) {
  await openDataCommand(user, "Filter views");
  return screen.findByRole("dialog", { name: "Filter views" });
}

test("saving a two-condition filter view keeps the visible row and the view after a refresh", async () => {
  const user = userEvent.setup();
  window.location.hash = "#/workbooks/EVO-M04-FILTER-SAVE";
  api = installFakeApi([workloadWorkbook("EVO-M04-FILTER-SAVE")]);
  render(<App />);
  await grid();

  await selectRange("D3", "F7");
  await openDataCommand(user, "Create filter");
  await screen.findByRole("button", { name: "Filter Workstream" });
  await applyCondition(user, "Workstream", "Text contains", "Atlas");
  await applyCondition(user, "Load", "Greater than", "20");

  // Only the Atlas row whose load is greater than 20 stays visible.
  expect(cellText("D4")).toBeNull();
  expect(cellText("D5")).toBe("Atlas");
  expect(cellText("E5")).toBe("Active");
  expect(cellText("D6")).toBeNull();
  expect(cellText("D7")).toBeNull();

  await openDataCommand(user, "Save filter view");
  const dialog = await screen.findByRole("dialog", { name: "Save filter view" });
  expect(within(dialog).getByLabelText("Filter view name")).toBeTruthy();
  await user.type(within(dialog).getByLabelText("Filter view name"), "Atlas active load");
  await user.click(within(dialog).getByRole("button", { name: "Save view" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Save filter view" })).toBeNull());

  // Refresh: the view and the same visible row are still there.
  cleanup();
  render(<App />);
  await grid();
  const views = await openFilterViews(user);
  const list = within(views).getByRole("list", { name: "Saved filter views" });
  expect(within(list).getAllByRole("button").map((button) => button.textContent)).toEqual(["Atlas active load"]);
  expect(cellText("D5")).toBe("Atlas");
  expect(cellText("D4")).toBeNull();
  expect(cellText("D6")).toBeNull();
});

test("applying a persisted saved view hides the other rows and survives a refresh", async () => {
  const user = userEvent.setup();
  window.location.hash = "#/workbooks/EVO-M04-FILTER-APPLY";
  api = installFakeApi([workloadWorkbook("EVO-M04-FILTER-APPLY", [queuedLanesView("fv-apply")])]);
  render(<App />);
  await grid();
  expect(cellText("D5")).toBe("Atlas");

  const dialog = await openFilterViews(user);
  await user.click(within(dialog).getByRole("button", { name: "Queued lanes" }));
  await waitFor(() => expect(cellText("D5")).toBeNull());

  // The Queued rows stay visible; the Active row is only hidden, not removed.
  expect(cellText("D4")).toBe("Atlas");
  expect(cellText("D6")).toBe("Beacon");
  expect(cellText("D7")).toBe("Cirrus");
  expect(api!.workbooks[0].worksheets[0].cells.D5).toBe("Atlas");
  // The interface stays open with the chosen view selected.
  const reopened = screen.getByRole("dialog", { name: "Filter views" });
  expect(within(reopened).getByRole("button", { name: "Queued lanes" }).getAttribute("aria-pressed")).toBe("true");

  cleanup();
  render(<App />);
  await grid();
  expect(cellText("D5")).toBeNull();
  expect(cellText("D4")).toBe("Atlas");
  expect(cellText("D6")).toBe("Beacon");
});

test("a duplicate name keeps the save interface open and deleting the view restores every row", async () => {
  const user = userEvent.setup();
  window.location.hash = "#/workbooks/EVO-M04-FILTER-DELETE";
  api = installFakeApi([workloadWorkbook("EVO-M04-FILTER-DELETE", [queuedLanesView("fv-delete")])]);
  render(<App />);
  await grid();

  await selectRange("D3", "F7");
  await openDataCommand(user, "Create filter");
  await screen.findByRole("button", { name: "Filter Workstream" });

  await openDataCommand(user, "Save filter view");
  const save = await screen.findByRole("dialog", { name: "Save filter view" });
  await user.type(within(save).getByLabelText("Filter view name"), " queued lanes ");
  await user.click(within(save).getByRole("button", { name: "Save view" }));

  expect((await within(save).findByRole("alert")).textContent).toBe("Filter view name already exists");
  // The rejected save leaves the dialog (and its typed name) in place.
  expect(screen.getByRole("dialog", { name: "Save filter view" })).toBeTruthy();
  await user.click(within(save).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Save filter view" })).toBeNull());

  const views = await openFilterViews(user);
  await user.click(within(views).getByRole("button", { name: "Queued lanes" }));
  await waitFor(() => expect(cellText("D5")).toBeNull());
  await user.click(within(views).getByRole("button", { name: "Delete filter view" }));
  await waitFor(() => expect(within(views).queryByRole("button", { name: "Queued lanes" })).toBeNull());

  // Every source row is visible again with its original value.
  expect(cellText("D4")).toBe("Atlas");
  expect(cellText("D5")).toBe("Atlas");
  expect(cellText("D6")).toBe("Beacon");
  expect(cellText("D7")).toBe("Cirrus");
  expect(api!.workbooks[0].worksheets[0].cells.F5).toBe("31");

  cleanup();
  render(<App />);
  await grid();
  const reopened = await openFilterViews(user);
  expect(within(reopened).queryByRole("button", { name: "Queued lanes" })).toBeNull();
  expect(cellText("D5")).toBe("Atlas");
});

test("Clear filter still restores every record next to the saved views", async () => {
  const user = userEvent.setup();
  window.location.hash = "#/workbooks/EVO-M04-FILTER-APPLY";
  api = installFakeApi([workloadWorkbook("EVO-M04-FILTER-APPLY", [queuedLanesView("fv-apply")])]);
  render(<App />);
  await grid();

  const dialog = await openFilterViews(user);
  await user.click(within(dialog).getByRole("button", { name: "Queued lanes" }));
  await waitFor(() => expect(cellText("D5")).toBeNull());
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filter views" })).toBeNull());

  await openDataCommand(user, "Clear filter");
  await waitFor(() => expect(cellText("D5")).toBe("Atlas"));
  expect(cellText("D4")).toBe("Atlas");
  expect(cellText("D6")).toBe("Beacon");
  expect(cellText("D7")).toBe("Cirrus");
  // The saved view itself was not deleted by clearing the current filter.
  expect(api!.workbooks[0].worksheets[0].filterViews?.map((view) => view.name)).toEqual(["Queued lanes"]);
});
