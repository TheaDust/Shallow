import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import { useHashLocation } from "../../lib/hash-route";
import {
  CodeSearchFileResult,
  fileHref,
  fileLanguage,
  RepoOwnerType,
  repoHref,
  repoOwnerBase,
  searchRepositoryCode,
} from "../../lib/repo-api";
import { useRepoDetail } from "../repos/useRepoDetail";

interface CodeSearchPageProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  branch?: string;
}

type SearchStatus = "loading" | "ready" | "denied" | "notfound";

/**
 * Repository code-search results page (REQ-4-2-3): entered from the “Search”
 * box at the top of a repository page. Shows the repository identity, a
 * unique “Code” results-type link (distinct from repository navigation),
 * optional path and language filters, and the matching file snippets with
 * file paths and branch context — all from the current repository only. An
 * absent query shows exactly “No code results” and keeps the query in Search.
 */
export function CodeSearchPage({ ownerType, ownerName, repoName, branch }: CodeSearchPageProps) {
  const { search } = useHashLocation();
  const query = search.get("q") ?? "";
  const { status: detailStatus, repository } = useRepoDetail(ownerType, ownerName, repoName, branch);
  const [pathFilter, setPathFilter] = useState(search.get("path") ?? "");
  const [languageFilter, setLanguageFilter] = useState(search.get("language") ?? "");
  const [status, setStatus] = useState<SearchStatus>("loading");
  const [results, setResults] = useState<CodeSearchFileResult[] | null>(null);
  const [activeBranch, setActiveBranch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setResults(null);
    const trimmed = query.trim();
    if (!trimmed || !repository) {
      setResults([]);
      setStatus(detailStatus === "ready" ? "ready" : "loading");
      return;
    }
    const branchName = repository.currentBranch || repository.defaultBranch || "main";
    setActiveBranch(branchName);
    searchRepositoryCode(ownerType, ownerName, repoName, {
      query: trimmed,
      branch: branchName,
      path: pathFilter || undefined,
      language: languageFilter || undefined,
    })
      .then((body) => {
        if (cancelled) return;
        setResults(body.results);
        setActiveBranch(body.branch);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResults([]);
        if (error instanceof Error && "status" in error && (error as { status?: number }).status === 403) {
          setStatus("denied");
        } else {
          setStatus("ready");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query, pathFilter, languageFilter, repository, detailStatus, ownerType, ownerName, repoName]);

  const languages = useMemo(() => {
    const found = new Set<string>();
    for (const file of repository?.files ?? []) {
      found.add(fileLanguage(file.path));
    }
    return [...found].sort();
  }, [repository]);

  const base = `${repoOwnerBase(ownerType, ownerName)}/repos/${encodeURIComponent(repoName)}`;

  if (detailStatus === "denied") {
    return (
      <AppHeader>
        <main>
          <h1>{ownerName}/{repoName}</h1>
          <p>Access denied</p>
        </main>
      </AppHeader>
    );
  }

  if (detailStatus === "notfound") {
    return (
      <AppHeader>
        <main>
          <h1>{ownerName}/{repoName}</h1>
          <p>Repository not found.</p>
        </main>
      </AppHeader>
    );
  }

  if (detailStatus !== "ready" || !repository) {
    return (
      <AppHeader>
        <main>
          <h1>{ownerName}/{repoName}</h1>
          <p>Loading…</p>
        </main>
      </AppHeader>
    );
  }

  const showResults = status === "ready" && results !== null;

  return (
    <AppHeader>
      <main>
        <h1>{ownerName}/{repoName}</h1>
        <p className="code-search__scope">
          <a href={repoHref({ ownerType, ownerName, name: repoName })}>{repoName}</a>
          <span aria-hidden="true"> · </span>
          <span>Searching branch {activeBranch || repository.currentBranch || repository.defaultBranch}</span>
        </p>
        <div className="code-search__types">
          <a
            className="code-search__type-link"
            href={`#${base}/search?q=${encodeURIComponent(query)}`}
            aria-current="page"
          >
            Code
          </a>
        </div>
        <div className="code-search__filters">
          <div className="code-search__filter">
            <label htmlFor="code-search-path">Path</label>
            <input
              id="code-search-path"
              type="text"
              value={pathFilter}
              onChange={(event) => setPathFilter(event.target.value)}
            />
          </div>
          <div className="code-search__filter">
            <label htmlFor="code-search-language">Language</label>
            <select
              id="code-search-language"
              value={languageFilter}
              onChange={(event) => setLanguageFilter(event.target.value)}
            >
              <option value="">All languages</option>
              {languages.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </div>
        </div>
        {status === "loading" ? (
          <p>Loading…</p>
        ) : status === "denied" ? (
          <p>Access denied</p>
        ) : showResults && results.length === 0 ? (
          <p>No code results</p>
        ) : showResults ? (
          <ul className="code-search__results">
            {results.map((result) => {
              const fileName = result.path.split("/").pop() ?? result.path;
              const firstLine = result.matches[0]?.lineNumber ?? 1;
              return (
                <li key={result.path} className="code-search__result">
                  <a
                    className="code-search__file"
                    href={`${fileHref(ownerType, ownerName, repoName, result.branch, result.path)}#L${firstLine}`}
                  >
                    {fileName}
                  </a>
                  <p className="code-search__path">{result.path}</p>
                  <div className="code-search__snippet">
                    {result.matches.map((match) => (
                      <code key={match.lineNumber} className="code-search__line">
                        <span className="code-search__lineno">{match.lineNumber}</span> {match.text}
                      </code>
                    ))}
                  </div>
                  <p className="code-search__branch">Branch {result.branch}</p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>Loading…</p>
        )}
      </main>
    </AppHeader>
  );
}
