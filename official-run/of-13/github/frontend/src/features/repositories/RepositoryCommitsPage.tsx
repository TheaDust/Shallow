import { useEffect, useState } from "react";

import {
  canWriteRepositoryRole,
  fetchRepositoryHistory,
  repositoryCommitHref,
  repositoryCommitsHref,
  repositoryCodeHref,
  repositoryCompareHref,
  type RepositoryHistory,
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
import { formatRelativeTime } from "./commit-format";

export interface RepositoryCommitsPageProps {
  owner: string;
  name: string;
  branch: string;
  /** When set, only the history that changed this file path is listed. */
  path: string;
}

/**
 * The commit history of one branch, or - with a file scope - only the commits
 * that changed that file. Commits stay newest first and the page is read-only.
 */
export function RepositoryCommitsPage({ owner, name, branch, path }: RepositoryCommitsPageProps) {
  const { status: sessionStatus, account } = useAccountSession();
  const [scope, setScope] = useState(path);

  useEffect(() => {
    setScope(path);
  }, [path]);

  const history = useRepositoryResource<RepositoryHistory>(
    `repository-history:${owner}/${name}:${branch}:${path}`,
    sessionStatus !== "loading",
    () => fetchRepositoryHistory(owner, name, { branch, path }),
  );

  useDocumentTitle(`Commits · ${owner}/${name}`);

  if (history.status === "denied") {
    return <RepositoryAccessDenied signedIn={Boolean(account)} />;
  }

  if (history.status === "missing" || history.status === "error") {
    return <RepositoryNotFound />;
  }

  if (history.status !== "ready") {
    return (
      <RepositoryLoading>
        <h1>{`${owner}/${name}`}</h1>
      </RepositoryLoading>
    );
  }

  const value = history.value;
  const repository = value.repository;
  const scopedPath = value.path;

  function submitScope(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    window.location.hash = repositoryCommitsHref(owner, name, {
      branch: value.branch,
      path: scope,
    });
  }

  return (
    <div className="repository-commits">
      <RepositoryHeader
        owner={repository.owner}
        name={repository.name}
        visibility={repository.visibility}
        description={repository.description}
        defaultBranch={repository.defaultBranch}
        showSettings={Boolean(account)}
        active="code"
        source={repository.source ?? null}
        branch={{
          branch: value.branch,
          branches: value.branches,
          hrefForBranch: (nextBranch) =>
            repositoryCommitsHref(repository.owner, repository.name, {
              branch: nextBranch,
              path: scopedPath,
            }),
          canWrite: canWriteRepositoryRole(repository.viewerRole),
        }}
        history={{
          href: repositoryCommitsHref(repository.owner, repository.name, {
            branch: value.branch,
            path: scopedPath,
          }),
          count: value.commitCount,
        }}
      />
      <section className="repository-commits__section" aria-labelledby="commit-history-title">
        <h2 id="commit-history-title">Commit history</h2>
        <p className="repository-commits__context">
          <span className="repository-commits__branch">{`Branch: ${value.branch}`}</span>
          <span className="repository-commits__scope">
            {scopedPath.length > 0 ? `File: ${scopedPath}` : "Whole branch"}
          </span>
        </p>
        <form className="repository-commits__scope-form" aria-label="History scope" onSubmit={submitScope}>
          <label htmlFor="history-scope-path">File path</label>
          <input
            id="history-scope-path"
            name="path"
            type="text"
            value={scope}
            placeholder="README.md"
            onChange={(event) => setScope(event.target.value)}
          />
          <button type="submit">Show file history</button>
          {scopedPath.length > 0 ? (
            <a
              className="repository-commits__clear"
              href={repositoryCommitsHref(repository.owner, repository.name, {
                branch: value.branch,
              })}
            >
              All commits
            </a>
          ) : null}
        </form>
        {value.commits.length === 0 ? (
          <p role="status">No commits</p>
        ) : (
          <ol className="repository-commits__list">
            {value.commits.map((commit) => (
              <li key={commit.id} className="commit-record">
                <article className="commit-record__body">
                  <h3 className="commit-record__message">
                    {/* The commit message opens the same entry as its short hash. */}
                    <a
                      className="commit-record__message-link"
                      href={repositoryCommitHref(repository.owner, repository.name, commit.sha, {
                        path: scopedPath,
                      })}
                    >
                      {commit.message}
                    </a>
                  </h3>
                  <p className="commit-record__meta">
                    <a
                      className="commit-record__sha"
                      href={repositoryCommitHref(repository.owner, repository.name, commit.sha, {
                        path: scopedPath,
                      })}
                    >
                      {commit.shortSha ?? commit.sha}
                    </a>
                    <span className="commit-record__author">{commit.author ?? "Unknown author"}</span>
                    {/* `time` takes its accessible name from aria-label, not its text. */}
                    <time
                      className="commit-record__time"
                      dateTime={commit.createdAt}
                      aria-label={formatRelativeTime(commit.createdAt)}
                    >
                      {formatRelativeTime(commit.createdAt)}
                    </time>
                  </p>
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>
      <p className="repository-commits__back">
        <a
          href={repositoryCodeHref(
            repository.owner,
            repository.name,
            "tree",
            value.branch,
            "",
          )}
        >
          Back to the file list
        </a>
        <a
          className="repository-commits__compare"
          href={repositoryCompareHref(repository.owner, repository.name, {
            branch: value.branch,
          })}
        >
          Compare revisions
        </a>
      </p>
    </div>
  );
}
