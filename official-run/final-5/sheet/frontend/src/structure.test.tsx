import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

async function cell(name: string) {
  await grid();
  return screen.getByRole("gridcell", { name });
}

async function openHeaderMenu(kind: "row" | "column", name: string) {
  await grid();
  const header = screen.getByRole(kind === "row" ? "rowheader" : "columnheader", { name });
  fireEvent.contextMenu(header);
  return screen.findByRole("menu");
}

test("the grid exposes row numbers as rowheaders and column letters as columnheaders", async () => {
  api = installFakeApi();
  render(<App />);
  await grid();

  expect(screen.getByRole("rowheader", { name: "1" }).textContent).toBe("1");
  expect(screen.getByRole("rowheader", { name: "12" }).textContent).toBe("12");
  expect(screen.getByRole("columnheader", { name: "A" }).textContent).toBe("A");
  expect(screen.getByRole("columnheader", { name: "L" }).textContent).toBe("L");
});

test("right-clicking a row number opens a menu with the three row commands", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  const menu = await openHeaderMenu("row", "2");

  expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Insert 1 row above",
    "Insert 1 row below",
    "Delete row",
  ]);

  await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 row above" }));
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
});

test("right-clicking a column header opens a menu with the three column commands", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  const menu = await openHeaderMenu("column", "B");

  expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Insert 1 column left",
    "Insert 1 column right",
    "Delete column",
  ]);

  await user.click(within(menu).getByRole("menuitem", { name: "Delete column" }));
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
});

test("Insert 1 row above shifts the target row down and survives a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  const view = render(<App />);
  const menu = await openHeaderMenu("row", "2");
  await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 row above" }));

  await waitFor(() => expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("East"));
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("");
  expect(screen.getByRole("gridcell", { name: "B4" }).textContent).toBe("800");

  // Refreshing reloads the persisted state from the server.
  view.unmount();
  render(<App />);
  expect((await cell("A3")).textContent).toBe("East");
  expect((await cell("A4")).textContent).toBe("North");
});

test("Insert 1 row below keeps the target and pushes later rows down", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  const menu = await openHeaderMenu("row", "2");
  await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 row below" }));

  await waitFor(() => expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toBe("North"));
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
  expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("");
});

test("Delete row removes the target row and shifts the following rows up", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  const menu = await openHeaderMenu("row", "2");
  await user.click(within(menu).getByRole("menuitem", { name: "Delete row" }));

  await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("North"));
  expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("800");
  expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("South");
  expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toBe("");
});

test("Delete column removes the target column and keeps data outside it", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  const menu = await openHeaderMenu("column", "B");
  await user.click(within(menu).getByRole("menuitem", { name: "Delete column" }));

  await waitFor(() => expect(screen.getByRole("gridcell", { name: "B1" }).textContent).toBe("Status"));
  expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
  expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toBe("");
  expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("Open");
});

test("a failed structure change shows an error and keeps the pre-operation grid", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  api.failOnce("POST", `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}/structure`);

  const menu = await openHeaderMenu("row", "2");
  await user.click(within(menu).getByRole("menuitem", { name: "Delete row" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBeTruthy();
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
  expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toBe("South");
});

test("a row change touches only the active worksheet", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  const menu = await openHeaderMenu("row", "2");
  await user.click(within(menu).getByRole("menuitem", { name: "Delete row" }));
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("North"));

  await user.click(screen.getByRole("tab", { name: "Sheet2" }));
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe(""));

  await user.click(screen.getByRole("tab", { name: "Sheet1" }));
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("North"));
});
