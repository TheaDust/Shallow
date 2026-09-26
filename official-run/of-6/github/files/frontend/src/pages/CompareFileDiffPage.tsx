import { useEffect, useState } from 'react';
import { apiRepositoryCompare } from '../api';
import { useSession } from '../session';
import DiffLines from '../components/DiffLines';
import type { RepositoryCompareResult, RepositoryDiffFile } from '../types';

interface CompareFileDiffPageProps {
  owner: string;
  name: string;
  base: string;
  compare: string;
  file: string;
}

/**
 * REQ-4-2-2: the line-by-line diff of one changed file of a comparison. The
 * page displays the file path, the base and compare revision identifiers, and
 * the added/deleted lines. Reloading keeps the same state because the page
 * re-reads the persisted server state from the URL.
 */
export default function CompareFileDiffPage({
  owner,
  name,
  base,
  compare,
  file,
}: CompareFileDiffPageProps) {
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

  if (result === null) {
    return (
      <div className="repository-page">
        <h1 className="repository-title">
          {owner}/{name}
        </h1>
        <p className="loading">Loading…</p>
      </div>
    );
  }

  if (!result.ok) {
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

  const diffFile: RepositoryDiffFile | undefined = result.files.find(
    (f) => f.path === file
  );

  return (
    <div className="repository-page compare-file-diff-page">
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
        <a
          className="path-link"
          href={`${repoBase}/compare/${encodeURIComponent(base)}/${encodeURIComponent(compare)}`}
        >
          {result.base ? result.base.shortId : 'none'}...{result.compare.shortId}
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
      {diffFile ? (
        <>
          <p className="diff-file-stats-line">
            +{diffFile.additions ?? 0} -{diffFile.deletions ?? 0}
          </p>
          <DiffLines lines={diffFile.lines ?? []} />
        </>
      ) : (
        <p className="muted-text">
          The file “{file}” was not changed in this comparison.
        </p>
      )}
    </div>
  );
}
