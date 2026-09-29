import { useEffect, useRef, useState, type FormEvent } from "react";

import { ApiError } from "../../lib/api";
import { navigate, useHashLocation } from "../../lib/hash-route";
import { Button } from "../../ui";
import { RepoNav } from "../issues/RepoNav";
import { AccessDenied } from "../organizations/AccessDenied";
import {
  createPullRequest,
  getComparisonData,
  type ComparisonData,
} from "./api";

// PR comparison page: base is the target branch that receives the merge
// result, compare is the source branch that provides the changes. The page is
// read-only before creation; comparison never saves a PR, commit or branch
// change. Selecting the same branch in both fields immediately displays
// "No changes" and disables the creation entry.
export function PullRequestNewPage({ owner, name }: { owner: string; name: string }) {
  const location = useHashLocation();
  const baseParam = location.search.get("base") ?? "";
  const compareParam = location.search.get("compare") ?? "";
  const [data, setData] = useState<ComparisonData | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "denied" | "missing">("loading");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setData(null);
    getComparisonData(owner, name, baseParam, compareParam)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStatus("ok");
        // Fresh entry without branch parameters defaults to the first two
        // branches so the comparison flow starts with a usable selection.
        // Only on first load: later empty parameters (e.g. after navigating
        // away) must not re-select branches.
        if (!initializedRef.current) {
          initializedRef.current = true;
          if (!baseParam && !compareParam) {
            const first = result.branches[0];
            const second = result.branches[1] ?? first;
            if (first) {
              navigate(
                `/repos/${owner}/${name}/pulls/new`,
                new URLSearchParams({ base: first, compare: second }),
              );
            }
          }
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setStatus("denied");
        else if (error instanceof ApiError && error.status === 401) setStatus("denied");
        else setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name, baseParam, compareParam]);

  if (status === "denied") {
    return (
      <section className="pulls-new">
        <RepoNav owner={owner} name={name} active="pulls" />
        <AccessDenied />
      </section>
    );
  }
  if (status === "missing") {
    return (
      <section className="pulls-new">
        <RepoNav owner={owner} name={name} active="pulls" />
        <h1>Compare changes</h1>
        <p className="pulls-new__empty">Not found</p>
      </section>
    );
  }
  if (status === "loading" || !data) {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }

  const branches = data.branches;
  const base = baseParam || branches[0] || "";
  const compare = compareParam || branches[1] || branches[0] || "";
  const sameBranch = base !== "" && base === compare;
  const noChanges = sameBranch || data.reason !== null || !data.valid;
  const valid = !sameBranch && data.valid;

  const selectBranch = (field: "base" | "compare", value: string) => {
    const nextBase = field === "base" ? value : base;
    const nextCompare = field === "compare" ? value : compare;
    navigate(
      `/repos/${owner}/${name}/pulls/new`,
      new URLSearchParams({ base: nextBase, compare: nextCompare }),
    );
  };

  const compareChanges = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate(
      `/repos/${owner}/${name}/pulls/new`,
      new URLSearchParams({ base, compare }),
    );
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    const result = await createPullRequest(owner, name, {
      base,
      compare,
      title,
      description,
      draft,
    });
    setBusy(false);
    if (result.ok) {
      navigate(`/repos/${owner}/${name}/pulls/${result.pull.number}`);
      return;
    }
    setFieldErrors(result.errors);
  };

  const openCreateForm = (isDraft: boolean) => {
    setCreating(true);
    setDraft(isDraft);
  };

  return (
    <section className="pulls-new">
      <RepoNav owner={owner} name={name} active="pulls" />
      <h1>Compare changes</h1>
      <p className="pulls-new__intro">
        Compare the changes between the base and compare branches before opening
        a pull request.
      </p>

      <form className="pulls-new__compare-form" onSubmit={compareChanges}>
        <div className="ui-field">
          <label htmlFor="pull-base">base</label>
          <select
            id="pull-base"
            value={base}
            onChange={(event) => selectBranch("base", event.target.value)}
          >
            {branches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label htmlFor="pull-compare">compare</label>
          <select
            id="pull-compare"
            value={compare}
            onChange={(event) => selectBranch("compare", event.target.value)}
          >
            {branches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="primary" className="pulls-new__compare-button">
          Compare changes
        </Button>
      </form>

      {noChanges ? (
        <p className="pulls-new__no-changes">No changes</p>
      ) : (
        <>
          {data.files.length > 0 ? (
            <section className="pulls-new__result">
              <div className="pulls-new__commit-summary">
                <h2>Commit summary</h2>
                <p>
                  {data.commitCount} {data.commitCount === 1 ? "commit" : "commits"}
                </p>
              </div>
              <div className="pulls-new__files">
                <h2>Changed files</h2>
                <ul>
                  {data.files.map((file) => (
                    <li key={file.path}>
                      <span className="pulls-new__file-path">{file.path}</span>
                      <span className="pulls-new__file-counts">
                        +{file.additions} -{file.deletions}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="pulls-new__diff-summary">
                {data.totalAdditions} additions, {data.totalDeletions} deletions
              </p>
            </section>
          ) : null}

          {creating ? (
            <form className="pulls-new__create-form" onSubmit={submit}>
              <div className="ui-field">
                <label htmlFor="pull-title">Title</label>
                <input
                  id="pull-title"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    if (fieldErrors.title) {
                      setFieldErrors((previous) => {
                        const next = { ...previous };
                        delete next.title;
                        return next;
                      });
                    }
                  }}
                />
                {fieldErrors.title ? (
                  <p role="alert" className="ui-field__error">
                    {fieldErrors.title}
                  </p>
                ) : null}
              </div>
              <div className="ui-field">
                <label htmlFor="pull-description">Description</label>
                <textarea
                  id="pull-description"
                  rows={5}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
                {fieldErrors.description ? (
                  <p role="alert" className="ui-field__error">
                    {fieldErrors.description}
                  </p>
                ) : null}
              </div>
              {fieldErrors.branch ? (
                <p role="alert" className="ui-field__error">
                  {fieldErrors.branch}
                </p>
              ) : null}
              <Button type="submit" variant="primary" disabled={busy}>
                {draft ? "Create draft pull request" : "Create pull request"}
              </Button>
            </form>
          ) : (
            <div className="pulls-new__actions">
              <Button
                variant="primary"
                className="pulls-new__create-button"
                onClick={() => openCreateForm(false)}
              >
                Create pull request
              </Button>
              <Button
                variant="secondary"
                className="pulls-new__draft-button"
                onClick={() => openCreateForm(true)}
              >
                Create draft pull request
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
