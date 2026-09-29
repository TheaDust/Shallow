import { useEffect, useState } from "react";

import { useHashLocation } from "../../lib/hash-route";
import { formatUpdatedTime } from "../../lib/format";
import { Tabs } from "../../ui";
import { searchRepositories, type SearchRepositoryInfo } from "../organizations/api";

export function SearchResultsPage() {
  const location = useHashLocation();
  const query = location.search.get("q") ?? "";
  const [type, setType] = useState("repositories");
  const [results, setResults] = useState<SearchRepositoryInfo[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResults(null);
    setFailed(false);
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    searchRepositories(q)
      .then((list) => {
        if (!cancelled) setResults(list);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const repositoryPanel = failed ? (
    <p role="alert" className="page-error">
      Search failed
    </p>
  ) : results === null ? (
    <p role="status" className="page-status">
      Loading…
    </p>
  ) : results.length === 0 ? (
    <p className="search-results__empty">No results</p>
  ) : (
    <ul className="search-results">
      {results.map((repository) => (
        <li key={`${repository.owner}/${repository.name}`} className="search-results__item">
          <a
            href={`#/repos/${repository.owner}/${repository.name}`}
            className="search-results__name"
          >
            {repository.name}
          </a>
          <p className="search-results__owner">
            {repository.owner}/{repository.name}
          </p>
          {repository.description ? (
            <p className="search-results__description">{repository.description}</p>
          ) : null}
          <div className="search-results__meta">
            <span className="search-results__visibility">
              {repository.visibility === "public" ? "Public" : "Private"}
            </span>
            <span>Updated {formatUpdatedTime(repository.updatedAt)}</span>
          </div>
        </li>
      ))}
    </ul>
  );

  const emptyPanel = <p className="search-results__empty">No results</p>;

  return (
    <section className="search-results-page">
      <h1>Search results</h1>
      <Tabs
        label="Search type"
        activeId={type}
        onChange={setType}
        items={[
          { id: "repositories", label: "Repositories", panel: repositoryPanel },
          { id: "code", label: "Code", panel: emptyPanel },
          { id: "issues", label: "Issues", panel: emptyPanel },
          { id: "pulls", label: "Pull requests", panel: emptyPanel },
          { id: "users", label: "Users", panel: emptyPanel },
        ]}
      />
    </section>
  );
}
