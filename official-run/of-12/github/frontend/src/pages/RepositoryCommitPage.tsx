import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { useHashLocation } from "../lib/hash-route";
import { CommitDiffView } from "../features/repositories/CommitDiffView";
import { RepositoryHeader } from "../features/repositories/RepositoryHeader";
import { RepositoryLoadState } from "../features/repositories/RepositoryFallbacks";
import { formatCommitTime, shortCommitId } from "../features/repositories/format-commit";
import {
  commitFileHref,
  commitHref,
  compareHref,
} from "../features/repositories/repository-links";
import {
  fetchRepositoryCommit,
  type RepositoryComparison,
  type RepositoryCommit,
} from "../features/repositories/repository-api";
import { useRepositoryOverview } from "../features/repositories/use-repository";

export interface RepositoryCommitPageProps {
  owner: string;
  name: string;
  commitId: string;
}

type CommitState = "loading" | "ready" | "missing" | "denied" | "failed";

function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

/**
 * One commit entry and its comparison with the revision it was created from
 * (REQ-4-2-2).
 *
 * The page reads the stored commit, its parent revision and the changed files
 * line by line, so opening a commit entry directly — from history, from the
 * last commit of a file page or from its address — never requires walking
 * through history first. It creates no review, comment or commit.
 */
export function RepositoryCommitPage({ owner, name, commitId }: RepositoryCommitPageProps) {
  const { search } = useHashLocation();
  const { state: repositoryState, repository } = useRepositoryOverview(owner, name);
  const [state, setState] = useState<CommitState>("loading");
  const [comparison, setComparison] = useState<RepositoryComparison | null>(null);
  const [commit, setCommit] = useState<RepositoryCommit | null>(null);
  const selectedFile = search.get("file") ?? "";

  useEffect(() => {
    let active = true;
    setState("loading");
    setComparison(null);
    setCommit(null);
    fetchRepositoryCommit(owner, name, commitId)
      .then((result) => {
        if (!active) return;
        setComparison(result);
        setCommit(result.commit);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) setState("denied");
        else if (error instanceof ApiError && error.status === 404) setState("missing");
        else setState("failed");
      });
    return () => {
      active = false;
    };
  }, [owner, name, commitId]);

  if (!repository || repositoryState !== "ready") return <RepositoryLoadState state={repositoryState} />;

  if (state !== "ready" || !commit || !comparison) {
    return (
      <main className="repository-commit-page">
        <RepositoryHeader repository={repository} cloneUrls={repository.cloneUrls} active="commits" branch={repository.defaultBranch} />
        {state === "missing" ? <p role="alert">This commit does not exist in this repository.</p> : null}
        {state === "denied" ? <p role="alert">Access denied. This commit is not readable.</p> : null}
        {state === "failed" ? <p role="alert">The commit could not be loaded. Please try again.</p> : null}
        {state === "loading" ? <p role="status">Loading commit…</p> : null}
      </main>
    );
  }

  const parent = comparison.base.commit ?? null;
  const shown = selectedFile
    ? comparison.files.filter((file) => file.path === selectedFile)
    : comparison.files;

  return (
    <main className="repository-commit-page">
      <RepositoryHeader
        repository={repository}
        cloneUrls={repository.cloneUrls}
        active="commits"
        branch={comparison.compare.branch ?? commit.branch ?? repository.defaultBranch}
      />
      <h2 className="repository-commit__message">{commit.message}</h2>
      <p className="repository-commit__identity">
        <span className="repository-commit__hash">{shortCommitId(commit.id)}</span>
        <span className="repository-commit__author">{commit.author}</span>
        <span className="repository-commit__time">{formatCommitTime(commit.createdAt)}</span>
      </p>
      <dl className="repository-commit__revisions">
        <dt>Base</dt>
        <dd className="repository-commit__base">
          {parent ? (
            <a href={commitHref(repository, parent.id)}>{`${shortCommitId(parent.id)} ${parent.message}`}</a>
          ) : (
            "No parent revision"
          )}
        </dd>
        <dt>Compare</dt>
        <dd className="repository-commit__compare">{`${shortCommitId(commit.id)} ${commit.message}`}</dd>
      </dl>
      <p className="repository-commit__compare-link">
        <a href={compareHref(repository, parent ? parent.id : null, commit.id)}>Compare</a>
      </p>
      <h3 className="repository-commit__changed-files-heading">Changed files</h3>
      <p className="repository-commit__summary">
        {`${count(comparison.summary.filesChanged, "file")} changed with ${count(comparison.summary.additions, "addition")} and ${count(comparison.summary.deletions, "deletion")}`}
      </p>
      {comparison.files.length === 0 ? (
        <p className="repository-commit__empty">This commit did not change any file.</p>
      ) : (
        <ul className="repository-commit__files">
          {comparison.files.map((file) => (
            <li key={file.path} className="repository-commit__file">
              <a
                className="repository-commit__file-link"
                href={commitFileHref(repository, commit.id, file.path)}
                aria-current={selectedFile === file.path ? "true" : undefined}
              >
                {file.path}
              </a>
              <span className="repository-commit__file-counts">{`+${file.additions}`}</span>
              <span className="repository-commit__file-counts">{`-${file.deletions}`}</span>
            </li>
          ))}
        </ul>
      )}
      {shown.map((file) => (
        <CommitDiffView key={file.path} file={file} />
      ))}
      {selectedFile && shown.length === 0 ? (
        <p role="alert">{`This commit did not change ${selectedFile}.`}</p>
      ) : null}
    </main>
  );
}
