import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface MockFile {
  path: string;
  content: string;
}

interface MockCommit {
  id: string;
  shortId: string;
  parentId: string | null;
  authorName: string;
  message: string;
  createdAt: string;
  changes: { path: string; status: string; additions: number; deletions: number }[];
  files: MockFile[];
}

interface MockPull {
  number: number;
  title: string;
  description: string;
  status: "open" | "draft" | "closed" | "merged";
  baseBranch: string;
  compareBranch: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  check: { name: string; status: string; setter: string | null; setAt: string | null };
  reviews: { id: string; author: string; decision: string; commitId: string; createdAt: string; explanation?: string }[];
  comments: { id: string; author: string; body: string; createdAt: string }[];
  activities: { id: string; type: string; actor: string; createdAt: string }[];
  inlineComments?: {
    id: string;
    author: string;
    path: string;
    line: number;
    commitId: string | null;
    body: string;
    published: boolean;
    outdated: boolean;
    createdAt: string;
  }[];
  reviewers?: { id: string; username: string; requestedBy: { username: string }; createdAt: string }[];
}

interface MockRule {
  branch: string;
  requireApproval: boolean;
  requireStatusCheck: boolean;
}

const ALICE = { username: "alice-dev", email: "alice.dev@example.test" };
const BOB = { username: "bob-reviewer", email: "bob.reviewer@example.test" };
const CAROL = { username: "carol-dev", email: "carol.dev@example.test" };

const MAIN_FILES: MockFile[] = [
  { path: "README.md", content: "# Acme Docs\n\nPublic documentation.\n" },
  { path: "guide.md", content: "# Guide\n\nHow to use it.\n" },
  { path: "src/search.ts", content: "export function search(q: string) {\n  return q.trim();\n}\n" },
  { path: "docs/overview.md", content: "# Overview\n" },
];
const FEATURE_FILES: MockFile[] = [
  { path: "README.md", content: "# Acme Docs\n\nPublic documentation.\n" },
  { path: "guide.md", content: "# Guide\n\nHow to use it.\n" },
  { path: "src/search.ts", content: "export function search(q: string) {\n  return q.trim().toLowerCase();\n}\n" },
  { path: "main-only.md", content: "# Main-only\n" },
];
const RELEASE_FILES: MockFile[] = [
  ...MAIN_FILES.map((file) =>
    file.path === "src/search.ts"
      ? { path: "src/search.ts", content: "export function search(q: string) {\n  return q.trim().toLowerCase();\n}\n" }
      : file,
  ),
  { path: "CHANGELOG.md", content: "# Changelog\n\n- Document the search flow for the next release.\n" },
];

const COMMIT_A: MockCommit = {
  id: "commit_a",
  shortId: "aaaaaaa",
  parentId: null,
  authorName: "alice-dev",
  message: "Initial commit",
  createdAt: "2026-09-20T10:00:00.000Z",
  changes: [],
  files: MAIN_FILES,
};
const COMMIT_B: MockCommit = {
  id: "commit_b",
  shortId: "bbbbbbb",
  parentId: "commit_a",
  authorName: "alice-dev",
  message: "Document search flow",
  createdAt: "2026-09-24T10:00:00.000Z",
  changes: [],
  files: MAIN_FILES,
};
const COMMIT_F: MockCommit = {
  id: "commit_f",
  shortId: "fffffff",
  parentId: "commit_b",
  authorName: "alice-dev",
  message: "Add feature search docs",
  createdAt: "2026-09-25T10:00:00.000Z",
  changes: [],
  files: FEATURE_FILES,
};
const COMMIT_R: MockCommit = {
  id: "commit_r",
  shortId: "rrrrrrr",
  parentId: "commit_b",
  authorName: "alice-dev",
  message: "Add changelog",
  createdAt: "2026-09-25T11:00:00.000Z",
  changes: [],
  files: RELEASE_FILES,
};

function diffFiles(baseFiles: MockFile[], compareFiles: MockFile[]) {
  const baseMap = new Map(baseFiles.map((file) => [file.path, file]));
  const compareMap = new Map(compareFiles.map((file) => [file.path, file]));
  const paths = new Set([...baseMap.keys(), ...compareMap.keys()]);
  const files: {
    path: string;
    status: "added" | "modified" | "deleted";
    additions: number;
    deletions: number;
    lines: { type: "context" | "add" | "del"; text: string }[];
  }[] = [];
  for (const path of [...paths].sort()) {
    const base = baseMap.get(path);
    const compare = compareMap.get(path);
    if (base && compare && base.content === compare.content) continue;
    if (!base) {
      const lines = compare!.content.split("\n").filter((line) => line.length > 0 || compare!.content.endsWith("\n"));
      files.push({
        path,
        status: "added",
        additions: compare!.content.split("\n").filter(Boolean).length,
        deletions: 0,
        lines: lines.map((text) => ({ type: "add" as const, text })),
      });
    } else if (!compare) {
      files.push({
        path,
        status: "deleted",
        additions: 0,
        deletions: base.content.split("\n").filter(Boolean).length,
        lines: base.content.split("\n").filter(Boolean).map((text) => ({ type: "del" as const, text })),
      });
    } else {
      const baseLines = base.content.split("\n").filter(Boolean);
      const compareLines = compare.content.split("\n").filter(Boolean);
      const lines = [
        ...baseLines.map((text) => ({ type: "del" as const, text })),
        ...compareLines.map((text) => ({ type: "add" as const, text })),
      ];
      files.push({
        path,
        status: "modified",
        additions: compareLines.length,
        deletions: baseLines.length,
        lines,
      });
    }
  }
  return files;
}

interface MockState {
  viewer: { username: string; email: string } | null;
  roleFor: Record<string, string>; // username -> role on acme-docs
  branches: Record<string, MockCommit>;
  branchOrder: string[];
  pulls: MockPull[];
  rules: MockRule[];
  nextNumber: number;
}

function seedState(): MockState {
  const now = "2026-09-26T10:00:00.000Z";
  const day = 24 * 60 * 60 * 1000;
  return {
    viewer: null,
    roleFor: { "alice-dev": "admin", "bob-reviewer": "write" },
    branches: {
      main: COMMIT_B,
      "feature-search": COMMIT_F,
      release: COMMIT_R,
      "draft-feature": COMMIT_F,
    },
    branchOrder: ["main", "feature-search", "release", "draft-feature"],
    nextNumber: 4,
    rules: [],
    pulls: [
      {
        number: 1,
        title: "Improve onboarding",
        description: "Improve the onboarding flow for new contributors.",
        status: "open",
        baseBranch: "main",
        compareBranch: "release",
        author: "alice-dev",
        createdAt: new Date(Date.now() - day).toISOString(),
        updatedAt: new Date(Date.now() - day).toISOString(),
        check: { name: "test", status: "pending", setter: null, setAt: null },
        reviews: [],
        comments: [
          {
            id: "comment_1",
            author: "alice-dev",
            body: "I will refine the search flow after this ships.",
            createdAt: new Date(Date.now() - day / 2).toISOString(),
          },
        ],
        activities: [
          { id: "act_1", type: "created", actor: "alice-dev", createdAt: new Date(Date.now() - day).toISOString() },
        ],
      },
      {
        number: 2,
        title: "Fix search",
        description: "Fix the search flow on the feature-search branch.",
        status: "closed",
        baseBranch: "main",
        compareBranch: "feature-search",
        author: "alice-dev",
        createdAt: new Date(Date.now() - 4 * day).toISOString(),
        updatedAt: new Date(Date.now() - 3 * day).toISOString(),
        check: { name: "test", status: "pending", setter: null, setAt: null },
        reviews: [],
        comments: [],
        activities: [
          { id: "act_2", type: "created", actor: "alice-dev", createdAt: new Date(Date.now() - 4 * day).toISOString() },
          { id: "act_3", type: "closed", actor: "alice-dev", createdAt: new Date(Date.now() - 3 * day).toISOString() },
        ],
      },
      {
        number: 3,
        title: "Draft onboarding update",
        description: "Refresh the onboarding steps before opening the review.",
        status: "draft",
        baseBranch: "main",
        compareBranch: "draft-feature",
        author: "alice-dev",
        createdAt: new Date(Date.now() - 2 * day).toISOString(),
        updatedAt: new Date(Date.now() - 2 * day).toISOString(),
        check: { name: "test", status: "pending", setter: null, setAt: null },
        reviews: [],
        comments: [],
        activities: [
          { id: "act_4", type: "created", actor: "alice-dev", createdAt: new Date(Date.now() - 2 * day).toISOString() },
        ],
      },
    ],
  };
}

function branchCommits(state: MockState, branch: string): MockCommit[] {
  const commits: MockCommit[] = [];
  let cursor: MockCommit | undefined = state.branches[branch];
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    commits.push(cursor);
    cursor = cursor.parentId
      ? [COMMIT_A, COMMIT_B, COMMIT_F, COMMIT_R].find((commit) => commit.id === cursor!.parentId)
      : undefined;
  }
  return commits;
}

function comparison(state: MockState, base: string, compare: string) {
  const baseList = branchCommits(state, base);
  const compareList = branchCommits(state, compare);
  const baseIds = new Set(baseList.map((commit) => commit.id));
  const commits = compareList.filter((commit) => !baseIds.has(commit.id));
  const files = diffFiles(baseList[0]?.files ?? [], compareList[0]?.files ?? []);
  return {
    baseBranch: base,
    compareBranch: compare,
    baseCommitId: baseList[0]?.id ?? null,
    compareCommitId: compareList[0]?.id ?? null,
    sameBranch: base === compare,
    commitCount: commits.length,
    commits: commits.map((commit) => ({
      id: commit.id,
      shortId: commit.shortId,
      parentId: commit.parentId,
      authorAccountId: null,
      authorName: commit.authorName,
      message: commit.message,
      createdAt: commit.createdAt,
      changes: commit.changes,
    })),
    files,
    noDifference: base === compare || commits.length === 0,
  };
}

function mergeFor(state: MockState, pull: MockPull) {
  const rule = state.rules.find((candidate) => candidate.branch === pull.baseBranch);
  const reasons: string[] = [];
  const current = pull.check;
  const latestByAuthor = new Map<string, { decision: string; createdAt: string; author: string }>();
  for (const review of pull.reviews) {
    const existing = latestByAuthor.get(review.author);
    if (!existing || review.createdAt > existing.createdAt) {
      latestByAuthor.set(review.author, {
        decision: review.decision,
        createdAt: review.createdAt,
        author: review.author,
      });
    }
  }
  const reviewers = [...latestByAuthor.values()];
  if (reviewers.some((review) => review.decision === "request_changes")) {
    reasons.push("Request changes blocks merging");
  }
  const approvals = reviewers.filter(
    (review) => review.decision === "approve" && review.author !== pull.author,
  ).length;
  if (rule?.requireApproval && approvals < 1) {
    reasons.push("Review required by branch protection");
  }
  if (rule?.requireStatusCheck && current.status !== "success") {
    reasons.push("Requires status check test to be success");
  }
  return { mergeable: reasons.length === 0, reasons };
}

function pullDetail(state: MockState, pull: MockPull) {
  const cmp = comparison(state, pull.baseBranch, pull.compareBranch);
  const latestByAuthor = new Map<string, { decision: string; createdAt: string; author: string; explanation: string }>();
  for (const review of pull.reviews) {
    const existing = latestByAuthor.get(review.author);
    if (!existing || review.createdAt > existing.createdAt) {
      latestByAuthor.set(review.author, {
        decision: review.decision,
        createdAt: review.createdAt,
        author: review.author,
        explanation: (review as { explanation?: string }).explanation ?? "",
      });
    }
  }
  return {
    number: pull.number,
    title: pull.title,
    description: pull.description,
    status: pull.status,
    author: { username: pull.author },
    baseBranch: pull.baseBranch,
    compareBranch: pull.compareBranch,
    baseCommitId: cmp.baseCommitId,
    compareCommitId: cmp.compareCommitId,
    mergedAt: (pull as unknown as { mergedAt?: string | null }).mergedAt ?? null,
    mergedBy: (pull as unknown as { mergedBy?: { username: string } | null }).mergedBy ?? null,
    mergeCommitId: (pull as unknown as { mergeCommitId?: string | null }).mergeCommitId ?? null,
    createdAt: pull.createdAt,
    updatedAt: pull.updatedAt,
    check: pull.check.setter
      ? { ...pull.check, setter: { username: pull.check.setter } }
      : { ...pull.check, setter: null },
    reviews: pull.reviews.map((review) => ({
      ...review,
      explanation: (review as { explanation?: string }).explanation ?? "",
      author: { username: review.author },
      stale: false,
    })),
    inlineComments: (pull as { inlineComments?: unknown[] }).inlineComments ?? [],
    reviewers: (pull as { reviewers?: unknown[] }).reviewers ?? [],
    reviewSummary: [...latestByAuthor.values()].map((review) => ({
      id: `summary_${review.author}`,
      author: { username: review.author },
      decision: review.decision,
      explanation: review.explanation,
      createdAt: review.createdAt,
    })),
    reviewerCandidates:
      pull.baseBranch === "main"
        ? [{ username: "bob-reviewer" }]
        : [],
    comments: pull.comments.map((comment) => ({ ...comment, author: { username: comment.author } })),
    activities: pull.activities.map((activity) => ({ ...activity, actor: { username: activity.actor } })),
    commits: cmp.commits,
    files: cmp.files,
    merge: mergeFor(state, pull),
    currentRole: state.viewer ? state.roleFor[state.viewer.username] ?? null : null,
    canClose:
      state.viewer !== null &&
      (pull.author === state.viewer.username ||
        ["maintain", "admin"].includes(state.roleFor[state.viewer.username] ?? "")),
    canReview:
      state.viewer !== null &&
      pull.status === "open" &&
      pull.author !== state.viewer.username &&
      ["write", "maintain", "admin"].includes(state.roleFor[state.viewer.username] ?? ""),
    canMerge:
      state.viewer !== null &&
      ["maintain", "admin"].includes(state.roleFor[state.viewer.username] ?? ""),
    canRequestReviewers:
      state.viewer !== null &&
      (["maintain", "admin"].includes(state.roleFor[state.viewer.username] ?? "") ||
        ((pull.status === "open" || pull.status === "draft") &&
          pull.author === state.viewer.username)),
  };
}

function fetchHandler(state: MockState) {
  return (path: string, init: RequestInit): Response => {
    const method = init.method ?? "GET";
    if (path === "/api/sessions/current") {
      if (!state.viewer) return jsonResponse(401, { error: "Unauthenticated" });
      return jsonResponse(200, { account: state.viewer });
    }
    if (path === "/api/sessions" && method === "POST") {
      const body = JSON.parse(String(init.body)) as { identifier: string; password: string };
      const candidate =
        body.identifier === ALICE.username || body.identifier === ALICE.email
          ? ALICE
          : body.identifier === BOB.username || body.identifier === BOB.email
            ? BOB
            : CAROL;
      if (candidate && body.password === "Valid-password-123!") {
        state.viewer = candidate;
        return jsonResponse(201, { account: candidate });
      }
      return jsonResponse(401, { error: "Invalid credentials" });
    }
    if (path === "/api/sessions/current" && method === "DELETE") {
      state.viewer = null;
      return jsonResponse(200, { ok: true });
    }
    const userRepo = path.match(/^\/api\/users\/([^/]+)\/repos\/([^/?]+)(?:\?.*)?$/);
    if (userRepo && method === "GET") {
      if (userRepo[1] !== "alice-dev" || userRepo[2] !== "acme-docs") {
        return jsonResponse(404, { error: "Not found" });
      }
      const role = state.viewer ? state.roleFor[state.viewer.username] ?? null : null;
      return jsonResponse(200, {
        repository: {
          ownerType: "account",
          ownerName: "alice-dev",
          name: "acme-docs",
          description: "Documentation for Acme Demo",
          visibility: "public",
          defaultBranch: "main",
          updatedAt: "2026-09-26T10:00:00.000Z",
          currentRole: role,
          files: MAIN_FILES,
          branches: state.branchOrder.map((name) => ({
            name,
            protected: name === "feature-search" || (name === "main" && state.rules.some((rule) => rule.branch === "main")),
          })),
          currentBranch: "main",
          commitCount: 2,
          source: null,
        },
      });
    }
    const rules = path.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/protection-rules$/);
    if (rules) {
      const role = state.viewer ? state.roleFor[state.viewer.username] ?? null : null;
      if (method === "GET") {
        return jsonResponse(200, { rules: state.rules, currentRole: role });
      }
      if (method === "POST") {
        if (role !== "admin") return jsonResponse(403, { error: "Access denied" });
        const body = JSON.parse(String(init.body)) as {
          branch: string;
          requireApproval: boolean;
          requireStatusCheck: boolean;
        };
        const existing = state.rules.find((rule) => rule.branch === body.branch);
        if (existing) {
          existing.requireApproval = body.requireApproval;
          existing.requireStatusCheck = body.requireStatusCheck;
        } else {
          state.rules.push({
            branch: body.branch,
            requireApproval: body.requireApproval,
            requireStatusCheck: body.requireStatusCheck,
          });
        }
        return jsonResponse(200, { ok: true, rules: state.rules });
      }
    }
    const compare = path.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/pulls\/compare\?/);
    if (compare && method === "GET") {
      const params = new URL(path, "http://local").searchParams;
      return jsonResponse(200, comparison(state, params.get("base") ?? "", params.get("compare") ?? ""));
    }
    const detail = path.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/pulls\/(\d+)$/);
    if (detail && method === "GET") {
      const pull = state.pulls.find((candidate) => candidate.number === Number(detail[1]));
      if (!pull) return jsonResponse(404, { error: "Pull request not found" });
      return jsonResponse(200, { pull: pullDetail(state, pull) });
    }
    const ready = path.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/pulls\/(\d+)\/ready$/);
    if (ready && method === "POST") {
      if (!state.viewer) return jsonResponse(401, { error: "Unauthenticated" });
      const pull = state.pulls.find((candidate) => candidate.number === Number(ready[1]));
      if (!pull) return jsonResponse(404, { error: "Pull request not found" });
      const role = state.roleFor[state.viewer.username] ?? null;
      const isAuthor = pull.author === state.viewer.username;
      if (!isAuthor && role !== "maintain" && role !== "admin") {
        return jsonResponse(403, { error: "Access denied" });
      }
      if (pull.status !== "draft") {
        return jsonResponse(400, { errors: { status: "Only draft pull requests can be marked ready for review" } });
      }
      pull.status = "open";
      pull.activities.push({
        id: `act_${pull.number}_ready`,
        type: "ready_for_review",
        actor: state.viewer.username,
        createdAt: new Date().toISOString(),
      });
      return jsonResponse(200, { pull: pullDetail(state, pull) });
    }
    const checks = path.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/pulls\/(\d+)\/checks$/);
    if (checks && method === "POST") {
      const role = state.viewer ? state.roleFor[state.viewer.username] ?? null : null;
      if (role !== "admin") return jsonResponse(403, { error: "Access denied" });
      const pull = state.pulls.find((candidate) => candidate.number === Number(checks[1]));
      if (!pull) return jsonResponse(404, { error: "Pull request not found" });
      const body = JSON.parse(String(init.body)) as { status: string };
      pull.check = {
        name: "test",
        status: body.status,
        setter: state.viewer!.username,
        setAt: new Date().toISOString(),
      };
      return jsonResponse(200, { ok: true });
    }
    const comments = path.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/pulls\/(\d+)\/comments$/);
    if (comments && method === "POST") {
      if (!state.viewer) return jsonResponse(401, { error: "Unauthenticated" });
      const pull = state.pulls.find((candidate) => candidate.number === Number(comments[1]));
      if (!pull) return jsonResponse(404, { error: "Pull request not found" });
      const role = state.roleFor[state.viewer.username] ?? null;
      if (pull.status !== "open" || pull.author === state.viewer.username || !["write", "maintain", "admin"].includes(role)) {
        return jsonResponse(403, { error: "Access denied" });
      }
      const body = JSON.parse(String(init.body)) as { path: string; line: number; body: string; startReview?: boolean };
      if (!body.body.trim()) return jsonResponse(400, { errors: { body: "Comment is required" } });
      const file = comparison(state, pull.baseBranch, pull.compareBranch).files.find((candidate) => candidate.path === body.path);
      if (!file || body.line < 1 || body.line > file.lines.length || file.lines[body.line - 1].type === "context") {
        return jsonResponse(400, { errors: { line: "Line is invalid" } });
      }
      const comment = {
        id: `comment_${Date.now()}`,
        author: { username: state.viewer.username },
        path: body.path,
        line: body.line,
        commitId: pullDetail(state, pull).compareCommitId,
        body: body.body.trim(),
        published: body.startReview !== true,
        outdated: false,
        createdAt: new Date().toISOString(),
      };
      (pull as unknown as { inlineComments: typeof comment[] }).inlineComments = [
        ...((pull as unknown as { inlineComments?: typeof comment[] }).inlineComments ?? []),
        comment,
      ];
      return jsonResponse(201, { ok: true, pull: pullDetail(state, pull) });
    }
    const reviews = path.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/pulls\/(\d+)\/reviews$/);
    if (reviews && method === "POST") {
      if (!state.viewer) return jsonResponse(401, { error: "Unauthenticated" });
      const pull = state.pulls.find((candidate) => candidate.number === Number(reviews[1]));
      if (!pull) return jsonResponse(404, { error: "Pull request not found" });
      const role = state.roleFor[state.viewer.username] ?? null;
      if (pull.status !== "open" || pull.author === state.viewer.username || !["write", "maintain", "admin"].includes(role)) {
        return jsonResponse(403, { error: "Access denied" });
      }
      const body = JSON.parse(String(init.body)) as { decision: string; explanation?: string };
      pull.reviews.push({
        id: `review_${Date.now()}`,
        author: state.viewer.username,
        decision: body.decision,
        commitId: pullDetail(state, pull).compareCommitId,
        explanation: body.explanation ?? "",
        createdAt: new Date().toISOString(),
      });
      const inline = pull as unknown as { inlineComments?: { author: { username: string }; published: boolean }[] };
      for (const comment of inline.inlineComments ?? []) {
        if (comment.author.username === state.viewer.username && comment.published === false) {
          comment.published = true;
        }
      }
      return jsonResponse(201, { ok: true, pull: pullDetail(state, pull) });
    }
    const reviewers = path.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/pulls\/(\d+)\/reviewers$/);
    if (reviewers && method === "POST") {
      if (!state.viewer) return jsonResponse(401, { error: "Unauthenticated" });
      const pull = state.pulls.find((candidate) => candidate.number === Number(reviewers[1]));
      if (!pull) return jsonResponse(404, { error: "Pull request not found" });
      const role = state.roleFor[state.viewer.username] ?? null;
      const allowed =
        role === "maintain" ||
        role === "admin" ||
        (pull.author === state.viewer.username &&
          (pull.status === "open" || pull.status === "draft"));
      if (!allowed) {
        return jsonResponse(403, { error: "Access denied" });
      }
      const body = JSON.parse(String(init.body)) as { username: string };
      if (body.username !== "bob-reviewer") return jsonResponse(400, { errors: { username: "Reviewer is not eligible" } });
      const existing = (pull as unknown as { reviewers?: { username: string }[] }).reviewers ?? [];
      if (existing.some((reviewer) => reviewer.username === body.username)) {
        return jsonResponse(400, { errors: { username: "Reviewer is already requested" } });
      }
      (pull as unknown as { reviewers: { id: string; username: string; requestedBy: { username: string }; createdAt: string }[] }).reviewers = [
        ...existing.map((reviewer) => ({ id: `req_${reviewer.username}`, ...reviewer, requestedBy: { username: "alice-dev" }, createdAt: new Date().toISOString() })),
        { id: `req_${body.username}`, username: body.username, requestedBy: { username: state.viewer.username }, createdAt: new Date().toISOString() },
      ];
      return jsonResponse(200, { ok: true, pull: pullDetail(state, pull) });
    }
    const reviewerDelete = path.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/pulls\/(\d+)\/reviewers\/([^/]+)$/);
    if (reviewerDelete && method === "DELETE") {
      if (!state.viewer) return jsonResponse(401, { error: "Unauthenticated" });
      const pull = state.pulls.find((candidate) => candidate.number === Number(reviewerDelete[1]));
      if (!pull) return jsonResponse(404, { error: "Pull request not found" });
      const role = state.roleFor[state.viewer.username] ?? null;
      const allowed =
        role === "maintain" ||
        role === "admin" ||
        (pull.author === state.viewer.username &&
          (pull.status === "open" || pull.status === "draft"));
      if (!allowed) {
        return jsonResponse(403, { error: "Access denied" });
      }
      const username = decodeURIComponent(reviewerDelete[2]);
      (pull as unknown as { reviewers?: { username: string }[] }).reviewers = (
        (pull as unknown as { reviewers?: { username: string }[] }).reviewers ?? []
      ).filter((reviewer) => reviewer.username !== username);
      return jsonResponse(200, { ok: true, pull: pullDetail(state, pull) });
    }
    const stateAction = path.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/pulls\/(\d+)\/(close|reopen)$/);
    if (stateAction && method === "POST") {
      if (!state.viewer) return jsonResponse(401, { error: "Unauthenticated" });
      const pull = state.pulls.find((candidate) => candidate.number === Number(stateAction[1]));
      if (!pull) return jsonResponse(404, { error: "Pull request not found" });
      const role = state.roleFor[state.viewer.username] ?? null;
      const isAuthor = pull.author === state.viewer.username;
      if (!isAuthor && role !== "maintain" && role !== "admin") {
        return jsonResponse(403, { error: "Access denied" });
      }
      if (stateAction[2] === "close") {
        if (pull.status !== "open" && pull.status !== "draft") {
          return jsonResponse(400, { errors: { status: "Only Open or Draft pull requests can be closed" } });
        }
        pull.status = "closed";
      } else {
        if (pull.status !== "closed") {
          return jsonResponse(400, { errors: { status: "Only Closed pull requests can be reopened" } });
        }
        pull.status = "open";
      }
      pull.activities.push({
        id: `act_${pull.number}_${stateAction[2]}`,
        type: stateAction[2] === "close" ? "closed" : "reopened",
        actor: state.viewer.username,
        createdAt: new Date().toISOString(),
      });
      return jsonResponse(200, { ok: true, pull: pullDetail(state, pull) });
    }
    const merge = path.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/pulls\/(\d+)\/merge$/);
    if (merge && method === "POST") {
      if (!state.viewer) return jsonResponse(401, { error: "Unauthenticated" });
      const pull = state.pulls.find((candidate) => candidate.number === Number(merge[1]));
      if (!pull) return jsonResponse(404, { error: "Pull request not found" });
      const role = state.roleFor[state.viewer.username] ?? null;
      if (!["maintain", "admin"].includes(role)) return jsonResponse(403, { error: "Access denied" });
      if (pull.status !== "open") return jsonResponse(400, { errors: { status: "Only Open pull requests can be merged" } });
      const eligibility = mergeFor(state, pull);
      if (!eligibility.mergeable) return jsonResponse(400, { errors: { merge: eligibility.reasons } });
      pull.status = "merged";
      (pull as unknown as { mergedAt: string; mergedBy: { username: string }; mergeCommitId: string }).mergedAt = new Date().toISOString();
      (pull as unknown as { mergedBy: { username: string } }).mergedBy = { username: state.viewer.username };
      (pull as unknown as { mergeCommitId: string }).mergeCommitId = `commit_merge_${pull.number}`;
      pull.activities.push({
        id: `act_${pull.number}_merged`,
        type: "merged",
        actor: state.viewer.username,
        createdAt: new Date().toISOString(),
      });
      return jsonResponse(200, { ok: true, pull: pullDetail(state, pull) });
    }
    const list = path.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/pulls$/);
    if (list) {
      if (method === "GET") {
        return jsonResponse(200, {
          pulls: state.pulls
            .slice()
            .sort((a, b) => b.number - a.number)
            .map((pull) => ({
              number: pull.number,
              title: pull.title,
              status: pull.status,
              baseBranch: pull.baseBranch,
              compareBranch: pull.compareBranch,
              author: { username: pull.author },
              reviewed: pull.reviews.length > 0,
              createdAt: pull.createdAt,
              updatedAt: pull.updatedAt,
            })),
          currentRole: state.viewer ? state.roleFor[state.viewer.username] ?? null : null,
        });
      }
      if (method === "POST") {
        if (!state.viewer) return jsonResponse(401, { error: "Unauthenticated" });
        const role = state.roleFor[state.viewer.username] ?? null;
        if (!["write", "maintain", "admin"].includes(role)) {
          return jsonResponse(403, { error: "Access denied" });
        }
        const body = JSON.parse(String(init.body)) as {
          baseBranch: string;
          compareBranch: string;
          title: string;
          description: string;
          draft?: boolean;
        };
        if (!body.title.trim()) return jsonResponse(400, { errors: { title: "Title is required" } });
        const cmp = comparison(state, body.baseBranch, body.compareBranch);
        if (cmp.noDifference) return jsonResponse(400, { errors: { base: "No comparable commits" } });
        const duplicate = state.pulls.some(
          (pull) =>
            pull.baseBranch === body.baseBranch &&
            pull.compareBranch === body.compareBranch &&
            (pull.status === "open" || pull.status === "draft"),
        );
        if (duplicate) return jsonResponse(400, { errors: { base: "A pull request already exists for these branches" } });
        const pull: MockPull = {
          number: state.nextNumber,
          title: body.title.trim(),
          description: body.description ?? "",
          status: body.draft ? "draft" : "open",
          baseBranch: body.baseBranch,
          compareBranch: body.compareBranch,
          author: state.viewer.username,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          check: { name: "test", status: "pending", setter: null, setAt: null },
          reviews: [],
          comments: [],
          activities: [
            { id: `act_${state.nextNumber}`, type: "created", actor: state.viewer.username, createdAt: new Date().toISOString() },
          ],
        };
        state.nextNumber += 1;
        state.pulls.push(pull);
        return jsonResponse(201, { pull: pullDetail(state, pull) });
      }
    }
    return jsonResponse(404, { error: "Not found" });
  };
}

function stubFetch(handler: (path: string, init: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === "string" ? input : new URL(String(input)).pathname;
      return handler(path, init ?? {});
    }),
  );
}

beforeEach(() => {
  window.location.hash = "#/";
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("REQ-6-2-2 compare branches before opening a pull request", () => {
  it("lists pull requests, compares branches, disables creation for same branches, and compares on demand", async () => {
    const state = seedState();
    state.viewer = ALICE;
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Pull requests" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Fix search" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Closed" })).toBeTruthy();
    const newLink = screen.getByRole("link", { name: "New pull request" });
    expect((newLink as HTMLAnchorElement).href).toContain("/pulls/new");

    await user.click(newLink);
    expect(await screen.findByRole("heading", { name: "New pull request" })).toBeTruthy();
    const baseSelect = screen.getByRole("combobox", { name: "base" });
    const compareSelect = screen.getByRole("combobox", { name: "compare" });
    expect(within(baseSelect).getByRole("option", { name: "main" })).toBeTruthy();
    expect(within(compareSelect).getByRole("option", { name: "feature-search" })).toBeTruthy();
    expect(within(compareSelect).getByRole("option", { name: "main" })).toBeTruthy();
    expect((baseSelect as HTMLSelectElement).value).toBe("main");
    await waitFor(() =>
      expect((compareSelect as HTMLSelectElement).value).toBe("feature-search"),
    );

    // The valid selection loads automatically: commit summary, known file, enabled creation.
    expect(await screen.findByRole("heading", { name: "Commit summary" })).toBeTruthy();
    expect(screen.getByText(/1 commit ahead of main/)).toBeTruthy();
    expect(screen.getAllByText("src/search.ts").length).toBeGreaterThan(0);
    const createButton = screen.getByRole("button", { name: "Create pull request" });
    expect((createButton as HTMLButtonElement).disabled).toBe(false);

    // Selecting the same branch in both fields immediately shows No changes and disables creation.
    await user.selectOptions(compareSelect, "main");
    expect(await screen.findByText("No changes")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create pull request" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("heading", { name: "Commit summary" })).toBeNull();

    // Clicking Compare changes retains the result after restoring a valid pair.
    await user.selectOptions(compareSelect, "feature-search");
    await user.click(screen.getByRole("button", { name: "Compare changes" }));
    expect(await screen.findByRole("heading", { name: "Commit summary" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create pull request" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a Read/Triage user cannot enter the creation-comparison flow and sees no New pull request link", async () => {
    const state = seedState();
    state.viewer = CAROL;
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls";
    render(<App />);

    await screen.findByRole("heading", { name: "Pull requests" });
    expect(screen.queryByRole("link", { name: "New pull request" })).toBeNull();
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();

    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/new";
    expect(await screen.findByText("Access denied")).toBeTruthy();
  });
});

describe("REQ-6-2-3 create a pull request from comparison results", () => {
  it("creates an Open PR with the exact heading, status, branches, author, and description; survives reload", async () => {
    const state = seedState();
    state.viewer = ALICE;
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/new?base=main&compare=feature-search";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Commit summary" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create pull request" }));

    // The comparison action is no longer a competing active button: only the
    // form's single Create pull request submit remains, with the Title and
    // Description fields.
    expect(await screen.findByRole("textbox", { name: "Title" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Description" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Create pull request" }).length).toBe(1);

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Add search highlighting");
    await user.type(
      screen.getByRole("textbox", { name: "Description" }),
      "Highlight matching lines in the search results.",
    );
    await user.click(screen.getByRole("button", { name: "Create pull request" }));

    // Redirected to the new PR detail page.
    expect(await screen.findByRole("heading", { name: "Add search highlighting" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText(/#4 opened by alice-dev/)).toBeTruthy();
    expect(screen.getByText(/wants to merge feature-search into main/)).toBeTruthy();
    expect(screen.getByText("Highlight matching lines in the search results.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Conversation" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Commits" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Files changed" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Checks" })).toBeTruthy();

    // The PR survives reload and appears in the list.
    cleanup();
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/4";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Add search highlighting" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();

    cleanup();
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls";
    render(<App />);
    expect(await screen.findByRole("link", { name: "Add search highlighting" })).toBeTruthy();
  });

  it("a spaces-only title is rejected with Title is required and creates no PR", async () => {
    const state = seedState();
    state.viewer = ALICE;
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/new?base=main&compare=feature-search";
    render(<App />);

    await screen.findByRole("heading", { name: "Commit summary" });
    await user.click(screen.getByRole("button", { name: "Create pull request" }));
    const title = await screen.findByRole("textbox", { name: "Title" });
    await user.type(title, "   ");
    await user.click(screen.getByRole("button", { name: "Create pull request" }));

    expect(await screen.findByText("Title is required")).toBeTruthy();
    expect(window.location.hash).toContain("/pulls/new");
    expect(state.pulls.length).toBe(3);
  });

  it("a fresh visitor signs in as alice-dev and the workflow is usable", async () => {
    const state = seedState();
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "GitHub Collaboration Platform" });

    await user.click(screen.getByRole("link", { name: "Sign in" }));
    await user.type(screen.getByRole("textbox", { name: "Username or email" }), "alice-dev");
    await user.type(screen.getByLabelText("Password"), "Valid-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("heading", { name: "Workspace" });

    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/new?base=main&compare=feature-search";
    expect(await screen.findByRole("heading", { name: "Commit summary" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create pull request" })).toBeTruthy();
  });
});

describe("REQ-6-1 protect branches with review and status-check requirements", () => {
  it("an Admin creates a rule for main, updates the test check to success, and the rule and check persist", async () => {
    const state = seedState();
    state.viewer = ALICE;
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/settings/branches";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Branch protection rules" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add branch protection rule" }));
    expect(screen.getByRole("textbox", { name: "Branch name pattern" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Require 1 approval" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Require status check test" })).toBeTruthy();

    await user.type(screen.getByRole("textbox", { name: "Branch name pattern" }), "main");
    await user.click(screen.getByRole("checkbox", { name: "Require 1 approval" }));
    await user.click(screen.getByRole("checkbox", { name: "Require status check test" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    const rulesSection = await screen.findByRole("region", { name: "Branch protection rules" });
    expect(within(rulesSection).getByText("main")).toBeTruthy();
    expect(within(rulesSection).getByText("1 approval")).toBeTruthy();
    expect(within(rulesSection).getByText("Require status check test")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();

    // The rule still exists after reloading the settings page.
    cleanup();
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/settings/branches";
    render(<App />);
    expect(await screen.findByText("1 approval")).toBeTruthy();
    expect(screen.getByText("Require status check test")).toBeTruthy();

    // The Admin opens the Open PR targeting main: test is pending, then saved as success.
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1?tab=checks";
    expect(await screen.findByText("test: pending")).toBeTruthy();
    const statusSelect = screen.getByRole("combobox", { name: "test status" });
    expect(screen.getByRole("option", { name: "success" })).toBeTruthy();
    await user.selectOptions(statusSelect, "success");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("test: success")).toBeTruthy();
    expect(screen.getByText(/Set by alice-dev on /)).toBeTruthy();

    // Reload preserves the result for that compare commit.
    cleanup();
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1?tab=checks";
    render(<App />);
    expect(await screen.findByText("test: success")).toBeTruthy();

    // Without one valid non-author approval the PR stays unmergeable.
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1";
    expect(await screen.findByText("Unmergeable")).toBeTruthy();
    expect(screen.getByText("Review required by branch protection")).toBeTruthy();
  });

  it("a non-Admin sees no Add branch protection rule and no editable rule entry", async () => {
    const state = seedState();
    state.viewer = BOB;
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/settings/branches";
    render(<App />);

    await screen.findByRole("heading", { name: "Branch protection rules" });
    expect(screen.queryByRole("button", { name: "Add branch protection rule" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Branch name pattern" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("a non-Admin sees the Checks area without update controls", async () => {
    const state = seedState();
    state.viewer = BOB;
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1?tab=checks";
    render(<App />);

    expect(await screen.findByText("test: pending")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "test status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("REQ-6-2-1 list and filter repository pull requests", () => {
  it("a visitor sees the public list, filters by Open + author, switches to Closed, and reload keeps the filter", async () => {
    const state = seedState();
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Pull requests" })).toBeTruthy();
    // The unfiltered list shows every seeded row with its number, status, branches, and author.
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Fix search" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Draft onboarding update" })).toBeTruthy();
    expect(screen.getAllByText(/opened by alice-dev/).length).toBe(3);
    expect(screen.getByText(/release into main/)).toBeTruthy();
    expect(screen.getByText(/feature-search into main/)).toBeTruthy();
    expect(screen.getByText(/draft-feature into main/)).toBeTruthy();

    // Status filters are links; Open is one of them.
    const openLink = screen.getByRole("link", { name: "Open" });
    const closedLink = screen.getByRole("link", { name: "Closed" });
    expect(screen.getByRole("link", { name: "Draft" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Merged" })).toBeTruthy();

    // Select Open and filter the author to alice-dev.
    await user.click(openLink);
    expect(screen.getByRole("combobox", { name: "Author" })).toBeTruthy();
    const authorSelect = screen.getByRole("combobox", { name: "Author" });
    await user.selectOptions(authorSelect, "alice-dev");
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Fix search" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Draft onboarding update" })).toBeNull();
    });

    // The Open PR link opens the detail page with the same title as heading.
    await user.click(screen.getByRole("link", { name: "Improve onboarding" }));
    expect(await screen.findByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();

    // Reloading the filtered list keeps the Open PR visible.
    cleanup();
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls?state=open&author=alice-dev";
    render(<App />);
    await screen.findByRole("heading", { name: "Pull requests" });
    expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Fix search" })).toBeNull();

    // Switching to Closed hides the Open PR; filtering changes no data.
    await user.click(screen.getByRole("link", { name: "Closed" }));
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
      expect(screen.getByRole("link", { name: "Fix search" })).toBeTruthy();
    });
    expect(
      state.pulls.find((pull) => pull.number === 1)?.status,
    ).toBe("open");
    expect(state.pulls.find((pull) => pull.number === 1)?.reviews.length).toBe(0);
  });

  it("the review status filter is visible and Draft/Merged status filters narrow the rows", async () => {
    const state = seedState();
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls";
    render(<App />);

    await screen.findByRole("heading", { name: "Pull requests" });
    const reviewSelect = screen.getByRole("combobox", { name: "Review status" });
    await user.selectOptions(reviewSelect, "reviewed");
    await waitFor(() => expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull());
    expect(screen.getByText("No pull requests found.")).toBeTruthy();
    await user.selectOptions(reviewSelect, "not-reviewed");
    await waitFor(() => expect(screen.getByRole("link", { name: "Improve onboarding" })).toBeTruthy());

    await user.click(screen.getByRole("link", { name: "Draft" }));
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Draft onboarding update" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Improve onboarding" })).toBeNull();
    });
    await user.click(screen.getByRole("link", { name: "Merged" }));
    await waitFor(() => expect(screen.getByText("No pull requests found.")).toBeTruthy());
  });
});

describe("REQ-6-2-4 create a draft pull request", () => {
  it("a collaborator creates a Draft PR: the detail shows Draft and a disabled Merge button, and the list shows draft status", async () => {
    const state = seedState();
    state.viewer = ALICE;
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/new?base=main&compare=feature-search";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Commit summary" })).toBeTruthy();
    // A visible draft comparison entry offers its own button.
    await user.click(screen.getByRole("button", { name: "Create draft pull request" }));

    // The form has Title, optional Description, and one Create draft pull request submit.
    expect(await screen.findByRole("textbox", { name: "Title" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Description" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Create draft pull request" }).length).toBe(1);
    expect(screen.queryByRole("button", { name: "Create pull request" })).toBeNull();

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Draft the search docs");
    await user.click(screen.getByRole("button", { name: "Create draft pull request" }));

    // Redirected to the new detail page with the Draft marker and branches.
    expect(await screen.findByRole("heading", { name: "Draft the search docs" })).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText(/wants to merge feature-search into main/)).toBeTruthy();
    const mergeButton = screen.getByRole("button", { name: "Merge pull request" });
    expect((mergeButton as HTMLButtonElement).disabled).toBe(true);

    // The list shows the draft status after reload.
    cleanup();
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls";
    render(<App />);
    await screen.findByRole("heading", { name: "Pull requests" });
    expect(screen.getByRole("link", { name: "Draft the search docs" })).toBeTruthy();
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
    expect(
      state.pulls.find((pull) => pull.title === "Draft the search docs")?.status,
    ).toBe("draft");
  });

  it("the author marks the seeded draft ready for review: Confirm opens it, activity appears, and a reviewer sees Open", async () => {
    const state = seedState();
    state.viewer = ALICE;
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/3";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Draft onboarding update" })).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText(/draft-feature into main/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ready for review" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Ready for review" }));
    const dialog = await screen.findByRole("dialog", { name: "Ready for review" });
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    // The Draft marker disappears, the title/branches stay, and the activity appears.
    await waitFor(() => expect(screen.queryByText("Draft")).toBeNull());
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Draft onboarding update" })).toBeTruthy();
    expect(screen.getByText(/draft-feature into main/)).toBeTruthy();
    expect(screen.getAllByText(/marked this pull request as ready for review/).length).toBeGreaterThan(0);

    // A reviewer reopens the same PR and sees Open with the same title and branches.
    cleanup();
    stubFetch(fetchHandler(state));
    state.viewer = BOB;
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/3";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Draft onboarding update" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ready for review" })).toBeNull();
    expect(screen.getByText(/draft-feature into main/)).toBeTruthy();
  });

  it("a Triage reviewer cannot mark the draft ready for review", async () => {
    const state = seedState();
    state.viewer = BOB;
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/3";
    render(<App />);

    await screen.findByRole("heading", { name: "Draft onboarding update" });
    expect(screen.queryByRole("button", { name: "Ready for review" })).toBeNull();
    expect(state.pulls.find((pull) => pull.number === 3)?.status).toBe("draft");
  });
});

describe("REQ-6-3-1 view pull request overview and commits", () => {
  it("a visitor opens the public Open PR and switches between Conversation, Commits, and Files changed", async () => {
    const state = seedState();
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1";
    render(<App />);

    // Conversation: title heading, description, base/compare branches, and discussion.
    expect(await screen.findByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByText("Improve the onboarding flow for new contributors.")).toBeTruthy();
    expect(screen.getByText(/wants to merge release into main/)).toBeTruthy();
    expect(screen.getByText("I will refine the search flow after this ships.")).toBeTruthy();
    expect(screen.getByText(/alice-dev opened this pull request/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Conversation" })).toBeTruthy();

    // Commits tab shows a Commit summary and the comparable commits.
    await user.click(screen.getByRole("link", { name: "Commits" }));
    expect(await screen.findByRole("heading", { name: "Commit summary" })).toBeTruthy();
    expect(screen.getByText(/1 commit on release relative to main/)).toBeTruthy();
    expect(screen.getByText("Add changelog")).toBeTruthy();

    // Files changed tab shows the Changed files summary.
    await user.click(screen.getByRole("link", { name: "Files changed" }));
    expect(await screen.findByRole("heading", { name: "Changed files summary" })).toBeTruthy();
    expect(screen.getByText(/2 files changed/)).toBeTruthy();
    expect(screen.getAllByText("src/search.ts").length).toBeGreaterThan(0);

    // Refreshing the tab keeps the same PR, title, branches, and commits.
    cleanup();
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1?tab=commits";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Improve onboarding" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Commit summary" })).toBeTruthy();
    expect(screen.getByText("Add changelog")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Files changed" })).toBeTruthy();
  });
});

describe("REQ-6-3-2 inspect changed files and aggregate diff", () => {
  it("the visitor sees the aggregate statistics and expands the modified file's diff block", async () => {
    const state = seedState();
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1?tab=files";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Changed files summary" })).toBeTruthy();
    // Aggregate statistics in the exact additions/deletions format.
    const diffFiles = comparison(state, "main", "release").files;
    const additions = diffFiles.reduce((sum, file) => sum + file.additions, 0);
    const deletions = diffFiles.reduce((sum, file) => sum + file.deletions, 0);
    expect(
      screen.getByText(`${additions} additions, ${deletions} deletions`),
    ).toBeTruthy();
    // Both changed file paths are listed; unchanged files are not displayed.
    expect(screen.getAllByText("src/search.ts").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CHANGELOG.md").length).toBeGreaterThan(0);
    expect(screen.queryByText("README.md")).toBeNull();

    // The modified file's diff block is collapsed; expanding shows added/deleted lines.
    const modifiedBlock = screen.getByRole("region", { name: "src/search.ts" });
    expect(within(modifiedBlock).queryByTestId("diff-line")).toBeNull();
    await user.click(within(modifiedBlock).getByRole("button", { name: "Expand" }));
    expect(within(modifiedBlock).getAllByTestId("diff-line").length).toBeGreaterThan(0);
    expect(within(modifiedBlock).getByRole("button", { name: "Collapse" })).toBeTruthy();

    // Switching back to Conversation leaves the files and status unchanged.
    await user.click(screen.getByRole("link", { name: "Conversation" }));
    expect(await screen.findByText("I will refine the search flow after this ships.")).toBeTruthy();
    expect(state.pulls.find((pull) => pull.number === 1)?.status).toBe("open");
    expect(state.pulls.find((pull) => pull.number === 1)?.reviews.length).toBe(0);
  });
});

describe("REQ-6-3-3 add review comments to changed code lines", () => {
  it("a Write reviewer adds a single comment that appears in the diff and Conversation and survives reload", async () => {
    const state = seedState();
    state.viewer = BOB;
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1?tab=files";
    render(<App />);

    await screen.findByRole("heading", { name: "Changed files summary" });
    const modifiedBlock = screen.getByRole("region", { name: "src/search.ts" });
    await user.click(within(modifiedBlock).getByRole("button", { name: "Expand" }));

    // The first Add comment button targets the first commentable changed line.
    const addButtons = within(modifiedBlock).getAllByRole("button", { name: "Add comment" });
    expect(addButtons.length).toBeGreaterThan(0);
    await user.click(addButtons[0]);

    const editor = screen.getByRole("textbox", { name: "Comment" });
    await user.type(editor, "This search line should stay lowercase.");
    await user.click(screen.getByRole("button", { name: "Add single comment" }));

    // The exact body appears in the diff view immediately.
    expect(await screen.findByText("This search line should stay lowercase.")).toBeTruthy();
    expect(screen.getAllByTestId("inline-comment").length).toBe(1);
    expect(screen.getAllByText("bob-reviewer").length).toBeGreaterThan(0);

    // Conversation displays the published comment too.
    await user.click(screen.getByRole("link", { name: "Conversation" }));
    expect(
      await screen.findByText(/This search line should stay lowercase. \(src\/search.ts:/),
    ).toBeTruthy();

    // The comment remains anchored to the file and line after reload.
    cleanup();
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1?tab=files";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Changed files summary" })).toBeTruthy();
    const blockAfter = screen.getByRole("region", { name: "src/search.ts" });
    await user.click(within(blockAfter).getByRole("button", { name: "Expand" }));
    expect(await within(blockAfter).findByText("This search line should stay lowercase.")).toBeTruthy();
  });

  it("Start a review keeps the comment pending with the Pending review marker until review submission", async () => {
    const state = seedState();
    state.viewer = BOB;
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1?tab=files";
    render(<App />);

    await screen.findByRole("heading", { name: "Changed files summary" });
    const modifiedBlock = screen.getByRole("region", { name: "src/search.ts" });
    await user.click(within(modifiedBlock).getByRole("button", { name: "Expand" }));
    await user.click(within(modifiedBlock).getAllByRole("button", { name: "Add comment" })[0]);

    await user.type(screen.getByRole("textbox", { name: "Comment" }), "Pending draft comment");
    await user.click(screen.getByRole("button", { name: "Start a review" }));

    // The pending draft and Pending review marker are visible to its author.
    expect(await screen.findByText("Pending draft comment")).toBeTruthy();
    expect(screen.getByText("Pending review")).toBeTruthy();

    // The pending comment is not public: Conversation does not show it.
    await user.click(screen.getByRole("link", { name: "Conversation" }));
    expect(screen.queryByText("Pending draft comment")).toBeNull();

    // Reload keeps the pending draft unpublished.
    cleanup();
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1?tab=files";
    render(<App />);
    await screen.findByRole("heading", { name: "Changed files summary" });
    const blockAfter = screen.getByRole("region", { name: "src/search.ts" });
    await user.click(within(blockAfter).getByRole("button", { name: "Expand" }));
    expect(await within(blockAfter).findByText("Pending draft comment")).toBeTruthy();
    expect(within(blockAfter).getByText("Pending review")).toBeTruthy();

    // Submitting a review publishes the pending comment.
    await user.click(screen.getByRole("button", { name: "Review changes" }));
    await user.click(screen.getByRole("radio", { name: "Comment" }));
    await user.click(screen.getByRole("button", { name: "Submit review" }));
    await user.click(screen.getByRole("link", { name: "Conversation" }));
    expect(await screen.findByText(/Pending draft comment \(src\/search.ts:/)).toBeTruthy();
  });

  it("an empty comment is rejected and the PR author cannot comment", async () => {
    const state = seedState();
    state.viewer = ALICE;
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1?tab=files";
    render(<App />);

    await screen.findByRole("heading", { name: "Changed files summary" });
    // The author cannot comment: no Add comment buttons and no Review changes.
    expect(screen.queryByRole("button", { name: "Add comment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();

    cleanup();
    stubFetch(fetchHandler(state));
    state.viewer = BOB;
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1?tab=files";
    render(<App />);
    await screen.findByRole("heading", { name: "Changed files summary" });
    const block = screen.getByRole("region", { name: "src/search.ts" });
    await user.click(within(block).getByRole("button", { name: "Expand" }));
    await user.click(within(block).getAllByRole("button", { name: "Add comment" })[0]);
    await user.click(screen.getByRole("button", { name: "Add single comment" }));
    expect(await screen.findByText("Comment is required")).toBeTruthy();
    expect(state.pulls.find((pull) => pull.number === 1)?.inlineComments ?? []).toHaveLength(0);
  });
});

describe("REQ-6-3-4 submit a pull request review", () => {
  it("Approve without a summary displays Approved and the decision persists after reload", async () => {
    const state = seedState();
    state.viewer = BOB;
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1?tab=files";
    render(<App />);

    await screen.findByRole("heading", { name: "Changed files summary" });
    await user.click(screen.getByRole("button", { name: "Review changes" }));
    await user.type(screen.getByRole("textbox", { name: "Summary" }), "Overall the changes look good.");
    await user.click(screen.getByRole("radio", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    // Conversation and the review summary on the right show reviewer, status,
    // overall comment, and time.
    await user.click(screen.getByRole("link", { name: "Conversation" }));
    expect(await screen.findByText(/bob-reviewer approved these changes/)).toBeTruthy();
    expect(screen.getAllByText("Overall the changes look good.").length).toBeGreaterThan(0);
    const summary = screen.getByRole("region", { name: "Review summary" });
    expect(within(summary).getByText("bob-reviewer")).toBeTruthy();
    expect(within(summary).getByText("Approved")).toBeTruthy();
    expect(within(summary).getByText("Overall the changes look good.")).toBeTruthy();

    // The decision persists after reload and drives merge eligibility.
    cleanup();
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1";
    render(<App />);
    expect(await screen.findByText(/bob-reviewer approved these changes/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Review summary" })).toBeTruthy();
  });

  it("Request changes with a summary displays Changes requested and that exact summary", async () => {
    const state = seedState();
    state.viewer = BOB;
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1?tab=files";
    render(<App />);

    await screen.findByRole("heading", { name: "Changed files summary" });
    await user.click(screen.getByRole("button", { name: "Review changes" }));
    await user.type(
      screen.getByRole("textbox", { name: "Summary" }),
      "Please add tests for the search flow.",
    );
    await user.click(screen.getByRole("radio", { name: "Request changes" }));
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    await user.click(screen.getByRole("link", { name: "Conversation" }));
    expect(await screen.findByText(/bob-reviewer requested changes/)).toBeTruthy();
    const summary = screen.getByRole("region", { name: "Review summary" });
    expect(within(summary).getByText("Changes requested")).toBeTruthy();
    expect(within(summary).getByText("Please add tests for the search flow.")).toBeTruthy();

    // Reload keeps the decision.
    cleanup();
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1";
    render(<App />);
    expect(await screen.findByText(/bob-reviewer requested changes/)).toBeTruthy();
  });
});

describe("REQ-6-4 request or remove pull request reviewers", () => {
  it("the author requests bob-reviewer and removes the request; the final set persists", async () => {
    const state = seedState();
    state.viewer = ALICE;
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1";
    render(<App />);

    const reviewersSection = await screen.findByRole("region", { name: "Reviewers" });
    expect(within(reviewersSection).getByText("No reviewers")).toBeTruthy();
    await user.click(within(reviewersSection).getByRole("button", { name: "Reviewers" }));

    // Typing reveals the eligible option without Enter or a search button.
    const search = within(reviewersSection).getByRole("searchbox", { name: "Search" });
    await user.type(search, "bob");
    await user.click(within(reviewersSection).getByRole("option", { name: "bob-reviewer" }));

    // The username appears in the reviewer area with its Remove button.
    expect(await within(reviewersSection).findByText("bob-reviewer")).toBeTruthy();
    expect(
      within(reviewersSection).getByRole("button", { name: "Remove bob-reviewer" }),
    ).toBeTruthy();
    expect(state.pulls.find((pull) => pull.number === 1)?.reviews.length ?? 0).toBe(0);

    // Removing the request immediately removes the username, without a
    // confirmation step.
    await user.click(within(reviewersSection).getByRole("button", { name: "Remove bob-reviewer" }));
    await waitFor(() => expect(within(reviewersSection).queryByText("bob-reviewer")).toBeNull());
    expect(within(reviewersSection).getByText("No reviewers")).toBeTruthy();

    // Reload keeps the final (empty) request set.
    cleanup();
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1";
    render(<App />);
    const afterReload = await screen.findByRole("region", { name: "Reviewers" });
    expect(within(afterReload).getByText("No reviewers")).toBeTruthy();
  });

  it("a non-author viewer without maintain permission cannot modify requests", async () => {
    const state = seedState();
    state.viewer = CAROL;
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1";
    render(<App />);

    await screen.findByRole("heading", { name: "Improve onboarding" });
    const reviewersSection = screen.getByRole("region", { name: "Reviewers" });
    expect(within(reviewersSection).queryByRole("button", { name: "Reviewers" })).toBeNull();
  });

  it("the author with Admin sees the Reviewers button and can request/remove on the Closed PR page", async () => {
    const state = seedState();
    state.viewer = ALICE;
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    // The seeded `Fix search` PR is Closed; alice-dev is its author and the
    // repository Admin, and Maintain/Admin hold the reviewer-request
    // capability regardless of PR status (REQ-6-4).
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/2";
    render(<App />);

    await screen.findByRole("heading", { name: "Fix search" });
    const reviewersSection = await screen.findByRole("region", { name: "Reviewers" });
    await user.click(within(reviewersSection).getByRole("button", { name: "Reviewers" }));
    const search = within(reviewersSection).getByRole("searchbox", { name: "Search" });
    await user.type(search, "bob");
    await user.click(within(reviewersSection).getByRole("option", { name: "bob-reviewer" }));

    expect(await within(reviewersSection).findByText("bob-reviewer")).toBeTruthy();
    expect(
      within(reviewersSection).getByRole("button", { name: "Remove bob-reviewer" }),
    ).toBeTruthy();

    await user.click(within(reviewersSection).getByRole("button", { name: "Remove bob-reviewer" }));
    await waitFor(() => expect(within(reviewersSection).queryByText("bob-reviewer")).toBeNull());
    expect(within(reviewersSection).getByText("No reviewers")).toBeTruthy();
  });
});

describe("REQ-6-5 merge an eligible pull request", () => {
  it("a Maintain/Admin merges the eligible PR with Create a merge commit and the result persists", async () => {
    const state = seedState();
    state.viewer = ALICE;
    state.rules = [
      { branch: "main", requireApproval: true, requireStatusCheck: true },
    ];
    const pull = state.pulls.find((candidate) => candidate.number === 1)!;
    pull.check = { name: "test", status: "success", setter: "alice-dev", setAt: "2026-09-26T09:00:00.000Z" };
    pull.reviews.push({
      id: "review_approve",
      author: "bob-reviewer",
      decision: "approve",
      commitId: comparison(state, pull.baseBranch, pull.compareBranch).compareCommitId ?? "",
      createdAt: "2026-09-26T09:30:00.000Z",
    });
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1";
    render(<App />);

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getByText("Mergeable")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Merge pull request" }));

    // The confirmation box shows the only selectable method.
    const dialog = await screen.findByRole("dialog", { name: "Merge pull request" });
    expect(within(dialog).getByRole("radio", { name: "Create a merge commit" })).toBeTruthy();
    expect(within(dialog).getByText("All merge conditions are satisfied.")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Confirm merge" }));

    // Merged state, merger, time, and resulting commit identifier.
    expect(await screen.findAllByText("Merged").then((items) => items.length > 0)).toBeTruthy();
    expect(screen.getByText(/Merged by alice-dev on /)).toBeTruthy();
    expect(screen.getByText(/Merge commit: commit_merge_1/)).toBeTruthy();
    expect(
      state.pulls.find((candidate) => candidate.number === 1)?.status,
    ).toBe("merged");

    // Reload preserves the merged status and result.
    cleanup();
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1";
    render(<App />);
    expect(await screen.findAllByText("Merged").then((items) => items.length > 0)).toBeTruthy();
    expect(screen.getByText(/Merge commit: commit_merge_1/)).toBeTruthy();
  });

  it("a blocked PR keeps a disabled Merge button and explains Review required by branch protection", async () => {
    const state = seedState();
    state.viewer = ALICE;
    state.rules = [
      { branch: "main", requireApproval: true, requireStatusCheck: true },
    ];
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1";
    render(<App />);

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getByText("Unmergeable")).toBeTruthy();
    expect(screen.getByText("Review required by branch protection")).toBeTruthy();
    const mergeButton = screen.getByRole("button", { name: "Merge pull request" });
    expect((mergeButton as HTMLButtonElement).disabled).toBe(true);
    expect(state.pulls.find((candidate) => candidate.number === 1)?.status).toBe("open");
  });

  it("a Write reviewer cannot merge even an eligible PR", async () => {
    const state = seedState();
    state.viewer = BOB;
    state.rules = [
      { branch: "main", requireApproval: true, requireStatusCheck: true },
    ];
    const pull = state.pulls.find((candidate) => candidate.number === 1)!;
    pull.check = { name: "test", status: "success", setter: "alice-dev", setAt: "2026-09-26T09:00:00.000Z" };
    pull.reviews.push({
      id: "review_approve",
      author: "bob-reviewer",
      decision: "approve",
      commitId: comparison(state, pull.baseBranch, pull.compareBranch).compareCommitId ?? "",
      createdAt: "2026-09-26T09:30:00.000Z",
    });
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1";
    render(<App />);

    await screen.findByRole("heading", { name: "Improve onboarding" });
    const mergeButton = screen.getByRole("button", { name: "Merge pull request" });
    expect((mergeButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Only Maintain, Admin, or organization Owner can merge/)).toBeTruthy();
  });
});

describe("REQ-6-6 close or reopen a pull request without merging", () => {
  it("the author closes and reopens an Open PR: Closed then Open in sequence, both transitions in the timeline, and Close returns after reload", async () => {
    const state = seedState();
    state.viewer = ALICE;
    stubFetch(fetchHandler(state));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1";
    render(<App />);

    // The Open PR with its discussion is open and the author can close it.
    expect(await screen.findByRole("heading", { name: "Improve onboarding" }));
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("I will refine the search flow after this ships.")).toBeTruthy();
    const closeButton = screen.getByRole("button", { name: "Close pull request" });

    // Close applies immediately without any confirmation dialog.
    await user.click(closeButton);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Close pull request" })).toBeNull());
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.getAllByText(/alice-dev closed this pull request/).length).toBeGreaterThan(0);
    expect(screen.getByText("I will refine the search flow after this ships.")).toBeTruthy();
    const reopenButton = screen.getByRole("button", { name: "Reopen pull request" });

    // Reopen immediately restores Open and records the second transition.
    await user.click(reopenButton);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Reopen pull request" })).toBeNull());
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getAllByText(/alice-dev reopened this pull request/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/alice-dev closed this pull request/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Close pull request" })).toBeTruthy();
    expect(state.pulls.find((pull) => pull.number === 1)?.status).toBe("open");

    // Reload keeps the final Open status, the discussion, and both transitions.
    cleanup();
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Improve onboarding" }));
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("I will refine the search flow after this ships.")).toBeTruthy();
    expect(screen.getAllByText(/alice-dev closed this pull request/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/alice-dev reopened this pull request/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Close pull request" })).toBeTruthy();
  });

  it("a viewer who is neither the author nor a maintainer sees no Close/Reopen controls and the status stays unchanged", async () => {
    const state = seedState();
    state.viewer = BOB;
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1";
    render(<App />);

    await screen.findByRole("heading", { name: "Improve onboarding" });
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close pull request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen pull request" })).toBeNull();
    expect(state.pulls.find((pull) => pull.number === 1)?.status).toBe("open");
    expect(
      state.pulls.find((pull) => pull.number === 1)?.activities.filter((activity) => activity.type === "closed").length,
    ).toBe(0);
  });

  it("a viewer cannot change the status of a closed PR either; a Merged PR displays no close or reopen operations", async () => {
    const state = seedState();
    // Mark PR 2 closed (seeded) as the target: the viewer can read it but
    // cannot reopen it, and the state stays closed.
    state.viewer = CAROL;
    stubFetch(fetchHandler(state));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/2";
    render(<App />);

    await screen.findByRole("heading", { name: "Fix search" });
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen pull request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close pull request" })).toBeNull();
    expect(state.pulls.find((pull) => pull.number === 2)?.status).toBe("closed");

    // A merged PR is terminal: even its author sees no close or reopen button.
    cleanup();
    stubFetch(fetchHandler(state));
    const merged = state.pulls.find((pull) => pull.number === 1)!;
    merged.status = "merged";
    (merged as unknown as { mergedAt: string | null }).mergedAt = new Date().toISOString();
    state.viewer = ALICE;
    window.location.hash = "#/u/alice-dev/repos/acme-docs/pulls/1";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Improve onboarding" }));
    expect((await screen.findAllByText("Merged")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Close pull request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen pull request" })).toBeNull();
  });
});
