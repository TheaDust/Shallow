import { AccessDeniedPage } from "./AccessDeniedPage";
import { NotFoundPage, repositoryAccessHint } from "./NotFoundPage";
import { relativeTime } from "../lib/relative-time";
import {
  repositoryBlobHref,
  repositoryCommitHref,
  repositoryCommitsHref,
  repositoryEditorHref,
} from "../lib/repository-routes";
import {
  fetchRepositoryFile,
  repositoryTitle,
  type RepositoryBranch,
  type RepositoryContext,
  type RepositoryFilePayload,
} from "../lib/repositories-api";
import { BranchSelector } from "../repository/BranchSelector";
import { AddFileMenu } from "../repository/AddFileMenu";
import { RepositoryBreadcrumbs, parentPathOf } from "../repository/RepositoryBreadcrumbs";
import { RepositoryChrome } from "../repository/RepositoryChrome";
import { useRepositoryResource } from "../repository/useRepositoryResource";

export interface RepositoryFilePageProps {
  owner: string;
  name: string;
  branch: string;
  path: string;
}

function branchesOf(context: RepositoryContext, branch: string): RepositoryBranch[] {
  return context.branches ?? [{ name: branch, headCommitId: null }];
}

/**
 * Read-only file page of one branch and path (REQ-4-1): the full path as
 * breadcrumbs, the current branch, the stored content and the most recent
 * commit that changed the file. Reading a file never writes: the branch and the
 * content stay exactly as stored. A branch without that file keeps the
 * repository and the branch visible while showing the file as absent.
 */
export function RepositoryFilePage({ owner, name, branch, path }: RepositoryFilePageProps) {
  const state = useRepositoryResource<RepositoryFilePayload>(
    () => fetchRepositoryFile(owner, name, branch, path),
    [owner, name, branch, path],
  );

  if (state.status === "loading") {
    return (
      <main aria-busy="true">
        <p role="status">Loading file…</p>
      </main>
    );
  }

  if (state.status === "denied") return <AccessDeniedPage owner={owner} name={name} />;
  if (state.status === "error") {
    return (
      <main>
        <h1>File unavailable</h1>
        <p role="alert">The file could not be loaded. Reload the page to try again.</p>
      </main>
    );
  }

  if (state.status === "missing") {
    if (!state.context) return <NotFoundPage hint={repositoryAccessHint()} />;
    // The repository and branch stay visible while the file is shown as absent
    // there, so switching to a branch without it keeps the context while the
    // stored content of the other branch is never displayed. The breadcrumbs
    // lead to the directories that do exist, never to the missing path.
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
            branchHref={(next) => repositoryBlobHref(owner, name, next, path)}
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

  const { repository, file } = state.value;
  const commit = file.commit;
  const role = repository.permissions?.role;
  const canWrite = role === "write" || role === "maintain" || role === "admin";

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
          branch={file.branch}
          branches={branchesOf(repository, file.branch)}
          branchHref={(next) => repositoryBlobHref(owner, name, next, file.path)}
        />
        {canWrite ? <AddFileMenu owner={owner} name={name} branch={file.branch} /> : null}
      </div>
      <p className="repository-branch">
        Branch: <span className="repository-branch__name">{file.branch}</span>
      </p>
      <RepositoryBreadcrumbs
        owner={owner}
        name={name}
        branch={file.branch}
        path={file.path}
        leaf="file"
      />
      <section className="repository-file" aria-labelledby="repository-file-heading">
        <h2 id="repository-file-heading" className="repository-file__name">
          {file.name}
        </h2>
        {canWrite ? (
          <p className="repository-file__edit">
            <a href={repositoryEditorHref(owner, name, file.branch, file.path)}>Edit</a>
          </p>
        ) : null}
        <pre className="repository-file__content">
          <code>{file.content}</code>
        </pre>
        {commit ? (
          <p className="repository-file__commit">
            Last commit:{" "}
            <a href={repositoryCommitHref(owner, name, commit.id)}>{commit.message}</a> by{" "}
            <span className="repository-file__author">{commit.author}</span>{" "}
            <time dateTime={commit.createdAt}>{relativeTime(commit.createdAt)}</time>
          </p>
        ) : null}
        <p className="repository-file__history">
          <a href={repositoryCommitsHref(owner, name, file.branch, file.path)}>Commits</a>
        </p>
      </section>
    </main>
  );
}
