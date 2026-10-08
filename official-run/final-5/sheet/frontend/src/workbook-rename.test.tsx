import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import { installFakeApi, type FakeApi } from "./test/fake-api";

const OK_ID = "EVO-M01-RENAME-OK";
const DUP_ID = "EVO-M01-RENAME-DUP";
const LIMIT_ID = "EVO-M01-RENAME-LIMIT";
/** 81 characters: `EVO-` followed by 77 `A`s. */
const TOO_LONG_NAME = `EVO-${"A".repeat(77)}`;

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
  return within(dialog).getByRole("textbox", { name: "Workbook name" }) as HTMLInputElement;
}

test("renaming a workbook trims the name and both the title and home link show it", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${OK_ID}`;
  render(<App />);
  await grid();

  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(OK_ID);
  expect(screen.getByRole("gridcell", { name: "F3" }).textContent).toBe("unreviewed");

  await user.click(screen.getByRole("button", { name: "Rename workbook" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename workbook" });
  expect(nameField(dialog).value).toBe(OK_ID);
  await user.clear(nameField(dialog));
  await user.type(nameField(dialog), "  FY26 Procurement Ledger  ");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename workbook" })).toBeNull());
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("FY26 Procurement Ledger");

  await user.click(screen.getByRole("link", { name: "Home" }));
  const renamedLink = await screen.findByRole("link", { name: "FY26 Procurement Ledger" });
  expect(renamedLink.getAttribute("href")).toBe(`#/workbooks/${OK_ID}`);

  await user.click(renamedLink);
  await grid();
  expect(screen.getByRole("gridcell", { name: "F3" }).textContent).toBe("unreviewed");
  await user.click(screen.getByRole("button", { name: "Rename workbook" }));
  const reopened = await screen.findByRole("dialog", { name: "Rename workbook" });
  expect(nameField(reopened).value).toBe("FY26 Procurement Ledger");
});

test("a case-insensitive duplicate name is rejected and the last successful name is kept", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${DUP_ID}`;
  render(<App />);
  await grid();

  await user.click(screen.getByRole("button", { name: "Rename workbook" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename workbook" });
  await user.clear(nameField(dialog));
  await user.type(nameField(dialog), "evo-m01-archive-reserved");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Workbook name already exists");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(DUP_ID);
  expect(nameField(dialog).value).toBe(DUP_ID);

  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("link", { name: "Home" }));
  const link = await screen.findByRole("link", { name: DUP_ID });
  expect(link.getAttribute("href")).toBe(`#/workbooks/${DUP_ID}`);
});

test("a name longer than 80 characters is rejected and the title and cell survive a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${LIMIT_ID}`;
  const view = render(<App />);
  await grid();
  expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("limit sentinel");

  await user.click(screen.getByRole("button", { name: "Rename workbook" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename workbook" });
  await user.clear(nameField(dialog));
  await user.type(nameField(dialog), TOO_LONG_NAME);
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Workbook name must be 80 characters or fewer");
  expect(nameField(dialog).value).toBe(LIMIT_ID);

  view.unmount();
  window.location.hash = `#/workbooks/${LIMIT_ID}`;
  render(<App />);
  await grid();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(LIMIT_ID);
  expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("limit sentinel");
});
