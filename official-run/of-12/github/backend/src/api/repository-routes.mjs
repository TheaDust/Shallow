import { asString, readJson, sendJson } from "../lib/http.mjs";
import {
  canReadRepository,
  effectiveRepositoryRole,
  findRepository,
  findRepositoryFile,
  readableRepositories,
  repositoryCommits,
  repositoryDirectory,
  repositoryOverview,
  repositorySummary,
} from "../domain/repository-access.mjs";
import {
  ISSUE_MESSAGES,
  findRepositoryIssue,
  issueComments,
  issuePermissions,
  issueStatus,
  issueSummary,
  issueTimeline,
  reactionTally,
  repositoryAssignableMembers,
  repositoryIssues,
  repositoryLabels,
  repositoryMilestones,
} from "../domain/issues.mjs";
import {
  addIssueComment,
  createRepositoryIssue,
  editRepositoryIssueDescription,
  editRepositoryIssueTitle,
  toggleIssueReaction,
} from "../domain/issue-writes.mjs";
import {
  changeIssueStatus,
  setIssueMilestone,
  toggleIssueAssignee,
  toggleIssueLabel,
} from "../domain/issue-metadata-writes.mjs";
import {
  BRANCH_MESSAGES,
  branchFilePaths,
  branchHistoryForPath,
  commitSummary,
  findRepositoryBranch,
  findRepositoryCommit,
  lastCommitForPath,
  repositoryBranchNames,
  resolveBranchName,
} from "../domain/repository-branches.mjs";
import {
  commitComparison,
  diffSummary,
  revisionChanges,
  revisionComparison,
} from "../domain/repository-diff.mjs";
import { fileName, repositoryLanguages, searchRepositoryCode } from "../domain/repository-code-search.mjs";
import { createPullRequestApi } from "./pull-request-routes.mjs";
import { commitRepositoryFile } from "../domain/repository-file-commits.mjs";
import {
  BRANCH_WRITE_MESSAGES,
  changeRepositoryDefaultBranch,
  createRepositoryBranch,
} from "../domain/repository-branch-writes.mjs";
import {
  canManageRepositoryAccess,
  REPOSITORY_ACCESS_MESSAGES,
  repositoryAccessState,
  setRepositoryGrant,
} from "../domain/repository-grants.mjs";
import {
  changeRepositoryVisibility,
  createRepository,
  forkRepository,
  REPOSITORY_MESSAGES,
} from "../domain/repository-writes.mjs";

/**
 * HTTP surface of a single repository: the overview and default-branch content
 * (REQ-3-3), the clone values the overview displays (REQ-3-2-3), the
 * Manage-access grants (REQ-2-3), creation, forking and the visibility change
 * (REQ-3-2-1, REQ-3-2-2, REQ-3-4).
 *
 * The Code page family adds the read-only history, comparison and code-search
 * sub-resources of REQ-4-2 next to the file content of REQ-4-1.
 *
 * The pull-request review and merge control of REQ-6 lives in
 * `api/pull-request-routes.mjs`, which this module calls once the repository is
 * resolved.
 *
 * Every read resolves the repository from its owner identifier — an
 * organization or an individual account — and refuses a repository the caller
 * may not read, so a private repository never leaks its content.
 */

/** Sub-resources below a repository address that a GET may read (REQ-4, REQ-5). */
const READABLE_SUBRESOURCES = new Set(["contents", "commits", "revisions", "compare", "code-search"]);

/**
 * Sub-resources below an issue that a write may address: the content writes of
 * REQ-5-2 (title, description, comments, reactions) and the metadata and status
 * writes of REQ-5-3 / REQ-5-4.
 */
const WRITABLE_ISSUE_SUBRESOURCES = new Set([
  "title",
  "description",
  "comments",
  "reactions",
  "assignees",
  "labels",
  "milestone",
  "status",
]);

/** The writable sub-resources below an issue that Triage, Maintain or Admin own. */
const METADATA_ISSUE_SUBRESOURCES = new Set(["assignees", "labels", "milestone", "status"]);

function isReadableSubresource(rest) {
  if (rest.length === 1) return READABLE_SUBRESOURCES.has(rest[0]) || rest[0] === "issues";
  return rest.length === 2 && (rest[0] === "commits" || rest[0] === "issues");
}

/** Whether the request addresses a write below one issue of this repository. */
function isIssueWrite(rest, method) {
  if (method === "GET" || rest[0] !== "issues" || rest.length < 3) return false;
  if (rest.length === 3) return WRITABLE_ISSUE_SUBRESOURCES.has(rest[2]);
  return rest.length === 5 && rest[2] === "comments" && rest[4] === "reactions";
}

export function createRepositoryApi({ store, resolveAccount }) {
  const pullRequestApi = createPullRequestApi({ store, sendRepositoryOverview: overviewResponse });

  function accessPayload(data, repository, accountId) {
    return {
      repository: repositorySummary(data, repository),
      ...repositoryAccessState(data, repository, accountId),
    };
  }

  /** `/access` — the Manage-access read model and the grant write (REQ-2-3). */
  async function handleAccess(request, response, data, repository, method, account) {
    if (!account) {
      sendJson(response, 401, { error: "Sign in is required to manage repository access" });
      return true;
    }
    // A non-Admin is refused exactly like an unauthorized write, whichever
    // request method reaches the page.
    if (!canManageRepositoryAccess(data, repository, account.id)) {
      sendJson(response, 403, { error: REPOSITORY_ACCESS_MESSAGES.forbidden });
      return true;
    }
    if (method === "GET") {
      sendJson(response, 200, accessPayload(data, repository, account.id));
      return true;
    }
    if (method === "PUT" || method === "POST" || method === "PATCH") {
      const body = await readJson(request);
      const result = await setRepositoryGrant(store, repository.id, account.id, {
        subjectType: asString(body.subjectType),
        subject: asString(body.subject),
        role: asString(body.role),
      });
      if (!result.ok) {
        if (result.forbidden) {
          sendJson(response, 403, { error: REPOSITORY_ACCESS_MESSAGES.forbidden });
          return true;
        }
        const message = Object.values(result.errors ?? {})[0] ?? REPOSITORY_ACCESS_MESSAGES.saveFailed;
        sendJson(response, 400, { error: message, fields: result.errors ?? {} });
        return true;
      }
      const refreshed = await store.read();
      const saved = refreshed.repositories.find((candidate) => candidate.id === repository.id);
      sendJson(response, 200, accessPayload(refreshed, saved, account.id));
      return true;
    }
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  /**
   * GET /api/repositories/:owner/:repo/contents[?path=&branch=] — the file or
   * directory at a path on a branch (REQ-4-1). Without a branch the default
   * branch is read, so a page entry without a branch keeps working.
   */
  async function handleContents(request, response, url, repository) {
    const requested = url.searchParams.get("branch") ?? "";
    if (requested && !findRepositoryBranch(repository, requested)) {
      sendJson(response, 404, { error: BRANCH_MESSAGES.branchNotFound });
      return true;
    }
    const branch = resolveBranchName(repository, requested) ?? repository.defaultBranch ?? "main";
    const path = url.searchParams.get("path") ?? "";
    // The commit count of the branch accompanies the history link of the Code
    // page without introducing a second link named "Commits" (REQ-4-2-1).
    const commitCount = branchHistoryForPath(repository, branch, "").length;
    const file = findRepositoryFile(repository, path, branch);
    if (file) {
      sendJson(response, 200, {
        branch,
        path: file.path,
        commitCount,
        file: {
          path: file.path,
          content: file.content,
          updatedAt: file.updatedAt ?? null,
          lastCommit: lastCommitForPath(repository, branch, file.path),
        },
      });
      return true;
    }
    const entries = repositoryDirectory(repository, path, branch);
    if (entries.length > 0 || !path.replace(/^\/+|\/+$/g, "")) {
      sendJson(response, 200, { branch, path: path.replace(/^\/+|\/+$/g, ""), commitCount, entries });
      return true;
    }
    sendJson(response, 404, { error: "File not found" });
    return true;
  }

  /**
   * POST /api/repositories/:owner/:repo/contents — the file editor submit
   * (REQ-4-4): one commit records the path and content change, the message, the
   * author, the parent commit and the target branch, and moves the branch. Every
   * rule is checked inside the same atomic update, so a rejection leaves the
   * file, the branch head and the history unchanged.
   */
  async function handleFileCommit(request, response, repository, account) {
    if (!account) {
      sendJson(response, 401, { error: BRANCH_MESSAGES.signInRequired });
      return true;
    }
    const body = await readJson(request);
    const result = await commitRepositoryFile(store, repository.id, account.id, {
      branch: asString(body.branch),
      path: asString(body.path),
      content: typeof body.content === "string" ? body.content : "",
      message: asString(body.message),
      create: body.create === true,
      originalPath: asString(body.originalPath),
    });
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: BRANCH_MESSAGES.forbidden });
        return true;
      }
      if (result.missing) {
        sendJson(response, 404, { error: result.errors?.branch ?? BRANCH_MESSAGES.branchNotFound });
        return true;
      }
      const message = Object.values(result.errors ?? {})[0] ?? BRANCH_MESSAGES.commitFailed;
      sendJson(response, 400, { error: message, fields: result.errors ?? {} });
      return true;
    }
    const data = await store.read();
    const saved = data.repositories.find((candidate) => candidate.id === repository.id) ?? repository;
    const file = findRepositoryFile(saved, result.path, result.branch);
    sendJson(response, 201, {
      branch: result.branch,
      path: result.path,
      file: file
        ? {
            path: file.path,
            content: file.content,
            updatedAt: file.updatedAt ?? null,
            lastCommit: lastCommitForPath(saved, result.branch, file.path),
          }
        : null,
      commit: repositoryCommits(saved, result.branch)[0] ?? null,
    });
    return true;
  }

  /** The overview payload of a freshly written repository, for its new owner. */
  async function overviewResponse(response, repositoryId, accountId, status) {
    const data = await store.read();
    const repository = data.repositories.find((candidate) => candidate.id === repositoryId);
    if (!repository) {
      sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
      return;
    }
    sendJson(response, status, { repository: repositoryOverview(data, repository, accountId) });
  }

  /** POST /api/repositories — create a repository (REQ-3-2-1). */
  async function handleCreate(request, response, account) {
    if (!account) {
      sendJson(response, 401, { error: REPOSITORY_MESSAGES.signInRequired });
      return;
    }
    const body = await readJson(request);
    const result = await createRepository(store, account.id, {
      owner: asString(body.owner),
      name: asString(body.name),
      description: asString(body.description),
      visibility: asString(body.visibility),
      initialize: body.initialize === true,
    });
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 401, { error: REPOSITORY_MESSAGES.signInRequired });
        return;
      }
      const message = Object.values(result.errors ?? {})[0] ?? REPOSITORY_MESSAGES.createFailed;
      sendJson(response, 400, { error: message, fields: result.errors ?? {} });
      return;
    }
    await overviewResponse(response, result.repositoryId, account.id, 201);
  }

  /**
   * POST /api/repositories/:owner/:repo/branches — create one named reference at
   * a base commit (REQ-4-3-2). Only Write, Maintain, Admin and an organization
   * Owner may create a branch; the response carries the refreshed overview, so
   * the selector can list the new branch without a second read.
   */
  async function handleBranchCreate(request, response, repository, account) {
    if (!account) {
      sendJson(response, 401, { error: BRANCH_WRITE_MESSAGES.signInRequired });
      return true;
    }
    const body = await readJson(request);
    const result = await createRepositoryBranch(store, repository.id, account.id, {
      name: asString(body.name),
      base: asString(body.base),
    });
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: BRANCH_WRITE_MESSAGES.forbidden });
        return true;
      }
      if (result.missing) {
        sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
        return true;
      }
      const message = Object.values(result.errors ?? {})[0] ?? BRANCH_WRITE_MESSAGES.createFailed;
      sendJson(response, 400, { error: message, fields: result.errors ?? {} });
      return true;
    }
    await overviewResponse(response, repository.id, account.id, 201);
    return true;
  }

  /**
   * POST /api/repositories/:owner/:repo/default-branch — store which branch a
   * page reads by default (REQ-4-3-3). Only a repository Admin or an
   * organization Owner may apply it; a non-Admin request is refused and the
   * stored default branch stays unchanged.
   */
  async function handleDefaultBranch(request, response, repository, account) {
    if (!account) {
      sendJson(response, 401, { error: BRANCH_WRITE_MESSAGES.defaultBranchForbidden });
      return true;
    }
    const body = await readJson(request);
    const result = await changeRepositoryDefaultBranch(store, repository.id, account.id, {
      branch: asString(body.branch),
    });
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: BRANCH_WRITE_MESSAGES.defaultBranchForbidden });
        return true;
      }
      if (result.missing) {
        sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
        return true;
      }
      const message = Object.values(result.errors ?? {})[0] ?? BRANCH_WRITE_MESSAGES.defaultBranchFailed;
      sendJson(response, 400, { error: message, fields: result.errors ?? {} });
      return true;
    }
    await overviewResponse(response, repository.id, account.id, 200);
    return true;
  }

  /** POST /api/repositories/:owner/:repo/forks — fork into a namespace (REQ-3-2-2). */
  async function handleFork(request, response, repository, account) {
    if (!account) {
      sendJson(response, 401, { error: REPOSITORY_MESSAGES.signInRequired });
      return;
    }
    const body = await readJson(request);
    const result = await forkRepository(store, repository.id, account.id, {
      owner: asString(body.owner),
      name: asString(body.name),
      visibility: asString(body.visibility),
    });
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: REPOSITORY_MESSAGES.sourceUnreadable });
        return;
      }
      if (result.missing) {
        sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
        return;
      }
      const message = Object.values(result.errors ?? {})[0] ?? REPOSITORY_MESSAGES.forkFailed;
      sendJson(response, 400, { error: message, fields: result.errors ?? {} });
      return;
    }
    await overviewResponse(response, result.repositoryId, account.id, 201);
  }

  /** POST /api/repositories/:owner/:repo/visibility — change visibility (REQ-3-4). */
  async function handleVisibility(request, response, repository, account) {
    if (!account) {
      sendJson(response, 401, { error: REPOSITORY_MESSAGES.forbidden });
      return;
    }
    const body = await readJson(request);
    const result = await changeRepositoryVisibility(store, repository.id, account.id, {
      visibility: asString(body.visibility),
      confirmation: typeof body.confirmation === "string" ? body.confirmation : "",
    });
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: REPOSITORY_MESSAGES.forbidden });
        return;
      }
      if (result.missing) {
        sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
        return;
      }
      const message = Object.values(result.errors ?? {})[0] ?? REPOSITORY_MESSAGES.visibilityFailed;
      sendJson(response, 400, { error: message, fields: result.errors ?? {} });
      return;
    }
    await overviewResponse(response, result.repositoryId, account.id, 200);
  }

  /**
   * GET /api/repositories/:owner/:repo/commits[?branch=&path=] — the history of
   * a branch, or of one file of that branch, newest first (REQ-4-2-1). Each
   * record carries the identifier, author, time, message, parent commit and
   * changed files of a stored commit.
   */
  function handleCommits(response, url, repository) {
    const requested = url.searchParams.get("branch") ?? "";
    if (requested && !findRepositoryBranch(repository, requested)) {
      sendJson(response, 404, { error: BRANCH_MESSAGES.branchNotFound });
      return true;
    }
    const branch = resolveBranchName(repository, requested) ?? repository.defaultBranch ?? "main";
    const path = (url.searchParams.get("path") ?? "").replace(/^\/+|\/+$/g, "");
    const commits = branchHistoryForPath(repository, branch, path).map(commitSummary);
    sendJson(response, 200, {
      branch,
      branches: repositoryBranchNames(repository),
      path,
      files: branchFilePaths(repository, branch),
      commits,
    });
    return true;
  }

  /**
   * GET /api/repositories/:owner/:repo/commits/:commitId — one stored commit
   * compared against its parent revision (REQ-4-2-2), so a commit entry can be
   * opened directly without walking through history first.
   */
  function handleCommitDetail(response, repository, commitId) {
    const commit = findRepositoryCommit(repository, commitId);
    if (!commit) {
      sendJson(response, 404, { error: "Commit not found" });
      return true;
    }
    const comparison = commitComparison(repository, commit);
    sendJson(response, 200, {
      branch: commit.branch ?? repository.defaultBranch ?? null,
      commit: commitSummary(commit),
      base: comparison.base,
      compare: comparison.compare,
      summary: comparison.summary,
      files: comparison.files,
    });
    return true;
  }

  /** GET /api/repositories/:owner/:repo/revisions — the selectable revisions. */
  function handleRevisions(response, repository) {
    const commits = Array.isArray(repository?.commits) ? repository.commits : [];
    const branches = repositoryBranchNames(repository);
    const revisions = [
      ...branches.map((name) => ({ value: name, label: name, type: "branch" })),
      ...commits
        .filter((commit) => commit?.id)
        .slice()
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
        .map((commit) => ({
          value: commit.id,
          label: `${String(commit.id).slice(0, 7)} ${commit.message ?? ""}`.trim(),
          type: "commit",
        })),
    ];
    sendJson(response, 200, {
      branch: resolveBranchName(repository, "") ?? repository.defaultBranch ?? "main",
      branches,
      revisions,
    });
    return true;
  }

  /**
   * GET /api/repositories/:owner/:repo/compare?base=&compare= — the read-only
   * comparison of two revisions (REQ-4-2-2). An unknown revision is refused
   * without producing any diff content.
   */
  function handleCompare(response, url, repository) {
    const base = asString(url.searchParams.get("base") ?? "");
    const compare = asString(url.searchParams.get("compare") ?? "");
    if (!base || !compare) {
      sendJson(response, 400, {
        error: "Two revisions are required to compare",
        fields: {
          ...(base ? {} : { base: "Choose a base revision" }),
          ...(compare ? {} : { compare: "Choose a revision to compare" }),
        },
      });
      return true;
    }
    const comparison = revisionComparison(repository, base, compare);
    if (!comparison) {
      sendJson(response, 400, { error: "Unknown revision", fields: { base: "Unknown revision" } });
      return true;
    }
    sendJson(response, 200, comparison);
    return true;
  }

  /**
   * GET /api/repositories/:owner/:repo/issues — the issue rows of this
   * repository (REQ-5-1-1). The rows are only the currently displayed data:
   * filtering happens in the browser and never writes. The payload also carries
   * the pre-existing labels and milestones of the repository and what the
   * caller may do with the issues, so a page can decide about its controls.
   */
  function handleIssueList(response, data, repository, account) {
    const issues = repositoryIssues(data, repository);
    sendJson(response, 200, {
      repository: repositorySummary(data, repository),
      viewerRole: effectiveRepositoryRole(data, repository, account?.id ?? null),
      permissions: issuePermissions(data, repository, account?.id ?? null),
      labels: repositoryLabels(repository),
      milestones: repositoryMilestones(repository),
      assignableMembers: repositoryAssignableMembers(data, repository),
      openCount: issues.filter((issue) => issueStatus(issue) === "open").length,
      closedCount: issues.filter((issue) => issueStatus(issue) === "closed").length,
      issues: issues.map(issueSummary),
    });
  }

  /**
   * GET /api/repositories/:owner/:repo/issues/:number — the complete view of
   * one work item (REQ-5-1-2): the same number, title, status, description and
   * metadata the list reads, plus the stored comments and the activity timeline
   * in chronological order. An unknown number or an unreadable repository
   * answers without any issue content.
   */
  function handleIssueDetail(response, data, repository, account, numberSegment) {
    const raw = String(numberSegment ?? "").trim();
    const number = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
    const payload = issueDetailPayload(data, repository, account, number);
    if (!payload) {
      sendJson(response, 404, { error: "Issue not found" });
      return;
    }
    sendJson(response, 200, payload);
  }

  /**
   * The complete detail payload of one issue (REQ-5-1-2), shared by the read and
   * by every write of the issue workflow (REQ-5-2), so a page always renders the
   * same stored record after a change. The reactions of the issue and of each
   * comment are summed for the caller, who is the one that may have reacted.
   */
  function issueDetailPayload(data, repository, account, number) {
    const issue = findRepositoryIssue(data, repository, number);
    if (!issue) return null;
    const accountId = account?.id ?? null;
    const reactions = issue.reactions ?? [];
    return {
      repository: repositorySummary(data, repository),
      viewerRole: effectiveRepositoryRole(data, repository, accountId),
      permissions: issuePermissions(data, repository, accountId),
      // The pre-existing classification items of this repository and the
      // accounts that may be assigned to this issue: the metadata selectors of
      // the detail page offer exactly these, so no item of another repository
      // and no account without repository access can be selected (REQ-5-3).
      labels: repositoryLabels(repository),
      milestones: repositoryMilestones(repository),
      assignableMembers: repositoryAssignableMembers(data, repository),
      issue: { ...issueSummary(issue), reactions: reactionTally(reactions, "issue", issue.id, accountId) },
      comments: issueComments(issue).map((comment) => ({
        id: comment.id,
        author: comment.author ?? "",
        body: comment.body ?? "",
        createdAt: comment.createdAt ?? null,
        reactions: reactionTally(reactions, "comment", comment.id, accountId),
      })),
      timeline: issueTimeline(issue).map((event) => ({
        id: event.id,
        type: event.type ?? "activity",
        actor: event.actor ?? "",
        text: event.text ?? "",
        createdAt: event.createdAt ?? null,
      })),
    };
  }

  /** The refreshed detail payload after a write, or a 404 for a vanished issue. */
  async function respondWithIssue(response, repositoryId, accountId, number, status) {
    const refreshed = await store.read();
    const repository = refreshed.repositories.find((candidate) => candidate.id === repositoryId);
    const account = (refreshed.accounts ?? []).find((candidate) => candidate.id === accountId) ?? null;
    const payload = repository ? issueDetailPayload(refreshed, repository, account, number) : null;
    if (!payload) {
      sendJson(response, 404, { error: ISSUE_MESSAGES.issueNotFound });
      return;
    }
    sendJson(response, status, payload);
  }

  /**
   * POST /api/repositories/:owner/:repo/issues — create one issue (REQ-5-2-1).
   * The number continues the repository sequence and the creation activity is
   * stored with the record; a rejected submission allocates no number.
   */
  async function handleIssueCreate(request, response, repository, account) {
    if (!account) {
      sendJson(response, 401, { error: ISSUE_MESSAGES.createForbidden });
      return true;
    }
    const body = await readJson(request);
    const result = await createRepositoryIssue(store, repository.id, account.id, {
      title: asString(body.title),
      description: typeof body.description === "string" ? body.description : "",
    });
    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: ISSUE_MESSAGES.createForbidden });
        return true;
      }
      if (result.missing) {
        sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
        return true;
      }
      const message = Object.values(result.errors ?? {})[0] ?? ISSUE_MESSAGES.titleRequired;
      sendJson(response, 400, { error: message, fields: result.errors ?? {} });
      return true;
    }
    await respondWithIssue(response, repository.id, account.id, result.number, 201);
    return true;
  }

  /**
   * The writes around one issue: the content writes of REQ-5-2-2 / REQ-5-2-3
   * (title, description, one appended comment, one reaction association) and
   * the metadata and status writes of REQ-5-3-1 / REQ-5-3-2 / REQ-5-3-3 /
   * REQ-5-4 (assignees, labels, milestone, status). Each handler answers with
   * the refreshed detail payload, so the page and a later reload read the same
   * stored data.
   */
  async function handleIssueWrite(request, response, repository, account, rest) {
    const raw = String(rest[1] ?? "").trim();
    const number = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
    const commentId = rest.length === 5 ? rest[3] : null;
    const target = rest.length === 5 ? rest[4] : rest[2];
    if (!Number.isInteger(number)) {
      sendJson(response, 404, { error: ISSUE_MESSAGES.issueNotFound });
      return true;
    }
    // The refusal names the operation the caller attempted, so a rejected
    // metadata or status write never claims to be a content edit (REQ-5-4).
    const forbidden = METADATA_ISSUE_SUBRESOURCES.has(target)
      ? (target === "status" ? ISSUE_MESSAGES.statusForbidden : ISSUE_MESSAGES.metadataForbidden)
      : ISSUE_MESSAGES.editForbidden;
    if (!account) {
      sendJson(response, 401, { error: forbidden });
      return true;
    }
    const body = await readJson(request);
    let result;
    if (target === "title") {
      result = await editRepositoryIssueTitle(store, repository.id, account.id, number, {
        title: asString(body.title),
      });
    } else if (target === "description") {
      result = await editRepositoryIssueDescription(store, repository.id, account.id, number, {
        description: typeof body.description === "string" ? body.description : "",
      });
    } else if (target === "comments" && !commentId) {
      result = await addIssueComment(store, repository.id, account.id, number, {
        body: asString(body.body ?? body.comment),
      });
    } else if (target === "reactions") {
      result = await toggleIssueReaction(store, repository.id, account.id, number, {
        type: asString(body.type),
        commentId: commentId ?? asString(body.commentId),
      });
    } else if (target === "assignees") {
      result = await toggleIssueAssignee(store, repository.id, account.id, number, {
        username: asString(body.username ?? body.assignee),
      });
    } else if (target === "labels") {
      result = await toggleIssueLabel(store, repository.id, account.id, number, {
        label: asString(body.label ?? body.name),
      });
    } else if (target === "milestone") {
      result = await setIssueMilestone(store, repository.id, account.id, number, {
        milestone: body.milestone === null ? null : asString(body.milestone ?? body.title),
      });
    } else if (target === "status") {
      result = await changeIssueStatus(store, repository.id, account.id, number, {
        status: asString(body.status),
      });
    } else {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }

    if (!result.ok) {
      if (result.forbidden) {
        sendJson(response, 403, { error: forbidden });
        return true;
      }
      if (result.errors) {
        const message = Object.values(result.errors)[0] ?? ISSUE_MESSAGES.titleRequired;
        sendJson(response, 400, { error: message, fields: result.errors });
        return true;
      }
      sendJson(response, 404, { error: result.missing ? ISSUE_MESSAGES.issueNotFound : forbidden });
      return true;
    }
    await respondWithIssue(response, repository.id, account.id, number, target === "comments" ? 201 : 200);
    return true;
  }

  /**
   * GET /api/repositories/:owner/:repo/code-search?q=&path=&language= — the
   * matching files of this repository only (REQ-4-2-3).
   */
  function handleCodeSearch(response, url, repository, data) {
    const result = searchRepositoryCode(repository, {
      query: url.searchParams.get("q") ?? "",
      path: url.searchParams.get("path") ?? "",
      language: url.searchParams.get("language") ?? "",
    });
    sendJson(response, 200, { repository: repositorySummary(data, repository), ...result });
    return true;
  }

  /**
   * Returns true when the request was handled here.
   */
  return async function handleRepositoryRequest(request, response, { pathname, method, url }) {
    const segments = pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if (segments[0] !== "api" || segments[1] !== "repositories") return false;

    // GET /api/repositories — the repository list of the home page and the
    // signed-in workspace (REQ-3), holding only repositories the caller may
    // read, so a visitor never sees a private repository in a list.
    if (segments.length === 2 && method === "GET") {
      const account = await resolveAccount(request);
      const data = await store.read();
      sendJson(response, 200, {
        repositories: readableRepositories(data, account?.id ?? null)
          .map((repository) => repositorySummary(data, repository))
          .sort((left, right) => left.fullName.localeCompare(right.fullName)),
      });
      return true;
    }

    // POST /api/repositories — the repository-creation page (REQ-3-2-1).
    if (segments.length === 2) {
      if (method !== "POST") {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      await handleCreate(request, response, await resolveAccount(request));
      return true;
    }

    const [ownerName, repositoryName, ...rest] = segments.slice(2);
    if (!ownerName || !repositoryName) {
      sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
      return true;
    }

    const account = await resolveAccount(request);
    const data = await store.read();
    const repository = findRepository(data, ownerName, repositoryName);
    if (!repository) {
      sendJson(response, 404, { error: REPOSITORY_ACCESS_MESSAGES.repositoryNotFound });
      return true;
    }

    if (rest.length === 1 && rest[0] === "access") {
      return handleAccess(request, response, data, repository, method, account);
    }

    if (rest.length === 1 && rest[0] === "forks" && method === "POST") {
      await handleFork(request, response, repository, account);
      return true;
    }

    if (rest.length === 1 && rest[0] === "visibility" && method === "POST") {
      await handleVisibility(request, response, repository, account);
      return true;
    }

    // Branch writes of the Code page family (REQ-4-3-2, REQ-4-3-3).
    if (rest.length === 1 && rest[0] === "branches" && (method === "POST" || method === "PUT")) {
      await handleBranchCreate(request, response, repository, account);
      return true;
    }

    if (rest.length === 1 && rest[0] === "default-branch" && (method === "POST" || method === "PUT")) {
      await handleDefaultBranch(request, response, repository, account);
      return true;
    }

    // The pull-request review and merge control of this repository: the Pull
    // requests page, the detail page with its Checks area, the branch
    // protection rules and the merge (REQ-6, REQ-6-1).
    if (await pullRequestApi(request, response, { data, repository, account, rest, method })) {
      return true;
    }

    // Creating an issue through its list page (REQ-5-2-1).
    if (rest.length === 1 && rest[0] === "issues" && method === "POST") {
      await handleIssueCreate(request, response, repository, account);
      return true;
    }

    // Editing, commenting and reacting below one issue (REQ-5-2-2, REQ-5-2-3).
    if (isIssueWrite(rest, method)) {
      await handleIssueWrite(request, response, repository, account, rest);
      return true;
    }

    if (rest.length !== 0 && !isReadableSubresource(rest)) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }

    // A file change through the Code page creates one commit (REQ-4-4).
    if (rest.length === 1 && rest[0] === "contents" && (method === "POST" || method === "PUT")) {
      await handleFileCommit(request, response, repository, account);
      return true;
    }

    if (method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }

    if (!canReadRepository(data, repository, account?.id ?? null)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }

    if (rest.length === 1 && rest[0] === "issues") {
      handleIssueList(response, data, repository, account);
      return true;
    }
    if (rest.length === 2 && rest[0] === "issues") {
      handleIssueDetail(response, data, repository, account, rest[1]);
      return true;
    }
    if (rest.length === 1 && rest[0] === "contents") return handleContents(request, response, url, repository);
    if (rest.length === 1 && rest[0] === "commits") return handleCommits(response, url, repository);
    if (rest.length === 2 && rest[0] === "commits") return handleCommitDetail(response, repository, rest[1]);
    if (rest.length === 1 && rest[0] === "revisions") return handleRevisions(response, repository);
    if (rest.length === 1 && rest[0] === "compare") return handleCompare(response, url, repository);
    if (rest.length === 1 && rest[0] === "code-search") {
      return handleCodeSearch(response, url, repository, data);
    }

    sendJson(response, 200, { repository: repositoryOverview(data, repository, account?.id ?? null) });
    return true;
  };
}
