import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import { installFakeApi, type FakeApi } from "./test/fake-api";
import type { Workbook } from "./domain/types";

const CAPACITY_MESSAGE = "Capacity must be from 25 to 75";

const FORMULA_ID = "EVO-M05-VALIDATION-FORMULA";
const GRID_ID = "EVO-M05-VALIDATION-GRID";
const EDIT_ID = "EVO-M05-VALIDATION-EDIT";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

beforeEach(() => {
  window.location.hash = `#/workbooks/${FORMULA_ID}`;
});

function validationWorkbook(id: string, worksheet: Workbook["worksheets"][number]): Workbook {
  return {
    id,
    name: id,
    createdAt: "2026-10-05T09:00:00.000Z",
    updatedAt: "2026-10-05T09:01:00.000Z",
    activeWorksheetId: worksheet.id,
    worksheets: [worksheet],
  };
}

function capacityWorkbook(id: string, coordinate: string, value: string): Workbook {
  return validationWorkbook(id, {
    id: `ws-${id}`,
    name: "Thresholds",
    selection: { anchor: "A1", focus: "A1" },
    cells: { [coordinate]: value },
    validationRules: [
      { range: coordinate, type: "number-range", min: 25, max: 75, errorMessage: CAPACITY_MESSAGE },
    ],
  });
}

function dropdownWorkbook(): Workbook {
  return validationWorkbook(GRID_ID, {
    id: `ws-${GRID_ID}`,
    name: "Thresholds",
    selection: { anchor: "A1", focus: "A1" },
    cells: { K8: "Ready" },
    validationRules: [
      {
        range: "K8",
        type: "dropdown",
        values: ["Ready", "Holding", "Released"],
        errorMessage: "Choose a queue state",
      },
    ],
  });
}

async function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

async function cell(name: string) {
  await grid();
  return screen.getByRole("gridcell", { name });
}

async function selectCell(name: string) {
  fireEvent.mouseDown(await cell(name));
  fireEvent.mouseUp(screen.getByRole("gridcell", { name }));
  await waitFor(() => expect(screen.getByRole("gridcell", { name }).getAttribute("aria-selected")).toBe("true"));
}

async function openValidationDialog(user: ReturnType<typeof userEvent.setup>, coordinate: string) {
  await selectCell(coordinate);
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Data validation" }));
  return screen.findByRole("dialog", { name: "Data validation" });
}

/** Parses the stored rule covering a coordinate from the fake store. */
function storedRule(coordinate: string) {
  const worksheet = api!.workbooks[0].worksheets[0];
  return worksheet.validationRules?.find((rule) => rule.range === coordinate);
}

test("a custom numeric message is shown for a formula-bar entry and survives a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi([capacityWorkbook(FORMULA_ID, "J6", "37")]);
  render(<App />);
  await grid();

  await selectCell("J6");
  const bar = screen.getByRole("textbox", { name: "Formula bar" });
  await user.clear(bar);
  await user.type(bar, "88{Enter}");
  expect((await screen.findByRole("alert")).textContent).toBe(CAPACITY_MESSAGE);
  expect(screen.getByRole("gridcell", { name: "J6" }).textContent).toBe("37");
  expect(api!.workbooks[0].worksheets[0].cells.J6).toBe("37");

  // The same rejection happens after a refresh: rule and message persisted.
  cleanup();
  render(<App />);
  await grid();
  await selectCell("J6");
  const reopened = screen.getByRole("textbox", { name: "Formula bar" });
  await user.clear(reopened);
  await user.type(reopened, "88{Enter}");
  expect((await screen.findByRole("alert")).textContent).toBe(CAPACITY_MESSAGE);
  expect(screen.getByRole("gridcell", { name: "J6" }).textContent).toBe("37");
});

test("a custom dropdown message is shown for an invalid grid edit and survives a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi([dropdownWorkbook()]);
  window.location.hash = `#/workbooks/${GRID_ID}`;
  render(<App />);
  await grid();

  fireEvent.doubleClick(await cell("K8"));
  const editor = await screen.findByRole("textbox", { name: "Edit K8" });
  await user.clear(editor);
  await user.type(editor, "Paused{Enter}");
  expect((await screen.findByRole("alert")).textContent).toBe("Choose a queue state");
  expect(screen.getByRole("gridcell", { name: "K8" }).textContent).toBe("Ready");
  expect(api!.workbooks[0].worksheets[0].cells.K8).toBe("Ready");

  cleanup();
  render(<App />);
  await grid();
  fireEvent.doubleClick(screen.getByRole("gridcell", { name: "K8" }));
  const again = await screen.findByRole("textbox", { name: "Edit K8" });
  await user.clear(again);
  await user.type(again, "Paused{Enter}");
  expect((await screen.findByRole("alert")).textContent).toBe("Choose a queue state");
  expect(screen.getByRole("gridcell", { name: "K8" }).textContent).toBe("Ready");
});

test("an updated error message takes effect at once and is prefilled after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi([capacityWorkbook(EDIT_ID, "L4", "42")]);
  window.location.hash = `#/workbooks/${EDIT_ID}`;
  render(<App />);
  await grid();

  const dialog = await openValidationDialog(user, "L4");
  const messageField = within(dialog).getByLabelText("Error message") as HTMLInputElement;
  expect(messageField.value).toBe(CAPACITY_MESSAGE);
  await user.clear(messageField);
  await user.type(messageField, "Allocate between 25 and 75");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data validation" })).toBeNull());
  expect(storedRule("L4")).toEqual({
    range: "L4",
    type: "number-range",
    min: 25,
    max: 75,
    errorMessage: "Allocate between 25 and 75",
  });

  await selectCell("L4");
  const bar = screen.getByRole("textbox", { name: "Formula bar" });
  await user.clear(bar);
  await user.type(bar, "24{Enter}");
  expect((await screen.findByRole("alert")).textContent).toBe("Allocate between 25 and 75");
  expect(screen.getByRole("gridcell", { name: "L4" }).textContent).toBe("42");
  expect(api!.workbooks[0].worksheets[0].cells.L4).toBe("42");

  // Reopening the rule after a refresh shows the updated message.
  cleanup();
  render(<App />);
  await grid();
  const reopened = await openValidationDialog(user, "L4");
  expect((within(reopened).getByLabelText("Error message") as HTMLInputElement).value).toBe(
    "Allocate between 25 and 75",
  );
});
