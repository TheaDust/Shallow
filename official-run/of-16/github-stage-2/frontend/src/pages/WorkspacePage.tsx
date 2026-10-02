import { useEffect, useState } from "react";

import { useSession } from "../auth/SessionContext";
import { fetchUserRepositories } from "../repositories/api";
import { repositoryPath } from "../repositories/routes";
import type { RepositoryListItem } from "../repositories/types";
import { visibilityLabel } from "../organizations/format";

interface YourRepositoriesProps {
  username: string;
}

/** Personal repository list of the signed-in account. */
function YourRepositories({ username }: YourRepositoriesProps) {
  const [repositories, setRepositories] = useState<RepositoryListItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRepositories(null);
    setFailed(false);
    fetchUserRepositories(username)
      .then((body) => {
        if (!cancelled) setRepositories(body.repositories);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  return (
    <section className="page-section" aria-labelledby="your-repositories-heading">
      <h2 id="your-repositories-heading">Your repositories</h2>
      {failed ? (
        <p className="app-form__error" role="alert">
          We could not load your repositories. Try again.
        </p>
      ) : null}
      {!failed && repositories === null ? <p role="status">Loading repositories…</p> : null}
      {repositories !== null ? (
        repositories.length > 0 ? (
          <ul className="repository-list">
            {repositories.map((repository) => (
              <li key={repository.name} className="repository-list__item">
                <a
                  className="repository-list__name"
                  href={`#${repositoryPath("account", username, repository.name)}`}
                >
                  {repository.name}
                </a>
                <p className="repository-list__description">{repository.description}</p>
                <p className="repository-list__meta">
                  <span className="repository-list__visibility">{visibilityLabel(repository.visibility)}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="repository-list__branch">Default branch {repository.defaultBranch}</span>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="repository-list__empty">You have no personal repository yet.</p>
        )
      ) : null}
    </section>
  );
}

/**
 * Landing view for a signed-in visitor. It offers the "New repository" entry and
 * lists the personal repositories of the account; the current account is shown
 * by the account menu in the top bar, so the username is rendered once there.
 */
export function WorkspacePage() {
  const { account } = useSession();

  return (
    <>
      <section className="page">
        <h1>Workspace</h1>
        <p className="page__lead">
          Create a repository, or pick an organization from the account menu to browse its
          repositories and teams.
        </p>
        <p className="page__links">
          <a href="#/new">New repository</a>
        </p>
      </section>
      {account ? <YourRepositories username={account.username} /> : null}
    </>
  );
}
