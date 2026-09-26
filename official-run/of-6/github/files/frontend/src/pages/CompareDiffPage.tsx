import { useEffect, useState } from 'react';
import { apiRepositoryCompare } from '../api';
import { useSession } from '../session';
import DiffSummary from '../components/DiffSummary';
import type { RepositoryCompareResult } from '../types';

interface CompareDiffPageProps {
  owner: string;
  name: string;
  base: string;
  compare: string;
}

/**
 * REQ-4-2-2: the diff page between a base and a compare revision. Displays
 * the base and compare identifiers, the "Changed files" summary (only changed
 * files, with per-file added/deleted line counts and the aggregate numbers),
 * and links every changed file to its own line-by-line diff. The comparison
 * is read-only: no review, comment, or commit is created, and refreshing
 * re-reads the same persisted state.
 */
export default function CompareDiffPage({ owner, name, base, compare }: CompareDiffPageProps) {
  const { auth } = useSession();
  const [result, setResult] = useState<RepositoryCompareResult | null>(null);
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setDenied(false);
    setNotFound(false);
    setLoadError(false);
    apiRepositoryCompare(owner, name, base, compare).then((res) => {
      if (cancelled) {
        return;
      }
      if (res.ok) {
        setResult(res);
      } else if (res.status === 403) {
        setDenied(true);
      } else {
        setNotFound(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name, base, compare]);

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
          The comparison could not be displayed: one of the revisions is not
          accessible.
        </p>
      </div>
    );
  }

  return (
    <div className="repository-page compare-diff-page">
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
        <span>compare</span>
        <span className="path-separator" aria-hidden="true">
          /
        </span>
        <span className="path-current">
          {result && result.ok
            ? `${result.base ? result.base.shortId : 'none'}...${result.compare.shortId}`
            : `${base.slice(0, 7)}...${compare.slice(0, 7)}`}
        </span>
      </nav>
      {loadError ? (
        <p role="alert" className="form-error">
          The diff could not be loaded.
        </p>
      ) : result === null ? (
        <p className="loading">Loading…</p>
      ) : !result.ok ? (
        <p role="alert" className="form-error">
          The diff could not be loaded.
        </p>
      ) : (
        <div className="compare-diff">
          <h2 className="compare-diff-title">
            {result.compare.message}
          </h2>
          <p className="diff-identifiers">
            <span>
              <strong>Base</strong>{' '}
              {result.base ? (
                <a
                  className="diff-revision-link"
                  href={`${repoBase}/commit/${encodeURIComponent(result.base.id)}`}
                >
                  {result.base.shortId}
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
                href={`${repoBase}/commit/${encodeURIComponent(result.compare.id)}`}
              >
                {result.compare.shortId}
              </a>
            </span>
          </p>
          <DiffSummary
            files={result.files}
            additions={result.additions}
            deletions={result.deletions}
            fileHref={(filePath) =>
              `${repoBase}/compare/${encodeURIComponent(base)}/${encodeURIComponent(compare)}/${filePath}`
            }
          />
        </div>
      )}
    </div>
  );
}
