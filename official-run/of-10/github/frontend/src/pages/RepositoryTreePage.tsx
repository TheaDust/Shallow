import { AccessDeniedPage } from "./AccessDeniedPage";
import { NotFoundPage, repositoryAccessHint } from "./NotFoundPage";
import {
  repositoryCommitsHref,
  repositoryTreeHref,
} from "../lib/repository-routes";
import { repositoryTitle, type RepositoryBranch, type RepositoryContext } from "../lib/repositories-api";
import { AddFileMenu } from "../repository/AddFileMenu";
import { BranchSelector } from "../repository/BranchSelector";
import { CommitList } from "../repository/CommitList";
import { RepositoryBreadcrumbs, parentPathOf } from "../repository/RepositoryBreadcrumbs";
import { RepositoryChrome } from "../repository/RepositoryChrome";
import { RepositoryEntryList } from "../repository/RepositoryEntryList";
import { useRepositoryOverview } from "../repository/useRepositoryOverview";

export interface RepositoryTreePageProps {
  owner: string;
  name: string;
  branch: string;
  path: string;
}

function branchesOf(context: RepositoryContext, branch: string): RepositoryBranch[] {
  return context.branches ?? [{ name: branch, headCommitId: null }];
}

function canWriteContext(context: RepositoryContext): boolean {
  const role = context.permissions?.role;
  return role === "write" || role === "maintain" || role === "admin";
}

/**
 * A directory of one branch: the current branch, the path breadcrumbs back to
 * the parent directories and the files and directories directly inside it
 * (REQ-4-1). Switching the branch keeps the current path.
 */
export function RepositoryTreePage({ owner, name, branch, path }: RepositoryTreePageProps) {
  const { state } = useRepositoryOverview(owner, name, { branch, path });

  if (state.status === "loading") {
    return (
      <main aria-busy="true">
        <p role="status">Loading directory…</p>
      </main>
    );
  }

  if (state.status === "denied") return <AccessDeniedPage owner={owner} name={name} />;
  if (state.status === "error") {
    return (
      <main>
        <h1>Directory unavailable</h1>
        <p role="alert">The directory could not be loaded. Reload the page to try again.</p>
      </main>
    );
  }

  if (state.status === "missing") {
    if (!state.context) return <NotFoundPage hint={repositoryAccessHint()} />;
    // The repository and branch stay visible while the directory is shown as
    // absent there, so switching to a branch without it keeps the context. The
    // breadcrumbs lead to the directories that do exist, never to the path that
    // this branch does not have.
    const context = state.context;
    return (
      <main>
        <RepositoryChrome
          owner={owner}
          name={name}
          title={repositoryTitle(context)}
          visibility={context.visibility}
          description={context.description}
          activeEntry="Code"
        />
        <div className="repository-code__toolbar">
          <BranchSelector
            owner={owner}
            name={name}
            branch={context.branch}
            branches={branchesOf(context, context.branch)}
            branchHref={(next) => repositoryTreeHref(owner, name, next, path)}
          />
        </div>
        <p className="repository-branch">
          Branch: <span className="repository-branch__name">{context.branch}</span>
        </p>
        <RepositoryBreadcrumbs
          owner={owner}
          name={name}
          branch={context.branch}
          path={parentPathOf(path)}
          leaf="dir"
        />
        <p className="repository-file__absent">
          <span className="repository-file__path">{path}</span> does not exist on the{" "}
          <span>{context.branch}</span> branch.
        </p>
      </main>
    );
  }

  const repository = state.repository;
  const currentBranch = repository.branch;
  const branches: RepositoryBranch[] =
    repository.branches ?? [{ name: currentBranch, headCommitId: null }];
  const commits = repository.commits ?? [];
  const currentPath = repository.path ?? "";

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
      <div className="repository-code__toolbar">
        <BranchSelector
          owner={owner}
          name={name}
          branch={currentBranch}
          branches={branches}
          branchHref={(next) => repositoryTreeHref(owner, name, next, currentPath)}
        />
        {canWriteContext(repository) ? (
          <AddFileMenu owner={owner} name={name} branch={currentBranch} />
        ) : null}
      </div>
      <p className="repository-branch">
        Branch: <span className="repository-branch__name">{currentBranch}</span>
      </p>
      <RepositoryBreadcrumbs
        owner={owner}
        name={name}
        branch={currentBranch}
        path={currentPath}
        leaf="dir"
      />
      <section className="repository-files" aria-labelledby="repository-files-heading">
        <h2 id="repository-files-heading">Files</h2>
        <p className="repository-commits-link">
          <a href={repositoryCommitsHref(owner, name, currentBranch, currentPath)}>Commits</a>{" "}
          <span className="repository-commit-count">{commits.length} commits</span>
        </p>
        <RepositoryEntryList
          owner={owner}
          name={name}
          branch={currentBranch}
          entries={repository.entries}
        />
      </section>
      {currentPath === "" ? (
        <section className="repository-commits" aria-labelledby="repository-commits-heading">
          <h2 id="repository-commits-heading">Commit history</h2>
          <CommitList owner={owner} name={name} commits={commits} />
        </section>
      ) : null}
    </main>
  );
}
