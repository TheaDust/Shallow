import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HomePage } from "./HomePage";
import { seededSummary } from "../test/fixtures";

const api = vi.hoisted(() => ({
  listWorkbooks: vi.fn(),
  createWorkbook: vi.fn(),
  getWorkbook: vi.fn(),
  renameWorkbook: vi.fn(),
  setActiveSheet: vi.fn(),
  importWorkbook: vi.fn(),
}));

vi.mock("../lib/api", () => api);

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "#/";
    api.listWorkbooks.mockResolvedValue([seededSummary]);
  });

  it("lists each workbook with a name link and Last updated text", async () => {
    render(<HomePage />);

    const link = await screen.findByRole("link", { name: "Q3 Sales" });
    expect(link).toHaveAttribute("href", "#/workbook/wb-seed-q3");
    expect(screen.getByText(/^Last updated: /)).toBeInTheDocument();
  });

  it("provides the New blank workbook and Import CSV buttons", async () => {
    render(<HomePage />);
    await screen.findByRole("link", { name: "Q3 Sales" });

    expect(screen.getByRole("button", { name: "New blank workbook" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import CSV" })).toBeInTheDocument();
  });

  it("opens the Import CSV dialog with the file control and confirm button", async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await screen.findByRole("link", { name: "Q3 Sales" });

    await user.click(screen.getByRole("button", { name: "Import CSV" }));

    expect(screen.getByRole("dialog", { name: "Import CSV" })).toBeInTheDocument();
    expect(screen.getByLabelText("CSV file")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm import" })).toBeInTheDocument();
  });

  it("shows a retryable error when the workbook list fails to load", async () => {
    api.listWorkbooks.mockRejectedValue(new Error("boom"));
    render(<HomePage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
