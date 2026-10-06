import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import {
  EVO_FREEZE_BOTH_WORKBOOK_ID,
  EVO_FREEZE_COLUMN_WORKBOOK_ID,
  EVO_FREEZE_ROW_WORKBOOK_ID,
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

/** Selects one cell the way the grid's pointer selection does. */
function selectCell(name: string) {
  const cell = screen.getByRole("gridcell", { name });
  fireEvent.mouseDown(cell);
  fireEvent.mouseUp(cell);
}

async function openViewCommand(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "View" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name }));
}

function frozenState(workbookId: string) {
  return api!.workbooks.find((workbook) => workbook.id === workbookId)?.worksheets[0].freeze;
}

test("REQ-6-1-1 freezing through the selected row keeps the count after a refresh", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_FREEZE_ROW_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  // The pre-provisioned ledger starts unfrozen; its headers are in row 1.
  expect(screen.getByRole("button", { name: "Frozen rows: 0; columns: 0" })).toBeTruthy();
  expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Entry");

  selectCell("B1");
  await openViewCommand(user, "Freeze rows through 1");

  expect(await screen.findByRole("button", { name: "Frozen rows: 1; columns: 0" })).toBeTruthy();
  expect(frozenState(EVO_FREEZE_ROW_WORKBOOK_ID)).toEqual({ rows: 1, columns: 0 });

  view.unmount();
  render(<App />);
  await grid();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Frozen rows: 1; columns: 0" })).toBeTruthy(),
  );
});

test("REQ-6-1-1 freezing through the selected column keeps the count after a refresh", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_FREEZE_COLUMN_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  selectCell("A8");
  await openViewCommand(user, "Freeze columns through A");

  expect(await screen.findByRole("button", { name: "Frozen rows: 0; columns: 1" })).toBeTruthy();
  expect(frozenState(EVO_FREEZE_COLUMN_WORKBOOK_ID)).toEqual({ rows: 0, columns: 1 });

  view.unmount();
  render(<App />);
  await grid();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Frozen rows: 0; columns: 1" })).toBeTruthy(),
  );
});

test("REQ-6-1-1 freezing panes at a cell freezes the rows above and columns to the left", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_FREEZE_BOTH_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  // The frozen scenario carries data through row 40 and column L.
  expect(screen.getByRole("gridcell", { name: "L40" })).toBeTruthy();

  selectCell("C4");
  await openViewCommand(user, "Freeze panes at C4");

  expect(await screen.findByRole("button", { name: "Frozen rows: 3; columns: 2" })).toBeTruthy();
  // Cells and formula bar keep the selected cell; only the panes were stored.
  expect(screen.getByRole("gridcell", { name: "C4" }).getAttribute("aria-selected")).toBe("true");
  expect(frozenState(EVO_FREEZE_BOTH_WORKBOOK_ID)).toEqual({ rows: 3, columns: 2 });

  view.unmount();
  render(<App />);
  await grid();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Frozen rows: 3; columns: 2" })).toBeTruthy(),
  );
});
