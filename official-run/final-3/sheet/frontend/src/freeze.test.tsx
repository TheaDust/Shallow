import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import { cellName } from "./domain/grid";
import type { Workbook } from "./domain/types";
import { installFakeApi, type FakeApi } from "./test/fake-api";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

const LEDGER_HEADERS = [
  "Entry",
  "Owner",
  "Team",
  "Amount",
  "Opened",
  "Status",
  "Priority",
  "Region",
  "Channel",
  "Reviewer",
  "Age",
  "Notes",
];

/** `ScrollLedger` of a freeze scenario: headers in row 1, records up to `lastRow`. */
function scrollLedgerCells(lastRow: number): Record<string, string> {
  const cells: Record<string, string> = {};
  LEDGER_HEADERS.forEach((header, index) => {
    cells[cellName(1, index + 1)] = header;
  });
  for (let row = 2; row <= lastRow; row += 1) {
    cells[cellName(row, 1)] = `E-${String(row).padStart(4, "0")}`;
    cells[cellName(row, 2)] = "Ada";
    cells[cellName(row, 12)] = row % 2 === 0 ? "Checked" : "Pending";
  }
  return cells;
}

function freezeWorkbook(id: string, lastRow: number): Workbook {
  const worksheetId = `ws-${id}`;
  return {
    id,
    name: id,
    createdAt: "2026-10-06T09:00:00.000Z",
    updatedAt: "2026-10-06T09:00:00.000Z",
    activeWorksheetId: worksheetId,
    worksheets: [
      {
        id: worksheetId,
        name: "ScrollLedger",
        selection: { anchor: "A1", focus: "A1" },
        cells: scrollLedgerCells(lastRow),
      },
    ],
  };
}

/** Opens a pre-provisioned workbook through its deep link. */
function open(workbook: Workbook) {
  window.location.hash = `#/workbooks/${workbook.id}`;
  api = installFakeApi([workbook]);
  return render(<App />);
}

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

async function selectCell(name: string) {
  await grid();
  const user = userEvent.setup();
  await user.click(screen.getByRole("gridcell", { name }));
  return user;
}

/** Opens the "View" menu of the editor and clicks the given freeze command. */
async function freezeThrough(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole("button", { name: "View" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: label }));
}

test("freezing rows through the selected row reports 'Frozen rows: 1; columns: 0' and keeps it after refresh", async () => {
  const view = open(freezeWorkbook("EVO-N01-FREEZE-ROW", 40));
  const user = await selectCell("B1");
  expect(await screen.findByRole("button", { name: "Frozen rows: 0; columns: 0" })).toBeTruthy();

  await freezeThrough(user, "Freeze rows through 1");

  expect(screen.getByRole("button", { name: "Frozen rows: 1; columns: 0" })).toBeTruthy();
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].freeze).toEqual({ rows: 1, columns: 0 }));
  // The frozen state is view state: the records stay where they are.
  expect(screen.getByRole("gridcell", { name: "A40" }).textContent).toBe("E-0040");

  view.unmount();
  render(<App />);
  await grid();
  expect(await screen.findByRole("button", { name: "Frozen rows: 1; columns: 0" })).toBeTruthy();
});

test("freezing columns through the selected column reports 'Frozen rows: 0; columns: 1' and keeps it after refresh", async () => {
  const view = open(freezeWorkbook("EVO-N01-FREEZE-COLUMN", 12));
  const user = await selectCell("A8");

  await freezeThrough(user, "Freeze columns through A");

  expect(screen.getByRole("button", { name: "Frozen rows: 0; columns: 1" })).toBeTruthy();
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].freeze).toEqual({ rows: 0, columns: 1 }));

  view.unmount();
  render(<App />);
  await grid();
  expect(await screen.findByRole("button", { name: "Frozen rows: 0; columns: 1" })).toBeTruthy();
});

test("freezing panes at the selected cell freezes the rows above and columns to its left", async () => {
  const view = open(freezeWorkbook("EVO-N01-FREEZE-BOTH", 40));
  const user = await selectCell("C4");

  await freezeThrough(user, "Freeze panes at C4");

  expect(screen.getByRole("button", { name: "Frozen rows: 3; columns: 2" })).toBeTruthy();
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].freeze).toEqual({ rows: 3, columns: 2 }));

  view.unmount();
  render(<App />);
  await grid();
  expect(await screen.findByRole("button", { name: "Frozen rows: 3; columns: 2" })).toBeTruthy();
});

test("the View menu commands follow the selected cell and keep the other axis", async () => {
  open(freezeWorkbook("EVO-N01-FREEZE-BOTH", 40));
  const user = await selectCell("D6");

  await user.click(screen.getByRole("button", { name: "View" }));
  const menu = await screen.findByRole("menu");
  expect(within(menu).getByRole("menuitem", { name: "Freeze rows through 6" })).toBeTruthy();
  expect(within(menu).getByRole("menuitem", { name: "Freeze columns through D" })).toBeTruthy();
  await user.click(within(menu).getByRole("menuitem", { name: "Freeze panes at D6" }));

  expect(screen.getByRole("button", { name: "Frozen rows: 5; columns: 3" })).toBeTruthy();

  // Freezing rows afterwards reuses the stored column count.
  await selectCell("B2");
  await freezeThrough(user, "Freeze rows through 2");
  expect(await screen.findByRole("button", { name: "Frozen rows: 2; columns: 3" })).toBeTruthy();
  expect(api!.workbooks[0].worksheets[0].freeze).toEqual({ rows: 2, columns: 3 });
});

test("a rejected freeze keeps the previous counts and reports the error", async () => {
  open(freezeWorkbook("EVO-N01-FREEZE-ROW", 40));
  const user = await selectCell("B1");
  await freezeThrough(user, "Freeze rows through 1");
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].freeze).toEqual({ rows: 1, columns: 0 }));

  await selectCell("B3");
  api!.failOnce("PATCH", `/api/workbooks/EVO-N01-FREEZE-ROW/worksheets/ws-EVO-N01-FREEZE-ROW/freeze`);
  await freezeThrough(user, "Freeze rows through 3");

  expect((await screen.findByRole("alert")).textContent).toBe("Server error");
  expect(screen.getByRole("button", { name: "Frozen rows: 1; columns: 0" })).toBeTruthy();
  expect(api!.workbooks[0].worksheets[0].freeze).toEqual({ rows: 1, columns: 0 });
});
