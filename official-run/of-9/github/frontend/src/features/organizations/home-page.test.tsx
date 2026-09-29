import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomePage } from "../../pages/HomePage";
import { SessionProvider } from "../auth/session";

const mocks = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  listMyRepositories: vi.fn(),
}));

vi.mock("../../features/auth/api", () => ({
  fetchSession: mocks.fetchSession,
}));

vi.mock("../organizations/api", () => ({
  listMyRepositories: mocks.listMyRepositories,
}));

const now = new Date().toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
});

describe("HomePage workspace", () => {
  it("provides the New repository link to the signed-in workspace", async () => {
    mocks.fetchSession.mockResolvedValue({
      authenticated: true,
      account: { username: "alice-dev", email: "alice.dev@example.test" },
    });
    mocks.listMyRepositories.mockResolvedValue([
      {
        owner: "acme-demo",
        name: "acme-docs",
        description: "Acme documentation",
        visibility: "public",
        defaultBranch: "main",
        updatedAt: now,
      },
    ]);
    render(
      <SessionProvider>
        <HomePage />
      </SessionProvider>,
    );

    const link = await screen.findByRole("link", { name: "New repository" });
    expect(link.getAttribute("href")).toBe("#/repositories/new");
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();
  });

  it("does not show the New repository link to anonymous visitors", async () => {
    mocks.fetchSession.mockResolvedValue({ authenticated: false });
    render(
      <SessionProvider>
        <HomePage />
      </SessionProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "GitHub Collaboration Platform" }),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "New repository" })).toBeNull();
  });
});
