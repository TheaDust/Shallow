import { render, screen, waitFor, within } from "@testing-library/react";
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

function workbook(): (typeof backend.workbooks)[number] {
  return backend.workbooks[0];
}

function grid(): HTMLElement {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function gridCell(name: string): HTMLElement {
  return within(grid()).getByRole("gridcell", { name });
}

/** Opens the tab menu of `name` and clicks the `Delete` command. */
async function requestDelete(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: `Worksheet options for ${name}` }));
  await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
}

/** Creates a pivot table over A1:C4 of the current worksheet (Pivot1). */
async function createPivot(user: ReturnType<typeof userEvent.setup>) {
  await user.pointer([
    { keys: "[MouseLeft>]", target: gridCell("A1") },
    { target: gridCell("C4") },
    { keys: "[/MouseLeft]" },
  ]);
  await user.click(screen.getByRole("button", { name: "Data" }));
  await user.click(await screen.findByRole("menuitem", { name: "Create pivot table" }));
  const dialog = await screen.findByRole("dialog", { name: "Create pivot table" });
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
  await screen.findByRole("region", { name: "Pivot table editor" });
}

describe("deleting a worksheet", () => {
  it("removes the target tab and activates an adjacent worksheet, persisting the deletion", async () => {
    const { user, view } = await openEditor();

    await requestDelete(user, "Sheet2");
    const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
    expect(within(dialog).getByText(/"Sheet2"/)).not.toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    await waitFor(() => expect(screen.queryByRole("tab", { name: "Sheet2" })).toBeNull());
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    expect(gridCell("B2").textContent).toBe("1200");
    await waitFor(() => expect(workbook().worksheets).toHaveLength(1));
    expect(workbook().activeWorksheetId).toBe("workbook-q3-sales-sheet-1");

    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(screen.queryByRole("tab", { name: "Sheet2" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
  });

  it("activates the previous tab when the deleted worksheet was the active one", async () => {
    const { user } = await openEditor();
    await user.click(screen.getByRole("button", { name: "Add worksheet" }));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
    await screen.findByRole("tab", { name: "Sheet3", selected: true });

    await requestDelete(user, "Sheet3");
    const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    await waitFor(() => expect(screen.queryByRole("tab", { name: "Sheet3" })).toBeNull());
    expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true");
  });

  it("refuses the only remaining worksheet without opening a confirmation dialog", async () => {
    backend = createMockBackend([
      {
        ...seedWorkbook(),
        worksheets: [seedWorkbook().worksheets[0]],
        activeWorksheetId: "workbook-q3-sales-sheet-1",
      },
    ]);
    vi.stubGlobal("fetch", backend.fetchImpl);

    const { user } = await openEditor();
    await requestDelete(user, "Sheet1");

    expect(await screen.findByText("A workbook must contain at least one worksheet")).not.toBeNull();
    expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Sheet1" })).not.toBeNull();
    expect(gridCell("B2").textContent).toBe("1200");
  });

  it("rejects deleting a pivot source worksheet and keeps both worksheets", async () => {
    const { user } = await openEditor();
    await createPivot(user);

    await requestDelete(user, "Sheet1");
    const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    expect(
      await screen.findByText("Please delete or rebuild dependent pivot tables first"),
    ).not.toBeNull();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull(),
    );
    expect(screen.getByRole("tab", { name: "Sheet1" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Pivot1" })).not.toBeNull();
    expect(workbook().worksheets).toHaveLength(3);
    expect(workbook().worksheets[0].cells.A2).toBe("East");
    expect(workbook().worksheets[2].cells.B2).toBe("1200");
  });

  it("deletes a pivot result worksheet and frees its source worksheet", async () => {
    const { user } = await openEditor();
    await createPivot(user);

    await requestDelete(user, "Pivot1");
    const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    await waitFor(() => expect(screen.queryByRole("tab", { name: "Pivot1" })).toBeNull());
    await waitFor(() => expect(workbook().pivots ?? []).toHaveLength(0));
    expect(screen.queryByRole("region", { name: "Pivot table editor" })).toBeNull();

    // The source worksheet is no longer a pivot source, so it can be deleted.
    await requestDelete(user, "Sheet1");
    const second = await screen.findByRole("dialog", { name: "Delete worksheet" });
    await user.click(within(second).getByRole("button", { name: "Delete worksheet" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Sheet1" })).toBeNull());
    expect(workbook().worksheets.map((entry) => entry.name)).toEqual(["Sheet2"]);
  });
});
