import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ALICE, initialStub, installFetch, open } from "./testing/pullRequestTestHarness";

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * REQ-6-3-1: the pull-request detail page is the unified read view of one stored
 * proposal. The seeded public Open pull request `Fix search` is readable without
 * sign-in, Conversation/Commits/Files changed are navigation links of the same
 * page, and viewing the sections writes nothing.
 */
describe("the pull request overview and commits", () => {
  it("opens the seeded public Open pull request from its list title as a visitor", async () => {
    const stub = initialStub();
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls");
    await user.click(await screen.findByRole("link", { name: "Fix search" }));

    // The exact persisted title is the heading of the detail page.
    expect(await screen.findByRole("heading", { level: 1, name: "Fix search" })).toBeTruthy();
    // The same stored proposal: its number, status, description, discussion and
    // the base/compare branches of the comparison.
    expect(screen.getByText("#2")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(
      screen.getByText("Search must read the branch that is currently browsed."),
    ).toBeTruthy();
    expect(
      screen.getByText("The helper looks right; please add a check for the loader."),
    ).toBeTruthy();
    expect(screen.getByText("feature-search")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();

    for (const name of ["Conversation", "Commits", "Files changed", "Checks"]) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
    // The check of the current compare commit is readable on arrival.
    expect(screen.getByText("test: pending")).toBeTruthy();

    // Reading the overview creates no comment, review, branch or status record.
    expect(stub.writes).toEqual([]);
  });

  it("switches among the three sections of the same pull request", async () => {
    const stub = initialStub();
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/2");
    await screen.findByRole("heading", { level: 1, name: "Fix search" });

    await user.click(screen.getByRole("link", { name: "Commits" }));
    expect(await screen.findByRole("heading", { name: "Commit summary" })).toBeTruthy();
    expect(screen.getByText("1 commit")).toBeTruthy();
    // The commits of the compare branch relative to the base branch.
    expect(screen.getByRole("link", { name: "Add main-only notes" })).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Files changed" }));
    expect(await screen.findByRole("heading", { name: "Changed files" })).toBeTruthy();
    expect(screen.getByText("2 changed files")).toBeTruthy();
    expect(screen.getByRole("link", { name: "src/search.ts" })).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Conversation" }));
    expect(
      await screen.findByText("Search must read the branch that is currently browsed."),
    ).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();

    expect(stub.writes).toEqual([]);
  });

  it("keeps the heading, branches and commits after reloading a section", async () => {
    const stub = initialStub();
    installFetch(stub);

    open("#/repos/alice-dev/acme-docs/pulls/2?tab=commits");
    expect(await screen.findByRole("heading", { level: 1, name: "Fix search" })).toBeTruthy();
    expect(screen.getByText("feature-search")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add main-only notes" })).toBeTruthy();

    cleanup();
    open("#/repos/alice-dev/acme-docs/pulls/2?tab=commits");
    expect(await screen.findByRole("heading", { level: 1, name: "Fix search" })).toBeTruthy();
    expect(screen.getByText("feature-search")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add main-only notes" })).toBeTruthy();
    for (const name of ["Conversation", "Commits", "Files changed", "Checks"]) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
    expect(stub.writes).toEqual([]);
  });

  it("offers the same reading view to a signed-in contributor", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "admin";
    installFetch(stub);
    const user = userEvent.setup();

    open("#/repos/alice-dev/acme-docs/pulls/2");
    expect(await screen.findByRole("heading", { level: 1, name: "Fix search" })).toBeTruthy();
    expect(
      screen.getByText("The helper looks right; please add a check for the loader."),
    ).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Commits" }));
    expect(await screen.findByRole("link", { name: "Add main-only notes" })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Files changed" }));
    expect(await screen.findByRole("link", { name: "src/search.ts" })).toBeTruthy();

    // Switching sections of an Open pull request changes no persisted record.
    expect(stub.writes).toEqual([]);
  });
});
