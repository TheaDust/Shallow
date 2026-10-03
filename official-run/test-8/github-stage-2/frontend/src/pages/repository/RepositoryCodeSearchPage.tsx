import type { ReactNode } from "react";

import { searchRepositoryCode, type CodeSearchMatch } from "../../api/organizations";
import { useAuth } from "../../auth/AuthProvider";
import { RepositorySearchBox } from "../../components/RepositorySearchBox";
import { SiteHeader } from "../../components/SiteHeader";
import { makeHash } from "../../lib/hash-route";
import { blobPath, codeSearchPath, directoryOf, fileNameOf, repositoryPath } from "../../lib/repository-paths";
import { useAsyncData } from "../../lib/useAsyncData";

/** Marks every occurrence of the query inside one matched line. */
function highlight(text: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  const parts: ReactNode[] = [];
  let index = 0;
  let found = lower.indexOf(target);
  while (found >= 0) {
    if (found > index) parts.push(text.slice(index, found));
    parts.push(<mark key={found}>{text.slice(found, found + needle.length)}</mark>);
    index = found + needle.length;
    found = lower.indexOf(target, index);
  }
  parts.push(text.slice(index));
  return parts;
}

/**
 * Code search results of one repository (REQ-4-2-3). The query lives in the URL,
 * so the Search box keeps it and a reload repeats the same search; matching is
 * limited to readable file content of the repository being browsed, and the view
 * never writes a commit, a file or a branch.
 */
export function RepositoryCodeSearchPage({
  ownerLogin,
  repositoryName,
  query,
}: {
  ownerLogin: string;
  repositoryName: string;
  query: string;
}) {
  const { account } = useAuth();
  const { data, error, loading } = useAsyncData(
    () => searchRepositoryCode(ownerLogin, repositoryName, query),
    [ownerLogin, repositoryName, query],
  );
  const repository = data?.repository ?? null;
  const ownerName = repository?.owner?.displayName ?? ownerLogin;
  const matches: CodeSearchMatch[] = data?.matches ?? [];
  const searchHash = makeHash(codeSearchPath(ownerLogin, repositoryName), new URLSearchParams({ q: query }));

  return (
    <main>
      <SiteHeader account={account} showGlobalSearch={false} />
      <nav className="code-breadcrumb" aria-label="Breadcrumb">
        <a
          className="code-breadcrumb__repository"
          href={makeHash(repositoryPath(ownerLogin, repositoryName))}
        >
          {`${ownerName}/${repositoryName}`}
        </a>
      </nav>
      <RepositorySearchBox ownerLogin={ownerLogin} repositoryName={repositoryName} query={query} />
      <nav className="code-search__views" aria-label="Search results">
        <a className="code-search__view" href={searchHash} aria-current="page">
          Code
        </a>
      </nav>
      <h1>Search results</h1>
      {loading ? <p role="status">Loading…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {data && !error ? (
        matches.length === 0 ? (
          <p className="code-search__empty">No code results</p>
        ) : (
          <ul className="code-search__results">
            {matches.map((match) => (
              <li className="code-search__result" key={match.path}>
                <p className="code-search__file">
                  <a
                    className="code-search__link"
                    href={makeHash(blobPath(ownerLogin, repositoryName, data.branch, match.path))}
                  >
                    {fileNameOf(match.path)}
                  </a>
                  <span className="code-search__directory">{directoryOf(match.path)}</span>
                </p>
                <pre className="code-search__lines">
                  {match.lines.map((line) => (
                    <span className="code-search__line" key={line.number}>
                      {`${line.number}: `}
                      {highlight(line.text, data.query)}
                      {"\n"}
                    </span>
                  ))}
                </pre>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </main>
  );
}
