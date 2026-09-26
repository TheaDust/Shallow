import { useEffect, useState } from 'react';
import { apiRepositoryCommits } from '../api';
import { formatRelativeTime } from '../format';
import type { RepositoryBranchInfo, RepositoryCommit } from '../types';

interface CommitsPageProps {
  owner: string;
  name: string;
  /** Empty means the repository's default branch. */
  branch?: string;
  /** Empty means the full branch history; a path scopes it to that file. */
  path?: string;
}

/**
 * REQ-3-2-1/REQ-4-2-1: commit-history page of a repository. Displays the
 * commit records of a branch (default branch unless an explicit branch is
 * given) or of a single file path on that branch, newest first. Each item
 * shows the short hash, commit message, author, and a relative timestamp
 * ("ago"); the message and hash link to the commit detail page. Reloading
 * keeps the same scope and order because they are read from the persisted
 * server state via the URL.
 */
export default function CommitsPage({ owner, name, branch = '', path = '' }: CommitsPageProps) {
  const [branchInfo, setBranchInfo] = useState<RepositoryBranchInfo | null>(null);
  const [commits, setCommits] = useState<RepositoryCommit[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBranchInfo(null);
    setCommits(null);
    setNotFound(false);
    setLoadError(false);
    apiRepositoryCommits(owner, name, branch || undefined, path || undefined).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setBranchInfo(result.branch);
        setCommits(result.commits);
      } else if (result.status === 403 || result.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name, branch, path]);

  const repoBase = `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const displayBranch = branchInfo ? branchInfo.name : branch;

  if (notFound) {
    return (
      <div className="repository-page">
        <h1>Commits</h1>
        <p className="muted-text">
          The repository “{owner}/{name}” does not exist or is not accessible.
        </p>
      </div>
    );
  }

  return (
    <div className="repository-page commits-page">
      <h1>Commits</h1>
      <div className="commits-page-header">
        <p className="muted-text">
          <a className="repository-back-link" href={repoBase}>
            {owner}/{name}
          </a>
          {displayBranch ? (
            <>
              <span aria-hidden="true"> · </span>
              <span>{displayBranch}</span>
            </>
          ) : null}
          {path ? (
            <>
              <span aria-hidden="true"> · </span>
              <span>{path}</span>
            </>
          ) : null}
        </p>
        {/* REQ-4-2-2: entry to the comparison page (select base/compare). */}
        <a className="compare-link" href={`${repoBase}/compare`}>
          Compare
        </a>
      </div>
      {loadError ? (
        <p role="alert" className="form-error">
          The commit history could not be loaded.
        </p>
      ) : commits === null ? (
        <p className="loading">Loading…</p>
      ) : commits.length === 0 ? (
        <p className="muted-text">No commits yet.</p>
      ) : (
        <ul className="commit-list">
          {commits.map((commit) => {
            const shortId = commit.shortId ?? commit.id.slice(0, 7);
            const detailHref = `${repoBase}/commit/${encodeURIComponent(commit.id)}`;
            return (
              <li key={commit.id} className="commit-list-item">
                <a className="commit-hash-link" href={detailHref}>
                  {shortId}
                </a>
                <div className="commit-list-body">
                  <a className="commit-message-link" href={detailHref}>
                    {commit.message}
                  </a>
                  <span className="commit-meta">
                    {commit.author ?? 'Unknown'}
                    {formatRelativeTime(commit.createdAt)
                      ? ` · ${formatRelativeTime(commit.createdAt)}`
                      : ''}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
