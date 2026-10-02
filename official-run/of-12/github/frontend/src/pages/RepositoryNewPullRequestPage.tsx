import { useEffect, useState, type FormEvent } from "react";

import { Button, FormField } from "../ui";
import { navigateHref, useHashLocation } from "../lib/hash-route";
import { readFormValues } from "../lib/forms";
import { useSession } from "../lib/session";
import {
  createRepositoryPullRequestSync,
  type PullRequestPayload,
} from "../features/pull-requests/pull-request-api";
import { CommitDiffView } from "../features/repositories/CommitDiffView";
import {
  fetchRepositoryComparison,
  type RepositoryComparison,
} from "../features/repositories/repository-api";
import { pullHref } from "../features/repositories/repository-links";
import { RepositoryHeader } from "../features/repositories/RepositoryHeader";
import { RepositoryLoadState } from "../features/repositories/RepositoryFallbacks";
import { useRepositoryOverview } from "../features/repositories/use-repository";

export interface RepositoryNewPullRequestPageProps {
  owner: string;
  name: string;
}

const FIELD_IDS = {
  title: "new-pull-request-title",
  description: "new-pull-request-description",
};

type ComparisonState = "idle" | "loading" | "ready" | "failed";

/**
 * The comparison page of a new pull request (REQ-6-2-2, REQ-6-2-3, REQ-6-2-4).
 *
 * It is read-only context: base is the target branch that receives the changes
 * and compare the source branch that provides them, and the page reads the
 * comparable commits, the changed files and the diff summary of the commits the
 * two branches point at. Selecting the same branch on both sides — or a pair
 * without differences — shows “No changes” at once and disables the creation
 * entry, without saving a pull request, a commit or a branch change.
 *
 * Only a signed-in account with Write, Maintain, Admin or organization Owner
 * status enters this flow. “Create pull request” and “Create draft pull request”
 * open the creation form with its Title and Description fields; submitting it
 * stores the proposal and opens the detail page of the stored number, so the
 * page can never show a pull request the server did not record.
 */
export function RepositoryNewPullRequestPage({ owner, name }: RepositoryNewPullRequestPageProps) {
  const { search } = useHashLocation();
  const { state: repositoryState, repository } = useRepositoryOverview(owner, name);
  const { user, loading } = useSession();
  const [requestedBase, setRequestedBase] = useState<string | null>(search.get("base") || null);
  const [requestedCompare, setRequestedCompare] = useState<string | null>(search.get("compare") || null);
  const [comparison, setComparison] = useState<RepositoryComparison | null>(null);
  const [state, setState] = useState<ComparisonState>("idle");
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState<"open" | "draft" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const branches = (repository?.branches ?? []).map((branch) => branch.name);
  const defaultBase = repository?.defaultBranch && branches.includes(repository.defaultBranch)
    ? repository.defaultBranch
    : branches[0] ?? "";
  const base = requestedBase && branches.includes(requestedBase) ? requestedBase : defaultBase;
  const compare = requestedCompare && branches.includes(requestedCompare)
    ? requestedCompare
    : branches.find((branch) => branch !== base) ?? base;
  const sameBranch = base === compare;

  useEffect(() => {
    if (repositoryState !== "ready" || !repository) return undefined;
    if (!base || !compare || base === compare) {
      setComparison(null);
      setState("ready");
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
      .catch(() => {
        if (!active) return;
        setComparison(null);
        setState("failed");
      });
    return () => {
      active = false;
    };
  }, [owner, name, repository, repositoryState, base, compare, version]);

  if (!repository || repositoryState !== "ready") return <RepositoryLoadState state={repositoryState} />;

  const canWrite = repository.canWrite === true;
  const files = comparison?.files ?? [];
  const commits = comparison?.commits ?? [];
  const summary = comparison?.summary ?? { filesChanged: 0, additions: 0, deletions: 0 };
  const noChanges = sameBranch || (state === "ready" && files.length === 0);
  const canCreate = canWrite && !noChanges && state === "ready";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = readFormValues(event.currentTarget, ["title", "description"]);
    setErrors({});
    setMessage(null);
    setSubmitting(true);
    const result = createRepositoryPullRequestSync(owner, name, {
      title: values.title ?? "",
      description: values.description ?? "",
      base,
      compare,
      draft: form === "draft",
    });
    if (!result.ok) {
      setSubmitting(false);
      setErrors(result.errors);
      setMessage(result.errors.title || result.errors.description || result.errors.compare ? null : result.message);
      return;
    }
    openStoredPullRequest(result.data);
  }

  function openStoredPullRequest(payload: PullRequestPayload) {
    const number = payload.pullRequest.number;
    if (!number) {
      setSubmitting(false);
      setMessage("The pull request could not be created.");
      return;
    }
    navigateHref(pullHref(payload.repository, number));
  }

  return (
    <main className="new-pull-request-page">
      <RepositoryHeader repository={repository} cloneUrls={repository.cloneUrls} active="pulls" />
      <section className="new-pull-request" aria-label="New pull request">
        <h2>New pull request</h2>
        {loading ? <p role="status">Loading…</p> : null}
        {!loading && !user ? (
          <p className="new-pull-request__signed-out">
            You need to sign in to create a pull request. <a href="#/sign-in">Sign in</a>
          </p>
        ) : null}
        {!loading && user && !canWrite ? (
          <p role="alert">You do not have permission to create a pull request in this repository.</p>
        ) : null}

        {user && canWrite ? (
          <div className="pull-request-compare">
            <div className="pull-request-compare__fields">
              <div className="pull-request-compare__field">
                <label htmlFor="pull-request-base">base</label>
                <select
                  id="pull-request-base"
                  name="base"
                  value={base}
                  onChange={(event) => {
                    setRequestedBase(event.target.value);
                    setForm(null);
                  }}
                >
                  {branches.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pull-request-compare__field">
                <label htmlFor="pull-request-compare-branch">compare</label>
                <select
                  id="pull-request-compare-branch"
                  name="compare"
                  value={compare}
                  onChange={(event) => {
                    setRequestedCompare(event.target.value);
                    setForm(null);
                  }}
                >
                  {branches.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
              </div>
              <Button onClick={() => setVersion((current) => current + 1)}>Compare changes</Button>
            </div>

            {state === "loading" || state === "idle" ? (
              <p role="status">Loading comparison…</p>
            ) : null}
            {state === "failed" ? (
              <p role="alert">The comparison could not be read. Please try again.</p>
            ) : null}

            {state === "ready" && noChanges ? (
              <div className="pull-request-compare__empty">
                <p className="pull-request-compare__no-changes">No changes</p>
                <p className="pull-request-compare__no-changes-note">
                  These branches are the same or have no differences.
                </p>
              </div>
            ) : null}

            {state === "ready" && !noChanges ? (
              <div className="pull-request-compare__results" aria-label="Comparison results">
                <p className="pull-request-compare__branches">
                  {`Merging ${compare} into ${base}`}
                </p>
                <section className="pull-request-compare__commits" aria-label="Commit summary">
                  <h3>Commit summary</h3>
                  <p className="pull-request-compare__count">
                    {commits.length === 1 ? "1 commit" : `${commits.length} commits`}
                  </p>
                  <ul className="pull-request-compare__commit-list">
                    {commits.map((commit) => (
                      <li key={commit.id} className="pull-request-compare__commit">
                        {commit.message}
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="pull-request-compare__files" aria-label="Changed files">
                  <h3>Changed files</h3>
                  <p className="pull-request-compare__summary">
                    {`${summary.filesChanged} changed files +${summary.additions} additions -${summary.deletions} deletions`}
                  </p>
                  {files.map((file) => (
                    <CommitDiffView key={file.path} file={file} />
                  ))}
                </section>
              </div>
            ) : null}

            {form === null ? (
              <div className="pull-request-compare__actions">
                <Button variant="primary" disabled={!canCreate} onClick={() => setForm("open")}>
                  Create pull request
                </Button>
                <Button disabled={!canCreate} onClick={() => setForm("draft")}>
                  Create draft pull request
                </Button>
              </div>
            ) : (
              <form className="pull-request-form" onSubmit={submit} noValidate>
                <FormField id={FIELD_IDS.title} label="Title" error={errors.title}>
                  <input id={FIELD_IDS.title} name="title" type="text" autoComplete="off" />
                </FormField>
                <FormField id={FIELD_IDS.description} label="Description" error={errors.description}>
                  <textarea id={FIELD_IDS.description} name="description" rows={6} />
                </FormField>
                {errors.compare ? (
                  <p className="pull-request-form__error" role="alert">
                    {errors.compare}
                  </p>
                ) : null}
                {message ? (
                  <p className="pull-request-form__error" role="alert">
                    {message}
                  </p>
                ) : null}
                <div className="pull-request-form__actions">
                  <Button type="submit" variant="primary" disabled={submitting}>
                    {form === "draft" ? "Create draft pull request" : "Create pull request"}
                  </Button>
                  <Button onClick={() => setForm(null)}>Cancel</Button>
                </div>
              </form>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
