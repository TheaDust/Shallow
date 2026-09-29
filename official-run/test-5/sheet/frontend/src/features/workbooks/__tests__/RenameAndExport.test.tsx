import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../../App";
import { WorkbookEditorPage } from "../WorkbookEditorPage";
import { stubFetch, summaryFixture, workbookFixture } from "./helpers";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.location.hash = "#/workbooks/wb-q3-sales";
});

function editorStub(overrides: Parameters<typeof workbookFixture>[0] = {}) {
  const seed = workbookFixture(overrides);
  return stubFetch((request) => {
    if (request.method === "GET" && request.path === "/api/workbooks/wb-q3-sales") {
      return { body: { workbook: seed } };
    }
    return undefined;
  });
}

describe("rename a workbook", () => {
  it("offers a Rename workbook control next to the title that reveals a prefilled name box and Save", async () => {
    const user = userEvent.setup();
    editorStub();
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    expect(screen.queryByLabelText("Workbook name")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Rename workbook" }));

    const input = screen.getByLabelText("Workbook name") as HTMLInputElement;
    expect(input.value).toBe("Q3 Sales");
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Q3 Sales" })).toBeTruthy();
  });

  it("saves the trimmed name and shows it on the editor title and the home page link", async () => {
    const user = userEvent.setup();
    const renamed = workbookFixture({ name: "Q3 Sales 2026" });
    const { calls } = stubFetch((request) => {
      if (request.method === "GET" && request.path === "/api/workbooks/wb-q3-sales") {
        return { body: { workbook: workbookFixture() } };
      }
      if (request.method === "PATCH" && request.path === "/api/workbooks/wb-q3-sales") {
        return { body: { workbook: renamed } };
      }
      if (request.method === "GET" && request.path === "/api/workbooks") {
        return { body: { workbooks: [summaryFixture({ name: renamed.name })] } };
      }
      return undefined;
    });
    render(<App />);

    await screen.findByRole("heading", { name: "Q3 Sales" });
    await user.click(screen.getByRole("button", { name: "Rename workbook" }));
    const input = screen.getByLabelText("Workbook name");
    await user.clear(input);
    await user.type(input, "  Q3 Sales 2026  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Q3 Sales 2026" })).toBeTruthy();
    await waitFor(() =>
      expect(calls.some((call) => call.method === "PATCH" && call.body?.name === "  Q3 Sales 2026  ")).toBe(true),
    );

    await user.click(screen.getByRole("link", { name: "All workbooks" }));
    expect(await screen.findByRole("link", { name: "Q3 Sales 2026" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Q3 Sales" })).toBeNull();
  });

  it("rejects an empty name beside the control without calling the server", async () => {
    const user = userEvent.setup();
    const { calls } = editorStub();
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    await user.click(screen.getByRole("button", { name: "Rename workbook" }));
    const input = screen.getByLabelText("Workbook name");
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Workbook name cannot be empty");
    expect(screen.getByRole("heading", { name: "Q3 Sales" })).toBeTruthy();
    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("heading", { name: "Q3 Sales" })).toBeTruthy();
    expect(calls.some((call) => call.method !== "GET")).toBe(false);
  });

  it("shows the failure and keeps the saved name when the save request fails", async () => {
    const user = userEvent.setup();
    stubFetch((request) => {
      if (request.method === "GET" && request.path === "/api/workbooks/wb-q3-sales") {
        return { body: { workbook: workbookFixture() } };
      }
      if (request.method === "PATCH") {
        return { status: 500, body: { error: "Unable to save the workbook" } };
      }
      return undefined;
    });
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    await user.click(screen.getByRole("button", { name: "Rename workbook" }));
    const input = screen.getByLabelText("Workbook name");
    await user.clear(input);
    await user.type(input, "Broken rename");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Unable to save the workbook");
    expect(screen.getByRole("heading", { name: "Q3 Sales" })).toBeTruthy();
    expect((screen.getByLabelText("Workbook name") as HTMLInputElement).value).toBe("Broken rename");
  });
});

describe("export the current worksheet as CSV", () => {
  it("downloads the active worksheet and leaves the grid, formula bar and selection untouched", async () => {
    const user = userEvent.setup();
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    const { calls } = stubFetch((request) => {
      if (request.method === "GET" && request.path === "/api/workbooks/wb-q3-sales") {
        return { body: { workbook: workbookFixture() } };
      }
      if (request.method === "PATCH" && request.path.endsWith("/worksheets/ws-q3-sheet1")) {
        const sheets = workbookFixture().worksheets.map((sheet) =>
          sheet.id === "ws-q3-sheet1" ? { ...sheet, activeCell: "B2" } : sheet,
        );
        return { body: { workbook: workbookFixture({ worksheets: sheets }) } };
      }
      if (request.method === "PATCH" && request.path === "/api/workbooks/wb-q3-sales") {
        return { body: { workbook: workbookFixture({ activeWorksheetId: "ws-q3-sheet2" }) } };
      }
      return undefined;
    });
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    await user.click(within(grid).getByRole("gridcell", { name: "B2" }));
    const formulaBar = () => (screen.getByLabelText("Formula bar") as HTMLInputElement).value;
    expect(formulaBar()).toBe("1200");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(clicked).toHaveLength(1);
    expect(clicked[0].getAttribute("href")).toBe("/api/workbooks/wb-q3-sales/worksheets/ws-q3-sheet1/export");
    expect(clicked[0].getAttribute("download")).toBe("");
    expect(within(grid).getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe("true");
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(formulaBar()).toBe("1200");
    expect(calls.every((call) => call.path !== "/api/workbooks/wb-q3-sales/worksheets/ws-q3-sheet1/export")).toBe(true);
    expect(calls.some((call) => call.method === "POST" || call.method === "DELETE")).toBe(false);

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(clicked[1].getAttribute("href")).toBe("/api/workbooks/wb-q3-sales/worksheets/ws-q3-sheet2/export");
  });
});
