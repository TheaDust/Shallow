import { AppHeader } from "../components/AppHeader";
import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { searchRepositoryCode } from "../lib/org-api";
import { repositoryBlobHash, repositorySearchHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/**
 * Repository-scoped code search results. The query lives in the address, so the
 * header Search box keeps it and the view survives a reload; the results only
 * contain readable file content of this repository and every entry opens the
 * stored file in its repository context. Selecting the "Code" results view
 * keeps the current query and changes nothing in the repository.
 */
export function RepositorySearchPage({
  owner,
  name,
  query,
}: {
  owner: string;
  name: string;
  query: string;
}) {
  const trimmed = query.trim();
  const { status, data, error } = useAsyncData(
    () => searchRepositoryCode(owner, name, trimmed),
    [owner, name, trimmed],
  );

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository-search">
        {status === "loading" ? <LoadingNote label="Searching code…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {status === "ready" && data ? (
          <>
            <RepositoryBreadcrumb repository={data.repository} />
            <h1 className="repository-search__title">Search results</h1>
            <nav className="repository-search__views" aria-label="Search results">
              <a
                className="repository-search__view"
                aria-current="page"
                href={repositorySearchHash(data.repository.owner.id, data.repository.name, query)}
              >
                Code
              </a>
            </nav>
            <p className="repository-search__scope">Branch: {data.branch}</p>
            {data.matches.length === 0 ? (
              <p className="repository-search__empty">No code results</p>
            ) : (
              <ul className="repository-search__list" aria-label="Code results">
                {data.matches.map((match) => (
                  <li key={match.path} className="repository-search__item">
                    <a
                      className="repository-search__file"
                      href={repositoryBlobHash(data.repository.owner.id, data.repository.name, match.path)}
                    >
                      {match.name}
                    </a>
                    {match.lines.length > 0 ? (
                      <code className="repository-search__line">{match.lines[0].text}</code>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}
