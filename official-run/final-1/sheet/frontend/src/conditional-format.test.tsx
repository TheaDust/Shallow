import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import {
  EVO_FORMAT_EDIT_WORKBOOK_ID,
  EVO_FORMAT_NUMBER_WORKBOOK_ID,
  EVO_FORMAT_TEXT_WORKBOOK_ID,
  installFakeApi,
  type FakeApi,
} from "./test/fake-api";

const RED_FILL = "rgb(254, 226, 226)";
const YELLOW_FILL = "rgb(254, 249, 195)";
const GREEN_FILL = "rgb(220, 252, 231)";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

async function cell(name: string) {
  await screen.findByRole("grid", { name: "Worksheet grid" });
  return screen.getByRole("gridcell", { name });
}

/** Visible background color one cell currently shows. */
async function fillOf(name: string): Promise<string> {
  return (await cell(name)).style.backgroundColor;
}

/** Selects a rectangle of the grid by dragging from `anchor` to `focus`. */
async function selectRange(anchor: string, focus: string) {
  fireEvent.mouseDown(await cell(anchor));
  fireEvent.mouseOver(screen.getByRole("gridcell", { name: focus }), { buttons: 1 });
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: focus }));
}

/** Opens the "Conditional formatting" dialog through the "Format" menu. */
async function openConditionalFormatting(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Format" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Conditional formatting" }));
  return screen.findByRole("dialog", { name: "Conditional formatting" });
}

function storedRules(workbookId: string) {
  return (
    api!.workbooks.find((workbook) => workbook.id === workbookId)!.worksheets[0].conditionalFormats ?? []
  ).map((rule) => ({ range: rule.range, condition: rule.condition, value: rule.value, style: rule.style }));
}

test("REQ-7-2-1 a numeric threshold paints the matching cells and survives a refresh", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_FORMAT_NUMBER_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  await selectRange("J4", "J6");
  const dialog = await openConditionalFormatting(user);
  // The form starts on the selected range, so the rule watches J4:J6.
  expect((within(dialog).getByLabelText("Range") as HTMLInputElement).value).toBe("J4:J6");
  await user.selectOptions(within(dialog).getByLabelText("Condition"), "Greater than");
  await user.type(within(dialog).getByLabelText("Value"), "25");
  // The style is chosen from the visible option list of the mixed Combobox.
  await user.click(within(dialog).getByLabelText("Style"));
  await user.click(within(dialog).getByRole("option", { name: "Red fill" }));
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conditional formatting" })).toBeNull());

  expect(await fillOf("J5")).toBe(RED_FILL);
  expect(await fillOf("J6")).toBe(RED_FILL);
  expect(await fillOf("J4")).not.toBe(RED_FILL);
  expect(storedRules(EVO_FORMAT_NUMBER_WORKBOOK_ID)).toEqual([
    { range: "J4:J6", condition: "Greater than", value: "25", style: "Red fill" },
  ]);

  view.unmount();
  render(<App />);
  expect(await fillOf("J5")).toBe(RED_FILL);
  expect(await fillOf("J6")).toBe(RED_FILL);
  expect(await fillOf("J4")).not.toBe(RED_FILL);
});

test("REQ-7-2-1 a text match paints only the matching cell and stays listed after a refresh", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_FORMAT_TEXT_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  await selectRange("K4", "K6");
  const dialog = await openConditionalFormatting(user);
  await user.selectOptions(within(dialog).getByLabelText("Condition"), "Text contains");
  await user.type(within(dialog).getByLabelText("Value"), "Watch");
  await user.selectOptions(within(dialog).getByLabelText("Style"), "Yellow fill");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conditional formatting" })).toBeNull());

  expect(await fillOf("K4")).toBe(YELLOW_FILL);
  expect(await fillOf("K5")).not.toBe(YELLOW_FILL);
  expect(await fillOf("K6")).not.toBe(YELLOW_FILL);

  view.unmount();
  render(<App />);
  expect(await fillOf("K4")).toBe(YELLOW_FILL);
  expect(await fillOf("K5")).not.toBe(YELLOW_FILL);
  expect((await cell("K4")).textContent).toBe("Watch");
  const reopened = await openConditionalFormatting(user);
  expect(within(reopened).getByRole("button", { name: "Edit rule 1" })).toBeTruthy();
  expect(within(reopened).getByRole("button", { name: "Delete rule 1" })).toBeTruthy();
  await user.click(within(reopened).getByRole("button", { name: "Edit rule 1" }));
  expect((within(reopened).getByLabelText("Value") as HTMLInputElement).value).toBe("Watch");
  expect((within(reopened).getByLabelText("Style") as HTMLSelectElement).value).toBe("Yellow fill");
});

test("REQ-7-2-1 a shift click extends the selection the rule form starts on", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_FORMAT_NUMBER_WORKBOOK_ID}`;
  api = installFakeApi();
  render(<App />);

  await user.click(await cell("J4"));
  fireEvent.mouseDown(screen.getByRole("gridcell", { name: "J6" }), { shiftKey: true });
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: "J6" }));
  expect(["J4", "J5", "J6"].map((name) => screen.getByRole("gridcell", { name }).getAttribute("aria-selected"))).toEqual([
    "true",
    "true",
    "true",
  ]);

  const dialog = await openConditionalFormatting(user);
  expect((within(dialog).getByLabelText("Range") as HTMLInputElement).value).toBe("J4:J6");
});

test("REQ-7-2-1 editing rule 1 replaces its style and deleting it removes the fill", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_FORMAT_EDIT_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  // The seeded rule 1 paints Red fill over the values above 20.
  expect(await fillOf("L4")).toBe(RED_FILL);
  expect(await fillOf("L5")).toBe(RED_FILL);
  expect(await fillOf("L3")).not.toBe(RED_FILL);

  const dialog = await openConditionalFormatting(user);
  await user.click(within(dialog).getByRole("button", { name: "Edit rule 1" }));
  expect((within(dialog).getByLabelText("Range") as HTMLInputElement).value).toBe("L3:L5");
  await user.selectOptions(within(dialog).getByLabelText("Style"), "Green fill");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conditional formatting" })).toBeNull());

  expect(await fillOf("L4")).toBe(GREEN_FILL);
  expect(await fillOf("L5")).toBe(GREEN_FILL);
  expect(await fillOf("L3")).not.toBe(GREEN_FILL);
  expect(storedRules(EVO_FORMAT_EDIT_WORKBOOK_ID)).toEqual([
    { range: "L3:L5", condition: "Greater than", value: "20", style: "Green fill" },
  ]);

  const reopened = await openConditionalFormatting(user);
  await user.click(within(reopened).getByRole("button", { name: "Delete rule 1" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conditional formatting" })).toBeNull());
  expect(await fillOf("L3")).toBe("");
  expect(await fillOf("L4")).toBe("");
  expect(await fillOf("L5")).toBe("");
  expect(storedRules(EVO_FORMAT_EDIT_WORKBOOK_ID)).toEqual([]);

  view.unmount();
  render(<App />);
  expect(await fillOf("L4")).toBe("");
  expect(await fillOf("L5")).toBe("");
  const afterRefresh = await openConditionalFormatting(user);
  expect(within(afterRefresh).queryByRole("button", { name: "Edit rule 1" })).toBeNull();
});
