import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { createMockBackend, seedWorkbook } from "../../test/mock-backend";

let backend: ReturnType<typeof createMockBackend>;

beforeEach(() => {
  backend = createMockBackend([seedWorkbook()]);
  vi.stubGlobal("fetch", backend.fetchImpl);
  window.location.hash = "#/";
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

async function openEditor() {
  window.location.hash = "#/workbooks/workbook-q3-sales";
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
  return { user, view };
}

function grid(): HTMLElement {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function gridCell(name: string): HTMLElement {
  return within(grid()).getByRole("gridcell", { name });
}

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
}

function worksheet(index = 0) {
  return backend.workbooks[0].worksheets[index];
}

async function dragRange(user: ReturnType<typeof userEvent.setup>, from: string, to: string) {
  await user.pointer([
    { keys: "[MouseLeft>]", target: gridCell(from) },
    { target: gridCell(to) },
    { keys: "[/MouseLeft]" },
  ]);
}

async function openValidationDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  await user.click(await screen.findByRole("menuitem", { name: "Data validation" }));
  return screen.findByRole("dialog", { name: "Data validation" });
}

/** Types `text` into the inline editor of `coordinate` and commits it. */
async function editCell(
  user: ReturnType<typeof userEvent.setup>,
  coordinate: string,
  text: string,
) {
  await user.dblClick(gridCell(coordinate));
  const editor = await screen.findByRole("textbox", { name: `Edit ${coordinate}` });
  await user.clear(editor);
  await user.type(editor, text);
  await user.keyboard("{Enter}");
}

describe("dropdown validation", () => {
  it("saves a trimmed allowed-value list and offers the values through the cell dropdown", async () => {
    const { user } = await openEditor();
    await dragRange(user, "A1", "A4");
    const dialog = await openValidationDialog(user);

    expect(within(dialog).getByRole("combobox", { name: "Rule type" })).not.toBeNull();
    await user.type(
      within(dialog).getByRole("textbox", { name: "Allowed values" }),
      " East , North ,South ",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(worksheet().validations).toEqual([
      {
        id: expect.any(String),
        type: "dropdown",
        values: ["East", "North", "South"],
        range: { minRow: 0, maxRow: 3, minCol: 0, maxCol: 0 },
      },
    ]);

    const open = await screen.findByRole("button", { name: "Open dropdown for A2" });
    expect(screen.getByRole("button", { name: "Open dropdown for A1" })).not.toBeNull();
    await user.click(open);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "East",
      "North",
      "South",
    ]);
    await user.click(screen.getByRole("option", { name: "North" }));

    await waitFor(() => expect(worksheet().cells.A2).toBe("North"));
    expect(gridCell("A2").textContent).toBe("North");
    // Cells outside the rule never get a dropdown button.
    expect(screen.queryByRole("button", { name: "Open dropdown for C2" })).toBeNull();
  });

  it("rejects an invalid value from the grid, the formula bar and a paste, keeping the old values", async () => {
    const { user, view } = await openEditor();
    await dragRange(user, "A2", "A4");
    const dialog = await openValidationDialog(user);
    await user.type(within(dialog).getByRole("textbox", { name: "Allowed values" }), "East,North,South");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await editCell(user, "A2", "West");
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toBe(
      "Please select one of the following values: East, North, South",
    );
    expect(worksheet().cells.A2).toBe("East");
    expect(gridCell("A2").textContent).toBe("East");
    expect(formulaBar().value).toBe("East");

    await user.click(gridCell("A3"));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "West");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(worksheet().cells.A3).toBe("North"));
    expect(gridCell("A3").textContent).toBe("North");

    fireEvent.paste(gridCell("A2"), {
      clipboardData: { getData: () => "West\tClosed" },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Please select one of the following values: East, North, South",
      ),
    );
    // The whole paste is rejected: no target cell changed.
    expect(worksheet().cells.A2).toBe("East");
    expect(worksheet().cells.B2).toBe("1200");

    // The rule is still active after reopening the workbook.
    view.unmount();
    const reopened = render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(await screen.findByRole("button", { name: "Open dropdown for A2" })).not.toBeNull();
    await editCell(user, "A2", "West");
    await waitFor(() => expect(worksheet().cells.A2).toBe("East"));
    reopened.unmount();
  });

  it("rejects a range move into a dropdown-constrained target and keeps every cell", async () => {
    const { user } = await openEditor();
    await dragRange(user, "B2", "B4");
    const dialog = await openValidationDialog(user);
    await user.type(within(dialog).getByRole("textbox", { name: "Allowed values" }), "East,North,South");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Copy the Status column and paste it over the constrained Sales cells.
    await dragRange(user, "C2", "C4");
    await user.keyboard("{Control>}c{/Control}");
    await user.click(gridCell("B2"));
    await user.keyboard("{Control>}v{/Control}");

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Please select one of the following values: East, North, South",
      ),
    );
    expect(worksheet().cells.B2).toBe("1200");
    expect(worksheet().cells.B3).toBe("800");
    expect(worksheet().cells.B4).toBe("700");
    expect(worksheet().cells.C2).toBe("Open");
  });

  it("keeps the dialog open and explains an empty allowed-value list", async () => {
    const { user } = await openEditor();
    await dragRange(user, "A2", "A4");
    const dialog = await openValidationDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Enter at least one allowed value")).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "Data validation" })).not.toBeNull();
    expect(worksheet().validations).toEqual([]);
  });
});

describe("numeric range validation", () => {
  it("applies an inclusive rule with the dialog wording, then prefills and deletes it", async () => {
    const { user, view } = await openEditor();
    await dragRange(user, "B2", "B4");
    const dialog = await openValidationDialog(user);

    await user.click(within(dialog).getByRole("combobox", { name: "Rule type" }));
    await user.click(await screen.findByRole("option", { name: "Number range" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Minimum" }), "0");
    await user.type(within(dialog).getByRole("textbox", { name: "Maximum" }), "100");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(worksheet().validations?.[0]).toEqual({
      id: expect.any(String),
      type: "numeric",
      min: 0,
      max: 100,
      range: { minRow: 1, maxRow: 3, minCol: 1, maxCol: 1 },
      style: "between",
    });
    // Saving a rule leaves the existing out-of-range seed value untouched.
    expect(worksheet().cells.B2).toBe("1200");

    await editCell(user, "B2", "100");
    await waitFor(() => expect(worksheet().cells.B2).toBe("100"));
    await editCell(user, "B2", "101");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Please enter a number between 0 and 100"),
    );
    expect(worksheet().cells.B2).toBe("100");
    expect(gridCell("B2").textContent).toBe("100");

    // Reopening the rule prefills it and offers the removal.
    await user.click(gridCell("B3"));
    const reopened = await openValidationDialog(user);
    expect(
      (within(reopened).getByRole("combobox", { name: "Rule type" }) as HTMLInputElement).value,
    ).toBe("Number range");
    expect((within(reopened).getByRole("textbox", { name: "Minimum" }) as HTMLInputElement).value).toBe("0");
    expect((within(reopened).getByRole("textbox", { name: "Maximum" }) as HTMLInputElement).value).toBe("100");
    await user.click(within(reopened).getByRole("button", { name: "Delete rule" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(worksheet().validations).toEqual([]);
    expect(worksheet().cells.B2).toBe("100");

    await editCell(user, "B2", "101");
    await waitFor(() => expect(worksheet().cells.B2).toBe("101"));

    view.unmount();
  });

  it("rejects a bulk operation entirely when any target is invalid", async () => {
    const { user } = await openEditor();
    await dragRange(user, "B2", "B4");
    const dialog = await openValidationDialog(user);
    await user.click(within(dialog).getByRole("combobox", { name: "Rule type" }));
    await user.click(await screen.findByRole("option", { name: "Number range" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Minimum" }), "0");
    await user.type(within(dialog).getByRole("textbox", { name: "Maximum" }), "100");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.paste(gridCell("B2"), { clipboardData: { getData: () => "50\n101" } });

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Please enter a number between 0 and 100"),
    );
    expect(worksheet().cells.B2).toBe("1200");
    expect(worksheet().cells.B3).toBe("800");
  });

  it("reports a minimum above the maximum without saving", async () => {
    const { user } = await openEditor();
    await dragRange(user, "B2", "B4");
    const dialog = await openValidationDialog(user);
    await user.click(within(dialog).getByRole("combobox", { name: "Rule type" }));
    await user.click(await screen.findByRole("option", { name: "Number range" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Minimum" }), "100");
    await user.type(within(dialog).getByRole("textbox", { name: "Maximum" }), "10");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText("The minimum must not be greater than the maximum"),
    ).not.toBeNull();
    expect(worksheet().validations).toEqual([]);
  });
});
