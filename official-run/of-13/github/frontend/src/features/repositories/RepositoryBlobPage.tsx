import {
  canWriteRepositoryRole,
  fetchRepositoryBlob,
  repositoryCodeHref,
  repositoryCommitsHref,
  repositoryFileEditorHref,
  type RepositoryBlob,
} from "../../lib/repository-code-api";
import { useDocumentTitle } from "../../lib/document-title";
import { useAccountSession } from "../account/AccountSession";
import { RepositoryBreadcrumbs } from "./RepositoryBreadcrumbs";
import { RepositoryHeader } from "./RepositoryHeader";
import { RepositoryMissingFile } from "./RepositoryMissingFile";
import {
  RepositoryAccessDenied,
  RepositoryLoading,
  RepositoryNotFound,
} from "./RepositoryPageStates";
import { useRepositoryResource } from "./useRepositoryResource";
import { formatRelativeTime } from "./commit-format";

export interface RepositoryBlobPageProps {
  owner: string;
  name: string;
  branch: string;
  path: string;
  /** Line of a code-search match that this file page was opened from. */
  line?: number;
}

/**
 * Read-only file page: the stored content of one path on one branch without
 * creating any commit or changing the repository. The branch selector keeps the
 * same path and only changes the snapshot, so a file that does not exist on the
 * selected branch stops being displayed.
 */
export function RepositoryBlobPage({
  owner,
  name,
  branch,
  path,
  line,
}: RepositoryBlobPageProps) {
  const { status: sessionStatus, account } = useAccountSession();
  const blob = useRepositoryResource<RepositoryBlob>(
    `repository-blob:${owner}/${name}:${branch}:${path}`,
    sessionStatus !== "loading",
    () => fetchRepositoryBlob(owner, name, { branch, path }),
  );

  useDocumentTitle(`${path} at ${branch} · ${owner}/${name}`);

  if (blob.status === "denied") {
    return <RepositoryAccessDenied signedIn={Boolean(account)} />;
  }

  if (blob.status === "missing") {
    return <RepositoryMissingFile owner={owner} name={name} branch={branch} path={path} />;
  }

  if (blob.status === "error") {
    return <RepositoryNotFound />;
  }

  if (blob.status !== "ready") {
    return (
      <RepositoryLoading>
        <h1>{`${owner}/${name}`}</h1>
      </RepositoryLoading>
    );
  }

  const repository = blob.value.repository;
  const canWrite = canWriteRepositoryRole(repository.viewerRole);

  return (
    <div className="repository-blob">
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
          branch: blob.value.branch,
          branches: blob.value.branches,
          hrefForBranch: (nextBranch) =>
            repositoryCodeHref(repository.owner, repository.name, "blob", nextBranch, blob.value.path),
          canWrite,
        }}
        editHref={
          canWrite
            ? repositoryFileEditorHref(
                repository.owner,
                repository.name,
                blob.value.branch,
                blob.value.path,
              )
            : undefined
        }
        history={{
          href: repositoryCommitsHref(repository.owner, repository.name, {
            branch: blob.value.branch,
            path: blob.value.path,
          }),
          count: blob.value.commitCount ?? 0,
        }}
      />
      <RepositoryBreadcrumbs
        owner={repository.owner}
        name={repository.name}
        branch={blob.value.branch}
        path={blob.value.path}
        leaf="blob"
      />
      <p className="repository-blob__meta">
        <span className="repository-blob__branch">{`Branch: ${blob.value.branch}`}</span>
        <span className="repository-blob__path">{`Path: ${blob.value.path}`}</span>
        {blob.value.commit.author ? (
          <span className="repository-blob__commit">{`Last change by ${blob.value.commit.author}: ${blob.value.commit.message}`}</span>
        ) : null}
        {/* `time` takes its accessible name from aria-label, not its text. */}
        <time
          className="repository-blob__time"
          dateTime={blob.value.commit.createdAt}
          aria-label={formatRelativeTime(blob.value.commit.createdAt)}
        >
          {formatRelativeTime(blob.value.commit.createdAt)}
        </time>
        {line !== undefined ? (
          <span className="repository-blob__match">{`Match on line ${line}`}</span>
        ) : null}
      </p>
      <pre className="repository-blob__content">{blob.value.content}</pre>
    </div>
  );
}
