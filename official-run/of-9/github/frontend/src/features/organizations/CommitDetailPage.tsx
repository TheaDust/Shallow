import { useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import { formatUpdatedTime } from "../../lib/format";
import { useHashLocation } from "../../lib/hash-route";
import { getCommitDiff, type CommitRecord, type RepositoryDiff } from "./api";
import { AccessDenied } from "./AccessDenied";
import { DiffView } from "./DiffView";
import { RepoPageHeader } from "./RepoPageHeader";

interface CommitDetailData {
  base: string;
  compare: string;
  commit: CommitRecord | null;
  parent: CommitRecord | null;
  diff: RepositoryDiff;
}

export function CommitDetailPage({
  owner,
  name,
  commitId,
}: {
  owner: string;
  name: string;
  commitId: string;
}) {
  const location = useHashLocation();
  const path = location.search.get("path") ?? "";
  const [data, setData] = useState<CommitDetailData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "denied" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    getCommitDiff(owner, name, commitId, path || undefined)
      .then((response) => {
        if (cancelled) return;
        setData({
          base: response.base,
          compare: response.compare,
          commit: response.commit,
          parent: response.parent,
          diff: response,
        });
        setState("ok");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setState("denied");
        else setState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name, commitId, path]);

  if (state === "denied") return <AccessDenied />;
  if (state === "missing") {
    return (
      <section className="commit-detail">
        <RepoPageHeader owner={owner} name={name} />
        <p className="commit-detail__empty">Commit not found</p>
      </section>
    );
  }
  if (state === "loading" || !data) {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }

  const { diff, commit } = data;
  const commitShortId = diff.compare;
  return (
    <section className="commit-detail">
      <RepoPageHeader owner={owner} name={name} context={`Commit ${commitShortId}`} />
      <div className="commit-detail__info">
        {commit ? (
          <>
            <p className="commit-detail__hash">{commitShortId}</p>
            <p className="commit-detail__message">{commit.message}</p>
            <p className="commit-detail__meta">
              {commit.author} committed {formatUpdatedTime(commit.createdAt)}
            </p>
          </>
        ) : null}
        <p className="commit-detail__meta">
          Parent: <span className="commit-detail__parent">{diff.base}</span>
        </p>
        <a
          className="commit-detail__history-link"
          href={`#/repos/${owner}/${name}/commits`}
        >
          Commits
        </a>
      </div>
      <DiffView
        repository={diff.repository}
        base={diff.base}
        compare={diff.compare}
        files={diff.files}
        totalAdditions={diff.totalAdditions}
        totalDeletions={diff.totalDeletions}
        hrefFor={(filePath) =>
          `#/repos/${owner}/${name}/commit/${encodeURIComponent(commitId)}?path=${encodeURIComponent(filePath)}`
        }
        showAll={!path}
      />
    </section>
  );
}
