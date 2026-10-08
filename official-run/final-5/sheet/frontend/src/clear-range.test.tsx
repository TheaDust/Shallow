import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import { installFakeApi, type FakeApi } from "./test/fake-api";

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

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
}

function workbookCells(id: string): Record<string, string> {
  return api!.workbooks.find((workbook) => workbook.id === id)!.worksheets[0].cells;
}

test("Delete clears a selected text cell and the formula bar, and the empty state survives a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = "#/workbooks/EVO-M03-CLEAR-TEXT";
  const view = render(<App />);
  await grid();

  await user.click(await cell("H4"));
  expect(screen.getByRole("gridcell", { name: "H4" }).textContent).toBe("obsolete tag");
  expect(formulaBar().value).toBe("obsolete tag");

  fireEvent.keyDown(window, { key: "Delete" });

  await waitFor(() => expect(screen.getByRole("gridcell", { name: "H4" }).textContent).toBe(""));
  expect(screen.getByRole("gridcell", { name: "H4" }).getAttribute("aria-selected")).toBe("true");
  expect(formulaBar().value).toBe("");
  await waitFor(() => expect(workbookCells("EVO-M03-CLEAR-TEXT").H4).toBeUndefined());

  view.unmount();
  render(<App />);
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "H4" }).textContent).toBe(""));
  expect(screen.getByRole("gridcell", { name: "H4" }).getAttribute("aria-selected")).toBe("true");
  expect(formulaBar().value).toBe("");
});

test("Delete on a formula cell removes the original formula and recalculates its dependent result", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = "#/workbooks/EVO-M03-CLEAR-FORMULA";
  const view = render(<App />);
  await grid();

  await user.click(await cell("C7"));
  expect(formulaBar().value).toBe("=B7*5");
  expect(screen.getByRole("gridcell", { name: "D7" }).textContent).toBe("67");

  fireEvent.keyDown(window, { key: "Delete" });

  await waitFor(() => expect(screen.getByRole("gridcell", { name: "C7" }).textContent).toBe(""));
  expect(formulaBar().value).toBe("");
  expect(screen.getByRole("gridcell", { name: "D7" }).textContent).toBe("2");
  await waitFor(() => {
    expect(workbookCells("EVO-M03-CLEAR-FORMULA").C7).toBeUndefined();
    expect(workbookCells("EVO-M03-CLEAR-FORMULA").D7).toBe("=C7+2");
  });

  view.unmount();
  render(<App />);
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "C7" }).textContent).toBe(""));
  expect(screen.getByRole("gridcell", { name: "D7" }).textContent).toBe("2");
});

test("Delete clears every cell of the selected rectangle and keeps the rectangle selected", async () => {
  api = installFakeApi();
  window.location.hash = "#/workbooks/EVO-M03-CLEAR-RANGE";
  const view = render(<App />);
  await grid();

  fireEvent.mouseDown(screen.getByRole("gridcell", { name: "H4" }));
  fireEvent.mouseOver(screen.getByRole("gridcell", { name: "I5" }), { buttons: 1 });
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: "I5" }));
  for (const name of ["H4", "I4", "H5", "I5"]) {
    expect(screen.getByRole("gridcell", { name }).getAttribute("aria-selected")).toBe("true");
  }
  expect(screen.getByRole("gridcell", { name: "H4" }).textContent).toBe("Amber/Delta");
  expect(screen.getByRole("gridcell", { name: "I4" }).textContent).toBe("Kite/Orchid");

  fireEvent.keyDown(window, { key: "Delete" });

  await waitFor(() => expect(screen.getByRole("gridcell", { name: "H4" }).textContent).toBe(""));
  for (const name of ["H4", "I4", "H5", "I5"]) {
    expect(screen.getByRole("gridcell", { name }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name }).getAttribute("aria-selected")).toBe("true");
  }
  expect(formulaBar().value).toBe("");
  await waitFor(() => expect(workbookCells("EVO-M03-CLEAR-RANGE").I4).toBeUndefined());

  view.unmount();
  render(<App />);
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "I4" }).textContent).toBe(""));
  for (const name of ["H4", "I4", "H5", "I5"]) {
    expect(screen.getByRole("gridcell", { name }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name }).getAttribute("aria-selected")).toBe("true");
  }
});

test("a rejected clear reports an error and keeps the last successful value", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = "#/workbooks/EVO-M03-CLEAR-TEXT";
  render(<App />);
  await grid();

  await user.click(await cell("H4"));
  api.failOnce(
    "POST",
    "/api/workbooks/EVO-M03-CLEAR-TEXT/worksheets/EVO-M03-CLEAR-TEXT--Staging/cells/batch",
  );
  fireEvent.keyDown(window, { key: "Delete" });

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Server error");
  expect(screen.getByRole("gridcell", { name: "H4" }).textContent).toBe("obsolete tag");
  expect(formulaBar().value).toBe("obsolete tag");
  expect(workbookCells("EVO-M03-CLEAR-TEXT").H4).toBe("obsolete tag");
});

test("Delete inside the formula bar edits text instead of clearing the selection", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = "#/workbooks/EVO-M03-CLEAR-TEXT";
  render(<App />);
  await grid();

  await user.click(await cell("H4"));
  fireEvent.keyDown(formulaBar(), { key: "Delete" });

  expect(screen.getByRole("gridcell", { name: "H4" }).textContent).toBe("obsolete tag");
  expect(workbookCells("EVO-M03-CLEAR-TEXT").H4).toBe("obsolete tag");
});
