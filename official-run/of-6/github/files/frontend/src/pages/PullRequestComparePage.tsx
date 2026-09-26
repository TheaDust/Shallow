import { useCallback, useEffect, useState } from 'react';
import { apiRepositoryBranches, apiPullRequestCompare, apiCreatePullRequest } from '../api';
import { useSession } from '../session';
import { navigate } from '../router';
import { formatRelativeTime } from '../format';
import DiffSummary from '../components/DiffSummary';
import DiffLines from '../components/DiffLines';
import type {
  CreatePullRequestErrors,
  PullRequestBranchCompare,
  RepositoryBranchInfo,
} from '../types';

interface PullRequestComparePageProps {
  owner: string;
  name: string;
  /** The base branch carried by the URL (?base=...) or '' when not given. */
  baseParam: string;
  /** The compare branch carried by the URL (?compare=...) or '' when not given. */
  compareParam: string;
}

type CompareResult =
  | { kind: 'idle' }
  | { kind: 'no-changes' }
  | { kind: 'compared'; data: PullRequestBranchCompare }
  | { kind: 'error'; message: string };

/**
 * REQ-6-2-2: the read-only PR comparison page shown before creation. base is
 * the target branch that receives the merge result and compare is the source
 * branch that provides the changes; the system calculates the comparable
 * commits, the changed files, and the diff summary based on the commits the
 * two branches currently point to. Comparison never saves a PR, commit, or
 * branch change.
 *
 * Only a signed-in user with Write, Maintain, Admin, or organization Owner
 * status may enter the creation-comparison flow (Read/Triage/visitors may
 * view existing PRs but not compare; the server rejects 401/403 as well).
 * The two selects are native controls labeled “base” and “compare” whose
 * options are the exact branch names; “Compare changes” computes the result
 * for the current selection, “Create pull request” is the creation entry
 * (enabled only for a valid selection with changes), and selecting the same
 * branch in both fields immediately displays “No changes” with the creation
 * entry disabled. Direct comparison-page entries (a URL that already carries
 * ?base=&compare=) open the same usable creation flow with the branches
 * already selected and re-run the comparison.
 *
 * REQ-6-2-3: clicking the enabled “Create pull request” button opens the
 * creation form with a field labeled “Title”, an optional “Description”
 * field, and a single “Create pull request” submit button; while a form is
 * open the comparison-page actions are hidden so they are never competing
 * active buttons. A successful submission opens the new PR detail page (the
 * entered title becomes the exact heading, the status is Open, and the
 * record persists on reload); a rejected submission (blank/over-long title,
 * over-long description, same branches, no differences, an existing Open or
 * Draft PR for the pair, missing permission, or a persistence failure)
 * creates no PR and displays the reason without losing the entered values.
 *
 * REQ-6-2-4: the same valid comparison also offers a “Create draft pull
 * request” button which opens a form with the same Title and optional
 * Description fields and a single “Create draft pull request” submit
 * button. Successful draft creation persists the same fields as a normal PR
 * with status Draft (the detail page shows the “Draft” marker and a present
 * but disabled “Merge pull request” entry); every creation rejection
 * applies identically and leaves no partial record.
 */
export default function PullRequestComparePage({
  owner,
  name,
  baseParam,
  compareParam,
}: PullRequestComparePageProps) {
  const { auth } = useSession();
  const [branches, setBranches] = useState<RepositoryBranchInfo[] | null>(null);
  const [base, setBase] = useState('');
  const [compare, setCompare] = useState('');
  const [result, setResult] = useState<CompareResult>({ kind: 'idle' });
  const [computing, setComputing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // REQ-6-2-3/REQ-6-2-4: creation-form state. The form opens from the
  // enabled “Create pull request” / “Create draft pull request” button;
  // while a form is open both comparison-page action buttons are hidden so
  // only the form's single submit button remains active.
  const [showForm, setShowForm] = useState<null | 'open' | 'draft'>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<CreatePullRequestErrors & { general?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  const repoBase = `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  const runCompare = useCallback(
    async (baseName: string, compareName: string) => {
      if (baseName === compareName) {
        // The same branch in both fields has no comparable commits; this
        // state is also shown immediately when the user selects it.
        setResult({ kind: 'no-changes' });
        return;
      }
      setComputing(true);
      setResult({ kind: 'idle' });
      const compareResult = await apiPullRequestCompare(
        owner,
        name,
        baseName,
        compareName
      );
      setComputing(false);
      if (compareResult.ok) {
        if (
          compareResult.compare.commitCount === 0 ||
          compareResult.compare.files.length === 0
        ) {
          // The branches are the same or have no differences: the creation
          // entry stays disabled.
          setResult({ kind: 'no-changes' });
        } else {
          setResult({ kind: 'compared', data: compareResult.compare });
        }
      } else if (compareResult.status === 401 || compareResult.status === 403) {
        setDenied(true);
      } else {
        setResult({ kind: 'error', message: compareResult.message });
      }
    },
    [owner, name]
  );

  useEffect(() => {
    let cancelled = false;
    setBranches(null);
    setResult({ kind: 'idle' });
    setDenied(false);
    setNotFound(false);
    setLoadError(false);
    setShowForm(null);
    setErrors({});
    apiRepositoryBranches(owner, name).then((branchResult) => {
      if (cancelled) {
        return;
      }
      if (branchResult.ok) {
        // Read/Triage/visitors may view existing PRs but cannot enter the
        // creation-comparison flow; the server derives canCreate from the
        // session's effective role and rejects comparison requests anyway.
        if (!branchResult.canCreate) {
          setDenied(true);
          return;
        }
        setBranches(branchResult.branches);
        const names = branchResult.branches.map((b) => b.name);
        const initialBase =
          baseParam !== '' && names.includes(baseParam)
            ? baseParam
            : branchResult.defaultBranch;
        const firstOther =
          branchResult.branches.find((b) => b.name !== initialBase)?.name ??
          initialBase;
        const initialCompare =
          compareParam !== '' && names.includes(compareParam)
            ? compareParam
            : firstOther;
        setBase(initialBase);
        setCompare(initialCompare);
        if (
          baseParam !== '' &&
          compareParam !== '' &&
          initialBase !== initialCompare
        ) {
          // A direct comparison-page entry with both branches already
          // selected opens the same usable creation flow immediately.
          void runCompare(initialBase, initialCompare);
        } else if (initialBase === initialCompare) {
          setResult({ kind: 'no-changes' });
        }
      } else if (branchResult.status === 403 || branchResult.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name, baseParam, compareParam, runCompare]);

  function handleBaseChange(value: string) {
    setBase(value);
    setShowForm(null);
    setErrors({});
    if (value === compare) {
      // Selecting the same branch in both fields immediately displays “No
      // changes” and disables the creation button — no Compare changes click
      // is required for this state.
      setResult({ kind: 'no-changes' });
    } else {
      setResult({ kind: 'idle' });
    }
  }

  function handleCompareChange(value: string) {
    setCompare(value);
    setShowForm(null);
    setErrors({});
    if (value === base) {
      setResult({ kind: 'no-changes' });
    } else {
      setResult({ kind: 'idle' });
    }
  }

  function handleCompareSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (computing) {
      return;
    }
    void runCompare(base, compare);
  }

  async function handleCreateSubmit(event: React.FormEvent, draft: boolean) {
    event.preventDefault();
    if (submitting || !hasChanges) {
      return;
    }
    setSubmitting(true);
    setErrors({});
    const createResult = await apiCreatePullRequest(owner, name, {
      title,
      description,
      base,
      compare,
      // REQ-6-2-4: the draft entry marks the request as a draft; a normal
      // creation omits the flag (the server defaults to Open).
      draft: draft ? true : undefined,
    });
    if (createResult.ok) {
      navigate(
        `${repoBase}/pulls/${createResult.pull.number}`
      );
      return;
    }
    setSubmitting(false);
    setErrors(
      createResult.errors && Object.keys(createResult.errors).length > 0
        ? createResult.errors
        : { general: createResult.message }
    );
  }

  if (denied) {
    return (
      <div className="repository-page repository-denied">
        <h1>Access denied</h1>
        <p className="muted-text">
          You do not have permission to create a pull request in this
          repository.
        </p>
        {auth.status === 'ready' && !auth.user ? (
          <a className="primary-link" href="#/signin">
            Sign in
          </a>
        ) : null}
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="repository-page">
        <h1>Comparing changes</h1>
        <p className="muted-text">
          The repository “{owner}/{name}” does not exist or is not accessible.
        </p>
      </div>
    );
  }

  const hasChanges = result.kind === 'compared';

  return (
    <div className="repository-page pull-compare-page">
      <h1>Comparing changes</h1>
      <p className="muted-text">
        <a className="repository-back-link" href={repoBase}>
          {owner}/{name}
        </a>
      </p>
      {loadError ? (
        <p role="alert" className="form-error">
          The branches could not be loaded.
        </p>
      ) : branches === null ? (
        <p className="loading">Loading…</p>
      ) : branches.length === 0 ? (
        <p className="muted-text">This repository has no branches yet.</p>
      ) : (
        <>
          <form className="compare-form" onSubmit={handleCompareSubmit}>
            <div className="field">
              <label htmlFor="pr-compare-base">base</label>
              <select
                id="pr-compare-base"
                value={base}
                onChange={(event) => handleBaseChange(event.target.value)}
              >
                {branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="pr-compare-compare">compare</label>
              <select
                id="pr-compare-compare"
                value={compare}
                onChange={(event) => handleCompareChange(event.target.value)}
              >
                {branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="primary-button"
              type="submit"
              disabled={computing}
            >
              Compare changes
            </button>
          </form>

          {!showForm ? (
            <div className="pull-compare-actions">
              {/* REQ-6-2-2/REQ-6-2-3: the normal creation entry — enabled
                  only for a valid selection with comparable commits and
                  changed files. Clicking it opens the normal creation form;
                  while a form is open both action buttons are hidden so they
                  never compete with the form's single submit button. */}
              <button
                type="button"
                className="primary-button"
                disabled={!hasChanges}
                onClick={() => {
                  setErrors({});
                  setShowForm('open');
                }}
              >
                Create pull request
              </button>
              {/* REQ-6-2-4: the visible draft comparison entry — clicking it
                  opens the draft creation form (Title + optional Description
                  + one “Create draft pull request” submit button); a draft
                  uses the same persisted fields as a normal PR but stores
                  the Draft state. */}
              <button
                type="button"
                className="primary-button"
                disabled={!hasChanges}
                onClick={() => {
                  setErrors({});
                  setShowForm('draft');
                }}
              >
                Create draft pull request
              </button>
            </div>
          ) : null}

          {showForm ? (
            <form
              className="pull-create-form"
              onSubmit={(event) =>
                void handleCreateSubmit(event, showForm === 'draft')
              }
            >
              <div className="field">
                <label htmlFor="pull-create-title">Title</label>
                <input
                  id="pull-create-title"
                  type="text"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setErrors((prev) => ({ ...prev, title: undefined }));
                  }}
                />
                {errors.title ? (
                  <p role="alert" className="form-error">
                    {errors.title}
                  </p>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="pull-create-description">Description</label>
                <textarea
                  id="pull-create-description"
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setErrors((prev) => ({ ...prev, description: undefined }));
                  }}
                  rows={6}
                />
                {errors.description ? (
                  <p role="alert" className="form-error">
                    {errors.description}
                  </p>
                ) : null}
              </div>
              {errors.general ? (
                <p role="alert" className="form-error">
                  {errors.general}
                </p>
              ) : null}
              <button
                type="submit"
                className="primary-button create-pull-request-submit"
                disabled={submitting}
              >
                {showForm === 'draft'
                  ? 'Create draft pull request'
                  : 'Create pull request'}
              </button>
            </form>
          ) : null}

          {computing ? (
            <p className="loading">Comparing…</p>
          ) : result.kind === 'no-changes' ? (
            <div className="compare-no-changes">
              <p className="compare-no-changes-title">No changes</p>
              <p className="muted-text">
                The base and compare branches are the same or have no
                differences.
              </p>
            </div>
          ) : result.kind === 'error' ? (
            <p role="alert" className="form-error">
              {result.message}
            </p>
          ) : result.kind === 'compared' ? (
            <div className="pull-compare-result">
              <section
                className="pull-compare-commits-section"
                aria-label="Commit summary"
              >
                <h2>Commit summary</h2>
                <p className="commit-summary-count">
                  {result.data.commitCount}{' '}
                  {result.data.commitCount === 1 ? 'commit' : 'commits'}
                </p>
                <ul className="pull-commits-list">
                  {result.data.commits.map((commit) => (
                    <li key={commit.id} className="pull-commit-item">
                      <code className="pull-commit-id">
                        {commit.shortId ?? commit.id.slice(0, 7)}
                      </code>
                      <span className="pull-commit-message">
                        {commit.message}
                      </span>
                      <span className="pull-commit-meta">
                        {commit.author ?? 'Unknown'}
                        {formatRelativeTime(commit.createdAt) !== ''
                          ? ` · ${formatRelativeTime(commit.createdAt)}`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              <DiffSummary
                files={result.data.files}
                additions={result.data.additions}
                deletions={result.data.deletions}
                fileHref={() => '#'}
              />
              {result.data.files.map((file) => (
                <div key={file.path} className="pull-file-diff">
                  <h3 className="pull-file-path">{file.path}</h3>
                  <DiffLines lines={file.lines ?? []} />
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
