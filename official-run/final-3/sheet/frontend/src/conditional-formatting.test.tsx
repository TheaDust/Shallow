import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import type { FormatRule, Workbook } from "./domain/types";
import { installFakeApi, type FakeApi } from "./test/fake-api";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

const RED = "rgb(254, 226, 226)";
const YELLOW = "rgb(254, 249, 195)";
const GREEN = "rgb(220, 252, 231)";

/** Pre-provisioned workbook of the conditional-formatting scenarios. */
function signalsWorkbook(id: string, cells: Record<string, string>, formatRules?: FormatRule[]): Workbook {
  const worksheetId = `ws-${id}`;
  return {
    id,
    name: id,
    createdAt: "2026-10-07T09:00:00.000Z",
    updatedAt: "2026-10-07T09:00:00.000Z",
    activeWorksheetId: worksheetId,
    worksheets: [
      { id: worksheetId, name: "Signals", selection: { anchor: "A1", focus: "A1" }, cells, formatRules },
    ],
  };
}

/** Opens a pre-provisioned workbook through its deep link. */
function open(workbook: Workbook) {
  window.location.hash = `#/workbooks/${workbook.id}`;
  api = installFakeApi([workbook]);
  return render(<App />);
}

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

/** Selects a rectangle by dragging, exactly like a pointer selection. */
async function selectRange(anchor: string, focus: string) {
  await grid();
  fireEvent.mouseDown(screen.getByRole("gridcell", { name: anchor }));
  fireEvent.mouseOver(screen.getByRole("gridcell", { name: focus }), { buttons: 1 });
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: focus }));
}

/** Opens "Format" → "Conditional formatting". */
async function openFormatting(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Format" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Conditional formatting" }));
  return screen.findByRole("dialog", { name: "Conditional formatting" });
}

async function closeDialog() {
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conditional formatting" })).toBeNull());
}

function cellFill(coordinate: string): string {
  return screen.getByRole("gridcell", { name: coordinate }).style.backgroundColor;
}

test("a numeric threshold fills the matching cells only and persists", async () => {
  const user = userEvent.setup();
  open(signalsWorkbook("EVO-N04-FORMAT-NUMBER", { J4: "11", J5: "29", J6: "46" }));

  await selectRange("J4", "J6");
  const dialog = await openFormatting(user);
  await user.selectOptions(within(dialog).getByLabelText("Condition"), "greater-than");
  await user.type(within(dialog).getByLabelText("Value"), "25");
  await user.selectOptions(within(dialog).getByLabelText("Style"), "red");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await closeDialog();

  expect(cellFill("J5")).toBe(RED);
  expect(cellFill("J6")).toBe(RED);
  expect(cellFill("J4")).not.toBe(RED);
  expect(api?.workbooks[0].worksheets[0].formatRules).toEqual([
    { range: "J4:J6", condition: "greater-than", value: "25", style: "red" },
  ]);

  cleanup();
  render(<App />);
  await grid();
  expect(cellFill("J5")).toBe(RED);
  expect(cellFill("J6")).toBe(RED);
  expect(cellFill("J4")).not.toBe(RED);
});

test("a text match fills one cell and the rule stays listed after a refresh", async () => {
  const user = userEvent.setup();
  open(signalsWorkbook("EVO-N04-FORMAT-TEXT", { K4: "Watch", K5: "Stable", K6: "Elevated" }));

  await selectRange("K4", "K6");
  const dialog = await openFormatting(user);
  await user.selectOptions(within(dialog).getByLabelText("Condition"), "text-contains");
  await user.type(within(dialog).getByLabelText("Value"), "Watch");
  await user.selectOptions(within(dialog).getByLabelText("Style"), "yellow");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await closeDialog();

  expect(cellFill("K4")).toBe(YELLOW);
  expect(cellFill("K5")).not.toBe(YELLOW);
  expect(cellFill("K6")).not.toBe(YELLOW);

  cleanup();
  render(<App />);
  await grid();
  expect(cellFill("K4")).toBe(YELLOW);
  const reopened = await openFormatting(user);
  expect(within(reopened).getByRole("button", { name: "Edit rule 1" })).toBeTruthy();
});

test("editing rule 1 swaps the fill and deleting it removes the fill for good", async () => {
  const user = userEvent.setup();
  open(
    signalsWorkbook(
      "EVO-N04-FORMAT-EDIT",
      { L3: "16", L4: "28", L5: "39" },
      [{ range: "L3:L5", condition: "greater-than", value: "20", style: "red" }],
    ),
  );

  await grid();
  // The pre-provisioned rule already colours its matching cells.
  expect(cellFill("L4")).toBe(RED);
  expect(cellFill("L3")).not.toBe(RED);

  const dialog = await openFormatting(user);
  await user.click(within(dialog).getByRole("button", { name: "Edit rule 1" }));
  await user.selectOptions(within(dialog).getByLabelText("Style"), "green");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await closeDialog();

  expect(cellFill("L4")).toBe(GREEN);
  expect(cellFill("L5")).toBe(GREEN);
  expect(cellFill("L3")).not.toBe(GREEN);
  expect(api?.workbooks[0].worksheets[0].formatRules).toEqual([
    { range: "L3:L5", condition: "greater-than", value: "20", style: "green" },
  ]);

  const reopened = await openFormatting(user);
  await user.click(within(reopened).getByRole("button", { name: "Delete rule 1" }));
  await closeDialog();

  expect(cellFill("L3")).toBe("");
  expect(cellFill("L4")).toBe("");
  expect(cellFill("L5")).toBe("");
  expect(api?.workbooks[0].worksheets[0].formatRules).toBeUndefined();

  // Nothing comes back after a refresh.
  cleanup();
  render(<App />);
  await grid();
  expect(cellFill("L3")).toBe("");
  expect(cellFill("L4")).toBe("");
  expect(cellFill("L5")).toBe("");
  const afterRefresh = await openFormatting(user);
  expect(within(afterRefresh).queryByRole("button", { name: "Edit rule 1" })).toBeNull();
});

test("a rule without a value is rejected inside the dialog", async () => {
  const user = userEvent.setup();
  open(signalsWorkbook("EVO-N04-FORMAT-NUMBER", { J4: "11", J5: "29", J6: "46" }));

  await selectRange("J4", "J6");
  const dialog = await openFormatting(user);
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  const alert = await within(dialog).findByRole("alert");
  expect(alert.textContent).toBe("Please enter a value");
  expect(api?.workbooks[0].worksheets[0].formatRules).toBeUndefined();
});
