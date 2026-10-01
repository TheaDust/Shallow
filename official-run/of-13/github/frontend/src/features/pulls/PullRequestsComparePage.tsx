import { useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import {
  createRepositoryPullRequest,
  fetchPullRequestComparison,
  repositoryPullRequestHref,
  type RepositoryPullComparison,
} from "../../lib/pull-requests-api";
import { fetchRepositoryBranchSettings } from "../../lib/repository-code-api";
import type { RepositoryCodeIdentity } from "../../lib/repository-code-api";
import { useDocumentTitle } from "../../lib/document-title";
import { Button, FormField } from "../../ui";
import { useAccountSession } from "../account/AccountSession";
import { CommitDiffView } from "../repositories/CommitDiffView";
import { RepositoryHeader } from "../repositories/RepositoryHeader";
import {
  RepositoryAccessDenied,
  RepositoryLoading,
  RepositoryNotFound,
} from "../repositories/RepositoryPageStates";
import { useRepositoryResource } from "../repositories/useRepositoryResource";

export interface PullRequestsComparePageProps {
  owner: string;
  name: string;
  /** `base` of the address: the target branch that receives the changes. */
  base: string;
  /** `compare` of the address: the source branch that provides the changes. */
  compare: string;
}

/** The two creation entries of a valid comparison, and the form they open. */
type CreationMode = "normal" | "draft" | null;

/**
 * The read-only comparison page that precedes creation. base is the target
 * branch that receives the merge result and compare is the source branch that
 * provides the changes; the page shows the comparable commits, the changed
 * files and their line diff, and offers the two creation entries of a valid
 * comparison. Reading it never stores a pull request, a commit or a branch
 * change. Only signed-in viewers with Write or higher reach this page.
 */
export function PullRequestsComparePage({
  owner,
  name,
  base,
  compare,
}: PullRequestsComparePageProps) {
  const { status: sessionStatus, account } = useAccountSession();
  const [baseValue, setBaseValue] = useState(base);
  const [compareValue, setCompareValue] = useState(compare);
  const [initialized, setInitialized] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [comparison, setComparison] = useState<RepositoryPullComparison | null>(null);
  const [comparisonFailed, setComparisonFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<CreationMode>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const settings = useRepositoryResource(
    `repository-branch-settings:${owner}/${name}`,
    sessionStatus !== "loading",
    () => fetchRepositoryBranchSettings(owner, name),
  );

  const defaultBranch =
    settings.status === "ready" ? settings.value.repository.defaultBranch ?? "" : "";

  // The page opens on the repository default branch when the address does not
  // preselect the branches of a direct comparison entry.
  useEffect(() => {
    if (settings.status !== "ready" || initialized) return;
    setBaseValue(base.length > 0 ? base : defaultBranch);
    setCompareValue(compare.length > 0 ? compare : defaultBranch);
    setInitialized(true);
  }, [settings.status, initialized, base, compare, defaultBranch]);

  const sameBranch = initialized && baseValue.length > 0 && baseValue === compareValue;

  useEffect(() => {
    if (!initialized) return;
    if (baseValue.length === 0 || compareValue.length === 0 || baseValue === compareValue) {
      setComparison(null);
      setComparisonFailed(false);
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    fetchPullRequestComparison(owner, name, { base: baseValue, compare: compareValue })
      .then((value) => {
        if (cancelled) return;
        setComparison(value);
        setComparisonFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setComparison(null);
        setComparisonFailed(true);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name, baseValue, compareValue, refreshToken, initialized]);

  useDocumentTitle(`Compare · ${owner}/${name}`);

  if (settings.status === "missing" || settings.status === "error") {
    return <RepositoryNotFound />;
  }

  if (settings.status === "denied") {
    return <RepositoryAccessDenied signedIn={Boolean(account)} />;
  }

  // Read and Triage may view existing pull requests but never enter the
  // creation-comparison flow; the server refuses them independently.
  if (settings.status === "ready" && (!account || !settings.value.canWrite)) {
    return <RepositoryAccessDenied signedIn={Boolean(account)} />;
  }

  if (settings.status !== "ready") {
    return (
      <RepositoryLoading>
        <h1>{`${owner}/${name}`}</h1>
      </RepositoryLoading>
    );
  }

  const repositoryRecord = settings.value.repository;
  const repository: RepositoryCodeIdentity = {
    owner: repositoryRecord.owner,
    name: repositoryRecord.name,
    description: repositoryRecord.description,
    visibility: repositoryRecord.visibility,
    defaultBranch: repositoryRecord.defaultBranch ?? null,
    source: repositoryRecord.source ?? null,
  };
  const branches = settings.value.branches;
  const comparisonMatches =
    comparison !== null &&
    comparison.base.name === baseValue &&
    comparison.compare.name === compareValue;
  const noChanges = sameBranch || (comparisonMatches && comparison.noChanges);
  const canCreate = comparisonMatches && !noChanges && !busy;

  function runComparison(): void {
    setRefreshToken((value) => value + 1);
  }

  function openForm(next: Exclude<CreationMode, null>): void {
    setMode(next);
    setTitle("");
    setDescription("");
    setTitleError(null);
    setDescriptionError(null);
    setFormError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (mode === null || submitting) return;

    const trimmed = title.trim();
    let invalid = false;
    if (trimmed.length === 0) {
      setTitleError("Title is required");
      invalid = true;
    } else if (trimmed.length > 256) {
      setTitleError("Title must be 256 characters or fewer");
      invalid = true;
    } else {
      setTitleError(null);
    }
    if (description.length > 65536) {
      setDescriptionError("Description must be 65536 characters or fewer");
      invalid = true;
    } else {
      setDescriptionError(null);
    }
    if (invalid) return;

    setSubmitting(true);
    setFormError(null);
    try {
      const detail = await createRepositoryPullRequest(owner, name, {
        base: baseValue,
        compare: compareValue,
        title: trimmed,
        description,
        draft: mode === "draft",
      });
      window.location.hash = repositoryPullRequestHref(owner, name, detail.pullRequest.number);
    } catch (error) {
      if (error instanceof ApiError && error.body && typeof error.body === "object") {
        const fieldErrors =
          (error.body as { fieldErrors?: Record<string, string> }).fieldErrors ?? {};
        setTitleError(fieldErrors.title ?? null);
        setDescriptionError(fieldErrors.description ?? null);
        setFormError(
          fieldErrors.compare ?? fieldErrors.base ?? (error.status === 403 ? error.message : null),
        );
      } else {
        setFormError("The pull request was not created.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="repository-pulls-compare">
      <RepositoryHeader
        owner={repository.owner}
        name={repository.name}
        visibility={repository.visibility}
        description={repository.description}
        defaultBranch={repository.defaultBranch}
        showSettings={Boolean(account)}
        active="pulls"
        source={repository.source ?? null}
      />
      {/* The comparison block stays unnamed: naming it after a control would
          shadow the accessible name of that control. */}
      <section className="pull-compare">
        <div className="pull-compare__controls">
          <p className="pull-compare__field">
            <label htmlFor="pull-base">base</label>
            <select
              id="pull-base"
              name="base"
              value={baseValue}
              onChange={(event) => setBaseValue(event.target.value)}
            >
              {branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          </p>
          <p className="pull-compare__field">
            <label htmlFor="pull-compare">compare</label>
            <select
              id="pull-compare"
              name="compare"
              value={compareValue}
              onChange={(event) => setCompareValue(event.target.value)}
            >
              {branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          </p>
          <Button type="button" onClick={runComparison}>
            Compare changes
          </Button>
        </div>
        {sameBranch ? (
          <p className="pull-compare__no-changes">No changes</p>
        ) : comparisonMatches ? (
          <div className="pull-compare__results">
            {noChanges ? (
              <p className="pull-compare__no-changes">No changes</p>
            ) : (
              <>
                <section className="pull-compare__commits" aria-labelledby="pull-compare-commits">
                  <h3 id="pull-compare-commits">Commit summary</h3>
                  <p className="pull-compare__commit-count">
                    {`${comparison.commitCount} ${
                      comparison.commitCount === 1 ? "commit" : "commits"
                    }`}
                  </p>
                  <ul className="pull-compare__commit-list">
                    {comparison.commits.map((commit) => (
                      <li key={commit.id}>{`${commit.shortSha ?? commit.sha} ${commit.message}`}</li>
                    ))}
                  </ul>
                </section>
                {comparison.compare.commit ? (
                  <CommitDiffView
                    owner={repository.owner}
                    name={repository.name}
                    revision={comparison.compare.commit.sha}
                    comparison={{
                      repository,
                      branch: comparison.compare.name,
                      branches,
                      base: comparison.base.commit,
                      compare: comparison.compare.commit,
                      path: "",
                      files: comparison.files,
                      changedFileCount: comparison.changedFileCount,
                      additions: comparison.additions,
                      deletions: comparison.deletions,
                      revisions: [],
                    }}
                  />
                ) : null}
              </>
            )}
          </div>
        ) : busy || comparisonFailed ? (
          <p className="pull-compare__busy" role="status">
            {comparisonFailed ? "The comparison could not be loaded" : "Loading…"}
          </p>
        ) : null}
        {mode === null ? (
          <p className="pull-compare__create-actions">
            <Button type="button" disabled={!canCreate} onClick={() => openForm("normal")}>
              Create pull request
            </Button>
            <Button type="button" disabled={!canCreate} onClick={() => openForm("draft")}>
              Create draft pull request
            </Button>
          </p>
        ) : (
          <form className="pull-create" aria-label="New pull request" noValidate onSubmit={submit}>
            <FormField id="pull-title" label="Title" error={titleError ?? undefined}>
              <input
                id="pull-title"
                name="title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </FormField>
            <FormField
              id="pull-description"
              label="Description"
              error={descriptionError ?? undefined}
            >
              <textarea
                id="pull-description"
                name="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </FormField>
            {formError ? (
              <p className="pull-create__error" role="alert">
                {formError}
              </p>
            ) : null}
            <Button type="submit" disabled={submitting}>
              {mode === "draft" ? "Create draft pull request" : "Create pull request"}
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
