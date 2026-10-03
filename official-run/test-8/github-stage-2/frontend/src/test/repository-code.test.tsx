import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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

/** Opens the seeded public repository the way a visitor reaches it. */
async function openRepository(user: ReturnType<typeof userEvent.setup>) {
  renderApp("#/");
  await user.click(await screen.findByRole("link", { name: "acme-docs" }));
  await screen.findByRole("heading", { name: /acme-docs/ });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("browses the src directory and opens README.md with its stored content", async () => {
  installRepositories();
  const user = userEvent.setup();
  await openRepository(user);

  // The Code page lists the directory hierarchy of the default branch.
  await user.click(await screen.findByRole("link", { name: "src" }));
  expect(window.location.hash).toBe("#/repositories/acme-demo/acme-docs/tree/main/src");

  const file = await screen.findByRole("link", { name: "README.md" });
  expect(file.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs/blob/main/src/README.md");
  await user.click(file);

  expect(await screen.findByRole("heading", { name: "README.md" })).toBeTruthy();
  expect(screen.getByText("Path src/README.md")).toBeTruthy();
  expect(screen.getByText("Branch main")).toBeTruthy();
  expect(screen.getByText("Document search flow")).toBeTruthy();

  // Reloading the file page restores the same read-only content.
  const hash = window.location.hash;
  cleanup();
  window.location.hash = hash;
  render(<App />);
  expect(await screen.findByRole("heading", { name: "README.md" })).toBeTruthy();
  expect(screen.getByText("Document search flow")).toBeTruthy();
  expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
});

it("opens the commit history of the readable branch from the Commits link", async () => {
  installRepositories();
  const user = userEvent.setup();
  await openRepository(user);

  await user.click(screen.getByRole("link", { name: "Commits" }));
  expect(window.location.hash).toBe("#/repositories/acme-demo/acme-docs/commits/main");

  const record = await screen.findByRole("link", { name: "Document search flow" });
  const item = record.closest("li") as HTMLElement;
  expect(within(item).getByText("alice-dev")).toBeTruthy();
  expect(within(item).getByText(/ago/)).toBeTruthy();
  // The newest seeded change is listed first.
  const messages = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
  expect(messages[0]).toBe("Document search flow");
});

it("shows the changed files with numeric additions and deletions for one commit", async () => {
  installRepositories();
  const user = userEvent.setup();
  await openRepository(user);

  await user.click(screen.getByRole("link", { name: "Commits" }));
  await user.click(await screen.findByRole("link", { name: "Document search flow" }));

  expect(await screen.findByRole("heading", { name: "Document search flow" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Changed files" })).toBeTruthy();

  const changed = screen.getByRole("link", { name: "src/search.ts" });
  expect(changed.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs/blob/main/src/search.ts");
  const file = changed.closest("article") as HTMLElement;
  expect(within(file).getByText(/^\+\d+/)).toBeTruthy();
  expect(within(file).getByText(/^-\d+/)).toBeTruthy();
  expect(within(file).getByText(/\+\d+/)).toBeTruthy();
  expect(within(file).getByText(/-\d+/)).toBeTruthy();
  expect(within(file).getByText(/searchDocuments/)).toBeTruthy();
});

it("searches readable code and opens the matching README.md result", async () => {
  installRepositories();
  const user = userEvent.setup();
  await openRepository(user);

  const search = await screen.findByRole("searchbox", { name: "Search" });
  await user.type(search, "search flow{Enter}");
  expect(window.location.hash).toBe("#/repositories/acme-demo/acme-docs/search?q=search+flow");

  // Selecting the Code results keeps the same read-only view.
  await user.click(await screen.findByRole("link", { name: "Code" }));
  expect(window.location.hash).toBe("#/repositories/acme-demo/acme-docs/search?q=search+flow");

  const result = await screen.findByRole("link", { name: "README.md" });
  expect(result.getAttribute("href")).toBe("#/repositories/acme-demo/acme-docs/blob/main/src/README.md");
  expect(screen.getByText("search flow")).toBeTruthy();

  await user.click(result);
  expect(await screen.findByText(/search flow/)).toBeTruthy();

  // Reloading keeps both the matching text and an exact README.md link.
  const hash = window.location.hash;
  cleanup();
  window.location.hash = hash;
  render(<App />);
  expect(await screen.findByText(/search flow/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
});

it("reports no code results for an absent query and keeps it in Search", async () => {
  installRepositories();
  const user = userEvent.setup();
  await openRepository(user);

  const search = await screen.findByRole("searchbox", { name: "Search" });
  await user.type(search, "no-such-token{Enter}");

  expect(await screen.findByText("No code results")).toBeTruthy();
  expect((screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe("no-such-token");

  // The query is never answered from an earlier search: repeating it from the
  // repository produces the same empty state.
  const hash = window.location.hash;
  cleanup();
  window.location.hash = hash;
  render(<App />);
  expect(await screen.findByText("No code results")).toBeTruthy();
  expect((screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe("no-such-token");

  await user.click(screen.getByRole("link", { name: "Acme Demo/acme-docs" }));
  const again = await screen.findByRole("searchbox", { name: "Search" });
  await user.type(again, "no-such-token{Enter}");
  expect(await screen.findByText("No code results")).toBeTruthy();
  expect((screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe("no-such-token");
});
