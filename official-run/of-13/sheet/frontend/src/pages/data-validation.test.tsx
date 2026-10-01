/**
 * REQ-5-2-1: the `Data validation` dialog, the dropdown button of a constrained cell and the
 * enforcement of a saved rule. The server double mirrors `backend/src/domain/validation.mjs`,
 * so a rejected write answers with the same contract message the real server sends.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { WORKBOOK_ID, installFakeWorkbookApi } from "../test/fake-workbook-api";

async function openEditor() {
  window.location.hash = `#/workbooks/${WORKBOOK_ID}`;
  const view = render(<App />);
  await screen.findByRole("grid", { name: "Worksheet grid" });
  return view;
}

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function cell(address: string) {
  return within(grid()).getByRole("gridcell", { name: address });
}

function formulaBar() {
  return screen.getByLabelText("Formula bar") as HTMLInputElement;
}

function dragSelect(from: string, to: string) {
  fireEvent.mouseDown(cell(from), { button: 0 });
  fireEvent.mouseEnter(cell(to));
  fireEvent.mouseUp(document.body);
}

async function openDataMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  return screen.getByRole("menu", { name: "Data" });
}

async function openValidationDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    within(await openDataMenu(user)).getByRole("menuitem", { name: "Data validation" }),
  );
  return screen.findByRole("dialog", { name: "Data validation" });
}

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "#/";
});

describe("dropdown validation", () => {
  it("saves trimmed allowed values, offers them as options and rejects other input", async () => {
    const api = installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    await user.click(cell("C2"));
    const dialog = await openValidationDialog(user);
    const ruleType = within(dialog).getByLabelText("Rule type");
    expect(within(ruleType as HTMLElement).getByRole("option", { name: "Dropdown" })).toBeTruthy();
    expect(within(ruleType as HTMLElement).getByRole("option", { name: "Number range" })).toBeTruthy();

    // An empty list is refused in place: the dialog stays open with a message beside the control.
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Data validation" })).toBeTruthy();

    await user.type(within(dialog).getByLabelText("Allowed values"), " Open , Closed ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Data validation" })).toBeNull(),
    );
    // The rule stores the trimmed items and covers exactly the selected cell.
    expect(api.workbooks[0].sheets[0].validations).toEqual([
      { id: expect.any(String), range: "C2", type: "dropdown", values: ["Open", "Closed"] },
    ]);

    await user.click(screen.getByRole("button", { name: "Open dropdown for C2" }));
    const listbox = await screen.findByRole("listbox", { name: "Options for C2" });
    expect(within(listbox).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Open",
      "Closed",
    ]);
    await user.click(within(listbox).getByRole("option", { name: "Closed" }));
    await waitFor(() => expect(cell("C2").textContent).toBe("Closed"));
    expect(api.workbooks[0].sheets[0].cells.C2).toBe("Closed");

    // Typing a value that is not allowed keeps the last successful value and explains why.
    await user.click(cell("C2"));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "Pending");
    await user.keyboard("{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Please select one of the following values: Open, Closed");
    expect(cell("C2").textContent).toBe("Closed");
  });
});

describe("number range validation", () => {
  it("applies an inclusive rule to the selected rectangle and rejects out of range writes", async () => {
    installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    dragSelect("B2", "B3");
    const dialog = await openValidationDialog(user);
    await user.selectOptions(within(dialog).getByLabelText("Rule type"), "number-range");
    await user.type(within(dialog).getByLabelText("Minimum"), "0");
    await user.type(within(dialog).getByLabelText("Maximum"), "100");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // A grid write below the range is refused with the boundary wording.
    await user.click(cell("B3"));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "101");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Please enter a number from 0 to 100",
      ),
    );
    expect(cell("B3").textContent).toBe("800");

    // A bulk paste into the rule is refused as a whole.
    await user.click(cell("B2"));
    fireEvent.paste(grid(), { clipboardData: { getData: () => "101" } });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Please enter a number from 0 to 100",
      ),
    );
    expect(cell("B2").textContent).toBe("1200");
  });

  it("prefills a stored rule and deletes it again", async () => {
    const api = installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    dragSelect("B2", "B3");
    let dialog = await openValidationDialog(user);
    await user.selectOptions(within(dialog).getByLabelText("Rule type"), "number-range");
    await user.type(within(dialog).getByLabelText("Minimum"), "0");
    await user.type(within(dialog).getByLabelText("Maximum"), "100");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Reopening the same rectangle shows the stored type and parameters.
    dragSelect("B2", "B3");
    dialog = await openValidationDialog(user);
    expect((within(dialog).getByLabelText("Rule type") as HTMLSelectElement).value).toBe(
      "number-range",
    );
    expect((within(dialog).getByLabelText("Minimum") as HTMLInputElement).value).toBe("0");
    expect((within(dialog).getByLabelText("Maximum") as HTMLInputElement).value).toBe("100");

    await user.click(within(dialog).getByRole("button", { name: "Delete rule" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.workbooks[0].sheets[0].validations).toEqual([]);

    // The constraint is gone: the same write is now accepted.
    await user.click(cell("B3"));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "101");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(cell("B3").textContent).toBe("101"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("prefills a rule of a single selected cell and offers Delete rule", async () => {
    installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    await user.click(cell("C3"));
    let dialog = await openValidationDialog(user);
    await user.type(within(dialog).getByLabelText("Allowed values"), "Pending, Closed");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(cell("C3"));
    dialog = await openValidationDialog(user);
    expect((within(dialog).getByLabelText("Allowed values") as HTMLInputElement).value).toBe(
      "Pending, Closed",
    );
    expect(within(dialog).getByRole("button", { name: "Delete rule" })).toBeTruthy();
  });

  it("keeps a saved rule after the workbook is reopened", async () => {
    const api = installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    dragSelect("B2", "B3");
    const dialog = await openValidationDialog(user);
    await user.selectOptions(within(dialog).getByLabelText("Rule type"), "number-range");
    await user.type(within(dialog).getByLabelText("Minimum"), "0");
    await user.type(within(dialog).getByLabelText("Maximum"), "100");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    window.location.hash = "#/";
    window.location.hash = `#/workbooks/${WORKBOOK_ID}`;
    await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(api.workbooks[0].sheets[0].validations?.[0].max).toBe(100);

    await user.click(cell("B3"));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "101");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Please enter a number from 0 to 100",
      ),
    );
    expect(cell("B3").textContent).toBe("800");
  });
});
