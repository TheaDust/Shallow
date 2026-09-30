import { AccessDeniedPage } from "./AccessDeniedPage";
import { NotFoundPage, repositoryAccessHint } from "./NotFoundPage";
import { repositoryOverviewHref, repositoryCommitsHref, repositoryTreeHref } from "../lib/repository-routes";
import { AddFileMenu } from "../repository/AddFileMenu";
import { ClonePopover } from "../repository/ClonePopover";
import { ForkDialog } from "../repository/ForkDialog";
import { repositoryTitle, type RepositoryBranch } from "../lib/repositories-api";
import { BranchSelector } from "../repository/BranchSelector";
import { CommitList } from "../repository/CommitList";
import { RepositoryChrome } from "../repository/RepositoryChrome";
import { RepositoryEntryList } from "../repository/RepositoryEntryList";
import { useRepositoryOverview } from "../repository/useRepositoryOverview";

export interface RepositoryOverviewPageProps {
  owner: string;
  name: string;
}

/**
 * The Code page of a repository: the branch selector at the top, the files and
 * directories at the branch root, the history link above the file list and the
 * recent commit history (REQ-4-1, REQ-4-2-1). Opening the repository without a
 * branch reads the repository's default branch.
 */
export function RepositoryOverviewPage({ owner, name }: RepositoryOverviewPageProps) {
  const { state } = useRepositoryOverview(owner, name);

  if (state.status === "loading") {
    return (
      <main aria-busy="true">
        <p role="status">Loading repository…</p>
      </main>
    );
  }

  if (state.status === "denied") return <AccessDeniedPage owner={owner} name={name} />;
  if (state.status === "missing") return <NotFoundPage hint={repositoryAccessHint()} />;
  if (state.status === "error") {
    return (
      <main>
        <h1>Repository unavailable</h1>
        <p role="alert">The repository could not be loaded. Reload the page to try again.</p>
      </main>
    );
  }

  const repository = state.repository;
  const branch = repository.branch;
  const branches: RepositoryBranch[] =
    repository.branches ?? [{ name: branch, headCommitId: null }];
  const commits = repository.commits ?? [];
  const forkedFrom = repository.forkedFrom ?? null;
  const canWrite =
    repository.permissions?.role === "write" ||
    repository.permissions?.role === "maintain" ||
    repository.permissions?.role === "admin";

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
      {forkedFrom ? (
        <p className="repository-forked-from">
          Forked from{" "}
          <a href={repositoryOverviewHref(forkedFrom.owner, forkedFrom.name)}>
            {forkedFrom.fullName}
          </a>
        </p>
      ) : null}
      <div className="repository-actions">
        {canWrite ? <AddFileMenu owner={owner} name={name} branch={branch} /> : null}
        <ClonePopover owner={repository.owner.login} name={repository.name} />
        <ForkDialog owner={owner} name={name} sourceVisibility={repository.visibility} />
      </div>
      <div className="repository-code__toolbar">
        <BranchSelector
          owner={owner}
          name={name}
          branch={branch}
          branches={branches}
          branchHref={(next) => repositoryTreeHref(owner, name, next)}
        />
      </div>
      <section className="repository-files" aria-labelledby="repository-files-heading">
        <h2 id="repository-files-heading">Files</h2>
        <p className="repository-branch">
          Default branch: <span className="repository-branch__name">{branch}</span>
        </p>
        <p className="repository-commits-link">
          <a href={repositoryCommitsHref(owner, name, branch)}>Commits</a>{" "}
          <span className="repository-commit-count">{commits.length} commits</span>
        </p>
        <RepositoryEntryList
          owner={owner}
          name={name}
          branch={branch}
          entries={repository.entries}
        />
      </section>
      <section className="repository-commits" aria-labelledby="repository-commits-heading">
        <h2 id="repository-commits-heading">Commit history</h2>
        <CommitList owner={owner} name={name} commits={commits} />
      </section>
    </main>
  );
}
