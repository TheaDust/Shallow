import {
  canWriteRepositoryRole,
  fetchRepositoryTree,
  repositoryCodeHref,
  repositoryCommitsHref,
  type RepositoryTree,
} from "../../lib/repository-code-api";
import { useDocumentTitle } from "../../lib/document-title";
import { useAccountSession } from "../account/AccountSession";
import { RepositoryBreadcrumbs } from "./RepositoryBreadcrumbs";
import { RepositoryFileList } from "./RepositoryFileList";
import { RepositoryHeader } from "./RepositoryHeader";
import {
  RepositoryAccessDenied,
  RepositoryLoading,
  RepositoryNotFound,
} from "./RepositoryPageStates";
import { useRepositoryResource } from "./useRepositoryResource";

export interface RepositoryTreePageProps {
  owner: string;
  name: string;
  branch: string;
  path: string;
}

/** Directory page: the entries of one path on one branch, plus the path trail. */
export function RepositoryTreePage({ owner, name, branch, path }: RepositoryTreePageProps) {
  const { status: sessionStatus, account } = useAccountSession();
  const tree = useRepositoryResource<RepositoryTree>(
    `repository-tree:${owner}/${name}:${branch}:${path}`,
    sessionStatus !== "loading",
    () => fetchRepositoryTree(owner, name, { branch, path }),
  );

  useDocumentTitle(`/${path} at ${branch} · ${owner}/${name}`);

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

  const repository = tree.value.repository;

  return (
    <div className="repository-tree">
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
          branch: tree.value.branch,
          branches: tree.value.branches,
          hrefForBranch: (nextBranch) =>
            repositoryCodeHref(repository.owner, repository.name, "tree", nextBranch, tree.value.path),
          canWrite: canWriteRepositoryRole(repository.viewerRole),
        }}
        history={{
          href: repositoryCommitsHref(repository.owner, repository.name, {
            branch: tree.value.branch,
          }),
          count: tree.value.commitCount ?? 0,
        }}
      />
      <RepositoryBreadcrumbs
        owner={repository.owner}
        name={repository.name}
        branch={tree.value.branch}
        path={tree.value.path}
        leaf="tree"
      />
      <RepositoryFileList
        owner={repository.owner}
        name={repository.name}
        branch={tree.value.branch}
        entries={tree.value.entries}
      />
    </div>
  );
}
