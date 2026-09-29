import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbookEditorPage } from "../WorkbookEditorPage";
import { workbookFixture } from "./helpers";
import { stubSheetServer } from "./sheetServer";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.location.hash = "#/workbooks/wb-q3-sales";
});

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function cell(address: string) {
  return within(grid()).getByRole("gridcell", { name: address });
}

type Server = ReturnType<typeof stubSheetServer>;

function ruleRequests(server: Server) {
  return server.calls.filter((call) => call.method === "PATCH" && Array.isArray(call.body?.validations));
}

async function openEditor(server: Server) {
  render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
  await screen.findByRole("heading", { name: "Q3 Sales" });
  return server;
}

async function openDataValidation() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Data" }));
  await user.click(await screen.findByRole("menuitem", { name: "Data validation" }));
  return screen.findByRole("dialog", { name: "Data validation" });
}

describe("configuring data validation for a range", () => {
  it("saves a dropdown rule, offers its options and rejects other input", async () => {
    const user = userEvent.setup();
    const server = await openEditor(stubSheetServer(workbookFixture()));

    await user.click(cell("A2"));
    const dialog = await openDataValidation();
    expect(within(dialog).getByRole("combobox", { name: "Rule type" })).toBeTruthy();
    await user.type(within(dialog).getByLabelText("Allowed values"), " East , North , South ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(ruleRequests(server)).toHaveLength(1);
    expect(ruleRequests(server)[0].body).toEqual({
      validations: [
        {
          id: "rule-1",
          range: { start: "A2", end: "A2" },
          type: "dropdown",
          values: ["East", "North", "South"],
          message: "Please select one of the following values: East, North, South",
        },
      ],
    });
    // The saved rule never changes the existing value of the cell.
    expect(server.sheet().cells.A2).toBe("East");

    // A dropdown cell provides its own entry point with the ARIA option role.
    const trigger = screen.getByRole("button", { name: "Open dropdown for A2" });
    await user.click(trigger);
    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["East", "North", "South"]);
    expect(within(listbox).getByRole("option", { name: "East" }).getAttribute("aria-selected")).toBe("true");

    await user.click(within(listbox).getByRole("option", { name: "North" }));
    await waitFor(() => expect(cell("A2").textContent).toBe("North"));
    expect(server.sheet().cells.A2).toBe("North");

    // An invalid value through the grid is rejected and the original value stays.
    await user.dblClick(cell("A2"));
    const editor = screen.getByRole("textbox", { name: "Edit A2" });
    await user.clear(editor);
    await user.type(editor, "West");
    fireEvent.keyDown(editor, { key: "Enter" });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Please select one of the following values: East, North, South");
    expect(cell("A2").textContent).toBe("North");
    expect(server.sheet().cells.A2).toBe("North");
  });

  it("prefills an existing rule and deletes it without touching the cell values", async () => {
    const user = userEvent.setup();
    const server = await openEditor(stubSheetServer(workbookFixture()));

    await user.click(cell("A2"));
    let dialog = await openDataValidation();
    await user.type(within(dialog).getByLabelText("Allowed values"), "East, North, South");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(cell("A3"));
    dialog = await openDataValidation();
    // The rule of A2 does not cover A3 yet, so a new one is configured there.
    await user.type(within(dialog).getByLabelText("Allowed values"), "North, South");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(ruleRequests(server)).toHaveLength(2));

    // Reopening shows the stored rule with its type, parameters and Delete rule.
    dialog = await openDataValidation();
    expect((within(dialog).getByLabelText("Allowed values") as HTMLInputElement).value).toBe("North, South");
    await user.click(within(dialog).getByRole("button", { name: "Delete rule" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(ruleRequests(server).at(-1)!.body).toEqual({
      validations: [
        {
          id: "rule-1",
          range: { start: "A2", end: "A2" },
          type: "dropdown",
          values: ["East", "North", "South"],
          message: "Please select one of the following values: East, North, South",
        },
      ],
    });
    // Existing cell values stay untouched by deleting the rule.
    expect(server.sheet().cells.A3).toBe("North");
  });

  it("saves an inclusive number range and reports an out-of-range entry", async () => {
    const user = userEvent.setup();
    const server = await openEditor(stubSheetServer(workbookFixture()));

    await user.click(cell("B2"));
    const dialog = await openDataValidation();
    const ruleType = within(dialog).getByRole("combobox", { name: "Rule type" });
    await user.selectOptions(ruleType, "number-range");
    await user.type(within(dialog).getByLabelText("Minimum"), "0");
    await user.type(within(dialog).getByLabelText("Maximum"), "100");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(ruleRequests(server).at(-1)!.body).toEqual({
      validations: [
        {
          id: "rule-1",
          range: { start: "B2", end: "B2" },
          type: "number-between",
          min: 0,
          max: 100,
          message: "Please enter a number between 0 and 100",
        },
      ],
    });

    await user.dblClick(cell("B2"));
    const editor = screen.getByRole("textbox", { name: "Edit B2" });
    await user.clear(editor);
    await user.type(editor, "101");
    fireEvent.keyDown(editor, { key: "Enter" });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Please enter a number between 0 and 100");
    // The whole operation is rejected: the stored value is unchanged.
    expect(server.sheet().cells.B2).toBe("1200");
    expect(cell("B2").textContent).toBe("1200");
  });
});
