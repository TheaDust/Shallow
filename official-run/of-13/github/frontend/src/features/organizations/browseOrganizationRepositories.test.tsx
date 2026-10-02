import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { installAuthStub, type StubOrganization } from "../../test-support/auth-stub";

const OWNER = {
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

const MEMBER = {
  username: "bob-reviewer",
  email: "bob.reviewer@example.test",
  password: "Valid-password-123!",
};

const ORGANIZATION: StubOrganization = {
  name: "acme-demo",
  displayName: "Acme Demo",
  members: [
    { username: "alice-dev", role: "owner" },
    { username: "bob-reviewer", role: "member" },
  ],
  teams: [{ name: "frontend-team", description: "Frontend maintainers", parent: null }],
  repositories: [
    {
      name: "acme-docs",
      description: "Documentation for the Acme Demo platform.",
      visibility: "public",
    },
    {
      name: "secret-research",
      description: "Private research notes.",
      visibility: "private",
    },
  ],
};

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

async function signIn(user: ReturnType<typeof userEvent.setup>, username: string) {
  renderApp("#/login");
  await user.type(await screen.findByLabelText("Username or email"), username);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Workspace" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

describe("REQ-2-1-1 browse organization repositories", () => {
  it("a visitor filters the public repository and opens its overview", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/organizations/acme-demo");

    expect(await screen.findByRole("heading", { name: "acme-demo" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Repositories" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "People" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Teams" })).toBeTruthy();

    const filter = await screen.findByLabelText("Find a repository");
    const publicLink = await screen.findByRole("link", { name: "acme-docs" });
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();

    const item = publicLink.closest("li") as HTMLElement;
    expect(within(item).getByText("Documentation for the Acme Demo platform.")).toBeTruthy();
    expect(within(item).getByText("Public")).toBeTruthy();
    expect(within(item).getByText(/Updated/)).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Repositories" }));
    await user.type(filter, "acme-docs");
    await user.selectOptions(screen.getByLabelText("Visibility"), "Public");
    expect(screen.getAllByRole("link", { name: "acme-docs" })).toHaveLength(1);

    await user.click(screen.getByRole("link", { name: "acme-docs" }));
    expect(await screen.findByRole("heading", { name: "acme-demo/acme-docs" })).toBeTruthy();
  });

  it("never reveals a private repository through the filter", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    renderApp("#/organizations/acme-demo");

    const filter = await screen.findByLabelText("Find a repository");
    await screen.findByRole("link", { name: "acme-docs" });

    await user.type(filter, "secret-research");
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
    expect(screen.queryByRole("link", { name: "acme-docs" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("No repositories found.");

    // Directly opening the private repository is refused instead of rendered.
    window.location.hash = "#/repositories/acme-demo/secret-research";
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "acme-demo/secret-research" })).toBeNull();
  });

  it("keeps the private repository hidden from a plain member but not from an owner", async () => {
    installAuthStub({ accounts: [OWNER, MEMBER], organizations: [ORGANIZATION] });
    const user = userEvent.setup();
    await signIn(user, MEMBER.username);

    window.location.hash = "#/organizations/acme-demo";
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();

    await user.click(screen.getByRole("link", { name: "People" }));
    const people = await screen.findByRole("table");
    expect(within(people).getByRole("row", { name: /bob-reviewer/ }).textContent).toContain(
      "Member",
    );
    expect(within(people).getByRole("row", { name: /alice-dev/ }).textContent).toContain("Owner");

    cleanup();
    await signIn(user, OWNER.username);
    window.location.hash = "#/organizations/acme-demo";
    expect(await screen.findByRole("link", { name: "secret-research" })).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "secret-research" }));
    expect(
      await screen.findByRole("heading", { name: "acme-demo/secret-research" }),
    ).toBeTruthy();
  });
});
