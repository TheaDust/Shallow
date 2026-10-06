import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import {
  EVO_CASE_SENSITIVE_WORKBOOK_ID,
  EVO_FIND_NEXT_WORKBOOK_ID,
  EVO_REPLACE_ALL_WORKBOOK_ID,
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

function cellText(name: string): string | null {
  return screen.queryByRole("gridcell", { name })?.textContent ?? null;
}

function storedCells(workbookId: string): Record<string, string> {
  return api!.workbooks.find((workbook) => workbook.id === workbookId)!.worksheets[0].cells;
}

/** Opens "Find and replace" from the "Edit" menu. */
async function openFindReplace(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Edit" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Find and replace" }));
  return screen.findByRole("dialog", { name: "Find and replace" });
}

test("REQ-6-2-1 Find next walks the matching cells and reports the current match", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_FIND_NEXT_WORKBOOK_ID}`;
  api = installFakeApi();
  render(<App />);
  await grid();

  const dialog = await openFindReplace(user);
  await user.type(within(dialog).getByLabelText("Find"), "Cobalt");

  await user.click(within(dialog).getByRole("button", { name: "Find next" }));
  await waitFor(() =>
    expect(screen.getByRole("gridcell", { name: "E4" }).getAttribute("aria-selected")).toBe("true"),
  );
  expect(within(dialog).getByText("Match 1 of 3")).toBeTruthy();

  await user.click(within(dialog).getByRole("button", { name: "Find next" }));
  await waitFor(() =>
    expect(screen.getByRole("gridcell", { name: "E7" }).getAttribute("aria-selected")).toBe("true"),
  );
  expect(within(dialog).getByRole("status").textContent).toBe("Match 2 of 3");
  // The dialog stays open and the found cell is the stored selection.
  expect(screen.getByRole("dialog", { name: "Find and replace" })).toBeTruthy();
  expect(api!.workbooks.find((workbook) => workbook.id === EVO_FIND_NEXT_WORKBOOK_ID)!.worksheets[0].selection).toEqual({
    anchor: "E7",
    focus: "E7",
  });
});

test("REQ-6-2-1 Replace all rewrites every match of the active worksheet and keeps them after a refresh", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_REPLACE_ALL_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  const dialog = await openFindReplace(user);
  await user.type(within(dialog).getByLabelText("Find"), "Cobalt");
  await user.type(within(dialog).getByLabelText("Replace with"), "Indigo");
  await user.click(within(dialog).getByRole("button", { name: "Replace all" }));

  expect(await within(dialog).findByText("Replaced 3 cells")).toBeTruthy();
  expect(cellText("F3")).toBe("Indigo");
  expect(cellText("F6")).toBe("Indigo");
  expect(cellText("F9")).toBe("Indigo");
  // The non-matching value keeps its text.
  expect(cellText("F12")).toBe("Copper");
  expect(storedCells(EVO_REPLACE_ALL_WORKBOOK_ID)).toEqual({
    F3: "Indigo",
    F6: "Indigo",
    F9: "Indigo",
    F12: "Copper",
  });

  view.unmount();
  render(<App />);
  await grid();
  await waitFor(() => expect(cellText("F3")).toBe("Indigo"));
  expect(cellText("F6")).toBe("Indigo");
  expect(cellText("F9")).toBe("Indigo");
  expect(cellText("F12")).toBe("Copper");
});

test("REQ-6-2-1 Replace all with Match case replaces only the exact-case matches", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_CASE_SENSITIVE_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  // Without "Match case" both spellings would match, so the checkbox is what
  // makes the comparison case-sensitive.
  const dialog = await openFindReplace(user);
  await user.type(within(dialog).getByLabelText("Find"), "Cobalt");
  await user.type(within(dialog).getByLabelText("Replace with"), "Azure");
  await user.click(within(dialog).getByLabelText("Match case"));
  await user.click(within(dialog).getByRole("button", { name: "Replace all" }));

  expect(await within(dialog).findByText("Replaced 1 cells")).toBeTruthy();
  expect(cellText("G3")).toBe("Azure");
  expect(cellText("G4")).toBe("cobalt");
  expect(cellText("G5")).toBe("Cobalt-7");
  expect(storedCells(EVO_CASE_SENSITIVE_WORKBOOK_ID)).toEqual({ G3: "Azure", G4: "cobalt", G5: "Cobalt-7" });

  view.unmount();
  render(<App />);
  await grid();
  await waitFor(() => expect(cellText("G3")).toBe("Azure"));
  expect(cellText("G4")).toBe("cobalt");
  expect(cellText("G5")).toBe("Cobalt-7");
});
