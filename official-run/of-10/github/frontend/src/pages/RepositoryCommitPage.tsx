import { AccessDeniedPage } from "./AccessDeniedPage";
import { NotFoundPage, repositoryAccessHint } from "./NotFoundPage";
import { relativeTime } from "../lib/relative-time";
import { useHashLocation } from "../lib/hash-route";
import {
  repositoryCommitHref,
  repositoryCommitsHref,
} from "../lib/repository-routes";
import {
  fetchRepositoryCommit,
  repositoryTitle,
  type RepositoryCommitPayload,
} from "../lib/repositories-api";
import { ChangedFiles } from "../repository/ChangedFiles";
import { RepositoryChrome } from "../repository/RepositoryChrome";
import { useRepositoryResource } from "../repository/useRepositoryResource";

export interface RepositoryCommitPageProps {
  owner: string;
  name: string;
  commitId: string;
}

/**
 * One commit entry (REQ-4-2-2): the repository and the commit revision, the
 * base (its parent) and compare identifiers, the parent revision and every
 * changed file with its line-by-line additions and deletions. The view is
 * read-only: it never creates a review, comment or commit.
 */
export function RepositoryCommitPage({ owner, name, commitId }: RepositoryCommitPageProps) {
  const location = useHashLocation();
  const pathFilter = location.search.get("path") ?? "";
  const state = useRepositoryResource<RepositoryCommitPayload>(
    () => fetchRepositoryCommit(owner, name, commitId, pathFilter),
    [owner, name, commitId, pathFilter],
  );

  if (state.status === "loading") {
    return (
      <main aria-busy="true">
        <p role="status">Loading commit…</p>
      </main>
    );
  }

  if (state.status === "denied") return <AccessDeniedPage owner={owner} name={name} />;
  if (state.status === "missing") return <NotFoundPage hint={repositoryAccessHint()} />;
  if (state.status === "error") {
    return (
      <main>
        <h1>Commit unavailable</h1>
        <p role="alert">The commit could not be loaded. Reload the page to try again.</p>
      </main>
    );
  }

  const { repository, commit } = state.value;
  const parent = commit.parent;

  return (
    <main>
      <RepositoryChrome
        owner={owner}
        name={name}
        title={repositoryTitle(repository)}
        visibility={repository.visibility}
        description={repository.description}
        activeEntry="Code"
      />
      <h2 className="commit-page__message">{commit.message}</h2>
      <p className="commit-page__meta">
        <span className="commit-page__author">{commit.author}</span> committed{" "}
        <time dateTime={commit.createdAt}>{relativeTime(commit.createdAt)}</time>{" "}
        <span className="commit-page__hash">{commit.shortId}</span>
      </p>
      <p className="commit-page__revisions">
        Base: <span className="commit-page__revision">{commit.base.shortId ?? "root"}</span>{" "}
        Compare: <span className="commit-page__revision">{commit.compare.shortId}</span>
      </p>
      {parent ? (
        <p className="commit-page__parent">
          Parent: <a href={repositoryCommitHref(owner, name, parent.id)}>{parent.shortId}</a>{" "}
          <span className="commit-page__parent-message">{parent.message}</span>
        </p>
      ) : (
        <p className="commit-page__parent">This commit is the first commit of the repository.</p>
      )}
      {pathFilter ? (
        <p className="commit-page__scope">
          Diff for <span className="commit-page__scope-path">{pathFilter}</span>{" "}
          <a href={repositoryCommitHref(owner, name, commit.id)}>Show all changed files</a>
        </p>
      ) : null}
      <ChangedFiles
        changedFiles={commit.changedFiles}
        filesChanged={commit.filesChanged}
        additions={commit.additions}
        deletions={commit.deletions}
        fileHref={(path) => repositoryCommitHref(owner, name, commit.id, path)}
      />
      <p className="commit-page__history">
        <a href={repositoryCommitsHref(owner, name, repository.branch)}>Commits</a>
      </p>
    </main>
  );
}
