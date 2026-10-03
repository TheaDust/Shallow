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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("searches a public repository from the top searchbox and opens it", async () => {
  installRepositories();
  const user = userEvent.setup();
  renderApp("#/");

  const searchbox = await screen.findByRole("searchbox", { name: "Search" });
  await user.type(searchbox, "acme-docs{Enter}");

  expect(window.location.hash).toBe("#/search?q=acme-docs");
  const result = await screen.findByRole("link", { name: "acme-docs" });
  expect(result.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs");
  expect(screen.getByText("Acme Demo/acme-docs")).toBeTruthy();

  await user.click(result);
  expect(await screen.findByRole("heading", { name: /acme-docs/ })).toBeTruthy();
});

it("keeps the repository heading after reloading the overview URL", async () => {
  installRepositories();
  const user = userEvent.setup();
  renderApp("#/search?q=acme-docs");

  await user.click(await screen.findByRole("link", { name: "acme-docs" }));
  expect(await screen.findByRole("heading", { name: /acme-docs/ })).toBeTruthy();
  expect(window.location.hash).toBe("#/repositories/acme-demo/acme-docs");

  cleanup();
  render(<App />);
  expect(await screen.findByRole("heading", { name: /acme-docs/ })).toBeTruthy();
});

it("never exposes an unreadable private repository in the results", async () => {
  installRepositories();
  const user = userEvent.setup();
  renderApp("#/");

  await user.type(await screen.findByRole("searchbox", { name: "Search" }), "secret-research{Enter}");

  expect(window.location.hash).toBe("#/search?q=secret-research");
  expect(await screen.findByText("No results")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
});

it("repeats the same no-result query after returning home", async () => {
  installRepositories();
  const user = userEvent.setup();
  renderApp("#/search?q=no-such-repository");

  expect(await screen.findByText("No results")).toBeTruthy();

  await user.click(screen.getByRole("link", { name: "GitHub" }));
  const searchbox = await screen.findByRole("searchbox", { name: "Search" });
  await user.type(searchbox, "no-such-repository{Enter}");

  expect(await screen.findByText("No results")).toBeTruthy();
});

it("opens the visible public repository entry and shows marker and Code link", async () => {
  installRepositories();
  const user = userEvent.setup();
  renderApp("#/");

  await user.click(await screen.findByRole("link", { name: "acme-docs" }));
  expect(await screen.findByRole("heading", { name: /acme-docs/ })).toBeTruthy();
  expect(screen.getByText("Public")).toBeTruthy();

  const code = screen.getByRole("link", { name: "Code" });
  expect(code.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs");

  cleanup();
  render(<App />);
  expect(await screen.findByRole("heading", { name: /acme-docs/ })).toBeTruthy();
  expect(screen.getByText("Public")).toBeTruthy();
});
