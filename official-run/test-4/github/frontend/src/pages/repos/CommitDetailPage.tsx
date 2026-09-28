import { useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import { formatRelativeTime } from "../../lib/org-api";
import {
  CommitDetail,
  fetchCommitDetail,
  RepoOwnerType,
  repoOwnerBase,
} from "../../lib/repo-api";
import { DiffView } from "./DiffView";
import { RepoPageChrome } from "./RepoPageChrome";
import { useSession } from "../../session";

interface CommitDetailPageProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  commitId: string;
}

type DetailStatus = "loading" | "ready" | "denied" | "notfound";

/**
 * Commit detail page: the full message, author, time, short hash, the parent
 * revision link, the “Changed files” summary with exact changed-file paths
 * and numeric additions/deletions, and the line-by-line diff of the commit
 * against its parent. Opening the commit entry directly works without prior
 * navigation through history.
 */
export function CommitDetailPage({ ownerType, ownerName, repoName, commitId }: CommitDetailPageProps) {
  const { status: sessionStatus } = useSession();
  const [status, setStatus] = useState<DetailStatus>("loading");
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const base = `${repoOwnerBase(ownerType, ownerName)}/repos/${encodeURIComponent(repoName)}`;

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetchCommitDetail(ownerType, ownerName, repoName, commitId)
      .then((body) => {
        if (cancelled) return;
        setDetail(body);
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
  }, [ownerType, ownerName, repoName, commitId]);

  if (status === "denied") {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName}>
        <p>Access denied</p>
        {sessionStatus !== "authenticated" && (
          <p>
            <a href="#/signin">Sign in</a>
          </p>
        )}
      </RepoPageChrome>
    );
  }

  if (status === "notfound") {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName}>
        <p>Commit not found.</p>
      </RepoPageChrome>
    );
  }

  if (status !== "ready" || !detail) {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName}>
        <p>Loading…</p>
      </RepoPageChrome>
    );
  }

  const totals = detail.files.reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );

  return (
    <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName}>
      <h2 className="commit-detail__title">{detail.commit.message}</h2>
      <p className="commit-detail__meta">
        {detail.commit.authorName} committed {formatRelativeTime(detail.commit.createdAt)}
      </p>
      <p className="commit-detail__hash">Commit {detail.commit.shortId}</p>
      <p className="commit-detail__parent">
        {detail.base ? (
          <>
            Parent:{" "}
            <a href={`#${base}/commit/${encodeURIComponent(detail.base.id)}`}>
              {detail.base.shortId}
            </a>
          </>
        ) : (
          <>Parent: none (initial commit)</>
        )}
      </p>
      <section aria-label="Commit changes">
        <h3>Changed files</h3>
        <p className="commit-detail__summary">
          {detail.files.length} changed file{detail.files.length === 1 ? "" : "s"} · +
          {totals.additions} −{totals.deletions}
        </p>
        <ul className="commit-detail__files">
          {detail.files.map((file) => (
            <li key={file.path} className="commit-detail__file">
              {detail.base ? (
                <a
                  href={`#${base}/compare?base=${encodeURIComponent(detail.base.id)}&compare=${encodeURIComponent(detail.commit.id)}&path=${encodeURIComponent(file.path)}`}
                >
                  {file.path}
                </a>
              ) : (
                <span>{file.path}</span>
              )}
              <span className="commit-detail__counts">
                +{file.additions} −{file.deletions}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <DiffView files={detail.files} />
    </RepoPageChrome>
  );
}
