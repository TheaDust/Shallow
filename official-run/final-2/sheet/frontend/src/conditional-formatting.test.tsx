import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import {
  EVO_FORMAT_EDIT_ID,
  EVO_FORMAT_NUMBER_ID,
  EVO_FORMAT_TEXT_ID,
  installFakeApi,
  type FakeApi,
} from "./test/fake-api";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

const RED_FILL = "rgb(254, 226, 226)";
const YELLOW_FILL = "rgb(254, 249, 195)";
const GREEN_FILL = "rgb(220, 252, 231)";

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

async function openWorkbook(id: string) {
  window.location.hash = `#/workbooks/${id}`;
  render(<App />);
  await grid();
}

async function select(anchor: string, focus = anchor) {
  fireEvent.mouseDown(screen.getByRole("gridcell", { name: anchor }));
  fireEvent.mouseOver(screen.getByRole("gridcell", { name: focus }), { buttons: 1 });
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: focus }));
  await waitFor(() => expect(screen.getByRole("gridcell", { name: anchor }).getAttribute("aria-selected")).toBe("true"));
}

/** Opens "Conditional formatting" through the Format menu. */
async function openConditionalFormatting(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Format" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Conditional formatting" }));
  return screen.findByRole("dialog", { name: "Conditional formatting" });
}

function background(coordinate: string): string {
  return screen.getByRole("gridcell", { name: coordinate }).style.backgroundColor;
}

function storedRules(id: string) {
  return api!.workbooks.find((workbook) => workbook.id === id)!.worksheets[0].conditionalRules;
}

test("REQ-7-2-1 - a numeric threshold fills the matching cells and survives a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  await openWorkbook(EVO_FORMAT_NUMBER_ID);

  await select("J4", "J6");
  const dialog = await openConditionalFormatting(user);
  await user.selectOptions(within(dialog).getByLabelText("Condition"), "greater-than");
  await user.type(within(dialog).getByLabelText("Value"), "25");
  await user.selectOptions(within(dialog).getByLabelText("Style"), "red-fill");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conditional formatting" })).toBeNull());
  expect(background("J5")).toBe(RED_FILL);
  expect(background("J6")).toBe(RED_FILL);
  expect(background("J4")).toBe("");
  expect(storedRules(EVO_FORMAT_NUMBER_ID)).toEqual([
    { range: "J4:J6", condition: "greater-than", value: "25", style: "red-fill" },
  ]);

  // The fills are derived from the stored rules, so a refresh keeps them.
  cleanup();
  render(<App />);
  await grid();
  expect(background("J5")).toBe(RED_FILL);
  expect(background("J6")).toBe(RED_FILL);
  expect(background("J4")).toBe("");
});

test("REQ-7-2-1 - a text match fills only the containing cell and stays listed", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  await openWorkbook(EVO_FORMAT_TEXT_ID);

  await select("K4", "K6");
  const dialog = await openConditionalFormatting(user);
  await user.selectOptions(within(dialog).getByLabelText("Condition"), "text-contains");
  await user.type(within(dialog).getByLabelText("Value"), "Watch");
  await user.selectOptions(within(dialog).getByLabelText("Style"), "yellow-fill");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conditional formatting" })).toBeNull());
  expect(background("K4")).toBe(YELLOW_FILL);
  expect(background("K5")).toBe("");
  expect(background("K6")).toBe("");

  cleanup();
  render(<App />);
  await grid();
  expect(background("K4")).toBe(YELLOW_FILL);
  expect(background("K5")).toBe("");
  const reopened = await openConditionalFormatting(user);
  expect(within(reopened).getByRole("button", { name: "Edit rule 1" })).toBeTruthy();
  expect(within(reopened).getByRole("button", { name: "Delete rule 1" })).toBeTruthy();
});

test("REQ-7-2-1 - editing rule 1 replaces its fill and deleting it removes the fill", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  await openWorkbook(EVO_FORMAT_EDIT_ID);

  // The seeded rule 1 fills values greater than 20, so L4 and L5 show red.
  expect(background("L4")).toBe(RED_FILL);
  expect(background("L5")).toBe(RED_FILL);
  expect(background("L3")).toBe("");

  const dialog = await openConditionalFormatting(user);
  await user.click(within(dialog).getByRole("button", { name: "Edit rule 1" }));
  await user.selectOptions(within(dialog).getByLabelText("Style"), "green-fill");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conditional formatting" })).toBeNull());
  expect(background("L4")).toBe(GREEN_FILL);
  expect(background("L5")).toBe(GREEN_FILL);
  expect(background("L3")).toBe("");
  expect(storedRules(EVO_FORMAT_EDIT_ID)).toEqual([
    { range: "L3:L5", condition: "greater-than", value: "20", style: "green-fill" },
  ]);

  const reopened = await openConditionalFormatting(user);
  await user.click(within(reopened).getByRole("button", { name: "Delete rule 1" }));
  await waitFor(() => expect(within(reopened).queryByRole("button", { name: "Edit rule 1" })).toBeNull());
  expect(background("L3")).toBe("");
  expect(background("L4")).toBe("");
  expect(background("L5")).toBe("");
  expect(storedRules(EVO_FORMAT_EDIT_ID)).toBeUndefined();

  // The deletion is persisted too, so a refresh keeps every cell unfilled.
  cleanup();
  render(<App />);
  await grid();
  expect(background("L3")).toBe("");
  expect(background("L4")).toBe("");
  expect(background("L5")).toBe("");
});
