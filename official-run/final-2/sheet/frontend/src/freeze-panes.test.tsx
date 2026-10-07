import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import {
  EVO_FREEZE_BOTH_ID,
  EVO_FREEZE_COLUMN_ID,
  EVO_FREEZE_ROW_ID,
  installFakeApi,
  type FakeApi,
} from "./test/fake-api";

let api: FakeApi | undefined;

beforeEach(() => {
  window.location.hash = `#/workbooks/${EVO_FREEZE_ROW_ID}`;
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

/** Opens one independent `EVO-N01-*` workbook and renders its editor. */
function openWorkbook(id: string) {
  window.location.hash = `#/workbooks/${id}`;
  return render(<App />);
}

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

/** The editor's frozen-pane button, named exactly by the stored counts. */
function frozenButton(name: string) {
  return screen.getByRole("button", { name });
}

/** The stored worksheet of one freeze workbook, for the state assertions. */
function sheet(id: string) {
  return api!.workbooks.find((workbook) => workbook.id === id)!.worksheets[0];
}

/** Selects one cell and picks a command of the "View" menu. */
async function freezeThroughView(user: ReturnType<typeof userEvent.setup>, cellName: string, command: string) {
  await user.click(screen.getByRole("gridcell", { name: cellName }));
  await user.click(screen.getByRole("button", { name: "View" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: command }));
}

test("freezing the first row reports the state and keeps it after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  openWorkbook(EVO_FREEZE_ROW_ID);
  await grid();

  // Nothing is frozen before the command; the editor still exposes the state.
  expect(frozenButton("Frozen rows: 0; columns: 0")).toBeTruthy();

  await freezeThroughView(user, "B1", "Freeze rows through 1");
  await screen.findByRole("button", { name: "Frozen rows: 1; columns: 0" });
  expect(sheet(EVO_FREEZE_ROW_ID).freeze).toEqual({ rows: 1, columns: 0 });

  cleanup();
  openWorkbook(EVO_FREEZE_ROW_ID);
  await grid();
  expect(frozenButton("Frozen rows: 1; columns: 0").textContent).toBe("Frozen rows: 1; columns: 0");
});

test("freezing the first column reports the state and keeps it after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  openWorkbook(EVO_FREEZE_COLUMN_ID);
  await grid();

  await freezeThroughView(user, "A8", "Freeze columns through A");
  await screen.findByRole("button", { name: "Frozen rows: 0; columns: 1" });
  expect(sheet(EVO_FREEZE_COLUMN_ID).freeze).toEqual({ rows: 0, columns: 1 });

  cleanup();
  openWorkbook(EVO_FREEZE_COLUMN_ID);
  await grid();
  expect(frozenButton("Frozen rows: 0; columns: 1")).toBeTruthy();
});

test("freezing panes at C4 freezes the rows above and columns to the left", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  openWorkbook(EVO_FREEZE_BOTH_ID);
  await grid();

  await freezeThroughView(user, "C4", "Freeze panes at C4");
  await screen.findByRole("button", { name: "Frozen rows: 3; columns: 2" });
  expect(sheet(EVO_FREEZE_BOTH_ID).freeze).toEqual({ rows: 3, columns: 2 });

  cleanup();
  openWorkbook(EVO_FREEZE_BOTH_ID);
  await grid();
  expect(frozenButton("Frozen rows: 3; columns: 2")).toBeTruthy();
});

test("the frozen state belongs to one worksheet and can be removed again", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  openWorkbook(EVO_FREEZE_BOTH_ID);
  await grid();

  await freezeThroughView(user, "A3", "Freeze rows through 3");
  await screen.findByRole("button", { name: "Frozen rows: 3; columns: 0" });
  // No other scenario workbook picked that state up.
  expect(sheet(EVO_FREEZE_ROW_ID).freeze).toBeUndefined();
  expect(sheet(EVO_FREEZE_COLUMN_ID).freeze).toBeUndefined();

  // The state button clears the panes again, and the cleared state persists.
  await user.click(frozenButton("Frozen rows: 3; columns: 0"));
  await screen.findByRole("button", { name: "Frozen rows: 0; columns: 0" });
  expect(sheet(EVO_FREEZE_BOTH_ID).freeze).toBeUndefined();

  cleanup();
  openWorkbook(EVO_FREEZE_BOTH_ID);
  await grid();
  expect(frozenButton("Frozen rows: 0; columns: 0")).toBeTruthy();
});
