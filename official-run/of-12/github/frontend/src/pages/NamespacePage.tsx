import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { formatUpdatedAt } from "../features/organizations/OrganizationRepositories";
import { fetchNamespace, type NamespaceDetail } from "../features/repositories/repository-api";
import { NotFoundPage } from "./NotFoundPage";
import { OrganizationPage } from "./OrganizationPage";

export interface NamespacePageProps {
  name: string;
}

type LoadState = "loading" | "ready" | "missing" | "failed";

/**
 * Namespace address `#/<name>` (REQ-3): an organization keeps its organization
 * overview, while an individual account shows the repositories of its personal
 * namespace that the caller may read. A public repository of that namespace is
 * therefore reachable from its own list as well as from search and a direct
 * address.
 */
export function NamespacePage({ name }: NamespacePageProps) {
  const [detail, setDetail] = useState<NamespaceDetail | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let active = true;
    setState("loading");
    setDetail(null);
    fetchNamespace(name)
      .then((result) => {
        if (!active) return;
        setDetail(result);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(error instanceof ApiError && error.status === 404 ? "missing" : "failed");
      });
    return () => {
      active = false;
    };
  }, [name]);

  if (state === "missing") return <NotFoundPage />;
  if (detail?.namespace.type === "organization") {
    return <OrganizationPage name={detail.namespace.name} tab="repositories" />;
  }

  return (
    <main className="namespace-page">
      <h1 className="namespace-page__name">{detail?.namespace.displayName ?? name}</h1>
      {state === "failed" ? (
        <p role="alert">The namespace could not be loaded. Please try again.</p>
      ) : null}
      {!detail ? <p role="status">Loading repositories…</p> : null}
      {detail ? (
        <section className="namespace-page__repositories" aria-label="Repositories">
          <h2>Repositories</h2>
          {detail.repositories.length === 0 ? (
            <p className="namespace-page__empty">No repositories to show.</p>
          ) : null}
          <ul className="namespace-page__list">
            {detail.repositories.map((repository) => (
              <li
                key={repository.name}
                className="namespace-page__item"
                aria-label={`${repository.fullName} ${repository.visibility === "public" ? "Public" : "Private"}`}
              >
                <div className="namespace-page__heading">
                  <a
                    className="namespace-page__repository"
                    href={`#/${repository.owner}/${repository.name}`}
                  >
                    {repository.name}
                  </a>
                  <a
                    className="namespace-page__repository-full"
                    href={`#/${repository.owner}/${repository.name}`}
                  >
                    {repository.fullName}
                  </a>
                  <span className="namespace-page__visibility">
                    {repository.visibility === "public" ? "Public" : "Private"}
                  </span>
                </div>
                {repository.description ? (
                  <p className="namespace-page__description">{repository.description}</p>
                ) : null}
                <p className="namespace-page__updated">Updated {formatUpdatedAt(repository.updatedAt)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
