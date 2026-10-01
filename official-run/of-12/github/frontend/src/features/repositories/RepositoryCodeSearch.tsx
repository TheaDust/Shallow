import { useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import { makeHash, navigateHref } from "../../lib/hash-route";
import { blobHref } from "./repository-links";
import {
  searchRepositoryCode,
  type RepositoryCodeSearchResult,
  type RepositorySummary,
} from "./repository-api";

export interface RepositoryCodeSearchProps {
  /** The repository the search is scoped to, as it appears in the address. */
  owner: string;
  name: string;
  query: string;
  path: string;
  language: string;
}

type CodeSearchState = "idle" | "loading" | "ready" | "denied" | "failed";

/** The address of the result page with the filters applied. */
function filtersHref(
  owner: string,
  name: string,
  query: string,
  path: string,
  language: string,
): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("type", "code");
  params.set("repo", `${owner}/${name}`);
  if (path) params.set("path", path);
  if (language) params.set("language", language);
  return makeHash("/search", params);
}

/** The address of one matching file, carrying the query it matched. */
function matchHref(repository: RepositorySummary, branch: string, path: string, query: string): string {
  return `${blobHref(repository, branch, path)}?highlight=${encodeURIComponent(query)}`;
}

/**
 * Code search inside one repository (REQ-4-2-3).
 *
 * The results only ever hold file content of the repository in scope: the
 * matching snippet, the file path and the branch a match was read from. The
 * optional path and language filters travel in the address, so a filtered
 * search survives a reload, and a query without any match keeps its scope and
 * filters while it reports the empty result.
 */
export function RepositoryCodeSearch({ owner, name, query, path, language }: RepositoryCodeSearchProps) {
  const [state, setState] = useState<CodeSearchState>("idle");
  const [result, setResult] = useState<RepositoryCodeSearchResult | null>(null);
  const [draftPath, setDraftPath] = useState(path);
  const [draftLanguage, setDraftLanguage] = useState(language);

  useEffect(() => {
    setDraftPath(path);
    setDraftLanguage(language);
  }, [path, language]);

  useEffect(() => {
    const needle = query.trim();
    if (!needle) {
      setResult(null);
      setState("idle");
      return undefined;
    }
    let active = true;
    setState("loading");
    searchRepositoryCode(owner, name, { query: needle, path, language })
      .then((response) => {
        if (!active) return;
        setResult(response);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setResult(null);
        setState(error instanceof ApiError && (error.status === 403 || error.status === 401) ? "denied" : "failed");
      });
    return () => {
      active = false;
    };
  }, [owner, name, query, path, language]);

  const matches = result?.results ?? [];
  const languages = result?.languages ?? [];
  const repository = result?.repository ?? null;

  return (
    <div className="code-search">
      <p className="code-search__scope">
        Searching code in <a className="code-search__repository" href={`#/${owner}/${name}`}>{`${owner}/${name}`}</a>
      </p>

      <form
        className="code-search__filters"
        aria-label="Filters"
        onSubmit={(event) => {
          event.preventDefault();
          navigateHref(filtersHref(owner, name, query, draftPath.trim(), draftLanguage));
        }}
      >
        <p className="code-search__field">
          <label htmlFor="code-search-path">Path</label>
          <input
            id="code-search-path"
            className="code-search__path-input"
            type="text"
            name="path"
            placeholder="Filter by path"
            value={draftPath}
            onChange={(event) => setDraftPath(event.target.value)}
          />
        </p>
        <p className="code-search__field">
          <label htmlFor="code-search-language">Language</label>
          <select
            id="code-search-language"
            className="code-search__language-select"
            name="language"
            value={draftLanguage}
            onChange={(event) => {
              setDraftLanguage(event.target.value);
              navigateHref(filtersHref(owner, name, query, draftPath.trim(), event.target.value));
            }}
          >
            <option value="">Any language</option>
            {languages.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </p>
        <button type="submit" className="code-search__submit">
          Filter
        </button>
      </form>

      {state === "loading" ? <p role="status">Searching code…</p> : null}
      {state === "idle" ? (
        <p className="code-search__hint" role="status">
          Enter a search term to look through the files of this repository.
        </p>
      ) : null}
      {state === "denied" ? (
        <p role="alert">Access denied. This repository is private and your account may not read it.</p>
      ) : null}
      {state === "failed" ? <p role="alert">The code search could not be completed. Please try again.</p> : null}
      {state === "ready" && matches.length === 0 ? <p className="code-search__empty">No code results</p> : null}

      <ul className="code-search__results">
        {matches.map((match) => (
          <li key={match.path} className="code-search__result" aria-label={match.path}>
            <p className="code-search__path">
              <a
                className="code-search__file"
                href={matchHref(repository ?? ({ owner, name } as RepositorySummary), match.branch, match.path, query)}
              >
                {match.path}
              </a>
            </p>
            <p className="code-search__context">{`on ${match.branch}`}</p>
            <ul className="code-search__lines">
              {match.lines.map((line) => (
                <li key={`${match.path}-${line.number}`} className="code-search__line">
                  <code>{`${line.number}: ${line.text.trim()}`}</code>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {state === "ready" && matches.length > 0 ? (
        <p className="code-search__status" role="status">
          {`${matches.length} matching file${matches.length === 1 ? "" : "s"} in ${owner}/${name}`}
        </p>
      ) : null}
    </div>
  );
}
