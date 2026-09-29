import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbookEditorPage } from "../WorkbookEditorPage";
import { SEED_UPDATED_TEXT, stubFetch, workbookFixture } from "./helpers";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  window.location.hash = "#/workbooks/wb-q3-sales";
});

describe("workbook editor page", () => {
  it("restores the opened workbook identity, tabs, grid and formula bar", async () => {
    stubFetch((request) =>
      request.method === "GET" && request.path === "/api/workbooks/wb-q3-sales"
        ? { body: { workbook: workbookFixture() } }
        : undefined,
    );
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);

    expect(await screen.findByRole("heading", { name: "Q3 Sales" })).toBeTruthy();
    expect(screen.getByText(`Last updated: ${SEED_UPDATED_TEXT}`)).toBeTruthy();
    expect(document.querySelectorAll("main")).toHaveLength(1);

    const sheet1 = screen.getByRole("tab", { name: "Sheet1" });
    const sheet2 = screen.getByRole("tab", { name: "Sheet2" });
    expect(sheet1.getAttribute("aria-selected")).toBe("true");
    expect(sheet2.getAttribute("aria-selected")).toBe("false");
    expect(sheet1.getAttribute("aria-controls")).toBe(sheet2.getAttribute("aria-controls"));

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(grid.getAttribute("aria-multiselectable")).toBe("true");

    const a1 = within(grid).getByRole("gridcell", { name: "A1" });
    expect(a1.textContent).toBe("Region");
    expect(a1.getAttribute("aria-selected")).toBe("true");
    expect(within(grid).getByRole("gridcell", { name: "B1" }).getAttribute("aria-selected")).toBe("false");
    expect(within(grid).getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");

    expect((screen.getByLabelText("Formula bar") as HTMLInputElement).value).toBe("Region");
  });

  it("keeps other workbook data out of the grid and shows a busy state until the workbook is ready", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    stubFetch((request) => {
      if (request.method === "GET" && request.path === "/api/workbooks/wb-q3-sales") {
        return gate.then(() => ({ body: { workbook: workbookFixture() } }));
      }
      return undefined;
    });
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);

    expect(screen.getByRole("status").textContent).toContain("Loading workbook");
    expect(screen.queryByRole("grid")).toBeNull();
    release();

    const grid = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(20 * 40);
    expect(within(grid).queryByText("Sheet2 only")).toBeNull();
  });

  it("reports an unreadable workbook entry with a retry action", async () => {
    stubFetch((request) =>
      request.method === "GET" && request.path === "/api/workbooks/wb-missing"
        ? { status: 404, body: { error: "Workbook not found" } }
        : undefined,
    );
    render(<WorkbookEditorPage workbookId="wb-missing" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Workbook not found");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "All workbooks" }).getAttribute("href")).toBe("#/");
  });

  it("selects a cell, updates the formula bar and persists the selected cell", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture();
    const { calls } = stubFetch((request) => {
      if (request.method === "GET") return { body: { workbook: seed } };
      if (request.method === "PATCH" && request.path.endsWith("/worksheets/ws-q3-sheet1")) {
        return {
          body: {
            workbook: workbookFixture({
              worksheets: seed.worksheets.map((sheet) =>
                sheet.id === "ws-q3-sheet1" ? { ...sheet, activeCell: "B2" } : sheet,
              ),
            }),
          },
        };
      }
      return undefined;
    });
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    await user.click(within(grid).getByRole("gridcell", { name: "B2" }));

    expect(within(grid).getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe("true");
    expect(within(grid).getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("false");
    expect((screen.getByLabelText("Formula bar") as HTMLInputElement).value).toBe("1200");
    await waitFor(() =>
      expect(calls.some((call) => call.body?.activeCell === "B2")).toBe(true),
    );
  });

  it("switches worksheets, shows that worksheet's own grid and persists the active tab", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture({
      worksheets: [
        workbookFixture().worksheets[0],
        { id: "ws-q3-sheet2", name: "Sheet2", activeCell: "A1", cells: { A1: "Sheet2 only" } },
      ],
    });
    const { calls } = stubFetch((request) => {
      if (request.method === "GET") return { body: { workbook: seed } };
      if (request.method === "PATCH" && request.path === "/api/workbooks/wb-q3-sales") {
        return { body: { workbook: { ...seed, activeWorksheetId: "ws-q3-sheet2" } } };
      }
      return undefined;
    });
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Sheet2 only");
    expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("false");
    await waitFor(() =>
      expect(calls.some((call) => call.body?.activeWorksheetId === "ws-q3-sheet2")).toBe(true),
    );
  });
});
