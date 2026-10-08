import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import { installFakeApi, type FakeApi } from "./test/fake-api";

const CREATE_ID = "EVO-N05-NOTE-CREATE";
const EDIT_ID = "EVO-N05-NOTE-EDIT";
const DELETE_ID = "EVO-N05-NOTE-DELETE";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function cell(name: string): HTMLElement {
  return screen.getByRole("gridcell", { name });
}

async function openMenuCommand(
  user: ReturnType<typeof userEvent.setup>,
  menu: string,
  item: string,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: menu }));
  const opened = await screen.findByRole("menu");
  await user.click(within(opened).getByRole("menuitem", { name: item }));
}

/** The note dialog of a coordinate, queried fresh so it is never a stale node. */
async function noteDialog(coordinate: string): Promise<HTMLElement> {
  return screen.findByRole("dialog", { name: `Note for ${coordinate}` });
}

/** The "Note" box of the open note dialog, whose text is the note's exact text. */
async function noteField(coordinate: string): Promise<HTMLTextAreaElement> {
  const dialog = await noteDialog(coordinate);
  return within(dialog).getByRole("textbox", { name: "Note" }) as HTMLTextAreaElement;
}

function openNoteButton(coordinate: string): HTMLElement | null {
  return screen.queryByRole("button", { name: `Open note for ${coordinate}` });
}

test("a note saved from the Insert menu shows its text and stays after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${CREATE_ID}`;
  const view = render(<App />);
  await grid();

  await user.click(cell("D8"));
  await openMenuCommand(user, "Insert", "Add note");
  const dialog = await noteDialog("D8");
  // A cell without a note offers only the text box and the save action.
  expect(within(dialog).queryByRole("button", { name: "Edit note" })).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Delete note" })).toBeNull();

  await user.type(within(dialog).getByRole("textbox", { name: "Note" }), "Confirm the harbor reference before release");
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for D8" })).toBeNull());

  // The annotated cell keeps its value, and the open button belongs to that cell.
  expect(cell("D8").textContent).toBe("Manifest R41");
  expect(within(cell("D8")).getByRole("button", { name: "Open note for D8" })).toBeTruthy();

  await user.click(openNoteButton("D8")!);
  expect((await noteField("D8")).value).toBe("Confirm the harbor reference before release");

  view.unmount();
  render(<App />);
  await grid();
  expect(cell("D8").textContent).toBe("Manifest R41");
  await user.click(openNoteButton("D8")!);
  expect((await noteField("D8")).value).toBe("Confirm the harbor reference before release");
});

test("editing an existing note replaces its text and keeps the cell value", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${EDIT_ID}`;
  const view = render(<App />);
  await grid();

  await user.click(openNoteButton("F6")!);
  const dialog = await noteDialog("F6");
  const field = within(dialog).getByRole("textbox", { name: "Note" }) as HTMLTextAreaElement;
  expect(field.value).toBe("Awaiting controller sign-off");

  await user.click(within(dialog).getByRole("button", { name: "Edit note" }));
  expect(document.activeElement).toBe(field);
  await user.clear(field);
  await user.type(field, "Controller signed at 14:20");
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for F6" })).toBeNull());

  await user.click(openNoteButton("F6")!);
  expect((await noteField("F6")).value).toBe("Controller signed at 14:20");
  expect(cell("F6").textContent).toBe("Gate Rho");

  view.unmount();
  render(<App />);
  await grid();
  await user.click(openNoteButton("F6")!);
  expect((await noteField("F6")).value).toBe("Controller signed at 14:20");
  expect(cell("F6").textContent).toBe("Gate Rho");
});

test("deleting a note removes it and its open button but keeps the cell value", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${DELETE_ID}`;
  const view = render(<App />);
  await grid();

  await user.click(openNoteButton("J3")!);
  const dialog = await noteDialog("J3");
  await user.click(within(dialog).getByRole("button", { name: "Delete note" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note for J3" })).toBeNull());

  expect(openNoteButton("J3")).toBeNull();
  expect(cell("J3").textContent).toBe("Route Zeta");

  view.unmount();
  render(<App />);
  await grid();
  expect(openNoteButton("J3")).toBeNull();
  expect(cell("J3").textContent).toBe("Route Zeta");
});

test("a failed note save keeps the dialog open with its text and reports the error", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${CREATE_ID}`;
  render(<App />);
  await grid();

  api.failOnce("PUT", `/api/workbooks/${CREATE_ID}/worksheets/${CREATE_ID}--ReviewQueue/notes`);
  await user.click(cell("D8"));
  await openMenuCommand(user, "Insert", "Add note");
  const dialog = await noteDialog("D8");
  const field = within(dialog).getByRole("textbox", { name: "Note" }) as HTMLTextAreaElement;
  await user.type(field, "Confirm the harbor reference before release");
  await user.click(within(dialog).getByRole("button", { name: "Save note" }));

  const alert = await within(dialog).findByRole("alert");
  expect(alert.textContent).toBe("Server error");
  expect(field.value).toBe("Confirm the harbor reference before release");
  expect(openNoteButton("D8")).toBeNull();
});
