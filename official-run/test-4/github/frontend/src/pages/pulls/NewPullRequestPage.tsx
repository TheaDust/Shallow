import { useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import { navigate } from "../../lib/hash-route";
import {
  BranchComparison,
  createPullRequest,
  fetchBranchComparison,
} from "../../lib/pull-api";
import { repoOwnerBase, RepoOwnerType } from "../../lib/repo-api";
import { useSession } from "../../session";
import { DiffView } from "../repos/DiffView";
import { RepoPageChrome } from "../repos/RepoPageChrome";
import { useRepoDetail } from "../repos/useRepoDetail";

interface NewPullRequestPageProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  base?: string;
  compare?: string;
}

type CompareStatus = "loading" | "ready" | "denied" | "notfound";

/**
 * The pull-request creation comparison page (REQ-6-2-2/6-2-3): the user
 * selects the base (target) and compare (source) branches, inspects the
 * comparable commits and per-file diff, and opens the creation form from the
 * enabled “Create pull request” button. Same branches or no comparable
 * commits immediately show “No changes” and disable creation. Only
 * Write/Maintain/Admin/organization Owner users may enter this flow.
 */
export function NewPullRequestPage({ ownerType, ownerName, repoName, base, compare }: NewPullRequestPageProps) {
  const { status: sessionStatus } = useSession();
  const { status: detailStatus, repository } = useRepoDetail(ownerType, ownerName, repoName);
  const repoBase = `${repoOwnerBase(ownerType, ownerName)}/repos/${encodeURIComponent(repoName)}`;

  const [baseValue, setBaseValue] = useState("");
  const [compareValue, setCompareValue] = useState("");
  const [comparison, setComparison] = useState<BranchComparison | null>(null);
  const [compareStatus, setCompareStatus] = useState<CompareStatus>("loading");
  const [refreshKey, setRefreshKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [draftMode, setDraftMode] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const authenticated = sessionStatus === "authenticated";
  const canCreate =
    authenticated && ["write", "maintain", "admin"].includes(repository?.currentRole ?? "");

  useEffect(() => {
    if (detailStatus !== "ready" || !repository) return;
    if (repository.branches.length === 0) return;
    const initialBase = base || repository.defaultBranch || repository.branches[0].name;
    const initialCompare = compare
      ? compare
      : repository.branches.find((branch) => branch.name !== initialBase)?.name ?? initialBase;
    setBaseValue(initialBase);
    setCompareValue(initialCompare);
  }, [detailStatus, repository, base, compare]);

  useEffect(() => {
    if (!baseValue || !compareValue) return;
    let cancelled = false;
    setCompareStatus("loading");
    fetchBranchComparison(ownerType, ownerName, repoName, baseValue, compareValue)
      .then((result) => {
        if (cancelled) return;
        setComparison(result);
        setCompareStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) {
          setCompareStatus("denied");
        } else {
          setCompareStatus("notfound");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ownerType, ownerName, repoName, baseValue, compareValue, refreshKey]);

  function updateSelection(nextBase: string, nextCompare: string) {
    setBaseValue(nextBase);
    setCompareValue(nextCompare);
    setCreateOpen(false);
    setDraftMode(false);
    setCreateError(null);
    const params = new URLSearchParams({ base: nextBase, compare: nextCompare });
    window.history.replaceState(null, "", `#${repoBase}/pulls/new?${params.toString()}`);
  }

  async function submitCreate() {
    if (submitting || !comparison || comparison.noDifference) return;
    setSubmitting(true);
    setCreateError(null);
    const outcome = await createPullRequest(ownerType, ownerName, repoName, {
      baseBranch: baseValue,
      compareBranch: compareValue,
      title,
      description,
      draft: draftMode,
    });
    setSubmitting(false);
    if (outcome.ok) {
      navigate(`${repoBase}/pulls/${outcome.pull.number}`, undefined);
    } else {
      setCreateError(
        outcome.errors.title ??
          outcome.errors.base ??
          outcome.errors.compare ??
          outcome.errors.description ??
          "Could not create the pull request",
      );
    }
  }

  return (
    <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName} section="pulls">
      {detailStatus === "notfound" ? (
        <p>Repository not found.</p>
      ) : detailStatus === "denied" ? (
        <p>Access denied</p>
      ) : detailStatus !== "ready" || !repository ? (
        <p>Loading…</p>
      ) : !canCreate ? (
        <p>Access denied</p>
      ) : (
        <>
          <h2>New pull request</h2>
          <div className="compare-form">
            <label className="compare-form__field">
              base
              <select
                className="compare-form__select"
                value={baseValue}
                onChange={(event) => updateSelection(event.target.value, compareValue)}
              >
                {repository.branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="compare-form__field">
              compare
              <select
                className="compare-form__select"
                value={compareValue}
                onChange={(event) => updateSelection(baseValue, event.target.value)}
              >
                {repository.branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button"
              onClick={() => {
                setRefreshKey((key) => key + 1);
              }}
            >
              Compare changes
            </button>
          </div>
          {compareStatus === "loading" && <p>Loading…</p>}
          {compareStatus === "denied" && <p>Access denied</p>}
          {compareStatus === "notfound" && <p>Branch not found.</p>}
          {compareStatus === "ready" && comparison && (
            <section aria-label="Comparison result">
              <p>
                base: {comparison.baseBranch} — compare: {comparison.compareBranch}
              </p>
              {comparison.noDifference ? (
                <p className="pull-compare__no-changes">No changes</p>
              ) : (
                <>
                  <h3>Commit summary</h3>
                  <p className="pull-compare__count">
                    {comparison.commitCount} {comparison.commitCount === 1 ? "commit" : "commits"} ahead of{" "}
                    {comparison.baseBranch}
                  </p>
                  <ul className="commit-detail__files">
                    {comparison.files.map((file) => (
                      <li key={file.path} className="commit-detail__file">
                        <span>{file.path}</span>
                        <span className="commit-detail__counts">
                          +{file.additions} −{file.deletions}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <DiffView files={comparison.files} />
                </>
              )}
            </section>
          )}
          {!createOpen ? (
            <div className="pull-create__entries">
              <button
                type="button"
                className="button button--primary pull-create__open"
                disabled={compareStatus !== "ready" || !comparison || comparison.noDifference}
                onClick={() => {
                  setDraftMode(false);
                  setCreateOpen(true);
                }}
              >
                Create pull request
              </button>
              <button
                type="button"
                className="button pull-create__open"
                disabled={compareStatus !== "ready" || !comparison || comparison.noDifference}
                onClick={() => {
                  setDraftMode(true);
                  setCreateOpen(true);
                }}
              >
                Create draft pull request
              </button>
            </div>
          ) : (
            <form
              className="pull-create-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitCreate();
              }}
            >
              <label className="account-form__label" htmlFor="pull-request-title">
                Title
              </label>
              <input
                id="pull-request-title"
                className="account-form__input"
                type="text"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setCreateError(null);
                }}
              />
              <label className="account-form__label" htmlFor="pull-request-description">
                Description
              </label>
              <textarea
                id="pull-request-description"
                className="account-form__input"
                rows={4}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
              {createError && (
                <p role="alert" className="branch-selector__error">
                  {createError}
                </p>
              )}
              <button type="submit" className="button button--primary" disabled={submitting}>
                {draftMode ? "Create draft pull request" : "Create pull request"}
              </button>
            </form>
          )}
        </>
      )}
    </RepoPageChrome>
  );
}
