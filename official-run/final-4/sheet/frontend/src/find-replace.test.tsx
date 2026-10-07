import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import type { Workbook } from "./domain/types";
import { installFakeApi, type FakeApi } from "./test/fake-api";

/** Stable ids of the pre-provisioned find-and-replace workbooks (see the backend seed). */
const FIND_NEXT_WORKBOOK_ID = "EVO-N02-FIND-NEXT";
const FIND_NEXT_WORKSHEET_ID = "ws-evo-n02-find-next-narrative";
const REPLACE_ALL_WORKBOOK_ID = "EVO-N02-REPLACE-ALL";
const REPLACE_ALL_WORKSHEET_ID = "ws-evo-n02-replace-all-narrative";
const CASE_SENSITIVE_WORKBOOK_ID = "EVO-N02-CASE-SENSITIVE";
const CASE_SENSITIVE_WORKSHEET_ID = "ws-evo-n02-case-sensitive-narrative";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

function workbook(id: string, worksheetId: string, cells: Record<string, string>): Workbook {
  return {
    id,
    name: id,
    createdAt: "2026-09-05T09:35:00.000Z",
    updatedAt: "2026-09-06T09:35:00.000Z",
    activeWorksheetId: worksheetId,
    worksheets: [{ id: worksheetId, name: "Narrative", selection: { anchor: "A1", focus: "A1" }, cells }],
  };
}

const findNextWorkbook = () =>
  workbook(FIND_NEXT_WORKBOOK_ID, FIND_NEXT_WORKSHEET_ID, {
    D4: "Batch",
    E4: "Cobalt",
    D7: "Batch",
    E7: "Cobalt",
    D11: "Batch",
    E11: "Cobalt",
  });

const replaceAllWorkbook = () =>
  workbook(REPLACE_ALL_WORKBOOK_ID, REPLACE_ALL_WORKSHEET_ID, {
    F3: "Cobalt",
    F6: "Cobalt",
    F9: "Cobalt",
    F12: "Copper",
  });

const caseSensitiveWorkbook = () =>
  workbook(CASE_SENSITIVE_WORKBOOK_ID, CASE_SENSITIVE_WORKSHEET_ID, {
    G3: "Cobalt",
    G4: "cobalt",
    G5: "Cobalt-7",
  });

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function cell(name: string): HTMLElement {
  return screen.getByRole("gridcell", { name });
}

function findBox(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Find" }) as HTMLInputElement;
}

function replaceBox(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Replace with" }) as HTMLInputElement;
}

/** Opens one pre-provisioned workbook through its deep link. */
function openWorkbook(book: Workbook) {
  window.location.hash = `#/workbooks/${book.id}`;
  api = installFakeApi([book]);
  return render(<App />);
}

/** Opens the "Find and replace" dialog through the "Edit" menu. */
async function openFindReplace(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(await screen.findByRole("menuitem", { name: "Find and replace" }));
  return screen.findByRole("dialog", { name: "Find and replace" });
}

test("Find next selects the next matching cell and reports the position", async () => {
  const user = userEvent.setup();
  const view = openWorkbook(findNextWorkbook());
  await grid();

  await user.click(cell("A1"));
  await openFindReplace(user);
  await user.type(findBox(), "Cobalt");

  await user.click(screen.getByRole("button", { name: "Find next" }));
  expect(await screen.findByText("Match 1 of 3")).toBeTruthy();
  expect(cell("E4").getAttribute("aria-selected")).toBe("true");

  await user.click(screen.getByRole("button", { name: "Find next" }));
  expect(await screen.findByText("Match 2 of 3")).toBeTruthy();
  expect(cell("E7").getAttribute("aria-selected")).toBe("true");
  expect(cell("E4").getAttribute("aria-selected")).toBe("false");
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].selection).toEqual({ anchor: "E7", focus: "E7" }));

  // The third step reaches the last match and wraps back to the first one.
  await user.click(screen.getByRole("button", { name: "Find next" }));
  expect(await screen.findByText("Match 3 of 3")).toBeTruthy();
  expect(cell("E11").getAttribute("aria-selected")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Find next" }));
  expect(await screen.findByText("Match 1 of 3")).toBeTruthy();
  expect(cell("E4").getAttribute("aria-selected")).toBe("true");

  // The matching cells themselves are never changed by searching.
  expect(api!.workbooks[0].worksheets[0].cells.E4).toBe("Cobalt");
  view.unmount();
});

test("Replace all rewrites every matching cell and keeps the result after refresh", async () => {
  const user = userEvent.setup();
  const view = openWorkbook(replaceAllWorkbook());
  await grid();

  await openFindReplace(user);
  await user.type(findBox(), "Cobalt");
  await user.type(replaceBox(), "Indigo");
  await user.click(screen.getByRole("button", { name: "Replace all" }));

  expect(await screen.findByText("Replaced 3 cells")).toBeTruthy();
  await waitFor(() => expect(cell("F3").textContent).toBe("Indigo"));
  expect(cell("F6").textContent).toBe("Indigo");
  expect(cell("F9").textContent).toBe("Indigo");
  // A cell that is not exactly the search text keeps its value.
  expect(cell("F12").textContent).toBe("Copper");
  await waitFor(() =>
    expect(api!.workbooks[0].worksheets[0].cells).toEqual({
      F3: "Indigo",
      F6: "Indigo",
      F9: "Indigo",
      F12: "Copper",
    }),
  );

  view.unmount();
  render(<App />);
  await grid();
  expect(cell("F3").textContent).toBe("Indigo");
  expect(cell("F6").textContent).toBe("Indigo");
  expect(cell("F9").textContent).toBe("Indigo");
  expect(cell("F12").textContent).toBe("Copper");
});

test("Match case replaces only the exactly cased matches and persists them", async () => {
  const user = userEvent.setup();
  const view = openWorkbook(caseSensitiveWorkbook());
  await grid();

  await openFindReplace(user);
  await user.type(findBox(), "Cobalt");
  await user.type(replaceBox(), "Azure");
  await user.click(screen.getByRole("checkbox", { name: "Match case" }));
  await user.click(screen.getByRole("button", { name: "Replace all" }));

  expect(await screen.findByText("Replaced 1 cells")).toBeTruthy();
  await waitFor(() => expect(cell("G3").textContent).toBe("Azure"));
  expect(cell("G4").textContent).toBe("cobalt");
  expect(cell("G5").textContent).toBe("Cobalt-7");
  await waitFor(() =>
    expect(api!.workbooks[0].worksheets[0].cells).toEqual({ G3: "Azure", G4: "cobalt", G5: "Cobalt-7" }),
  );

  view.unmount();
  render(<App />);
  await grid();
  expect(cell("G3").textContent).toBe("Azure");
  expect(cell("G4").textContent).toBe("cobalt");
  expect(cell("G5").textContent).toBe("Cobalt-7");
});

test("an unchecked Match case replaces every casing of the search text", async () => {
  const user = userEvent.setup();
  openWorkbook(caseSensitiveWorkbook());
  await grid();

  await openFindReplace(user);
  await user.type(findBox(), "Cobalt");
  await user.type(replaceBox(), "Azure");
  await user.click(screen.getByRole("button", { name: "Replace all" }));

  expect(await screen.findByText("Replaced 2 cells")).toBeTruthy();
  await waitFor(() =>
    expect(api!.workbooks[0].worksheets[0].cells).toEqual({ G3: "Azure", G4: "Azure", G5: "Cobalt-7" }),
  );
});

test("a failed Replace all reports an error and keeps every cell as it was", async () => {
  const user = userEvent.setup();
  const view = openWorkbook(replaceAllWorkbook());
  await grid();

  api!.failOnce("POST", `/api/workbooks/${REPLACE_ALL_WORKBOOK_ID}/worksheets/${REPLACE_ALL_WORKSHEET_ID}/cells/replace`);
  await openFindReplace(user);
  await user.type(findBox(), "Cobalt");
  await user.type(replaceBox(), "Indigo");
  await user.click(screen.getByRole("button", { name: "Replace all" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Server error");
  expect(cell("F3").textContent).toBe("Cobalt");
  expect(cell("F6").textContent).toBe("Cobalt");
  expect(cell("F9").textContent).toBe("Cobalt");
  expect(api!.workbooks[0].worksheets[0].cells.F3).toBe("Cobalt");

  view.unmount();
  render(<App />);
  await grid();
  expect(cell("F3").textContent).toBe("Cobalt");
});

test("a query without matches reports it and changes nothing", async () => {
  const user = userEvent.setup();
  openWorkbook(findNextWorkbook());
  await grid();

  await openFindReplace(user);
  await user.type(findBox(), "Copper");
  await user.click(screen.getByRole("button", { name: "Find next" }));
  expect(await screen.findByText("No matches")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Replace all" }));
  expect(await screen.findByText("Replaced 0 cells")).toBeTruthy();
  expect(api!.workbooks[0].worksheets[0].cells.E4).toBe("Cobalt");
});
