import { useEffect, useState, type FormEvent } from "react";

import { AccessDeniedPage } from "./AccessDeniedPage";
import { NotFoundPage, repositoryAccessHint } from "./NotFoundPage";
import { navigate, useHashLocation } from "../lib/hash-route";
import {
  canCreatePullRequests,
  comparePullRequestBranches,
  type PullRequestComparisonPayload,
} from "../lib/pull-requests-api";
import {
  repositoryCompareHref,
  repositoryNewPullRequestPath,
  repositoryPullRequestPath,
} from "../lib/repository-routes";
import { repositoryTitle } from "../lib/repositories-api";
import { ChangedFiles } from "../repository/ChangedFiles";
import { RepositoryChrome } from "../repository/RepositoryChrome";
import { useRepositoryOverview } from "../repository/useRepositoryOverview";
import { useRepositoryResource } from "../repository/useRepositoryResource";
import { PullRequestCreateForm, type PullRequestCreateMode } from "../pull/PullRequestCreateForm";
import { Button, FormField } from "../ui";

export interface RepositoryPullRequestComparePageProps {
  owner: string;
  name: string;
}

/**
 * The comparison page of the creation flow (REQ-6-2-2). Base is the target
 * branch that receives the merge result and compare is the source branch that
 * provides the changes; the page derives the comparable commits, the changed
 * files and the diff summary from the commits the two branches currently point
 * at, and stores nothing. Selecting the same branch on both sides shows
 * `No changes` and disables the creation entry at once, and every invalid
 * comparison keeps it disabled. A page entry with `base` and `compare` in its
 * address opens the same flow with both branches already selected.
 *
 * The enabled creation entry opens the creation form of REQ-6-2-3 on the same
 * page: it carries the `Title`, the optional `Description` and exactly one
 * submit button named after the creation. While it is open no comparison-page
 * action competes with that submit button, and a successful submission opens
 * the detail page of the stored proposal.
 */
export function RepositoryPullRequestComparePage({
  owner,
  name,
}: RepositoryPullRequestComparePageProps) {
  const location = useHashLocation();
  const pathBase = location.search.get("base") ?? "";
  const pathCompare = location.search.get("compare") ?? "";
  const overview = useRepositoryOverview(owner, name);
  const [selection, setSelection] = useState<{ base: string; compare: string } | null>(null);
  // The creation form replaces the page's creation entries while it is open, so
  // one submission button named `Create pull request` stays unique.
  const [formMode, setFormMode] = useState<PullRequestCreateMode | null>(null);

  const repository = overview.state.status === "ready" ? overview.state.repository : null;
  const branches = repository?.branches ?? [];
  const defaultBranch = repository?.defaultBranch ?? "";

  // The address selects the two branches of an opened page entry; without one,
  // both sides start on the repository default branch, which is the same branch
  // and therefore shows `No changes`.
  useEffect(() => {
    if (!repository) return;
    setSelection({
      base: pathBase || defaultBranch,
      compare: pathCompare || defaultBranch,
    });
  }, [repository, pathBase, pathCompare, defaultBranch]);

  const baseInput = selection?.base ?? "";
  const compareInput = selection?.compare ?? "";
  const sameBranch = Boolean(baseInput) && baseInput === compareInput;

  const comparison = useRepositoryResource<PullRequestComparisonPayload | null>(
    () =>
      baseInput && compareInput && !sameBranch
        ? comparePullRequestBranches(owner, name, baseInput, compareInput)
        : Promise.resolve(null),
    [owner, name, baseInput, compareInput, sameBranch],
  );

  if (overview.state.status === "loading") {
    return (
      <main aria-busy="true">
        <p role="status">Loading branches…</p>
      </main>
    );
  }
  if (overview.state.status === "denied") return <AccessDeniedPage owner={owner} name={name} />;
  if (overview.state.status === "missing") return <NotFoundPage hint={repositoryAccessHint()} />;
  if (overview.state.status === "error" || !repository) {
    return (
      <main>
        <h1>Comparison unavailable</h1>
        <p role="alert">The branches could not be loaded. Reload the page to try again.</p>
      </main>
    );
  }

  const result = comparison.status === "ready" ? comparison.value : null;
  const canCreate =
    Boolean(result) &&
    !sameBranch &&
    result!.canCreate &&
    result!.commitCount > 0 &&
    result!.filesChanged > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    navigate(repositoryNewPullRequestPath(owner, name), new URLSearchParams({
      base: baseInput,
      compare: compareInput,
    }));
  };

  return (
    <main>
      <RepositoryChrome
        owner={owner}
        name={name}
        title={repositoryTitle(repository)}
        visibility={repository.visibility}
        description={repository.description}
        activeEntry="Pull requests"
      />
      <h2 className="pull-compare__heading">New pull request</h2>

      {canCreatePullRequests(repository.permissions?.role ?? null) ? (
        <>
          <form className="pull-compare__form" onSubmit={submit}>
            <FormField id="pull-compare-base" label="base">
              <select
                id="pull-compare-base"
                value={baseInput}
                onChange={(event) =>
                  setSelection({ base: event.target.value, compare: compareInput })
                }
              >
                {branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="pull-compare-compare" label="compare">
              <select
                id="pull-compare-compare"
                value={compareInput}
                onChange={(event) =>
                  setSelection({ base: baseInput, compare: event.target.value })
                }
              >
                {branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </FormField>
            <Button type="submit" variant="secondary">
              Compare changes
            </Button>
          </form>

          {sameBranch ? (
            <div className="pull-compare__empty">
              <p className="pull-compare__empty-status">No changes</p>
              <p className="pull-compare__empty-hint">
                These branches are the same or have no differences.
              </p>
            </div>
          ) : comparison.status === "loading" ? (
            <p role="status">Comparing branches…</p>
          ) : comparison.status === "denied" ? (
            <p role="alert">This comparison is not available to your account.</p>
          ) : comparison.status === "missing" ? (
            <p role="alert">These branches cannot be compared. Choose two existing branches.</p>
          ) : result && (result.commitCount === 0 || result.filesChanged === 0) ? (
            <div className="pull-compare__empty">
              <p className="pull-compare__empty-status">No changes</p>
              <p className="pull-compare__empty-hint">
                These branches are the same or have no differences.
              </p>
            </div>
          ) : result ? (
            <>
              <p className="pull-compare__refs">
                {"Base branch: "}
                <span className="pull-compare__ref">{result.base.name}</span>
                {" · Compare branch: "}
                <span className="pull-compare__ref">{result.compare.name}</span>
              </p>
              <section className="pull-compare__commits" aria-labelledby="commit-summary-heading">
                <h3 id="commit-summary-heading" className="pull-section-heading">
                  Commit summary
                </h3>
                <p className="commit-summary__count">
                  {result.commitCount === 1 ? "1 commit" : `${result.commitCount} commits`}
                </p>
                <ul className="commit-summary__list">
                  {result.commits.map((commit) => (
                    <li key={commit.id} className="commit-summary__item">
                      <span className="commit-summary__message">{commit.message}</span>
                      {" · "}
                      <span className="commit-summary__author">{commit.author}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <ChangedFiles
                changedFiles={result.changedFiles}
                filesChanged={result.filesChanged}
                additions={result.additions}
                deletions={result.deletions}
                fileHref={(path) =>
                  repositoryCompareHref(owner, name, baseInput, compareInput, path)
                }
              />
            </>
          ) : null}

          {formMode === null ? (
            <div className="pull-compare__actions">
              <Button
                variant="primary"
                disabled={!canCreate}
                onClick={() => setFormMode("normal")}
              >
                Create pull request
              </Button>
              <Button
                variant="secondary"
                disabled={!canCreate}
                onClick={() => setFormMode("draft")}
              >
                Create draft pull request
              </Button>
            </div>
          ) : (
            <PullRequestCreateForm
              owner={owner}
              name={name}
              base={baseInput}
              compare={compareInput}
              mode={formMode}
              onCreated={(number) =>
                navigate(repositoryPullRequestPath(owner, name, number))
              }
              onCancel={() => setFormMode(null)}
            />
          )}
        </>
      ) : (
        <p className="pull-compare__forbidden">
          You need write permission to compare branches and open a pull request in this repository.
        </p>
      )}
    </main>
  );
}
