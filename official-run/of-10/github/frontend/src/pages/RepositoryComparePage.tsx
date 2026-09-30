import { useEffect, useState, type FormEvent } from "react";

import { AccessDeniedPage } from "./AccessDeniedPage";
import { NotFoundPage, repositoryAccessHint } from "./NotFoundPage";
import { navigate, useHashLocation } from "../lib/hash-route";
import { repositoryCompareHref, repositoryComparePath } from "../lib/repository-routes";
import {
  fetchRepositoryCommits,
  fetchRepositoryComparison,
  repositoryTitle,
  type RepositoryComparisonPayload,
  type RepositoryCommitsPayload,
} from "../lib/repositories-api";
import { ChangedFiles } from "../repository/ChangedFiles";
import { RepositoryChrome } from "../repository/RepositoryChrome";
import { useRepositoryResource } from "../repository/useRepositoryResource";
import { Button, FormField } from "../ui";

export interface RepositoryComparePageProps {
  owner: string;
  name: string;
}

/**
 * Comparison page (REQ-4-2-2). The base is the earlier revision and compare is
 * the newer one; choosing the parent commit as base and a commit as compare
 * shows exactly the changes of that commit. Reading a comparison never changes
 * branches, commits or files.
 */
export function RepositoryComparePage({ owner, name }: RepositoryComparePageProps) {
  const location = useHashLocation();
  const base = location.search.get("base") ?? "";
  const compare = location.search.get("compare") ?? "";
  const pathFilter = location.search.get("path") ?? "";
  const [baseInput, setBaseInput] = useState(base);
  const [compareInput, setCompareInput] = useState(compare);

  useEffect(() => {
    setBaseInput(base);
    setCompareInput(compare);
  }, [base, compare]);

  const revisions = useRepositoryResource<RepositoryCommitsPayload>(
    () => fetchRepositoryCommits(owner, name, ""),
    [owner, name],
  );
  const comparison = useRepositoryResource<RepositoryComparisonPayload | null>(
    () =>
      base && compare
        ? fetchRepositoryComparison(owner, name, base, compare)
        : Promise.resolve(null),
    [owner, name, base, compare],
  );

  if (revisions.status === "loading") {
    return (
      <main aria-busy="true">
        <p role="status">Loading revisions…</p>
      </main>
    );
  }
  if (revisions.status === "denied") return <AccessDeniedPage owner={owner} name={name} />;
  if (revisions.status === "missing") return <NotFoundPage hint={repositoryAccessHint()} />;
  if (revisions.status === "error") {
    return (
      <main>
        <h1>Comparison unavailable</h1>
        <p role="alert">The revisions could not be loaded. Reload the page to try again.</p>
      </main>
    );
  }

  const { repository, commits, branch } = revisions.value;
  const result = comparison.status === "ready" ? comparison.value : null;
  const visibleFiles = pathFilter
    ? (result?.changedFiles ?? []).filter((file) => file.path === pathFilter)
    : result?.changedFiles ?? [];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    const nextBase = baseInput.trim();
    const nextCompare = compareInput.trim();
    if (nextBase) params.set("base", nextBase);
    if (nextCompare) params.set("compare", nextCompare);
    navigate(repositoryComparePath(owner, name), params);
  };

  return (
    <main>
      <RepositoryChrome
        owner={owner}
        name={name}
        title={repositoryTitle(repository)}
        visibility={repository.visibility}
        description={repository.description}
        activeEntry="Code"
      />
      <h2 className="compare-heading">Compare changes</h2>
      <form className="compare-form" onSubmit={submit}>
        <FormField id="compare-base" label="Base">
          <select
            id="compare-base"
            value={baseInput}
            onChange={(event) => setBaseInput(event.target.value)}
          >
            <option value="">Choose a base revision</option>
            {commits.map((commit) => (
              <option key={commit.id} value={commit.id}>
                {commit.shortId ?? commit.id.slice(0, 7)} {commit.message}
              </option>
            ))}
            {(repository.branches ?? []).map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.name} (branch)
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="compare-compare" label="Compare">
          <select
            id="compare-compare"
            value={compareInput}
            onChange={(event) => setCompareInput(event.target.value)}
          >
            <option value="">Choose a revision to compare</option>
            {commits.map((commit) => (
              <option key={commit.id} value={commit.id}>
                {commit.shortId ?? commit.id.slice(0, 7)} {commit.message}
              </option>
            ))}
            {(repository.branches ?? []).map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.name} (branch)
              </option>
            ))}
          </select>
        </FormField>
        <Button type="submit" variant="primary">
          Compare
        </Button>
      </form>
      {!base || !compare ? (
        <p className="compare-hint">
          Choose a base revision and a revision to compare on the {branch} branch.
        </p>
      ) : comparison.status === "loading" ? (
        <p role="status">Comparing revisions…</p>
      ) : comparison.status === "missing" ? (
        <p role="alert">These revisions cannot be compared. Choose two readable revisions.</p>
      ) : result ? (
        <>
          <p className="compare-revisions">
            Base: <span className="compare-revisions__ref">{result.base.shortId ?? result.base.ref}</span>{" "}
            Compare:{" "}
            <span className="compare-revisions__ref">{result.compare.shortId ?? result.compare.ref}</span>
          </p>
          {pathFilter ? (
            <p className="compare-scope">
              Diff for <span className="compare-scope__path">{pathFilter}</span>
            </p>
          ) : null}
          <ChangedFiles
            changedFiles={visibleFiles}
            filesChanged={pathFilter ? visibleFiles.length : result.filesChanged}
            additions={
              pathFilter
                ? visibleFiles.reduce((total, file) => total + file.additions, 0)
                : result.additions
            }
            deletions={
              pathFilter
                ? visibleFiles.reduce((total, file) => total + file.deletions, 0)
                : result.deletions
            }
            fileHref={(path) => repositoryCompareHref(owner, name, base, compare, path)}
          />
        </>
      ) : null}
    </main>
  );
}
