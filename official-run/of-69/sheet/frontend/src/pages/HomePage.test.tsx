import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { installFetchStub, type StubRequest } from "../test/fetch-stub";
import { SEEDED_LAST_UPDATED, importedWorkbook, seededSummary, seededWorkbook } from "../test/fixtures";

function reset() {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
}

function stubWorkbookApi() {
  return installFetchStub(({ method, url }) => {
    if (url === "/api/workbooks" && method === "GET") return { body: { workbooks: [seededSummary] } };
    if (url === "/api/workbooks/wb-q3-sales" && method === "GET") return { body: { workbook: seededWorkbook } };
    return { status: 404, body: { error: "Not found" } };
  });
}

describe("workbook home page", () => {
  afterEach(reset);

  it("lists each workbook with its last updated value and a link whose accessible name is the workbook name", async () => {
    stubWorkbookApi();
    window.location.hash = "#/";
    render(<App />);

    const link = await screen.findByRole("link", { name: "Q3 Sales" });
    expect(link).toHaveAttribute("href", "#/workbooks/wb-q3-sales");
    expect(screen.getByText(SEEDED_LAST_UPDATED)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New blank workbook" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Workbooks" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("opens the clicked workbook entry in the editor", async () => {
    stubWorkbookApi();
    const user = userEvent.setup();
    window.location.hash = "#/";
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));

    expect(window.location.hash).toBe("#/workbooks/wb-q3-sales");
    expect(await screen.findByRole("heading", { level: 1, name: "Q3 Sales" })).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "Worksheet grid" })).toBeInTheDocument();
  });

  it("opens the creation page from the New blank workbook button", async () => {
    stubWorkbookApi();
    const user = userEvent.setup();
    window.location.hash = "#/";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));

    expect(window.location.hash).toBe("#/new");
    expect(await screen.findByRole("heading", { level: 1, name: "New workbook" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("reports a busy state while the workbook list is still loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    window.location.hash = "#/";
    render(<App />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading workbooks");
    expect(screen.queryByRole("link", { name: "Q3 Sales" })).toBeNull();
  });

  it("imports a CSV file through the Import CSV dialog and opens the created workbook", async () => {
    const requests: StubRequest[] = [];
    installFetchStub((request) => {
      requests.push(request);
      if (request.url === "/api/workbooks" && request.method === "GET") {
        return { body: { workbooks: [seededSummary, { id: importedWorkbook.id, name: importedWorkbook.name, updatedAt: importedWorkbook.updatedAt }] } };
      }
      if (request.url === "/api/workbooks/import" && request.method === "POST") {
        return { status: 201, body: { workbook: importedWorkbook } };
      }
      if (request.url === "/api/workbooks/wb-imported" && request.method === "GET") {
        return { body: { workbook: importedWorkbook } };
      }
      return { status: 404, body: { error: "Not found" } };
    });
    const user = userEvent.setup();
    window.location.hash = "#/";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Import CSV" }));

    const dialog = await screen.findByRole("dialog", { name: "Import CSV" });
    const fileInput = within(dialog).getByLabelText("CSV file");
    expect(within(dialog).getByRole("button", { name: "Confirm import" })).toBeInTheDocument();

    await user.upload(fileInput, new File(["Region,Revenue\nEast,1200\nNorth,800"], "regional sales.csv", { type: "text/csv" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));

    expect(await screen.findByRole("heading", { level: 1, name: "regional sales" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/workbooks/wb-imported");
    expect(requests.filter((request) => request.url === "/api/workbooks/import")).toEqual([
      {
        method: "POST",
        url: "/api/workbooks/import",
        body: { fileName: "regional sales.csv", content: "Region,Revenue\nEast,1200\nNorth,800" },
      },
    ]);

    expect(screen.getByRole("tab", { name: "Sheet1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("North");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toBe("800");
  });

  it("shows the invalid CSV message beside the file control without creating a workbook", async () => {
    const requests: StubRequest[] = [];
    installFetchStub((request) => {
      requests.push(request);
      if (request.url === "/api/workbooks" && request.method === "GET") {
        return { body: { workbooks: [seededSummary] } };
      }
      if (request.url === "/api/workbooks/import" && request.method === "POST") {
        return { status: 400, body: { error: "Invalid CSV file format. Import failed." } };
      }
      return { status: 404, body: { error: "Not found" } };
    });
    const user = userEvent.setup();
    window.location.hash = "#/";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Import CSV" }));
    const dialog = await screen.findByRole("dialog", { name: "Import CSV" });
    await user.upload(
      within(dialog).getByLabelText("CSV file"),
      new File(['Region,"East'], "broken.csv", { type: "text/csv" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid CSV file format. Import failed.");
    expect(screen.getByRole("dialog", { name: "Import CSV" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("CSV file")).toHaveAttribute("aria-invalid", "true");
    expect(window.location.hash).toBe("#/");
    expect(screen.getByRole("button", { name: "Confirm import" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: "broken" })).toBeNull();
    expect(screen.getByRole("link", { name: "Q3 Sales" })).toBeInTheDocument();
  });

  it("keeps the import request out of the way when no CSV file is chosen", async () => {
    const requests: StubRequest[] = [];
    installFetchStub((request) => {
      requests.push(request);
      if (request.url === "/api/workbooks" && request.method === "GET") {
        return { body: { workbooks: [seededSummary] } };
      }
      return { status: 404, body: { error: "Not found" } };
    });
    const user = userEvent.setup();
    window.location.hash = "#/";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Import CSV" }));
    const dialog = await screen.findByRole("dialog", { name: "Import CSV" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a CSV file to import.");
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(0);
    expect(window.location.hash).toBe("#/");
  });
});
