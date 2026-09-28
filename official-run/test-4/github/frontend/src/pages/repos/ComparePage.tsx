import { useEffect, useMemo, useState } from "react";

import { ApiError } from "../../lib/api";
import { navigate } from "../../lib/hash-route";
import {
  CommitSummary,
  CompareResult,
  fetchCommitHistory,
  fetchCompare,
  RepoOwnerType,
  repoOwnerBase,
} from "../../lib/repo-api";
import { DiffView } from "./DiffView";
import { RepoPageChrome } from "./RepoPageChrome";

interface ComparePageProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  base?: string;
  compare?: string;
  path?: string;
}

type CompareStatus = "loading" | "ready" | "denied" | "notfound";

/**
 * Revision comparison page: the user selects a base and a compare revision
 * from the repository's commits and activates “Compare”; the page then shows
 * the base and compare identifiers, the changed files, and the line-by-line
 * additions and deletions. A `path` scope limits the view to one file's diff.
 */
export function ComparePage({ ownerType, ownerName, repoName, base, compare, path }: ComparePageProps) {
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [optionsStatus, setOptionsStatus] = useState<CompareStatus>("loading");
  const [resultStatus, setResultStatus] = useState<CompareStatus>("loading");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [baseValue, setBaseValue] = useState(base ?? "");
  const [compareValue, setCompareValue] = useState(compare ?? "");
  const repoBase = `${repoOwnerBase(ownerType, ownerName)}/repos/${encodeURIComponent(repoName)}`;

  useEffect(() => {
    let cancelled = false;
    fetchCommitHistory(ownerType, ownerName, repoName)
      .then((body) => {
        if (cancelled) return;
        setCommits(body.commits);
        setOptionsStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) {
          setOptionsStatus("denied");
        } else {
          setOptionsStatus("notfound");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ownerType, ownerName, repoName]);

  useEffect(() => {
    if (!base || !compare) return;
    let cancelled = false;
    setResultStatus("loading");
    fetchCompare(ownerType, ownerName, repoName, base, compare, path)
      .then((body) => {
        if (cancelled) return;
        setResult(body);
        setResultStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResultStatus("notfound");
      });
    return () => {
      cancelled = true;
    };
  }, [ownerType, ownerName, repoName, base, compare, path]);

  const defaults = useMemo(() => {
    if (commits.length === 0) return { base: "", compare: "" };
    const newest = commits[0];
    const oldest = commits[commits.length - 1];
    return { base: baseValue || oldest.id, compare: compareValue || newest.id };
  }, [commits, baseValue, compareValue]);

  const selectedBase = baseValue || defaults.base;
  const selectedCompare = compareValue || defaults.compare;

  function submit() {
    const params = new URLSearchParams({
      base: selectedBase,
      compare: selectedCompare,
    });
    if (path) params.set("path", path);
    navigate(`${repoBase}/compare?${params.toString()}`, undefined);
  }

  const hasSelection = Boolean(base && compare && resultStatus === "ready");

  return (
    <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName}>
      <h2>Compare revisions</h2>
      {optionsStatus === "loading" && <p>Loading…</p>}
      {optionsStatus === "denied" && <p>Access denied</p>}
      {optionsStatus === "notfound" && <p>Repository not found.</p>}
      {optionsStatus === "ready" && commits.length === 0 && <p>No commits to compare.</p>}
      {optionsStatus === "ready" && commits.length > 0 && (
        <>
          <div className="compare-form">
            <label>
              Base
              <select
                className="compare-form__select"
                value={selectedBase}
                onChange={(event) => setBaseValue(event.target.value)}
              >
                {commits.map((commit) => (
                  <option key={commit.id} value={commit.id}>
                    {commit.shortId} {commit.message}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Compare
              <select
                className="compare-form__select"
                value={selectedCompare}
                onChange={(event) => setCompareValue(event.target.value)}
              >
                {commits.map((commit) => (
                  <option key={commit.id} value={commit.id}>
                    {commit.shortId} {commit.message}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="button" onClick={submit}>
              Compare
            </button>
          </div>
          {hasSelection && result && (
            <section aria-label="Comparison">
              <h3>Comparing {result.base.shortId} … {result.compare.shortId}</h3>
              {path ? (
                <p>
                  <a href={`#${repoBase}/compare?base=${encodeURIComponent(result.base.id)}&compare=${encodeURIComponent(result.compare.id)}`}>
                    All changes
                  </a>
                </p>
              ) : (
                <ul className="commit-detail__files">
                  {result.files.map((file) => (
                    <li key={file.path} className="commit-detail__file">
                      <a
                        href={`#${repoBase}/compare?base=${encodeURIComponent(result.base.id)}&compare=${encodeURIComponent(result.compare.id)}&path=${encodeURIComponent(file.path)}`}
                      >
                        {file.path}
                      </a>
                      <span className="commit-detail__counts">
                        +{file.additions} −{file.deletions}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <DiffView files={result.files} />
            </section>
          )}
        </>
      )}
    </RepoPageChrome>
  );
}
