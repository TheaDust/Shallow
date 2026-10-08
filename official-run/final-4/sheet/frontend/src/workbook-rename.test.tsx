import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import { installFakeApi, type FakeApi } from "./test/fake-api";
import type { Workbook } from "./domain/types";

const RENAME_OK_ID = "EVO-M01-RENAME-OK";
const RENAME_DUP_ID = "EVO-M01-RENAME-DUP";
const ARCHIVE_ID = "EVO-M01-ARCHIVE-RESERVED";
const RENAME_LIMIT_ID = "EVO-M01-RENAME-LIMIT";

/** The 81-character value of the length scenario. */
const TOO_LONG_NAME = `EVO-${"A".repeat(77)}`;

/** Pre-provisioned workbooks of the rename scenarios, as the store seeds them. */
function renameWorkbooks(): Workbook[] {
  const seeded = (
    id: string,
    worksheetId: string,
    worksheetName: string,
    cells: Record<string, string>,
  ): Workbook => ({
    id,
    name: id,
    createdAt: "2026-09-05T08:00:00.000Z",
    updatedAt: "2026-09-06T08:00:00.000Z",
    activeWorksheetId: worksheetId,
    worksheets: [{ id: worksheetId, name: worksheetName, selection: { anchor: "A1", focus: "A1" }, cells }],
  });
  return [
    seeded(RENAME_OK_ID, "ws-evo-rename-ok", "IdentityLog", { F3: "unreviewed" }),
    seeded(RENAME_DUP_ID, "ws-evo-rename-dup", "IdentityLog", {}),
    seeded(ARCHIVE_ID, "ws-evo-archive", "Sheet1", {}),
    seeded(RENAME_LIMIT_ID, "ws-evo-rename-limit", "LimitProbe", { C2: "limit sentinel" }),
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

async function openRenameDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Rename workbook" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename workbook" });
  const input = within(dialog).getByRole("textbox", { name: "Workbook name" }) as HTMLInputElement;
  return { dialog, input };
}

test("trims a renamed workbook, shows the new name on the editor and the home link", async () => {
  const user = userEvent.setup();
  api = installFakeApi(renameWorkbooks());
  window.location.hash = `#/workbooks/${RENAME_OK_ID}`;
  render(<App />);
  await grid();

  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("EVO-M01-RENAME-OK");
  expect(screen.getByRole("gridcell", { name: "F3" }).textContent).toBe("unreviewed");

  const { dialog, input } = await openRenameDialog(user);
  expect(input.value).toBe("EVO-M01-RENAME-OK");

  await user.clear(input);
  await user.type(input, "  FY26 Procurement Ledger  ");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename workbook" })).toBeNull());
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("FY26 Procurement Ledger");
  expect(screen.getByRole("gridcell", { name: "F3" }).textContent).toBe("unreviewed");
  expect(api.workbooks.find((workbook) => workbook.id === RENAME_OK_ID)?.name).toBe("FY26 Procurement Ledger");

  await user.click(screen.getByRole("link", { name: "Home" }));
  const link = await screen.findByRole("link", { name: "FY26 Procurement Ledger" });
  expect(link.getAttribute("href")).toBe(`#/workbooks/${RENAME_OK_ID}`);
});

test("keeps the saved name after a refresh and prefills it when reopening the dialog", async () => {
  const user = userEvent.setup();
  api = installFakeApi(renameWorkbooks());
  window.location.hash = `#/workbooks/${RENAME_OK_ID}`;
  const view = render(<App />);
  await grid();

  const first = await openRenameDialog(user);
  await user.clear(first.input);
  await user.type(first.input, "FY26 Procurement Ledger");
  await user.click(within(first.dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename workbook" })).toBeNull());

  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("FY26 Procurement Ledger");
  expect(screen.getByRole("gridcell", { name: "F3" }).textContent).toBe("unreviewed");

  const reopened = await openRenameDialog(user);
  expect(reopened.input.value).toBe("FY26 Procurement Ledger");
});

test("rejects a case-insensitive duplicate name and keeps the last successful name", async () => {
  const user = userEvent.setup();
  api = installFakeApi(renameWorkbooks());
  window.location.hash = `#/workbooks/${RENAME_DUP_ID}`;
  const view = render(<App />);
  await grid();

  const { dialog, input } = await openRenameDialog(user);
  await user.clear(input);
  await user.type(input, "evo-m01-archive-reserved");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Workbook name already exists");
  expect(input.value).toBe("EVO-M01-RENAME-DUP");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("EVO-M01-RENAME-DUP");
  expect(api.workbooks.find((workbook) => workbook.id === RENAME_DUP_ID)?.name).toBe("EVO-M01-RENAME-DUP");
  expect(api.workbooks.find((workbook) => workbook.id === ARCHIVE_ID)?.name).toBe("EVO-M01-ARCHIVE-RESERVED");

  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("EVO-M01-RENAME-DUP");
  const reopened = await openRenameDialog(user);
  expect(reopened.input.value).toBe("EVO-M01-RENAME-DUP");
});

test("rejects a name longer than 80 characters and keeps the workbook and its cell", async () => {
  const user = userEvent.setup();
  api = installFakeApi(renameWorkbooks());
  window.location.hash = `#/workbooks/${RENAME_LIMIT_ID}`;
  const view = render(<App />);
  await grid();

  const { dialog, input } = await openRenameDialog(user);
  expect(input.value).toBe("EVO-M01-RENAME-LIMIT");
  await user.clear(input);
  await user.type(input, TOO_LONG_NAME);
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Workbook name must be 80 characters or fewer");
  expect(input.value).toBe("EVO-M01-RENAME-LIMIT");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("EVO-M01-RENAME-LIMIT");

  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("EVO-M01-RENAME-LIMIT");
  expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("limit sentinel");
  expect(api.workbooks.find((workbook) => workbook.id === RENAME_LIMIT_ID)?.name).toBe("EVO-M01-RENAME-LIMIT");
});

test("closing the dialog unmounts its field and actions and reopens with the saved name", async () => {
  const user = userEvent.setup();
  api = installFakeApi(renameWorkbooks());
  window.location.hash = `#/workbooks/${RENAME_OK_ID}`;
  render(<App />);
  await grid();

  await user.click(screen.getByRole("button", { name: "Rename workbook" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename workbook" });
  expect(within(dialog).getByRole("textbox", { name: "Workbook name" })).toBeTruthy();

  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename workbook" })).toBeNull());
  // The closed dialog leaves no hidden copy of its field or actions behind.
  expect(screen.queryByRole("textbox", { name: "Workbook name" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(document.body.textContent).not.toContain("Workbook name");

  await user.click(screen.getByRole("button", { name: "Rename workbook" }));
  const reopened = await screen.findByRole("dialog", { name: "Rename workbook" });
  const field = within(reopened).getByRole("textbox", { name: "Workbook name" }) as HTMLInputElement;
  expect(field.value).toBe(RENAME_OK_ID);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(RENAME_OK_ID);
});

test("a failed save reports the error and keeps the last saved name", async () => {
  const user = userEvent.setup();
  api = installFakeApi(renameWorkbooks());
  api.failOnce("PATCH", `/api/workbooks/${RENAME_OK_ID}`);
  window.location.hash = `#/workbooks/${RENAME_OK_ID}`;
  render(<App />);
  await grid();

  const { dialog, input } = await openRenameDialog(user);
  await user.clear(input);
  await user.type(input, "FY26 Procurement Ledger");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Server error");
  expect(input.value).toBe("EVO-M01-RENAME-OK");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("EVO-M01-RENAME-OK");
});
