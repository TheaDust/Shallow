import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const CREATE_TEXT = "Confirm the harbor reference before release";
const EDIT_TEXT = "Controller signed at 14:20";
const EDIT_NOTE = "Awaiting controller sign-off";
const DELETE_NOTE = "Retire after audit";

/** Pre-provisioned workbook of the cell-note scenarios. */
function reviewWorkbook(
  id: string,
  cells: Record<string, string>,
  notes?: Record<string, string>,
): Workbook {
  const worksheetId = `ws-${id}`;
  return {
    id,
    name: id,
    createdAt: "2026-10-07T09:00:00.000Z",
    updatedAt: "2026-10-07T09:00:00.000Z",
    activeWorksheetId: worksheetId,
    worksheets: [{ id: worksheetId, name: "ReviewQueue", selection: { anchor: "A1", focus: "A1" }, cells, notes }],
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

/** Text a cell displays, written the same way the grid renders it. */
function cellText(coordinate: string): string {
  return screen.getByRole("gridcell", { name: coordinate }).textContent ?? "";
}

/** The "Note" text box of an open "Note for <coordinate>" dialog. */
function noteField(dialog: HTMLElement): HTMLTextAreaElement {
  return within(dialog).getByRole("textbox", { name: "Note" }) as HTMLTextAreaElement;
}

async function selectCell(coordinate: string) {
  await grid();
  fireEvent.mouseDown(screen.getByRole("gridcell", { name: coordinate }));
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: coordinate }));
}

/** Selects a single cell and opens "Insert" → "Add note". */
async function openAddNote(user: ReturnType<typeof userEvent.setup>, coordinate: string) {
  await selectCell(coordinate);
  await user.click(screen.getByRole("button", { name: "Insert" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Add note" }));
  return screen.findByRole("dialog", { name: `Note for ${coordinate}` });
}

async function closeNoteDialog(coordinate: string) {
  await waitFor(() => expect(screen.queryByRole("dialog", { name: `Note for ${coordinate}` })).toBeNull());
}

test("a new note leaves the cell text and is readable again after a refresh", async () => {
  const user = userEvent.setup();
  open(reviewWorkbook("EVO-N05-NOTE-CREATE", { D8: "Manifest R41" }));

  const dialog = await openAddNote(user, "D8");
  await user.type(noteField(dialog), CREATE_TEXT);
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));
  await closeNoteDialog("D8");

  expect(cellText("D8")).toBe("Manifest R41");
  await user.click(screen.getByRole("button", { name: "Open note for D8" }));
  const reopened = await screen.findByRole("dialog", { name: "Note for D8" });
  expect(within(reopened).getByText(CREATE_TEXT)).toBeTruthy();
  expect(noteField(reopened).value).toBe(CREATE_TEXT);
  await user.click(within(reopened).getByRole("button", { name: "Close" }));
  await closeNoteDialog("D8");

  // A refresh reads the stored note back: the cell keeps its value and the
  // open-note button returns.
  cleanup();
  render(<App />);
  await grid();
  expect(cellText("D8")).toBe("Manifest R41");
  await user.click(screen.getByRole("button", { name: "Open note for D8" }));
  const afterRefresh = await screen.findByRole("dialog", { name: "Note for D8" });
  expect(noteField(afterRefresh).value).toBe(CREATE_TEXT);
});

test("editing a note replaces its text in place and persists", async () => {
  const user = userEvent.setup();
  open(reviewWorkbook("EVO-N05-NOTE-EDIT", { F6: "Gate Rho" }, { F6: EDIT_NOTE }));

  await grid();
  await user.click(screen.getByRole("button", { name: "Open note for F6" }));
  const dialog = await screen.findByRole("dialog", { name: "Note for F6" });
  expect(noteField(dialog).value).toBe(EDIT_NOTE);

  await user.click(within(dialog).getByRole("button", { name: "Edit note" }));
  const field = noteField(dialog);
  await user.clear(field);
  await user.type(field, EDIT_TEXT);
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));
  await closeNoteDialog("F6");

  expect(cellText("F6")).toBe("Gate Rho");

  await user.click(screen.getByRole("button", { name: "Open note for F6" }));
  const reopened = await screen.findByRole("dialog", { name: "Note for F6" });
  expect(within(reopened).getByText(EDIT_TEXT)).toBeTruthy();
  expect(noteField(reopened).value).toBe(EDIT_TEXT);
  expect(within(reopened).queryByText(EDIT_NOTE)).toBeNull();

  cleanup();
  render(<App />);
  await grid();
  expect(cellText("F6")).toBe("Gate Rho");
  await user.click(screen.getByRole("button", { name: "Open note for F6" }));
  const afterRefresh = await screen.findByRole("dialog", { name: "Note for F6" });
  expect(noteField(afterRefresh).value).toBe(EDIT_TEXT);
});

test("deleting a note removes it and its open button but keeps the cell text", async () => {
  const user = userEvent.setup();
  open(reviewWorkbook("EVO-N05-NOTE-DELETE", { J3: "Route Zeta" }, { J3: DELETE_NOTE }));

  await grid();
  await user.click(screen.getByRole("button", { name: "Open note for J3" }));
  const dialog = await screen.findByRole("dialog", { name: "Note for J3" });
  expect(noteField(dialog).value).toBe(DELETE_NOTE);
  await user.click(within(dialog).getByRole("button", { name: "Delete note" }));
  await closeNoteDialog("J3");

  expect(screen.queryByRole("button", { name: "Open note for J3" })).toBeNull();
  expect(cellText("J3")).toBe("Route Zeta");

  cleanup();
  render(<App />);
  await grid();
  expect(screen.queryByRole("button", { name: "Open note for J3" })).toBeNull();
  expect(cellText("J3")).toBe("Route Zeta");
});

test("a cell without a note offers no delete or edit button, and add note annotates the selected cell", async () => {
  const user = userEvent.setup();
  open(reviewWorkbook("EVO-N05-NOTE-CREATE", { D8: "Manifest R41" }));

  const dialog = await openAddNote(user, "D8");
  expect(within(dialog).queryByRole("button", { name: "Edit note" })).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Delete note" })).toBeNull();
  expect(within(dialog).getByRole("button", { name: "Save note" })).toBeTruthy();
  expect(noteField(dialog).value).toBe("");
});
