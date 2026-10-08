import { ErrorNote, LoadingNote } from "../components/ViewState";
import { searchRepositories, type RepositorySummary } from "../lib/org-api";
import { repositoryHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/**
 * Global repository search results. The query comes from the hash search
 * string, so the same view is restored on reload or direct link. Results are
 * limited to repositories the caller may read by the server; each result links
 * with the repository name while the row also shows the owner/name metadata.
 */
export function SearchResultsPage({ query }: { query: string }) {
  const trimmed = query.trim();
  const { status, data, error, reload } = useAsyncData(
    () => searchRepositories(trimmed),
    [trimmed],
  );

  return (
    <main className="page">
      <section className="page__body search-results" aria-label="Repository search results">
        <h1 className="search-results__title">Repositories</h1>
        {status === "loading" ? <LoadingNote label="Searching repositories…" /> : null}
        {status === "error" && error ? <ErrorNote error={error} onRetry={reload} /> : null}
        {status === "ready" && data ? (
          data.length === 0 ? (
            <p className="search-results__empty">No results</p>
          ) : (
            <ul className="repository-list" aria-label="Repositories">
              {data.map((repository: RepositorySummary) => (
                <li key={repository.id} className="repository-list__item">
                  <div className="repository-list__head">
                    <a
                      className="repository-list__name"
                      href={repositoryHash(repository.owner.id, repository.name)}
                    >
                      {repository.name}
                    </a>
                    <span className="repository-list__owner">
                      {repository.owner.displayName}/{repository.name}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
    </main>
  );
}
