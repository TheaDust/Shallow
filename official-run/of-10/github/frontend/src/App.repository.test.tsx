import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

interface AccountFixture {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
}

interface FakeRepository {
  owner: string;
  name: string;
  visibility: "public" | "private";
  description: string;
  defaultBranch: string;
  updatedAt: string;
  files: Array<{ path: string; content: string }>;
}

const ALICE: AccountFixture = {
  id: "account-alice-dev",
  username: "alice-dev",
  email: "alice.dev@example.test",
  emailVerified: true,
};

const REPOSITORIES: FakeRepository[] = [
  {
    owner: "alice-dev",
    name: "acme-docs",
    visibility: "public",
    description: "Documentation and guides for the Acme platform.",
    defaultBranch: "main",
    updatedAt: "2024-02-12T09:30:00.000Z",
    files: [
      {
        path: "README.md",
        content: "# acme-docs\n\nDocumentation and guides for the Acme platform.\n",
      },
    ],
  },
  {
    owner: "alice-dev",
    name: "secret-research",
    visibility: "private",
    description: "Confidential research notes for the Acme platform.",
    defaultBranch: "main",
    updatedAt: "2024-02-20T16:45:00.000Z",
    files: [{ path: "README.md", content: "# secret-research\n\nConfidential research notes.\n" }],
  },
];

function summary(repository: FakeRepository) {
  return {
    id: `repo-${repository.owner}-${repository.name}`,
    name: repository.name,
    fullName: `${repository.owner}/${repository.name}`,
    owner: { type: "user", login: repository.owner },
    visibility: repository.visibility,
    description: repository.description,
    defaultBranch: repository.defaultBranch,
    updatedAt: repository.updatedAt,
  };
}

function canRead(repository: FakeRepository, viewer: AccountFixture | null): boolean {
  if (repository.visibility === "public") return true;
  return viewer !== null && viewer.username === repository.owner;
}

interface FakeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

function jsonResponse(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Minimal in-memory stand-in for the repository HTTP API. */
function installFetch(account: AccountFixture | null) {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;
    const viewer = account;

    if (path === "/api/session") return jsonResponse(200, { account });
    if (path === "/api/sessions" && init?.method === "POST") return jsonResponse(200, { account });

    if (path === "/api/search") {
      const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
      const type = url.searchParams.get("type") ?? "repositories";
      if (type !== "repositories") {
        // Code results are covered by the REQ-4 suite; this stub answers empty.
        return jsonResponse(200, { query, type, repository: null, results: [] });
      }
      const repositories =
        query
          ? REPOSITORIES.filter(
              (repository) =>
                (repository.name.toLowerCase().includes(query) ||
                  repository.description.toLowerCase().includes(query)) &&
                canRead(repository, viewer),
            ).map(summary)
          : [];
      return jsonResponse(200, { query, type, repositories });
    }

    const fileMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/file$/);
    if (fileMatch) {
      const [, owner, name] = fileMatch.map(decodeURIComponent);
      const repository = REPOSITORIES.find(
        (candidate) => candidate.owner === owner && candidate.name === name,
      );
      if (!repository || !canRead(repository, viewer)) return jsonResponse(404, { error: "Not found" });
      const wanted = url.searchParams.get("path") ?? "";
      const file = repository.files.find((candidate) => candidate.path === wanted);
      if (!file) return jsonResponse(404, { error: "Not found" });
      return jsonResponse(200, {
        repository: summary(repository),
        file: {
          path: file.path,
          name: file.path.split("/").pop(),
          branch: repository.defaultBranch,
          content: file.content,
          commit: {
            id: "commit-1",
            message: "Initial commit",
            author: repository.owner,
            createdAt: repository.updatedAt,
          },
        },
      });
    }

    const overviewMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)$/);
    if (overviewMatch) {
      const [, owner, name] = overviewMatch.map(decodeURIComponent);
      const repository = REPOSITORIES.find(
        (candidate) => candidate.owner === owner && candidate.name === name,
      );
      if (!repository || !canRead(repository, viewer)) return jsonResponse(404, { error: "Not found" });
      return jsonResponse(200, {
        repository: {
          ...summary(repository),
          branch: repository.defaultBranch,
          entries: repository.files.map((file) => ({
            type: "file",
            name: file.path.split("/").pop(),
            path: file.path,
          })),
        },
      });
    }

    return jsonResponse(404, { error: "Not found" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function open(hash: string) {
  window.location.hash = hash;
  render(<App />);
}

function searchBox() {
  return screen.getByRole("searchbox", { name: "Search" });
}

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("global repository search (REQ-3-1)", () => {
  it("searches from the top searchbox with Enter and opens the result", async () => {
    installFetch(null);
    open("#/");

    const box = await screen.findByRole("searchbox", { name: "Search" });
    expect(screen.getAllByRole("searchbox", { name: "Search" })).toHaveLength(1);
    expect(box.getAttribute("type")).toBe("search");

    const user = userEvent.setup();
    await user.type(box, "acme-docs{Enter}");

    const link = await screen.findByRole("link", { name: "acme-docs" });
    const result = link.closest("li") as HTMLElement;
    expect(within(result).getByText("alice-dev/acme-docs")).toBeTruthy();
    expect(within(result).getByText(/Documentation and guides/)).toBeTruthy();
    expect(within(result).getByText("Public")).toBeTruthy();
    expect(within(result).getByText(/Updated/)).toBeTruthy();
    // The unreadable private repository is never part of the results.
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
    expect(document.body.textContent).not.toContain("secret-research");

    await user.click(link);
    const heading = await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    expect(heading.tagName).toBe("H1");
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Code" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Issues" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pull requests" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
  });

  it("keeps the repository overview after a reload and opens a file", async () => {
    installFetch(null);
    open("#/repos/alice-dev/acme-docs");

    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();

    // A fresh mount is what a browser reload does.
    cleanup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "README.md" }));
    expect(await screen.findByRole("heading", { name: "README.md" })).toBeTruthy();
    const code = screen.getByText((_, element) => element?.tagName === "CODE");
    expect(code.textContent).toBe("# acme-docs\n\nDocumentation and guides for the Acme platform.\n");
  });

  it("resolves the GitHub-style repository address as well", async () => {
    installFetch(null);
    open("#/alice-dev/acme-docs");
    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();
  });

  it("shows No results without retaining old results when the term or scope changes", async () => {
    installFetch(null);
    open("#/search?q=acme-docs&type=repositories");
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Code" }));
    // The code results view owns its own empty state (REQ-4-2-3).
    expect(await screen.findByRole("heading", { name: "No code results" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "acme-docs" })).toBeNull();

    await user.click(screen.getByRole("link", { name: "Repositories" }));
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();

    await user.clear(searchBox());
    expect(await screen.findByRole("heading", { name: "No results" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "acme-docs" })).toBeNull();
  });

  it("hides an unreadable private repository from search and denies its address", async () => {
    installFetch(null);
    open("#/");

    const user = userEvent.setup();
    await user.type(await screen.findByRole("searchbox", { name: "Search" }), "secret-research{Enter}");
    expect(await screen.findByRole("heading", { name: "No results" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();

    cleanup();
    open("#/repos/alice-dev/secret-research");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("secret-research");
    expect(document.body.textContent).not.toContain("Confidential research notes");
  });

  it("shows the private repository to its owner and keeps it across a reload", async () => {
    installFetch(ALICE);
    open("#/search?q=secret-research&type=repositories");

    const link = await screen.findByRole("link", { name: "secret-research" });
    const result = link.closest("li") as HTMLElement;
    expect(within(result).getByText("alice-dev/secret-research")).toBeTruthy();
    expect(within(result).getByText("Private")).toBeTruthy();

    const user = userEvent.setup();
    await user.click(link);
    expect(await screen.findByRole("heading", { name: "alice-dev/secret-research" })).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();

    cleanup();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "alice-dev/secret-research" })).toBeTruthy(),
    );
    expect(screen.getByText("Private")).toBeTruthy();
  });
});
