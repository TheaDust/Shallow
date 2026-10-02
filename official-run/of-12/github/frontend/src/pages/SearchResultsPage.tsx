import { useEffect, useState } from "react";

import { makeHash, useHashLocation } from "../lib/hash-route";
import { formatUpdatedAt } from "../features/organizations/OrganizationRepositories";
import { RepositoryCodeSearch } from "../features/repositories/RepositoryCodeSearch";
import { searchRepositories, type RepositorySummary } from "../features/repositories/repository-api";

const TYPES = ["Repositories", "Code", "Issues", "Pull requests"] as const;
type ResultType = (typeof TYPES)[number];

const TYPE_IDS: Record<ResultType, string> = {
  Repositories: "repositories",
  Code: "code",
  Issues: "issues",
  "Pull requests": "pull-requests",
};

function typeFromId(id: string | null): ResultType {
  const match = TYPES.find((type) => TYPE_IDS[type] === id);
  return match ?? "Repositories";
}

/**
 * The address of one result type. A repository scope travels with the type
 * links, so the search results of a repository stay scoped to it while the
 * "Code" link stays the only control named that way on the search page.
 */
function typeHref(query: string, type: ResultType, repositoryScope: string): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("type", TYPE_IDS[type]);
  if (repositoryScope) params.set("repo", repositoryScope);
  return makeHash("/search", params);
}

/** The `owner/name` scope of a repository code search, when one is selected. */
function repositoryScopeFromParam(value: string | null): { owner: string; name: string } | null {
  const [owner, name] = (value ?? "").split("/");
  if (!owner || !name) return null;
  return { owner, name };
}

type LoadState = "idle" | "loading" | "ready" | "failed";

/**
 * Repository search results (REQ-3-1) and repository code search results
 * (REQ-4-2-3).
 *
 * The heading of a repository result is a link named exactly with the
 * repository name, next to the owner/name metadata, the description, the
 * visibility and the update time; only repositories the caller is authorized to
 * view are returned, so a visitor never sees a private repository here. The
 * "Code" type reads the files of the repository in scope only.
 */
export function SearchResultsPage() {
  const { search } = useHashLocation();
  const query = search.get("q") ?? "";
  const type = typeFromId(search.get("type"));
  const repositoryScope = search.get("repo") ?? "";
  const codeScope = repositoryScopeFromParam(repositoryScope);
  const filterPath = search.get("path") ?? "";
  const language = search.get("language") ?? "";
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [state, setState] = useState<LoadState>("idle");

  useEffect(() => {
    let active = true;
    if (!query.trim() || type !== "Repositories") {
      setRepositories([]);
      setState("idle");
      return () => {
        active = false;
      };
    }
    setState("loading");
    searchRepositories(query)
      .then((result) => {
        if (!active) return;
        setRepositories(result);
        setState("ready");
      })
      .catch(() => {
        if (!active) return;
        setRepositories([]);
        setState("failed");
      });
    return () => {
      active = false;
    };
  }, [query, type]);

  const showRepositories = type === "Repositories";
  const showCode = type === "Code";
  const showEmpty = state !== "loading" && state !== "failed" && showRepositories && repositories.length === 0;

  return (
    <main className="search-page">
      <h1 className="search-page__title">Search results</h1>
      <nav className="search-page__types" aria-label="Search type">
        {TYPES.map((entry) => (
          <a
            key={entry}
            className="search-page__type"
            href={typeHref(query, entry, repositoryScope)}
            aria-current={entry === type ? "page" : undefined}
          >
            {entry}
          </a>
        ))}
      </nav>

      {state === "loading" ? <p role="status">Searching repositories…</p> : null}
      {state === "failed" ? (
        <p role="alert">The search could not be completed. Please try again.</p>
      ) : null}
      {showEmpty ? <p className="search-page__empty">No results</p> : null}
      {showCode && !codeScope && query.trim() ? <p className="search-page__empty">No results</p> : null}
      {showCode && !codeScope ? (
        <p className="search-page__hint" role="status">
          Open a repository and search from its page to search its code.
        </p>
      ) : null}

      {showCode && codeScope ? (
        <RepositoryCodeSearch
          owner={codeScope.owner}
          name={codeScope.name}
          query={query}
          path={filterPath}
          language={language}
        />
      ) : null}

      <ul className="search-page__results">
        {showRepositories
          ? repositories.map((repository) => (
              <li key={`${repository.owner}/${repository.name}`} className="search-result">
                <div className="search-result__heading">
                  <a
                    className="search-result__name"
                    href={`#/${repository.owner}/${repository.name}`}
                  >
                    {repository.name}
                  </a>
                  <span className="search-result__visibility">
                    {repository.visibility === "public" ? "Public" : "Private"}
                  </span>
                </div>
                <p className="search-result__owner">
                  <a href={`#/${repository.owner}/${repository.name}`}>{repository.fullName}</a>
                </p>
                {repository.description ? (
                  <p className="search-result__description">{repository.description}</p>
                ) : null}
                <p className="search-result__updated">Updated {formatUpdatedAt(repository.updatedAt)}</p>
              </li>
            ))
          : null}
      </ul>
    </main>
  );
}
