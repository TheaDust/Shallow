import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initialStub, installFetch, open } from "./testing/pullRequestTestHarness";

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * REQ-6-3-2: the Files changed section of a pull request is the read-only diff of
 * the current base and compare commits. A visitor reaches it from the seeded
 * public Open pull request `Fix search`, sees the known changed-file path
 * `src/search.ts` verbatim next to one added file, the added/deleted lines of
 * every file and the aggregate statistics in the format
 * `<addition count> additions, <deletion count> deletions`. Reading, selecting
 * and reloading the diff writes nothing.
 */
describe("the changed files of a pull request", () => {
  it("shows the changed paths, their lines and the aggregate statistics as a visitor", async () => {
    const stub = initialStub();
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls");
    await user.click(await screen.findByRole("link", { name: "Fix search" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Fix search" })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Files changed" }));

    expect(await screen.findByRole("heading", { name: "Changed files" })).toBeTruthy();
    // The known changed-file path of the comparison and the one added file.
    expect(screen.getByRole("link", { name: "src/search.ts" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "main-only.md" })).toBeTruthy();
    // The aggregate statistics: changed files and the exact line-count format.
    expect(screen.getByText("2 changed files")).toBeTruthy();
    expect(screen.getByText("3 additions, 1 deletions")).toBeTruthy();

    // Every diff block displays the added or deleted lines of its own file.
    const modified = screen
      .getByRole("link", { name: "src/search.ts" })
      .closest("li") as HTMLElement;
    expect(
      within(modified).getByText("-export function countSearchFlow(lines: string[]): number {"),
    ).toBeTruthy();
    const added = screen
      .getByRole("link", { name: "main-only.md" })
      .closest("li") as HTMLElement;
    expect(within(added).getByText("+This note file exists only on feature-search.")).toBeTruthy();

    // Unchanged files are not part of the comparison.
    expect(screen.queryByText("README.md")).toBeNull();
    expect(screen.queryByText("docs/README.md")).toBeNull();
    expect(screen.queryByText("src/loader.ts")).toBeNull();

    // Reading the diff of a public pull request stores nothing.
    expect(stub.writes).toEqual([]);
  });

  it("selects the modified file without leaving the pull request and keeps it on reload", async () => {
    const stub = initialStub();
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/2?tab=files");
    await screen.findByRole("heading", { name: "Changed files" });

    await user.click(screen.getByRole("link", { name: "src/search.ts" }));

    // The same pull request stays open: title, status, aggregate statistics and
    // every section link remain readable while the file's diff is inspected.
    expect(screen.getByRole("heading", { level: 1, name: "Fix search" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("2 changed files")).toBeTruthy();
    expect(screen.getByText("3 additions, 1 deletions")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Conversation" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "src/search.ts" }).getAttribute("aria-current")).toBe(
      "true",
    );
    expect(window.location.hash).toContain("pulls/2");
    expect(window.location.hash).toContain("path=");
    expect(stub.writes).toEqual([]);

    // Reloading the same address restores the same file selection and files.
    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls/2?tab=files&path=src/search.ts");
    expect(await screen.findByRole("heading", { level: 1, name: "Fix search" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("2 changed files")).toBeTruthy();
    expect(screen.getByText("3 additions, 1 deletions")).toBeTruthy();
    expect(screen.getByRole("link", { name: "src/search.ts" }).getAttribute("aria-current")).toBe(
      "true",
    );
    expect(stub.writes).toEqual([]);
  });

  it("keeps the files, status and review summary when switching back to Conversation", async () => {
    const stub = initialStub();
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/2?tab=files");
    await screen.findByRole("heading", { name: "Changed files" });
    await user.click(screen.getByRole("link", { name: "src/search.ts" }));
    await user.click(screen.getByRole("link", { name: "Conversation" }));

    expect(
      await screen.findByText("Search must read the branch that is currently browsed."),
    ).toBeTruthy();
    expect(screen.getByText("No reviews yet.")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Files changed" }));
    expect(await screen.findByRole("heading", { name: "Changed files" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "src/search.ts" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "main-only.md" })).toBeTruthy();
    expect(screen.getByText("3 additions, 1 deletions")).toBeTruthy();
    expect(stub.writes).toEqual([]);
  });
});
