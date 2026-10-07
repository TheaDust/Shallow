import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "./App";
import type { NamedRange, Workbook } from "./domain/types";
import { installFakeApi, type FakeApi } from "./test/fake-api";

let api: FakeApi | undefined;

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

/** Pre-provisioned workbook of the named-range scenarios: one `ForecastModel`. */
function forecastWorkbook(
  id: string,
  cells: Record<string, string>,
  namedRanges?: NamedRange[],
): Workbook {
  const worksheetId = `ws-${id}`;
  return {
    id,
    name: id,
    createdAt: "2026-10-07T09:00:00.000Z",
    updatedAt: "2026-10-07T09:00:00.000Z",
    activeWorksheetId: worksheetId,
    namedRanges,
    worksheets: [{ id: worksheetId, name: "ForecastModel", selection: { anchor: "A1", focus: "A1" }, cells }],
  };
}

/** Opens a pre-provisioned workbook through its deep link. */
function open(workbook: Workbook) {
  window.location.hash = `#/workbooks/${workbook.id}`;
  api = installFakeApi([workbook]);
  return render(<App />);
}

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

/** Opens "Data" → "Named ranges" of the loaded workbook. */
async function openNamedRanges(user: ReturnType<typeof userEvent.setup>) {
  await grid();
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Named ranges" }));
  return screen.findByRole("dialog", { name: "Named ranges" });
}

test("a created name is usable in a formula and stays listed after a refresh", async () => {
  const user = userEvent.setup();
  open(forecastWorkbook("EVO-N03-NAMED-CREATE", { J3: "18", J4: "24", J5: "31" }));

  const dialog = await openNamedRanges(user);
  await user.click(within(dialog).getByRole("button", { name: "Add named range" }));
  await user.type(within(dialog).getByLabelText("Name"), "CapacityPlan");
  await user.type(within(dialog).getByLabelText("Range"), "ForecastModel!J3:J5");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Named ranges" })).toBeNull());

  expect(api?.workbooks[0].namedRanges).toEqual([
    { name: "CapacityPlan", worksheetId: "ws-EVO-N03-NAMED-CREATE", range: "J3:J5" },
  ]);
  // The reopened dialog lists the saved name.
  const reopened = await openNamedRanges(user);
  expect(within(reopened).getByRole("button", { name: "Edit CapacityPlan" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Named ranges" })).toBeNull());

  // The saved name is a range reference inside a formula.
  await user.click(screen.getByRole("gridcell", { name: "L3" }));
  await user.type(screen.getByLabelText("Formula bar"), "=SUM(CapacityPlan)");
  await user.keyboard("{Enter}");
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "L3" }).textContent).toBe("73"));
  expect(api?.workbooks[0].worksheets[0].cells.L3).toBe("=SUM(CapacityPlan)");

  // After a refresh L3 still shows the result and keeps the formula text.
  cleanup();
  render(<App />);
  await grid();
  await user.click(screen.getByRole("gridcell", { name: "L3" }));
  await waitFor(() => expect(screen.getByLabelText("Formula bar")).toHaveValue("=SUM(CapacityPlan)"));
  expect(screen.getByRole("gridcell", { name: "L3" }).textContent).toBe("73");
});

test("a saved name and its formula survive a refresh", async () => {
  const user = userEvent.setup();
  open(
    forecastWorkbook("EVO-N03-NAMED-UPDATE", { K2: "5", K3: "8", K4: "12", M2: "=SUM(MarginBase)" }, [
      { name: "MarginBase", worksheetId: "ws-EVO-N03-NAMED-UPDATE", range: "K2:K3" },
    ]),
  );

  await grid();
  expect(screen.getByRole("gridcell", { name: "M2" }).textContent).toBe("13");

  const dialog = await openNamedRanges(user);
  await user.click(within(dialog).getByRole("button", { name: "Edit MarginBase" }));
  const rangeField = within(dialog).getByLabelText("Range");
  expect(rangeField).toHaveValue("ForecastModel!K2:K3");
  await user.clear(rangeField);
  await user.type(rangeField, "ForecastModel!K2:K4");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Named ranges" })).toBeNull());

  // The dependent formula recalculates immediately.
  await waitFor(() => expect(screen.getByRole("gridcell", { name: "M2" }).textContent).toBe("25"));
  expect(api?.workbooks[0].namedRanges).toEqual([
    { name: "MarginBase", worksheetId: "ws-EVO-N03-NAMED-UPDATE", range: "K2:K4" },
  ]);

  // The edited range and the recalculated result survive a refresh.
  cleanup();
  render(<App />);
  await grid();
  expect(screen.getByRole("gridcell", { name: "M2" }).textContent).toBe("25");
  const reopened = await openNamedRanges(user);
  await user.click(within(reopened).getByRole("button", { name: "Edit MarginBase" }));
  expect(within(reopened).getByLabelText("Range")).toHaveValue("ForecastModel!K2:K4");
});

test("a name that does not start with a letter shows the exact message and is not saved", async () => {
  const user = userEvent.setup();
  open(forecastWorkbook("EVO-N03-NAMED-INVALID", { K2: "6", K3: "14" }));

  const dialog = await openNamedRanges(user);
  await user.click(within(dialog).getByRole("button", { name: "Add named range" }));
  await user.type(within(dialog).getByLabelText("Name"), "1stBatch");
  await user.type(within(dialog).getByLabelText("Range"), "ForecastModel!K2:K3");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const alert = await within(dialog).findByRole("alert");
  expect(alert.textContent).toBe("Named range must start with a letter");
  expect(api?.workbooks[0].namedRanges).toBeUndefined();

  // A refresh shows that no such entry was stored.
  cleanup();
  render(<App />);
  const reopened = await openNamedRanges(user);
  expect(within(reopened).queryByRole("button", { name: "Edit 1stBatch" })).toBeNull();
});
