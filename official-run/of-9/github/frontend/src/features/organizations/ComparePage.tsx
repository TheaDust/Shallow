import { useEffect, useState, type FormEvent } from "react";

import { ApiError } from "../../lib/api";
import { navigate, useHashLocation } from "../../lib/hash-route";
import {
  getCompareDiff,
  getRepositoryBranches,
  getRepositoryCommits,
  type CommitRecord,
  type RepositoryDiff,
} from "./api";
import { AccessDenied } from "./AccessDenied";
import { DiffView } from "./DiffView";
import { RepoPageHeader } from "./RepoPageHeader";

interface RevisionOption {
  value: string;
  label: string;
}

function buildOptions(branches: string[], commits: CommitRecord[]): RevisionOption[] {
  const branchOptions = branches.map((branch) => ({ value: branch, label: branch }));
  const commitOptions = commits.map((commit) => ({
    value: commit.id,
    label: `${commit.shortId} · ${commit.message}`,
  }));
  return [...branchOptions, ...commitOptions];
}

export function ComparePage({ owner, name }: { owner: string; name: string }) {
  const location = useHashLocation();
  const baseParam = location.search.get("base") ?? "";
  const compareParam = location.search.get("compare") ?? "";
  const pathParam = location.search.get("path") ?? "";
  const [branches, setBranches] = useState<string[]>([]);
  const [commits, setCommits] = useState<CommitRecord[]>([]);
  const [base, setBase] = useState(baseParam);
  const [compare, setCompare] = useState(compareParam);
  const [diff, setDiff] = useState<RepositoryDiff | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "denied" | "missing" | "ready">("loading");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getRepositoryBranches(owner, name), getRepositoryCommits(owner, name, {})])
      .then(([branchList, history]) => {
        if (cancelled) return;
        setBranches(branchList);
        setCommits(history.commits);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setState("denied");
        else setState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name]);

  useEffect(() => {
    let cancelled = false;
    if (!baseParam || !compareParam) {
      setDiff(null);
      setFailed(false);
      return;
    }
    getCompareDiff(owner, name, baseParam, compareParam, pathParam || undefined)
      .then((result) => {
        if (cancelled) return;
        setDiff(result);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setState("denied");
        else if (error instanceof ApiError && error.status === 404) setFailed(true);
        else setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name, baseParam, compareParam, pathParam]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!base || !compare) return;
    navigate(`/repos/${owner}/${name}/compare`, new URLSearchParams({ base, compare }));
  };

  if (state === "denied") return <AccessDenied />;
  if (state === "missing") {
    return (
      <section className="compare-page">
        <RepoPageHeader owner={owner} name={name} />
        <p className="compare-page__empty">Not found</p>
      </section>
    );
  }
  if (state === "loading") {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }

  const options = buildOptions(branches, commits);

  return (
    <section className="compare-page">
      <RepoPageHeader owner={owner} name={name} />
      <form className="compare-form" onSubmit={submit}>
        <div className="ui-field">
          <label htmlFor="compare-base">Base</label>
          <select id="compare-base" value={base} onChange={(event) => setBase(event.target.value)}>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label htmlFor="compare-compare">Compare</label>
          <select
            id="compare-compare"
            value={compare}
            onChange={(event) => setCompare(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="ui-button ui-button--primary compare-form__submit">
          Compare
        </button>
      </form>
      {failed ? (
        <p role="alert" className="compare-page__empty">
          Not found
        </p>
      ) : null}
      {diff ? (
        <DiffView
          repository={diff.repository}
          base={diff.base}
          compare={diff.compare}
          files={diff.files}
          totalAdditions={diff.totalAdditions}
          totalDeletions={diff.totalDeletions}
          hrefFor={(filePath) =>
            `#/repos/${owner}/${name}/compare?base=${encodeURIComponent(baseParam)}&compare=${encodeURIComponent(compareParam)}&path=${encodeURIComponent(filePath)}`
          }
          showAll={!pathParam}
        />
      ) : null}
    </section>
  );
}
