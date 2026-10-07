// Read-only repository code views: the branch commit list, the directory tree,
// one stored file, the difference of a commit against its parent revision and
// the code search inside the readable file content.
//
// Every response here is produced by GET requests and applies the shared
// repository read rule, so browsing, history, diffs and search can never expose
// a repository the caller may not read, and can never write to it.

import { sendJson } from "./http.mjs";
import { ORG_MESSAGES } from "./org-rules.mjs";
import { publicRepository } from "./org-store.mjs";

const REPOSITORIES_PREFIX = "/api/repositories/";
const COMMITS_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/commits$/;
const TREE_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/tree$/;
const BLOB_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/blob$/;
const COMMIT_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/commit\/([^/]+)$/;
const CODE_SEARCH_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/code-search$/;
const BRANCHES_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/branches$/;

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The branch a read view asks for; empty means the repository default branch. */
function branchParam(url) {
  return (url.searchParams.get("branch") ?? "").trim();
}

export function createRepositoryCodeRoutes({ orgStore, findRepository, describeOwner, currentUser }) {
  /** Resolves the repository of one match and enforces the read rule. */
  async function readableRepository(response, owner, name, user) {
    const repository = await findRepository(decodeSegment(owner), decodeSegment(name));
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return null;
    }
    if (!(await orgStore.canReadRepository(repository, user?.id ?? null))) {
      sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
      return null;
    }
    return repository;
  }

  async function withOwner(repository) {
    return {
      ...publicRepository(repository),
      owner: await describeOwner(repository.ownerType, repository.ownerId),
    };
  }

  return async function handleRepositoryCode(request, response, url, method) {
    const { pathname } = url;
    if (method !== "GET" || !pathname.startsWith(REPOSITORIES_PREFIX)) return false;

    const commitsMatch = pathname.match(COMMITS_PATH);
    const treeMatch = pathname.match(TREE_PATH);
    const blobMatch = pathname.match(BLOB_PATH);
    const commitMatch = pathname.match(COMMIT_PATH);
    const codeSearchMatch = pathname.match(CODE_SEARCH_PATH);
    const branchesMatch = pathname.match(BRANCHES_PATH);
    const match = commitsMatch ?? treeMatch ?? blobMatch ?? commitMatch ?? codeSearchMatch ?? branchesMatch;
    if (!match) return false;

    const user = await currentUser(request);
    const repository = await readableRepository(response, match[1], match[2], user);
    if (!repository) return true;

    // GET .../branches — the named references of this repository plus whether
    // the caller may create one. The list is readable with the repository, so
    // any visitor may open the branch selector.
    if (branchesMatch) {
      const listed = await orgStore.listRepositoryBranches(repository.id);
      if (!listed) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      sendJson(response, 200, {
        repository: await withOwner(repository),
        defaultBranch: listed.defaultBranch,
        branches: listed.branches,
        canWrite: await orgStore.canWriteRepository(repository, user?.id ?? null),
      });
      return true;
    }

    if (commitsMatch) {
      const path = (url.searchParams.get("path") ?? "").trim();
      const branch = branchParam(url);
      const commits = await orgStore.listRepositoryCommits(repository.id, { branch, path });
      sendJson(response, 200, {
        repository: await withOwner(repository),
        branch: branch || (repository.defaultBranch ?? "main"),
        defaultBranch: repository.defaultBranch ?? "main",
        path,
        commits,
      });
      return true;
    }

    if (treeMatch) {
      const tree = await orgStore.listRepositoryTree(repository.id, {
        branch: branchParam(url),
        path: (url.searchParams.get("path") ?? "").trim(),
      });
      if (!tree) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      sendJson(response, 200, { repository: await withOwner(repository), ...tree });
      return true;
    }

    if (blobMatch) {
      const file = await orgStore.getRepositoryFile(repository.id, {
        branch: branchParam(url),
        path: (url.searchParams.get("path") ?? "").trim(),
      });
      if (!file) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      sendJson(response, 200, { repository: await withOwner(repository), file });
      return true;
    }

    if (commitMatch) {
      const detail = await orgStore.getRepositoryCommit(
        repository.id,
        decodeSegment(commitMatch[3]),
      );
      if (!detail) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      sendJson(response, 200, { repository: await withOwner(repository), ...detail });
      return true;
    }

    const query = url.searchParams.get("q") ?? "";
    const branch = branchParam(url);
    const found = await orgStore.searchRepositoryCode(repository.id, { branch, query });
    if (!found) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    sendJson(response, 200, {
      repository: await withOwner(repository),
      branch: found.branch,
      defaultBranch: found.defaultBranch,
      query,
      matches: found.matches,
    });
    return true;
  };
}
