import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import { SEED_WORKBOOK_ID, SEED_WORKSHEET_ID, installFakeApi, seedWorkbooks, type FakeApi } from "./test/fake-api";

let api: FakeApi | undefined;

beforeEach(() => {
  window.location.hash = `#/workbooks/${SEED_WORKBOOK_ID}`;
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
  Reflect.deleteProperty(navigator, "clipboard");
});

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

async function cell(name: string) {
  await grid();
  return screen.getByRole("gridcell", { name });
}

function dragRange(from: string, to: string) {
  fireEvent.mouseDown(screen.getByRole("gridcell", { name: from }));
  fireEvent.mouseOver(screen.getByRole("gridcell", { name: to }), { buttons: 1 });
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: to }));
}

function cellsOf(workbookIndex = 0, worksheetIndex = 0) {
  return api!.workbooks[workbookIndex].worksheets[worksheetIndex].cells;
}

test("a copied range is written onto the target while the source stays unchanged", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  dragRange("A1", "B2");
  await user.click(screen.getByRole("button", { name: "Copy" }));
  await user.click(await cell("D1"));
  await user.click(screen.getByRole("button", { name: "Paste" }));

  await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("Region"));
  expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toBe("Sales");
  expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toBe("East");
  expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toBe("1200");
  // The source range and its neighbours are untouched.
  expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
  expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");
  expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toBe("Status");
  expect(cellsOf().A1).toBe("Region");

  view.unmount();
  render(<App />);
  await grid();
  expect((await cell("D2")).textContent).toBe("East");
  expect((await cell("A1")).textContent).toBe("Region");
});

test("a cut moves the range and clears the source only together with the target", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  dragRange("A1", "B2");
  await user.click(screen.getByRole("button", { name: "Cut" }));
  await user.click(await cell("D1"));
  await user.click(screen.getByRole("button", { name: "Paste" }));

  await waitFor(() => expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toBe("East"));
  expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toBe("1200");
  expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("");
  expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("");
  // Cells outside source and target keep their values.
  expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toBe("Status");

  view.unmount();
  render(<App />);
  await grid();
  expect((await cell("D1")).textContent).toBe("Region");
  expect((await cell("A2")).textContent).toBe("");
});

test("a copied formula adjusts its relative references and keeps absolute ones", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  await user.dblClick(await cell("C1"));
  const editor = screen.getByRole("textbox", { name: "Edit C1" });
  await user.clear(editor);
  await user.type(editor, "=$B$2+B3{Enter}");
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toBe("2000"));

  await user.click(screen.getByRole("gridcell", { name: "C1" }));
  await user.click(screen.getByRole("button", { name: "Copy" }));
  await user.click(screen.getByRole("gridcell", { name: "C2" }));
  await user.click(screen.getByRole("button", { name: "Paste" }));

  // $B$2 stays anchored, the relative B3 follows the one-row offset to B4.
  await waitFor(() => expect(cellsOf().C2).toBe("=$B$2+B4"));
  expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("1900");
  expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("=$B$2+B4");
  expect(cellsOf().C1).toBe("=$B$2+B3");
});

test("the cell context menu offers Copy, Cut and Paste menuitems", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  fireEvent.contextMenu(await cell("A1"));
  const menu = await screen.findByRole("menu");
  expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Copy", "Cut", "Paste"]);
  await user.keyboard("{Escape}");
});

test("Ctrl+C and Ctrl+V transfer the selected rectangle", async () => {
  api = installFakeApi();
  render(<App />);
  await grid();

  dragRange("A1", "B2");
  fireEvent.keyDown(window, { key: "c", ctrlKey: true });
  fireEvent.mouseDown(screen.getByRole("gridcell", { name: "D1" }));
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: "D1" }));
  fireEvent(window, new Event("paste", { bubbles: true, cancelable: true }));

  await waitFor(() => expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toBe("Sales"));
  expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
});

test("a rejected transfer keeps both ranges and reports the validation message", async () => {
  const user = userEvent.setup();
  const seed = seedWorkbooks();
  seed[0].worksheets[0].validationRules = [{ range: "D1:E2", type: "number-range", min: 0, max: 100 }];
  api = installFakeApi(seed);
  render(<App />);
  await grid();

  dragRange("A1", "B2");
  await user.click(screen.getByRole("button", { name: "Copy" }));
  await user.click(await cell("D1"));
  await user.click(screen.getByRole("button", { name: "Paste" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Please enter a number from 0 to 100");
  expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("");
  expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
  expect(cellsOf().D1).toBeUndefined();
  expect(cellsOf().A1).toBe("Region");
});

test("a failed cut-paste keeps the source and reports the error", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  dragRange("A1", "B2");
  await user.click(screen.getByRole("button", { name: "Cut" }));
  await user.click(await cell("D1"));
  api.failOnce("POST", `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}/range-transfer`);
  await user.click(screen.getByRole("button", { name: "Paste" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Server error");
  expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
  expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("");
  expect(cellsOf().A1).toBe("Region");
  expect(cellsOf().D1).toBeUndefined();
});

test("Undo restores a cell edit and Redo reapplies it, both persisting after refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();

  await user.click(await cell("A2"));
  const bar = screen.getByRole("textbox", { name: "Formula bar" });
  await user.clear(bar);
  await user.type(bar, "West{Enter}");
  await waitFor(() => expect(cellsOf().A2).toBe("West"));
  expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East"));
  expect(cellsOf().A2).toBe("East");
  expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("East");
  expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();

  // The undone state is written through the server, so it survives a refresh.
  cleanup();
  render(<App />);
  await grid();
  expect((await cell("A2")).textContent).toBe("East");

  // A redo inside the same session reapplies the edit and persists it too.
  await user.click(await cell("A2"));
  await user.clear(screen.getByRole("textbox", { name: "Formula bar" }));
  await user.type(screen.getByRole("textbox", { name: "Formula bar" }), "West{Enter}");
  await waitFor(() => expect(cellsOf().A2).toBe("West"));
  await user.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(cellsOf().A2).toBe("East"));
  await user.click(screen.getByRole("button", { name: "Redo" }));
  await waitFor(() => expect(cellsOf().A2).toBe("West"));
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("West");

  cleanup();
  render(<App />);
  await grid();
  expect((await cell("A2")).textContent).toBe("West");
});

test("Ctrl+Z and Ctrl+Y undo and redo with the same order as consecutive operations", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  const bar = screen.getByRole("textbox", { name: "Formula bar" });
  await user.click(await cell("A2"));
  await user.clear(bar);
  await user.type(bar, "West{Enter}");
  await waitFor(() => expect(cellsOf().A2).toBe("West"));

  await user.click(screen.getByRole("gridcell", { name: "A3" }));
  await user.clear(bar);
  await user.type(bar, "South2{Enter}");
  await waitFor(() => expect(cellsOf().A3).toBe("South2"));

  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  await waitFor(() => expect(cellsOf().A3).toBe("North"));
  expect(cellsOf().A2).toBe("West");

  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  await waitFor(() => expect(cellsOf().A2).toBe("East"));

  fireEvent.keyDown(window, { key: "y", ctrlKey: true });
  await waitFor(() => expect(cellsOf().A2).toBe("West"));
  expect(cellsOf().A3).toBe("North");
});

test("a new edit after an undo disables Redo and blocks Ctrl+Y", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  const bar = screen.getByRole("textbox", { name: "Formula bar" });
  await user.click(await cell("A2"));
  await user.clear(bar);
  await user.type(bar, "West{Enter}");
  await waitFor(() => expect(cellsOf().A2).toBe("West"));

  await user.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(cellsOf().A2).toBe("East"));
  expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();

  await user.click(screen.getByRole("gridcell", { name: "A4" }));
  await user.clear(bar);
  await user.type(bar, "SouthX{Enter}");
  await waitFor(() => expect(cellsOf().A4).toBe("SouthX"));

  expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  fireEvent.keyDown(window, { key: "y", ctrlKey: true });
  expect(cellsOf().A2).toBe("East");
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
});

test("Undo restores a row insertion and a range move", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  // Insert a row above row 2, then undo it.
  fireEvent.contextMenu(screen.getByRole("rowheader", { name: "2" }));
  const rowMenu = await screen.findByRole("menu");
  await user.click(within(rowMenu).getByRole("menuitem", { name: "Insert 1 row above" }));
  await waitFor(() => expect(cellsOf().A3).toBe("East"));
  expect(cellsOf().A2).toBeUndefined();
  expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(cellsOf().A2).toBe("East"));
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");

  // Move a range, then undo the move: both ranges go back.
  dragRange("A1", "B2");
  await user.click(screen.getByRole("button", { name: "Cut" }));
  await user.click(await cell("D1"));
  await user.click(screen.getByRole("button", { name: "Paste" }));
  await waitFor(() => expect(cellsOf().D1).toBe("Region"));

  await user.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(cellsOf().A1).toBe("Region"));
  expect(cellsOf().D1).toBeUndefined();
  expect(cellsOf().B2).toBe("1200");
});

test("opening another workbook starts with empty history and leaves it untouched", async () => {
  const user = userEvent.setup();
  const seed = seedWorkbooks();
  const backupIndex =
    seed.push({
      id: "wb-backup",
      name: "Q3 Sales Backup",
      createdAt: "2026-09-22T09:00:00.000Z",
      updatedAt: "2026-09-23T09:00:00.000Z",
      activeWorksheetId: "ws-backup",
      worksheets: [
        { id: "ws-backup", name: "Sheet1", selection: { anchor: "A1", focus: "A1" }, cells: { A1: "Backup" } },
      ],
    }) - 1;
  api = installFakeApi(seed);
  render(<App />);
  await grid();

  const bar = screen.getByRole("textbox", { name: "Formula bar" });
  await user.click(await cell("A2"));
  await user.clear(bar);
  await user.type(bar, "West{Enter}");
  await waitFor(() => expect(cellsOf().A2).toBe("West"));
  expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();

  await user.click(screen.getByRole("link", { name: "Home" }));
  await user.click(await screen.findByRole("link", { name: "Q3 Sales Backup" }));
  await waitFor(() => expect(cellsOf(backupIndex).A1).toBe("Backup"));
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  // The first workbook keeps its edit, the second one was never touched.
  expect(cellsOf(0).A2).toBe("West");
  expect(cellsOf(backupIndex).A2).toBeUndefined();
});
