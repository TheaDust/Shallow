import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../App";
import { DEFAULT_ACCOUNTS, DEFAULT_ORGANIZATIONS, installFakeApi } from "./fake-api";

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

function installRepositories() {
  return installFakeApi(DEFAULT_ACCOUNTS, { organizations: DEFAULT_ORGANIZATIONS });
}

async function signInAs(user: ReturnType<typeof userEvent.setup>, identifier: string) {
  renderApp("#/signin");
  await user.type(await screen.findByLabelText("Username or email"), identifier);
  await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Account menu" });
}

/** Opens the writable repository and the editor through Add file → Create new file. */
async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("link", { name: "file-management-demo" }));
  await screen.findByRole("heading", { name: /file-management-demo/ });
  await user.click(await screen.findByRole("button", { name: "Add file" }));
  await user.click(await screen.findByRole("button", { name: "Create new file" }));
  await screen.findByRole("heading", { name: "Create new file" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("adds a file whose view shows the content and whose Commits link exposes the message", async () => {
  const api = installRepositories();
  const user = userEvent.setup();
  await signInAs(user, "file-contributor@example.test");

  await openEditor(user);
  const name = "pw-file-7.md";
  await user.type(await screen.findByLabelText("File name"), name);
  await user.type(screen.getByLabelText("File contents"), "Hello from the web editor\n");
  await user.type(screen.getByLabelText("Commit message"), `Add ${name}`);
  await user.click(screen.getByRole("button", { name: "Commit changes" }));

  // The created file view displays the exact submitted content.
  expect(await screen.findByRole("heading", { name })).toBeTruthy();
  expect(screen.getByText("Hello from the web editor")).toBeTruthy();
  expect(screen.getByText(`Path ${name}`)).toBeTruthy();

  // Its “Commits” link opens the history of that file with the exact message.
  await user.click(screen.getByRole("link", { name: "Commits" }));
  expect(await screen.findByRole("link", { name: `Add ${name}` })).toBeTruthy();

  const repository = api.repositories.find((candidate) => candidate.name === "file-management-demo");
  expect(repository?.branches[0].files.map((file) => file.path)).toContain(name);
});

it("reports an invalid path and a missing commit message without saving anything", async () => {
  const api = installRepositories();
  const user = userEvent.setup();
  await signInAs(user, "file-contributor@example.test");

  await openEditor(user);
  await user.type(await screen.findByLabelText("File name"), "../invalid.md");
  await user.type(screen.getByLabelText("File contents"), "must not be saved");
  await user.click(screen.getByRole("button", { name: "Commit changes" }));

  expect(await screen.findByText("Invalid file path")).toBeTruthy();
  expect(await screen.findByText("Commit message is required")).toBeTruthy();
  // The submission was not accepted: the editor is still the active page.
  expect(window.location.hash).toContain("/new/main");

  const repository = api.repositories.find((candidate) => candidate.name === "file-management-demo");
  expect(repository?.branches[0].files.map((file) => file.path)).toEqual(["README.md"]);
});
