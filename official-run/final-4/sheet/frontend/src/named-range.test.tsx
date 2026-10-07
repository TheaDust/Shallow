import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import { installFakeApi, type FakeApi } from "./test/fake-api";
import type { NamedRange, Workbook } from "./domain/types";

let api: FakeApi | undefined;

/**
 * One pre-provisioned `ForecastModel` workbook of a named-range scenario: the
 * seeded cells of the GIVEN plus the names that scenario already stores.
 */
function forecastWorkbook(id: string, cells: Record<string, string>, namedRanges?: NamedRange[]): Workbook {
  const worksheetId = `ws-${id}-forecastmodel`;
  return {
    id,
    name: id,
    createdAt: "2026-09-05T09:50:00.000Z",
    updatedAt: "2026-09-06T09:50:00.000Z",
    activeWorksheetId: worksheetId,
    worksheets: [
      { id: worksheetId, name: "ForecastModel", selection: { anchor: "A1", focus: "A1" }, cells },
    ],
    ...(namedRanges ? { namedRanges } : {}),
  };
}

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function cellText(name: string): string {
  return screen.getByRole("gridcell", { name }).textContent ?? "";
}

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
}

/** Opens the "Named ranges" dialog through the "Data" menu. */
async function openNamedRanges(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Named ranges" }));
  return screen.findByRole("dialog", { name: "Named ranges" });
}

async function closeDialog(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name })).toBeNull());
}

test("a created named range is usable in a formula and survives a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi([forecastWorkbook("EVO-N03-NAMED-CREATE", { J3: "18", J4: "24", J5: "31" })]);
  window.location.hash = "#/workbooks/EVO-N03-NAMED-CREATE";
  render(<App />);
  await grid();

  const dialog = await openNamedRanges(user);
  await user.click(within(dialog).getByRole("button", { name: "Add named range" }));
  await user.type(within(dialog).getByLabelText("Name"), "CapacityPlan");
  await user.type(within(dialog).getByLabelText("Range"), "ForecastModel!J3:J5");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  // A saved name closes the dialog, so the grid is usable again right away.
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Named ranges" })).toBeNull());
  expect(api.workbooks[0].namedRanges).toEqual([
    { id: expect.any(String), name: "CapacityPlan", range: "ForecastModel!J3:J5" },
  ]);

  await user.click(screen.getByRole("gridcell", { name: "L3" }));
  const bar = formulaBar();
  await user.clear(bar);
  await user.type(bar, "=SUM(CapacityPlan){Enter}");
  await waitFor(() => expect(cellText("L3")).toBe("73"));
  expect(formulaBar().value).toBe("=SUM(CapacityPlan)");

  // The dialog lists the saved name together with its edit control.
  const reopened = await openNamedRanges(user);
  expect(within(reopened).getByText("CapacityPlan")).toBeTruthy();
  expect(within(reopened).getByRole("button", { name: "Edit CapacityPlan" })).toBeTruthy();
  await closeDialog(user, "Named ranges");

  // Refresh: the formula text and the calculated result are read again.
  cleanup();
  render(<App />);
  await grid();
  await user.click(screen.getByRole("gridcell", { name: "L3" }));
  expect(formulaBar().value).toBe("=SUM(CapacityPlan)");
  expect(cellText("L3")).toBe("73");
});

test("a name that does not start with a letter shows the message and stores nothing", async () => {
  const user = userEvent.setup();
  api = installFakeApi([forecastWorkbook("EVO-N03-NAMED-INVALID", { K2: "6", K3: "14" })]);
  window.location.hash = "#/workbooks/EVO-N03-NAMED-INVALID";
  render(<App />);
  await grid();

  const dialog = await openNamedRanges(user);
  await user.click(within(dialog).getByRole("button", { name: "Add named range" }));
  await user.type(within(dialog).getByLabelText("Name"), "1stBatch");
  await user.type(within(dialog).getByLabelText("Range"), "ForecastModel!K2:K3");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Named range must start with a letter");
  expect(api.workbooks[0].namedRanges).toBeUndefined();

  // After a refresh the same dialog still has no entry for the rejected name.
  cleanup();
  render(<App />);
  await grid();
  const reopened = await openNamedRanges(user);
  expect(within(reopened).queryByRole("button", { name: "Edit 1stBatch" })).toBeNull();
  expect(reopened.textContent).not.toContain("1stBatch");
  expect(within(reopened).getByRole("button", { name: "Add named range" })).toBeTruthy();
});

test("editing a stored name recalculates its dependent formula and persists", async () => {
  const user = userEvent.setup();
  api = installFakeApi([
    forecastWorkbook(
      "EVO-N03-NAMED-UPDATE",
      { K2: "5", K3: "8", K4: "12", M2: "=SUM(MarginBase)" },
      [{ id: "nr-marginbase", name: "MarginBase", range: "ForecastModel!K2:K3" }],
    ),
  ]);
  window.location.hash = "#/workbooks/EVO-N03-NAMED-UPDATE";
  render(<App />);
  await grid();
  await waitFor(() => expect(cellText("M2")).toBe("13"));

  const dialog = await openNamedRanges(user);
  await user.click(within(dialog).getByRole("button", { name: "Edit MarginBase" }));
  const rangeField = within(dialog).getByLabelText("Range") as HTMLInputElement;
  expect(rangeField.value).toBe("ForecastModel!K2:K3");
  expect((within(dialog).getByLabelText("Name") as HTMLInputElement).value).toBe("MarginBase");

  await user.clear(rangeField);
  await user.type(rangeField, "ForecastModel!K2:K4");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Named ranges" })).toBeNull());
  // The dependent formula recalculates immediately after the range changed.
  await waitFor(() => expect(cellText("M2")).toBe("25"));
  expect(api.workbooks[0].namedRanges).toEqual([
    { id: "nr-marginbase", name: "MarginBase", range: "ForecastModel!K2:K4" },
  ]);

  // After a refresh the stored range and the recalculated result remain.
  cleanup();
  render(<App />);
  await grid();
  await waitFor(() => expect(cellText("M2")).toBe("25"));
  const reopened = await openNamedRanges(user);
  await user.click(within(reopened).getByRole("button", { name: "Edit MarginBase" }));
  expect((within(reopened).getByLabelText("Range") as HTMLInputElement).value).toBe("ForecastModel!K2:K4");
});
