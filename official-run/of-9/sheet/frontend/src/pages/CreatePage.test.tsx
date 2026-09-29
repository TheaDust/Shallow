import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreatePage } from "./CreatePage";
import { blankWorkbook } from "../test/fixtures";

const api = vi.hoisted(() => ({
  listWorkbooks: vi.fn(),
  createWorkbook: vi.fn(),
  getWorkbook: vi.fn(),
  renameWorkbook: vi.fn(),
  setActiveSheet: vi.fn(),
  importWorkbook: vi.fn(),
}));

vi.mock("../lib/api", () => api);

describe("CreatePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "#/new";
  });

  it("creates a blank workbook and enters the editor", async () => {
    const user = userEvent.setup();
    api.createWorkbook.mockResolvedValue(blankWorkbook);
    render(<CreatePage />);

    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(window.location.hash).toBe("#/workbook/wb-blank"));
    expect(api.createWorkbook).toHaveBeenCalledTimes(1);
  });

  it("shows the error and stays retryable when creation fails", async () => {
    const user = userEvent.setup();
    api.createWorkbook.mockRejectedValue(new Error("storage unavailable"));
    render(<CreatePage />);

    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("storage unavailable");
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
    expect(window.location.hash).toBe("#/new");
  });
});
