import { useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import { formatRelativeTime } from "../../lib/org-api";
import {
  CommitSummary,
  fetchCommitHistory,
  RepoOwnerType,
  repoOwnerBase,
} from "../../lib/repo-api";
import { RepoPageChrome } from "./RepoPageChrome";

interface CommitHistoryPageProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  branch?: string;
  path?: string;
}

type HistoryStatus = "loading" | "ready" | "denied" | "notfound";

/**
 * Commit history for a branch (or, when `path` is given, only the commits
 * that modified that file). Records are newest first; each item shows the
 * short hash, the full commit message, the author, and a relative timestamp
 * containing “ago”. The short hash opens the commit's detail page.
 */
export function CommitHistoryPage({ ownerType, ownerName, repoName, branch, path }: CommitHistoryPageProps) {
  const [status, setStatus] = useState<HistoryStatus>("loading");
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [activeBranch, setActiveBranch] = useState(branch ?? "");
  const base = `${repoOwnerBase(ownerType, ownerName)}/repos/${encodeURIComponent(repoName)}`;

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetchCommitHistory(ownerType, ownerName, repoName, branch, path)
      .then((body) => {
        if (cancelled) return;
        setCommits(body.commits);
        setActiveBranch(body.branch);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) {
          setStatus("denied");
        } else {
          setStatus("notfound");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ownerType, ownerName, repoName, branch, path]);

  if (status === "denied") {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName}>
        <p>Access denied</p>
      </RepoPageChrome>
    );
  }

  if (status === "notfound") {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName}>
        <p>Repository not found.</p>
      </RepoPageChrome>
    );
  }

  return (
    <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName}>
      <h2>{path ? `Commits for ${path}` : `Commits on ${activeBranch}`}</h2>
      <p className="repo-history__branch">
        {path ? `${activeBranch} branch history for this file` : "Branch history"}
      </p>
      <p>
        <a className="repo-history__compare" href={`#${base}/compare`}>
          Compare revisions
        </a>
      </p>
      {status === "loading" ? (
        <p>Loading…</p>
      ) : (
        <ul className="repo-history__list">
          {commits.map((commit) => (
            <li key={commit.id} className="repo-history__item">
              <a
                className="repo-history__hash"
                href={`#${base}/commit/${encodeURIComponent(commit.id)}`}
              >
                {commit.shortId}
              </a>
              <div className="repo-history__body">
                <h3 className="repo-history__message">{commit.message}</h3>
                <p className="repo-history__meta">
                  {commit.authorName} committed {formatRelativeTime(commit.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </RepoPageChrome>
  );
}
