import { useEffect, useState } from 'react';
import { apiUserRepositories } from '../api';
import { useSession } from '../session';
import { useRedirectTo } from '../router';
import type { RepositorySummary } from '../types';

function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return 'Updated recently';
  }
  return `Updated ${date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })}`;
}

/**
 * REQ-3-2-1: the signed-in workspace. It provides the "New repository" link
 * (opening the repository-creation page) and the signed-in user's personal
 * repository list, so a newly created personal repository appears in the
 * target owner's repository list immediately and after reload.
 */
export function WorkspaceView() {
  const { auth } = useSession();
  const user = auth.user;
  const [repositories, setRepositories] = useState<RepositorySummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!user) {
      return;
    }
    let cancelled = false;
    setLoadError(false);
    setRepositories(null);
    apiUserRepositories(user.username)
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.ok) {
          setRepositories(result.repositories);
        } else {
          setLoadError(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user ? user.username : null]);

  if (!user) {
    return null;
  }
  return (
    <div className="workspace-page">
      <h1>Workspace</h1>
      <p className="signed-in-as">
        Signed in as <strong>{user.username}</strong>
      </p>
      <a className="new-repository-link" href="#/new-repository">
        New repository
      </a>
      <section className="workspace-repositories" aria-label="Repositories">
        <h2>Repositories</h2>
        {loadError ? (
          <p role="alert" className="form-error">
            Repositories could not be loaded.
          </p>
        ) : repositories === null ? (
          <p className="loading">Loading…</p>
        ) : repositories.length === 0 ? (
          <p className="muted-text">No repositories yet.</p>
        ) : (
          <ul className="repository-list workspace-repository-list">
            {repositories.map((repo) => (
              <li key={repo.name} className="repository-list-item">
                <a
                  className="repository-name-link"
                  href={`#/repositories/${encodeURIComponent(
                    repo.owner
                  )}/${encodeURIComponent(repo.name)}`}
                >
                  {repo.name}
                </a>
                {repo.description ? (
                  <p className="repository-description">{repo.description}</p>
                ) : null}
                <div className="repository-meta">
                  <span className="repository-visibility">
                    {repo.visibility === 'public' ? 'Public' : 'Private'}
                  </span>
                  <span className="repository-updated">
                    {formatUpdatedAt(repo.updatedAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Protected destination after sign-in. Unauthenticated visitors are sent to
 * the sign-in page; the session check itself happens on the server.
 */
export default function WorkspacePage() {
  const { auth } = useSession();
  const needsAuth = auth.status !== 'ready' || !auth.user;
  useRedirectTo('#/signin', needsAuth);
  if (needsAuth) {
    return null;
  }
  return <WorkspaceView />;
}
