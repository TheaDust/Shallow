import { useEffect, useState } from 'react';
import { apiRepository, apiRepositoryFile, apiWriteRepositoryFile } from '../api';
import { navigate } from '../router';
import { useSession } from '../session';
import type { FileWriteErrors } from '../types';

interface FileEditorPageProps {
  owner: string;
  name: string;
  branch: string;
  path: string;
  mode: 'create' | 'edit';
}

/** REQ-4-4: roles allowed to submit file changes (Read and Triage only view). */
const FILE_WRITE_ROLES = new Set(['write', 'maintain', 'admin']);

/**
 * REQ-4-4: the web file editor opened from the Code page's "Add file" ->
 * "Create new file" menuitem (create mode, empty fields) or from a file
 * page's "Edit" entry (edit mode, pre-filled with the stored name/content).
 * The form has a field labeled "File name", a textbox named "File contents",
 * an initially empty field labeled "Commit message", and a "Commit changes"
 * button. Submitting stores the file-path + content change, the commit
 * message, author, parent commit, and target branch as one indivisible record
 * and moves the branch head to the new commit; on success the page opens the
 * saved file view (its "Commits" link then shows the exact submitted
 * message). Rejections (invalid path, noncompliant message, protected branch,
 * persistence failure) display the reason and change neither the file, the
 * branch head, nor the commit history.
 */
export default function FileEditorPage({
  owner,
  name,
  branch,
  path,
  mode,
}: FileEditorPageProps) {
  const { auth } = useSession();
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [ready, setReady] = useState(false);
  const [fileName, setFileName] = useState(mode === 'edit' ? path : '');
  const [contents, setContents] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [errors, setErrors] = useState<FileWriteErrors & { general?: string }>({});
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
      // REQ-4-4: only Write, Maintain, Admin, or organization Owner may
      // submit; Read/Triage/visitors only view (the server re-checks this on
      // every submission).
      if (!FILE_WRITE_ROLES.has(result.repository.role ?? '')) {
        setDenied(true);
        return;
      }
      if (mode === 'edit') {
        apiRepositoryFile(owner, name, branch, path).then((fileResult) => {
          if (cancelled) {
            return;
          }
          if (fileResult.ok) {
            setFileName(fileResult.file.path);
            setContents(fileResult.file.content);
            setReady(true);
          } else if (fileResult.status === 403 || fileResult.status === 404) {
            setNotFound(true);
          } else {
            setLoadError(true);
          }
        });
      } else {
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name, branch, path, mode]);

  const handleSubmit = async () => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setErrors({});
    const result = await apiWriteRepositoryFile(owner, name, {
      branch,
      path: fileName,
      content: contents,
      message: commitMessage,
    });
    if (result.ok) {
      const pathPart = result.file.path
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      navigate(
        `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(
          name
        )}/blob/${encodeURIComponent(branch)}/${pathPart}`
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
  const treeBase = `${repoBase}/tree/${encodeURIComponent(branch)}`;
  const pathSegments = path === '' ? [] : path.split('/');
  const generalError = errors.general ?? errors.branch;

  if (denied) {
    return (
      <div className="repository-page file-editor-page">
        <h1 className="repository-title">
          {owner}/{name}
        </h1>
        <h2>Access denied</h2>
        <p className="muted-text">
          You do not have permission to edit files in this repository.
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
      <div className="repository-page file-editor-page">
        <h1 className="repository-title">
          {owner}/{name}
        </h1>
        <h2>File not found</h2>
        <p className="muted-text">
          The file “{path}” does not exist or is not accessible.
        </p>
      </div>
    );
  }

  return (
    <div className="repository-page file-editor-page">
      <h1 className="repository-title">
        {owner}/{name}
      </h1>
      <nav className="file-path-line" aria-label="Path breadcrumbs">
        <a className="repository-back-link" href={treeBase}>
          {owner}/{name}
        </a>
        <span className="path-separator" aria-hidden="true">
          /
        </span>
        <span className="path-branch">{branch}</span>
        {pathSegments.map((segment, index) => {
          const isLast = index === pathSegments.length - 1;
          return (
            <span key={`${segment}-${index}`} className="path-part">
              <span className="path-separator" aria-hidden="true">
                /
              </span>
              {isLast ? (
                <span className="path-current">{segment}</span>
              ) : (
                <span className="path-part-text">{segment}</span>
              )}
            </span>
          );
        })}
      </nav>
      <h2 className="editor-heading">
        {mode === 'create' ? 'Create new file' : 'Edit file'}
      </h2>
      {loadError ? (
        <p role="alert" className="form-error">
          The file could not be loaded.
        </p>
      ) : !ready ? (
        <p className="loading">Loading…</p>
      ) : (
        <form
          className="file-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="field">
            <label htmlFor="file-name">File name</label>
            <input
              id="file-name"
              type="text"
              value={fileName}
              onChange={(event) => {
                setFileName(event.target.value);
                setErrors((prev) => ({ ...prev, path: undefined }));
              }}
            />
            {errors.path ? (
              <p role="alert" className="form-error">
                {errors.path}
              </p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="file-contents">File contents</label>
            <textarea
              id="file-contents"
              value={contents}
              onChange={(event) => setContents(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="commit-message">Commit message</label>
            <input
              id="commit-message"
              type="text"
              value={commitMessage}
              onChange={(event) => {
                setCommitMessage(event.target.value);
                setErrors((prev) => ({ ...prev, message: undefined }));
              }}
            />
            {errors.message ? (
              <p role="alert" className="form-error">
                {errors.message}
              </p>
            ) : null}
          </div>
          {generalError ? (
            <p role="alert" className="form-error">
              {generalError}
            </p>
          ) : null}
          <button
            type="submit"
            className="primary-button commit-changes-button"
            disabled={submitting}
          >
            Commit changes
          </button>
        </form>
      )}
    </div>
  );
}
