import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import type { Workbook } from "./domain/types";
import { installFakeApi, type FakeApi } from "./test/fake-api";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

/** One pre-provisioned workbook of the find scenarios, keyed by stable id. */
function narrativeWorkbook(id: string, cells: Record<string, string>): Workbook {
  const worksheetId = `ws-${id}`;
  return {
    id,
    name: id,
    createdAt: "2026-10-06T09:00:00.000Z",
    updatedAt: "2026-10-06T09:00:00.000Z",
    activeWorksheetId: worksheetId,
    worksheets: [{ id: worksheetId, name: "Narrative", selection: { anchor: "A1", focus: "A1" }, cells }],
  };
}

/** Opens a pre-provisioned workbook through its deep link. */
function open(workbook: Workbook) {
  window.location.hash = `#/workbooks/${workbook.id}`;
  api = installFakeApi([workbook]);
  return render(<App />);
}

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

/** Opens "Find and replace" through the Edit menu, as the scenarios do. */
async function openFindReplace(user: ReturnType<typeof userEvent.setup>) {
  await grid();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Find and replace" }));
  return screen.findByRole("dialog", { name: "Find and replace" });
}

test("Find next walks the matches in order and reports 'Match 2 of 3'", async () => {
  open(narrativeWorkbook("EVO-N02-FIND-NEXT", { E4: "Cobalt", E7: "Cobalt", E11: "Cobalt" }));
  const user = userEvent.setup();
  await grid();
  await user.click(screen.getByRole("gridcell", { name: "A1" }));

  const dialog = await openFindReplace(user);
  await user.type(within(dialog).getByRole("textbox", { name: "Find" }), "Cobalt");

  await user.click(within(dialog).getByRole("button", { name: "Find next" }));
  expect(screen.getByRole("gridcell", { name: "E4" }).getAttribute("aria-selected")).toBe("true");
  expect(within(dialog).getByText("Match 1 of 3")).toBeTruthy();

  await user.click(within(dialog).getByRole("button", { name: "Find next" }));
  expect(screen.getByRole("gridcell", { name: "E7" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "E4" }).getAttribute("aria-selected")).toBe("false");
  expect(within(dialog).getByText("Match 2 of 3")).toBeTruthy();

  // Only the matching cells are visited, and the selection is the stored one.
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].selection).toEqual({ anchor: "E7", focus: "E7" }));
});

test("Replace all rewrites the whole-value matches and keeps them after a refresh", async () => {
  const view = open(
    narrativeWorkbook("EVO-N02-REPLACE-ALL", {
      F3: "Cobalt",
      F6: "Cobalt",
      F9: "Cobalt",
      F12: "Copper",
    }),
  );
  const user = userEvent.setup();
  const dialog = await openFindReplace(user);
  await user.type(within(dialog).getByRole("textbox", { name: "Find" }), "Cobalt");
  await user.type(within(dialog).getByRole("textbox", { name: "Replace with" }), "Indigo");

  await user.click(within(dialog).getByRole("button", { name: "Replace all" }));

  expect(await within(dialog).findByText("Replaced 3 cells")).toBeTruthy();
  for (const coordinate of ["F3", "F6", "F9"]) {
    expect(screen.getByRole("gridcell", { name: coordinate }).textContent).toBe("Indigo");
  }
  expect(screen.getByRole("gridcell", { name: "F12" }).textContent).toBe("Copper");

  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getByRole("gridcell", { name: "F12" }).textContent).toBe("Copper");
  for (const coordinate of ["F3", "F6", "F9"]) {
    expect(screen.getByRole("gridcell", { name: coordinate }).textContent).toBe("Indigo");
  }
});

test("Match case replaces only the exactly matching cell", async () => {
  const view = open(
    narrativeWorkbook("EVO-N02-CASE-SENSITIVE", { G3: "Cobalt", G4: "cobalt", G5: "Cobalt-7" }),
  );
  const user = userEvent.setup();
  const dialog = await openFindReplace(user);
  await user.type(within(dialog).getByRole("textbox", { name: "Find" }), "Cobalt");
  await user.type(within(dialog).getByRole("textbox", { name: "Replace with" }), "Azure");
  await user.click(within(dialog).getByRole("checkbox", { name: "Match case" }));

  await user.click(within(dialog).getByRole("button", { name: "Replace all" }));

  expect(await within(dialog).findByText("Replaced 1 cells")).toBeTruthy();
  expect(screen.getByRole("gridcell", { name: "G3" }).textContent).toBe("Azure");
  expect(screen.getByRole("gridcell", { name: "G4" }).textContent).toBe("cobalt");
  expect(screen.getByRole("gridcell", { name: "G5" }).textContent).toBe("Cobalt-7");

  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getByRole("gridcell", { name: "G3" }).textContent).toBe("Azure");
  expect(screen.getByRole("gridcell", { name: "G4" }).textContent).toBe("cobalt");
  expect(screen.getByRole("gridcell", { name: "G5" }).textContent).toBe("Cobalt-7");
});

test("a rejected replacement reports the failure inside the dialog and keeps every value", async () => {
  open(narrativeWorkbook("EVO-N02-REPLACE-ALL", { F3: "Cobalt", F12: "Copper" }));
  const user = userEvent.setup();
  const dialog = await openFindReplace(user);
  await user.type(within(dialog).getByRole("textbox", { name: "Find" }), "Cobalt");
  await user.type(within(dialog).getByRole("textbox", { name: "Replace with" }), "Indigo");

  api!.failOnce("POST", "/api/workbooks/EVO-N02-REPLACE-ALL/worksheets/ws-EVO-N02-REPLACE-ALL/replace");
  await user.click(within(dialog).getByRole("button", { name: "Replace all" }));

  expect((await within(dialog).findByRole("alert")).textContent).toBe("Server error");
  expect(screen.getByRole("gridcell", { name: "F3" }).textContent).toBe("Cobalt");
  expect(api!.workbooks[0].worksheets[0].cells.F3).toBe("Cobalt");
});
