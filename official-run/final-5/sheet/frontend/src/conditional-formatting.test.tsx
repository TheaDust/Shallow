import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import { installFakeApi, type FakeApi } from "./test/fake-api";

const NUMBER_ID = "EVO-N04-FORMAT-NUMBER";
const TEXT_ID = "EVO-N04-FORMAT-TEXT";
const EDIT_ID = "EVO-N04-FORMAT-EDIT";

const RED = "rgb(254, 226, 226)";
const YELLOW = "rgb(254, 249, 195)";
const GREEN = "rgb(220, 252, 231)";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function cell(name: string): HTMLElement {
  return screen.getByRole("gridcell", { name });
}

/** Visible background of one cell, as a browser would compute it. */
function background(name: string): string {
  return window.getComputedStyle(cell(name)).backgroundColor;
}

/** Drags over a rectangle so the dialog starts from that exact selection. */
function selectRange(anchor: string, focus: string) {
  fireEvent.mouseDown(cell(anchor));
  fireEvent.mouseOver(cell(focus), { buttons: 1 });
  fireEvent.mouseUp(cell(focus));
}

async function openMenuCommand(user: ReturnType<typeof userEvent.setup>, menu: string, item: string) {
  await user.click(screen.getByRole("button", { name: menu }));
  const opened = await screen.findByRole("menu");
  await user.click(within(opened).getByRole("menuitem", { name: item }));
}

function worksheetFormats(id: string) {
  return api!.workbooks.find((workbook) => workbook.id === id)?.worksheets[0].conditionalFormats;
}

test("a Greater than rule fills the matching cells and stays after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${NUMBER_ID}`;
  render(<App />);
  await grid();

  selectRange("J4", "J6");
  await openMenuCommand(user, "Format", "Conditional formatting");
  const dialog = await screen.findByRole("dialog", { name: "Conditional formatting" });
  expect((within(dialog).getByLabelText("Range") as HTMLInputElement).value).toBe("J4:J6");
  await user.type(within(dialog).getByLabelText("Value"), "25");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conditional formatting" })).toBeNull());

  expect(worksheetFormats(NUMBER_ID)).toEqual([
    { range: "J4:J6", condition: "Greater than", value: "25", style: "Red fill" },
  ]);
  expect(background("J5")).toBe(RED);
  expect(background("J6")).toBe(RED);
  expect(background("J4")).not.toBe(RED);

  cleanup();
  render(<App />);
  await grid();
  expect(background("J5")).toBe(RED);
  expect(background("J4")).not.toBe(RED);
});

test("a Text contains rule fills only the matching cells and stays listed", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${TEXT_ID}`;
  render(<App />);
  await grid();

  selectRange("K4", "K6");
  await openMenuCommand(user, "Format", "Conditional formatting");
  const dialog = await screen.findByRole("dialog", { name: "Conditional formatting" });
  await user.selectOptions(within(dialog).getByLabelText("Condition"), "Text contains");
  await user.type(within(dialog).getByLabelText("Value"), "Watch");
  await user.selectOptions(within(dialog).getByLabelText("Style"), "Yellow fill");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conditional formatting" })).toBeNull());

  expect(background("K4")).toBe(YELLOW);
  expect(background("K5")).not.toBe(YELLOW);
  expect(background("K6")).not.toBe(YELLOW);

  cleanup();
  render(<App />);
  await grid();
  expect(background("K4")).toBe(YELLOW);
  await openMenuCommand(user, "Format", "Conditional formatting");
  const reopened = await screen.findByRole("dialog", { name: "Conditional formatting" });
  expect(within(reopened).getByRole("button", { name: "Edit rule 1" })).toBeTruthy();
  expect(within(reopened).getByRole("button", { name: "Delete rule 1" })).toBeTruthy();
});

test("editing rule 1 repaints the fill immediately and deleting removes it", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${EDIT_ID}`;
  render(<App />);
  await grid();

  // The pre-provisioned rule already paints L4 and L5 red.
  expect(background("L4")).toBe(RED);
  expect(background("L5")).toBe(RED);

  await openMenuCommand(user, "Format", "Conditional formatting");
  const dialog = await screen.findByRole("dialog", { name: "Conditional formatting" });
  await user.click(within(dialog).getByRole("button", { name: "Edit rule 1" }));
  await user.selectOptions(within(dialog).getByLabelText("Style"), "Green fill");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conditional formatting" })).toBeNull());
  expect(background("L4")).toBe(GREEN);
  expect(background("L5")).toBe(GREEN);

  await openMenuCommand(user, "Format", "Conditional formatting");
  const reopened = await screen.findByRole("dialog", { name: "Conditional formatting" });
  await user.click(within(reopened).getByRole("button", { name: "Delete rule 1" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conditional formatting" })).toBeNull());
  for (const name of ["L3", "L4", "L5"]) {
    expect([RED, YELLOW, GREEN]).not.toContain(background(name));
  }
  expect(worksheetFormats(EDIT_ID)).toBeUndefined();

  cleanup();
  render(<App />);
  await grid();
  for (const name of ["L3", "L4", "L5"]) {
    expect([RED, YELLOW, GREEN]).not.toContain(background(name));
  }
});
