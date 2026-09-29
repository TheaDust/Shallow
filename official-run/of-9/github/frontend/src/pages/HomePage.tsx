import { useEffect, useState } from "react";

import { useSession } from "../features/auth/session";
import { formatUpdatedTime } from "../lib/format";
import { listMyRepositories, type SearchRepositoryInfo } from "../features/organizations/api";

export function HomePage() {
  const { session } = useSession();
  const [repositories, setRepositories] = useState<SearchRepositoryInfo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (session.status !== "authenticated") {
      setRepositories(null);
      return;
    }
    setRepositories(null);
    listMyRepositories()
      .then((list) => {
        if (!cancelled) setRepositories(list);
      })
      .catch(() => {
        if (!cancelled) setRepositories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [session.status]);

  if (session.status === "loading") {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }
  if (session.status === "authenticated") {
    return (
      <section className="workspace">
        <h1>Workspace</h1>
        <p>
          Signed in as <strong>{session.account.username}</strong>.
        </p>
        <div className="workspace__repositories">
          <div className="workspace__repositories-header">
            <h2>Your repositories</h2>
            <a
              className="ui-button ui-button--primary workspace__new-repository"
              href="#/repositories/new"
            >
              New repository
            </a>
          </div>
          {repositories === null ? (
            <p role="status" className="page-status">
              Loading…
            </p>
          ) : repositories.length === 0 ? (
            <p className="workspace__empty">No repositories yet.</p>
          ) : (
            <ul className="repo-list">
              {repositories.map((repository) => (
                <li key={`${repository.owner}/${repository.name}`} className="repo-list__item">
                  <a
                    href={`#/repos/${repository.owner}/${repository.name}`}
                    className="repo-list__name"
                  >
                    {repository.name}
                  </a>
                  <p className="repo-list__owner">
                    {repository.owner}/{repository.name}
                  </p>
                  {repository.description ? (
                    <p className="repo-list__description">{repository.description}</p>
                  ) : null}
                  <div className="repo-list__meta">
                    <span className="repo-list__visibility">
                      {repository.visibility === "public" ? "Public" : "Private"}
                    </span>
                    <span className="repo-list__updated">
                      Updated {formatUpdatedTime(repository.updatedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    );
  }
  return (
    <section className="home">
      <h1>GitHub Collaboration Platform</h1>
      <p>Sign in to start collaborating.</p>
      <nav className="home__actions" aria-label="Account access">
        <a href="#/signup">Sign up</a>
        <a href="#/signin">Sign in</a>
        <a href="#/forgot-password">Forgot password</a>
      </nav>
    </section>
  );
}
