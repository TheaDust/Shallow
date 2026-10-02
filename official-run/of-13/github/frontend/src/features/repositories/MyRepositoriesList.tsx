import { useEffect, useState } from "react";

import { repositoryHref } from "../../lib/repository-code-api";
import { listMyRepositories, type RepositoryRecord } from "../../lib/repositories-api";
import { visibilityLabel } from "../organizations/format";

export interface MyRepositoriesListProps {
  /** The list is only requested once a session is known. */
  enabled: boolean;
}

/**
 * The personal `Repositories list` of the signed-in workspace. Every entry is
 * a link named exactly like the repository and opens its overview; the list is
 * read straight from the persisted repositories, so a newly created or forked
 * repository appears here.
 */
export function MyRepositoriesList({ enabled }: MyRepositoriesListProps) {
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState("loading");
    listMyRepositories()
      .then((list) => {
        if (cancelled) return;
        setRepositories(list);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return (
    <section className="my-repositories" aria-label="Your repositories">
      <h2>Your repositories</h2>
      {state === "loading" || state === "idle" ? <p role="status">Loading…</p> : null}
      {state === "error" ? <p role="status">Repositories could not be loaded.</p> : null}
      {state === "ready" && repositories.length === 0 ? (
        <p role="status">No repositories yet.</p>
      ) : null}
      {state === "ready" && repositories.length > 0 ? (
        <ul className="my-repositories__list">
          {repositories.map((repository) => (
            <li key={`${repository.owner}/${repository.name}`}>
              <a href={repositoryHref(repository.owner, repository.name)}>
                {repository.name}
              </a>
              <span className="my-repositories__meta">{`${repository.owner}/${repository.name}`}</span>
              <span className="my-repositories__visibility">
                {visibilityLabel(repository.visibility)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
