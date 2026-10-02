import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";

interface SimulatedResponse {
  status: number;
  body: unknown;
}

interface SimulatedRepository {
  name: string;
  owner: string;
  ownerDisplayName: string;
  description: string;
  visibility: "public" | "private";
  updatedAt: string;
  files: Array<{ path: string; content: string }>;
  reads: string[];
}

const REPOSITORIES: SimulatedRepository[] = [
  {
    name: "acme-docs",
    owner: "alice-dev",
    ownerDisplayName: "alice-dev",
    description: "Documentation for the Acme Demo platform",
    visibility: "public",
    updatedAt: "2024-06-01T00:00:00.000Z",
    reads: ["visitor", "alice-dev"],
    files: [
      { path: "README.md", content: "# Acme Docs\n\nDocumentation for the Acme Demo platform.\n" },
      { path: "docs/intro.md", content: "# Introduction\n" },
    ],
  },
  {
    name: "secret-research",
    owner: "alice-dev",
    ownerDisplayName: "alice-dev",
    description: "Private research notes for the Acme Demo platform",
    visibility: "private",
    updatedAt: "2024-05-01T00:00:00.000Z",
    reads: ["alice-dev"],
    files: [{ path: "README.md", content: "# Secret Research\n" }],
  },
];

let viewer = "visitor";
const requests: Array<{ method: string; path: string; search: string }> = [];

function summary(repository: SimulatedRepository) {
  return {
    name: repository.name,
    owner: repository.owner,
    ownerType: "account" as const,
    ownerDisplayName: repository.ownerDisplayName,
    fullName: `${repository.ownerDisplayName}/${repository.name}`,
    description: repository.description,
    visibility: repository.visibility,
    defaultBranch: "main",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: repository.updatedAt,
  };
}

function entriesOf(repository: SimulatedRepository, path: string) {
  const prefix = path ? `${path}/` : "";
  const seen = new Map<string, { name: string; path: string; type: "file" | "directory" }>();
  for (const file of repository.files) {
    if (prefix && !file.path.startsWith(prefix)) continue;
    const remainder = path ? file.path.slice(prefix.length) : file.path;
    const [first, ...rest] = remainder.split("/");
    const entryPath = path ? `${path}/${first}` : first;
    if (rest.length > 0) seen.set(entryPath, { name: first, path: entryPath, type: "directory" });
    else if (!seen.has(entryPath)) seen.set(entryPath, { name: first, path: entryPath, type: "file" });
  }
  return [...seen.values()].sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

function readable(repository: SimulatedRepository) {
  return repository.visibility === "public" || repository.reads.includes(viewer);
}

function simulate(method: string, path: string, search: string): SimulatedResponse {
  requests.push({ method, path, search });

  if (path === "/api/session" && method === "GET") {
    return {
      status: 200,
      body: {
        user: viewer === "visitor"
          ? null
          : { username: viewer, email: `${viewer}@example.test`, organizations: [] },
      },
    };
  }

  if (path === "/api/repositories" && method === "GET") {
    return { status: 200, body: { repositories: REPOSITORIES.filter(readable).map(summary) } };
  }

  if (path === "/api/search/repositories" && method === "GET") {
    const query = (new URL(`http://local${path}${search}`).searchParams.get("q") ?? "").trim().toLowerCase();
    const matches = query
      ? REPOSITORIES.filter((repository) => readable(repository) && repository.name.toLowerCase().includes(query))
      : [];
    return { status: 200, body: { query, repositories: matches.map(summary) } };
  }

  if (path.startsWith("/api/namespaces/") && method === "GET") {
    const name = decodeURIComponent(path.slice("/api/namespaces/".length));
    if (name !== "alice-dev") return { status: 404, body: { error: "Namespace not found" } };
    return {
      status: 200,
      body: {
        namespace: { type: "account", name: "alice-dev", displayName: "alice-dev" },
        repositories: REPOSITORIES.filter(readable).map(summary),
      },
    };
  }

  const repositoryMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)(\/contents)?$/);
  if (repositoryMatch && method === "GET") {
    const owner = decodeURIComponent(repositoryMatch[1]);
    const name = decodeURIComponent(repositoryMatch[2]);
    const repository = REPOSITORIES.find(
      (candidate) => candidate.owner === owner && candidate.name === name,
    );
    if (!repository) return { status: 404, body: { error: "Repository not found" } };
    if (!readable(repository)) return { status: 403, body: { error: "Access denied" } };
    if (repositoryMatch[3]) {
      const requested = new URL(`http://local${path}${search}`).searchParams.get("path") ?? "";
      const file = repository.files.find((candidate) => candidate.path === requested);
      if (file) {
        return { status: 200, body: { branch: "main", file: { path: file.path, content: file.content } } };
      }
      const entries = entriesOf(repository, requested);
      if (!requested || entries.length > 0) {
        return { status: 200, body: { branch: "main", path: requested, entries } };
      }
      return { status: 404, body: { error: "File not found" } };
    }
    return {
      status: 200,
      body: {
        repository: {
          ...summary(repository),
          files: repository.files.map((file) => ({ path: file.path })),
          entries: entriesOf(repository, ""),
          cloneUrls: {
            https: `https://github.local/alice-dev/${repository.name}.git`,
            ssh: `git@github.local:alice-dev/${repository.name}.git`,
          },
        },
      },
    };
  }

  return { status: 404, body: { error: "Not found" } };
}

function installFetchMock() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const result = simulate(method, parsed.pathname, parsed.search);
    const all: Record<string, string> = { "content-type": "application/json" };
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      headers: { get: (name: string) => all[name.toLowerCase()] ?? null },
      json: async () => result.body,
      text: async () => JSON.stringify(result.body),
    };
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  viewer = "visitor";
  requests.length = 0;
  window.location.hash = "#/";
  installFetchMock();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function globalSearch() {
  return screen.getByRole("searchbox", { name: "Search" });
}

async function search(text: string) {
  await userEvent.type(globalSearch(), text);
  await userEvent.keyboard("{Enter}");
}

describe("REQ-3-1 search for and locate repositories", () => {
  it("returns the public repository without a type-filter step and hides the private one", async () => {
    render(<App />);
    await search("acme-docs");

    const link = await screen.findByRole("link", { name: "acme-docs" });
    expect(link.getAttribute("href")).toBe("#/alice-dev/acme-docs");
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();

    const results = screen.getByRole("list", { name: "" }).textContent ?? "";
    expect(results).toContain("alice-dev/acme-docs");
    expect(results).toContain("Documentation for the Acme Demo platform");
    expect(results).toContain("Public");
    expect(results).toContain("Updated");

    // The repository type filter is part of the address and can be selected.
    expect(screen.getByRole("link", { name: "Repositories" })).toBeTruthy();

    await userEvent.click(link);
    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("Documentation for the Acme Demo platform")).toBeTruthy();
    });
  });

  it("shows No results for an unmatched query, a cleared term and a non-matching filter", async () => {
    render(<App />);
    await search("no-such-repository");
    expect(await screen.findByText("No results")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "acme-docs" })).toBeNull();

    await userEvent.clear(globalSearch());
    await userEvent.type(globalSearch(), "acme-docs");
    expect(await screen.findByRole("link", { name: "acme-docs" })).toBeTruthy();

    await userEvent.clear(globalSearch());
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "acme-docs" })).toBeNull();
    });
    expect(screen.getByText("No results")).toBeTruthy();

    await userEvent.type(globalSearch(), "acme-docs");
    const result = await screen.findByRole("link", { name: "acme-docs" });

    await userEvent.click(screen.getByRole("link", { name: "Code" }));
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "acme-docs" })).toBeNull();
    });
    expect(result).toBeTruthy();
    expect(screen.getByText("No results")).toBeTruthy();
  });

  it("keeps the result link out of the reach of a visitor for a private repository name", async () => {
    render(<App />);
    await search("secret-research");
    expect(await screen.findByText("No results")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
  });
});

describe("REQ-3-3 view a public repository overview", () => {
  it("shows identity, visibility, description, default branch and files, and opens a file", async () => {
    window.location.hash = "#/alice-dev/acme-docs";
    render(<App />);

    const heading = await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    expect(heading.tagName).toBe("H1");
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Documentation for the Acme Demo platform")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();

    for (const entry of ["Code", "Issues", "Pull requests", "Settings"]) {
      const link = screen.getByRole("link", { name: entry });
      expect((link as HTMLAnchorElement).getAttribute("href")).toContain("/alice-dev/acme-docs");
    }

    // The files of the default branch are listed, and a file name opens the
    // file-content page.
    const readme = screen.getByRole("link", { name: "README.md" });
    expect((readme as HTMLAnchorElement).getAttribute("href")).toBe("#/alice-dev/acme-docs/blob/main/README.md");
    await userEvent.click(readme);

    expect(await screen.findByRole("heading", { name: "README.md" })).toBeTruthy();
    const file = screen.getByRole("article", { name: "README.md" });
    expect(within(file).getByText(/Documentation for the Acme Demo platform/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();
  });

  it("keeps the same repository state after the address is reloaded", async () => {
    window.location.hash = "#/alice-dev/acme-docs";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    cleanup();
    installFetchMock();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
  });

  it("keeps the clone menu button distinct from the Code navigation link", async () => {
    window.location.hash = "#/alice-dev/acme-docs";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    const navLink = screen.getByRole("link", { name: "Code" });
    expect((navLink as HTMLAnchorElement).getAttribute("href")).toBe("#/alice-dev/acme-docs");

    const trigger = screen.getByRole("button", { name: "Code" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("https://github.local/alice-dev/acme-docs.git")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy clone value" })).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "SSH" }));
    expect(screen.getByText("git@github.local:alice-dev/acme-docs.git")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();
  });

  it("does not show the content of a private repository to a visitor", async () => {
    window.location.hash = "#/alice-dev/secret-research";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "alice-dev/secret-research" })).toBeNull();
    expect(screen.queryByText("Private research notes for the Acme Demo platform")).toBeNull();
    expect(screen.queryByRole("link", { name: "Code" })).toBeNull();

    // The owner does see the private repository overview.
    cleanup();
    viewer = "alice-dev";
    installFetchMock();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "alice-dev/secret-research" })).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
  });

  it("lists the public repositories of a personal namespace", async () => {
    window.location.hash = "#/alice-dev";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "alice-dev" })).toBeTruthy();
    const repository = screen.getByRole("link", { name: "acme-docs" });
    expect((repository as HTMLAnchorElement).getAttribute("href")).toBe("#/alice-dev/acme-docs");
    expect(within(screen.getByRole("region", { name: "Repositories" })).queryByText("secret-research")).toBeNull();
  });

  it("identifies the repository page, the settings pages and the lists by owner/name", async () => {
    window.location.hash = "#/alice-dev/acme-docs";
    render(<App />);

    const heading = await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    const identity = within(heading).getByRole("link", { name: "alice-dev/acme-docs" });
    expect((identity as HTMLAnchorElement).getAttribute("href")).toBe("#/alice-dev/acme-docs");

    cleanup();
    window.location.hash = "#/alice-dev/acme-docs/settings/general";
    installFetchMock();
    render(<App />);
    await screen.findByRole("heading", { name: "General" });
    expect(
      (screen.getByRole("link", { name: "alice-dev/acme-docs" }) as HTMLAnchorElement).getAttribute("href"),
    ).toBe("#/alice-dev/acme-docs");

    cleanup();
    window.location.hash = "#/alice-dev";
    installFetchMock();
    render(<App />);
    const listed = await screen.findByRole("link", { name: "alice-dev/acme-docs" });
    expect((listed as HTMLAnchorElement).getAttribute("href")).toBe("#/alice-dev/acme-docs");
    expect(screen.getByRole("link", { name: "acme-docs" })).toBeTruthy();
  });

  it("reaches a repository from the home page list and hides the private one from a visitor", async () => {
    window.location.hash = "#/";
    render(<App />);

    const entry = await screen.findByRole("link", { name: "alice-dev/acme-docs" });
    expect((entry as HTMLAnchorElement).getAttribute("href")).toBe("#/alice-dev/acme-docs");
    expect(screen.queryByRole("link", { name: "alice-dev/secret-research" })).toBeNull();

    await userEvent.click(entry);
    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();

    // The owner sees the private repository of the same list after signing in.
    cleanup();
    viewer = "alice-dev";
    window.location.hash = "#/";
    installFetchMock();
    render(<App />);
    expect(await screen.findByRole("link", { name: "alice-dev/secret-research" })).toBeTruthy();
  });
});

describe("REQ-3-2-3 copy a repository clone value", () => {
  async function openCloneMenu() {
    window.location.hash = "#/alice-dev/acme-docs";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    await userEvent.click(screen.getByRole("button", { name: "Code" }));
  }

  it("writes the selected clone value and reports Copied for each protocol", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await openCloneMenu();
    expect(screen.getByRole("tab", { name: "HTTPS" }).getAttribute("aria-selected")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Copy clone value" }));

    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(writeText).toHaveBeenLastCalledWith("https://github.local/alice-dev/acme-docs.git");
    expect(screen.getByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();

    // The selected protocol decides which complete value is written.
    await userEvent.click(screen.getByRole("tab", { name: "SSH" }));
    expect(screen.queryByText("Copied")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Copy clone value" }));
    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(writeText).toHaveBeenLastCalledWith("git@github.local:alice-dev/acme-docs.git");

    // Closing and reopening the menu keeps the selected protocol.
    await userEvent.click(screen.getByRole("button", { name: "Code" }));
    await userEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.getByRole("tab", { name: "SSH" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();
  });

  it("falls back to the selection-based copy when the Clipboard API is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const execCommand = vi.fn(() => true);
    (document as unknown as { execCommand?: unknown }).execCommand = execCommand;
    try {
      await openCloneMenu();
      await userEvent.click(screen.getByRole("button", { name: "Copy clone value" }));
      expect(await screen.findByText("Copied")).toBeTruthy();
      expect(execCommand).toHaveBeenCalledWith("copy");
    } finally {
      delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });
});
