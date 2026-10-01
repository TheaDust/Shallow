// Issue fixtures for the component tests: the seeded `acme-docs` work items
// with their labels, milestone, comment and activity, plus the protected
// private repository that holds a different issue. They mirror the stored
// records the server seeds, without importing production code.

import type { StubOrganization } from "./auth-stub";

export const OWNER = {
  username: "alice-dev",
  email: "alice.dev@example.test",
  password: "Valid-password-123!",
};

export const MEMBER = {
  username: "bob-reviewer",
  email: "bob.reviewer@example.test",
  password: "Valid-password-123!",
};

export const ISSUE_SEED_ORGANIZATION: StubOrganization = {
  name: "acme-demo",
  displayName: "Acme Demo",
  members: [
    { username: "alice-dev", role: "owner" },
    { username: "bob-reviewer", role: "member" },
  ],
  repositories: [
    {
      name: "acme-docs",
      description: "Documentation for the Acme Demo platform.",
      visibility: "public",
      defaultBranch: "main",
      branches: ["main"],
      files: [{ path: "README.md", content: "# Acme Docs\n" }],
      labels: [
        { name: "bug", color: "d73a4a", description: "Something is not working" },
        { name: "documentation", color: "0075ca" },
      ],
      milestones: [
        { title: "Q3 launch", state: "open" },
        // The selectable milestone no seeded issue is associated with yet.
        { title: "v1.0", state: "open" },
      ],
      issues: [
        {
          number: 1,
          title: "Improve onboarding",
          body: "Describe the onboarding improvement.",
          state: "open",
          author: "alice-dev",
          // The seeded open issue starts without an assignee and without the
          // `bug` label, so the metadata scenarios add and remove exactly one
          // association on it.
          assignees: [],
          labels: ["documentation"],
          milestone: "Q3 launch",
          createdAt: "2024-01-02T09:00:00.000Z",
          updatedAt: "2024-01-03T10:00:00.000Z",
          comments: [
            {
              author: "alice-dev",
              body: "Start with the first-run checklist.",
              createdAt: "2024-01-03T10:00:00.000Z",
            },
          ],
        },
        {
          number: 2,
          title: "Legacy welcome text",
          body: "Replace the legacy welcome text on the home page.",
          state: "closed",
          author: "alice-dev",
          labels: ["bug"],
          createdAt: "2024-01-04T09:00:00.000Z",
          updatedAt: "2024-01-05T09:00:00.000Z",
          closedAt: "2024-01-05T09:00:00.000Z",
          closedBy: "alice-dev",
        },
        // The invalid-edit seed: a separate issue whose original title is the
        // one the refused save must keep.
        {
          number: 3,
          title: "Original issue title",
          body: "Describe the original issue.",
          state: "open",
          author: "alice-dev",
          createdAt: "2024-01-06T09:00:00.000Z",
          updatedAt: "2024-01-06T11:00:00.000Z",
          comments: [
            {
              author: "alice-dev",
              body: "Keep the original scope for now.",
              createdAt: "2024-01-06T11:00:00.000Z",
            },
          ],
        },
      ],
    },
    {
      name: "secret-research",
      description: "Private research notes.",
      visibility: "private",
      defaultBranch: "main",
      files: [{ path: "README.md", content: "# Secret research\n" }],
      issues: [
        {
          number: 1,
          title: "Protected research issue",
          body: "Private body.",
          state: "open",
          author: "alice-dev",
          createdAt: "2024-01-06T09:00:00.000Z",
        },
      ],
    },
  ],
};

export const ISSUES_ADDRESS = "#/repositories/acme-demo/acme-docs/issues";
export const ISSUE_ADDRESS = "#/repositories/acme-demo/acme-docs/issues/1";
export const INVALID_EDIT_ISSUE_ADDRESS = "#/repositories/acme-demo/acme-docs/issues/3";
export const NEW_ISSUE_ADDRESS = "#/repositories/acme-demo/acme-docs/issues/new";
