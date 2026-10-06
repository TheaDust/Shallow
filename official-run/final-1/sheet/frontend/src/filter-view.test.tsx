import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import {
  EVO_FILTER_APPLY_WORKBOOK_ID,
  EVO_FILTER_DELETE_WORKBOOK_ID,
  EVO_FILTER_SAVE_WORKBOOK_ID,
  installFakeApi,
  type FakeApi,
} from "./test/fake-api";

let api: FakeApi | undefined;

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

/** Selects the rectangle `from`..`to` the way the grid's pointer selection does. */
function dragSelect(from: string, to: string) {
  fireEvent.mouseDown(screen.getByRole("gridcell", { name: from }));
  fireEvent.mouseOver(screen.getByRole("gridcell", { name: to }), { buttons: 1 });
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: to }));
}

async function openDataCommand(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name }));
}

/** Creates the filter of the seeded `Workload` table (D3:F7). */
async function createWorkloadFilter(user: ReturnType<typeof userEvent.setup>) {
  await grid();
  dragSelect("D3", "F7");
  await openDataCommand(user, "Create filter");
  await screen.findByRole("button", { name: "Filter Workstream" });
}

/** Applies one condition of a column dialog over the filtered range. */
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

function storedViews(workbookId: string) {
  return api!.workbooks.find((workbook) => workbook.id === workbookId)?.filterViews ?? [];
}

test("REQ-5-1-2 saving the applied filter keeps only the matching row and lists the view after a refresh", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_FILTER_SAVE_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  await createWorkloadFilter(user);
  await applyCondition(user, "Workstream", "Text contains", "Atlas");
  await applyCondition(user, "Load", "Greater than", "20");

  // Both conditions combine with AND: only `Atlas/Active/31` in row 5 remains.
  expect(cellText("D5")).toBe("Atlas");
  expect(cellText("F5")).toBe("31");
  expect(cellText("D4")).toBeNull();
  expect(cellText("D6")).toBeNull();
  expect(cellText("D7")).toBeNull();
  // The hidden records keep their stored values.
  expect(storedViews(EVO_FILTER_SAVE_WORKBOOK_ID)).toEqual([]);

  await openDataCommand(user, "Save filter view");
  const save = await screen.findByRole("dialog", { name: "Save filter view" });
  await user.type(within(save).getByLabelText("Filter view name"), "Atlas active load");
  await user.click(within(save).getByRole("button", { name: "Save view" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Save filter view" })).toBeNull());

  expect(storedViews(EVO_FILTER_SAVE_WORKBOOK_ID).map((saved) => saved.name)).toEqual(["Atlas active load"]);

  // After a refresh the same row stays visible and the view is still listed.
  view.unmount();
  render(<App />);
  await grid();
  await waitFor(() => expect(cellText("D4")).toBeNull());
  expect(cellText("D5")).toBe("Atlas");
  expect(cellText("D6")).toBeNull();
  expect(cellText("D7")).toBeNull();

  await openDataCommand(user, "Filter views");
  const views = await screen.findByRole("dialog", { name: "Filter views" });
  expect(within(views).getByRole("button", { name: "Atlas active load" })).toBeTruthy();
  expect(storedViews(EVO_FILTER_SAVE_WORKBOOK_ID).map((saved) => saved.name)).toEqual(["Atlas active load"]);
});

test("REQ-5-1-2 choosing a persisted view hides the other rows and keeps the interface open", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_FILTER_APPLY_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  await grid();
  expect(cellText("D5")).toBe("Atlas");

  await openDataCommand(user, "Filter views");
  const views = await screen.findByRole("dialog", { name: "Filter views" });
  const queued = within(views).getByRole("button", { name: "Queued lanes" });
  expect(queued.getAttribute("aria-pressed")).toBe("false");
  await user.click(queued);

  await waitFor(() => expect(cellText("D5")).toBeNull());
  expect(cellText("D4")).toBe("Atlas");
  expect(cellText("D6")).toBe("Beacon");
  expect(cellText("D7")).toBe("Cirrus");
  // The interface stays open with the chosen view selected.
  const stillOpen = screen.getByRole("dialog", { name: "Filter views" });
  expect(within(stillOpen).getByRole("button", { name: "Queued lanes" }).getAttribute("aria-pressed")).toBe("true");
  // The hidden record is not deleted: it is still stored.
  expect(api!.workbooks.find((candidate) => candidate.id === EVO_FILTER_APPLY_WORKBOOK_ID)!.worksheets[0].cells.D5).toBe(
    "Atlas",
  );

  await user.click(within(stillOpen).getByRole("button", { name: "Close" }));
  view.unmount();
  render(<App />);
  await grid();
  await waitFor(() => expect(cellText("D5")).toBeNull());
  expect(cellText("D4")).toBe("Atlas");
  expect(cellText("D7")).toBe("Cirrus");

  await openDataCommand(user, "Filter views");
  expect(within(await screen.findByRole("dialog", { name: "Filter views" })).getByRole("button", { name: "Queued lanes" })).toBeTruthy();
});

test("REQ-5-1-2 a duplicate name is reported and the chosen view can be deleted again", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_FILTER_DELETE_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  await createWorkloadFilter(user);
  await openDataCommand(user, "Save filter view");
  const save = await screen.findByRole("dialog", { name: "Save filter view" });
  await user.type(within(save).getByLabelText("Filter view name"), "  queued lanes  ");
  await user.click(within(save).getByRole("button", { name: "Save view" }));

  const alert = await within(save).findByRole("alert");
  expect(alert.textContent).toBe("Filter view name already exists");
  // The rejected save keeps the interface open and stores nothing new.
  expect(screen.getByRole("dialog", { name: "Save filter view" })).toBeTruthy();
  expect(storedViews(EVO_FILTER_DELETE_WORKBOOK_ID).map((saved) => saved.name)).toEqual(["Queued lanes"]);
  await user.click(within(save).getByRole("button", { name: "Close" }));

  await openDataCommand(user, "Filter views");
  const views = await screen.findByRole("dialog", { name: "Filter views" });
  await user.click(within(views).getByRole("button", { name: "Queued lanes" }));
  await waitFor(() => expect(cellText("D5")).toBeNull());
  expect(cellText("D4")).toBe("Atlas");

  await user.click(within(views).getByRole("button", { name: "Delete filter view" }));
  await waitFor(() => expect(within(views).queryByRole("button", { name: "Queued lanes" })).toBeNull());
  expect(cellText("D4")).toBe("Atlas");
  expect(cellText("D5")).toBe("Atlas");
  expect(cellText("D6")).toBe("Beacon");
  expect(cellText("D7")).toBe("Cirrus");
  expect(storedViews(EVO_FILTER_DELETE_WORKBOOK_ID)).toEqual([]);

  view.unmount();
  render(<App />);
  await grid();
  await waitFor(() => expect(cellText("D4")).toBe("Atlas"));
  expect(cellText("D5")).toBe("Atlas");
  expect(cellText("D7")).toBe("Cirrus");
  await openDataCommand(user, "Filter views");
  const reopened = await screen.findByRole("dialog", { name: "Filter views" });
  expect(within(reopened).queryByRole("button", { name: "Queued lanes" })).toBeNull();
  expect(within(reopened).getByText("No saved filter views")).toBeTruthy();
});
