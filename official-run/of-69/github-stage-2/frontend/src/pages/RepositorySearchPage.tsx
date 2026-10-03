import { AppHeader } from "../components/AppHeader";
import { searchRepositoryCode } from "../lib/organization-api";
import { useHashLocation } from "../lib/hash-route";
import {
  repositoryCodeSearchUrl,
  repositoryCodeUrl,
  type RepositoryOwnerType,
} from "../lib/routes";
import { SEARCH_PATH } from "../components/GlobalSearch";
import { useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";

export interface RepositorySearchPageProps {
  ownerType: RepositoryOwnerType;
  owner: string;
  repository: string;
}

function directoryOf(path: string): string | undefined {
  const index = path.lastIndexOf("/");
  return index === -1 ? undefined : path.slice(0, index);
}

/**
 * Code search results of one repository. The query is scoped to the readable
 * file content of the directory the viewer searched from and stays in the top
 * Search box; the “Code” results view lists every matching file by its path and
 * opens it in its repository context. A query without a match answers with a
 * no-code-results state instead of pretending there are results.
 */
export function RepositorySearchPage({ ownerType, owner, repository }: RepositorySearchPageProps) {
  const { account } = useSession();
  const location = useHashLocation();
  const query = location.search.get("q") ?? "";
  const branch = location.search.get("branch") ?? undefined;
  const directory = location.search.get("path") ?? undefined;
  const results = useAsyncData(
    () => searchRepositoryCode(owner, repository, query, { branch, path: directory }),
    [owner, repository, query, branch, directory],
  );
  const loaded = results.data;

  return (
    <div className="app-shell">
      <AppHeader username={account?.username} />
      <main>
        <h1>Search results</h1>
        <nav className="search-views" aria-label="Search results views">
          <a
            href={repositoryCodeSearchUrl(ownerType, owner, repository, query, { branch, path: directory })}
            data-active="true"
            aria-current="page"
          >
            Code
          </a>
          <a href={`${SEARCH_PATH}${query ? `?q=${encodeURIComponent(query)}` : ""}`}>Repositories</a>
        </nav>
        <p className="page-hint">
          {owner}/{repository}
          {loaded ? ` · branch ${loaded.branch}` : ""}
        </p>
        {results.loading ? <p role="status">Searching code…</p> : null}
        {results.error ? (
          <p className="form-error" role="alert">
            {results.error}
          </p>
        ) : null}
        {loaded ? (
          loaded.results.length > 0 ? (
            <ul className="code-results">
              {loaded.results.map((result) => (
                <li key={result.path} className="code-results__item">
                  <a
                    className="code-results__path"
                    href={repositoryCodeUrl(
                      { type: ownerType, name: owner },
                      repository,
                      { path: directoryOf(result.path), file: result.path },
                    )}
                  >
                    {result.path}
                  </a>
                  <pre className="code-results__lines">{result.lines.join("\n")}</pre>
                </li>
              ))}
            </ul>
          ) : (
            <p role="status">No code results</p>
          )
        ) : null}
      </main>
    </div>
  );
}
