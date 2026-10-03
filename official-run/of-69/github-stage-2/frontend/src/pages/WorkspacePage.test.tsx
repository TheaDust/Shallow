import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as sessionApi from "../lib/session-api";
import { SessionProvider } from "../session/session-context";
import { WorkspacePage } from "./WorkspacePage";

afterEach(cleanup);

vi.mock("../lib/session-api", () => ({
  registerAccount: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  fetchSession: vi.fn(),
  startRecovery: vi.fn(),
  resetPassword: vi.fn(),
}));

describe("workspace", () => {
  it("displays the signed-in username and the account menu", async () => {
    vi.mocked(sessionApi.fetchSession).mockResolvedValue({
      id: "account-alice-dev",
      username: "alice-dev",
      email: "alice.dev@example.test",
      emailVerified: true,
      status: "available",
    });

    render(
      <SessionProvider>
        <WorkspacePage
          account={{
            id: "account-alice-dev",
            username: "alice-dev",
            email: "alice.dev@example.test",
            emailVerified: true,
            status: "available",
          }}
        />
      </SessionProvider>,
    );

    const heading = await screen.findByRole("heading", { name: "alice-dev" });
    expect(heading.textContent).toBe("alice-dev");
    expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy();
    // The header names the signed-in account through its own button.
    expect(screen.getByRole("button", { name: /^alice-dev$/ })).toBeTruthy();
    expect(screen.getByRole("main").textContent).toContain("alice-dev");
    // The signed-in workspace is the entry point for creating a repository.
    expect(screen.getByRole("link", { name: "New repository" }).getAttribute("href")).toBe("#/repositories/new");
  });
});
