import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import { installFakeApi, type FakeApi } from "./test/fake-api";

const SAVE_ID = "EVO-M04-FILTER-SAVE";
const APPLY_ID = "EVO-M04-FILTER-APPLY";
const DELETE_ID = "EVO-M04-FILTER-DELETE";
const DUPLICATE_MESSAGE = "Filter view name already exists";

let api: FakeApi | undefined;

beforeEach(() => {
  window.location.hash = `#/workbooks/${SAVE_ID}`;
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function sheet(id: string) {
  return api!.workbooks.find((workbook) => workbook.id === id)!.worksheets[0];
}

async function openDataCommand(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name }));
}

/** Creates the filter view over the pre-provisioned D3:F7 range. */
async function createFilter(user: ReturnType<typeof userEvent.setup>) {
  await openDataCommand(user, "Create filter");
  await screen.findByRole("button", { name: "Filter Workstream" });
}

/** Adds one condition to a header's filter dialog and applies it. */
async function applyCondition(
  user: ReturnType<typeof userEvent.setup>,
  header: string,
  condition: string,
  value?: string,
) {
  await user.click(screen.getByRole("button", { name: `Filter ${header}` }));
  const dialog = await screen.findByRole("dialog", { name: `Filter ${header}` });
  await user.selectOptions(within(dialog).getByLabelText("Condition"), condition);
  if (value !== undefined) await user.type(within(dialog).getByLabelText("Value"), value);
  await user.click(within(dialog).getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: `Filter ${header}` })).toBeNull());
}

function cellText(name: string): string | null {
  return screen.queryByRole("gridcell", { name })?.textContent ?? null;
}

/** Rows 4..7 of the pre-provisioned Workload range, in source order. */
function visibleRows(): Array<string | null> {
  return ["D4", "D5", "D6", "D7"].map(cellText);
}

test("Save filter view keeps two conditions under a name that survives a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();
  await createFilter(user);
  await applyCondition(user, "Workstream", "Text contains", "Atlas");
  await applyCondition(user, "Load", "Greater than", "20");

  // Both conditions combine with AND: only the Atlas/Active/31 record remains.
  expect(visibleRows()).toEqual([null, "Atlas", null, null]);
  expect(cellText("E5")).toBe("Active");
  expect(cellText("F5")).toBe("31");
  expect(sheet(SAVE_ID).cells.D4).toBe("Atlas");

  await openDataCommand(user, "Save filter view");
  const save = await screen.findByRole("region", { name: "Save filter view" });
  await user.type(within(save).getByLabelText("Filter view name"), "Atlas active load");
  await user.click(within(save).getByRole("button", { name: "Save view" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Save filter view" })).toBeNull());

  const views = sheet(SAVE_ID).filterViews ?? [];
  expect(views.map((view) => view.name)).toEqual(["Atlas active load"]);
  expect(views[0].filter.range).toBe("D3:F7");

  // Reopening the workbook keeps the view and the row it lets through.
  cleanup();
  render(<App />);
  await grid();
  expect(visibleRows()).toEqual([null, "Atlas", null, null]);

  await openDataCommand(user, "Filter views");
  const manager = await screen.findByRole("region", { name: "Filter views" });
  expect(within(manager).getByRole("button", { name: "Atlas active load" })).toBeTruthy();
  expect(within(manager).getByRole("button", { name: "Delete filter view" })).toBeTruthy();
  await user.click(within(manager).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Filter views" })).toBeNull());
  expect(visibleRows()).toEqual([null, "Atlas", null, null]);
});

test("choosing a saved filter view hides the other records and keeps the view selected", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${APPLY_ID}`;
  render(<App />);
  await grid();

  // The pre-provisioned view is not applied yet: every record is visible.
  expect(visibleRows()).toEqual(["Atlas", "Atlas", "Beacon", "Cirrus"]);

  await openDataCommand(user, "Filter views");
  const manager = await screen.findByRole("region", { name: "Filter views" });
  const view = within(manager).getByRole("button", { name: "Queued lanes" });
  await user.click(view);

  // The interface stays open with the view selected and the filter applied.
  expect(await screen.findByRole("region", { name: "Filter views" })).toBeTruthy();
  await waitFor(() =>
    expect(within(manager).getByRole("button", { name: "Queued lanes" }).getAttribute("aria-pressed")).toBe("true"),
  );
  expect(visibleRows()).toEqual(["Atlas", null, "Beacon", "Cirrus"]);
  expect(sheet(APPLY_ID).cells.D5).toBe("Atlas");
  await user.click(within(manager).getByRole("button", { name: "Close" }));

  cleanup();
  render(<App />);
  await grid();
  expect(visibleRows()).toEqual(["Atlas", null, "Beacon", "Cirrus"]);
  expect(sheet(APPLY_ID).filterViews?.map((entry) => entry.name)).toEqual(["Queued lanes"]);
});

test("a trimmed duplicate name is rejected in place, then the view is deleted and every row restored", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${DELETE_ID}`;
  render(<App />);
  await grid();
  await createFilter(user);

  await openDataCommand(user, "Save filter view");
  const save = await screen.findByRole("region", { name: "Save filter view" });
  await user.type(within(save).getByLabelText("Filter view name"), " queued lanes ");
  await user.click(within(save).getByRole("button", { name: "Save view" }));

  // A rejected save shows the exact message and stays open with the typed name.
  expect((await within(save).findByRole("alert")).textContent).toBe(DUPLICATE_MESSAGE);
  expect((within(save).getByLabelText("Filter view name") as HTMLInputElement).value).toBe(" queued lanes ");
  expect(sheet(DELETE_ID).filterViews?.length).toBe(1);

  await openDataCommand(user, "Filter views");
  const manager = await screen.findByRole("region", { name: "Filter views" });
  await user.click(within(manager).getByRole("button", { name: "Queued lanes" }));
  await waitFor(() => expect(visibleRows()).toEqual(["Atlas", null, "Beacon", "Cirrus"]));
  expect(within(manager).getByRole("button", { name: "Queued lanes" }).getAttribute("aria-pressed")).toBe("true");

  await user.click(within(manager).getByRole("button", { name: "Delete filter view" }));
  await waitFor(() => expect(sheet(DELETE_ID).filterViews).toBeUndefined());
  expect(sheet(DELETE_ID).filter).toBeUndefined();
  expect(visibleRows()).toEqual(["Atlas", "Atlas", "Beacon", "Cirrus"]);
  expect(within(manager).queryByRole("button", { name: "Queued lanes" })).toBeNull();
  expect(sheet(DELETE_ID).cells.D5).toBe("Atlas");
  await user.click(within(manager).getByRole("button", { name: "Close" }));
  cleanup();
  render(<App />);
  await grid();
  expect(visibleRows()).toEqual(["Atlas", "Atlas", "Beacon", "Cirrus"]);
  expect(sheet(DELETE_ID).filterViews).toBeUndefined();
});

test("the Data menu offers the saved-view commands next to the filter commands", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu");
  const labels = within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
  expect(labels).toEqual([
    "Create filter",
    "Clear filter",
    "Save filter view",
    "Filter views",
    "Sort range",
    "Data validation",
    "Create pivot table",
    "Named ranges",
  ]);
});
