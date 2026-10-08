import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import { installFakeApi, type FakeApi } from "./test/fake-api";
import type { ConditionalFormat, Workbook } from "./domain/types";

let api: FakeApi | undefined;

const RED = "rgb(254, 226, 226)";
const YELLOW = "rgb(254, 249, 195)";
const GREEN = "rgb(220, 252, 231)";

/**
 * One pre-provisioned `Signals` workbook of a conditional-formatting scenario:
 * the seeded cells of the GIVEN plus the rule that scenario already stores.
 */
function signalsWorkbook(id: string, cells: Record<string, string>, formats?: ConditionalFormat[]): Workbook {
  const worksheetId = `ws-${id}-signals`;
  return {
    id,
    name: id,
    createdAt: "2026-09-05T09:56:00.000Z",
    updatedAt: "2026-09-06T09:56:00.000Z",
    activeWorksheetId: worksheetId,
    worksheets: [
      {
        id: worksheetId,
        name: "Signals",
        selection: { anchor: "A1", focus: "A1" },
        cells,
        ...(formats ? { conditionalFormats: formats } : {}),
      },
    ],
  };
}

const EDIT_RULE: ConditionalFormat = {
  id: "cf-evo-n04-format-edit-1",
  range: "L3:L5",
  condition: "Greater than",
  value: "20",
  style: "Red fill",
};

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

/** Selects a rectangle by dragging, like a pointer does. */
async function selectRange(anchor: string, focus: string) {
  await grid();
  fireEvent.mouseDown(cell(anchor));
  fireEvent.mouseOver(cell(focus), { buttons: 1 });
  fireEvent.mouseUp(cell(focus));
  await waitFor(() => expect(cell(anchor)).toHaveAttribute("aria-selected", "true"));
  await waitFor(() => expect(cell(focus)).toHaveAttribute("aria-selected", "true"));
}

/** Opens the "Conditional formatting" dialog through the "Format" menu. */
async function openConditionalFormatting(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Format" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Conditional formatting" }));
  return screen.findByRole("dialog", { name: "Conditional formatting" });
}

async function saveRule(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  condition: string,
  value: string,
  style: string,
) {
  await user.selectOptions(within(dialog).getByLabelText("Condition"), condition);
  await user.type(within(dialog).getByLabelText("Value"), value);
  await user.selectOptions(within(dialog).getByLabelText("Style"), style);
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
}

test("a numeric threshold fills the matching cells and survives a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi([signalsWorkbook("EVO-N04-FORMAT-NUMBER", { J4: "11", J5: "29", J6: "46" })]);
  window.location.hash = "#/workbooks/EVO-N04-FORMAT-NUMBER";
  render(<App />);
  await grid();
  await selectRange("J4", "J6");

  const dialog = await openConditionalFormatting(user);
  // The selected rectangle is already the target range of the new rule.
  expect((within(dialog).getByLabelText("Range") as HTMLInputElement).value).toBe("J4:J6");
  await saveRule(user, dialog, "Greater than", "25", "Red fill");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conditional formatting" })).toBeNull());
  expect(api.workbooks[0].worksheets[0].conditionalFormats).toEqual([
    { id: expect.any(String), range: "J4:J6", condition: "Greater than", value: "25", style: "Red fill" },
  ]);

  await waitFor(() => expect(cell("J5")).toHaveStyle({ backgroundColor: RED }));
  expect(cell("J6")).toHaveStyle({ backgroundColor: RED });
  // A cell of the target range that does not match keeps its normal fill.
  expect(cell("J4")).not.toHaveStyle({ backgroundColor: RED });

  // The fill of the matching cells remains after a refresh.
  cleanup();
  render(<App />);
  await grid();
  expect(cell("J5")).toHaveStyle({ backgroundColor: RED });
  expect(cell("J4")).not.toHaveStyle({ backgroundColor: RED });
});

test("a text rule fills only the containing cell and stays listed after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi([signalsWorkbook("EVO-N04-FORMAT-TEXT", { K4: "Watch", K5: "Stable", K6: "Elevated" })]);
  window.location.hash = "#/workbooks/EVO-N04-FORMAT-TEXT";
  render(<App />);
  await grid();
  await selectRange("K4", "K6");

  const dialog = await openConditionalFormatting(user);
  await saveRule(user, dialog, "Text contains", "Watch", "Yellow fill");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conditional formatting" })).toBeNull());

  await waitFor(() => expect(cell("K4")).toHaveStyle({ backgroundColor: YELLOW }));
  expect(cell("K5")).not.toHaveStyle({ backgroundColor: YELLOW });
  expect(cell("K6")).not.toHaveStyle({ backgroundColor: YELLOW });

  // The stored rule is listed again after a refresh, together with its fills.
  cleanup();
  render(<App />);
  await grid();
  expect(cell("K4")).toHaveStyle({ backgroundColor: YELLOW });
  const reopened = await openConditionalFormatting(user);
  expect(within(reopened).getByRole("button", { name: "Edit rule 1" })).toBeTruthy();
  expect(within(reopened).getByRole("button", { name: "Delete rule 1" })).toBeTruthy();
});

test("editing a rule replaces its style immediately and deleting it removes the fill", async () => {
  const user = userEvent.setup();
  api = installFakeApi([
    signalsWorkbook("EVO-N04-FORMAT-EDIT", { L3: "16", L4: "28", L5: "39" }, [{ ...EDIT_RULE }]),
  ]);
  window.location.hash = "#/workbooks/EVO-N04-FORMAT-EDIT";
  render(<App />);
  await grid();

  // The pre-provisioned rule paints the values above its threshold.
  await waitFor(() => expect(cell("L4")).toHaveStyle({ backgroundColor: RED }));
  expect(cell("L5")).toHaveStyle({ backgroundColor: RED });
  expect(cell("L3")).not.toHaveStyle({ backgroundColor: RED });

  const dialog = await openConditionalFormatting(user);
  await user.click(within(dialog).getByRole("button", { name: "Edit rule 1" }));
  // The edited rule is loaded into the form, condition and value included.
  expect((within(dialog).getByLabelText("Range") as HTMLInputElement).value).toBe("L3:L5");
  expect((within(dialog).getByLabelText("Condition") as HTMLSelectElement).value).toBe("Greater than");
  expect((within(dialog).getByLabelText("Value") as HTMLInputElement).value).toBe("20");
  await user.selectOptions(within(dialog).getByLabelText("Style"), "Green fill");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conditional formatting" })).toBeNull());

  await waitFor(() => expect(cell("L4")).toHaveStyle({ backgroundColor: GREEN }));
  expect(cell("L5")).toHaveStyle({ backgroundColor: GREEN });
  expect(cell("L4")).not.toHaveStyle({ backgroundColor: RED });
  expect(api.workbooks[0].worksheets[0].conditionalFormats).toEqual([
    { id: "cf-evo-n04-format-edit-1", range: "L3:L5", condition: "Greater than", value: "20", style: "Green fill" },
  ]);

  // Reopening the dialog and deleting rule 1 removes the visible fill.
  const reopened = await openConditionalFormatting(user);
  await user.click(within(reopened).getByRole("button", { name: "Delete rule 1" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conditional formatting" })).toBeNull());
  expect(api.workbooks[0].worksheets[0].conditionalFormats).toBeUndefined();
  for (const name of ["L3", "L4", "L5"]) {
    expect(cell(name)).not.toHaveStyle({ backgroundColor: GREEN });
    expect(cell(name)).not.toHaveStyle({ backgroundColor: RED });
  }

  cleanup();
  render(<App />);
  await grid();
  for (const name of ["L3", "L4", "L5"]) {
    expect(cell(name)).not.toHaveStyle({ backgroundColor: GREEN });
    expect(cell(name)).not.toHaveStyle({ backgroundColor: RED });
  }
});

test("a rule without a value is rejected in the dialog and stores nothing", async () => {
  const user = userEvent.setup();
  api = installFakeApi([signalsWorkbook("EVO-N04-FORMAT-NUMBER", { J4: "11", J5: "29", J6: "46" })]);
  window.location.hash = "#/workbooks/EVO-N04-FORMAT-NUMBER";
  render(<App />);
  await grid();
  await selectRange("J4", "J6");

  const dialog = await openConditionalFormatting(user);
  await user.selectOptions(within(dialog).getByLabelText("Condition"), "Greater than");
  await user.selectOptions(within(dialog).getByLabelText("Style"), "Red fill");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Please enter a value for the condition");
  expect(api.workbooks[0].worksheets[0].conditionalFormats).toBeUndefined();
  expect(cell("J5")).not.toHaveStyle({ backgroundColor: RED });
});
