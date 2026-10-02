import { CodeToolbar } from "../features/repositories/CodeToolbar";
import { CommitCountLink } from "../features/repositories/CommitCountLink";
import { PathBreadcrumbs } from "../features/repositories/PathBreadcrumbs";
import { RepositoryFileList } from "../features/repositories/RepositoryFileList";
import { RepositoryHeader } from "../features/repositories/RepositoryHeader";
import { RepositoryLoadState } from "../features/repositories/RepositoryFallbacks";
import { branchCreator } from "../features/repositories/branch-actions";
import { treeHref } from "../features/repositories/repository-links";
import { navigateHref } from "../lib/hash-route";
import { useRepositoryContents } from "../features/repositories/use-repository-contents";
import { useRepositoryOverview } from "../features/repositories/use-repository";

export interface RepositoryTreePageProps {
  owner: string;
  name: string;
  branch?: string;
  path: string;
}

/**
 * Directory page of a branch (REQ-4-1).
 *
 * The page displays the current branch, the path breadcrumbs of the directory
 * and the file list of that directory; the breadcrumbs return to the parent
 * directory and every file name still opens the read-only file page, on the
 * same branch.
 */
export function RepositoryTreePage({ owner, name, branch: requestedBranch, path }: RepositoryTreePageProps) {
  const { state: repositoryState, repository, reload } = useRepositoryOverview(owner, name);
  const branch = requestedBranch ?? repository?.defaultBranch ?? "main";
  const { state, directory, commitCount } = useRepositoryContents(owner, name, path, branch, Boolean(repository));

  if (!repository || repositoryState !== "ready") return <RepositoryLoadState state={repositoryState} />;

  const entries = directory?.entries ?? [];

  return (
    <main className="repository-tree-page">
      <RepositoryHeader repository={repository} cloneUrls={repository.cloneUrls} active="code" branch={branch} />
      <CodeToolbar
        repository={repository}
        branch={branch}
        onCreateBranch={branchCreator(owner, name, branch, reload)}
        onSelectBranch={(next) => navigateHref(treeHref(repository, next, path))}
      />
      {state === "loading" ? <p role="status">Loading directory…</p> : null}
      {state === "failed" ? <p role="alert">The directory could not be loaded. Please try again.</p> : null}
      {state === "denied" ? (
        <p role="alert">Access denied. This directory belongs to a repository your account cannot read.</p>
      ) : null}
      {state === "missing" ? (
        <p role="alert">{`This directory does not exist on branch ${branch}.`}</p>
      ) : null}
      {state === "ready" ? (
        <>
          <PathBreadcrumbs repository={repository} branch={branch} path={path} />
          {entries.length > 0 ? (
            <>
              <CommitCountLink repository={repository} branch={branch} count={commitCount} />
              <RepositoryFileList repository={repository} branch={branch} entries={entries} />
            </>
          ) : (
            <p className="repository-page__empty">This directory is empty.</p>
          )}
        </>
      ) : null}
    </main>
  );
}
