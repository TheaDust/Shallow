import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import {
  EVO_DROPDOWN_MESSAGE,
  EVO_NUMERIC_MESSAGE,
  EVO_VALIDATION_EDIT_WORKBOOK_ID,
  EVO_VALIDATION_FORMULA_WORKBOOK_ID,
  EVO_VALIDATION_GRID_WORKBOOK_ID,
  installFakeApi,
  type FakeApi,
} from "./test/fake-api";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
}

async function cell(name: string) {
  await grid();
  return screen.getByRole("gridcell", { name });
}

/** Enters `value` through the formula bar of the currently selected cell. */
async function typeInFormulaBar(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.clear(formulaBar());
  await user.type(formulaBar(), value);
  await user.keyboard("{Enter}");
}

async function openValidationDialog(user: ReturnType<typeof userEvent.setup>, coordinate: string) {
  await user.click(await cell(coordinate));
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Data validation" }));
  return screen.findByRole("dialog", { name: "Data validation" });
}

function storedRule(workbookId: string, coordinate: string) {
  const worksheet = api!.workbooks.find((workbook) => workbook.id === workbookId)!.worksheets[0];
  return worksheet.validationRules?.find((rule) => rule.range === coordinate) ?? null;
}

test("REQ-5-2-1 a custom numeric message replaces the standard one from the formula bar", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_VALIDATION_FORMULA_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  expect((await cell("J6")).textContent).toBe("37");
  // The seeded selection starts on the constrained cell.
  expect((await screen.findByRole("gridcell", { name: "J6" })).getAttribute("aria-selected")).toBe("true");

  await typeInFormulaBar(user, "88");
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(EVO_NUMERIC_MESSAGE);
  expect(screen.getByRole("gridcell", { name: "J6" }).textContent).toBe("37");
  expect(formulaBar().value).toBe("37");

  // The same rejection happens after a refresh.
  view.unmount();
  render(<App />);
  await user.click(await cell("J6"));
  await typeInFormulaBar(user, "88");
  expect((await screen.findByRole("alert")).textContent).toBe(EVO_NUMERIC_MESSAGE);
  expect(screen.getByRole("gridcell", { name: "J6" }).textContent).toBe("37");

  // A value inside the range is accepted and replaces the cell.
  await typeInFormulaBar(user, "60");
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "J6" }).textContent).toBe("60"));
});

test("REQ-5-2-1 a custom dropdown message replaces the standard value list in the grid", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_VALIDATION_GRID_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  expect((await cell("K8")).textContent).toBe("Ready");

  await user.dblClick(await cell("K8"));
  const editor = screen.getByRole("textbox", { name: "Edit K8" });
  await user.clear(editor);
  await user.type(editor, "Paused{Enter}");

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(EVO_DROPDOWN_MESSAGE);
  expect(screen.getByRole("gridcell", { name: "K8" }).textContent).toBe("Ready");

  view.unmount();
  render(<App />);
  await user.dblClick(await cell("K8"));
  const again = screen.getByRole("textbox", { name: "Edit K8" });
  await user.clear(again);
  await user.type(again, "Paused{Enter}");
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(EVO_DROPDOWN_MESSAGE));
  expect(screen.getByRole("gridcell", { name: "K8" }).textContent).toBe("Ready");

  // An allowed value still goes through.
  await user.dblClick(await cell("K8"));
  const allowed = screen.getByRole("textbox", { name: "Edit K8" });
  await user.clear(allowed);
  await user.type(allowed, "Holding{Enter}");
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "K8" }).textContent).toBe("Holding"));
});

test("REQ-5-2-1 an updated error message is prefilled when the rule is reopened", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_VALIDATION_EDIT_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  const dialog = await openValidationDialog(user, "L4");
  // The reopened dialog shows the saved rule type, parameters and message.
  expect(within(dialog).getByLabelText("Rule type").textContent).toContain("Number range");
  expect((within(dialog).getByLabelText("Minimum") as HTMLInputElement).value).toBe("25");
  expect((within(dialog).getByLabelText("Maximum") as HTMLInputElement).value).toBe("75");
  expect((within(dialog).getByLabelText("Error message") as HTMLInputElement).value).toBe(EVO_NUMERIC_MESSAGE);

  await user.clear(within(dialog).getByLabelText("Error message"));
  await user.type(within(dialog).getByLabelText("Error message"), "Allocate between 25 and 75");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data validation" })).toBeNull());
  expect(storedRule(EVO_VALIDATION_EDIT_WORKBOOK_ID, "L4")?.message).toBe("Allocate between 25 and 75");
  expect((await cell("L4")).textContent).toBe("42");

  await typeInFormulaBar(user, "24");
  expect((await screen.findByRole("alert")).textContent).toBe("Allocate between 25 and 75");
  expect(screen.getByRole("gridcell", { name: "L4" }).textContent).toBe("42");

  // After a refresh the new message is stored and prefilled again.
  view.unmount();
  render(<App />);
  const reopened = await openValidationDialog(user, "L4");
  expect((within(reopened).getByLabelText("Error message") as HTMLInputElement).value).toBe(
    "Allocate between 25 and 75",
  );
  await user.click(within(reopened).getByRole("button", { name: "Close" }));
  await typeInFormulaBar(user, "24");
  expect((await screen.findByRole("alert")).textContent).toBe("Allocate between 25 and 75");
  expect(screen.getByRole("gridcell", { name: "L4" }).textContent).toBe("42");

  // Clearing the field brings the standard wording back.
  const cleared = await openValidationDialog(user, "L4");
  await user.clear(within(cleared).getByLabelText("Error message"));
  await user.click(within(cleared).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data validation" })).toBeNull());
  expect(storedRule(EVO_VALIDATION_EDIT_WORKBOOK_ID, "L4")?.message).toBeUndefined();
  await typeInFormulaBar(user, "24");
  expect((await screen.findByRole("alert")).textContent).toBe("Please enter a number between 25 and 75");
});
