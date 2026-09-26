import { useEffect, useState } from 'react';
import { apiRepositoryCommitDetail } from '../api';
import { useSession } from '../session';
import DiffLines from '../components/DiffLines';
import type { RepositoryCommitDetail, RepositoryDiffFile } from '../types';

interface CommitFileDiffPageProps {
  owner: string;
  name: string;
  commitId: string;
  file: string;
}

/**
 * REQ-4-2-2: the line-by-line diff of one changed file of a commit (compared
 * against its parent revision). The page displays the file path, the base and
 * compare revision identifiers, and the added/deleted lines; unchanged files
 * are not reachable as a diff. Reloading keeps the same state because the
 * page re-reads the persisted server state from the URL.
 */
export default function CommitFileDiffPage({ owner, name, commitId, file }: CommitFileDiffPageProps) {
  const { auth } = useSession();
  const [commit, setCommit] = useState<RepositoryCommitDetail | null>(null);
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCommit(null);
    setDenied(false);
    setNotFound(false);
    setLoadError(false);
    apiRepositoryCommitDetail(owner, name, commitId).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setCommit(result.commit);
      } else if (result.status === 403) {
        setDenied(true);
      } else {
        setNotFound(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name, commitId]);

  const repoBase = `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  if (denied) {
    return (
      <div className="repository-page repository-denied">
        <h1>Access denied</h1>
        <p className="muted-text">
          You do not have permission to view this repository.
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
        <h1 className="repository-title">
          {owner}/{name}
        </h1>
        <p className="muted-text">
          The commit “{commitId}” does not exist or is not accessible.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="repository-page">
        <h1 className="repository-title">
          {owner}/{name}
        </h1>
        <p role="alert" className="form-error">
          The diff could not be loaded.
        </p>
      </div>
    );
  }

  if (commit === null) {
    return (
      <div className="repository-page">
        <h1 className="repository-title">
          {owner}/{name}
        </h1>
        <p className="loading">Loading…</p>
      </div>
    );
  }

  const diffFile: RepositoryDiffFile | undefined = (commit.files ?? []).find(
    (f) => f.path === file
  );

  return (
    <div className="repository-page commit-file-diff-page">
      <h1 className="repository-title">
        {owner}/{name}
      </h1>
      <nav className="file-path-line" aria-label="Path breadcrumbs">
        <a className="repository-back-link" href={repoBase}>
          {owner}/{name}
        </a>
        <span className="path-separator" aria-hidden="true">
          /
        </span>
        <span>commit</span>
        <span className="path-separator" aria-hidden="true">
          /
        </span>
        <a className="path-link" href={`${repoBase}/commit/${encodeURIComponent(commit.id)}`}>
          {commit.shortId}
        </a>
        <span className="path-separator" aria-hidden="true">
          /
        </span>
        <span className="path-current">{file}</span>
      </nav>
      <h2 className="diff-file-title">{file}</h2>
      <p className="diff-identifiers">
        <span>
          <strong>Base</strong>{' '}
          {commit.base ? (
            <a
              className="diff-revision-link"
              href={`${repoBase}/commit/${encodeURIComponent(commit.base.id)}`}
            >
              {commit.base.shortId}
            </a>
          ) : (
            'none'
          )}
        </span>
        <span aria-hidden="true"> … </span>
        <span>
          <strong>Compare</strong>{' '}
          <a
            className="diff-revision-link"
            href={`${repoBase}/commit/${encodeURIComponent(commit.id)}`}
          >
            {commit.shortId}
          </a>
        </span>
      </p>
      {diffFile ? (
        <>
          <p className="diff-file-stats-line">
            +{diffFile.additions ?? 0} -{diffFile.deletions ?? 0}
          </p>
          <DiffLines lines={diffFile.lines ?? []} />
        </>
      ) : (
        <p className="muted-text">
          The file “{file}” was not changed in this commit.
        </p>
      )}
    </div>
  );
}
