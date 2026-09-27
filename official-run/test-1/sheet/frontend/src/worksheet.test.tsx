import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { installApiMock } from "./test/apiMock";

const mock = installApiMock();

function renderApp() {
  return render(<App />);
}

beforeEach(() => {
  window.location.hash = "#/";
  mock.reset();
});

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
}

async function openRenameDialog(user: ReturnType<typeof userEvent.setup>, sheetName: string) {
  await user.click(screen.getByRole("button", { name: `Worksheet options for ${sheetName}` }));
  await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
  return await screen.findByRole("dialog", { name: "Rename worksheet" });
}

describe("REQ-2-1-3 rename a worksheet", () => {
  it("every worksheet tab provides a 'Worksheet options for <name>' button", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    expect(screen.getByRole("button", { name: "Worksheet options for Sheet1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Worksheet options for Sheet2" })).toBeInTheDocument();
  });

  it("the options button opens a menu whose Rename command uses the menuitem role", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet2" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    const rename = screen.getByRole("menuitem", { name: "Rename" });
    expect(rename).toBeInTheDocument();
    // Escape closes the menu again
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Rename opens the 'Rename worksheet' dialog prefilled with the current name and a Save button", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const dialog = await openRenameDialog(user, "Sheet2");
    const input = within(dialog).getByLabelText("Worksheet name");
    expect(input).toHaveValue("Sheet2");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("saving a trimmed new name updates the tab, survives refresh, and renames the options button", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await openEditor(user);
    const dialog = await openRenameDialog(user, "Sheet2");
    const input = within(dialog).getByLabelText("Worksheet name");
    await user.clear(input);
    await user.type(input, "  Data  ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "Data" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Sheet2" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Worksheet options for Data" })).toBeInTheDocument();
    // order and the other sheet are unchanged
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeInTheDocument();

    unmount();
    renderApp(); // same editor hash; the mock store keeps the renamed sheet
    expect(await screen.findByRole("tab", { name: "Data" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Sheet2" })).not.toBeInTheDocument();
  });

  it("an empty name shows 'Worksheet name cannot be empty' and the original name remains", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const dialog = await openRenameDialog(user, "Sheet2");
    const input = within(dialog).getByLabelText("Worksheet name");
    await user.clear(input);
    await user.type(input, "   ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Worksheet name cannot be empty");
    expect(screen.getByRole("dialog", { name: "Rename worksheet" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Sheet1" })).toBeInTheDocument();
  });

  it("a duplicate name shows 'Worksheet name already exists' and the original name remains", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const dialog = await openRenameDialog(user, "Sheet2");
    const input = within(dialog).getByLabelText("Worksheet name");
    await user.clear(input);
    await user.type(input, "Sheet1");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Worksheet name already exists");
    expect(screen.getByRole("dialog", { name: "Rename worksheet" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeInTheDocument();
  });
});

describe("REQ-2-1-1 add a worksheet", () => {
  it("the tab bar provides a button with the accessible name 'Add worksheet'", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    expect(screen.getByRole("button", { name: "Add worksheet" })).toBeInTheDocument();
  });

  it("adding a worksheet appends the first unused SheetN, becomes active with A1 selected, and is blank", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    expect(screen.getByRole("tab", { name: "Sheet1" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    const newTab = await screen.findByRole("tab", { name: "Sheet3" });
    expect(newTab).toHaveAttribute("aria-selected", "true");
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    const cellA1 = within(grid).getByRole("gridcell", { name: "A1" });
    expect(cellA1).toHaveAttribute("aria-selected", "true");
    expect(cellA1).toHaveTextContent("");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("");
  });

  it("existing worksheets and their data remain unchanged after adding", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    await user.click(screen.getByRole("button", { name: "Add worksheet" }));
    await screen.findByRole("tab", { name: "Sheet3" });

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" })).toHaveTextContent("Item");
    expect(within(grid).getByRole("gridcell", { name: "B1" })).toHaveTextContent("Qty");
    expect(within(grid).getByRole("gridcell", { name: "A2" })).toHaveTextContent("Pen");
    expect(within(grid).getByRole("gridcell", { name: "B2" })).toHaveTextContent("4");
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeInTheDocument();
  });

  it("the new tab persists after refresh and stays active", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await openEditor(user);
    await user.click(screen.getByRole("button", { name: "Add worksheet" }));
    await screen.findByRole("tab", { name: "Sheet3" });

    unmount();
    renderApp(); // same editor hash; the mock store keeps the added sheet
    const tab = await screen.findByRole("tab", { name: "Sheet3" });
    expect(tab).toHaveAttribute("aria-selected", "true");
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(grid).getByRole("gridcell", { name: "A1" })).toHaveTextContent("");
  });

  it("a failed add shows an error, creates no new tab, and leaves existing worksheets unchanged", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    mock.failNextAddSheet = "Adding a worksheet failed";

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Adding a worksheet failed");
    expect(screen.queryByRole("tab", { name: "Sheet3" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeInTheDocument();
  });
});
