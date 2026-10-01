import {
  canWriteRepositoryRole,
  fetchRepositoryTree,
  repositoryCodeHref,
  repositoryCommitsHref,
  type RepositoryTree,
} from "../../lib/repository-code-api";
import { useDocumentTitle } from "../../lib/document-title";
import { useAccountSession } from "../account/AccountSession";
import { RepositoryFileList } from "./RepositoryFileList";
import { RepositoryHeader } from "./RepositoryHeader";
import {
  RepositoryAccessDenied,
  RepositoryLoading,
  RepositoryNotFound,
} from "./RepositoryPageStates";
import { useRepositoryResource } from "./useRepositoryResource";

export interface RepositoryOverviewPageProps {
  owner: string;
  name: string;
}

/**
 * Repository overview opened from search, a repository list or a direct
 * address: the `owner/name` heading, visibility marker, description, default
 * branch and the files of the default branch. The server decides access, so a
 * private repository the viewer may not read answers with "Access denied" and
 * never renders its content.
 */
export function RepositoryOverviewPage({ owner, name }: RepositoryOverviewPageProps) {
  const { status: sessionStatus, account } = useAccountSession();
  const tree = useRepositoryResource<RepositoryTree>(
    `repository-tree:${owner}/${name}`,
    sessionStatus !== "loading",
    () => fetchRepositoryTree(owner, name),
  );

  useDocumentTitle(`${owner}/${name}`);

  if (tree.status === "denied") {
    return <RepositoryAccessDenied signedIn={Boolean(account)} />;
  }

  if (tree.status === "missing" || tree.status === "error") {
    return <RepositoryNotFound />;
  }

  if (tree.status !== "ready") {
    return (
      <RepositoryLoading>
        <h1>{`${owner}/${name}`}</h1>
      </RepositoryLoading>
    );
  }

  const { repository, branch, entries } = tree.value;

  return (
    <div className="repository-overview">
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
          branch,
          branches: tree.value.branches,
          hrefForBranch: (nextBranch) =>
            repositoryCodeHref(repository.owner, repository.name, "tree", nextBranch, ""),
          canWrite: canWriteRepositoryRole(repository.viewerRole),
        }}
        history={{
          href: repositoryCommitsHref(repository.owner, repository.name, { branch }),
          count: tree.value.commitCount ?? 0,
        }}
      />
      <RepositoryFileList
        owner={repository.owner}
        name={repository.name}
        branch={branch}
        entries={entries}
      />
    </div>
  );
}
