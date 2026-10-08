import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import { installFakeApi, type FakeApi } from "./test/fake-api";

const ROW_ID = "EVO-N01-FREEZE-ROW";
const COLUMN_ID = "EVO-N01-FREEZE-COLUMN";
const BOTH_ID = "EVO-N01-FREEZE-BOTH";

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

function sheet(id: string) {
  return api!.workbooks.find((workbook) => workbook.id === id)!.worksheets[0];
}

/** Clicks one cell so it becomes the worksheet's single selected cell. */
async function selectCell(name: string) {
  const target = await screen.findByRole("gridcell", { name });
  fireEvent.mouseDown(target);
  fireEvent.mouseUp(target);
  return target;
}

/** Opens the "View" menu and chooses one of its freeze commands by its name. */
async function openViewCommand(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "View" }));
  const menu = await screen.findByRole("menu");
  const item = within(menu).getByRole("menuitem", { name });
  await user.click(item);
}

/** Reopens the workbook from its address, as a browser refresh does. */
async function refresh() {
  cleanup();
  render(<App />);
  await grid();
}

test("Freeze rows through 1 keeps the first row frozen after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${ROW_ID}`;
  render(<App />);
  await grid();

  // The pre-provisioned ledger has its headers in row 1 and records through row 40.
  expect(cellText("A1")).toBe("Entry");
  expect(cellText("A40")).toBe("ENT-039");
  expect(screen.getByRole("button", { name: "Frozen rows: 0; columns: 0" })).toBeTruthy();

  await selectCell("B1");
  await openViewCommand(user, "Freeze rows through 1");

  expect(await screen.findByRole("button", { name: "Frozen rows: 1; columns: 0" })).toBeTruthy();
  expect(sheet(ROW_ID).frozenRows).toBe(1);
  // The frozen row stays in place while the remaining records scroll.
  expect(screen.getByRole("gridcell", { name: "A1" }).parentElement?.style.position).toBe("sticky");
  expect(screen.getByRole("gridcell", { name: "A40" }).parentElement?.style.position).toBe("");

  await refresh();
  expect(screen.getByRole("button", { name: "Frozen rows: 1; columns: 0" })).toBeTruthy();
});

test("Freeze columns through A keeps the first column frozen after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${COLUMN_ID}`;
  render(<App />);
  await grid();

  expect(cellText("L1")).toBe("Ref");
  await selectCell("A8");
  await openViewCommand(user, "Freeze columns through A");

  expect(await screen.findByRole("button", { name: "Frozen rows: 0; columns: 1" })).toBeTruthy();
  expect(sheet(COLUMN_ID).frozenColumns).toBe(1);
  expect(screen.getByRole("gridcell", { name: "A8" }).style.position).toBe("sticky");
  expect(screen.getByRole("gridcell", { name: "B8" }).style.position).toBe("");

  await refresh();
  expect(screen.getByRole("button", { name: "Frozen rows: 0; columns: 1" })).toBeTruthy();
});

test("Freeze panes at C4 freezes rows above and columns to its left after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${BOTH_ID}`;
  render(<App />);
  await grid();

  await selectCell("C4");
  await user.click(screen.getByRole("button", { name: "View" }));
  const menu = await screen.findByRole("menu");
  // The three commands name the current selection.
  expect(within(menu).getByRole("menuitem", { name: "Freeze rows through 4" })).toBeTruthy();
  expect(within(menu).getByRole("menuitem", { name: "Freeze columns through C" })).toBeTruthy();
  await user.click(within(menu).getByRole("menuitem", { name: "Freeze panes at C4" }));

  expect(await screen.findByRole("button", { name: "Frozen rows: 3; columns: 2" })).toBeTruthy();
  expect(sheet(BOTH_ID).frozenRows).toBe(3);
  expect(sheet(BOTH_ID).frozenColumns).toBe(2);

  await refresh();
  expect(screen.getByRole("button", { name: "Frozen rows: 3; columns: 2" })).toBeTruthy();
});

test("frozen panes belong to their own worksheet and a rejected save keeps the shown state", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${BOTH_ID}`;
  render(<App />);
  await grid();

  await selectCell("B2");
  await openViewCommand(user, "Freeze rows through 2");
  expect(await screen.findByRole("button", { name: "Frozen rows: 2; columns: 0" })).toBeTruthy();

  // A second worksheet starts unfrozen; switching back keeps the first one's state.
  await user.click(screen.getByRole("button", { name: "Add worksheet" }));
  await screen.findByRole("tab", { name: "Sheet1" });
  expect(await screen.findByRole("button", { name: "Frozen rows: 0; columns: 0" })).toBeTruthy();
  await user.click(screen.getByRole("tab", { name: "ScrollLedger" }));
  await grid();
  expect(await screen.findByRole("button", { name: "Frozen rows: 2; columns: 0" })).toBeTruthy();

  // A rejected save reports the error and leaves the last successful state shown.
  await selectCell("C4");
  api.failOnce(
    "PATCH",
    `/api/workbooks/${BOTH_ID}/worksheets/${BOTH_ID}--ScrollLedger/freeze`,
  );
  await openViewCommand(user, "Freeze panes at C4");
  expect((await screen.findByRole("alert")).textContent).toBe("Server error");
  expect(screen.getByRole("button", { name: "Frozen rows: 2; columns: 0" })).toBeTruthy();
});