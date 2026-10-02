import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { createRepositoryMock, type MockRepositoryServer } from "../../test/repository-server-mock";

/**
 * REQ-6-4 (reviewer requests), REQ-6-5 (merge control) and REQ-6-6 (close and
 * reopen) of the pull request detail page. Every write is read back from the
 * mock server state, so an optimistic copy can never pass these checks.
 */

let server: MockRepositoryServer;

beforeEach(() => {
  server = createRepositoryMock({ viewer: null });
  window.location.hash = "#/";
  server.install();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function reset(viewer: string | null, hash: string) {
  cleanup();
  server = createRepositoryMock({ viewer });
  window.location.hash = hash;
  server.install();
}

/** Continues with the current mock state under another viewer. */
function reopenAs(viewer: string | null, hash: string) {
  cleanup();
  server = createRepositoryMock({ viewer, repositories: server.state.repositories });
  window.location.hash = hash;
  server.install();
}

/** Renders the application again for the same address, as a reload would. */
function reload() {
  cleanup();
  render(<App />);
}

function storedPullRequest(repositoryName: string, number: number) {
  return server.state.repositories
    .find((repository) => repository.name === repositoryName)!
    .pullRequests.find((pullRequest) => pullRequest.number === number)!;
}

function branchHead(repositoryName: string, branchName: string) {
  return server.state.repositories
    .find((repository) => repository.name === repositoryName)!
    .branches.find((branch) => branch.name === branchName)!.headId;
}

async function openDetail(viewer: string | null, path: string, title: string) {
  reset(viewer, path);
  render(<App />);
  return screen.findByRole("heading", { name: title, level: 1 });
}

describe("REQ-6-4 request or remove pull request reviewers", () => {
  it("requests an eligible account from the Reviewers picker and removes it again", async () => {
    await openDetail("alice-dev", "#/alice-dev/acme-docs/pulls/1", "Improve onboarding");
    const area = within(await screen.findByRole("region", { name: "Reviewers" }));
    expect(area.getByText("No reviewers requested.")).toBeTruthy();

    await userEvent.click(area.getByRole("button", { name: "Reviewers" }));
    // Typing the eligible username reveals the option with that exact name.
    await userEvent.type(await screen.findByRole("textbox", { name: "Search" }), "bob-reviewer");
    expect(screen.queryByRole("option", { name: "carol-maintainer" })).toBeNull();
    await userEvent.click(screen.getByRole("option", { name: "bob-reviewer" }));

    // Selecting saves right away, closes the picker and shows the username.
    await waitFor(() => expect(storedPullRequest("acme-docs", 1).reviewers).toEqual(["bob-reviewer"]));
    expect(screen.queryByRole("textbox", { name: "Search" })).toBeNull();
    await waitFor(() => expect(area.getByRole("button", { name: "Remove bob-reviewer" })).toBeTruthy());

    // The request survives a reload and grants no review decision.
    reload();
    await screen.findByRole("heading", { name: "Improve onboarding", level: 1 });
    const reloaded = within(await screen.findByRole("region", { name: "Reviewers" }));
    expect(reloaded.getByText("bob-reviewer")).toBeTruthy();
    expect(storedPullRequest("acme-docs", 1).reviews).toEqual([]);

    // One click removes the request again, without a confirmation step.
    await userEvent.click(reloaded.getByRole("button", { name: "Remove bob-reviewer" }));
    await waitFor(() => expect(storedPullRequest("acme-docs", 1).reviewers).toEqual([]));
    expect(await screen.findByText("No reviewers requested.")).toBeTruthy();

    reload();
    await screen.findByRole("heading", { name: "Improve onboarding", level: 1 });
    expect(await screen.findByText("No reviewers requested.")).toBeTruthy();
  });

  it("offers no ineligible account as a reviewer option", async () => {
    await openDetail("alice-dev", "#/alice-dev/acme-docs/pulls/1", "Improve onboarding");
    const area = within(await screen.findByRole("region", { name: "Reviewers" }));

    await userEvent.click(area.getByRole("button", { name: "Reviewers" }));
    await userEvent.type(await screen.findByRole("textbox", { name: "Search" }), "dana-observer");

    // The account without any repository role is never a candidate, and the
    // author of the proposal cannot be requested either.
    expect(screen.queryByRole("option", { name: "dana-observer" })).toBeNull();
    expect(screen.getByText("No matching reviewer")).toBeTruthy();
    await userEvent.clear(screen.getByRole("textbox", { name: "Search" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search" }), "alice-dev");
    expect(screen.queryByRole("option", { name: "alice-dev" })).toBeNull();
  });

  it("shows the request read-only to an account that may not manage it", async () => {
    await openDetail("alice-dev", "#/alice-dev/acme-docs/pulls/1", "Improve onboarding");
    const area = within(await screen.findByRole("region", { name: "Reviewers" }));
    await userEvent.click(area.getByRole("button", { name: "Reviewers" }));
    await userEvent.type(await screen.findByRole("textbox", { name: "Search" }), "bob-reviewer");
    await userEvent.click(screen.getByRole("option", { name: "bob-reviewer" }));
    await waitFor(() => expect(storedPullRequest("acme-docs", 1).reviewers).toEqual(["bob-reviewer"]));

    reopenAs("dana-observer", "#/alice-dev/acme-docs/pulls/1");
    render(<App />);
    await screen.findByRole("heading", { name: "Improve onboarding", level: 1 });
    const readOnly = within(await screen.findByRole("region", { name: "Reviewers" }));
    expect(readOnly.getByText("bob-reviewer")).toBeTruthy();
    expect(readOnly.queryByRole("button", { name: "Reviewers" })).toBeNull();
    expect(readOnly.queryByRole("button", { name: "Remove bob-reviewer" })).toBeNull();

    // The write itself is refused at the trust boundary.
    const response = await fetch("/api/repositories/alice-dev/acme-docs/pulls/1/reviewers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "carol-maintainer" }),
    });
    expect(response.status).toBe(403);
    expect(storedPullRequest("acme-docs", 1).reviewers).toEqual(["bob-reviewer"]);
  });
});

describe("REQ-6-5 merge an eligible pull request", () => {
  it("offers only Create a merge commit and merges after Confirm merge", async () => {
    await openDetail("carol-maintainer", "#/alice-dev/merge-lab/pulls/1", "Merge the release notes");
    expect(await screen.findByText("This pull request is mergeable.")).toBeTruthy();

    const mergeArea = within(await screen.findByRole("region", { name: "Merge status" }));
    // The sole supported method is displayed and selected.
    const method = mergeArea.getByRole("radio", { name: "Create a merge commit" }) as HTMLInputElement;
    expect(method.checked).toBe(true);
    expect(mergeArea.getAllByRole("radio").length).toBe(1);
    expect(mergeArea.getByText("Require 1 approval: satisfied")).toBeTruthy();
    expect(mergeArea.getByText("Require status check test: satisfied")).toBeTruthy();
    expect(branchHead("merge-lab", "main")).toBe("7e2b9c1-merge-lab-initial");

    const button = mergeArea.getByRole("button", { name: "Merge pull request" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await userEvent.click(button);
    await userEvent.click(await screen.findByRole("button", { name: "Confirm merge" }));

    await waitFor(() => expect(storedPullRequest("merge-lab", 1).status).toBe("merged"));
    expect(await screen.findByText("Merged")).toBeTruthy();
    const stored = storedPullRequest("merge-lab", 1);
    expect(stored.mergedBy).toBe("carol-maintainer");
    expect(branchHead("merge-lab", "main")).toBe(stored.mergeCommitId);
    expect(screen.getByText(/Merged by carol-maintainer at/)).toBeTruthy();
    expect(screen.getByText(new RegExp(`in commit ${stored.mergeCommitId}`))).toBeTruthy();

    // The merged state and the resulting commit stay after a reload.
    reload();
    await screen.findByRole("heading", { name: "Merge the release notes", level: 1 });
    expect(await screen.findByText("Merged")).toBeTruthy();
    expect(screen.getByText(new RegExp(`in commit ${stored.mergeCommitId}`))).toBeTruthy();
  });

  it("keeps the merge entry disabled and explains the missing approval before a click", async () => {
    await openDetail("carol-maintainer", "#/alice-dev/merge-lab/pulls/2", "Update the merge checklist");

    expect(await screen.findByText("This pull request is unmergeable.")).toBeTruthy();
    const mergeArea = within(await screen.findByRole("region", { name: "Merge status" }));
    expect(mergeArea.getByText("Review required by branch protection")).toBeTruthy();
    expect(mergeArea.getByText("Require 1 approval: not satisfied")).toBeTruthy();
    expect(mergeArea.getByText("Require status check test: satisfied")).toBeTruthy();
    const button = mergeArea.getByRole("button", { name: "Merge pull request" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    // The server refuses the merge too and changes neither branch nor status.
    const response = await fetch("/api/repositories/alice-dev/merge-lab/pulls/2/merge", { method: "POST" });
    expect(response.status).toBe(400);
    expect(storedPullRequest("merge-lab", 2).status).toBe("open");
    expect(branchHead("merge-lab", "main")).toBe("7e2b9c1-merge-lab-initial");
  });

  it("offers no merge entry to a reviewer who may not merge", async () => {
    await openDetail("bob-reviewer", "#/alice-dev/merge-lab/pulls/1", "Merge the release notes");
    const mergeArea = within(await screen.findByRole("region", { name: "Merge status" }));
    expect(mergeArea.queryByRole("button", { name: "Merge pull request" })).toBeNull();

    const response = await fetch("/api/repositories/alice-dev/merge-lab/pulls/1/merge", { method: "POST" });
    expect(response.status).toBe(403);
    expect(storedPullRequest("merge-lab", 1).status).toBe("open");
  });
});

describe("REQ-6-6 close or reopen a pull request without merging", () => {
  it("closes and reopens an authored pull request without touching a branch", async () => {
    await openDetail("alice-dev", "#/alice-dev/acme-docs/pulls/1", "Improve onboarding");
    const head = branchHead("acme-docs", "main");

    // Closing is immediate: no confirmation appears.
    await userEvent.click(screen.getByRole("button", { name: "Close pull request" }));
    await waitFor(() => expect(storedPullRequest("acme-docs", 1).status).toBe("closed"));
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(await screen.findByText("Closed")).toBeTruthy();

    // Reopening restores Open and the close entry comes back.
    await userEvent.click(await screen.findByRole("button", { name: "Reopen pull request" }));
    await waitFor(() => expect(storedPullRequest("acme-docs", 1).status).toBe("open"));
    await waitFor(() => expect(screen.getByText("Open")).toBeTruthy());
    expect(await screen.findByRole("button", { name: "Close pull request" })).toBeTruthy();

    // Both transitions are recorded and no branch moved.
    const transitions = storedPullRequest("acme-docs", 1).timeline.map((event) => event.text);
    expect(transitions).toContain("closed this pull request");
    expect(transitions).toContain("reopened this pull request");
    expect(branchHead("acme-docs", "main")).toBe(head);

    reload();
    await screen.findByRole("heading", { name: "Improve onboarding", level: 1 });
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Close pull request" })).toBeTruthy();
    expect(screen.getByText("The onboarding steps read much better now. Please add a screenshot of the first run.")).toBeTruthy();
  });

  it("shows neither entry to a viewer who is not the author and not a maintainer", async () => {
    await openDetail("dana-observer", "#/alice-dev/acme-docs/pulls/1", "Improve onboarding");

    expect(screen.queryByRole("button", { name: "Close pull request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen pull request" })).toBeNull();

    const response = await fetch("/api/repositories/alice-dev/acme-docs/pulls/1/close", { method: "POST" });
    expect(response.status).toBe(403);
    expect(storedPullRequest("acme-docs", 1).status).toBe("open");
  });

  it("keeps a merged pull request terminal", async () => {
    await openDetail("carol-maintainer", "#/alice-dev/merge-lab/pulls/1", "Merge the release notes");
    const mergeArea = within(await screen.findByRole("region", { name: "Merge status" }));
    await userEvent.click(mergeArea.getByRole("button", { name: "Merge pull request" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm merge" }));
    await waitFor(() => expect(storedPullRequest("merge-lab", 1).status).toBe("merged"));

    await waitFor(() => expect(screen.getByText("Merged")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Close pull request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen pull request" })).toBeNull();

    const response = await fetch("/api/repositories/alice-dev/merge-lab/pulls/1/close", { method: "POST" });
    expect(response.status).toBe(400);
    expect(storedPullRequest("merge-lab", 1).status).toBe("merged");
  });
});
