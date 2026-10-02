import { navigateHref, useHashLocation } from "../lib/hash-route";
import { CodeToolbar } from "../features/repositories/CodeToolbar";
import { PathBreadcrumbs } from "../features/repositories/PathBreadcrumbs";
import { RepositoryHeader } from "../features/repositories/RepositoryHeader";
import { RepositoryLoadState } from "../features/repositories/RepositoryFallbacks";
import { branchCreator } from "../features/repositories/branch-actions";
import { formatCommitTime } from "../features/repositories/format-commit";
import { blobHref, commitHref } from "../features/repositories/repository-links";
import { useRepositoryContents } from "../features/repositories/use-repository-contents";
import { useRepositoryOverview } from "../features/repositories/use-repository";

export interface RepositoryFilePageProps {
  owner: string;
  name: string;
  branch?: string;
  path: string;
}

/**
 * Read-only file page of a branch (REQ-4-1).
 *
 * It reads the stored content, the file name and the most recent commit of that
 * path on the current branch, spells the repository and the branch, shows the
 * full path with breadcrumbs that return to the parent directory, and creates
 * no file change. The last breadcrumb segment is a link named exactly after the
 * file and points at this file page, so a file opened from a code search result
 * keeps a named link to itself across a reload (REQ-4-2-3). The stored content
 * stays one complete text value, so a file opened from a code search result
 * shows the matching text, and the most recent commit is a commit entry that
 * opens the commit comparison (REQ-4-2-2).
 */
export function RepositoryFilePage({ owner, name, branch: requestedBranch, path }: RepositoryFilePageProps) {
  const { search } = useHashLocation();
  const { state: repositoryState, repository, reload } = useRepositoryOverview(owner, name);
  const branch = requestedBranch ?? repository?.defaultBranch ?? "main";
  const { state, file } = useRepositoryContents(owner, name, path, branch, Boolean(repository));

  if (!repository || repositoryState !== "ready") return <RepositoryLoadState state={repositoryState} />;

  const saved = search.get("saved");

  return (
    <main className="repository-file-page">
      <RepositoryHeader repository={repository} cloneUrls={repository.cloneUrls} active="code" branch={branch} />
      <CodeToolbar
        repository={repository}
        branch={branch}
        filePath={state === "ready" && file ? file.path : undefined}
        onCreateBranch={branchCreator(owner, name, branch, reload)}
        onSelectBranch={(next) => navigateHref(blobHref(repository, next, path))}
      />
      {saved ? <p role="status">{`Saved ${saved} on ${branch}.`}</p> : null}
      {state === "loading" ? <p role="status">Loading file…</p> : null}
      {state === "failed" ? <p role="alert">The file could not be loaded. Please try again.</p> : null}
      {state === "denied" ? (
        <p role="alert">Access denied. This file belongs to a repository your account cannot read.</p>
      ) : null}
      {state === "missing" ? (
        <p role="alert">{`This file does not exist on branch ${branch}.`}</p>
      ) : null}
      {state === "ready" && file ? (
        <>
          <PathBreadcrumbs
            repository={repository}
            branch={branch}
            path={file.path}
            currentHref={blobHref(repository, branch, file.path)}
          />
          <h2 className="repository-file__path">{file.path}</h2>
          {file.lastCommit ? (
            <p className="repository-file__commit">
              <span className="repository-file__commit-label">Last commit</span>
              <a className="repository-file__commit-link" href={commitHref(repository, file.lastCommit.id)}>
                {file.lastCommit.message}
              </a>
              <span className="repository-file__commit-author">{file.lastCommit.author}</span>
              <span className="repository-file__commit-time">{formatCommitTime(file.lastCommit.createdAt)}</span>
            </p>
          ) : null}
          <article className="repository-file" aria-label={file.path}>
            <pre className="repository-file__content">
              <code>{file.content}</code>
            </pre>
          </article>
        </>
      ) : null}
    </main>
  );
}
