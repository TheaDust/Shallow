import {
  canWriteRepositoryRole,
  fetchRepositoryCommit,
  repositoryCommitHref,
  repositoryCommitsHref,
  type RepositoryCommitView,
} from "../../lib/repository-code-api";
import { useDocumentTitle } from "../../lib/document-title";
import { useAccountSession } from "../account/AccountSession";
import { CommitDiffView } from "./CommitDiffView";
import { RepositoryHeader } from "./RepositoryHeader";
import {
  RepositoryAccessDenied,
  RepositoryLoading,
  RepositoryNotFound,
} from "./RepositoryPageStates";
import { useRepositoryResource } from "./useRepositoryResource";
import { formatRelativeTime } from "./commit-format";

export interface RepositoryCommitPageProps {
  owner: string;
  name: string;
  revision: string;
  /** When set, only the diff of this changed file is opened. */
  path: string;
}

/**
 * One commit entry: its message, author, parent revision and the diff against
 * that parent. Opening a changed file keeps the same commit and shows only that
 * file's diff. Nothing on this page writes to the repository.
 */
export function RepositoryCommitPage({ owner, name, revision, path }: RepositoryCommitPageProps) {
  const { status: sessionStatus, account } = useAccountSession();
  const commitView = useRepositoryResource<RepositoryCommitView>(
    `repository-commit:${owner}/${name}:${revision}:${path}`,
    sessionStatus !== "loading",
    () => fetchRepositoryCommit(owner, name, revision, { path }),
  );

  const title =
    commitView.status === "ready" ? commitView.value.commit.message : `${revision} · ${owner}/${name}`;
  useDocumentTitle(title);

  if (commitView.status === "denied") {
    return <RepositoryAccessDenied signedIn={Boolean(account)} />;
  }

  if (commitView.status === "missing" || commitView.status === "error") {
    return <RepositoryNotFound />;
  }

  if (commitView.status !== "ready") {
    return (
      <RepositoryLoading>
        <h1>{`${owner}/${name}`}</h1>
      </RepositoryLoading>
    );
  }

  const value = commitView.value;
  const repository = value.repository;
  const commit = value.commit;

  return (
    <div className="repository-commit">
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
            repositoryCommitsHref(repository.owner, repository.name, { branch: nextBranch }),
          canWrite: canWriteRepositoryRole(repository.viewerRole),
        }}
      />
      <section className="repository-commit__section" aria-labelledby="commit-title">
        <h2 className="repository-commit__message" id="commit-title">
          {commit.message}
        </h2>
        <p className="repository-commit__meta">
          <span className="repository-commit__revision">{`Revision: ${commit.shortSha ?? commit.sha}`}</span>
          <span className="repository-commit__branch">{`Branch: ${value.branch}`}</span>
          <span className="repository-commit__author">{commit.author ?? "Unknown author"}</span>
          {/* `time` takes its accessible name from aria-label, not its text. */}
          <time
            className="repository-commit__time"
            dateTime={commit.createdAt}
            aria-label={formatRelativeTime(commit.createdAt)}
          >
            {formatRelativeTime(commit.createdAt)}
          </time>
        </p>
        <p className="repository-commit__parent">
          {commit.parentSha ? (
            <>
              <span className="repository-commit__parent-label">Parent revision</span>
              <a
                className="repository-commit__parent-link"
                href={repositoryCommitHref(repository.owner, repository.name, commit.parentSha)}
              >
                {commit.parentSha}
              </a>
            </>
          ) : (
            <span className="repository-commit__parent-label">No parent revision</span>
          )}
        </p>
        <CommitDiffView
          owner={repository.owner}
          name={repository.name}
          comparison={value.comparison}
          revision={commit.sha}
          openPath={path}
        />
      </section>
      <p className="repository-commit__back">
        <a
          href={repositoryCommitsHref(repository.owner, repository.name, {
            branch: value.branch,
          })}
        >
          Commit history
        </a>
      </p>
    </div>
  );
}
