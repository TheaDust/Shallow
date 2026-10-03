import { searchRepositories } from "../api/organizations";
import { useAuth } from "../auth/AuthProvider";
import { RepositoryEntries } from "../components/RepositoryEntries";
import { SiteHeader } from "../components/SiteHeader";
import { useAsyncData } from "../lib/useAsyncData";

/**
 * Repository results for the top search control. The query is read from the URL
 * (so the page reloads and can be shared) and every visit asks the server again:
 * an earlier answer — including “No results” — is never replayed from cached
 * state, and a private repository the viewer may not read never becomes a link.
 */
export function SearchPage({ query }: { query: string }) {
  const { account } = useAuth();
  const { data, error, loading } = useAsyncData(() => searchRepositories(query), [query]);
  const repositories = data?.repositories ?? [];

  return (
    <main>
      <SiteHeader account={account} />
      <h1>Search results</h1>
      {loading ? <p role="status">Loading…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error ? (
        repositories.length > 0 ? (
          <RepositoryEntries repositories={repositories} />
        ) : (
          <p className="search-results__empty">No results</p>
        )
      ) : null}
    </main>
  );
}
