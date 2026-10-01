import { CodeToolbar } from "../features/repositories/CodeToolbar";
import { CommitCountLink } from "../features/repositories/CommitCountLink";
import { ForkButton } from "../features/repositories/ForkButton";
import { RepositoryFileList } from "../features/repositories/RepositoryFileList";
import { RepositoryHeader } from "../features/repositories/RepositoryHeader";
import { RepositoryLoadState } from "../features/repositories/RepositoryFallbacks";
import { branchCreator } from "../features/repositories/branch-actions";
import { useRepositoryContents } from "../features/repositories/use-repository-contents";
import { useRepositoryOverview } from "../features/repositories/use-repository";

export interface RepositoryPageProps {
  owner: string;
  name: string;
  /** The selected branch; the repository default branch when omitted. */
  branch?: string;
}

/**
 * Code page of a repository (REQ-3-3, REQ-4-1).
 *
 * The heading spells the repository as "owner/repository name" next to the
 * Public/Private marker, the toolbar carries the current branch selector and
 * the main area lists the files and directories at the root of that branch; a
 * file name opens its read-only file page and a directory name opens the
 * directory page.
 */
export function RepositoryPage({ owner, name, branch: requestedBranch }: RepositoryPageProps) {
  const { state: repositoryState, repository, reload } = useRepositoryOverview(owner, name);
  const branch = requestedBranch ?? repository?.defaultBranch ?? "main";
  const hasBranches = (repository?.branches.length ?? 0) > 0;
  const { state, directory, commitCount } = useRepositoryContents(
    owner,
    name,
    "",
    hasBranches ? branch : undefined,
    Boolean(repository),
  );

  if (!repository || repositoryState !== "ready") return <RepositoryLoadState state={repositoryState} />;

  const entries = directory?.entries ?? [];

  return (
    <main className="repository-page">
      <RepositoryHeader
        repository={repository}
        cloneUrls={repository.cloneUrls}
        active="code"
        branch={branch}
        actions={<ForkButton owner={repository.owner} name={repository.name} />}
      />
      <CodeToolbar
        repository={repository}
        branch={branch}
        onCreateBranch={branchCreator(owner, name, branch, reload)}
      />
      {state === "loading" ? <p role="status">Loading files…</p> : null}
      {state === "failed" ? <p role="alert">The files could not be loaded. Please try again.</p> : null}
      {state === "denied" ? (
        <p role="alert">Access denied. This repository belongs to a namespace your account cannot read.</p>
      ) : null}
      {state === "missing" ? (
        <p role="alert">{`Branch ${branch} was not found in this repository.`}</p>
      ) : null}
      {state === "ready" && entries.length > 0 ? (
        <CommitCountLink repository={repository} branch={branch} count={commitCount} />
      ) : null}
      {state === "ready" && entries.length > 0 ? (
        <RepositoryFileList repository={repository} branch={branch} entries={entries} />
      ) : null}
      {state === "ready" && entries.length === 0 ? (
        <p className="repository-page__empty">This repository is empty.</p>
      ) : null}
    </main>
  );
}
