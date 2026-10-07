import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import {
  EVO_CASE_SENSITIVE_ID,
  EVO_FIND_NEXT_ID,
  EVO_REPLACE_ALL_ID,
  installFakeApi,
  type FakeApi,
} from "./test/fake-api";

let api: FakeApi | undefined;

beforeEach(() => {
  window.location.hash = `#/workbooks/${EVO_FIND_NEXT_ID}`;
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

/** Opens one independent `EVO-N02-*` workbook and renders its editor. */
function openWorkbook(id: string) {
  window.location.hash = `#/workbooks/${id}`;
  return render(<App />);
}

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

/** Opens "Find and replace" from the "Edit" menu. */
async function openFindReplace(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Edit" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Find and replace" }));
  return screen.findByRole("dialog", { name: "Find and replace" });
}

/** Selected state of one grid cell. */
function selected(name: string): string | null {
  return screen.getByRole("gridcell", { name }).getAttribute("aria-selected");
}

const storedSheet = (id: string) => api!.workbooks.find((workbook) => workbook.id === id)!.worksheets[0];

test("find next walks through the matches and reports the reached one", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  openWorkbook(EVO_FIND_NEXT_ID);
  await grid();

  await user.click(screen.getByRole("gridcell", { name: "A1" }));
  const dialog = await openFindReplace(user);
  expect(within(dialog).getByLabelText("Find")).toBeTruthy();
  expect(within(dialog).getByLabelText("Replace with")).toBeTruthy();
  expect(within(dialog).getByRole("checkbox", { name: "Match case" })).toBeTruthy();

  await user.type(within(dialog).getByLabelText("Find"), "Cobalt");
  await user.click(within(dialog).getByRole("button", { name: "Find next" }));
  await waitFor(() => expect(selected("E4")).toBe("true"));
  expect(within(dialog).getByRole("status").textContent).toBe("Match 1 of 3");

  await user.click(within(dialog).getByRole("button", { name: "Find next" }));
  await waitFor(() => expect(selected("E7")).toBe("true"));
  expect(within(dialog).getByRole("status").textContent).toBe("Match 2 of 3");
  expect(selected("E4")).toBe("false");
});

test("replace all changes every matching cell and persists after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  openWorkbook(EVO_REPLACE_ALL_ID);
  await grid();

  const dialog = await openFindReplace(user);
  await user.type(within(dialog).getByLabelText("Find"), "Cobalt");
  await user.type(within(dialog).getByLabelText("Replace with"), "Indigo");
  await user.click(within(dialog).getByRole("button", { name: "Replace all" }));

  await waitFor(() => expect(within(dialog).getByRole("status").textContent).toBe("Replaced 3 cells"));
  expect(screen.getByRole("gridcell", { name: "F3" }).textContent).toBe("Indigo");
  expect(screen.getByRole("gridcell", { name: "F6" }).textContent).toBe("Indigo");
  expect(screen.getByRole("gridcell", { name: "F9" }).textContent).toBe("Indigo");
  // A cell that does not match keeps its value.
  expect(screen.getByRole("gridcell", { name: "F12" }).textContent).toBe("Copper");
  expect(storedSheet(EVO_REPLACE_ALL_ID).cells.F12).toBe("Copper");

  cleanup();
  openWorkbook(EVO_REPLACE_ALL_ID);
  await grid();
  expect(screen.getByRole("gridcell", { name: "F3" }).textContent).toBe("Indigo");
  expect(screen.getByRole("gridcell", { name: "F6" }).textContent).toBe("Indigo");
  expect(screen.getByRole("gridcell", { name: "F9" }).textContent).toBe("Indigo");
  expect(screen.getByRole("gridcell", { name: "F12" }).textContent).toBe("Copper");
});

test("match case replaces only the exact-case matches and persists", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  openWorkbook(EVO_CASE_SENSITIVE_ID);
  await grid();

  const dialog = await openFindReplace(user);
  await user.type(within(dialog).getByLabelText("Find"), "Cobalt");
  await user.type(within(dialog).getByLabelText("Replace with"), "Azure");
  await user.click(within(dialog).getByRole("checkbox", { name: "Match case" }));
  await user.click(within(dialog).getByRole("button", { name: "Replace all" }));

  await waitFor(() => expect(within(dialog).getByRole("status").textContent).toBe("Replaced 1 cells"));
  expect(screen.getByRole("gridcell", { name: "G3" }).textContent).toBe("Azure");
  expect(screen.getByRole("gridcell", { name: "G4" }).textContent).toBe("cobalt");
  expect(screen.getByRole("gridcell", { name: "G5" }).textContent).toBe("Cobalt-7");
  expect(storedSheet(EVO_CASE_SENSITIVE_ID).cells).toEqual({ G3: "Azure", G4: "cobalt", G5: "Cobalt-7" });

  cleanup();
  openWorkbook(EVO_CASE_SENSITIVE_ID);
  await grid();
  expect(screen.getByRole("gridcell", { name: "G3" }).textContent).toBe("Azure");
  expect(screen.getByRole("gridcell", { name: "G4" }).textContent).toBe("cobalt");
  expect(screen.getByRole("gridcell", { name: "G5" }).textContent).toBe("Cobalt-7");
});

test("an unchecked match case also matches another casing, and a partial value never matches", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  openWorkbook(EVO_CASE_SENSITIVE_ID);
  await grid();

  await user.click(screen.getByRole("gridcell", { name: "A1" }));
  const dialog = await openFindReplace(user);
  // Without "Match case" both `Cobalt` and `cobalt` match; `Cobalt-7` does not,
  // because a cell matches only when its whole displayed value equals the text.
  await user.type(within(dialog).getByLabelText("Find"), "COBALT");
  await user.click(within(dialog).getByRole("button", { name: "Find next" }));
  await waitFor(() => expect(within(dialog).getByRole("status").textContent).toBe("Match 1 of 2"));
  await user.click(within(dialog).getByRole("button", { name: "Find next" }));
  await waitFor(() => expect(within(dialog).getByRole("status").textContent).toBe("Match 2 of 2"));
  expect(selected("G5")).toBe("false");

  await user.clear(within(dialog).getByLabelText("Find"));
  await user.type(within(dialog).getByLabelText("Find"), "Cobalt-7");
  await user.click(within(dialog).getByRole("button", { name: "Find next" }));
  await waitFor(() => expect(selected("G5")).toBe("true"));
  expect(within(dialog).getByRole("status").textContent).toBe("Match 1 of 1");
});
