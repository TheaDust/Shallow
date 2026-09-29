import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CodePage } from "./CodePage";
import { BlobPage } from "./BlobPage";

const mocks = vi.hoisted(() => ({
  getRepositoryContents: vi.fn(),
}));

vi.mock("./api", () => ({
  getRepositoryContents: mocks.getRepositoryContents,
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
});

describe("CodePage", () => {
  it("lists directory entries with links to the matching tree or blob", async () => {
    window.location.hash = "#/repos/acme-demo/acme-docs/tree";
    mocks.getRepositoryContents.mockResolvedValue({
      repository: { owner: "acme-demo", name: "acme-docs" },
      branch: "main",
      path: "/",
      type: "dir",
      entries: [
        { name: "README.md", path: "README.md", type: "file" },
        { name: "src", path: "src", type: "dir" },
      ],
      myRole: null,
      commitCount: 2,
    });
    render(<CodePage owner="acme-demo" name="acme-docs" />);

    expect(await screen.findByText("Branch: main")).toBeTruthy();
    const readme = screen.getByRole("link", { name: "README.md" });
    expect(readme.getAttribute("href")).toBe(
      "#/repos/acme-demo/acme-docs/blob?branch=main&path=README.md",
    );
    const docs = screen.getByRole("link", { name: "src" });
    expect(docs.getAttribute("href")).toBe(
      "#/repos/acme-demo/acme-docs/tree?branch=main&path=src",
    );
  });

  it("shows a Commits link with the branch history address", async () => {
    window.location.hash = "#/repos/acme-demo/acme-docs/tree";
    mocks.getRepositoryContents.mockResolvedValue({
      repository: { owner: "acme-demo", name: "acme-docs" },
      branch: "main",
      path: "/",
      type: "dir",
      entries: [],
      myRole: null,
      commitCount: 2,
    });
    render(<CodePage owner="acme-demo" name="acme-docs" />);

    const commits = await screen.findByRole("link", { name: "Commits" });
    expect(commits.getAttribute("href")).toBe(
      "#/repos/acme-demo/acme-docs/commits?branch=main",
    );
    expect(screen.getByText("2 commits")).toBeTruthy();
  });

  it("hides the Add file button for non-writable roles", async () => {
    window.location.hash = "#/repos/acme-demo/acme-docs/tree";
    mocks.getRepositoryContents.mockResolvedValue({
      repository: { owner: "acme-demo", name: "acme-docs" },
      branch: "main",
      path: "/",
      type: "dir",
      entries: [],
      myRole: "read",
      commitCount: 2,
    });
    render(<CodePage owner="acme-demo" name="acme-docs" />);
    await screen.findByRole("link", { name: "Commits" });
    expect(screen.queryByRole("button", { name: "Add file" })).toBeNull();
  });
});

describe("BlobPage", () => {
  it("shows the file content with branch and breadcrumbs", async () => {
    window.location.hash = "#/repos/acme-demo/acme-docs/blob?branch=main&path=README.md";
    mocks.getRepositoryContents.mockResolvedValue({
      repository: { owner: "acme-demo", name: "acme-docs" },
      branch: "main",
      path: "README.md",
      type: "file",
      name: "README.md",
      content: "# Acme Documentation\n\nsearch flow",
      commit: { id: "c2", message: "Document search flow", author: "alice-dev", createdAt: "2026-09-01T00:00:00.000Z" },
      myRole: null,
      commitCount: 2,
    });
    render(<BlobPage owner="acme-demo" name="acme-docs" />);

    expect(await screen.findByText("Branch: main")).toBeTruthy();
    expect(screen.getByText(/Acme Documentation/)).toBeTruthy();
    expect(screen.getByText("Document search flow by alice-dev")).toBeTruthy();
    expect(screen.getByRole("link", { name: "root" })).toBeTruthy();
  });

  it("provides a file-scoped Commits link and a link named after the file", async () => {
    window.location.hash = "#/repos/acme-demo/acme-docs/blob?branch=main&path=README.md";
    mocks.getRepositoryContents.mockResolvedValue({
      repository: { owner: "acme-demo", name: "acme-docs" },
      branch: "main",
      path: "README.md",
      type: "file",
      name: "README.md",
      content: "content",
      commit: { id: "c2", message: "Document search flow", author: "alice-dev", createdAt: "2026-09-01T00:00:00.000Z" },
      myRole: "admin",
      commitCount: 2,
    });
    render(<BlobPage owner="acme-demo" name="acme-docs" />);

    const commits = await screen.findByRole("link", { name: "Commits" });
    expect(commits.getAttribute("href")).toBe(
      "#/repos/acme-demo/acme-docs/commits?branch=main&path=README.md",
    );
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit" })).toBeTruthy();
  });
});
