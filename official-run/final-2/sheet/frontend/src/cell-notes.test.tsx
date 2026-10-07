import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import {
  EVO_NOTE_CREATE_ID,
  EVO_NOTE_DELETE_ID,
  EVO_NOTE_EDIT_ID,
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

async function openWorkbook(id: string) {
  window.location.hash = `#/workbooks/${id}`;
  render(<App />);
  await grid();
}

async function select(anchor: string, focus = anchor) {
  fireEvent.mouseDown(screen.getByRole("gridcell", { name: anchor }));
  fireEvent.mouseOver(screen.getByRole("gridcell", { name: focus }), { buttons: 1 });
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: focus }));
  await waitFor(() => expect(screen.getByRole("gridcell", { name: anchor }).getAttribute("aria-selected")).toBe("true"));
}

/** Opens one command of the "Insert" menu of the editor toolbar. */
async function insertCommand(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole("button", { name: "Insert" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: label }));
}

function noteButton(coordinate: string) {
  return screen.getByRole("button", { name: `Open note for ${coordinate}` });
}

function cellText(coordinate: string) {
  return screen.getByRole("gridcell", { name: coordinate }).textContent;
}

function storedNotes(id: string) {
  return api!.workbooks.find((workbook) => workbook.id === id)!.worksheets[0].notes;
}

test("REQ-8-1-1 - a note is created through Insert and survives a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  await openWorkbook(EVO_NOTE_CREATE_ID);

  // D8 carries no note in the seed, so the cell shows no open button yet.
  expect(screen.queryByRole("button", { name: "Open note for D8" })).toBeNull();

  await select("D8");
  await insertCommand(user, "Add note");
  const dialog = await screen.findByRole("dialog", { name: "Note for D8" });
  await user.type(within(dialog).getByLabelText("Note"), "Confirm the harbor reference before release");
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for D8" })).toBeNull());
  expect(cellText("D8")).toBe("Manifest R41");
  expect(storedNotes(EVO_NOTE_CREATE_ID)).toEqual({ D8: "Confirm the harbor reference before release" });

  // Opening the note displays its exact text.
  await user.click(noteButton("D8"));
  const reopened = await screen.findByRole("dialog", { name: "Note for D8" });
  expect(within(reopened).getByLabelText("Note")).toHaveValue("Confirm the harbor reference before release");
  expect(within(reopened).getByText("Confirm the harbor reference before release")).toBeTruthy();

  // The note is stored on the server, so a refresh keeps it and the cell value.
  cleanup();
  render(<App />);
  await grid();
  expect(cellText("D8")).toBe("Manifest R41");
  await user.click(noteButton("D8"));
  const afterRefresh = await screen.findByRole("dialog", { name: "Note for D8" });
  expect(within(afterRefresh).getByText("Confirm the harbor reference before release")).toBeTruthy();
});

test("REQ-8-1-1 - editing an existing note replaces its text", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  await openWorkbook(EVO_NOTE_EDIT_ID);

  await user.click(noteButton("F6"));
  const dialog = await screen.findByRole("dialog", { name: "Note for F6" });
  expect(within(dialog).getByText("Awaiting controller sign-off")).toBeTruthy();
  expect(within(dialog).getByLabelText("Note")).toHaveValue("Awaiting controller sign-off");

  await user.click(within(dialog).getByRole("button", { name: "Edit note" }));
  const field = within(dialog).getByLabelText("Note");
  await user.clear(field);
  await user.type(field, "Controller signed at 14:20");
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for F6" })).toBeNull());
  expect(cellText("F6")).toBe("Gate Rho");
  expect(storedNotes(EVO_NOTE_EDIT_ID)).toEqual({ F6: "Controller signed at 14:20" });

  await user.click(noteButton("F6"));
  const reopened = await screen.findByRole("dialog", { name: "Note for F6" });
  expect(within(reopened).getByText("Controller signed at 14:20")).toBeTruthy();
  expect(within(reopened).queryByText("Awaiting controller sign-off")).toBeNull();

  cleanup();
  render(<App />);
  await grid();
  expect(cellText("F6")).toBe("Gate Rho");
  await user.click(noteButton("F6"));
  const afterRefresh = await screen.findByRole("dialog", { name: "Note for F6" });
  expect(within(afterRefresh).getByText("Controller signed at 14:20")).toBeTruthy();
});

test("REQ-8-1-1 - deleting a note removes it with its open button", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  await openWorkbook(EVO_NOTE_DELETE_ID);

  await user.click(noteButton("J3"));
  const dialog = await screen.findByRole("dialog", { name: "Note for J3" });
  expect(within(dialog).getByText("Retire after audit")).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Delete note" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for J3" })).toBeNull());
  expect(screen.queryByRole("button", { name: "Open note for J3" })).toBeNull();
  expect(cellText("J3")).toBe("Route Zeta");
  expect(storedNotes(EVO_NOTE_DELETE_ID)).toBeUndefined();

  cleanup();
  render(<App />);
  await grid();
  expect(cellText("J3")).toBe("Route Zeta");
  expect(screen.queryByRole("button", { name: "Open note for J3" })).toBeNull();
});

test("REQ-8-1-1 - an empty note is rejected and the dialog keeps the stored note", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  await openWorkbook(EVO_NOTE_EDIT_ID);

  await user.click(noteButton("F6"));
  const dialog = await screen.findByRole("dialog", { name: "Note for F6" });
  await user.clear(within(dialog).getByLabelText("Note"));
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));

  const alert = await within(dialog).findByRole("alert");
  expect(alert.textContent).toBe("Note cannot be empty");
  expect(within(dialog).getByText("Awaiting controller sign-off")).toBeTruthy();
  expect(storedNotes(EVO_NOTE_EDIT_ID)).toEqual({ F6: "Awaiting controller sign-off" });
  expect(cellText("F6")).toBe("Gate Rho");
});

test("REQ-8-1-1 - \"Add note\" of a noted cell shows the stored note with its buttons", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  await openWorkbook(EVO_NOTE_DELETE_ID);

  await select("J3");
  await insertCommand(user, "Add note");
  const dialog = await screen.findByRole("dialog", { name: "Note for J3" });
  expect(within(dialog).getByText("Retire after audit")).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Edit note" })).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Delete note" })).toBeTruthy();
  // Closing without saving keeps the stored note and the cell value.
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for J3" })).toBeNull());
  expect(storedNotes(EVO_NOTE_DELETE_ID)).toEqual({ J3: "Retire after audit" });
  expect(cellText("J3")).toBe("Route Zeta");
  expect(noteButton("J3")).toBeTruthy();
});
