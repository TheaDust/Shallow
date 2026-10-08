import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import { installFakeApi, type FakeApi } from "./test/fake-api";

const FIND_NEXT_ID = "EVO-N02-FIND-NEXT";
const REPLACE_ALL_ID = "EVO-N02-REPLACE-ALL";
const CASE_ID = "EVO-N02-CASE-SENSITIVE";

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

function sheet(id: string) {
  return api!.workbooks.find((workbook) => workbook.id === id)!.worksheets[0];
}

/** The coordinate of the single selected cell, or `null` for another rectangle. */
function selectedCell(): string | null {
  const selected = screen
    .queryAllByRole("gridcell")
    .filter((cell) => cell.getAttribute("aria-selected") === "true");
  return selected.length === 1 ? selected[0].getAttribute("aria-label") : null;
}

async function selectCell(name: string) {
  const target = await screen.findByRole("gridcell", { name });
  fireEvent.mouseDown(target);
  fireEvent.mouseUp(target);
  return target;
}

async function openFindReplace(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Edit" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Find and replace" }));
  return screen.findByRole("dialog", { name: "Find and replace" });
}

/** Reopens the workbook from its address, as a browser refresh does. */
async function refresh() {
  cleanup();
  render(<App />);
  await grid();
}

test("Find next walks to the second matching cell and reports 'Match 2 of 3'", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${FIND_NEXT_ID}`;
  render(<App />);
  await grid();

  await selectCell("A1");
  const dialog = await openFindReplace(user);
  await user.type(within(dialog).getByLabelText("Find"), "Cobalt");

  await user.click(within(dialog).getByRole("button", { name: "Find next" }));
  expect(within(dialog).getByRole("status").textContent).toBe("Match 1 of 3");
  expect(selectedCell()).toBe("E4");

  await user.click(within(dialog).getByRole("button", { name: "Find next" }));
  expect(within(dialog).getByRole("status").textContent).toBe("Match 2 of 3");
  expect(selectedCell()).toBe("E7");
  await waitFor(() => expect(sheet(FIND_NEXT_ID).selection).toEqual({ anchor: "E7", focus: "E7" }));
  expect(sheet(FIND_NEXT_ID).cells.E11).toBe("Cobalt");
});

test("Replace all rewrites every matching cell and keeps them after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${REPLACE_ALL_ID}`;
  render(<App />);
  await grid();

  const dialog = await openFindReplace(user);
  await user.type(within(dialog).getByLabelText("Find"), "Cobalt");
  await user.type(within(dialog).getByLabelText("Replace with"), "Indigo");
  await user.click(within(dialog).getByRole("button", { name: "Replace all" }));

  expect(await within(dialog).findByRole("status")).toHaveTextContent("Replaced 3 cells");
  expect(within(dialog).getByRole("status").textContent).toBe("Replaced 3 cells");
  expect(cellText("F3")).toBe("Indigo");
  expect(cellText("F6")).toBe("Indigo");
  expect(cellText("F9")).toBe("Indigo");
  // The cell that only looked similar keeps its own text.
  expect(cellText("F12")).toBe("Copper");
  expect(sheet(REPLACE_ALL_ID).cells).toEqual({ F3: "Indigo", F6: "Indigo", F9: "Indigo", F12: "Copper" });

  await refresh();
  expect(cellText("F3")).toBe("Indigo");
  expect(cellText("F9")).toBe("Indigo");
  expect(cellText("F12")).toBe("Copper");
});

test("Match case replaces only the exact-case matches and keeps them after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${CASE_ID}`;
  render(<App />);
  await grid();

  const dialog = await openFindReplace(user);
  await user.type(within(dialog).getByLabelText("Find"), "Cobalt");
  await user.type(within(dialog).getByLabelText("Replace with"), "Azure");
  await user.click(within(dialog).getByLabelText("Match case"));
  await user.click(within(dialog).getByRole("button", { name: "Replace all" }));

  expect(await within(dialog).findByRole("status")).toHaveTextContent("Replaced 1 cells");
  expect(cellText("G3")).toBe("Azure");
  expect(cellText("G4")).toBe("cobalt");
  expect(cellText("G5")).toBe("Cobalt-7");

  // The case-sensitive search still matches the lower-case cell exactly.
  await user.clear(within(dialog).getByLabelText("Find"));
  await user.type(within(dialog).getByLabelText("Find"), "cobalt");
  await user.click(within(dialog).getByRole("button", { name: "Find next" }));
  expect(within(dialog).getByRole("status").textContent).toBe("Match 1 of 1");
  expect(selectedCell()).toBe("G4");

  await refresh();
  expect(cellText("G3")).toBe("Azure");
  expect(cellText("G4")).toBe("cobalt");
  expect(cellText("G5")).toBe("Cobalt-7");
  expect(sheet(CASE_ID).cells).toEqual({ G3: "Azure", G4: "cobalt", G5: "Cobalt-7" });
});

test("a rejected Replace all reports the error and keeps the last successful values", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${REPLACE_ALL_ID}`;
  render(<App />);
  await grid();

  const dialog = await openFindReplace(user);
  await user.type(within(dialog).getByLabelText("Find"), "Cobalt");
  await user.type(within(dialog).getByLabelText("Replace with"), "Indigo");
  api.failOnce(
    "POST",
    `/api/workbooks/${REPLACE_ALL_ID}/worksheets/${REPLACE_ALL_ID}--Narrative/cells/updates`,
  );
  await user.click(within(dialog).getByRole("button", { name: "Replace all" }));

  await waitFor(() =>
    expect(within(dialog).getByRole("alert").textContent).toBe("Server error"),
  );
  expect(within(dialog).queryByRole("status")).toBeNull();
  expect(cellText("F3")).toBe("Cobalt");
  expect(cellText("F6")).toBe("Cobalt");
  expect(sheet(REPLACE_ALL_ID).cells.F3).toBe("Cobalt");
});
