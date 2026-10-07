import { useEffect } from "react";

import { AddFileMenu } from "../components/AddFileMenu";
import { AppHeader } from "../components/AppHeader";
import { BranchSelector } from "../components/BranchSelector";
import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { navigate, replace } from "../lib/hash-route";
import { createRepositoryBranch, fetchRepositoryBranches, fetchRepositoryTree } from "../lib/org-api";
import type { RepositoryTree } from "../lib/org-api";
import {
  repositoryBlobHash,
  repositoryCodeHash,
  repositoryCommitsHash,
} from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/**
 * Read-only Code page of one branch. The branch selector at the top lists the
 * branches of the repository and switches the browsing snapshot: the
 * breadcrumb, the branch line, the directory entries and the file links all read
 * the same branch, and switching never creates a commit or rewrites history. A
 * contributor with write permission additionally gets the "Add file" menu.
 */
export function RepositoryCodePage({
  owner,
  name,
  path,
  branch = "",
}: {
  owner: string;
  name: string;
  path: string;
  branch?: string;
}) {
  const branches = useAsyncData(() => fetchRepositoryBranches(owner, name), [owner, name]);
  // The branch the tree reads: the one the address names, or the repository
  // default branch as soon as the branch list has answered. Waiting for that
  // name keys the tree request on the branch the address ends up naming, so
  // writing the branch into the address does not trigger a second read.
  const requestedBranch = branch || branches.data?.defaultBranch || "";
  const tree = useAsyncData<RepositoryTree | null>(
    () =>
      requestedBranch
        ? fetchRepositoryTree(owner, name, path, requestedBranch)
        : Promise.resolve(null),
    [owner, name, path, requestedBranch],
  );
  const codePath = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/code${
    path ? `/${encodeURIComponent(path)}` : ""
  }`;

  /**
   * The branch the page reads is part of the address (REQ-4-3-1): the resolved
   * branch of the loaded snapshot is written once, so the address identifies the
   * active branch even when it is the default one and a reload restores the same
   * snapshot. The effect only runs for an address that names no branch, so an
   * unmatched query and a settled page of a named branch never change it, and a
   * pending request still carrying the previous snapshot can never rewrite it.
   */
  useEffect(() => {
    if (branch !== "" || tree.status !== "ready" || !tree.data) return;
    replace(codePath, new URLSearchParams({ branch: tree.data.branch }));
  }, [branch, codePath, tree.status, tree.data]);

  /** Opens the same path on another branch; the branch travels in the address. */
  const openBranch = (next: string) => {
    navigate(codePath, new URLSearchParams({ branch: next }));
  };

  const createBranch = async (next: string): Promise<string | null> => {
    const base = tree.data?.branch ?? "";
    const result = await createRepositoryBranch(owner, name, { name: next, base });
    if (!result.ok) return result.fieldErrors.name ?? result.message;
    openBranch(result.value.name);
    return null;
  };

  const treeData = tree.status === "ready" ? tree.data : null;
  const branchData = branches.status === "ready" ? branches.data : null;
  const ready = treeData !== null && branchData !== null;
  // The default branch stays implicit in every link, so a page of the default
  // branch keeps the plain address it had before branches were selectable.
  const activeBranch = treeData && treeData.branch !== treeData.defaultBranch ? treeData.branch : undefined;

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository-code">
        {!ready && (tree.status === "loading" || branches.status === "loading") ? (
          <LoadingNote label="Loading files…" />
        ) : null}
        {tree.status === "error" && tree.error ? <ErrorHeading error={tree.error} /> : null}
        {tree.status === "ready" && branches.status === "error" && branches.error ? (
          <ErrorHeading error={branches.error} />
        ) : null}
        {treeData && branchData ? (
          <>
            <div className="repository-code__head">
              <BranchSelector
                currentBranch={treeData.branch}
                branches={branchData.branches}
                canCreateBranch={branchData.canWrite}
                onSelectBranch={(next) => openBranch(next)}
                onCreateBranch={createBranch}
              />
              {branchData.canWrite ? (
                <AddFileMenu owner={owner} name={name} branch={treeData.branch} />
              ) : null}
            </div>
            <RepositoryBreadcrumb
              repository={treeData.repository}
              path={treeData.path}
              branch={activeBranch}
            />
            <h1 className="repository__title">{treeData.path ? treeData.path : "Code"}</h1>
            <p className="repository-code__branch">Branch: {treeData.branch}</p>
            {treeData.entries.length === 0 ? (
              <p className="repository-code__empty">This directory is empty.</p>
            ) : (
              <ul className="repository-code__list">
                {treeData.entries.map((entry) => (
                  <li key={entry.path} className="repository-code__item">
                    <a
                      className="repository-code__entry"
                      href={
                        entry.type === "directory"
                          ? repositoryCodeHash(
                              treeData.repository.owner.id,
                              treeData.repository.name,
                              entry.path,
                              activeBranch,
                            )
                          : repositoryBlobHash(
                              treeData.repository.owner.id,
                              treeData.repository.name,
                              entry.path,
                              activeBranch,
                            )
                      }
                    >
                      {entry.name}
                    </a>
                    <span className="repository-code__kind">
                      {entry.type === "directory" ? "Directory" : "File"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="repository-code__commits">
              <a
                href={repositoryCommitsHash(
                  treeData.repository.owner.id,
                  treeData.repository.name,
                  "",
                  activeBranch,
                )}
              >
                Commits
              </a>
            </p>
          </>
        ) : null}
      </section>
    </main>
  );
}
