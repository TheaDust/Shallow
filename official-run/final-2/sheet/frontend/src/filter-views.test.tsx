import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import {
  EVO_FILTER_APPLY_ID,
  EVO_FILTER_DELETE_ID,
  EVO_FILTER_SAVE_ID,
  installFakeApi,
  type FakeApi,
} from "./test/fake-api";

let api: FakeApi | undefined;

beforeEach(() => {
  window.location.hash = `#/workbooks/${EVO_FILTER_SAVE_ID}`;
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

/** Opens one independent `EVO-M04-*` workbook and renders its editor. */
function openWorkbook(id: string) {
  window.location.hash = `#/workbooks/${id}`;
  return render(<App />);
}

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

/** Visible text of one grid cell, or `null` when its row is hidden. */
function cellText(name: string): string | null {
  return screen.queryByRole("gridcell", { name })?.textContent ?? null;
}

/** The record text the grid exposes for one row of values, or `null`. */
function recordText(record: string): string | null {
  return screen.queryByText(record, { exact: true })?.textContent ?? null;
}

/** The stored worksheet of an `EVO-M04-*` workbook, for the value assertions. */
function sheet(id: string) {
  return workbook(id).worksheets[0];
}

/** The stored workbook of an `EVO-M04-*` id, for the saved-view assertions. */
function workbook(id: string) {
  return api!.workbooks.find((candidate) => candidate.id === id)!;
}

async function openDataCommand(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name }));
}

/** Creates the filter view over the pre-selected range and awaits its buttons. */
async function createFilter(user: ReturnType<typeof userEvent.setup>) {
  await openDataCommand(user, "Create filter");
  await screen.findByRole("button", { name: "Filter Workstream" });
}

/** Applies one condition to one header of the applied filter view. */
async function applyCondition(
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

/** The controls naming the saved views, in save order. */
function viewNames(dialog: HTMLElement): Array<string | null> {
  return within(dialog)
    .queryAllByRole("listitem")
    .map((item) => item.textContent);
}

test("saving a two-condition filter view keeps the visible row and the saved name", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  openWorkbook(EVO_FILTER_SAVE_ID);
  await grid();

  await createFilter(user);
  await applyCondition(user, "Workstream", "Text contains", "Atlas");
  await applyCondition(user, "Load", "Greater than", "20");

  // Only Atlas/Active/31 satisfies both conditions; no record was removed.
  expect(cellText("D4")).toBeNull();
  expect(cellText("D5")).toBe("Atlas");
  expect(cellText("F5")).toBe("31");
  expect(cellText("D6")).toBeNull();
  expect(cellText("D7")).toBeNull();
  expect(recordText("Atlas/Active/31")).toBe("Atlas/Active/31");
  expect(recordText("Atlas/Queued/17")).toBeNull();
  expect(recordText("Beacon/Queued/22")).toBeNull();
  expect(recordText("Cirrus/Queued/9")).toBeNull();
  expect(sheet(EVO_FILTER_SAVE_ID).cells.D4).toBe("Atlas");
  expect(sheet(EVO_FILTER_SAVE_ID).cells.D6).toBe("Beacon");
  expect(sheet(EVO_FILTER_SAVE_ID).cells.F4).toBe("17");

  await openDataCommand(user, "Save filter view");
  const dialog = await screen.findByRole("dialog", { name: "Save filter view" });
  await user.type(within(dialog).getByLabelText("Filter view name"), "Atlas active load");
  await user.click(within(dialog).getByRole("button", { name: "Save view" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Save filter view" })).toBeNull());

  // Reopening the workbook keeps both the saved view and the visible row.
  cleanup();
  openWorkbook(EVO_FILTER_SAVE_ID);
  await grid();
  expect(cellText("D5")).toBe("Atlas");
  expect(cellText("D4")).toBeNull();
  expect(cellText("D6")).toBeNull();
  expect(recordText("Atlas/Active/31")).toBe("Atlas/Active/31");
  expect(recordText("Beacon/Queued/22")).toBeNull();

  await openDataCommand(user, "Filter views");
  const views = await screen.findByRole("dialog", { name: "Filter views" });
  expect(viewNames(views)).toEqual(["Atlas active load"]);
});

test("choosing a persisted filter view hides the non-matching rows and stays open", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  openWorkbook(EVO_FILTER_APPLY_ID);
  await grid();

  await openDataCommand(user, "Filter views");
  const views = await screen.findByRole("dialog", { name: "Filter views" });
  expect(viewNames(views)).toEqual(["Queued lanes"]);
  await user.click(within(views).getByRole("button", { name: "Queued lanes" }));

  // The interface stays open with that view selected; only Phase=Queued rows remain.
  expect(screen.getByRole("dialog", { name: "Filter views" })).toBeTruthy();
  expect(within(views).getByRole("button", { name: "Queued lanes" }).getAttribute("aria-pressed")).toBe("true");
  expect(cellText("D4")).toBe("Atlas");
  expect(cellText("F4")).toBe("17");
  expect(cellText("D5")).toBeNull();
  expect(cellText("D6")).toBe("Beacon");
  expect(cellText("D7")).toBe("Cirrus");
  expect(recordText("Atlas/Queued/17")).toBe("Atlas/Queued/17");
  expect(recordText("Beacon/Queued/22")).toBe("Beacon/Queued/22");
  expect(recordText("Cirrus/Queued/9")).toBe("Cirrus/Queued/9");
  expect(recordText("Atlas/Active/31")).toBeNull();
  expect(sheet(EVO_FILTER_APPLY_ID).cells.E5).toBe("Active");

  cleanup();
  openWorkbook(EVO_FILTER_APPLY_ID);
  await grid();
  expect(cellText("D4")).toBe("Atlas");
  expect(cellText("D5")).toBeNull();
  expect(cellText("D6")).toBe("Beacon");
  expect(cellText("D7")).toBe("Cirrus");
  expect(recordText("Atlas/Queued/17")).toBe("Atlas/Queued/17");
  expect(recordText("Atlas/Active/31")).toBeNull();
});

test("a duplicate name is reported in the open dialog and deleting restores every row", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  openWorkbook(EVO_FILTER_DELETE_ID);
  await grid();

  await createFilter(user);
  await openDataCommand(user, "Save filter view");
  const save = await screen.findByRole("dialog", { name: "Save filter view" });
  await user.type(within(save).getByLabelText("Filter view name"), " queued lanes ");
  await user.click(within(save).getByRole("button", { name: "Save view" }));
  expect((await within(save).findByRole("alert")).textContent).toBe("Filter view name already exists");
  expect(screen.getByRole("dialog", { name: "Save filter view" })).toBeTruthy();
  expect(workbook(EVO_FILTER_DELETE_ID).filterViews!.map((view) => view.name)).toEqual(["Queued lanes"]);
  await user.click(within(save).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Save filter view" })).toBeNull());

  await openDataCommand(user, "Filter views");
  const views = await screen.findByRole("dialog", { name: "Filter views" });
  await user.click(within(views).getByRole("button", { name: "Queued lanes" }));
  expect(cellText("D5")).toBeNull();
  await user.click(within(views).getByRole("button", { name: "Delete filter view" }));
  await waitFor(() => expect(cellText("D5")).toBe("Atlas"));
  expect(cellText("D4")).toBe("Atlas");
  expect(cellText("D6")).toBe("Beacon");
  expect(cellText("D7")).toBe("Cirrus");
  expect(recordText("Atlas/Queued/17")).toBe("Atlas/Queued/17");
  expect(recordText("Atlas/Active/31")).toBe("Atlas/Active/31");
  expect(recordText("Beacon/Queued/22")).toBe("Beacon/Queued/22");
  expect(recordText("Cirrus/Queued/9")).toBe("Cirrus/Queued/9");
  expect(within(views).queryByRole("button", { name: "Queued lanes" })).toBeNull();
  expect(viewNames(views)).toEqual([]);
  // The deleted view never touches the records it used to hide.
  expect(sheet(EVO_FILTER_DELETE_ID).cells.D5).toBe("Atlas");
  expect(sheet(EVO_FILTER_DELETE_ID).cells.F5).toBe("31");

  cleanup();
  openWorkbook(EVO_FILTER_DELETE_ID);
  await grid();
  expect(cellText("D4")).toBe("Atlas");
  expect(cellText("D5")).toBe("Atlas");
  expect(cellText("D6")).toBe("Beacon");
  expect(cellText("D7")).toBe("Cirrus");
  expect(recordText("Atlas/Queued/17")).toBe("Atlas/Queued/17");
  expect(recordText("Atlas/Active/31")).toBe("Atlas/Active/31");
  await openDataCommand(user, "Filter views");
  const reopened = await screen.findByRole("dialog", { name: "Filter views" });
  expect(within(reopened).queryByRole("button", { name: "Queued lanes" })).toBeNull();
  expect(viewNames(reopened)).toEqual([]);
});
