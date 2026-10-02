import {
  canWriteRepositoryRole,
  fetchRepositoryTree,
  repositoryCodeHref,
  repositoryCommitsHref,
  type RepositoryTree,
} from "../../lib/repository-code-api";
import { useAccountSession } from "../account/AccountSession";
import { RepositoryHeader } from "./RepositoryHeader";
import { RepositoryNotFound } from "./RepositoryPageStates";
import { useRepositoryResource } from "./useRepositoryResource";

export interface RepositoryMissingFileProps {
  owner: string;
  name: string;
  branch: string;
  path: string;
}

/**
 * The page shown when a file address does not exist on the selected branch.
 * It keeps the repository identity and the branch selector - so another branch
 * stays reachable - but never renders any file content.
 */
export function RepositoryMissingFile({ owner, name, branch, path }: RepositoryMissingFileProps) {
  const { account } = useAccountSession();
  const tree = useRepositoryResource<RepositoryTree>(
    `repository-tree:${owner}/${name}:${branch}:`,
    true,
    () => fetchRepositoryTree(owner, name, { branch }),
  );

  if (tree.status !== "ready") return <RepositoryNotFound />;

  const repository = tree.value.repository;

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
          branch: tree.value.branch,
          branches: tree.value.branches,
          hrefForBranch: (nextBranch) =>
            repositoryCodeHref(repository.owner, repository.name, "blob", nextBranch, path),
          canWrite: canWriteRepositoryRole(repository.viewerRole),
        }}
        history={{
          href: repositoryCommitsHref(repository.owner, repository.name, {
            branch: tree.value.branch,
          }),
          count: tree.value.commitCount ?? 0,
        }}
      />
      <h2 className="repository-blob__missing">Page not found</h2>
      <p role="status">{`${path} does not exist on branch ${tree.value.branch}.`}</p>
      <p>
        <a href={repositoryCodeHref(repository.owner, repository.name, "tree", tree.value.branch, "")}>
          {`Browse ${tree.value.branch}`}
        </a>
      </p>
    </div>
  );
}
