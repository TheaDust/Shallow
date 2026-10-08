import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import { installFakeApi, type FakeApi } from "./test/fake-api";

const FORMULA_ID = "EVO-M05-VALIDATION-FORMULA";
const GRID_ID = "EVO-M05-VALIDATION-GRID";
const EDIT_ID = "EVO-M05-VALIDATION-EDIT";
const ORIGINAL_MESSAGE = "Capacity must be from 25 to 75";

let api: FakeApi | undefined;

beforeEach(() => {
  window.location.hash = `#/workbooks/${FORMULA_ID}`;
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function sheet(id: string) {
  return api!.workbooks.find((workbook) => workbook.id === id)!.worksheets[0];
}

function formulaBar() {
  return screen.getByRole("textbox", { name: "Formula bar" });
}

async function openDataValidation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Data validation" }));
  return screen.findByRole("dialog", { name: "Data validation" });
}

test("a number-range rule with a custom message shows it from the formula bar and keeps the value", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  // The scenario pre-provisions J6 with its rule and selects it.
  expect(screen.getByRole("gridcell", { name: "J6" }).textContent).toBe("37");
  expect(sheet(FORMULA_ID).validationRules).toEqual([
    { range: "J6", type: "number-range", min: 25, max: 75, message: ORIGINAL_MESSAGE },
  ]);

  await user.clear(formulaBar());
  await user.type(formulaBar(), "88{Enter}");
  expect((await screen.findByRole("alert")).textContent).toBe(ORIGINAL_MESSAGE);
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "J6" }).textContent).toBe("37"));
  expect(sheet(FORMULA_ID).cells.J6).toBe("37");

  // The refreshed workbook rejects the same entry with the same message.
  cleanup();
  render(<App />);
  await grid();
  await user.clear(formulaBar());
  await user.type(formulaBar(), "88{Enter}");
  expect((await screen.findByRole("alert")).textContent).toBe(ORIGINAL_MESSAGE);
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "J6" }).textContent).toBe("37"));
});

test("a dropdown rule with a custom message rejects a grid edit and keeps the value", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${GRID_ID}`;
  render(<App />);
  await grid();

  expect(screen.getByRole("gridcell", { name: "K8" }).textContent).toBe("Ready");

  await user.dblClick(screen.getByRole("gridcell", { name: "K8" }));
  const editor = await screen.findByRole("textbox", { name: "Edit K8" });
  await user.clear(editor);
  await user.type(editor, "Paused{Enter}");

  expect((await screen.findByRole("alert")).textContent).toBe("Choose a queue state");
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "K8" }).textContent).toBe("Ready"));
  expect(sheet(GRID_ID).cells.K8).toBe("Ready");

  cleanup();
  render(<App />);
  await grid();
  await user.dblClick(screen.getByRole("gridcell", { name: "K8" }));
  const again = await screen.findByRole("textbox", { name: "Edit K8" });
  await user.clear(again);
  await user.type(again, "Paused{Enter}");
  expect((await screen.findByRole("alert")).textContent).toBe("Choose a queue state");
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "K8" }).textContent).toBe("Ready"));
});

test("an updated Error message replaces the standard text immediately and persists after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${EDIT_ID}`;
  render(<App />);
  await grid();

  const dialog = await openDataValidation(user);
  // Reopening a rule prefills its stored custom message.
  expect((within(dialog).getByLabelText("Error message") as HTMLInputElement).value).toBe(ORIGINAL_MESSAGE);
  await user.clear(within(dialog).getByLabelText("Error message"));
  await user.type(within(dialog).getByLabelText("Error message"), "Allocate between 25 and 75");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data validation" })).toBeNull());

  await user.clear(formulaBar());
  await user.type(formulaBar(), "24{Enter}");
  expect((await screen.findByRole("alert")).textContent).toBe("Allocate between 25 and 75");
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "L4" }).textContent).toBe("42"));
  expect(sheet(EDIT_ID).cells.L4).toBe("42");

  cleanup();
  render(<App />);
  await grid();
  const reopened = await openDataValidation(user);
  expect((within(reopened).getByLabelText("Error message") as HTMLInputElement).value).toBe(
    "Allocate between 25 and 75",
  );
  expect(sheet(EDIT_ID).validationRules).toEqual([
    { range: "L4", type: "number-range", min: 25, max: 75, message: "Allocate between 25 and 75" },
  ]);
});
