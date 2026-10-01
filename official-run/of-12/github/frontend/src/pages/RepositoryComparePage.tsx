import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { navigate, useHashLocation } from "../lib/hash-route";
import { CommitDiffView } from "../features/repositories/CommitDiffView";
import { RepositoryHeader } from "../features/repositories/RepositoryHeader";
import { RepositoryLoadState } from "../features/repositories/RepositoryFallbacks";
import { shortCommitId } from "../features/repositories/format-commit";
import {
  fetchRepositoryComparison,
  fetchRepositoryRevisions,
  type RepositoryComparison,
  type RepositoryRevisionOption,
} from "../features/repositories/repository-api";
import { useRepositoryOverview } from "../features/repositories/use-repository";

export interface RepositoryComparePageProps {
  owner: string;
  name: string;
}

type CompareState = "idle" | "loading" | "ready" | "invalid" | "failed";

function revisionLabel(ref: { ref: string | null; commit?: { id: string; message: string } | null }): string {
  if (!ref.ref) return "No parent revision";
  const id = shortCommitId(ref.ref);
  return ref.commit ? `${id} ${ref.commit.message}` : id;
}

/**
 * Revision comparison of a repository (REQ-4-2-2).
 *
 * Two readable revisions — a branch name or a stored commit — are selected as
 * base and compare and the page reads the changed files and the line-by-line
 * additions and deletions between them. The comparison is read-only: neither
 * refreshing nor reopening it changes a branch, a commit or a file, and an
 * unknown revision is refused without producing any diff content.
 */
export function RepositoryComparePage({ owner, name }: RepositoryComparePageProps) {
  const { search } = useHashLocation();
  const base = search.get("base") ?? "";
  const compare = search.get("compare") ?? "";
  const { state: repositoryState, repository } = useRepositoryOverview(owner, name);
  const [revisions, setRevisions] = useState<RepositoryRevisionOption[]>([]);
  const [comparison, setComparison] = useState<RepositoryComparison | null>(null);
  const [state, setState] = useState<CompareState>("idle");
  const [draftBase, setDraftBase] = useState(base);
  const [draftCompare, setDraftCompare] = useState(compare);

  useEffect(() => {
    setDraftBase(base);
    setDraftCompare(compare);
  }, [base, compare]);

  useEffect(() => {
    if (repositoryState !== "ready" || !repository) return undefined;
    let active = true;
    fetchRepositoryRevisions(owner, name)
      .then((result) => {
        if (active) setRevisions(result.revisions);
      })
      .catch(() => {
        if (active) setRevisions([]);
      });
    return () => {
      active = false;
    };
  }, [owner, name, repository, repositoryState]);

  useEffect(() => {
    if (!base || !compare) {
      setComparison(null);
      setState("idle");
      return undefined;
    }
    let active = true;
    setState("loading");
    fetchRepositoryComparison(owner, name, base, compare)
      .then((result) => {
        if (!active) return;
        setComparison(result);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setComparison(null);
        setState(error instanceof ApiError && error.status === 400 ? "invalid" : "failed");
      });
    return () => {
      active = false;
    };
  }, [owner, name, base, compare]);

  if (!repository || repositoryState !== "ready") return <RepositoryLoadState state={repositoryState} />;

  return (
    <main className="repository-compare-page">
      <RepositoryHeader repository={repository} cloneUrls={repository.cloneUrls} active="commits" branch={repository.defaultBranch} />
      <h2 className="repository-compare__title">Compare revisions</h2>      <form
        className="repository-compare__form"
        aria-label="Comparison"
        onSubmit={(event) => {
          event.preventDefault();
          const params = new URLSearchParams();
          if (draftBase) params.set("base", draftBase);
          if (draftCompare) params.set("compare", draftCompare);
          navigate(`/${repository.owner}/${repository.name}/compare`, params);
        }}
      >
        <p className="repository-compare__field">
          <label htmlFor="compare-base">Base</label>
          <select id="compare-base" value={draftBase} onChange={(event) => setDraftBase(event.target.value)}>
            <option value="">Choose a revision</option>
            {revisions.map((revision) => (
              <option key={`base-${revision.value}`} value={revision.value}>
                {revision.label}
              </option>
            ))}
          </select>
        </p>
        <p className="repository-compare__field">
          <label htmlFor="compare-compare">Compare</label>
          <select id="compare-compare" value={draftCompare} onChange={(event) => setDraftCompare(event.target.value)}>
            <option value="">Choose a revision</option>
            {revisions.map((revision) => (
              <option key={`compare-${revision.value}`} value={revision.value}>
                {revision.label}
              </option>
            ))}
          </select>
        </p>
        <button type="submit" className="repository-compare__submit">
          Compare
        </button>
      </form>

      {state === "loading" ? <p role="status">Comparing revisions…</p> : null}
      {state === "failed" ? <p role="alert">The comparison could not be loaded. Please try again.</p> : null}
      {state === "invalid" ? <p role="alert">Unknown revision. Choose two revisions of this repository.</p> : null}

      {state === "ready" && comparison ? (
        <section className="repository-compare__result" aria-label="Comparison">
          <h3 className="repository-compare__heading">Comparing revisions</h3>
          <p className="repository-compare__ids">
            <span className="repository-compare__base">{`Base: ${revisionLabel(comparison.base)}`}</span>
            <span className="repository-compare__compare">{`Compare: ${revisionLabel(comparison.compare)}`}</span>
          </p>
          <h3 className="repository-compare__changed-files-heading">Changed files</h3>
          <p className="repository-compare__summary">
            {`${comparison.summary.filesChanged} files changed with ${comparison.summary.additions} additions and ${comparison.summary.deletions} deletions`}
          </p>
          {comparison.files.length === 0 ? (
            <p className="repository-compare__empty">These revisions have no changed files.</p>
          ) : (
            <ul className="repository-compare__files">
              {comparison.files.map((file) => (
                <li key={file.path} className="repository-compare__file">
                  <span className="repository-compare__file-path">{file.path}</span>
                  <span className="repository-compare__file-counts">{`+${file.additions}`}</span>
                  <span className="repository-compare__file-counts">{`-${file.deletions}`}</span>
                </li>
              ))}
            </ul>
          )}
          {comparison.files.map((file) => (
            <CommitDiffView key={file.path} file={file} />
          ))}
        </section>
      ) : null}
    </main>
  );
}
