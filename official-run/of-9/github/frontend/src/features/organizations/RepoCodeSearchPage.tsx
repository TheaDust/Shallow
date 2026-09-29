import { useEffect, useState, type FormEvent } from "react";

import { ApiError } from "../../lib/api";
import { navigate, useHashLocation } from "../../lib/hash-route";
import { searchRepositoryCode, type CodeSearchResult } from "./api";
import { AccessDenied } from "./AccessDenied";
import { RepoPageHeader } from "./RepoPageHeader";

function fileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

export function RepoCodeSearchPage({ owner, name }: { owner: string; name: string }) {
  const location = useHashLocation();
  const query = location.search.get("q") ?? "";
  const pathFilter = location.search.get("path") ?? "";
  const [search, setSearch] = useState(query);
  const [filter, setFilter] = useState(pathFilter);
  const [results, setResults] = useState<CodeSearchResult[] | null>(null);
  const [branch, setBranch] = useState("");
  const [state, setState] = useState<"loading" | "ok" | "denied" | "missing">("loading");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSearch(query);
    setFilter(pathFilter);
  }, [query, pathFilter]);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setFailed(false);
    const q = query.trim();
    if (!q) {
      setResults([]);
      setBranch("");
      setState("ok");
      return;
    }
    searchRepositoryCode(owner, name, q, pathFilter || undefined)
      .then((result) => {
        if (cancelled) return;
        setResults(result.results);
        setBranch(result.branch);
        setState("ok");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setState("denied");
        else {
          setFailed(true);
          setState("ok");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name, query, pathFilter]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    const q = search.trim();
    if (q) params.set("q", q);
    if (filter.trim()) params.set("path", filter.trim());
    navigate(`/repos/${owner}/${name}/search`, params);
  };

  const submitFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (filter.trim()) params.set("path", filter.trim());
    navigate(`/repos/${owner}/${name}/search`, params);
  };

  if (state === "denied") return <AccessDenied />;
  if (state === "missing") {
    return (
      <section className="repo-search">
        <RepoPageHeader owner={owner} name={name} />
        <p className="repo-search__empty">Not found</p>
      </section>
    );
  }
  if (state === "loading") {
    return (
      <section className="repo-search">
        <RepoPageHeader owner={owner} name={name} />
        <p role="status" className="page-status">
          Loading…
        </p>
      </section>
    );
  }

  const codeUrl = new URLSearchParams();
  if (query) codeUrl.set("q", query);
  if (pathFilter) codeUrl.set("path", pathFilter);

  return (
    <section className="repo-search">
      <RepoPageHeader owner={owner} name={name} />
      <form role="search" className="repo-search__form" onSubmit={submitSearch}>
        <input
          type="search"
          aria-label="Search"
          placeholder="Search code"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </form>
      <nav className="repo-search__types" aria-label="Search type">
        <a
          href={`#/repos/${owner}/${name}/search${codeUrl.toString() ? `?${codeUrl.toString()}` : ""}`}
          className="repo-search__type repo-search__type--active"
          aria-current="page"
        >
          Code
        </a>
      </nav>
      <form role="search" className="repo-search__filter" onSubmit={submitFilter}>
        <div className="ui-field">
          <label htmlFor="repo-search-path">Path</label>
          <input
            id="repo-search-path"
            type="text"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      </form>
      {failed ? (
        <p role="alert" className="repo-search__error">
          Search failed
        </p>
      ) : query.trim() && results !== null && results.length === 0 ? (
        <p className="repo-search__empty">No code results</p>
      ) : !query.trim() ? (
        <p className="repo-search__empty">Enter a code search term.</p>
      ) : results === null ? (
        <p role="status" className="page-status">
          Loading…
        </p>
      ) : (
        <ul className="repo-search__results">
          {results.map((result) => (
            <li key={result.path} className="repo-search__item">
              <a
                className="repo-search__file"
                href={`#/repos/${owner}/${name}/blob?branch=${encodeURIComponent(result.branch)}&path=${encodeURIComponent(result.path)}`}
              >
                {fileName(result.path)}
              </a>
              <p className="repo-search__path">{result.path}</p>
              <pre className="repo-search__snippet">{result.snippet}</pre>
              <p className="repo-search__branch">Branch: {result.branch}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
