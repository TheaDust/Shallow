import { useEffect, useState } from "react";

import { navigate, useHashLocation } from "../lib/hash-route";
import { RepositoryHeader } from "../features/repositories/RepositoryHeader";
import { BranchSelector } from "../features/repositories/BranchSelector";
import { RepositoryLoadState } from "../features/repositories/RepositoryFallbacks";
import { formatCommitTime, shortCommitId } from "../features/repositories/format-commit";
import {
  commitHref,
  compareHref,
} from "../features/repositories/repository-links";
import {
  fetchRepositoryCommits,
  type RepositoryHistory,
} from "../features/repositories/repository-api";
import { useRepositoryOverview } from "../features/repositories/use-repository";

export interface RepositoryCommitsPageProps {
  owner: string;
  name: string;
}

/** The query of the commits address: the branch and the optional file scope. */
function historyParams(branch: string | undefined, path: string, defaultBranch?: string): URLSearchParams {
  const params = new URLSearchParams();
  if (branch && branch !== (defaultBranch ?? "main")) params.set("branch", branch);
  if (path) params.set("path", path);
  return params;
}

/**
 * Commit history (REQ-4-2-1).
 *
 * The page reads the history of the current branch newest first, or — after
 * selecting a scope — only the history of one file of that branch, so a commit
 * that did not modify the file is not listed. Every record spells the stored
 * commit identifier, author, time, message, parent commit and changed files,
 * and its short hash opens the commit entry itself. The view is read-only: it
 * never creates a commit, a file or a branch.
 */
export function RepositoryCommitsPage({ owner, name }: RepositoryCommitsPageProps) {
  const { search } = useHashLocation();
  const { state: repositoryState, repository } = useRepositoryOverview(owner, name);
  const requestedBranch = search.get("branch") ?? undefined;
  const branch = requestedBranch ?? repository?.defaultBranch ?? "main";
  const scopedPath = search.get("path") ?? "";
  const [history, setHistory] = useState<RepositoryHistory | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    if (repositoryState !== "ready" || !repository) return undefined;
    let active = true;
    setState("loading");
    fetchRepositoryCommits(owner, name, { branch: requestedBranch, path: scopedPath })
      .then((result) => {
        if (!active) return;
        setHistory(result);
        setState("ready");
      })
      .catch(() => {
        if (!active) return;
        setHistory(null);
        setState("failed");
      });
    return () => {
      active = false;
    };
  }, [owner, name, repository, repositoryState, requestedBranch, scopedPath]);

  if (!repository || repositoryState !== "ready") return <RepositoryLoadState state={repositoryState} />;

  const base = `/${repository.owner}/${repository.name}`;
  const commits = history?.commits ?? [];
  const scopeFiles = history?.files ?? [];

  function selectScope(nextPath: string) {
    navigate(`${base}/commits`, historyParams(requestedBranch, nextPath, repository?.defaultBranch));
  }

  return (
    <main className="repository-commits-page">
      <RepositoryHeader repository={repository} cloneUrls={repository.cloneUrls} active="commits" branch={branch} />
      <section className="repository-commits" aria-label="Commits">
        <h2>Commits</h2>
        <div className="repository-commits__toolbar">
          {repository.branches.length > 0 ? (
            <BranchSelector
              branch={branch}
              branches={repository.branches}
              onSelect={(next) => navigate(`${base}/commits`, historyParams(next, scopedPath, repository.defaultBranch))}
            />
          ) : null}
          <a className="repository-commits__compare" href={compareHref(repository)}>
            Compare
          </a>
          <form className="repository-commits__scope" aria-label="History scope">
            <label className="repository-commits__scope-label" htmlFor="history-scope-path">
              Path
            </label>
            <select
              id="history-scope-path"
              className="repository-commits__scope-select"
              value={scopedPath}
              onChange={(event) => selectScope(event.target.value)}
            >
              <option value="">All files</option>
              {scopeFiles.map((file) => (
                <option key={file} value={file}>
                  {file}
                </option>
              ))}
            </select>
          </form>
        </div>
        <p className="repository-commits__branch">
          {scopedPath ? `Commits on ${history?.branch ?? branch} for ${scopedPath}` : `Commits on ${history?.branch ?? branch}`}
        </p>

        {state === "loading" ? <p role="status">Loading commits…</p> : null}
        {state === "failed" ? (
          <p role="alert">The commit history could not be loaded. Please try again.</p>
        ) : null}
        {state === "ready" && commits.length === 0 ? (
          <p className="repository-commits__empty">
            {scopedPath ? "No commits modified this path on this branch." : "This branch has no commits yet."}
          </p>
        ) : null}

        {commits.length > 0 ? (
          <ul className="repository-commits__list">
            {commits.map((commit) => (
              <li key={commit.id} className="repository-commits__item" aria-label={shortCommitId(commit.id)}>
                <p className="repository-commits__heading">
                  <a className="repository-commits__hash" href={commitHref(repository, commit.id)}>
                    {shortCommitId(commit.id)}
                  </a>
                  <a className="repository-commits__message" href={commitHref(repository, commit.id)}>
                    {commit.message}
                  </a>
                </p>
                <p className="repository-commits__meta">
                  <span className="repository-commits__author">{commit.author}</span>
                  <span className="repository-commits__time">{formatCommitTime(commit.createdAt)}</span>
                </p>
                <p className="repository-commits__parent">
                  {commit.parentId ? `Parent ${shortCommitId(commit.parentId)}` : "First commit"}
                </p>
                <p className="repository-commits__files">
                  {commit.files.length > 0
                    ? `Changed files: ${commit.files.map((file) => file.path).join(", ")}`
                    : "No changed files recorded"}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
