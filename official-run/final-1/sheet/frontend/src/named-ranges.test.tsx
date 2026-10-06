import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import {
  EVO_NAMED_CREATE_WORKBOOK_ID,
  EVO_NAMED_INVALID_WORKBOOK_ID,
  EVO_NAMED_UPDATE_WORKBOOK_ID,
  installFakeApi,
  type FakeApi,
} from "./test/fake-api";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
}

async function cell(name: string) {
  await screen.findByRole("grid", { name: "Worksheet grid" });
  return screen.getByRole("gridcell", { name });
}

/** Enters `value` through the formula bar of the currently selected cell. */
async function typeInFormulaBar(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.clear(formulaBar());
  await user.type(formulaBar(), value);
  await user.keyboard("{Enter}");
}

/** Opens the "Named ranges" dialog through the "Data" menu. */
async function openNamedRanges(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Named ranges" }));
  return screen.findByRole("dialog", { name: "Named ranges" });
}

/** Fills the "Add named range" form and saves it. */
async function addNamedRange(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  name: string,
  range: string,
) {
  await user.click(within(dialog).getByRole("button", { name: "Add named range" }));
  await user.type(within(dialog).getByLabelText("Name"), name);
  await user.type(within(dialog).getByLabelText("Range"), range);
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
}

/** Stored names of one workbook, as the server keeps them. */
function storedNames(workbookId: string) {
  return (api!.workbooks.find((workbook) => workbook.id === workbookId)!.namedRanges ?? []).map((entry) => ({
    name: entry.name,
    range: entry.range,
  }));
}

test("REQ-7-1-1 a saved name is listed, used in a formula and kept after a refresh", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_NAMED_CREATE_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  expect(await cell("J3")).toBeTruthy();
  expect(screen.getByRole("gridcell", { name: "L3" }).textContent).toBe("");

  const dialog = await openNamedRanges(user);
  await addNamedRange(user, dialog, "CapacityPlan", "ForecastModel!J3:J5");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Named ranges" })).toBeNull());
  expect(storedNames(EVO_NAMED_CREATE_WORKBOOK_ID)).toEqual([
    { name: "CapacityPlan", range: "ForecastModel!J3:J5" },
  ]);

  // The reopened dialog lists the saved name with its own Edit control.
  const reopened = await openNamedRanges(user);
  expect(within(reopened).getByRole("button", { name: "Edit CapacityPlan" })).toBeTruthy();
  await user.click(within(reopened).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog", { name: "Named ranges" })).toBeNull();

  await user.click(await cell("L3"));
  await typeInFormulaBar(user, "=SUM(CapacityPlan)");
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "L3" }).textContent).toBe("73"));

  // After a refresh the formula bar keeps the expression and the cell keeps 73.
  view.unmount();
  render(<App />);
  await user.click(await cell("L3"));
  expect(formulaBar().value).toBe("=SUM(CapacityPlan)");
  expect(screen.getByRole("gridcell", { name: "L3" }).textContent).toBe("73");
  const afterRefresh = await openNamedRanges(user);
  expect(within(afterRefresh).getByRole("button", { name: "Edit CapacityPlan" })).toBeTruthy();
});

test("REQ-7-1-1 a name that does not start with a letter is refused and never stored", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_NAMED_INVALID_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  const dialog = await openNamedRanges(user);
  await addNamedRange(user, dialog, "1stBatch", "ForecastModel!K2:K3");

  const alert = await within(dialog).findByRole("alert");
  expect(alert.textContent).toBe("Named range must start with a letter");
  expect(storedNames(EVO_NAMED_INVALID_WORKBOOK_ID)).toEqual([]);
  // The dialog stays open, so the message stays visible for another attempt.
  expect(within(dialog).getByLabelText("Name")).toBeTruthy();

  view.unmount();
  render(<App />);
  const reopened = await openNamedRanges(user);
  expect(within(reopened).queryByRole("button", { name: "Edit 1stBatch" })).toBeNull();
  expect(within(reopened).queryByText("1stBatch")).toBeNull();
});

test("REQ-7-1-1 editing a name's range recalculates its dependents and persists", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_NAMED_UPDATE_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  // The seeded formula reads K2:K3, so the sum is 5 + 8.
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "M2" }).textContent).toBe("13"));

  const dialog = await openNamedRanges(user);
  await user.click(within(dialog).getByRole("button", { name: "Edit MarginBase" }));
  expect((within(dialog).getByLabelText("Range") as HTMLInputElement).value).toBe("ForecastModel!K2:K3");
  await user.clear(within(dialog).getByLabelText("Range"));
  await user.type(within(dialog).getByLabelText("Range"), "ForecastModel!K2:K4");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Named ranges" })).toBeNull());
  // 5 + 8 + 12, recalculated as soon as the range changed.
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "M2" }).textContent).toBe("25"));
  expect(storedNames(EVO_NAMED_UPDATE_WORKBOOK_ID)).toEqual([
    { name: "MarginBase", range: "ForecastModel!K2:K4" },
  ]);

  view.unmount();
  render(<App />);
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "M2" }).textContent).toBe("25"));
  const reopened = await openNamedRanges(user);
  await user.click(within(reopened).getByRole("button", { name: "Edit MarginBase" }));
  expect((within(reopened).getByLabelText("Range") as HTMLInputElement).value).toBe("ForecastModel!K2:K4");
});
