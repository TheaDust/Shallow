import { useEffect, useState } from "react";

import { makeHash, useHashLocation } from "../lib/hash-route";
import { repositoryBlobHref, repositoryOverviewHref } from "../lib/repository-routes";
import {
  repositoryVisibilityLabel,
  searchRepositories,
  searchRepositoryCode,
  type RepositorySummary,
} from "../lib/repositories-api";
import { useRepositoryResource } from "../repository/useRepositoryResource";
import { FormField } from "../ui";

/** GitHub-style result scopes; repositories and code are served today. */
const SEARCH_TYPES: Array<{ value: string; label: string }> = [
  { value: "repositories", label: "Repositories" },
  { value: "code", label: "Code" },
  { value: "issues", label: "Issues" },
  { value: "pull-requests", label: "Pull requests" },
];

function typeHref(
  query: string,
  type: string,
  repository: string,
  path = "",
): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("type", type);
  if (repository) params.set("repo", repository);
  if (path) params.set("path", path);
  return makeHash("/search", params);
}

function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return updatedAt;
  return date.toISOString().slice(0, 10);
}

const LANGUAGES: Array<{ id: string; label: string; extensions: string[] }> = [
  { id: "markdown", label: "Markdown", extensions: [".md", ".markdown"] },
  { id: "typescript", label: "TypeScript", extensions: [".ts", ".tsx"] },
  { id: "javascript", label: "JavaScript", extensions: [".js", ".jsx"] },
  { id: "json", label: "JSON", extensions: [".json"] },
  { id: "text", label: "Text", extensions: [".txt", ".yml", ".yaml"] },
];

function languageOf(path: string): string {
  const match = LANGUAGES.find((language) =>
    language.extensions.some((extension) => path.toLowerCase().endsWith(extension)),
  );
  return match ? match.id : "other";
}

function SearchResultItem({ repository }: { repository: RepositorySummary }) {
  return (
    <li className="search-result">
      <article>
        <h3 className="search-result__name">
          <a href={repositoryOverviewHref(repository.owner.login, repository.name)}>
            {repository.name}
          </a>
        </h3>
        <p className="search-result__full-name">{repository.fullName}</p>
        <p className="search-result__description">{repository.description}</p>
        <p className="search-result__meta">
          <span className="visibility-badge" data-visibility={repository.visibility}>
            {repositoryVisibilityLabel(repository.visibility)}
          </span>
          <span className="search-result__updated">
            Updated <time dateTime={repository.updatedAt}>{formatUpdatedAt(repository.updatedAt)}</time>
          </span>
        </p>
      </article>
    </li>
  );
}

interface CodeSearchSectionProps {
  query: string;
  repositoryScope: string;
}

/**
 * Code results inside one repository — or, without a repository scope, inside
 * every repository the viewer may read (REQ-4-2-3): matching snippets, file
 * paths and the branch the content was read from, limited to readable content.
 * The path and language filters are optional.
 */
function CodeSearchSection({ query, repositoryScope }: CodeSearchSectionProps) {
  const location = useHashLocation();
  const urlPath = location.search.get("path") ?? "";
  const [pathFilter, setPathFilter] = useState(urlPath);
  const [language, setLanguage] = useState("all");

  useEffect(() => {
    setPathFilter(urlPath);
    setLanguage("all");
  }, [query, repositoryScope, urlPath]);

  // A path carried by the address filters the read itself; typing in the filter
  // narrows the loaded results immediately, without another read.
  const state = useRepositoryResource(
    () => searchRepositoryCode(query, repositoryScope, urlPath),
    [query, repositoryScope, urlPath],
  );

  if (state.status === "loading") return <p role="status">Searching…</p>;
  if (state.status === "error" || state.status === "denied" || state.status === "missing") {
    return <p role="alert">Search is unavailable right now. Try again.</p>;
  }

  const payload = state.value;
  const needle = pathFilter.trim().toLowerCase();
  const results = (payload.results ?? []).filter(
    (result) =>
      (!needle || result.path.toLowerCase().includes(needle)) &&
      (language === "all" || languageOf(result.path) === language),
  );
  const scopeBranch = payload.repository?.branch ?? "";
  const [scopeOwner, scopeName] = repositoryScope.split("/");

  return (
    <>
      {repositoryScope ? (
        <p className="search-scope">
          Repository:{" "}
          <a href={repositoryOverviewHref(scopeOwner, scopeName)}>{repositoryScope}</a>
        </p>
      ) : (
        <p className="search-scope">Repository: every repository you can read</p>
      )}
      <div className="code-filters">
        <FormField id="code-path-filter" label="Path">
          <input
            id="code-path-filter"
            type="text"
            autoComplete="off"
            placeholder="Filter by path"
            value={pathFilter}
            onChange={(event) => setPathFilter(event.target.value)}
          />
        </FormField>
        <FormField id="code-language-filter" label="Language">
          <select
            id="code-language-filter"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="all">All languages</option>
            {LANGUAGES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      {results.length > 0 ? (
        <ul className="code-results">
          {results.map((result) => (
            <li key={`${result.repository.fullName}:${result.branch}:${result.path}`} className="code-result">
              <article>
                <h3 className="code-result__name">
                  <a
                    href={repositoryBlobHref(
                      result.repository.owner,
                      result.repository.name,
                      result.branch,
                      result.path,
                    )}
                  >
                    {result.name}
                  </a>
                </h3>
                <p className="code-result__path">{result.path}</p>
                <p className="code-result__branch">
                  Branch: <span className="code-result__branch-name">{result.branch}</span>
                  {" in "}
                  <span className="code-result__repository">{result.repository.fullName}</span>
                </p>
                <pre className="code-result__snippet">
                  <code>{result.snippet}</code>
                </pre>
              </article>
            </li>
          ))}
        </ul>
      ) : (
        <h2 className="search-empty">No code results</h2>
      )}
      {scopeBranch ? (
        <p className="code-results__scope">
          Read from the <span>{scopeBranch}</span> branch of {repositoryScope}.
        </p>
      ) : null}
    </>
  );
}

export function SearchPage() {
  const location = useHashLocation();
  const query = (location.search.get("q") ?? "").trim();
  const type = location.search.get("type") ?? "repositories";
  const repositoryScope = location.search.get("repo") ?? "";

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);

  useEffect(() => {
    if (type === "code") return;
    let active = true;
    // Old results are dropped as soon as the query or the scope changes.
    setStatus("loading");
    setRepositories([]);
    searchRepositories(query, type)
      .then((results) => {
        if (!active) return;
        setRepositories(results.repositories);
        setStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setRepositories([]);
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [query, type]);

  const showRepositories = type === "repositories" && repositories.length > 0;

  return (
    <main aria-busy={type !== "code" && status === "loading" ? true : undefined}>
      <h1>Search results</h1>
      <nav className="search-types" aria-label="Search type">
        {SEARCH_TYPES.map((option) => (
          <a
            key={option.value}
            href={typeHref(query, option.value, repositoryScope)}
            aria-current={option.value === type ? "page" : undefined}
          >
            {option.label}
          </a>
        ))}
      </nav>
      {type === "code" ? (
        <CodeSearchSection query={query} repositoryScope={repositoryScope} />
      ) : status === "loading" ? (
        <p role="status">Searching…</p>
      ) : status === "error" ? (
        <p role="alert">Search is unavailable right now. Try again.</p>
      ) : showRepositories ? (
        <ul className="search-results">
          {repositories.map((repository) => (
            <SearchResultItem key={repository.id} repository={repository} />
          ))}
        </ul>
      ) : (
        <h2 className="search-empty">No results</h2>
      )}
    </main>
  );
}
