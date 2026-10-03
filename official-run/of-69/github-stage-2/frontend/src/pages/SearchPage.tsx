import { AppHeader } from "../components/AppHeader";
import { searchRepositories } from "../lib/organization-api";
import { useHashLocation } from "../lib/hash-route";
import { repositoryUrl } from "../lib/routes";
import { useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";

/**
 * Global repository search results. A query that matches no repository the
 * viewer may read answers “No results”; every result names the repository in
 * the link and shows the owning organization next to it, so the repository
 * overview is one click away.
 */
export function SearchPage() {
  const { account } = useSession();
  const location = useHashLocation();
  const query = location.search.get("q") ?? "";
  const results = useAsyncData(() => searchRepositories(query), [query]);
  const loaded = results.data ?? [];

  return (
    <div className="app-shell">
      <AppHeader username={account?.username} />
      <main>
        <h1>Search results</h1>
        {results.loading ? <p role="status">Searching repositories…</p> : null}
        {results.error ? (
          <p className="form-error" role="alert">
            {results.error}
          </p>
        ) : null}
        {results.data ? (
          !query.trim() ? (
            <p>Enter a repository name in the Search box and press Enter.</p>
          ) : loaded.length > 0 ? (
            <ul className="repository-list">
              {loaded.map((repository) => (
                <li key={`${repository.owner.type ?? "organization"}:${repository.owner.name}/${repository.name}`} className="repository-list__item">
                  <a href={repositoryUrl(repository.owner, repository.name)}>{repository.name}</a>
                  <span className="repository-list__visibility" data-visibility={repository.visibility}>
                    {repository.visibility === "public" ? "Public" : "Private"}
                  </span>
                  <p className="repository-list__owner">
                    {repository.owner.displayName}/{repository.name}
                  </p>
                  <p className="repository-list__description">{repository.description}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p role="status">No results</p>
          )
        ) : null}
      </main>
    </div>
  );
}
