import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import { installFakeApi, type FakeApi } from "./test/fake-api";
import type { Workbook } from "./domain/types";

const SHEET_OK_ID = "EVO-M02-SHEET-OK";
const SHEET_DUP_ID = "EVO-M02-SHEET-DUP";
const SHEET_LIMIT_ID = "EVO-M02-SHEET-LIMIT";

/** The 51-character value of the length scenario. */
const TOO_LONG_NAME = "B".repeat(51);
/** A 50-character name, the longest one accepted after trimming. */
const MAX_LENGTH_NAME = "B".repeat(50);

/** Pre-provisioned workbooks of the worksheet-rename scenarios, as the store seeds them. */
function sheetRenameWorkbooks(): Workbook[] {
  return [
    {
      id: SHEET_OK_ID,
      name: SHEET_OK_ID,
      createdAt: "2026-09-05T08:20:00.000Z",
      updatedAt: "2026-09-06T08:20:00.000Z",
      activeWorksheetId: "ws-evo-m02-sheet-ok-harbordraft",
      worksheets: [
        {
          id: "ws-evo-m02-sheet-ok-harbordraft",
          name: "HarborDraft",
          selection: { anchor: "A1", focus: "A1" },
          cells: { D5: "dock marker" },
        },
        {
          id: "ws-evo-m02-sheet-ok-ledgerview",
          name: "LedgerView",
          selection: { anchor: "A1", focus: "A1" },
          cells: {},
        },
      ],
    },
    {
      id: SHEET_DUP_ID,
      name: SHEET_DUP_ID,
      createdAt: "2026-09-05T08:25:00.000Z",
      updatedAt: "2026-09-06T08:25:00.000Z",
      activeWorksheetId: "ws-evo-m02-sheet-dup-archivebay",
      worksheets: [
        { id: "ws-evo-m02-sheet-dup-meridian", name: "Meridian", selection: { anchor: "A1", focus: "A1" }, cells: {} },
        {
          id: "ws-evo-m02-sheet-dup-archivebay",
          name: "ArchiveBay",
          selection: { anchor: "A1", focus: "A1" },
          cells: {},
        },
      ],
    },
    {
      id: SHEET_LIMIT_ID,
      name: SHEET_LIMIT_ID,
      createdAt: "2026-09-05T08:30:00.000Z",
      updatedAt: "2026-09-06T08:30:00.000Z",
      activeWorksheetId: "ws-evo-m02-sheet-limit-lengthgauge",
      worksheets: [
        {
          id: "ws-evo-m02-sheet-limit-lengthgauge",
          name: "LengthGauge",
          selection: { anchor: "A1", focus: "A1" },
          cells: { G4: "sheet sentinel" },
        },
      ],
    },
  ];
}

let api: FakeApi | undefined;

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function workbook(id: string): Workbook {
  const found = api!.workbooks.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing workbook ${id}`);
  return found;
}

function tabNames(): (string | null)[] {
  return screen.getAllByRole("tab").map((tab) => tab.textContent);
}

async function openRenameDialog(user: ReturnType<typeof userEvent.setup>, worksheetName: string) {
  await user.click(screen.getByRole("button", { name: `Worksheet options for ${worksheetName}` }));
  const menu = await screen.findByRole("menu", { name: `Worksheet options for ${worksheetName}` });
  await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
  const input = within(dialog).getByRole("textbox", { name: "Worksheet name" }) as HTMLInputElement;
  return { dialog, input };
}

test("trims and persists an available worksheet name and keeps the worksheet cell", async () => {
  const user = userEvent.setup();
  api = installFakeApi(sheetRenameWorkbooks());
  window.location.hash = `#/workbooks/${SHEET_OK_ID}`;
  const view = render(<App />);
  await grid();

  expect(tabNames()).toEqual(["HarborDraft", "LedgerView"]);
  expect(screen.getByRole("tab", { name: "HarborDraft" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "D5" }).textContent).toBe("dock marker");

  const { dialog, input } = await openRenameDialog(user, "HarborDraft");
  expect(input.value).toBe("HarborDraft");

  await user.clear(input);
  await user.type(input, "  Dispatch Register  ");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename worksheet" })).toBeNull());
  expect(tabNames()).toEqual(["Dispatch Register", "LedgerView"]);
  expect(screen.getByRole("tab", { name: "Dispatch Register" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "D5" }).textContent).toBe("dock marker");
  expect(workbook(SHEET_OK_ID).worksheets[0].name).toBe("Dispatch Register");

  // A refresh keeps the saved tab active, its cell and the prefilled dialog value.
  view.unmount();
  render(<App />);
  await grid();
  expect(tabNames()).toEqual(["Dispatch Register", "LedgerView"]);
  expect(screen.getByRole("tab", { name: "Dispatch Register" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "D5" }).textContent).toBe("dock marker");

  const reopened = await openRenameDialog(user, "Dispatch Register");
  expect(reopened.input.value).toBe("Dispatch Register");
});

test("rejects a worksheet name differing only by case and keeps the active tab and prefill", async () => {
  const user = userEvent.setup();
  api = installFakeApi(sheetRenameWorkbooks());
  window.location.hash = `#/workbooks/${SHEET_DUP_ID}`;
  const view = render(<App />);
  await grid();

  expect(tabNames()).toEqual(["Meridian", "ArchiveBay"]);
  expect(screen.getByRole("tab", { name: "ArchiveBay" }).getAttribute("aria-selected")).toBe("true");

  const { dialog, input } = await openRenameDialog(user, "ArchiveBay");
  expect(input.value).toBe("ArchiveBay");
  await user.clear(input);
  await user.type(input, "meridian");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Worksheet name already exists");
  expect(input.value).toBe("ArchiveBay");
  expect(tabNames()).toEqual(["Meridian", "ArchiveBay"]);
  expect(screen.getByRole("tab", { name: "ArchiveBay" }).getAttribute("aria-selected")).toBe("true");
  expect(workbook(SHEET_DUP_ID).worksheets[1].name).toBe("ArchiveBay");

  // After a refresh the tab is still ArchiveBay and the dialog prefills it again.
  view.unmount();
  render(<App />);
  await grid();
  expect(tabNames()).toEqual(["Meridian", "ArchiveBay"]);
  expect(screen.getByRole("tab", { name: "ArchiveBay" }).getAttribute("aria-selected")).toBe("true");
  const reopened = await openRenameDialog(user, "ArchiveBay");
  expect(reopened.input.value).toBe("ArchiveBay");
});

test("rejects a worksheet name longer than 50 characters and keeps the tab and its cell", async () => {
  const user = userEvent.setup();
  api = installFakeApi(sheetRenameWorkbooks());
  window.location.hash = `#/workbooks/${SHEET_LIMIT_ID}`;
  const view = render(<App />);
  await grid();

  const { dialog, input } = await openRenameDialog(user, "LengthGauge");
  expect(input.value).toBe("LengthGauge");
  await user.clear(input);
  await user.type(input, TOO_LONG_NAME);
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Worksheet name must be 50 characters or fewer");
  expect(input.value).toBe("LengthGauge");
  expect(tabNames()).toEqual(["LengthGauge"]);
  expect(screen.getByRole("tab", { name: "LengthGauge" }).getAttribute("aria-selected")).toBe("true");
  expect(workbook(SHEET_LIMIT_ID).worksheets[0].name).toBe("LengthGauge");

  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getByRole("tab", { name: "LengthGauge" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "G4" }).textContent).toBe("sheet sentinel");
});

test("accepts a worksheet name of exactly 50 characters", async () => {
  const user = userEvent.setup();
  api = installFakeApi(sheetRenameWorkbooks());
  window.location.hash = `#/workbooks/${SHEET_LIMIT_ID}`;
  render(<App />);
  await grid();

  const { dialog, input } = await openRenameDialog(user, "LengthGauge");
  await user.clear(input);
  await user.type(input, MAX_LENGTH_NAME);
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename worksheet" })).toBeNull());
  expect(screen.getByRole("tab", { name: MAX_LENGTH_NAME }).getAttribute("aria-selected")).toBe("true");
  expect(workbook(SHEET_LIMIT_ID).worksheets[0].name).toBe(MAX_LENGTH_NAME);
});

test("renames the tab whose menu was used and keeps the active tab untouched", async () => {
  const user = userEvent.setup();
  api = installFakeApi(sheetRenameWorkbooks());
  window.location.hash = `#/workbooks/${SHEET_OK_ID}`;
  render(<App />);
  await grid();

  // The menu belongs to the non-active tab, so the prefill comes from that tab.
  const { dialog, input } = await openRenameDialog(user, "LedgerView");
  expect(input.value).toBe("LedgerView");
  await user.clear(input);
  await user.type(input, "Ledger Archive");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename worksheet" })).toBeNull());
  expect(tabNames()).toEqual(["HarborDraft", "Ledger Archive"]);
  expect(screen.getByRole("tab", { name: "HarborDraft" }).getAttribute("aria-selected")).toBe("true");
  expect(workbook(SHEET_OK_ID).worksheets[1].name).toBe("Ledger Archive");

  // The reopened dialog of the still-active tab keeps its own name.
  const active = await openRenameDialog(user, "HarborDraft");
  expect(active.input.value).toBe("HarborDraft");
});

test("rejects an empty worksheet name and keeps the original name", async () => {
  const user = userEvent.setup();
  api = installFakeApi(sheetRenameWorkbooks());
  window.location.hash = `#/workbooks/${SHEET_OK_ID}`;
  render(<App />);
  await grid();

  const { dialog, input } = await openRenameDialog(user, "HarborDraft");
  await user.clear(input);
  await user.type(input, "   ");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Worksheet name cannot be empty");
  expect(input.value).toBe("HarborDraft");
  expect(tabNames()).toEqual(["HarborDraft", "LedgerView"]);
  expect(workbook(SHEET_OK_ID).worksheets[0].name).toBe("HarborDraft");
});

test("reports a server failure and keeps the last saved worksheet name after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi(sheetRenameWorkbooks());
  api.failOnce(
    "PATCH",
    `/api/workbooks/${SHEET_OK_ID}/worksheets/ws-evo-m02-sheet-ok-harbordraft`,
  );
  window.location.hash = `#/workbooks/${SHEET_OK_ID}`;
  const view = render(<App />);
  await grid();

  const { dialog, input } = await openRenameDialog(user, "HarborDraft");
  await user.clear(input);
  await user.type(input, "Dispatch Register");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Server error");
  expect(input.value).toBe("HarborDraft");
  expect(screen.getByRole("tab", { name: "HarborDraft" }).getAttribute("aria-selected")).toBe("true");

  view.unmount();
  render(<App />);
  await grid();
  expect(tabNames()).toEqual(["HarborDraft", "LedgerView"]);
  expect(screen.getByRole("gridcell", { name: "D5" }).textContent).toBe("dock marker");
});
