import { useEffect, useState } from 'react';
import { apiRepositoryCommits } from '../api';
import { navigate } from '../router';
import type { RepositoryCommit } from '../types';

interface ComparePageProps {
  owner: string;
  name: string;
}

/**
 * REQ-4-2-2: the comparison page. Any repository-view user can select a base
 * revision (earlier/target) and a compare revision (newer) from the branch
 * history and click "Compare" to open the read-only diff page. Defaults are
 * the oldest commit as base and the newest commit as compare.
 */
export default function ComparePage({ owner, name }: ComparePageProps) {
  const [commits, setCommits] = useState<RepositoryCommit[] | null>(null);
  const [baseId, setBaseId] = useState('');
  const [compareId, setCompareId] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCommits(null);
    setNotFound(false);
    setLoadError(false);
    apiRepositoryCommits(owner, name).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setCommits(result.commits);
        if (result.commits.length > 0) {
          setBaseId(result.commits[result.commits.length - 1].id);
          setCompareId(result.commits[0].id);
        }
      } else if (result.status === 403 || result.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name]);

  const repoBase = `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  if (notFound) {
    return (
      <div className="repository-page">
        <h1>Compare changes</h1>
        <p className="muted-text">
          The repository “{owner}/{name}” does not exist or is not accessible.
        </p>
      </div>
    );
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (baseId && compareId) {
      navigate(
        `${repoBase}/compare/${encodeURIComponent(baseId)}/${encodeURIComponent(compareId)}`
      );
    }
  };

  return (
    <div className="repository-page compare-page">
      <h1>Compare changes</h1>
      <p className="muted-text">
        <a className="repository-back-link" href={repoBase}>
          {owner}/{name}
        </a>
      </p>
      {loadError ? (
        <p role="alert" className="form-error">
          The commits could not be loaded.
        </p>
      ) : commits === null ? (
        <p className="loading">Loading…</p>
      ) : commits.length === 0 ? (
        <p className="muted-text">No commits yet.</p>
      ) : (
        <form className="compare-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="compare-base">Base</label>
            <select
              id="compare-base"
              value={baseId}
              onChange={(event) => setBaseId(event.target.value)}
            >
              {commits.map((commit) => (
                <option key={commit.id} value={commit.id}>
                  {commit.shortId ?? commit.id.slice(0, 7)} {commit.message}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="compare-compare">Compare</label>
            <select
              id="compare-compare"
              value={compareId}
              onChange={(event) => setCompareId(event.target.value)}
            >
              {commits.map((commit) => (
                <option key={commit.id} value={commit.id}>
                  {commit.shortId ?? commit.id.slice(0, 7)} {commit.message}
                </option>
              ))}
            </select>
          </div>
          <button className="primary-button" type="submit" disabled={!baseId || !compareId}>
            Compare
          </button>
        </form>
      )}
    </div>
  );
}
