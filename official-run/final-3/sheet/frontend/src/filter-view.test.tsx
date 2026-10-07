import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import { installFakeApi, type FakeApi } from "./test/fake-api";
import type { FilterView, Workbook } from "./domain/types";

const SAVE_ID = "EVO-M04-FILTER-SAVE";
const APPLY_ID = "EVO-M04-FILTER-APPLY";
const DELETE_ID = "EVO-M04-FILTER-DELETE";

/** D3:F7 region of the `Workload` worksheet with its header row and records. */
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

/** Criteria of the pre-provisioned `Queued lanes` view (Phase equals `Queued`). */
const QUEUED_LANES: FilterView = {
  name: "Queued lanes",
  filter: {
    range: "D3:F7",
    columns: [
      { column: 4, header: "Workstream", mode: "values", values: [] },
      { column: 5, header: "Phase", mode: "values", values: ["Queued"] },
      { column: 6, header: "Load", mode: "values", values: [] },
    ],
  },
};

let api: FakeApi | undefined;

beforeEach(() => {
  window.location.hash = `#/workbooks/${SAVE_ID}`;
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

function workloadWorkbook(id: string, savedViews: FilterView[] = []): Workbook {
  return {
    id,
    name: id,
    createdAt: "2026-10-04T09:00:00.000Z",
    updatedAt: "2026-10-04T09:01:00.000Z",
    activeWorksheetId: `ws-${id}`,
    worksheets: [
      {
        id: `ws-${id}`,
        name: "Workload",
        selection: { anchor: "A1", focus: "A1" },
        cells: { ...WORKLOAD_CELLS },
        ...(savedViews.length ? { filterViews: savedViews.map((view) => structuredClone(view)) } : {}),
      },
    ],
  };
}

function worksheet() {
  return api!.workbooks[0].worksheets[0];
}

async function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

async function openDataCommand(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name }));
}

/** Selects a rectangle and creates the filter view over it. */
async function createFilter(user: ReturnType<typeof userEvent.setup>, anchor: string, focus: string) {
  fireEvent.mouseDown(screen.getByRole("gridcell", { name: anchor }));
  fireEvent.mouseOver(screen.getByRole("gridcell", { name: focus }), { buttons: 1 });
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: focus }));
  await openDataCommand(user, "Create filter");
  await screen.findByRole("button", { name: "Filter Workstream" });
}

/** Applies one column rule through its dialog. */
async function applyFilter(
  user: ReturnType<typeof userEvent.setup>,
  header: string,
  condition: string,
  value: string,
) {
  await user.click(screen.getByRole("button", { name: `Filter ${header}` }));
  const dialog = await screen.findByRole("dialog", { name: `Filter ${header}` });
  await user.selectOptions(within(dialog).getByLabelText("Condition"), condition);
  await user.type(within(dialog).getByLabelText("Value"), value);
  await user.click(within(dialog).getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: `Filter ${header}` })).toBeNull());
}

async function openFilterViews(user: ReturnType<typeof userEvent.setup>) {
  await openDataCommand(user, "Filter views");
  return screen.findByRole("dialog", { name: "Filter views" });
}

test("saving a two-condition filter view keeps row 5 only and lists the view after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi([workloadWorkbook(SAVE_ID)]);
  render(<App />);
  await grid();

  await createFilter(user, "D3", "F7");
  await applyFilter(user, "Workstream", "Text contains", "Atlas");
  await applyFilter(user, "Load", "Greater than", "20");

  // AND across columns: only the `Atlas/Active/31` record of row 5 survives.
  expect(screen.queryByRole("gridcell", { name: "D4" })).toBeNull();
  expect(screen.getByRole("gridcell", { name: "D5" }).textContent).toBe("Atlas");
  expect(screen.getByRole("gridcell", { name: "E5" }).textContent).toBe("Active");
  expect(screen.queryByRole("gridcell", { name: "D6" })).toBeNull();
  expect(screen.queryByRole("gridcell", { name: "D7" })).toBeNull();

  await openDataCommand(user, "Save filter view");
  const saveDialog = await screen.findByRole("dialog", { name: "Save filter view" });
  await user.type(within(saveDialog).getByLabelText("Filter view name"), "Atlas active load");
  await user.click(within(saveDialog).getByRole("button", { name: "Save view" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Save filter view" })).toBeNull());

  expect(worksheet().filterViews).toEqual([
    {
      name: "Atlas active load",
      filter: {
        range: "D3:F7",
        columns: [
          { column: 4, header: "Workstream", mode: "condition", condition: "Text contains", value: "Atlas" },
          { column: 5, header: "Phase", mode: "values", values: [] },
          { column: 6, header: "Load", mode: "condition", condition: "Greater than", value: "20" },
        ],
      },
    },
  ]);

  // The visible row and the saved view survive a refresh.
  cleanup();
  render(<App />);
  await grid();
  expect(screen.queryByRole("gridcell", { name: "D4" })).toBeNull();
  expect(screen.getByRole("gridcell", { name: "D5" }).textContent).toBe("Atlas");

  const viewsDialog = await openFilterViews(user);
  expect(within(viewsDialog).getAllByRole("button", { pressed: false })).toHaveLength(1);
  expect(within(viewsDialog).getByRole("button", { name: "Atlas active load" })).toBeTruthy();
});

test("a duplicate view name is reported and the interface stays open", async () => {
  const user = userEvent.setup();
  api = installFakeApi([workloadWorkbook(DELETE_ID, [QUEUED_LANES])]);
  window.location.hash = `#/workbooks/${DELETE_ID}`;
  render(<App />);
  await grid();

  await createFilter(user, "D3", "F7");
  await openDataCommand(user, "Save filter view");
  const saveDialog = await screen.findByRole("dialog", { name: "Save filter view" });
  await user.type(within(saveDialog).getByLabelText("Filter view name"), " queued lanes ");
  await user.click(within(saveDialog).getByRole("button", { name: "Save view" }));

  expect((await within(saveDialog).findByRole("alert")).textContent).toBe("Filter view name already exists");
  // The rejected save keeps the interface open and stores nothing extra.
  expect(screen.getByRole("dialog", { name: "Save filter view" })).toBeTruthy();
  expect(worksheet().filterViews).toEqual([QUEUED_LANES]);

  await user.click(within(saveDialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Save filter view" })).toBeNull());
});

test("choosing a saved view filters the rows and deleting it restores them", async () => {
  const user = userEvent.setup();
  api = installFakeApi([workloadWorkbook(APPLY_ID, [QUEUED_LANES])]);
  window.location.hash = `#/workbooks/${APPLY_ID}`;
  render(<App />);
  await grid();

  const viewsDialog = await openFilterViews(user);
  const view = within(viewsDialog).getByRole("button", { name: "Queued lanes" });
  expect(view.getAttribute("aria-selected")).toBe("false");
  await user.click(view);

  // The interface stays open with the view selected and its criteria applied.
  expect(screen.getByRole("dialog", { name: "Filter views" })).toBeTruthy();
  await waitFor(() => expect(view.getAttribute("aria-selected")).toBe("true"));
  expect(view.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "D4" }).textContent).toBe("Atlas");
  expect(screen.queryByRole("gridcell", { name: "D5" })).toBeNull();
  expect(screen.getByRole("gridcell", { name: "D6" }).textContent).toBe("Beacon");
  expect(screen.getByRole("gridcell", { name: "D7" }).textContent).toBe("Cirrus");
  expect(worksheet().filter).toEqual(QUEUED_LANES.filter);

  // The hidden record stays stored, and the applied view survives a refresh.
  expect(worksheet().cells.D5).toBe("Atlas");
  cleanup();
  render(<App />);
  await grid();
  expect(screen.queryByRole("gridcell", { name: "D5" })).toBeNull();
  expect(screen.getByRole("gridcell", { name: "D4" }).textContent).toBe("Atlas");

  const reopened = await openFilterViews(user);
  await user.click(within(reopened).getByRole("button", { name: "Queued lanes" }));
  await waitFor(() =>
    expect(within(reopened).getByRole("button", { name: "Queued lanes" }).getAttribute("aria-selected")).toBe(
      "true",
    ),
  );
  await user.click(within(reopened).getByRole("button", { name: "Delete filter view" }));

  // The view is gone, every source row is visible again with its value.
  await waitFor(() => expect(within(reopened).queryByRole("button", { name: "Queued lanes" })).toBeNull());
  expect(worksheet().filterViews).toBeUndefined();
  expect(worksheet().filter).toBeUndefined();
  expect(screen.getByRole("gridcell", { name: "D5" }).textContent).toBe("Atlas");
  expect(screen.getByRole("gridcell", { name: "E5" }).textContent).toBe("Active");
  expect(screen.getByRole("gridcell", { name: "D4" }).textContent).toBe("Atlas");
  expect(worksheet().cells.D5).toBe("Atlas");

  // The deletion persists after a refresh.
  cleanup();
  render(<App />);
  await grid();
  expect(screen.getByRole("gridcell", { name: "D5" }).textContent).toBe("Atlas");
  const again = await openFilterViews(user);
  expect(within(again).queryByRole("button", { name: "Queued lanes" })).toBeNull();
  expect(within(again).getByText("No saved filter views")).toBeTruthy();
});
