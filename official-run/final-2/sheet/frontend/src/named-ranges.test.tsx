import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import {
  EVO_NAMED_CREATE_ID,
  EVO_NAMED_INVALID_ID,
  EVO_NAMED_UPDATE_ID,
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

async function openWorkbook(id: string) {
  window.location.hash = `#/workbooks/${id}`;
  render(<App />);
  await grid();
}

/** Selects a rectangle of the grid (anchor plus optional focus) and returns it. */
async function select(anchor: string, focus = anchor) {
  fireEvent.mouseDown(screen.getByRole("gridcell", { name: anchor }));
  fireEvent.mouseOver(screen.getByRole("gridcell", { name: focus }), { buttons: 1 });
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: focus }));
  await waitFor(() => expect(screen.getByRole("gridcell", { name: anchor }).getAttribute("aria-selected")).toBe("true"));
}

/** Opens "Named ranges" through the Data menu. */
async function openNamedRanges(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Named ranges" }));
  return screen.findByRole("dialog", { name: "Named ranges" });
}

function storedWorkbook(id: string) {
  return api!.workbooks.find((workbook) => workbook.id === id)!;
}

test("REQ-7-1-1 - a saved name works as a range reference and survives a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  await openWorkbook(EVO_NAMED_CREATE_ID);

  const dialog = await openNamedRanges(user);
  await user.click(within(dialog).getByRole("button", { name: "Add named range" }));
  await user.type(within(dialog).getByLabelText("Name"), "CapacityPlan");
  await user.type(within(dialog).getByLabelText("Range"), "ForecastModel!J3:J5");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Named ranges" })).toBeNull());
  expect(storedWorkbook(EVO_NAMED_CREATE_ID).namedRanges).toEqual([
    { name: "CapacityPlan", range: "ForecastModel!J3:J5" },
  ]);

  await select("L3");
  const bar = screen.getByRole("textbox", { name: "Formula bar" });
  await user.clear(bar);
  await user.type(bar, "=SUM(CapacityPlan)");
  fireEvent.keyDown(bar, { key: "Enter" });
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "L3" }).textContent).toBe("73"));

  // The dialog lists the saved name together with its "Edit <name>" control.
  const reopened = await openNamedRanges(user);
  expect(within(reopened).getByText("CapacityPlan")).toBeTruthy();
  expect(within(reopened).getByRole("button", { name: "Edit CapacityPlan" })).toBeTruthy();
  await user.click(within(reopened).getByRole("button", { name: "Close" }));

  // Reopening the workbook keeps the name, the formula text and its result.
  cleanup();
  render(<App />);
  await grid();
  await select("L3");
  expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("=SUM(CapacityPlan)");
  expect(screen.getByRole("gridcell", { name: "L3" }).textContent).toBe("73");
});

test("REQ-7-1-1 - a name not starting with a letter is rejected and stored nowhere", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  await openWorkbook(EVO_NAMED_INVALID_ID);

  const dialog = await openNamedRanges(user);
  await user.click(within(dialog).getByRole("button", { name: "Add named range" }));
  await user.type(within(dialog).getByLabelText("Name"), "1stBatch");
  await user.type(within(dialog).getByLabelText("Range"), "ForecastModel!K2:K3");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Named range must start with a letter");
  expect(within(dialog).queryByText("1stBatch")).toBeNull();
  expect(storedWorkbook(EVO_NAMED_INVALID_ID).namedRanges).toBeUndefined();

  await user.click(within(dialog).getByRole("button", { name: "Close" }));

  // Nothing was stored: after a refresh the dialog holds no such entry.
  cleanup();
  render(<App />);
  await grid();
  const reopened = await openNamedRanges(user);
  expect(within(reopened).queryByText("1stBatch")).toBeNull();
  expect(within(reopened).queryByRole("button", { name: "Edit 1stBatch" })).toBeNull();
});

test("REQ-7-1-1 - editing a name's range recalculates its formulas and persists", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  await openWorkbook(EVO_NAMED_UPDATE_ID);

  expect(screen.getByRole("gridcell", { name: "M2" }).textContent).toBe("13");

  const dialog = await openNamedRanges(user);
  await user.click(within(dialog).getByRole("button", { name: "Edit MarginBase" }));
  const rangeField = within(dialog).getByLabelText("Range") as HTMLInputElement;
  expect(rangeField.value).toBe("ForecastModel!K2:K3");
  await user.clear(rangeField);
  await user.type(rangeField, "ForecastModel!K2:K4");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Named ranges" })).toBeNull());
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "M2" }).textContent).toBe("25"));
  expect(storedWorkbook(EVO_NAMED_UPDATE_ID).namedRanges).toEqual([
    { name: "MarginBase", range: "ForecastModel!K2:K4" },
  ]);

  // Reopening the workbook keeps both the new range and the recalculated value.
  cleanup();
  render(<App />);
  await grid();
  expect(screen.getByRole("gridcell", { name: "M2" }).textContent).toBe("25");
  const reopened = await openNamedRanges(user);
  await user.click(within(reopened).getByRole("button", { name: "Edit MarginBase" }));
  expect((within(reopened).getByLabelText("Range") as HTMLInputElement).value).toBe("ForecastModel!K2:K4");
});
