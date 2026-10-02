import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import type { WorkbookState } from "../domain/workbook";

const SEED_UPDATED_AT = "2026-03-14T09:32:00.000Z";
const INVALID_MESSAGE = "Invalid CSV file format. Import failed.";

function seedWorkbook(): WorkbookState {
  return {
    id: "wb-q3-sales",
    name: "Q3 Sales",
    createdAt: SEED_UPDATED_AT,
    updatedAt: SEED_UPDATED_AT,
    activeSheetId: "wb-q3-sales-sheet-1",
    sheets: [{ id: "wb-q3-sales-sheet-1", name: "Sheet1", cells: { A1: "Region" } }],
  };
}

interface FakeApiOptions {
  importStatus?: number;
  importError?: string;
}

/** Minimal CSV splitter used only to stand in for the real server parser in these UI tests. */
function cellsFromPlainCsv(content: string): Record<string, string> {
  const cells: Record<string, string> = {};
  content.split("\n").forEach((line, row) => {
    line.split(",").forEach((value, column) => {
      if (value !== "") cells[`${String.fromCharCode(65 + column)}${row + 1}`] = value;
    });
  });
  return cells;
}

function installFakeApi(options: FakeApiOptions = {}) {
  const workbooks: WorkbookState[] = [seedWorkbook()];
  const calls: { method: string; path: string; body: unknown }[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });

    const json = (status: number, payload: unknown) => ({
      ok: status < 400,
      status,
      headers: { get: () => "application/json" },
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    });

    if (path === "/api/workbooks/import" && method === "POST") {
      if (options.importStatus && options.importStatus >= 400) {
        return json(options.importStatus, { error: options.importError ?? INVALID_MESSAGE });
      }
      const fileName = String((body as { fileName: string }).fileName);
      const content = String((body as { content: string }).content);
      const sheetId = "wb-imported-sheet-1";
      const workbook: WorkbookState = {
        id: "wb-imported",
        name: fileName.replace(/\.csv$/i, ""),
        createdAt: SEED_UPDATED_AT,
        updatedAt: SEED_UPDATED_AT,
        activeSheetId: sheetId,
        sheets: [{ id: sheetId, name: "Sheet1", cells: cellsFromPlainCsv(content) }],
      };
      workbooks.push(workbook);
      return json(201, { workbook });
    }

    if (path === "/api/workbooks" && method === "GET") {
      return json(200, {
        workbooks: workbooks.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })),
      });
    }

    const match = /^\/api\/workbooks\/([^/]+)$/.exec(path);
    if (match) {
      const workbook = workbooks.find((entry) => entry.id === decodeURIComponent(match[1]));
      if (!workbook) return json(404, { error: "Workbook not found" });
      return json(200, { workbook });
    }
    return json(404, { error: "Not found" });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { workbooks, calls };
}

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(<App />);
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

describe("CSV import", () => {
  it("imports a CSV file and opens Sheet1 with the imported rows", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    renderAt("#/");

    await user.click(await screen.findByRole("button", { name: "Import CSV" }));
    const dialog = screen.getByRole("dialog", { name: "Import CSV" });
    const fileInput = within(dialog).getByLabelText("CSV file") as HTMLInputElement;
    expect(fileInput.type).toBe("file");

    await user.upload(
      fileInput,
      new File(["Region,East\n1200,North"], "Q4 Sales.csv", { type: "text/csv" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));

    await waitFor(() => expect(window.location.hash).toBe("#/workbooks/wb-imported"));
    expect(await screen.findByRole("heading", { name: "Q4 Sales", level: 1 })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(within(grid).getByRole("gridcell", { name: "B1" }).textContent).toBe("East");
    expect(within(grid).getByRole("gridcell", { name: "A2" }).textContent).toBe("1200");
    expect(within(grid).getByRole("gridcell", { name: "B2" }).textContent).toBe("North");
    expect(within(grid).getByRole("gridcell", { name: "C1" }).textContent).toBe("");

    const importCall = api.calls.find((call) => call.path === "/api/workbooks/import");
    expect(importCall?.body).toEqual({ fileName: "Q4 Sales.csv", content: "Region,East\n1200,North" });
  });

  it("shows the invalid CSV message beside the file control and creates no workbook", async () => {
    installFakeApi({ importStatus: 400 });
    const user = userEvent.setup();
    renderAt("#/");

    await user.click(await screen.findByRole("button", { name: "Import CSV" }));
    const dialog = screen.getByRole("dialog", { name: "Import CSV" });
    const fileInput = within(dialog).getByLabelText("CSV file");
    await user.upload(fileInput, new File(['"unclosed,1200'], "Broken.csv", { type: "text/csv" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toBe(INVALID_MESSAGE);
    expect(window.location.hash).toBe("#/");
    expect(screen.getByRole("dialog", { name: "Import CSV" })).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Confirm import" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("link", { name: "Broken" })).toBeNull();
    expect(screen.getByRole("link", { name: "Q3 Sales" })).toBeTruthy();
  });
});

interface CapturedDownload {
  fileName: string;
  blob: Blob | null;
}

/** jsdom implements neither Blob.text nor URL.createObjectURL, so both are stubbed here. */
function stubDownloadCapture(): { downloads: CapturedDownload[]; revoke: ReturnType<typeof vi.fn> } {
  const downloads: CapturedDownload[] = [];
  Object.assign(URL, {
    createObjectURL: vi.fn((blob: Blob) => {
      downloads.push({ fileName: "", blob });
      return "blob:test";
    }),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function capture(this: HTMLAnchorElement) {
    const last = downloads[downloads.length - 1];
    if (last) last.fileName = this.getAttribute("download") ?? "";
  });
  return { downloads, revoke: (URL as unknown as { revokeObjectURL: ReturnType<typeof vi.fn> }).revokeObjectURL };
}

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob, "utf-8");
  });
}

describe("CSV export", () => {
  it("downloads the active worksheet as CSV and keeps the interface state", async () => {
    installFakeApi();
    const user = userEvent.setup();
    const { downloads } = stubDownloadCapture();

    renderAt("#/workbooks/wb-q3-sales");
    const exportButton = await screen.findByRole("button", { name: "Export CSV" });
    expect(exportButton.closest('[role="toolbar"]')).not.toBeNull();
    await user.click(exportButton);

    expect(downloads).toHaveLength(1);
    expect(downloads[0].fileName).toBe("Q3 Sales.csv");
    await expect(readBlobText(downloads[0].blob as Blob)).resolves.toBe("Region");

    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect((screen.getByLabelText("Formula bar") as HTMLInputElement).value).toBe("Region");
    expect(window.location.hash).toBe("#/workbooks/wb-q3-sales");
  });
});
