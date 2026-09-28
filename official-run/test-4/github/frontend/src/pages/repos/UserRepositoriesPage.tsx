import { useEffect, useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import { formatUpdateTime } from "../../lib/org-api";
import { listAccountRepositories, repoHref, RepoDetail } from "../../lib/repo-api";

/**
 * Personal Repositories list for one account: every personal repository the
 * current viewer may read, with the same metadata as search results.
 */
export function UserRepositoriesPage({ username }: { username: string }) {
  const [repositories, setRepositories] = useState<RepoDetail[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRepositories(null);
    listAccountRepositories(username)
      .then((result) => {
        if (!cancelled) setRepositories(result);
      })
      .catch(() => {
        if (!cancelled) setRepositories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  return (
    <AppHeader>
      <main>
        <h1>{username}</h1>
        <section aria-label="Repositories">
          <h2>Repositories</h2>
          {repositories === null ? (
            <p>Loading…</p>
          ) : repositories.length === 0 ? (
            <p>No repositories found.</p>
          ) : (
            <ul className="repo-list">
              {repositories.map((repository) => (
                <li key={repository.name} className="repo-list__item">
                  <a href={repoHref(repository)}>{repository.name}</a>
                  {repository.description && (
                    <p className="repo-list__description">{repository.description}</p>
                  )}
                  <p className="repo-list__meta">
                    <span className="repo-list__visibility">
                      {repository.visibility === "public" ? "Public" : "Private"}
                    </span>
                    <span>{formatUpdateTime(repository.updatedAt)}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </AppHeader>
  );
}
