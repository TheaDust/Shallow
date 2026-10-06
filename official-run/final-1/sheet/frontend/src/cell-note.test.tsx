import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import {
  EVO_NOTE_CREATE_WORKBOOK_ID,
  EVO_NOTE_DELETE_TEXT,
  EVO_NOTE_DELETE_WORKBOOK_ID,
  EVO_NOTE_EDIT_TEXT,
  EVO_NOTE_EDIT_WORKBOOK_ID,
  installFakeApi,
  type FakeApi,
} from "./test/fake-api";

type User = ReturnType<typeof userEvent.setup>;

const CREATE_TEXT = "Confirm the harbor reference before release";
const EDITED_TEXT = "Controller signed at 14:20";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

async function cell(name: string) {
  await grid();
  return screen.getByRole("gridcell", { name });
}

/** Selects `coordinate` and opens its note form through "Insert" > "Add note". */
async function addNote(user: User, coordinate: string) {
  await user.click(await cell(coordinate));
  await user.click(await screen.findByRole("button", { name: "Insert" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Add note" }));
  return screen.findByRole("dialog", { name: `Note for ${coordinate}` });
}

/** Opens the note of a cell through the button the note adds to that cell. */
async function openNote(coordinate: string) {
  const button = await screen.findByRole("button", { name: `Open note for ${coordinate}` });
  await userEvent.setup().click(button);
  return screen.findByRole("dialog", { name: `Note for ${coordinate}` });
}

function notesOf(workbookId: string) {
  const workbook = api!.workbooks.find((candidate) => candidate.id === workbookId)!;
  return workbook.worksheets[0].notes;
}

test("REQ-8-1-1 saving a note adds its open button and keeps the cell value, also after a refresh", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_NOTE_CREATE_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  expect((await cell("D8")).textContent).toBe("Manifest R41");
  expect(screen.queryByRole("button", { name: "Open note for D8" })).toBeNull();

  const dialog = await addNote(user, "D8");
  expect(within(dialog).queryByRole("button", { name: "Edit note" })).toBeNull();
  await user.type(within(dialog).getByLabelText("Note"), CREATE_TEXT);
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for D8" })).toBeNull());

  expect(screen.getByRole("gridcell", { name: "D8" }).textContent).toBe("Manifest R41");
  expect(screen.queryByRole("button", { name: "Open note for D9" })).toBeNull();
  expect(notesOf(EVO_NOTE_CREATE_WORKBOOK_ID)).toEqual({ D8: CREATE_TEXT });

  const opened = await openNote("D8");
  expect(within(opened).getByText(CREATE_TEXT)).toBeTruthy();
  await user.click(within(opened).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for D8" })).toBeNull());

  // Reopening the workbook keeps the note, its open button and its exact text.
  view.unmount();
  render(<App />);
  expect((await cell("D8")).textContent).toBe("Manifest R41");
  const afterRefresh = await openNote("D8");
  expect(within(afterRefresh).getByText(CREATE_TEXT)).toBeTruthy();
});

test("REQ-8-1-1 an existing note is edited in place and the new text survives a refresh", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_NOTE_EDIT_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  expect((await cell("F6")).textContent).toBe("Gate Rho");
  // "Add note" on a cell that already has one shows the stored note with its
  // own Edit and Delete commands.
  const viaMenu = await addNote(user, "F6");
  expect(within(viaMenu).getByText(EVO_NOTE_EDIT_TEXT)).toBeTruthy();
  expect(within(viaMenu).getByRole("button", { name: "Edit note" })).toBeTruthy();
  expect(within(viaMenu).getByRole("button", { name: "Delete note" })).toBeTruthy();
  await user.click(within(viaMenu).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for F6" })).toBeNull());

  const dialog = await openNote("F6");
  expect(within(dialog).getByText(EVO_NOTE_EDIT_TEXT)).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Edit note" }));
  const field = within(dialog).getByLabelText("Note");
  await user.clear(field);
  await user.type(field, EDITED_TEXT);
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for F6" })).toBeNull());

  expect(screen.getByRole("gridcell", { name: "F6" }).textContent).toBe("Gate Rho");
  expect(notesOf(EVO_NOTE_EDIT_WORKBOOK_ID)).toEqual({ F6: EDITED_TEXT });

  const reopened = await openNote("F6");
  expect(within(reopened).getByText(EDITED_TEXT)).toBeTruthy();
  await user.click(within(reopened).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for F6" })).toBeNull());

  view.unmount();
  render(<App />);
  expect((await cell("F6")).textContent).toBe("Gate Rho");
  const afterRefresh = await openNote("F6");
  expect(within(afterRefresh).getByText(EDITED_TEXT)).toBeTruthy();
  expect(within(afterRefresh).queryByText(EVO_NOTE_EDIT_TEXT)).toBeNull();
});

test("REQ-8-1-1 deleting a note removes the note and its open button but keeps the cell, also after a refresh", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_NOTE_DELETE_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  expect((await cell("J3")).textContent).toBe("Route Zeta");
  const dialog = await openNote("J3");
  expect(within(dialog).getByText(EVO_NOTE_DELETE_TEXT)).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Delete note" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for J3" })).toBeNull());

  expect(screen.queryByRole("button", { name: "Open note for J3" })).toBeNull();
  expect(screen.getByRole("gridcell", { name: "J3" }).textContent).toBe("Route Zeta");
  expect(notesOf(EVO_NOTE_DELETE_WORKBOOK_ID)).toBeUndefined();

  view.unmount();
  render(<App />);
  expect((await cell("J3")).textContent).toBe("Route Zeta");
  expect(screen.queryByRole("button", { name: "Open note for J3" })).toBeNull();
});

test("REQ-8-1-1 a rejected save reports the error and keeps the last stored state", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_NOTE_CREATE_WORKBOOK_ID}`;
  api = installFakeApi();
  render(<App />);

  api.failOnce(
    "PUT",
    `/api/workbooks/${EVO_NOTE_CREATE_WORKBOOK_ID}/worksheets/ws-evo-n05-note-create-review-queue/notes`,
  );
  const dialog = await addNote(user, "D8");
  await user.type(within(dialog).getByLabelText("Note"), CREATE_TEXT);
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));

  const alert = await within(dialog).findByRole("alert");
  expect(alert.textContent).toBe("Server error");
  expect(screen.getByRole("dialog", { name: "Note for D8" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open note for D8" })).toBeNull();
  expect(screen.getByRole("gridcell", { name: "D8" }).textContent).toBe("Manifest R41");
  expect(notesOf(EVO_NOTE_CREATE_WORKBOOK_ID)).toBeUndefined();
});
