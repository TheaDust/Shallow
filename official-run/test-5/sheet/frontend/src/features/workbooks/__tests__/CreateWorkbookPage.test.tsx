import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreateWorkbookPage } from "../CreateWorkbookPage";
import { stubFetch, workbookFixture } from "./helpers";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  window.location.hash = "";
});

describe("create blank workbook page", () => {
  it("creates the workbook from the Create button and opens its editor entry", async () => {
    const user = userEvent.setup();
    const { calls } = stubFetch((request) =>
      request.method === "POST" && request.path === "/api/workbooks"
        ? { status: 201, body: { workbook: workbookFixture({ id: "wb-budget", name: "Budget" }) } }
        : undefined,
    );
    render(<CreateWorkbookPage />);

    await user.type(screen.getByLabelText("Workbook name"), "Budget");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(window.location.hash).toBe("#/workbooks/wb-budget"));
    expect(calls[0]?.body).toEqual({ name: "Budget" });
    expect(document.querySelectorAll("main")).toHaveLength(1);
  });

  it("creates a blank workbook when no name is typed", async () => {
    const user = userEvent.setup();
    const { calls } = stubFetch((request) =>
      request.method === "POST" && request.path === "/api/workbooks"
        ? { status: 201, body: { workbook: workbookFixture({ id: "wb-untitled", name: "Untitled workbook" }) } }
        : undefined,
    );
    render(<CreateWorkbookPage />);

    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(window.location.hash).toBe("#/workbooks/wb-untitled"));
    expect(calls[0]?.body).toEqual({ name: "" });
  });

  it("shows an error and stays retryable when creation fails", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const { calls } = stubFetch((request) => {
      if (request.method === "POST" && request.path === "/api/workbooks") {
        attempts += 1;
        return attempts === 1
          ? { status: 400, body: { error: "Workbook name is too long" } }
          : { status: 201, body: { workbook: workbookFixture({ id: "wb-retry", name: "Retry" }) } };
      }
      return undefined;
    });
    render(<CreateWorkbookPage />);

    const create = screen.getByRole("button", { name: "Create" });
    await user.click(create);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Workbook name is too long");
    expect(window.location.hash).toBe("");
    expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(false);

    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(window.location.hash).toBe("#/workbooks/wb-retry"));
    expect(calls).toHaveLength(2);
  });
});
