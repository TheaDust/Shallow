import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountMenu } from "./AccountMenu";

afterEach(cleanup);

describe("account menu", () => {
  it("exposes a single Sign out link that opens the confirmation dialog", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn().mockResolvedValue(undefined);

    render(<AccountMenu username="alice-dev" onSignOut={onSignOut} />);
    await user.click(screen.getByRole("button", { name: "Account menu" }));

    const links = screen.getAllByRole("link", { name: "Sign out" });
    expect(links).toHaveLength(1);
    await user.click(links[0]);

    const dialog = await screen.findByRole("dialog", { name: "Sign out" });
    expect(dialog.textContent).toContain("current browser session");
    expect(screen.getByRole("button", { name: "Confirm sign out" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("keeps the session when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn().mockResolvedValue(undefined);

    render(<AccountMenu username="alice-dev" onSignOut={onSignOut} />);
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Sign out" })).toBeNull();
  });

  it("names the signed-in account with a button that opens the same menu", async () => {
    const user = userEvent.setup();

    render(<AccountMenu username="fork-user" onSignOut={vi.fn()} />);

    const identity = screen.getByRole("button", { name: /^fork-user$/ });
    expect(identity.getAttribute("aria-expanded")).toBe("false");

    await user.click(identity);

    expect(identity.getAttribute("aria-expanded")).toBe("true");
    // Both triggers share one popup, so no entry is rendered twice.
    expect(screen.getAllByRole("link", { name: "Sign out" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Your organizations" })).toHaveLength(1);
  });

  it("opens account Settings from the menu", async () => {
    const user = userEvent.setup();

    render(<AccountMenu username="password-change-success" onSignOut={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Settings" }));

    expect(window.location.hash).toBe("#/settings");
    expect(screen.queryByRole("link", { name: "Sign out" })).toBeNull();
  });

  it("opens Your organizations from the menu", async () => {
    const user = userEvent.setup();

    render(<AccountMenu username="org-owner" onSignOut={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Your organizations" }));

    expect(window.location.hash).toBe("#/organizations");
    expect(screen.queryByRole("link", { name: "Your organizations" })).toBeNull();
  });

  it("signs out only after confirming", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn().mockResolvedValue(undefined);

    render(<AccountMenu username="alice-dev" onSignOut={onSignOut} />);
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("link", { name: "Sign out" }));
    await user.click(await screen.findByRole("button", { name: "Confirm sign out" }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
