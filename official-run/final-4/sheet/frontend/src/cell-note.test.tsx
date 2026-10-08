import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import type { Workbook } from "./domain/types";
import { installFakeApi, type FakeApi } from "./test/fake-api";

/** Stable ids of the pre-provisioned cell-note workbooks (see the backend seed). */
export const NOTE_CREATE_WORKBOOK_ID = "EVO-N05-NOTE-CREATE";
export const NOTE_CREATE_WORKSHEET_ID = "ws-evo-n05-note-create-reviewqueue";
export const NOTE_EDIT_WORKBOOK_ID = "EVO-N05-NOTE-EDIT";
export const NOTE_EDIT_WORKSHEET_ID = "ws-evo-n05-note-edit-reviewqueue";
export const NOTE_DELETE_WORKBOOK_ID = "EVO-N05-NOTE-DELETE";
export const NOTE_DELETE_WORKSHEET_ID = "ws-evo-n05-note-delete-reviewqueue";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

/** One pre-provisioned `ReviewQueue` workbook whose visible name equals its id. */
function reviewQueueWorkbook(
  id: string,
  worksheetId: string,
  cells: Record<string, string>,
  notes?: Record<string, string>,
): Workbook {
  return {
    id,
    name: id,
    createdAt: "2026-09-05T10:05:00.000Z",
    updatedAt: "2026-09-06T10:05:00.000Z",
    activeWorksheetId: worksheetId,
    worksheets: [
      {
        id: worksheetId,
        name: "ReviewQueue",
        selection: { anchor: "A1", focus: "A1" },
        cells,
        ...(notes ? { notes } : {}),
      },
    ],
  };
}

function noteCreateWorkbook(): Workbook {
  return reviewQueueWorkbook(NOTE_CREATE_WORKBOOK_ID, NOTE_CREATE_WORKSHEET_ID, { D8: "Manifest R41" });
}

function noteEditWorkbook(): Workbook {
  return reviewQueueWorkbook(NOTE_EDIT_WORKBOOK_ID, NOTE_EDIT_WORKSHEET_ID, { F6: "Gate Rho" }, {
    F6: "Awaiting controller sign-off",
  });
}

function noteDeleteWorkbook(): Workbook {
  return reviewQueueWorkbook(NOTE_DELETE_WORKBOOK_ID, NOTE_DELETE_WORKSHEET_ID, { J3: "Route Zeta" }, {
    J3: "Retire after audit",
  });
}

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function cell(name: string): HTMLElement {
  return screen.getByRole("gridcell", { name });
}

function openButton(coordinate: string): HTMLElement {
  return screen.getByRole("button", { name: `Open note for ${coordinate}` });
}

/** Opens one pre-provisioned workbook through its deep link. */
function openWorkbook(book: Workbook) {
  window.location.hash = `#/workbooks/${book.id}`;
  api = installFakeApi([book]);
  return render(<App />);
}

/** Opens the "Add note" dialog through the "Insert" menu of the selected cell. */
async function addNote(user: ReturnType<typeof userEvent.setup>, coordinate: string) {
  await user.click(screen.getByRole("button", { name: "Insert" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Add note" }));
  return screen.findByRole("dialog", { name: `Note for ${coordinate}` });
}

test("a saved note keeps the cell value, gets an open button and survives a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi([noteCreateWorkbook()]);
  window.location.hash = "#/";
  const view = render(<App />);

  // The visitor opens the workbook from the home page list.
  await user.click(await screen.findByRole("link", { name: NOTE_CREATE_WORKBOOK_ID }));
  await grid();
  await user.click(cell("D8"));
  expect(cell("D8").textContent).toBe("Manifest R41");
  expect(screen.queryByRole("button", { name: "Open note for D8" })).toBeNull();

  const dialog = await addNote(user, "D8");
  // A cell without a note offers neither "Edit note" nor "Delete note".
  expect(within(dialog).queryByRole("button", { name: "Edit note" })).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Delete note" })).toBeNull();
  await user.type(within(dialog).getByLabelText("Note"), "Confirm the harbor reference before release");
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for D8" })).toBeNull());

  expect(cell("D8").textContent).toBe("Manifest R41");
  expect(api.workbooks[0].worksheets[0].notes).toEqual({ D8: "Confirm the harbor reference before release" });

  await user.click(openButton("D8"));
  const opened = await screen.findByRole("dialog", { name: "Note for D8" });
  expect(within(opened).getByText("Confirm the harbor reference before release")).toBeTruthy();
  expect((within(opened).getByLabelText("Note") as HTMLTextAreaElement).value).toBe(
    "Confirm the harbor reference before release",
  );
  await user.click(within(opened).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for D8" })).toBeNull());

  // The note and its open button remain after a refresh, and the cell keeps
  // displaying its value.
  view.unmount();
  render(<App />);
  await grid();
  expect(cell("D8").textContent).toBe("Manifest R41");
  await user.click(openButton("D8"));
  const reopened = await screen.findByRole("dialog", { name: "Note for D8" });
  expect(within(reopened).getByText("Confirm the harbor reference before release")).toBeTruthy();
});

test("editing an existing note replaces its text and keeps the cell value", async () => {
  const user = userEvent.setup();
  const view = openWorkbook(noteEditWorkbook());
  await grid();

  expect(cell("F6").textContent).toBe("Gate Rho");
  await user.click(openButton("F6"));
  const dialog = await screen.findByRole("dialog", { name: "Note for F6" });
  expect(within(dialog).getByText("Awaiting controller sign-off")).toBeTruthy();

  await user.click(within(dialog).getByRole("button", { name: "Edit note" }));
  const field = within(dialog).getByLabelText("Note");
  expect((field as HTMLTextAreaElement).value).toBe("Awaiting controller sign-off");
  await user.clear(field);
  await user.type(field, "Controller signed at 14:20");
  expect((field as HTMLTextAreaElement).value).toBe("Controller signed at 14:20");
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for F6" })).toBeNull());

  expect(api!.workbooks[0].worksheets[0].notes).toEqual({ F6: "Controller signed at 14:20" });
  expect(cell("F6").textContent).toBe("Gate Rho");

  view.unmount();
  render(<App />);
  await grid();
  expect(cell("F6").textContent).toBe("Gate Rho");
  await user.click(openButton("F6"));
  const reopened = await screen.findByRole("dialog", { name: "Note for F6" });
  expect(within(reopened).getByText("Controller signed at 14:20")).toBeTruthy();
});

test("deleting a note removes the note and its open button but keeps the cell value", async () => {
  const user = userEvent.setup();
  const view = openWorkbook(noteDeleteWorkbook());
  await grid();

  expect(cell("J3").textContent).toBe("Route Zeta");
  await user.click(openButton("J3"));
  const dialog = await screen.findByRole("dialog", { name: "Note for J3" });
  expect(within(dialog).getByText("Retire after audit")).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Delete note" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for J3" })).toBeNull());

  expect(screen.queryByRole("button", { name: "Open note for J3" })).toBeNull();
  expect(cell("J3").textContent).toBe("Route Zeta");
  expect(api!.workbooks[0].worksheets[0].notes).toBeUndefined();

  view.unmount();
  render(<App />);
  await grid();
  expect(screen.queryByRole("button", { name: "Open note for J3" })).toBeNull();
  expect(cell("J3").textContent).toBe("Route Zeta");
});

test("a rejected save reports its message and stores no note", async () => {
  const user = userEvent.setup();
  openWorkbook(noteCreateWorkbook());
  await grid();
  await user.click(cell("D8"));

  const dialog = await addNote(user, "D8");
  await user.type(within(dialog).getByLabelText("Note"), "Confirm the harbor reference before release");
  api!.failOnce("PUT", `/api/workbooks/${NOTE_CREATE_WORKBOOK_ID}/worksheets/${NOTE_CREATE_WORKSHEET_ID}/notes`);
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Server error");
  expect(screen.getByRole("dialog", { name: "Note for D8" })).toBeTruthy();
  expect(api!.workbooks[0].worksheets[0].notes).toBeUndefined();
  expect(cell("D8").textContent).toBe("Manifest R41");
  expect(screen.queryByRole("button", { name: "Open note for D8" })).toBeNull();

  // The dialog stays usable: the same text is saved on the next attempt.
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for D8" })).toBeNull());
  expect(api!.workbooks[0].worksheets[0].notes).toEqual({ D8: "Confirm the harbor reference before release" });
  expect(screen.getByRole("button", { name: "Open note for D8" })).toBeTruthy();
});

test("a note is required and a blank one is not stored", async () => {
  const user = userEvent.setup();
  openWorkbook(noteCreateWorkbook());
  await grid();
  await user.click(cell("D8"));

  const dialog = await addNote(user, "D8");
  await user.type(within(dialog).getByLabelText("Note"), "   ");
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Note text cannot be empty");
  expect(api!.workbooks[0].worksheets[0].notes).toBeUndefined();
  expect(screen.getByRole("dialog", { name: "Note for D8" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open note for D8" })).toBeNull();
});
