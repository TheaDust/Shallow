import { useEffect, useState } from "react";

import {
  canWriteRepositoryRole,
  repositoryCodeHref,
  repositoryCodeSearchHref,
  searchRepositoryCode,
  type RepositoryCodeSearch,
} from "../../lib/repository-code-api";
import { useDocumentTitle } from "../../lib/document-title";
import { useAccountSession } from "../account/AccountSession";
import { RepositoryHeader } from "./RepositoryHeader";
import {
  RepositoryAccessDenied,
  RepositoryLoading,
  RepositoryNotFound,
} from "./RepositoryPageStates";
import { useRepositoryResource } from "./useRepositoryResource";

export interface RepositoryCodeSearchPageProps {
  owner: string;
  name: string;
  query: string;
  path: string;
  language: string;
}

/**
 * Code search inside one repository. The results only ever come from the
 * readable branches of this repository, so an unauthorized private repository
 * cannot leak a snippet here. The type link `Code` is the only `Code` link of
 * the page, which keeps it distinguishable from repository navigation.
 *
 * The filters stay mounted while a new query runs; the results area alone shows
 * the busy state, so an old match is never displayed next to a new query.
 */
export function RepositoryCodeSearchPage({
  owner,
  name,
  query,
  path,
  language,
}: RepositoryCodeSearchPageProps) {
  const { status: sessionStatus, account } = useAccountSession();
  const [pathFilter, setPathFilter] = useState(path);
  const [languageFilter, setLanguageFilter] = useState(language);
  const [identity, setIdentity] = useState<RepositoryCodeSearch | null>(null);

  useEffect(() => {
    setPathFilter(path);
  }, [path]);

  useEffect(() => {
    setLanguageFilter(language);
  }, [language]);

  const results = useRepositoryResource<RepositoryCodeSearch>(
    `repository-code-search:${owner}/${name}:${query}:${path}:${language}`,
    sessionStatus !== "loading",
    () => searchRepositoryCode(owner, name, { q: query, path, language }),
  );

  useEffect(() => {
    if (results.status === "ready") setIdentity(results.value);
  }, [results]);

  useDocumentTitle(`${query} · ${owner}/${name}`);

  if (results.status === "denied") {
    return <RepositoryAccessDenied signedIn={Boolean(account)} />;
  }

  if (!identity) {
    if (results.status === "missing" || results.status === "error") {
      return <RepositoryNotFound />;
    }
    return (
      <RepositoryLoading>
        <h1>{`${owner}/${name}`}</h1>
      </RepositoryLoading>
    );
  }

  const repository = identity.repository;
  const matched = results.status === "ready" ? results.value.results : [];
  const busy = results.status === "loading";
  const failed = results.status === "error";

  function searchHref(next: { q?: string; path?: string; language?: string }): string {
    return repositoryCodeSearchHref(owner, name, {
      q: next.q ?? query,
      path: next.path ?? pathFilter,
      language: next.language ?? languageFilter,
    });
  }

  return (
    <div className="repository-code-search">
      <RepositoryHeader
        owner={repository.owner}
        name={repository.name}
        visibility={repository.visibility}
        description={repository.description}
        defaultBranch={repository.defaultBranch}
        showSettings={Boolean(account)}
        active="code"
        source={repository.source ?? null}
        showNav={false}
        branch={{
          branch: identity.branch,
          branches: identity.branches,
          hrefForBranch: (nextBranch) =>
            repositoryCodeSearchHref(repository.owner, repository.name, {
              branch: nextBranch,
              q: query,
              path,
              language,
            }),
          canWrite: canWriteRepositoryRole(repository.viewerRole),
        }}
      />
      <nav className="repository-code-search__types" aria-label="Search types">
        <ul>
          <li>
            <a href={searchHref({})} aria-current="page">
              Code
            </a>
          </li>
        </ul>
      </nav>
      <h2 className="repository-code-search__title">Code results</h2>
      <p className="repository-code-search__context">
        <span className="repository-code-search__repository">{`${repository.owner}/${repository.name}`}</span>
        <span className="repository-code-search__branch">{`Branch: ${identity.branch}`}</span>
        <span className="repository-code-search__query">{query}</span>
      </p>
      <form className="repository-code-search__filters" aria-label="Code search filters">
        <label htmlFor="code-search-path">Path</label>
        <input
          id="code-search-path"
          name="path"
          type="text"
          value={pathFilter}
          placeholder="src/"
          onChange={(event) => {
            setPathFilter(event.target.value);
            window.location.hash = searchHref({ path: event.target.value });
          }}
        />
        <label htmlFor="code-search-language">Language</label>
        <select
          id="code-search-language"
          name="language"
          value={languageFilter}
          onChange={(event) => {
            setLanguageFilter(event.target.value);
            window.location.hash = searchHref({ language: event.target.value });
          }}
        >
          <option value="">All languages</option>
          {identity.languages.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </form>
      {busy ? <p role="status">Loading…</p> : null}
      {failed ? (
        <p role="alert">Code search is temporarily unavailable. Try again.</p>
      ) : null}
      {!busy && !failed && matched.length === 0 ? (
        <p className="repository-code-search__empty" role="status">
          No code results
        </p>
      ) : null}
      {!busy && matched.length > 0 ? (
        <ul className="repository-code-search__list">
          {matched.map((result) => (
            <li key={`${result.branch}:${result.path}`} className="code-result">
              <article className="code-result__body">
                <h3 className="code-result__name">
                  <a
                    href={repositoryCodeHref(owner, name, "blob", result.branch, result.path, {
                      line: result.line,
                    })}
                  >
                    {result.name}
                  </a>
                </h3>
                <p className="code-result__path">{result.path}</p>
                <p className="code-result__context">{`Branch: ${result.branch}`}</p>
                <pre className="code-result__snippet">{result.snippet}</pre>
              </article>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
