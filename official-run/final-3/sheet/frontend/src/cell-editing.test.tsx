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
  // `navigator.clipboard` is only stubbed by the menu-paste test.
  Reflect.deleteProperty(navigator, "clipboard");
});

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

async function cell(name: string) {
  await grid();
  return screen.getByRole("gridcell", { name });
}

function pasteEvent(text: string): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  return event;
}

test("double-clicking a cell opens an inline text box that Enter commits and persists", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  await user.dblClick(await cell("A1"));
  const editor = screen.getByRole("textbox", { name: "Edit A1" }) as HTMLInputElement;
  expect(editor.value).toBe("Region");
  await user.clear(editor);
  await user.type(editor, "HQ{Enter}");

  expect(screen.queryByRole("textbox", { name: "Edit A1" })).toBeNull();
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("HQ"));
  expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("HQ");

  view.unmount();
  render(<App />);
  expect((await cell("A1")).textContent).toBe("HQ");
});

test("Escape cancels an uncommitted inline change", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  await user.dblClick(await cell("A2"));
  const editor = screen.getByRole("textbox", { name: "Edit A2" });
  await user.clear(editor);
  await user.type(editor, "West{Escape}");

  expect(screen.queryByRole("textbox", { name: "Edit A2" })).toBeNull();
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
  expect(api!.workbooks[0].worksheets[0].cells.A2).toBe("East");
});

test("clicking another cell commits the inline edit", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  await user.dblClick(await cell("A2"));
  const editor = screen.getByRole("textbox", { name: "Edit A2" });
  await user.clear(editor);
  await user.type(editor, "West");
  await user.click(screen.getByRole("gridcell", { name: "B2" }));

  await waitFor(() => expect(api!.workbooks[0].worksheets[0].cells.A2).toBe("West"));
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("West");
  expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe("true");
});

test("the formula bar commits with Enter and discards with Escape", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  await user.click(await cell("A2"));
  const bar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;

  await user.clear(bar);
  await user.type(bar, "West{Escape}");
  expect(bar.value).toBe("East");
  expect(api!.workbooks[0].worksheets[0].cells.A2).toBe("East");

  await user.clear(bar);
  await user.type(bar, "West{Enter}");
  expect(bar.value).toBe("West");
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].cells.A2).toBe("West"));
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("West");
});

test("a formula cell shows its result, keeps the formula in the bar, and dependents update", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  await user.click(await cell("C1"));
  const bar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
  await user.clear(bar);
  await user.type(bar, "=B2+B3{Enter}");

  expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toBe("2000");
  await user.click(screen.getByRole("gridcell", { name: "C1" }));
  expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("=B2+B3");

  // Editing an indirect source value recalculates the dependent result.
  await user.click(screen.getByRole("gridcell", { name: "B3" }));
  await user.clear(bar);
  await user.type(bar, "900{Enter}");
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toBe("2100"));
});

test("dragging from one corner selects the whole rectangle and clears the rest", async () => {
  api = installFakeApi();
  render(<App />);
  await grid();

  fireEvent.mouseDown(screen.getByRole("gridcell", { name: "A1" }));
  fireEvent.mouseOver(screen.getByRole("gridcell", { name: "B2" }), { buttons: 1 });
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: "B2" }));

  for (const name of ["A1", "B1", "A2", "B2"]) {
    expect(screen.getByRole("gridcell", { name }).getAttribute("aria-selected")).toBe("true");
  }
  for (const name of ["A3", "C1", "C2"]) {
    expect(screen.getByRole("gridcell", { name }).getAttribute("aria-selected")).toBe("false");
  }
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].selection).toEqual({ anchor: "A1", focus: "B2" }));
});

test("selecting another cell replaces the previous rectangle", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  fireEvent.mouseDown(screen.getByRole("gridcell", { name: "A1" }));
  fireEvent.mouseOver(screen.getByRole("gridcell", { name: "B2" }), { buttons: 1 });
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: "B2" }));
  await user.click(screen.getByRole("gridcell", { name: "D4" }));

  expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("false");
  expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe("false");
  expect(screen.getByRole("gridcell", { name: "D4" }).getAttribute("aria-selected")).toBe("true");
});

test("each worksheet keeps its own rectangle across switching and refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  fireEvent.mouseDown(screen.getByRole("gridcell", { name: "B2" }));
  fireEvent.mouseOver(screen.getByRole("gridcell", { name: "C3" }), { buttons: 1 });
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: "C3" }));
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].selection).toEqual({ anchor: "B2", focus: "C3" }));

  await user.click(screen.getByRole("tab", { name: "Sheet2" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true"));
  fireEvent.mouseDown(screen.getByRole("gridcell", { name: "D4" }));
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: "D4" }));
  await waitFor(() => expect(api!.workbooks[0].worksheets[1].selection).toEqual({ anchor: "D4", focus: "D4" }));
  // Switching away never overwrote the original worksheet's rectangle.
  expect(api!.workbooks[0].worksheets[0].selection).toEqual({ anchor: "B2", focus: "C3" });

  view.unmount();
  render(<App />);
  await grid();
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "D4" }).getAttribute("aria-selected")).toBe("true"));

  await user.click(screen.getByRole("tab", { name: "Sheet1" }));
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "C3" }).getAttribute("aria-selected")).toBe("true"));
  expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "D2" }).getAttribute("aria-selected")).toBe("false");
});

test("Ctrl+V pastes external tab/newline text as a rectangle and persists", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  await user.click(await cell("D1"));
  fireEvent(window, pasteEvent("East\t1200\nNorth\t800"));

  await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("East"));
  expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toBe("1200");
  expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toBe("North");
  expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toBe("800");
  // Values outside the pasted rectangle are untouched.
  expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toBe("Status");
  expect(screen.getByRole("gridcell", { name: "F1" }).textContent).toBe("");
  expect(api!.workbooks[0].worksheets[0].cells.D2).toBe("North");

  view.unmount();
  render(<App />);
  expect((await cell("D2")).textContent).toBe("North");
});

test("a paste overwrites only the target rectangle and keeps empty fields", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  await user.click(await cell("D1"));
  fireEvent(window, pasteEvent("a\tb\nc\td"));
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toBe("d"));

  fireEvent(window, pasteEvent("X\t\n\tY"));
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("X"));
  expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toBe("");
  expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toBe("");
  expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toBe("Y");
  expect(api!.workbooks[0].worksheets[0].cells.E1).toBeUndefined();
});

test("a rejected paste keeps every target cell and reports an error", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  await user.click(await cell("A2"));
  api.failOnce("POST", `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}/cells/batch`);
  fireEvent(window, pasteEvent("West\t9999"));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Server error");
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
  expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");
  expect(api!.workbooks[0].worksheets[0].cells.A2).toBe("East");
});

test("a failed inline grid edit reports an error and keeps the last successful value", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  api.failOnce("PATCH", `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}/cells`);
  await user.dblClick(await cell("A2"));
  const editor = screen.getByRole("textbox", { name: "Edit A2" });
  await user.clear(editor);
  await user.type(editor, "West{Enter}");

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Server error");
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
  expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("East");
  expect(api!.workbooks[0].worksheets[0].cells.A2).toBe("East");
});

test("the grid context menu offers a Paste menuitem that applies the clipboard", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { readText: async () => "East\t1200\nNorth\t800" },
  });
  render(<App />);
  await grid();

  fireEvent.contextMenu(await cell("D1"));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Paste" }));

  await waitFor(() => expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toBe("North"));
  expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toBe("1200");
});
