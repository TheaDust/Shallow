import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../App";
import { DEFAULT_ACCOUNTS, DEFAULT_ORGANIZATIONS, installFakeApi, type FakeAccount } from "./fake-api";

const ORG_MEMBER = DEFAULT_ACCOUNTS.find((account) => account.username === "org-member")!;

function account(username: string): FakeAccount {
  return DEFAULT_ACCOUNTS.find((candidate) => candidate.username === username)!;
}

function renderPeoplePage() {
  window.location.hash = "#/organizations/acme-demo/people";
  return render(<App />);
}

function signedInAs(username: string) {
  const api = installFakeApi(DEFAULT_ACCOUNTS, { organizations: DEFAULT_ORGANIZATIONS });
  api.signedInId = account(username).id;
  return api;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("adds a registered non-member directly and keeps the membership after reloading", async () => {
  signedInAs("org-owner");
  const user = userEvent.setup();
  renderPeoplePage();

  await screen.findByText("existing-member");
  expect(screen.queryByText("new-member")).toBeNull();

  await user.click(screen.getByRole("button", { name: "Add member" }));
  const field = await screen.findByLabelText("Username or email");
  await user.type(field, "new-member");
  const role = screen.getByRole("combobox", { name: "Role" }) as HTMLInputElement;
  expect(role.value).toBe("Member");
  await user.click(screen.getByRole("button", { name: "Add member" }));

  await waitFor(() => expect(screen.getByText("new-member")).toBeTruthy());
  const row = screen.getByText("new-member").closest("li") as HTMLElement;
  expect(within(row).getByText("Member")).toBeTruthy();
  expect(screen.queryByText(/Pending invitation/i)).toBeNull();

  cleanup();
  renderPeoplePage();
  await waitFor(() => expect(screen.getByText("new-member")).toBeTruthy());
  expect(within(screen.getByText("new-member").closest("li") as HTMLElement).getByText("Member")).toBeTruthy();
});

it("reports an existing member and an unknown account without duplicating the relationship", async () => {
  signedInAs("org-owner");
  const user = userEvent.setup();
  renderPeoplePage();

  await screen.findByText("existing-member");
  await user.click(screen.getByRole("button", { name: "Add member" }));
  const field = await screen.findByLabelText("Username or email");
  await user.type(field, "existing-member");
  await user.click(screen.getByRole("button", { name: "Add member" }));
  expect(await screen.findByText("Account is already a member")).toBeTruthy();

  await user.clear(screen.getByLabelText("Username or email"));
  await user.type(screen.getByLabelText("Username or email"), "unknown-reviewer");
  await user.click(screen.getByRole("button", { name: "Add member" }));
  expect(await screen.findByText("Account not found")).toBeTruthy();
  expect(screen.queryByText("Account is already a member")).toBeNull();

  expect(screen.getAllByText("existing-member", { exact: true })).toHaveLength(1);
});

it("lets an Owner remove a member through the member menu and the confirmation", async () => {
  signedInAs("org-owner");
  const user = userEvent.setup();
  renderPeoplePage();

  await user.click(await screen.findByRole("button", { name: "Member menu existing-member" }));
  await user.click(await screen.findByRole("menuitem", { name: "Remove from organization" }));

  const dialog = await screen.findByRole("dialog", { name: "Remove from organization" });
  await user.click(within(dialog).getByRole("button", { name: "Remove" }));

  await waitFor(() => expect(screen.queryByText("existing-member", { exact: true })).toBeNull());
  expect(screen.getByRole("button", { name: "Member menu protected-member" })).toBeTruthy();

  cleanup();
  renderPeoplePage();
  await screen.findByRole("button", { name: "Member menu protected-member" });
  expect(screen.queryByText("existing-member", { exact: true })).toBeNull();
});

it("keeps the member menu and the add-member entry away from a non-Owner", async () => {
  signedInAs("org-member");
  renderPeoplePage();

  await screen.findByText("protected-member");
  expect(screen.queryByRole("button", { name: "Member menu protected-member" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Remove from organization" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
});
