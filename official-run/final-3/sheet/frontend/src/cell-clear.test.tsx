import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/** One pre-provisioned workbook of the clear scenarios, keyed by stable id. */
function clearWorkbook(id: string, worksheetName: string, cells: Record<string, string>): Workbook {
  const worksheetId = `ws-${id}`;
  return {
    id,
    name: id,
    createdAt: "2026-10-03T09:00:00.000Z",
    updatedAt: "2026-10-03T09:00:00.000Z",
    activeWorksheetId: worksheetId,
    worksheets: [{ id: worksheetId, name: worksheetName, selection: { anchor: "A1", focus: "A1" }, cells }],
  };
}

/** Opens a workbook through its deep link with an independent in-memory store. */
function open(workbook: Workbook) {
  window.location.hash = `#/workbooks/${workbook.id}`;
  api = installFakeApi([workbook]);
  return render(<App />);
}

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

test("Delete clears the selected text cell, empties the formula bar and persists", async () => {
  const user = userEvent.setup();
  const view = open(clearWorkbook("EVO-M03-CLEAR-TEXT", "Staging", { H4: "obsolete tag" }));
  await grid();

  const target = await cell("H4");
  expect(target.textContent).toBe("obsolete tag");
  await user.click(target);
  expect(formulaBar().value).toBe("obsolete tag");

  await user.keyboard("{Delete}");

  await waitFor(() => expect(screen.getByRole("gridcell", { name: "H4" }).textContent).toBe(""));
  expect(screen.getByRole("gridcell", { name: "H4" }).getAttribute("aria-selected")).toBe("true");
  expect(formulaBar().value).toBe("");
  expect(api!.workbooks[0].worksheets[0].cells.H4).toBeUndefined();

  view.unmount();
  render(<App />);
  expect((await cell("H4")).textContent).toBe("");
  expect(screen.getByRole("gridcell", { name: "H4" }).getAttribute("aria-selected")).toBe("true");
  expect(formulaBar().value).toBe("");
});

test("Delete clears a formula cell, recalculates its dependent result and keeps the formula bar empty", async () => {
  const user = userEvent.setup();
  const view = open(
    clearWorkbook("EVO-M03-CLEAR-FORMULA", "Calculations", { B7: "13", C7: "=B7*5", D7: "=C7+2" }),
  );
  await grid();

  expect((await cell("C7")).textContent).toBe("65");
  expect(screen.getByRole("gridcell", { name: "D7" }).textContent).toBe("67");

  await user.click(screen.getByRole("gridcell", { name: "C7" }));
  const bar = formulaBar();
  expect(bar.value).toBe("=B7*5");

  await user.keyboard("{Delete}");

  await waitFor(() => expect(screen.getByRole("gridcell", { name: "C7" }).textContent).toBe(""));
  expect(bar.value).toBe("");
  expect(screen.getByRole("gridcell", { name: "D7" }).textContent).toBe("2");
  expect(api!.workbooks[0].worksheets[0].cells.C7).toBeUndefined();
  expect(api!.workbooks[0].worksheets[0].cells.D7).toBe("=C7+2");

  view.unmount();
  render(<App />);
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "D7" }).textContent).toBe("2"));
  expect((await cell("C7")).textContent).toBe("");
  await user.click(screen.getByRole("gridcell", { name: "C7" }));
  expect(formulaBar().value).toBe("");
});

test("Delete clears every cell of the selected rectangle and keeps it selected", async () => {
  const user = userEvent.setup();
  const view = open(
    clearWorkbook("EVO-M03-CLEAR-RANGE", "Matrix", {
      H4: "Amber",
      I4: "Delta",
      H5: "Kite",
      I5: "Orchid",
      J4: "keeper",
    }),
  );
  await grid();

  fireEvent.mouseDown(screen.getByRole("gridcell", { name: "H4" }));
  fireEvent.mouseOver(screen.getByRole("gridcell", { name: "I5" }), { buttons: 1 });
  fireEvent.mouseUp(screen.getByRole("gridcell", { name: "I5" }));
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].selection).toEqual({ anchor: "H4", focus: "I5" }));

  await user.keyboard("{Delete}");

  await waitFor(() => expect(screen.getByRole("gridcell", { name: "I5" }).textContent).toBe(""));
  for (const name of ["H4", "I4", "H5", "I5"]) {
    expect(screen.getByRole("gridcell", { name }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name }).getAttribute("aria-selected")).toBe("true");
  }
  // A cell outside the rectangle keeps its value.
  expect(screen.getByRole("gridcell", { name: "J4" }).textContent).toBe("keeper");

  view.unmount();
  render(<App />);
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "I5" }).textContent).toBe(""));
  for (const name of ["H4", "I4", "H5", "I5"]) {
    expect(screen.getByRole("gridcell", { name }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name }).getAttribute("aria-selected")).toBe("true");
  }
});

test("a failed clear reports an error and keeps the last successful value", async () => {
  const user = userEvent.setup();
  open(clearWorkbook("EVO-M03-CLEAR-TEXT", "Staging", { H4: "obsolete tag" }));
  await grid();

  await user.click(await cell("H4"));
  api!.failOnce("POST", "/api/workbooks/EVO-M03-CLEAR-TEXT/worksheets/ws-EVO-M03-CLEAR-TEXT/cells/clear");
  await user.keyboard("{Delete}");

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Server error");
  expect(screen.getByRole("gridcell", { name: "H4" }).textContent).toBe("obsolete tag");
  expect(formulaBar().value).toBe("obsolete tag");
  expect(api!.workbooks[0].worksheets[0].cells.H4).toBe("obsolete tag");
});
