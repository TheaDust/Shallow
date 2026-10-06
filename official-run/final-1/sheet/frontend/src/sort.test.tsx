import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import { SEED_WORKBOOK_ID, SEED_WORKSHEET_ID, installFakeApi, type FakeApi } from "./test/fake-api";

let api: FakeApi | undefined;

beforeEach(() => {
  window.location.hash = `#/workbooks/${SEED_WORKBOOK_ID}`;
});

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

async function openDataCommand(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name }));
}

async function openSortDialog(user: ReturnType<typeof userEvent.setup>) {
  await openDataCommand(user, "Sort range");
  return screen.findByRole("dialog", { name: "Sort range" });
}

test("the Data menu opens the Sort range dialog with its named controls", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  const dialog = await openSortDialog(user);
  expect(within(dialog).getByLabelText("Sort by")).toBeTruthy();
  expect(within(dialog).getByLabelText("Order")).toBeTruthy();
  expect(within(dialog).getByRole("checkbox", { name: "Data has header row" })).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Sort" })).toBeTruthy();

  // The "Sort by" options are named after the selected range's headers.
  await user.click(within(dialog).getByLabelText("Sort by"));
  expect(within(dialog).getByRole("option", { name: "Region" })).toBeTruthy();
  expect(within(dialog).getByRole("option", { name: "Sales" })).toBeTruthy();
  expect(within(dialog).getByRole("option", { name: "Status" })).toBeTruthy();

  // The "Order" options are exactly Ascending and Descending.
  await user.click(within(dialog).getByLabelText("Order"));
  expect(within(dialog).getByRole("option", { name: "Ascending" })).toBeTruthy();
  expect(within(dialog).getByRole("option", { name: "Descending" })).toBeTruthy();
});

test("sorting by a column reorders the records and persists after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  const dialog = await openSortDialog(user);
  await user.click(within(dialog).getByLabelText("Sort by"));
  await user.click(within(dialog).getByRole("option", { name: "Sales" }));
  await user.selectOptions(within(dialog).getByLabelText("Order"), "asc");
  await user.click(within(dialog).getByRole("button", { name: "Sort" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sort range" })).toBeNull());

  // Ascending Sales: 700 South, 800 North, 1200 East; header stays in place.
  expect(cellText("A1")).toBe("Region");
  expect(cellText("A2")).toBe("South");
  expect(cellText("B2")).toBe("700");
  expect(cellText("A3")).toBe("North");
  expect(cellText("A4")).toBe("East");
  expect(cellText("B4")).toBe("1200");

  cleanup();
  render(<App />);
  await grid();
  expect(cellText("A1")).toBe("Region");
  expect(cellText("A2")).toBe("South");
  expect(cellText("A3")).toBe("North");
  expect(cellText("A4")).toBe("East");
});

test("a failed sort reports an error and keeps the original order", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  api.failOnce("POST", `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}/sort`);
  render(<App />);
  await grid();

  const dialog = await openSortDialog(user);
  await user.click(within(dialog).getByRole("button", { name: "Sort" }));
  const alert = await within(dialog).findByRole("alert");
  expect(alert.textContent).not.toBe("");

  // The dialog stays open and the grid keeps its original order.
  expect(screen.getByRole("dialog", { name: "Sort range" })).toBeTruthy();
  expect(cellText("A2")).toBe("East");
  expect(cellText("A3")).toBe("North");
  expect(cellText("A4")).toBe("South");
});
