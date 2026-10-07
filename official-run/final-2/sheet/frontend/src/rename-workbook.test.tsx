import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import {
  EVO_RENAME_DUP_ID,
  EVO_RENAME_LIMIT_ID,
  EVO_RENAME_OK_ID,
  installFakeApi,
  type FakeApi,
} from "./test/fake-api";

/** The 81-character value of the requirement, one over the 80-character limit. */
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

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

/** Opens a pre-provisioned workbook from the home-page list, then its rename dialog. */
async function openRenameDialog(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole("link", { name }));
  await grid();
  await user.click(screen.getByRole("button", { name: "Rename workbook" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename workbook" });
  const input = within(dialog).getByRole("textbox", { name: "Workbook name" }) as HTMLInputElement;
  return { dialog, input };
}

/** Re-renders the editor of `workbookId`, as a browser refresh would. */
function refreshEditor(workbookId: string) {
  cleanup();
  window.location.hash = `#/workbooks/${workbookId}`;
  render(<App />);
}

test("REQ-1-2-2 - trim and persist an available workbook name", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);

  const { dialog, input } = await openRenameDialog(user, "EVO-M01-RENAME-OK");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("EVO-M01-RENAME-OK");
  expect(screen.getByRole("gridcell", { name: "F3" }).textContent).toBe("unreviewed");
  expect(input.value).toBe("EVO-M01-RENAME-OK");

  await user.clear(input);
  await user.type(input, "  FY26 Procurement Ledger  ");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename workbook" })).toBeNull());
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("FY26 Procurement Ledger");

  // The home-page link of the same workbook shows the new name.
  await user.click(screen.getByRole("link", { name: "Home" }));
  const renamed = await screen.findByRole("link", { name: "FY26 Procurement Ledger" });
  expect(renamed.getAttribute("href")).toBe(`#/workbooks/${EVO_RENAME_OK_ID}`);
  expect(screen.queryByRole("link", { name: "EVO-M01-RENAME-OK" })).toBeNull();

  // After a refresh the dialog is prefilled with the saved name and F3 is intact.
  refreshEditor(EVO_RENAME_OK_ID);
  await grid();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("FY26 Procurement Ledger");
  expect(screen.getByRole("gridcell", { name: "F3" }).textContent).toBe("unreviewed");
  await user.click(screen.getByRole("button", { name: "Rename workbook" }));
  const reopened = await screen.findByRole("dialog", { name: "Rename workbook" });
  const prefilled = within(reopened).getByRole("textbox", { name: "Workbook name" }) as HTMLInputElement;
  expect(prefilled.value).toBe("FY26 Procurement Ledger");
  expect(api.workbooks.find((workbook) => workbook.id === EVO_RENAME_OK_ID)?.name).toBe("FY26 Procurement Ledger");
});

test("REQ-1-2-2 - reject a case-insensitive duplicate workbook name", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);

  const { dialog, input } = await openRenameDialog(user, "EVO-M01-RENAME-DUP");
  await user.clear(input);
  await user.type(input, "evo-m01-archive-reserved");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Workbook name already exists");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("EVO-M01-RENAME-DUP");
  expect(input.value).toBe("EVO-M01-RENAME-DUP");
  expect(api.workbooks.find((workbook) => workbook.id === EVO_RENAME_DUP_ID)?.name).toBe("EVO-M01-RENAME-DUP");
  expect(api.workbooks.find((workbook) => workbook.name === "EVO-M01-ARCHIVE-RESERVED")).toBeTruthy();

  refreshEditor(EVO_RENAME_DUP_ID);
  await grid();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("EVO-M01-RENAME-DUP");
  await user.click(screen.getByRole("button", { name: "Rename workbook" }));
  const reopened = await screen.findByRole("dialog", { name: "Rename workbook" });
  const prefilled = within(reopened).getByRole("textbox", { name: "Workbook name" }) as HTMLInputElement;
  expect(prefilled.value).toBe("EVO-M01-RENAME-DUP");
});

test("REQ-1-2-2 - reject a workbook name longer than 80 characters", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);

  const { dialog, input } = await openRenameDialog(user, "EVO-M01-RENAME-LIMIT");
  expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("limit sentinel");
  expect(TOO_LONG_NAME.length).toBe(81);

  await user.clear(input);
  await user.type(input, TOO_LONG_NAME);
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Workbook name must be 80 characters or fewer");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("EVO-M01-RENAME-LIMIT");
  expect(input.value).toBe("EVO-M01-RENAME-LIMIT");

  refreshEditor(EVO_RENAME_LIMIT_ID);
  await grid();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("EVO-M01-RENAME-LIMIT");
  expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("limit sentinel");
  expect(api.workbooks.find((workbook) => workbook.id === EVO_RENAME_LIMIT_ID)?.name).toBe("EVO-M01-RENAME-LIMIT");
});

test("an empty workbook name is rejected and the last saved name stays", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);

  const { dialog, input } = await openRenameDialog(user, "EVO-M01-RENAME-OK");
  await user.clear(input);
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Workbook name cannot be empty");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("EVO-M01-RENAME-OK");
  expect(input.value).toBe("EVO-M01-RENAME-OK");
});
