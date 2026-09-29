import { useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import { formatUpdatedTime } from "../../lib/format";
import { useHashLocation } from "../../lib/hash-route";
import { getRepositoryCommits, type CommitRecord } from "./api";
import { AccessDenied } from "./AccessDenied";
import { RepoPageHeader } from "./RepoPageHeader";

interface HistoryData {
  branch: string;
  path: string;
  commits: CommitRecord[];
}

export function CommitHistoryPage({ owner, name }: { owner: string; name: string }) {
  const location = useHashLocation();
  const branch = location.search.get("branch") ?? undefined;
  const path = location.search.get("path") ?? "";
  const [data, setData] = useState<HistoryData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "denied" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    getRepositoryCommits(owner, name, { branch, path })
      .then((result) => {
        if (cancelled) return;
        setData(result);
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
  }, [owner, name, branch, path]);

  if (state === "denied") return <AccessDenied />;
  if (state === "missing") {
    return (
      <section className="commit-history">
        <RepoPageHeader owner={owner} name={name} />
        <p className="commit-history__empty">Not found</p>
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

  return (
    <section className="commit-history">
      <RepoPageHeader owner={owner} name={name} branch={data.branch} />
      {data.path ? (
        <p className="commit-history__scope">
          History for{" "}
          <a
            href={`#/repos/${owner}/${name}/blob?branch=${encodeURIComponent(data.branch)}&path=${encodeURIComponent(data.path)}`}
          >
            {data.path}
          </a>
        </p>
      ) : (
        <p className="commit-history__scope">History for branch {data.branch}</p>
      )}
      {data.commits.length === 0 ? (
        <p className="commit-history__empty">No commits.</p>
      ) : (
        <ul className="commit-list">
          {data.commits.map((commit) => (
            <li key={commit.id} className="commit-list__item">
              <a
                className="commit-list__hash"
                href={`#/repos/${owner}/${name}/commit/${encodeURIComponent(commit.id)}`}
              >
                {commit.shortId}
              </a>
              <div className="commit-list__body">
                <a
                  className="commit-list__message"
                  href={`#/repos/${owner}/${name}/commit/${encodeURIComponent(commit.id)}`}
                >
                  {commit.message}
                </a>
                <p className="commit-list__meta">
                  {commit.author} committed {formatUpdatedTime(commit.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
