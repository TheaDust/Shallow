import { useEffect, useState } from 'react';
import { apiRepositoryFile } from '../api';
import { navigate } from '../router';
import { formatRelativeTime } from '../format';
import type { RepositoryFileCommit, RepositoryFileEntry } from '../types';

interface FileContentPageProps {
  owner: string;
  name: string;
  branch: string;
  file: string;
}


/**
 * REQ-3-2-1/REQ-4-1/REQ-4-2-1: file-content page. REQ-4-1: displays the full
 * path as breadcrumbs (each parent segment can return to its directory page),
 * the current branch, the most recent commit of the file on that branch, and
 * the readable stored content. REQ-4-2-1: exposes one history link named
 * "Commits" that opens the file-scoped commit history of this file. Reloading
 * keeps the branch, path, and content because they are read from the persisted
 * server state via the URL.
 */
export default function FileContentPage({ owner, name, branch, file }: FileContentPageProps) {
  const [fileData, setFileData] = useState<{
    file: RepositoryFileEntry;
    commit: RepositoryFileCommit | null;
  } | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFileData(null);
    setRole(null);
    setNotFound(false);
    setLoadError(false);
    apiRepositoryFile(owner, name, branch, file).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setFileData({ file: result.file, commit: result.commit ?? null });
        setRole(result.role ?? null);
      } else if (result.status === 403 || result.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name, branch, file]);

  const repoBase = `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const treeBase = `${repoBase}/tree/${encodeURIComponent(branch)}`;
  const pathSegments = file.split('/');
  const filePathPart = pathSegments.map((s) => encodeURIComponent(s)).join('/');
  // REQ-4-2-1: the file page's single history link opens the history of the
  // commits that modified this file on this branch.
  const fileCommitsHref = `${repoBase}/commits/${encodeURIComponent(branch)}/${filePathPart}`;
  // REQ-4-4: Write, Maintain, Admin, and organization Owner accounts can edit
  // the file through the editor opened from this "Edit" entry; Read, Triage,
  // and visitors only view (the server re-checks the role on submission).
  const canEdit = role === 'write' || role === 'maintain' || role === 'admin';
  const editHref = `${repoBase}/edit/${encodeURIComponent(branch)}/${filePathPart}`;

  if (notFound) {
    return (
      <div className="repository-page file-page">
        <h1 className="repository-title">
          {owner}/{name}
        </h1>
        <p className="muted-text">
          The file “{file}” does not exist or is not accessible.
        </p>
      </div>
    );
  }

  return (
    <div className="repository-page file-page">
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
          const prefix = pathSegments
            .slice(0, index + 1)
            .map((s) => encodeURIComponent(s))
            .join('/');
          return (
            <span key={`${segment}-${index}`} className="path-part">
              <span className="path-separator" aria-hidden="true">
                /
              </span>
              {isLast ? (
                <span className="path-current">{segment}</span>
              ) : (
                <a className="path-link" href={`${treeBase}/${prefix}`}>
                  {segment}
                </a>
              )}
            </span>
          );
        })}
      </nav>
      <div className="file-actions-line">
        {/* REQ-4-4: the editor opened from this Edit entry; only Write,
            Maintain, Admin, and organization Owner accounts see it. */}
        {canEdit ? (
          <button
            type="button"
            className="file-edit-button"
            onClick={() => navigate(editHref)}
          >
            Edit
          </button>
        ) : null}
        <a className="file-commits-link" href={fileCommitsHref}>
          Commits
        </a>
      </div>
      {loadError ? (
        <p role="alert" className="form-error">
          The file could not be loaded.
        </p>
      ) : fileData === null ? (
        <p className="loading">Loading…</p>
      ) : (
        <>
          {fileData.commit ? (
            <p className="file-commit-line">
              Latest commit{' '}
              <strong className="file-commit-message">{fileData.commit.message}</strong>
              <span className="file-commit-meta">
                {fileData.commit.author ?? 'Unknown'}
                {formatRelativeTime(fileData.commit.createdAt)
                  ? ` · ${formatRelativeTime(fileData.commit.createdAt)}`
                  : ''}
              </span>
            </p>
          ) : null}
          <pre className="file-content">{fileData.file.content}</pre>
        </>
      )}
    </div>
  );
}
