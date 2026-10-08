import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import { installFakeApi, type FakeApi } from "./test/fake-api";

const CREATE_ID = "EVO-N03-NAMED-CREATE";
const INVALID_ID = "EVO-N03-NAMED-INVALID";
const UPDATE_ID = "EVO-N03-NAMED-UPDATE";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function cellText(name: string): string | null {
  return screen.queryByRole("gridcell", { name })?.textContent ?? null;
}

/** Clicks one cell so it becomes the worksheet's single selected cell. */
function selectCell(name: string) {
  const target = screen.getByRole("gridcell", { name });
  fireEvent.mouseDown(target);
  fireEvent.mouseUp(target);
  return target;
}

async function openMenuCommand(user: ReturnType<typeof userEvent.setup>, menu: string, item: string) {
  await user.click(screen.getByRole("button", { name: menu }));
  const opened = await screen.findByRole("menu");
  await user.click(within(opened).getByRole("menuitem", { name: item }));
}

function workbookNamedRanges(id: string) {
  return api!.workbooks.find((workbook) => workbook.id === id)?.namedRanges;
}

test("a created named range is listed, feeds a formula and survives a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${CREATE_ID}`;
  render(<App />);
  await grid();

  await openMenuCommand(user, "Data", "Named ranges");
  const dialog = await screen.findByRole("dialog", { name: "Named ranges" });
  await user.click(within(dialog).getByRole("button", { name: "Add named range" }));
  await user.type(within(dialog).getByLabelText("Name"), "CapacityPlan");
  await user.type(within(dialog).getByLabelText("Range"), "ForecastModel!J3:J5");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Named ranges" })).toBeNull());
  expect(workbookNamedRanges(CREATE_ID)).toEqual([
    { name: "CapacityPlan", range: "ForecastModel!J3:J5" },
  ]);

  selectCell("L3");
  await user.type(screen.getByRole("textbox", { name: "Formula bar" }), "=SUM(CapacityPlan){Enter}");
  await waitFor(() => expect(cellText("L3")).toBe("73"));

  // The saved name is listed with its own Edit control.
  await openMenuCommand(user, "Data", "Named ranges");
  const listed = await screen.findByRole("dialog", { name: "Named ranges" });
  expect(within(listed).getByText("CapacityPlan")).toBeTruthy();
  expect(within(listed).getByRole("button", { name: "Edit CapacityPlan" })).toBeTruthy();
  await user.click(within(listed).getByRole("button", { name: "Close" }));

  // A refresh keeps the formula text and its calculated result.
  cleanup();
  render(<App />);
  await grid();
  expect(cellText("L3")).toBe("73");
  selectCell("L3");
  expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
    "=SUM(CapacityPlan)",
  );
});

test("a name not starting with a letter shows the exact message and is not stored", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${INVALID_ID}`;
  render(<App />);
  await grid();

  await openMenuCommand(user, "Data", "Named ranges");
  const dialog = await screen.findByRole("dialog", { name: "Named ranges" });
  await user.click(within(dialog).getByRole("button", { name: "Add named range" }));
  await user.type(within(dialog).getByLabelText("Name"), "1stBatch");
  await user.type(within(dialog).getByLabelText("Range"), "ForecastModel!K2:K3");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const alert = await within(dialog).findByRole("alert");
  expect(alert.textContent).toBe("Named range must start with a letter");
  expect(workbookNamedRanges(INVALID_ID)).toBeUndefined();

  // Reopening the workbook leaves the name out of the list.
  cleanup();
  render(<App />);
  await grid();
  await openMenuCommand(user, "Data", "Named ranges");
  const reopened = await screen.findByRole("dialog", { name: "Named ranges" });
  expect(within(reopened).queryByText("1stBatch")).toBeNull();
  expect(within(reopened).queryByRole("button", { name: "Edit 1stBatch" })).toBeNull();
});

test("editing MarginBase's range recalculates its formula and persists after refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${UPDATE_ID}`;
  render(<App />);
  await grid();
  expect(cellText("M2")).toBe("13");

  await openMenuCommand(user, "Data", "Named ranges");
  const dialog = await screen.findByRole("dialog", { name: "Named ranges" });
  await user.click(within(dialog).getByRole("button", { name: "Edit MarginBase" }));
  const range = within(dialog).getByLabelText("Range") as HTMLInputElement;
  expect(range.value).toBe("ForecastModel!K2:K3");
  await user.clear(range);
  await user.type(range, "ForecastModel!K2:K4");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Named ranges" })).toBeNull());
  await waitFor(() => expect(cellText("M2")).toBe("25"));
  expect(workbookNamedRanges(UPDATE_ID)).toEqual([{ name: "MarginBase", range: "ForecastModel!K2:K4" }]);

  cleanup();
  render(<App />);
  await grid();
  expect(cellText("M2")).toBe("25");
  await openMenuCommand(user, "Data", "Named ranges");
  const reopened = await screen.findByRole("dialog", { name: "Named ranges" });
  await user.click(within(reopened).getByRole("button", { name: "Edit MarginBase" }));
  expect((within(reopened).getByLabelText("Range") as HTMLInputElement).value).toBe("ForecastModel!K2:K4");
});
