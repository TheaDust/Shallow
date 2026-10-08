import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import { installFakeApi, type FakeApi } from "./test/fake-api";

const OK_ID = "EVO-M02-SHEET-OK";
const DUP_ID = "EVO-M02-SHEET-DUP";
const LIMIT_ID = "EVO-M02-SHEET-LIMIT";

/** The 51-character scenario value. */
const TOO_LONG_NAME = "B".repeat(51);

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

function nameField(dialog: HTMLElement) {
  return within(dialog).getByRole("textbox", { name: "Worksheet name" }) as HTMLInputElement;
}

async function openRenameDialog(user: ReturnType<typeof userEvent.setup>, worksheetName: string) {
  await user.click(screen.getByRole("button", { name: `Worksheet options for ${worksheetName}` }));
  const menu = await screen.findByRole("menu", { name: `Worksheet options for ${worksheetName}` });
  await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));
  return screen.findByRole("dialog", { name: "Rename worksheet" });
}

function tabNames() {
  return screen.getAllByRole("tab").map((tab) => tab.textContent);
}

test("the pre-provisioned worksheet workbooks show their own worksheets and active tab", async () => {
  api = installFakeApi();
  window.location.hash = `#/workbooks/${OK_ID}`;
  render(<App />);
  await grid();

  expect(tabNames()).toEqual(["HarborDraft", "LedgerView"]);
  expect(screen.getByRole("tab", { name: "HarborDraft" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "D5" }).textContent).toBe("dock marker");
  expect(screen.getByRole("button", { name: "Worksheet options for HarborDraft" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Worksheet options for LedgerView" })).toBeTruthy();
});

test("renaming a worksheet trims the name, moves the active tab and keeps the cell after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${OK_ID}`;
  const view = render(<App />);
  await grid();

  const dialog = await openRenameDialog(user, "HarborDraft");
  expect(nameField(dialog).value).toBe("HarborDraft");
  await user.clear(nameField(dialog));
  await user.type(nameField(dialog), "  Dispatch Register  ");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename worksheet" })).toBeNull());
  expect(tabNames()).toEqual(["Dispatch Register", "LedgerView"]);
  expect(screen.getByRole("tab", { name: "Dispatch Register" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "D5" }).textContent).toBe("dock marker");

  view.unmount();
  window.location.hash = `#/workbooks/${OK_ID}`;
  render(<App />);
  await grid();
  expect(tabNames()).toEqual(["Dispatch Register", "LedgerView"]);
  expect(screen.getByRole("tab", { name: "Dispatch Register" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "D5" }).textContent).toBe("dock marker");

  const reopened = await openRenameDialog(user, "Dispatch Register");
  expect(nameField(reopened).value).toBe("Dispatch Register");
});

test("a worksheet name differing only by case is rejected and the original tab and dialog value remain", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${DUP_ID}`;
  const view = render(<App />);
  await grid();
  expect(tabNames()).toEqual(["Meridian", "ArchiveBay"]);
  expect(screen.getByRole("tab", { name: "ArchiveBay" }).getAttribute("aria-selected")).toBe("true");

  const dialog = await openRenameDialog(user, "ArchiveBay");
  await user.clear(nameField(dialog));
  await user.type(nameField(dialog), "meridian");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Worksheet name already exists");
  expect(nameField(dialog).value).toBe("ArchiveBay");
  expect(screen.getByRole("tab", { name: "ArchiveBay" }).getAttribute("aria-selected")).toBe("true");

  view.unmount();
  window.location.hash = `#/workbooks/${DUP_ID}`;
  render(<App />);
  await grid();
  expect(tabNames()).toEqual(["Meridian", "ArchiveBay"]);
  expect(screen.getByRole("tab", { name: "ArchiveBay" }).getAttribute("aria-selected")).toBe("true");
  const reopened = await openRenameDialog(user, "ArchiveBay");
  expect(nameField(reopened).value).toBe("ArchiveBay");
});

test("a worksheet name longer than 50 characters is rejected and the tab and cell survive a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${LIMIT_ID}`;
  const view = render(<App />);
  await grid();
  expect(screen.getByRole("gridcell", { name: "G4" }).textContent).toBe("sheet sentinel");

  const dialog = await openRenameDialog(user, "LengthGauge");
  await user.clear(nameField(dialog));
  await user.type(nameField(dialog), TOO_LONG_NAME);
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Worksheet name must be 50 characters or fewer");
  expect(nameField(dialog).value).toBe("LengthGauge");

  view.unmount();
  window.location.hash = `#/workbooks/${LIMIT_ID}`;
  render(<App />);
  await grid();
  expect(screen.getByRole("tab", { name: "LengthGauge" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "G4" }).textContent).toBe("sheet sentinel");
});

test("closed worksheet dialogs leave no dialog surface in the DOM", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${OK_ID}`;
  render(<App />);
  await grid();

  // No dialog is open at first, so no dialog node should be mounted at all.
  expect(document.querySelectorAll("dialog")).toHaveLength(0);

  const dialog = await openRenameDialog(user, "HarborDraft");
  expect(document.querySelectorAll("dialog")).toHaveLength(1);
  await user.click(within(dialog).getByRole("button", { name: "Close" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename worksheet" })).toBeNull());
  expect(document.querySelectorAll("dialog")).toHaveLength(0);
});

test("a worksheet name of exactly 50 characters is accepted", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${OK_ID}`;
  render(<App />);
  await grid();

  const dialog = await openRenameDialog(user, "LedgerView");
  const name = "C".repeat(50);
  await user.clear(nameField(dialog));
  await user.type(nameField(dialog), name);
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename worksheet" })).toBeNull());
  expect(tabNames()).toEqual(["HarborDraft", name]);
});
