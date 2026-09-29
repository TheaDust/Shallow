import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../../App";
import { WorkbookEditorPage } from "../WorkbookEditorPage";
import { stubFetch, summaryFixture, workbookFixture } from "./helpers";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  window.location.hash = "#/workbooks/wb-q3-sales";
});

function seedWith(overrides: Parameters<typeof workbookFixture>[0]) {
  return workbookFixture(overrides);
}

const SHEET3 = { id: "ws-q3-sheet3", name: "Sheet3", activeCell: "A1", cells: {} };

describe("worksheet tab bar", () => {
  it("offers an Add worksheet button and one options button per worksheet", async () => {
    const user = userEvent.setup();
    stubFetch((request) =>
      request.method === "GET" && request.path === "/api/workbooks/wb-q3-sales"
        ? { body: { workbook: workbookFixture() } }
        : undefined,
    );
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    expect(screen.getByRole("button", { name: "Add worksheet" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Worksheet options for Sheet1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Worksheet options for Sheet2" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
  });
});

describe("add a worksheet", () => {
  function addStub(extra: (request: { method: string; path: string; body: any }) => unknown = () => undefined) {
    const current = workbookFixture();
    return stubFetch((request) => {
      const custom = extra(request);
      if (custom) return custom as never;
      if (request.method === "GET" && request.path === "/api/workbooks/wb-q3-sales") {
        return { body: { workbook: current } };
      }
      if (request.method === "POST" && request.path === "/api/workbooks/wb-q3-sales/worksheets") {
        const added = seedWith({
          activeWorksheetId: SHEET3.id,
          worksheets: [...current.worksheets, SHEET3],
        });
        Object.assign(current, added);
        return { status: 201, body: { workbook: added } };
      }
      if (request.method === "PATCH" && request.path === "/api/workbooks/wb-q3-sales") {
        Object.assign(current, { activeWorksheetId: request.body.activeWorksheetId });
        return { body: { workbook: { ...current } } };
      }
      return undefined;
    });
  }

  it("appends the next SheetN tab, activates it with A1 selected and keeps the other sheets' data", async () => {
    const user = userEvent.setup();
    const { calls } = addStub();
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2", "Sheet3"]);
    expect(screen.getByRole("tab", { name: "Sheet3" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("false");

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("");
    expect(within(grid).getByRole("gridcell", { name: "A2" }).textContent).toBe("");
    expect(within(grid).getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByLabelText("Formula bar") as HTMLInputElement).value).toBe("");

    expect(calls.some((call) => call.method === "POST" && call.path.endsWith("/worksheets"))).toBe(true);

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(within(grid).getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");

    // Reopening the workbook shows the added worksheet again.
    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2", "Sheet3"]);
  });

  it("shows the failure and leaves the existing tabs untouched when adding fails", async () => {
    const user = userEvent.setup();
    addStub((request) =>
      request.method === "POST" && request.path === "/api/workbooks/wb-q3-sales/worksheets"
        ? { status: 500, body: { error: "Unable to add worksheet" } }
        : undefined,
    );
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Unable to add worksheet");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2"]);
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
  });
});

describe("rename a worksheet", () => {
  function renameStub(nextName: string) {
    const current = workbookFixture();
    const stub = stubFetch((request) => {
      if (request.method === "GET" && request.path === "/api/workbooks/wb-q3-sales") {
        return { body: { workbook: current } };
      }
      if (request.method === "PATCH" && request.path === "/api/workbooks/wb-q3-sales/worksheets/ws-q3-sheet1") {
        const renamed = seedWith({
          worksheets: current.worksheets.map((sheet) =>
            sheet.id === "ws-q3-sheet1" ? { ...sheet, name: nextName } : sheet,
          ),
        });
        Object.assign(current, renamed);
        return { body: { workbook: renamed } };
      }
      return undefined;
    });
    return stub;
  }

  async function openRenameDialog(user: ReturnType<typeof userEvent.setup>, worksheetName = "Sheet1") {
    await user.click(screen.getByRole("button", { name: `Worksheet options for ${worksheetName}` }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    return screen.getByRole("dialog", { name: "Rename worksheet" });
  }

  it("opens a prefilled Rename worksheet dialog from the tab menu and saves the new name", async () => {
    const user = userEvent.setup();
    const { calls } = renameStub("Regional sales");
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    const dialog = await openRenameDialog(user);
    const input = within(dialog).getByLabelText("Worksheet name") as HTMLInputElement;
    expect(input.value).toBe("Sheet1");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeTruthy();

    await user.clear(input);
    await user.type(input, "  Regional sales  ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("tab", { name: "Regional sales" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Regional sales" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("tab", { name: "Sheet1" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Worksheet options for Regional sales" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.some((call) => call.method === "PATCH" && call.body?.name === "  Regional sales  ")).toBe(true);

    // Refreshing the editor shows the most recently saved name.
    cleanup();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });
    expect(screen.getByRole("tab", { name: "Regional sales" })).toBeTruthy();
  });

  it("reuses the full entry path from the workbook home page and persists the new name", async () => {
    const user = userEvent.setup();
    let current = workbookFixture();
    window.location.hash = "#/";
    stubFetch((request) => {
      if (request.method === "GET" && request.path === "/api/workbooks") {
        return { body: { workbooks: [summaryFixture({ name: current.name })] } };
      }
      if (request.method === "GET" && request.path === "/api/workbooks/wb-q3-sales") {
        return { body: { workbook: current } };
      }
      if (request.method === "PATCH" && request.path.endsWith("/worksheets/ws-q3-sheet1")) {
        current = seedWith({
          worksheets: current.worksheets.map((sheet) =>
            sheet.id === "ws-q3-sheet1" ? { ...sheet, name: "Regional sales" } : sheet,
          ),
        });
        return { body: { workbook: current } };
      }
      return undefined;
    });
    render(<App />);

    expect(await screen.findByRole("link", { name: "Q3 Sales" })).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Q3 Sales" }));
    await screen.findByRole("heading", { name: "Q3 Sales" });

    const dialog = await openRenameDialog(user);
    const input = within(dialog).getByLabelText("Worksheet name");
    await user.clear(input);
    await user.type(input, "Regional sales");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findByRole("tab", { name: "Regional sales" });

    await user.click(screen.getByRole("link", { name: "All workbooks" }));
    await screen.findByRole("link", { name: "Q3 Sales" });
    await user.click(screen.getByRole("link", { name: "Q3 Sales" }));
    await screen.findByRole("heading", { name: "Q3 Sales" });
    expect(screen.getByRole("tab", { name: "Regional sales" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeTruthy();
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
  });

  it("rejects an empty name beside the control without calling the server", async () => {
    const user = userEvent.setup();
    const { calls } = renameStub("Should not be saved");
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    const dialog = await openRenameDialog(user);
    const input = within(dialog).getByLabelText("Worksheet name");
    await user.clear(input);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Worksheet name cannot be empty");
    await user.type(input, "   ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe("Worksheet name cannot be empty");

    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeTruthy();
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("rejects a name that another worksheet of the same workbook already uses", async () => {
    const user = userEvent.setup();
    const { calls } = renameStub("Should not be saved");
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    const dialog = await openRenameDialog(user);
    const input = within(dialog).getByLabelText("Worksheet name");
    await user.clear(input);
    await user.type(input, "  Sheet2  ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Worksheet name already exists");
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeTruthy();
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("shows the server failure and keeps the original name when the save request fails", async () => {
    const user = userEvent.setup();
    stubFetch((request) => {
      if (request.method === "GET" && request.path === "/api/workbooks/wb-q3-sales") {
        return { body: { workbook: workbookFixture() } };
      }
      if (request.method === "PATCH" && request.path.endsWith("/worksheets/ws-q3-sheet1")) {
        return { status: 500, body: { error: "Unable to save the worksheet" } };
      }
      return undefined;
    });
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    const dialog = await openRenameDialog(user);
    const input = within(dialog).getByLabelText("Worksheet name");
    await user.clear(input);
    await user.type(input, "Broken rename");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Unable to save the worksheet");
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Broken rename" })).toBeNull();
  });
});
