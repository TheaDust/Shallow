import { useEffect, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import {
  listOwnerRepositories,
  repositoryVisibilityLabel,
  type RepositorySummary,
} from "../lib/repositories-api";
import { repositoryOverviewHref } from "../lib/repository-routes";

function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return updatedAt;
  return date.toISOString().slice(0, 10);
}

/**
 * Signed-in workspace: the "New repository" entry (REQ-3-2-1) and the personal
 * repository list of the current account, which is refreshed from the server so
 * a newly created repository or fork appears here as well.
 */
export function WorkspacePage() {
  const { status, account } = useAuth();
  const [repositories, setRepositories] = useState<RepositorySummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!account) {
      setRepositories(null);
      return;
    }
    let active = true;
    setRepositories(null);
    setFailed(false);
    listOwnerRepositories(account.username)
      .then((result) => {
        if (active) setRepositories(result.repositories ?? []);
      })
      .catch(() => {
        if (!active) return;
        setRepositories([]);
        setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [account]);

  return (
    <main aria-busy={status === "loading" ? true : undefined}>
      <h1>Workspace</h1>
      {status === "loading" ? (
        <p role="status">Loading your session…</p>
      ) : account ? (
        <>
          <p>
            <a href="#/new">New repository</a>
          </p>
          <section className="workspace-repositories" aria-labelledby="workspace-repositories-heading">
            <h2 id="workspace-repositories-heading">Your repositories</h2>
            {failed ? (
              <p role="alert">Your repositories could not be loaded. Reload the page to try again.</p>
            ) : repositories === null ? (
              <p role="status">Loading repositories…</p>
            ) : repositories.length === 0 ? (
              <p>You have no repositories yet.</p>
            ) : (
              <ul className="repository-list">
                {repositories.map((repository) => (
                  <li key={repository.id} className="repository-list__item">
                    <article>
                      <h3 className="repository-list__name">
                        <a href={repositoryOverviewHref(repository.owner.login, repository.name)}>
                          {repository.name}
                        </a>
                      </h3>
                      <p className="repository-list__full-name">{repository.fullName}</p>
                      <p className="repository-list__description">{repository.description}</p>
                      <p className="repository-list__meta">
                        <span className="visibility-badge" data-visibility={repository.visibility}>
                          {repositoryVisibilityLabel(repository.visibility)}
                        </span>
                        <span>
                          Updated <time dateTime={repository.updatedAt}>{formatUpdatedAt(repository.updatedAt)}</time>
                        </span>
                      </p>
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <p>You must be signed in to view this workspace.</p>
      )}
    </main>
  );
}
