import { describe, expect, it } from "vitest";

import { buildCodeModel, directoryEntries, type RepositoryCodeSource } from "./repository-code";
import { relativeTime } from "./relative-time";

const ORG = { type: "organization" as const, name: "acme-demo" };

function source(overrides: Partial<RepositoryCodeSource> = {}): RepositoryCodeSource {
  return {
    repository: { defaultBranch: "main" },
    branch: "main",
    branches: [{ name: "main" }],
    files: [
      { path: "README.md", content: "Document search flow\n" },
      { path: "src/README.md", content: "Document search flow\n" },
      { path: "src/search.ts", content: "export const search = 1;\n" },
    ],
    ...overrides,
  };
}

describe("code page model", () => {
  it("lists directories before files with their exact names", () => {
    const files = source().files ?? [];
    expect(directoryEntries(files, "")).toEqual([
      { type: "directory", name: "src", path: "src" },
      { type: "file", name: "README.md", path: "README.md" },
    ]);
    expect(directoryEntries(files, "src")).toEqual([
      { type: "file", name: "README.md", path: "src/README.md" },
      { type: "file", name: "search.ts", path: "src/search.ts" },
    ]);
    expect(directoryEntries(files, "no-such-directory")).toEqual([]);
  });

  it("addresses every entry by the branch, path and file it opens", () => {
    const model = buildCodeModel(ORG, "acme-docs", source(), {});
    expect(model.branch).toBe("main");
    expect(model.entries.filter((entry) => entry.type === "directory").map((entry) => entry.href)).toEqual([
      "#/organizations/acme-demo/repositories/acme-docs?path=src",
    ]);
    expect(model.entries.filter((entry) => entry.type === "file").map((entry) => entry.href)).toEqual([
      "#/organizations/acme-demo/repositories/acme-docs?file=README.md",
    ]);
    expect(model.path).toBe("");
    expect(model.file).toBeNull();
  });

  it("keeps the directory in the address of the file it opens", () => {
    const model = buildCodeModel(ORG, "acme-docs", source(), { path: "src", file: "src/README.md" });
    expect(model.path).toBe("src");
    expect(
      model.entries.filter((entry) => entry.type === "file").map((entry) => [entry.name, entry.href]),
    ).toEqual([
      ["README.md", "#/organizations/acme-demo/repositories/acme-docs?path=src&file=src%2FREADME.md"],
      ["search.ts", "#/organizations/acme-demo/repositories/acme-docs?path=src&file=src%2Fsearch.ts"],
    ]);
    expect(model.file).toEqual({
      path: "src/README.md",
      name: "README.md",
      content: "Document search flow\n",
      href: "#/organizations/acme-demo/repositories/acme-docs?path=src&file=src%2FREADME.md",
    });
  });

  it("falls back to the default-branch README of a payload without a file listing", () => {
    const model = buildCodeModel(
      { type: "user", name: "fork-user" },
      "acme-docs-copy",
      {
        repository: { defaultBranch: "main" },
        readme: { path: "README.md", content: "# acme-docs\n" },
      },
      { file: "README.md" },
    );
    expect(model.entries).toHaveLength(1);
    expect(model.entries[0].name).toBe("README.md");
    expect(model.branch).toBe("main");
    expect(model.branches).toEqual([{ name: "main" }]);
    expect(model.file?.content).toBe("# acme-docs\n");
  });

  it("carries a non-default branch in every address", () => {
    const model = buildCodeModel(
      ORG,
      "acme-docs",
      source({ branch: "feature-search", branches: [{ name: "feature-search" }, { name: "main" }] }),
      {},
    );
    expect(model.branch).toBe("feature-search");
    expect(model.entries.every((entry) => entry.href.includes("branch=feature-search"))).toBe(true);
  });
});

describe("relative time", () => {
  it("describes a past commit with an 'ago' timestamp", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    expect(relativeTime("2024-03-05T09:00:00.000Z", now)).toBe("2 years ago");
    expect(relativeTime("2025-12-31T23:59:00.000Z", now)).toBe("1 minute ago");
    expect(relativeTime("invalid", now)).toBe("invalid");
  });
});
