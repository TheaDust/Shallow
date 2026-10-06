import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import { SEED_WORKBOOK_ID, installFakeApi, type FakeApi } from "./test/fake-api";

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

function pasteEvent(text: string): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  return event;
}

/** Selects a rectangle by dragging, then opens the Data validation dialog. */
async function openDialog(user: ReturnType<typeof userEvent.setup>, anchor: string, focus = anchor) {
  fireEvent.mouseDown(await cell(anchor));
  fireEvent.mouseOver(screen.getByRole("gridcell", { name: focus }), { buttons: 1 });
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: focus }));
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Data validation" }));
  return screen.findByRole("dialog", { name: "Data validation" });
}

async function saveNumberRule(
  user: ReturnType<typeof userEvent.setup>,
  anchor: string,
  focus: string,
  min: string,
  max: string,
) {
  const dialog = await openDialog(user, anchor, focus);
  await user.selectOptions(within(dialog).getByLabelText("Rule type"), "number-range");
  await user.type(within(dialog).getByLabelText("Minimum"), min);
  await user.type(within(dialog).getByLabelText("Maximum"), max);
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data validation" })).toBeNull());
}

test("a saved 0-to-100 rule rejects a paste and stays active after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  await saveNumberRule(user, "D1", "E2", "0", "100");
  expect(api.workbooks[0].worksheets[0].validationRules).toEqual([
    { range: "D1:E2", type: "number-range", min: 0, max: 100 },
  ]);

  // The whole rectangle is rejected: no cell of the target keeps a value.
  fireEvent(window, pasteEvent("East\t1200\nNorth\t800"));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Please enter a number from 0 to 100");
  expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("");
  expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toBe("");
  expect(api.workbooks[0].worksheets[0].cells.D1).toBeUndefined();

  // Reopening the workbook keeps the rule active.
  cleanup();
  render(<App />);
  await grid();
  fireEvent(window, pasteEvent("East\t1200\nNorth\t800"));
  const again = await screen.findByRole("alert");
  expect(again.textContent).toBe("Please enter a number from 0 to 100");
  expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("");
});

test("a range outside the rule still accepts the same paste", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  await saveNumberRule(user, "D1", "E2", "0", "100");

  fireEvent.mouseDown(await cell("G1"));
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: "G1" }));
  fireEvent(window, pasteEvent("East\t1200\nNorth\t800"));
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "H1" }).textContent).toBe("1200"));
  expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("");
});

test("a dropdown rule reports the allowed values and can be deleted again", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  const dialog = await openDialog(user, "C1", "C2");
  await user.selectOptions(within(dialog).getByLabelText("Rule type"), "dropdown");
  await user.type(within(dialog).getByLabelText("Allowed values"), " Open , Closed ");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data validation" })).toBeNull());
  expect(api.workbooks[0].worksheets[0].validationRules).toEqual([
    { range: "C1:C2", type: "dropdown", values: ["Open", "Closed"] },
  ]);

  await user.click(await cell("C1"));
  const bar = screen.getByRole("textbox", { name: "Formula bar" });
  await user.clear(bar);
  await user.type(bar, "Pending{Enter}");
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Please select one of the following values: Open, Closed");
  expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toBe("Status");

  // Reopening the dialog prefills the rule and offers to remove it.
  const reopen = await openDialog(user, "C1", "C2");
  expect(within(reopen).getByLabelText("Rule type").textContent).toContain("Dropdown");
  expect((within(reopen).getByLabelText("Allowed values") as HTMLInputElement).value).toBe("Open, Closed");
  await user.click(within(reopen).getByRole("button", { name: "Delete rule" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data validation" })).toBeNull());
  expect(api.workbooks[0].worksheets[0].validationRules).toBeUndefined();

  await user.clear(screen.getByRole("textbox", { name: "Formula bar" }));
  await user.type(screen.getByRole("textbox", { name: "Formula bar" }), "Pending{Enter}");
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toBe("Pending"));
});

test("a dropdown cell offers its allowed values as options and writes the chosen one", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  const dialog = await openDialog(user, "C2", "C3");
  await user.selectOptions(within(dialog).getByLabelText("Rule type"), "dropdown");
  await user.type(within(dialog).getByLabelText("Allowed values"), " Open , Closed ");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data validation" })).toBeNull());

  // Every constrained cell exposes the button; nothing else does.
  expect(screen.getByRole("button", { name: "Open dropdown for C2" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open dropdown for C3" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open dropdown for A2" })).toBeNull();
  expect(screen.queryByRole("option")).toBeNull();

  await user.click(screen.getByRole("button", { name: "Open dropdown for C2" }));
  const listbox = await screen.findByRole("listbox");
  expect(within(listbox).getAllByRole("option").map((option) => option.textContent)).toEqual(["Open", "Closed"]);

  await user.click(within(listbox).getByRole("option", { name: "Open" }));
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("Open"));
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(api.workbooks[0].worksheets[0].cells.C2).toBe("Open");

  // The rule and the value it wrote survive a refresh.
  cleanup();
  render(<App />);
  await grid();
  expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("Open");
  await user.click(screen.getByRole("button", { name: "Open dropdown for C3" }));
  expect((await screen.findByRole("listbox")).textContent).toContain("Closed");
});

test("the dialog prefills a saved number rule and rejects an invalid range", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  await saveNumberRule(user, "D1", "D1", "0", "100");

  const dialog = await openDialog(user, "D1");
  // The reopened combo box shows the saved rule type, not a blank control.
  expect(within(dialog).getByLabelText("Rule type").textContent).toContain("Number range");
  expect((within(dialog).getByLabelText("Minimum") as HTMLInputElement).value).toBe("0");
  expect((within(dialog).getByLabelText("Maximum") as HTMLInputElement).value).toBe("100");

  await user.clear(within(dialog).getByLabelText("Maximum"));
  await user.type(within(dialog).getByLabelText("Maximum"), "100");
  await user.clear(within(dialog).getByLabelText("Minimum"));
  await user.type(within(dialog).getByLabelText("Minimum"), "20");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data validation" })).toBeNull());
  expect(api.workbooks[0].worksheets[0].validationRules).toEqual([
    { range: "D1", type: "number-range", min: 20, max: 100 },
  ]);

  // A reversed range is reported in the dialog and nothing is saved.
  const reopened = await openDialog(user, "D1");
  await user.clear(within(reopened).getByLabelText("Minimum"));
  await user.type(within(reopened).getByLabelText("Minimum"), "100");
  await user.clear(within(reopened).getByLabelText("Maximum"));
  await user.type(within(reopened).getByLabelText("Maximum"), "1");
  await user.click(within(reopened).getByRole("button", { name: "Save" }));
  expect((await within(reopened).findByRole("alert")).textContent).toBe(
    "The minimum must not be greater than the maximum",
  );
  expect(api.workbooks[0].worksheets[0].validationRules).toEqual([
    { range: "D1", type: "number-range", min: 20, max: 100 },
  ]);
});
