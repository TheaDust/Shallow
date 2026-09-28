import { canReadRepository, effectiveRepositoryRole } from "../domain/organizations.mjs";
import { changeDefaultBranch, describeRepository } from "../domain/repos.mjs";
import {
  allCommits,
  branchCommitList,
  commitDiff,
  compareDiff,
  createBranch,
  createFileCommit,
  findBranch,
  searchCode,
} from "../domain/vcs.mjs";
import { readJson, sendJson } from "../lib/http.mjs";

/**
 * REQ-4 code and version-control routes shared by personal and organization
 * repositories: branch commit history and detail, revision comparison,
 * file commits (Edit / Add file), repository code search (REQ-4-2-3), and
 * branch creation (REQ-4-3-2). Every route resolves the repository through
 * `deps.resolveRepository`, enforces repository-read (or write, for writes)
 * permission against the current session, and returns true when the path
 * belongs to this module.
 */
export async function handleCodeRoutes({
  request,
  response,
  url,
  path,
  state,
  store,
  account,
  resolveRepository,
}) {
  const commitDetailRoute = path.match(/^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/commits\/([^/]+)$/);
  if (commitDetailRoute && request.method === "GET") {
    const repository = resolveRepository(
      state,
      commitDetailRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(commitDetailRoute[2]),
      decodeURIComponent(commitDetailRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!canReadRepository(state, account?.id, repository)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    const detail = commitDiff(state, repository, decodeURIComponent(commitDetailRoute[4]));
    if (!detail) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    sendJson(response, 200, detail);
    return true;
  }

  const vcsRoute = path.match(/^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/(commits|compare|files)$/);
  if (vcsRoute) {
    const ownerType = vcsRoute[1] === "users" ? "account" : "organization";
    const repository = resolveRepository(
      state,
      ownerType,
      decodeURIComponent(vcsRoute[2]),
      decodeURIComponent(vcsRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!canReadRepository(state, account?.id, repository)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    const action = vcsRoute[4];
    if (request.method === "GET" && action === "commits") {
      const branch = url.searchParams.get("branch") ?? null;
      if (branch && !findBranch(repository, branch)) {
        sendJson(response, 404, { error: "Branch not found" });
        return true;
      }
      const pathFilter = url.searchParams.get("path") ?? null;
      const commits = branch ? branchCommitList(repository, branch, pathFilter) : allCommits(repository);
      sendJson(response, 200, { commits, branch: branch ?? repository.defaultBranch });
      return true;
    }
    if (request.method === "GET" && action === "compare") {
      const base = url.searchParams.get("base");
      const compare = url.searchParams.get("compare");
      if (!base || !compare) {
        sendJson(response, 400, { error: "Base and compare revisions are required" });
        return true;
      }
      const result = compareDiff(
        state,
        repository,
        base,
        compare,
        url.searchParams.get("path") ?? null,
      );
      if (!result) {
        sendJson(response, 404, { error: "Revision not found" });
        return true;
      }
      sendJson(response, 200, result);
      return true;
    }
    if (request.method === "POST" && action === "files") {
      if (!account) {
        sendJson(response, 401, { error: "Unauthenticated" });
        return true;
      }
      const body = await readJson(request);
      const repositoryId = repository.id;
      let outcome;
      await store.update((draft) => {
        const draftRepository = draft.repositories.find((candidate) => candidate.id === repositoryId);
        outcome = createFileCommit(draft, draftRepository, {
          accountId: account.id,
          authorName: account.username,
          ...body,
        });
      });
      if (!outcome.ok) {
        if (outcome.forbidden) {
          sendJson(response, 403, { error: "Access denied" });
        } else {
          sendJson(response, 400, { errors: outcome.errors });
        }
        return true;
      }
      const freshState = await store.read();
      const freshRepository = freshState.repositories.find((candidate) => candidate.id === repositoryId);
      sendJson(response, 201, {
        repository: describeRepository(
          freshState,
          freshRepository,
          account.id,
          typeof body.branch === "string" ? body.branch : null,
        ),
      });
      return true;
    }
    return false;
  }

  const codeSearchRoute = path.match(/^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/search$/);
  if (codeSearchRoute && request.method === "GET") {
    const repository = resolveRepository(
      state,
      codeSearchRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(codeSearchRoute[2]),
      decodeURIComponent(codeSearchRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (!canReadRepository(state, account?.id, repository)) {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    const branch = url.searchParams.get("branch") ?? repository.defaultBranch;
    if (!findBranch(repository, branch)) {
      sendJson(response, 404, { error: "Branch not found" });
      return true;
    }
    const result = searchCode(repository, branch, url.searchParams.get("q") ?? "", {
      path: url.searchParams.get("path") ?? null,
      language: url.searchParams.get("language") ?? null,
    });
    sendJson(response, 200, { query: url.searchParams.get("q") ?? "", ...result });
    return true;
  }

  const defaultBranchRoute = path.match(/^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/default-branch$/);
  if (defaultBranchRoute && request.method === "PATCH") {
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const repository = resolveRepository(
      state,
      defaultBranchRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(defaultBranchRoute[2]),
      decodeURIComponent(defaultBranchRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    if (effectiveRepositoryRole(state, account.id, repository) !== "admin") {
      sendJson(response, 403, { error: "Access denied" });
      return true;
    }
    const body = await readJson(request);
    const repositoryId = repository.id;
    let outcome;
    await store.update((draft) => {
      const draftRepository = draft.repositories.find((candidate) => candidate.id === repositoryId);
      outcome = changeDefaultBranch(draft, draftRepository, {
        accountId: account.id,
        branch: body.branch,
      });
    });
    if (!outcome.ok) {
      if (outcome.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
      } else {
        sendJson(response, 400, { errors: outcome.errors });
      }
      return true;
    }
    const freshState = await store.read();
    const freshRepository = freshState.repositories.find((candidate) => candidate.id === repositoryId);
    sendJson(response, 200, {
      repository: describeRepository(freshState, freshRepository, account.id),
    });
    return true;
  }

  const branchCreateRoute = path.match(/^\/api\/(users|orgs)\/([^/]+)\/repos\/([^/]+)\/branches$/);
  if (branchCreateRoute && request.method === "POST") {
    if (!account) {
      sendJson(response, 401, { error: "Unauthenticated" });
      return true;
    }
    const repository = resolveRepository(
      state,
      branchCreateRoute[1] === "users" ? "account" : "organization",
      decodeURIComponent(branchCreateRoute[2]),
      decodeURIComponent(branchCreateRoute[3]),
    );
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    const body = await readJson(request);
    const repositoryId = repository.id;
    let outcome;
    await store.update((draft) => {
      const draftRepository = draft.repositories.find((candidate) => candidate.id === repositoryId);
      outcome = createBranch(draft, draftRepository, {
        accountId: account.id,
        name: body.name,
        baseBranch: body.baseBranch,
      });
    });
    if (!outcome.ok) {
      if (outcome.forbidden) {
        sendJson(response, 403, { error: "Access denied" });
      } else {
        sendJson(response, 400, { errors: outcome.errors });
      }
      return true;
    }
    const freshState = await store.read();
    const freshRepository = freshState.repositories.find((candidate) => candidate.id === repositoryId);
    sendJson(response, 201, {
      repository: describeRepository(freshState, freshRepository, account.id, outcome.branch.name),
    });
    return true;
  }

  return false;
}
