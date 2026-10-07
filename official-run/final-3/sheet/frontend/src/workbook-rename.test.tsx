import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import type { Workbook } from "./domain/types";
import { installFakeApi, type FakeApi } from "./test/fake-api";

/** Workbook name from the requirement: 81 characters, one more than the limit. */
const TOO_LONG_NAME = "EVO-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

let api: FakeApi | undefined;

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

function selection() {
  return { anchor: "A1", focus: "A1" };
}

/** Test double of the pre-provisioned evolution workbooks (stable ids = names). */
function evoWorkbooks(): Workbook[] {
  return [
    {
      id: "EVO-M01-RENAME-OK",
      name: "EVO-M01-RENAME-OK",
      createdAt: "2026-10-01T09:00:00.000Z",
      updatedAt: "2026-10-01T09:01:00.000Z",
      activeWorksheetId: "ws-evo-m01-rename-ok-identitylog",
      worksheets: [
        { id: "ws-evo-m01-rename-ok-identitylog", name: "IdentityLog", selection: selection(), cells: { F3: "unreviewed" } },
      ],
    },
    {
      id: "EVO-M01-RENAME-DUP",
      name: "EVO-M01-RENAME-DUP",
      createdAt: "2026-10-01T09:00:00.000Z",
      updatedAt: "2026-10-01T09:02:00.000Z",
      activeWorksheetId: "ws-evo-m01-rename-dup-identitylog",
      worksheets: [{ id: "ws-evo-m01-rename-dup-identitylog", name: "IdentityLog", selection: selection(), cells: {} }],
    },
    {
      id: "EVO-M01-ARCHIVE-RESERVED",
      name: "EVO-M01-ARCHIVE-RESERVED",
      createdAt: "2026-10-01T09:00:00.000Z",
      updatedAt: "2026-10-01T09:03:00.000Z",
      activeWorksheetId: "ws-evo-m01-archive-reserved-sheet1",
      worksheets: [{ id: "ws-evo-m01-archive-reserved-sheet1", name: "Sheet1", selection: selection(), cells: {} }],
    },
    {
      id: "EVO-M01-RENAME-LIMIT",
      name: "EVO-M01-RENAME-LIMIT",
      createdAt: "2026-10-01T09:00:00.000Z",
      updatedAt: "2026-10-01T09:04:00.000Z",
      activeWorksheetId: "ws-evo-m01-rename-limit-limitprobe",
      worksheets: [
        { id: "ws-evo-m01-rename-limit-limitprobe", name: "LimitProbe", selection: selection(), cells: { C2: "limit sentinel" } },
      ],
    },
  ];
}

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

async function openRenameDialog() {
  await grid();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Rename workbook" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename workbook" });
  const field = () => within(dialog).getByRole("textbox", { name: "Workbook name" }) as HTMLInputElement;
  return { user, dialog, field };
}

test("trims a renamed workbook, shows it in the editor and the home link, and keeps cell F3", async () => {
  const user = userEvent.setup();
  api = installFakeApi(evoWorkbooks());
  window.location.hash = "#/workbooks/EVO-M01-RENAME-OK";
  const view = render(<App />);
  await grid();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("EVO-M01-RENAME-OK");
  expect(screen.getByRole("gridcell", { name: "F3" }).textContent).toBe("unreviewed");

  await user.click(screen.getByRole("button", { name: "Rename workbook" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename workbook" });
  const input = within(dialog).getByRole("textbox", { name: "Workbook name" }) as HTMLInputElement;
  expect(input.value).toBe("EVO-M01-RENAME-OK");

  await user.clear(input);
  await user.type(input, "  FY26 Procurement Ledger  ");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename workbook" })).toBeNull());
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("FY26 Procurement Ledger");

  await user.click(screen.getByRole("link", { name: "Home" }));
  const link = await screen.findByRole("link", { name: "FY26 Procurement Ledger" });
  expect(link.getAttribute("href")).toBe("#/workbooks/EVO-M01-RENAME-OK");
  expect(screen.queryByRole("link", { name: "EVO-M01-RENAME-OK" })).toBeNull();

  // Refresh: the trimmed name and the worksheet cell are read back from storage.
  view.unmount();
  window.location.hash = "#/workbooks/EVO-M01-RENAME-OK";
  render(<App />);
  await grid();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("FY26 Procurement Ledger");
  expect(screen.getByRole("gridcell", { name: "F3" }).textContent).toBe("unreviewed");

  const reopened = await openRenameDialog();
  expect(reopened.field().value).toBe("FY26 Procurement Ledger");
});

test("rejects a case-insensitive duplicate and keeps the last successful name", async () => {
  const user = userEvent.setup();
  api = installFakeApi(evoWorkbooks());
  window.location.hash = "#/workbooks/EVO-M01-RENAME-DUP";
  const view = render(<App />);

  const { field, dialog } = await openRenameDialog();
  await user.clear(field());
  await user.type(field(), "evo-m01-archive-reserved");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Workbook name already exists");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("EVO-M01-RENAME-DUP");
  expect(field().value).toBe("EVO-M01-RENAME-DUP");
  expect(api.workbooks.find((workbook) => workbook.id === "EVO-M01-RENAME-DUP")?.name).toBe("EVO-M01-RENAME-DUP");
  expect(api.workbooks.find((workbook) => workbook.id === "EVO-M01-ARCHIVE-RESERVED")?.name).toBe(
    "EVO-M01-ARCHIVE-RESERVED",
  );

  // Refresh: the stored name and the prefilled field stay on the last success.
  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("EVO-M01-RENAME-DUP");

  const reopened = await openRenameDialog();
  expect(reopened.field().value).toBe("EVO-M01-RENAME-DUP");

  // The home-page link still shows the last successful name.
  await user.click(screen.getByRole("link", { name: "Home" }));
  const link = await screen.findByRole("link", { name: "EVO-M01-RENAME-DUP" });
  expect(link.getAttribute("href")).toBe("#/workbooks/EVO-M01-RENAME-DUP");
  expect(screen.queryByRole("link", { name: "evo-m01-archive-reserved" })).toBeNull();
});

test("rejects a name longer than 80 characters and accepts exactly 80", async () => {
  const user = userEvent.setup();
  api = installFakeApi(evoWorkbooks());
  window.location.hash = "#/workbooks/EVO-M01-RENAME-LIMIT";
  const view = render(<App />);

  const { field, dialog } = await openRenameDialog();
  expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("limit sentinel");

  await user.clear(field());
  await user.type(field(), TOO_LONG_NAME);
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Workbook name must be 80 characters or fewer");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("EVO-M01-RENAME-LIMIT");
  expect(field().value).toBe("EVO-M01-RENAME-LIMIT");

  // Refresh: the title, the cell and the home-page link keep their stored values.
  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("EVO-M01-RENAME-LIMIT");
  expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("limit sentinel");

  await user.click(screen.getByRole("link", { name: "Home" }));
  const homeLink = await screen.findByRole("link", { name: "EVO-M01-RENAME-LIMIT" });
  expect(homeLink.getAttribute("href")).toBe("#/workbooks/EVO-M01-RENAME-LIMIT");
  await user.click(homeLink);
  await grid();

  // The 80-character boundary is accepted.
  const boundary = "L".repeat(80);
  const reopened = await openRenameDialog();
  await user.clear(reopened.field());
  await user.type(reopened.field(), boundary);
  await user.click(within(reopened.dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename workbook" })).toBeNull());
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(boundary);
});
