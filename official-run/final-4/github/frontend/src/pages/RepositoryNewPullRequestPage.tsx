import { useEffect, useState } from "react";

import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, ErrorNote, LoadingNote } from "../components/ViewState";
import { navigate } from "../lib/hash-route";
import {
  createRepositoryPullRequest,
  fetchPullRequestComparison,
  fetchRepositoryBranches,
  type PullRequestComparison,
} from "../lib/org-api";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { FormField } from "../ui/FormField";

/**
 * The comparison page that `New pull request` opens (REQ-6-2-2, REQ-6-2-3).
 * `Base` is the target branch that receives the changes and `Compare` is the
 * source branch that provides them; `Compare changes` displays the commits and
 * the changed files of that pair. Two identical sides report no differences and
 * keep the creation control disabled. From a valid comparison the contributor
 * opens the form, enters a Title and an optional Description and submits
 * `Create pull request` (or creates a draft), which stores the persistent
 * proposal and opens its detail page.
 */
export function RepositoryNewPullRequestPage({ owner, name }: { owner: string; name: string }) {
  const branches = useAsyncData(() => fetchRepositoryBranches(owner, name), [owner, name]);
  const [base, setBase] = useState("");
  const [compare, setCompare] = useState("");
  const [nonce, setNonce] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [draftMode, setDraftMode] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The selection starts on the repository default branch and on another
  // branch, so the page opens on a comparable pair.
  useEffect(() => {
    if (!branches.data) return;
    const defaultBranch = branches.data.defaultBranch;
    const other =
      branches.data.branches.find((branch) => branch.name !== defaultBranch)?.name ?? defaultBranch;
    setBase((current) => current || defaultBranch);
    setCompare((current) => current || other);
  }, [branches.data]);

  const comparison = useAsyncData<PullRequestComparison | null>(
    () =>
      base && compare
        ? fetchPullRequestComparison(owner, name, base, compare)
        : Promise.resolve(null),
    [owner, name, base, compare, nonce],
  );
  const view = comparison.data;
  const identical = view ? view.identical : false;
  const ready = Boolean(view) && !identical;

  const submit = async (event: { preventDefault(): void }, draft: boolean) => {
    event.preventDefault();
    if (busy) return;
    if (title.trim().length === 0) {
      setFormError("Title is required");
      return;
    }
    setBusy(true);
    setFormError(null);
    const result = await createRepositoryPullRequest(owner, name, {
      title,
      description,
      base,
      compare,
      draft,
    });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.fieldErrors.title ?? result.fieldErrors.compare ?? result.message);
      return;
    }
    navigate(
      `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${result.value.pullRequest.number}`,
    );
  };

  return (
    <main className="page">
      <section className="page__body repository-compare">
        {branches.data ? <RepositoryBreadcrumb repository={branches.data.repository} /> : null}
        <h1 className="repository-compare__title">New pull request</h1>
        {branches.status === "loading" && !branches.data ? (
          <LoadingNote label="Loading branches…" />
        ) : null}
        {branches.status === "error" && branches.error ? (
          <ErrorHeading error={branches.error} />
        ) : null}
        {branches.data ? (
          <>
            <div className="repository-compare__selectors">
              <Combobox
                id="pull-base"
                label="Base"
                options={branches.data.branches.map((branch) => ({
                  value: branch.name,
                  label: branch.name,
                }))}
                value={base}
                onChange={(event) => {
                  setBase(event.currentTarget.value);
                  setFormOpen(false);
                  setFormError(null);
                }}
              />
              <Combobox
                id="pull-compare"
                label="Compare"
                options={branches.data.branches.map((branch) => ({
                  value: branch.name,
                  label: branch.name,
                }))}
                value={compare}
                onChange={(event) => {
                  setCompare(event.currentTarget.value);
                  setFormOpen(false);
                  setFormError(null);
                }}
              />
              <Button
                variant="secondary"
                onClick={() => {
                  setFormOpen(false);
                  setFormError(null);
                  setNonce((value) => value + 1);
                }}
              >
                Compare changes
              </Button>
            </div>
            {comparison.status === "error" && comparison.error ? (
              <ErrorNote error={comparison.error} onRetry={() => setNonce((value) => value + 1)} />
            ) : null}
            {view ? (
              <div className="repository-compare__result">
                <p className="repository-compare__summary">
                  {view.base} &larr; {view.compare}
                </p>
                {identical ? (
                  <p className="repository-compare__identical">
                    These branches are identical — there are no differences to compare.
                  </p>
                ) : (
                  <>
                    <section className="repository-compare__files" aria-label="Changed files">
                      <h2 className="repository-compare__section-title">Files changed</h2>
                      <ul className="compare-file-list">
                        {view.changes.map((change) => (
                          <li key={change.path} className="compare-file">
                            <span className="compare-file__path">{change.path}</span>
                            <span className="compare-file__stat">
                              +{change.additions} −{change.deletions}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                    <section className="repository-compare__commits" aria-label="Commits">
                      <h2 className="repository-compare__section-title">Commits</h2>
                      {view.commits.length === 0 ? (
                        <p className="repository-compare__empty">No commits to compare.</p>
                      ) : (
                        <ul className="compare-commit-list">
                          {view.commits.map((commit) => (
                            <li key={commit.id} className="compare-commit">
                              <span className="compare-commit__message">{commit.message}</span>
                              <span className="compare-commit__author">{commit.authorName}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </>
                )}
                {branches.data.canWrite ? (
                  formOpen ? (
                    <form className="repository-compare__form" onSubmit={(event) => void submit(event, draftMode)}>
                      <FormField id="pull-title" label="Title" error={formError ?? undefined}>
                        <input
                          id="pull-title"
                          name="title"
                          type="text"
                          value={title}
                          onChange={(event) => setTitle(event.target.value)}
                        />
                      </FormField>
                      <FormField id="pull-description" label="Description">
                        <textarea
                          id="pull-description"
                          name="description"
                          rows={5}
                          value={description}
                          onChange={(event) => setDescription(event.target.value)}
                        />
                      </FormField>
                      <div className="repository-compare__actions">
                        {draftMode ? (
                          <>
                            <Button type="submit" variant="primary" disabled={busy}>
                              Create draft pull request
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={busy}
                              onClick={(event) => void submit(event, false)}
                            >
                              Create pull request
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button type="submit" variant="primary" disabled={busy}>
                              Create pull request
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={busy}
                              onClick={(event) => void submit(event, true)}
                            >
                              Create draft pull request
                            </Button>
                          </>
                        )}
                      </div>
                    </form>
                  ) : (
                    <div className="repository-compare__actions">
                      <Button
                        variant="primary"
                        disabled={!ready}
                        onClick={() => {
                          setFormError(null);
                          setDraftMode(false);
                          setFormOpen(true);
                        }}
                      >
                        Create pull request
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={!ready}
                        onClick={() => {
                          setFormError(null);
                          setDraftMode(true);
                          setFormOpen(true);
                        }}
                      >
                        Create draft pull request
                      </Button>
                    </div>
                  )
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
