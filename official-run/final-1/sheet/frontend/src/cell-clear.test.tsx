import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import {
  EVO_CLEAR_FORMULA_WORKBOOK_ID,
  EVO_CLEAR_FORMULA_WORKSHEET_ID,
  EVO_CLEAR_RANGE_WORKBOOK_ID,
  EVO_CLEAR_RANGE_WORKSHEET_ID,
  EVO_CLEAR_TEXT_WORKBOOK_ID,
  EVO_CLEAR_TEXT_WORKSHEET_ID,
  installFakeApi,
  type FakeApi,
} from "./test/fake-api";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

/** Stored cells of one pre-provisioned worksheet of the fake server. */
function storedCells(workbookId: string, worksheetId: string): Record<string, string> {
  const workbook = api!.workbooks.find((candidate) => candidate.id === workbookId);
  const worksheet = workbook?.worksheets.find((candidate) => candidate.id === worksheetId);
  return worksheet?.cells ?? {};
}

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
}

/** Waits for the editor grid and returns one cell by its A1 coordinate. */
async function grid(name: string) {
  await screen.findByRole("grid", { name: "Worksheet grid" });
  return screen.getByRole("gridcell", { name });
}

/** Selects the rectangle `from`..`to` the way the grid's pointer selection does. */
function dragSelect(from: string, to: string) {
  fireEvent.mouseDown(screen.getByRole("gridcell", { name: from }));
  fireEvent.mouseOver(screen.getByRole("gridcell", { name: to }), { buttons: 1 });
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: to }));
}

test("REQ-3-1-1 Delete clears the selected text cell and it stays empty after refresh", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_CLEAR_TEXT_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  await user.click(await grid("H4"));
  expect((await grid("H4")).textContent).toBe("obsolete tag");
  expect(formulaBar().value).toBe("obsolete tag");

  await user.keyboard("{Delete}");

  await waitFor(() => expect(storedCells(EVO_CLEAR_TEXT_WORKBOOK_ID, EVO_CLEAR_TEXT_WORKSHEET_ID).H4).toBeUndefined());
  const cleared = await grid("H4");
  expect(cleared.textContent).toBe("");
  expect(cleared.getAttribute("aria-selected")).toBe("true");
  expect(formulaBar().value).toBe("");

  view.unmount();
  render(<App />);
  const reopened = await grid("H4");
  expect(reopened.textContent).toBe("");
  expect(reopened.getAttribute("aria-selected")).toBe("true");
  expect(formulaBar().value).toBe("");
});

test("REQ-3-1-1 Delete clears a formula cell and recalculates its dependent result", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_CLEAR_FORMULA_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  expect((await grid("C7")).textContent).toBe("65");
  expect((await grid("D7")).textContent).toBe("67");
  await user.click(await grid("C7"));
  expect(formulaBar().value).toBe("=B7*5");

  await user.keyboard("{Delete}");

  await waitFor(() => expect(screen.getByRole("gridcell", { name: "D7" }).textContent).toBe("2"));
  const cleared = screen.getByRole("gridcell", { name: "C7" });
  expect(cleared.textContent).toBe("");
  expect(cleared.getAttribute("aria-selected")).toBe("true");
  expect(formulaBar().value).toBe("");
  const stored = storedCells(EVO_CLEAR_FORMULA_WORKBOOK_ID, EVO_CLEAR_FORMULA_WORKSHEET_ID);
  expect(stored.C7).toBeUndefined();
  // The dependent formula keeps its original expression next to the source value.
  expect(stored.D7).toBe("=C7+2");
  expect(stored.B7).toBe("13");

  view.unmount();
  render(<App />);
  expect((await grid("C7")).textContent).toBe("");
  expect((await grid("D7")).textContent).toBe("2");
  expect(formulaBar().value).toBe("");
});

test("REQ-3-1-1 Delete clears every cell of the selected rectangle and keeps it selected", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_CLEAR_RANGE_WORKBOOK_ID}`;
  api = installFakeApi();
  const view = render(<App />);

  await screen.findByRole("grid", { name: "Worksheet grid" });
  expect(screen.getByRole("gridcell", { name: "H4" }).textContent).toBe("Amber");
  expect(screen.getByRole("gridcell", { name: "I4" }).textContent).toBe("Delta");
  expect(screen.getByRole("gridcell", { name: "H5" }).textContent).toBe("Kite");
  expect(screen.getByRole("gridcell", { name: "I5" }).textContent).toBe("Orchid");

  dragSelect("H4", "I5");
  const rangeWorksheet = api.workbooks
    .find((candidate) => candidate.id === EVO_CLEAR_RANGE_WORKBOOK_ID)
    ?.worksheets.find((worksheet) => worksheet.id === EVO_CLEAR_RANGE_WORKSHEET_ID);
  await waitFor(() => expect(rangeWorksheet?.selection).toEqual({ anchor: "H4", focus: "I5" }));

  await user.keyboard("{Delete}");

  await waitFor(() => expect(storedCells(EVO_CLEAR_RANGE_WORKBOOK_ID, EVO_CLEAR_RANGE_WORKSHEET_ID)).toEqual({}));
  for (const name of ["H4", "I4", "H5", "I5"]) {
    const cell = screen.getByRole("gridcell", { name });
    expect(cell.textContent).toBe("");
    expect(cell.getAttribute("aria-selected")).toBe("true");
  }
  expect(formulaBar().value).toBe("");

  view.unmount();
  render(<App />);
  await screen.findByRole("grid", { name: "Worksheet grid" });
  for (const name of ["H4", "I4", "H5", "I5"]) {
    const cell = screen.getByRole("gridcell", { name });
    expect(cell.textContent).toBe("");
    expect(cell.getAttribute("aria-selected")).toBe("true");
  }
});

test("a failed clear reports an error and keeps the last successful value and result", async () => {
  const user = userEvent.setup();
  window.location.hash = `#/workbooks/${EVO_CLEAR_FORMULA_WORKBOOK_ID}`;
  api = installFakeApi();
  render(<App />);

  await user.click(await grid("C7"));
  api.failOnce(
    "POST",
    `/api/workbooks/${EVO_CLEAR_FORMULA_WORKBOOK_ID}/worksheets/${EVO_CLEAR_FORMULA_WORKSHEET_ID}/cells/batch`,
  );

  await user.keyboard("{Delete}");

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Server error");
  expect((await grid("C7")).textContent).toBe("65");
  expect((await grid("D7")).textContent).toBe("67");
  expect(formulaBar().value).toBe("=B7*5");
  expect(storedCells(EVO_CLEAR_FORMULA_WORKBOOK_ID, EVO_CLEAR_FORMULA_WORKSHEET_ID).C7).toBe("=B7*5");
});
