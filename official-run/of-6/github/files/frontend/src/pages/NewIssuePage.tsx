import { useEffect, useState } from 'react';
import { apiCreateIssue, apiRepository } from '../api';
import { navigate } from '../router';
import { useSession } from '../session';
import type { CreateIssueErrors } from '../types';

interface NewIssuePageProps {
  owner: string;
  name: string;
}

/** REQ-5-2-1: roles allowed to create repository issues (Read and Triage only view). */
const ISSUE_WRITE_ROLES = new Set(['write', 'maintain', 'admin']);

/**
 * REQ-5-2-1: the repository issue creation form, opened by clicking the
 * “New issue” link on the Issues list page. The form has fields labeled
 * “Title” and “Description” and a “Submit new issue” button. Only Write,
 * Maintain, Admin, or organization Owner accounts may submit (Read and
 * Triage only view; the server re-checks the role on every submission). The
 * server trims and validates the title (1–256 non-empty characters) and the
 * optional description (≤65536 characters), assigns the next incrementing
 * repository-scoped number, and persists the issue plus its creation
 * activity in one atomic write. On success the page opens the new issue
 * detail page (its heading is exactly the entered title, and the exact saved
 * description is displayed); rejected submissions display the reason and
 * create neither an issue nor a number.
 */
export default function NewIssuePage({ owner, name }: NewIssuePageProps) {
  const { auth } = useSession();
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [ready, setReady] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<CreateIssueErrors & { general?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDenied(false);
    setNotFound(false);
    setLoadError(false);
    setReady(false);
    setErrors({});
    apiRepository(owner, name).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        if (result.status === 403) {
          setDenied(true);
        } else {
          setNotFound(true);
        }
        return;
      }
      // REQ-5-2-1: only Write, Maintain, Admin, or organization Owner may
      // open the creation form (Read/Triage/visitors only view; the server
      // re-checks the role on every submission).
      if (!ISSUE_WRITE_ROLES.has(result.repository.role ?? '')) {
        setDenied(true);
        return;
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name]);

  const handleSubmit = async () => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setErrors({});
    const result = await apiCreateIssue(owner, name, {
      title,
      body: description,
    });
    if (result.ok) {
      navigate(
        `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(
          name
        )}/issues/${result.issue.number}`
      );
      return;
    }
    setSubmitting(false);
    setErrors(
      result.errors && Object.keys(result.errors).length > 0
        ? result.errors
        : { general: result.message }
    );
  };

  const repoBase = `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  if (denied) {
    return (
      <div className="repository-page new-issue-page">
        <h1 className="repository-title">
          {owner}/{name}
        </h1>
        <h2>Access denied</h2>
        <p className="muted-text">
          You do not have permission to create issues in this repository.
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
      <div className="repository-page new-issue-page">
        <h1 className="repository-title">
          {owner}/{name}
        </h1>
        <h2>Issue not found</h2>
        <p className="muted-text">
          The repository “{owner}/{name}” does not exist or is not accessible.
        </p>
      </div>
    );
  }

  return (
    <div className="repository-page new-issue-page">
      <h1 className="repository-title">
        {owner}/{name}
      </h1>
      <p className="muted-text">
        <a className="repository-back-link" href={`${repoBase}/issues`}>
          Issues
        </a>
      </p>
      <h2 className="new-issue-heading">New issue</h2>
      {loadError ? (
        <p role="alert" className="form-error">
          The repository could not be loaded.
        </p>
      ) : !ready ? (
        <p className="loading">Loading…</p>
      ) : (
        <form
          className="new-issue-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="field">
            <label htmlFor="new-issue-title">Title</label>
            <input
              id="new-issue-title"
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
            <label htmlFor="new-issue-description">Description</label>
            <textarea
              id="new-issue-description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setErrors((prev) => ({ ...prev, body: undefined }));
              }}
              rows={6}
            />
            {errors.body ? (
              <p role="alert" className="form-error">
                {errors.body}
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
            className="primary-button submit-new-issue-button"
            disabled={submitting}
          >
            Submit new issue
          </button>
        </form>
      )}
    </div>
  );
}
