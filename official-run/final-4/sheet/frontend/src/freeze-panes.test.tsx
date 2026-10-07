import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import { cellName, columnName } from "./domain/grid";
import type { Workbook } from "./domain/types";
import { installFakeApi, type FakeApi } from "./test/fake-api";

/** Stable ids of the pre-provisioned freeze-panes workbooks (see the backend seed). */
const FREEZE_ROW_WORKBOOK_ID = "EVO-N01-FREEZE-ROW";
const FREEZE_ROW_WORKSHEET_ID = "ws-evo-n01-freeze-row-scrollledger";
const FREEZE_COLUMN_WORKBOOK_ID = "EVO-N01-FREEZE-COLUMN";
const FREEZE_COLUMN_WORKSHEET_ID = "ws-evo-n01-freeze-column-scrollledger";
const FREEZE_BOTH_WORKBOOK_ID = "EVO-N01-FREEZE-BOTH";
const FREEZE_BOTH_WORKSHEET_ID = "ws-evo-n01-freeze-both-scrollledger";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

const SCROLL_HEADERS = [
  "Entry",
  "Amount",
  "Status",
  "Owner",
  "Region",
  "Quarter",
  "Channel",
  "Margin",
  "Units",
  "Target",
  "Delta",
  "Notes",
];

/** `ScrollLedger` table with headers in row 1 and records up to `rows`/`columns`. */
function scrollLedgerCells(rows: number, columns: number): Record<string, string> {
  const cells: Record<string, string> = {};
  for (let column = 1; column <= columns; column += 1) {
    cells[cellName(1, column)] = SCROLL_HEADERS[column - 1] ?? `Field ${columnName(column)}`;
  }
  for (let row = 2; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      cells[cellName(row, column)] = `${columnName(column)}-${row}`;
    }
  }
  return cells;
}

function workbook(id: string, worksheetId: string, cells: Record<string, string>): Workbook {
  return {
    id,
    name: id,
    createdAt: "2026-09-05T09:20:00.000Z",
    updatedAt: "2026-09-06T09:20:00.000Z",
    activeWorksheetId: worksheetId,
    worksheets: [{ id: worksheetId, name: "ScrollLedger", selection: { anchor: "A1", focus: "A1" }, cells }],
  };
}

const freezeRowWorkbook = () => workbook(FREEZE_ROW_WORKBOOK_ID, FREEZE_ROW_WORKSHEET_ID, scrollLedgerCells(40, 3));
const freezeColumnWorkbook = () =>
  workbook(FREEZE_COLUMN_WORKBOOK_ID, FREEZE_COLUMN_WORKSHEET_ID, scrollLedgerCells(8, 12));
const freezeBothWorkbook = () => workbook(FREEZE_BOTH_WORKBOOK_ID, FREEZE_BOTH_WORKSHEET_ID, scrollLedgerCells(40, 12));

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function cell(name: string): HTMLElement {
  return screen.getByRole("gridcell", { name });
}

function frozenButton(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

/** Opens one pre-provisioned workbook through its deep link. */
function openWorkbook(book: Workbook) {
  window.location.hash = `#/workbooks/${book.id}`;
  api = installFakeApi([book]);
  return render(<App />);
}

async function freezeThroughViewMenu(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(screen.getByRole("button", { name: "View" }));
  await user.click(await screen.findByRole("menuitem", { name: item }));
}

test("freezing the first row shows 1 frozen row and keeps it after refresh", async () => {
  const user = userEvent.setup();
  const view = openWorkbook(freezeRowWorkbook());
  await grid();

  await user.click(cell("B1"));
  await freezeThroughViewMenu(user, "Freeze rows through 1");

  expect(frozenButton("Frozen rows: 1; columns: 0")).toBeTruthy();
  expect(cell("B1").className).toContain("is-frozen-row");
  expect(cell("B2").className).not.toContain("is-frozen-row");
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].frozen).toEqual({ rows: 1, columns: 0 }));

  view.unmount();
  render(<App />);
  await grid();
  expect(await screen.findByRole("button", { name: "Frozen rows: 1; columns: 0" })).toBeTruthy();
  expect(api!.workbooks[0].worksheets[0].frozen).toEqual({ rows: 1, columns: 0 });
});

test("freezing the first column shows 1 frozen column and keeps it after refresh", async () => {
  const user = userEvent.setup();
  const view = openWorkbook(freezeColumnWorkbook());
  await grid();

  await user.click(cell("A8"));
  await freezeThroughViewMenu(user, "Freeze columns through A");

  expect(frozenButton("Frozen rows: 0; columns: 1")).toBeTruthy();
  expect(cell("A8").className).toContain("is-frozen-column");
  expect(cell("B8").className).not.toContain("is-frozen-column");
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].frozen).toEqual({ rows: 0, columns: 1 }));

  view.unmount();
  render(<App />);
  await grid();
  expect(await screen.findByRole("button", { name: "Frozen rows: 0; columns: 1" })).toBeTruthy();
});

test("freezing panes at C4 freezes the three rows above and the two columns left of it", async () => {
  const user = userEvent.setup();
  const view = openWorkbook(freezeBothWorkbook());
  await grid();

  await user.click(cell("C4"));
  await freezeThroughViewMenu(user, "Freeze panes at C4");

  expect(frozenButton("Frozen rows: 3; columns: 2")).toBeTruthy();
  // Rows above and columns left of C4 are held in place; C4 itself is not.
  expect(cell("C4").className).not.toContain("is-frozen");
  expect(cell("C3").className).toContain("is-frozen-row");
  expect(cell("C3").className).toContain("is-frozen-edge-row");
  expect(cell("C3").className).not.toContain("is-frozen-column");
  expect(cell("A4").className).toContain("is-frozen-column");
  expect(cell("A4").className).not.toContain("is-frozen-row");
  expect(cell("B2").className).toContain("is-frozen-row");
  expect(cell("B2").className).toContain("is-frozen-column");
  expect(cell("D4").className).not.toContain("is-frozen-column");
  expect(cell("C5").className).not.toContain("is-frozen-row");
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].frozen).toEqual({ rows: 3, columns: 2 }));

  view.unmount();
  render(<App />);
  await grid();
  expect(await screen.findByRole("button", { name: "Frozen rows: 3; columns: 2" })).toBeTruthy();
});

test("the freeze command names the currently selected row, column and cell", async () => {
  const user = userEvent.setup();
  openWorkbook(freezeBothWorkbook());
  await grid();

  await user.click(cell("J12"));
  await user.click(screen.getByRole("button", { name: "View" }));
  expect(await screen.findByRole("menuitem", { name: "Freeze rows through 12" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "Freeze columns through J" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "Freeze panes at J12" })).toBeTruthy();

  await user.click(screen.getByRole("menuitem", { name: "Freeze rows through 12" }));
  expect(frozenButton("Frozen rows: 12; columns: 0")).toBeTruthy();
});

test("a failed freeze reports an error and keeps the previous frozen state", async () => {
  const user = userEvent.setup();
  api = installFakeApi([freezeRowWorkbook()]);
  window.location.hash = `#/workbooks/${FREEZE_ROW_WORKBOOK_ID}`;
  render(<App />);
  await grid();

  api.failOnce("PUT", `/api/workbooks/${FREEZE_ROW_WORKBOOK_ID}/worksheets/${FREEZE_ROW_WORKSHEET_ID}/freeze`);
  await user.click(cell("B1"));
  await freezeThroughViewMenu(user, "Freeze rows through 1");

  expect((await screen.findByRole("alert")).textContent).toBe("Server error");
  await waitFor(() => expect(frozenButton("Frozen rows: 0; columns: 0")).toBeTruthy());
  expect(api.workbooks[0].worksheets[0].frozen).toBeUndefined();
});
