import { useEffect, useState } from 'react';
import { apiRepositoryCommitDetail } from '../api';
import { formatRelativeTime } from '../format';
import { useSession } from '../session';
import DiffSummary from '../components/DiffSummary';
import type { RepositoryCommitDetail } from '../types';

interface CommitDetailPageProps {
  owner: string;
  name: string;
  commitId: string;
}

/**
 * REQ-4-2-1/REQ-4-2-2: commit detail page (the read-only diff of a commit
 * versus its first parent). Shows the repository, the commit message, the
 * stored commit identifier (short hash), author, relative time, the base
 * (parent) and compare (commit) revision identifiers, and the "Changed files"
 * summary with the numeric additions/deletions for the whole diff and per
 * changed file. Every changed file links to its own line-by-line diff; an
 * unchanged file never appears. Refreshing re-reads the same persisted state.
 */
export default function CommitDetailPage({ owner, name, commitId }: CommitDetailPageProps) {
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

  return (
    <div className="repository-page commit-detail-page">
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
        <span className="path-current">
          {commit ? commit.shortId : commitId.slice(0, 7)}
        </span>
      </nav>
      {loadError ? (
        <p role="alert" className="form-error">
          The commit could not be loaded.
        </p>
      ) : commit === null ? (
        <p className="loading">Loading…</p>
      ) : (
        <div className="commit-detail">
          <h2 className="commit-detail-message">{commit.message}</h2>
          <p className="commit-detail-meta">
            <span className="commit-detail-author">{commit.author ?? 'Unknown'}</span>
            <span aria-hidden="true"> · </span>
            <span>{formatRelativeTime(commit.createdAt) || commit.createdAt}</span>
          </p>
          <dl className="commit-detail-info">
            <div>
              <dt>Commit</dt>
              <dd>
                <code>{commit.shortId}</code>
              </dd>
            </div>
            <div>
              <dt>Parent</dt>
              <dd>
                {commit.parents.length > 0 ? (
                  commit.parents.map((parent) => (
                    <span key={parent.id} className="commit-parent">
                      <a
                        className="commit-parent-link"
                        href={`${repoBase}/commit/${encodeURIComponent(parent.id)}`}
                      >
                        {parent.shortId}
                      </a>
                      <span className="commit-parent-message">{parent.message}</span>
                    </span>
                  ))
                ) : (
                  'No parent'
                )}
              </dd>
            </div>
          </dl>
          <DiffSummary
            files={commit.files ?? []}
            additions={commit.additions ?? 0}
            deletions={commit.deletions ?? 0}
            fileHref={(filePath) =>
              `${repoBase}/commit/${encodeURIComponent(commit.id)}/${filePath}`
            }
          />
        </div>
      )}
    </div>
  );
}
