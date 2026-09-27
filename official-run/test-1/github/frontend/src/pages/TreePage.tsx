import { useEffect, useState } from 'react';
import { apiRepositoryTree, isApiError } from '../api';
import type { FileEntry } from '../api';
import { blobUrl, treeUrl } from '../repository';

export default function TreePage({
  owner,
  name,
  branch,
  path,
}: {
  owner: string;
  name: string;
  branch: string;
  path: string;
}) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; entries: FileEntry[] }
    | { status: 'notFound' }
    | { status: 'error' }
  >({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    apiRepositoryTree(owner, name, path)
      .then(({ entries }) => {
        if (!cancelled) setState({ status: 'ready', entries });
      })
      .catch((err) => {
        if (cancelled) return;
        if (isApiError(err) && err.status === 404) {
          setState({ status: 'notFound' });
        } else {
          setState({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name, path, attempt]);

  if (state.status === 'loading') {
    return (
      <main className="repo-page">
        <p>Loading…</p>
      </main>
    );
  }

  if (state.status === 'notFound') {
    return (
      <main className="repo-page">
        <h1>Directory not found</h1>
        <p className="muted">The directory does not exist or you do not have access to it.</p>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="repo-page">
        <div role="alert">
          <p className="form-error">Directory could not be loaded. Please try again.</p>
          <button type="button" className="secondary-button" onClick={() => setAttempt((v) => v + 1)}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  const displayPath = path || '';
  return (
    <main className="repo-page">
      <h1>{displayPath.split('/').pop() || owner}</h1>
      <p className="repo-meta">
        {owner}/{name} at <strong>{branch}</strong>
      </p>
      <ul className="file-list">
        {state.entries.map((entry) => (
          <li key={entry.path}>
            {entry.type === 'directory' ? (
              <a className="file-entry" href={treeUrl(owner, name, branch, entry.path)}>
                {entry.name}
              </a>
            ) : (
              <a className="file-entry" href={blobUrl(owner, name, branch, entry.path)}>
                {entry.name}
              </a>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
