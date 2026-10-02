import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFakeBackend, type FakeBackend } from "../test/fake-backend";
import { WorkbookEditorPage } from "./WorkbookEditorPage";

/** Drags from one corner to the diagonally opposite cell of a rectangle. */
function selectRange(from: string, to: string): void {
  fireEvent.pointerDown(screen.getByRole("gridcell", { name: from }), { button: 0, buttons: 1 });
  fireEvent.pointerEnter(screen.getByRole("gridcell", { name: to }), { buttons: 1 });
  fireEvent.pointerUp(window);
}

describe("data validation", () => {
  let backend: FakeBackend;

  beforeEach(() => {
    backend = installFakeBackend();
    vi.stubGlobal("fetch", backend.fetch);
    window.location.hash = "#/workbooks/q3-sales";
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function runDataCommand(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
    await user.click(screen.getByRole("button", { name: "Data" }));
    const menu = await screen.findByRole("menu", { name: "Data" });
    await user.click(within(menu).getByRole("menuitem", { name }));
  }

  async function createDropdown(
    user: ReturnType<typeof userEvent.setup>,
    allowed: string,
  ): Promise<void> {
    await runDataCommand(user, "Data validation");
    const dialog = await screen.findByRole("dialog", { name: "Data validation" });
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Rule type" }),
      within(dialog).getByRole("option", { name: "Dropdown" }),
    );
    await user.type(within(dialog).getByRole("textbox", { name: "Allowed values" }), allowed);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data validation" })).toBeNull());
  }

  it("saves a dropdown rule, offers its options and rejects a value outside the list", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    selectRange("B2", "B3");
    await createDropdown(user, " Open , Closed ");

    // The trimmed items are the stored allowed values of the selected range.
    expect(backend.workbooks[0].worksheets[0].validations).toEqual([
      { range: "B2:B3", type: "list", values: ["Open", "Closed"] },
    ]);

    // Every cell of the range provides its own dropdown button.
    expect(screen.getByRole("button", { name: "Open dropdown for B2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open dropdown for B3" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open dropdown for B4" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open dropdown for B2" }));
    const list = await screen.findByRole("listbox", { name: "Options for B2" });
    expect(within(list).getAllByRole("option").map((option) => option.textContent)).toEqual(["Open", "Closed"]);
    await user.click(within(list).getByRole("option", { name: "Closed" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("Closed"));
    expect(backend.workbooks[0].worksheets[0].cells.B2).toBe("Closed");

    // A value typed through the formula bar is rejected atomically.
    await user.click(screen.getByRole("gridcell", { name: "B3" }));
    const bar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.clear(bar);
    await user.type(bar, "Whatever{Enter}");
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Please select one of the following values: Open, Closed",
    );
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toBe("800");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "800");
    expect(backend.workbooks[0].worksheets[0].cells.B3).toBe("800");

    // The rule and its dropdown buttons survive reopening the workbook.
    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });
    expect(screen.getByRole("button", { name: "Open dropdown for B3" })).toBeTruthy();
  });

  it("rejects a number outside the saved range and deletes the rule again", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    selectRange("B2", "B3");
    await runDataCommand(user, "Data validation");
    const dialog = await screen.findByRole("dialog", { name: "Data validation" });
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Rule type" }),
      within(dialog).getByRole("option", { name: "Number range" }),
    );
    await user.type(within(dialog).getByRole("textbox", { name: "Minimum" }), "0");
    await user.type(within(dialog).getByRole("textbox", { name: "Maximum" }), "100");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data validation" })).toBeNull());

    await user.click(screen.getByRole("gridcell", { name: "B3" }));
    const bar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.clear(bar);
    await user.type(bar, "101{Enter}");
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Please enter a number from 0 to 100",
    );
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toBe("800");
    // The existing values stay as they are: only later writes are constrained.
    expect(backend.workbooks[0].worksheets[0].cells.B2).toBe("1200");

    // Reopening the dialog on a constrained cell prefills the rule.
    await runDataCommand(user, "Data validation");
    const reopened = await screen.findByRole("dialog", { name: "Data validation" });
    expect((within(reopened).getByRole("combobox", { name: "Rule type" }) as HTMLSelectElement).value).toBe("number-between");
    expect((within(reopened).getByRole("textbox", { name: "Minimum" }) as HTMLInputElement).value).toBe("0");
    expect((within(reopened).getByRole("textbox", { name: "Maximum" }) as HTMLInputElement).value).toBe("100");

    await user.click(within(reopened).getByRole("button", { name: "Delete rule" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data validation" })).toBeNull());
    expect(backend.workbooks[0].worksheets[0].validations).toBeUndefined();

    await user.clear(bar);
    await user.type(bar, "101{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toBe("101"));
  });

  it("keeps a dropdown rule attached to its cells across a row change", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    selectRange("B2", "B3");
    await createDropdown(user, "Open,Closed");
    expect(screen.getByRole("button", { name: "Open dropdown for B2" })).toBeTruthy();

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "2" }), { clientX: 40, clientY: 60 });
    await user.click(await screen.findByRole("menuitem", { name: "Insert 1 row above" }));

    // The blank row took B2, so the constrained cells moved down with the rule.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Open dropdown for B2" })).toBeNull());
    expect(screen.getByRole("button", { name: "Open dropdown for B3" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open dropdown for B4" })).toBeTruthy();
    expect(backend.workbooks[0].worksheets[0].validations).toEqual([
      { range: "B3:B4", type: "list", values: ["Open", "Closed"] },
    ]);
  });

  it("shows a field error instead of saving an incomplete rule", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    selectRange("A2", "A2");
    await runDataCommand(user, "Data validation");
    const dialog = await screen.findByRole("dialog", { name: "Data validation" });
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Rule type" }),
      within(dialog).getByRole("option", { name: "Dropdown" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(within(dialog).getByRole("alert")).toHaveProperty("textContent", "Enter at least one allowed value.");
    expect(backend.workbooks[0].worksheets[0].validations).toBeUndefined();
  });
});
