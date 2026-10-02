import { useEffect, useRef, useState } from "react";

import { errorMessageOf, fieldErrorsOf } from "../auth/api";
import { ApiError } from "../lib/api";
import { navigate } from "../lib/hash-route";
import { formatUpdatedAt, visibilityLabel } from "../organizations/format";
import { createBranch, fetchRepositoryView } from "../repositories/api";
import { RepositoryBranchSelector } from "../repositories/RepositoryBranchSelector";
import { RepositoryCode } from "../repositories/RepositoryCode";
import { ownerProfilePath, repositoryCommitsSuffix, repositoryPath } from "../repositories/routes";
import type { RepositoryOwnerKind, RepositoryView } from "../repositories/types";

export interface RepositoryOverviewPageProps {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  /** Branch selected by the address; empty reads the repository default branch. */
  branch?: string;
}

type LoadFailure = "notFound" | "denied" | "failed";

const CREATE_ERROR = "We could not create the branch. Try again.";

/**
 * Repository overview of an organization or a personal repository. The heading
 * combines the owner and the repository name, the visibility marker and the
 * default branch are always visible, and the Code navigation link is a real
 * link next to the Code clone button of the Code area. The Code area carries the
 * branch selector: the selector, the page address and the file list all describe
 * the same branch, and selecting another branch only changes the browsing
 * snapshot. Unreadable repositories never render a heading: a visitor is told
 * nothing about a private repository, while a signed-in account sees "Access
 * denied". A fork additionally shows its source repository ("Forked from ...")
 * with a link back to that source.
 */
export function RepositoryOverviewPage({ ownerKind, owner, name, branch = "" }: RepositoryOverviewPageProps) {
  const [repository, setRepository] = useState<RepositoryView | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [pendingBranch, setPendingBranch] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const identityRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    const identity = `${ownerKind}\u0000${owner}\u0000${name}`;
    if (identityRef.current !== identity) {
      // Another repository: the previously loaded state never describes it.
      identityRef.current = identity;
      setRepository(null);
    }
    setFailure(null);
    fetchRepositoryView(ownerKind, owner, name, branch)
      .then((next) => {
        if (cancelled) return;
        setRepository(next);
        setPendingBranch(null);
        setCreateError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setPendingBranch(null);
        if (error instanceof ApiError && error.status === 403) setFailure("denied");
        else if (error instanceof ApiError && error.status === 404) setFailure("notFound");
        else setFailure("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [ownerKind, owner, name, branch]);

  /** Address of the Code page of one branch; the default branch has no query. */
  function branchSearch(nextBranch: string): URLSearchParams {
    const search = new URLSearchParams();
    if (repository && nextBranch !== repository.defaultBranch) search.set("branch", nextBranch);
    return search;
  }

  function selectBranch(nextBranch: string) {
    if (nextBranch === currentBranch) return;
    setCreateError(null);
    setPendingBranch(nextBranch);
    navigate(repositoryPath(ownerKind, owner, name), branchSearch(nextBranch));
  }

  async function createNamedBranch(nextBranch: string) {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const next = await createBranch(ownerKind, owner, name, nextBranch, currentBranch);
      setRepository(next);
      setPendingBranch(next.branch);
      navigate(repositoryPath(ownerKind, owner, name), branchSearch(next.branch));
    } catch (error) {
      const errors = fieldErrorsOf(error);
      setCreateError(errors?.branch ?? errorMessageOf(error) ?? CREATE_ERROR);
    } finally {
      setCreating(false);
    }
  }

  if (failure === "notFound") {
    return (
      <section className="page page--narrow">
        <h1>Repository not found</h1>
        <p className="page__lead">The address does not match a repository visible to you.</p>
      </section>
    );
  }

  if (failure === "denied") {
    return (
      <section className="page page--narrow">
        <h1>Access denied</h1>
        <p className="page__lead">Your account cannot read this private repository.</p>
      </section>
    );
  }

  if (failure === "failed") {
    return (
      <section className="page page--narrow">
        <p role="alert">We could not load this repository. Try again.</p>
      </section>
    );
  }

  if (!repository) {
    return (
      <section className="page">
        <p role="status">Loading repository…</p>
      </section>
    );
  }

  const { owner: repositoryOwner } = repository;
  const settingsHash = repositoryHashForSettings(ownerKind, owner, name, repository);
  const currentBranch = pendingBranch ?? repository.branch ?? repository.defaultBranch;
  const codeHash = `#${repositoryPath(ownerKind, owner, name)}${querySuffix(branchSearch(currentBranch))}`;

  return (
    <section className="page">
      <p className="repository-breadcrumb">
        <a
          className="repository-breadcrumb__owner"
          href={`#${ownerProfilePath(ownerKind, repositoryOwner.slug)}`}
        >
          {repositoryOwner.name}
        </a>
      </p>
      <h1>
        {repositoryOwner.name}/{repository.name}
      </h1>
      <p className="repository-overview__description">{repository.description}</p>
      <p className="repository-overview__meta">
        <span className="repository-overview__visibility">{visibilityLabel(repository.visibility)}</span>
        <span aria-hidden="true"> · </span>
        <span className="repository-overview__branch">Default branch {repository.defaultBranch}</span>
        <span aria-hidden="true"> · </span>
        <span className="repository-overview__updated">Updated {formatUpdatedAt(repository.updatedAt)}</span>
      </p>
      {repository.forkSource ? (
        <p className="repository-overview__fork-source">
          Forked from{" "}
          <a
            className="repository-overview__fork-link"
            href={`#${repositoryPath(
              repository.forkSource.owner.kind,
              repository.forkSource.owner.slug,
              repository.forkSource.name,
            )}`}
          >
            {repository.forkSource.name}
          </a>
        </p>
      ) : null}
      <nav className="org-tabs" aria-label="Repository">
        <a className="org-tabs__entry" href={codeHash} aria-current="page">
          Code
        </a>
        <a
          className="org-tabs__entry"
          href={`#${repositoryPath(ownerKind, owner, name, repositoryCommitsSuffix(currentBranch))}`}
        >
          Commits
        </a>
        <a
          className="org-tabs__entry"
          href={`#${repositoryPath(ownerKind, owner, name, "/issues")}`}
        >
          Issues
        </a>
        <a
          className="org-tabs__entry"
          href={`#${repositoryPath(ownerKind, owner, name, "/pull-requests")}`}
        >
          Pull requests
        </a>
        {settingsHash ? (
          <a className="org-tabs__entry" href={settingsHash}>
            Settings
          </a>
        ) : null}
      </nav>
      <RepositoryCode
        ownerKind={ownerKind}
        owner={repositoryOwner.slug}
        name={repository.name}
        branch={currentBranch}
        files={repository.files}
        latestCommit={repository.latestCommit}
        commitCount={repository.commitCount}
        canWrite={repository.canWrite}
        busy={pendingBranch !== null}
        branchSelector={(
          <RepositoryBranchSelector
            branch={currentBranch}
            branches={repository.branches}
            canCreate={repository.canWrite}
            busy={creating}
            createError={createError}
            onSelectBranch={selectBranch}
            onCreateBranch={(nextBranch) => {
              void createNamedBranch(nextBranch);
            }}
          />
        )}
        onFork={() => navigate(repositoryPath(ownerKind, owner, name, "/fork"))}
      />
    </section>
  );
}

/** `?branch=…` suffix of a Code address, or an empty string for the default. */
function querySuffix(search: URLSearchParams): string {
  const query = search.toString();
  return query.length > 0 ? `?${query}` : "";
}

/** Settings exist for every repository the viewer may administer. */
function repositoryHashForSettings(
  ownerKind: RepositoryOwnerKind,
  owner: string,
  name: string,
  repository: RepositoryView,
): string | null {
  if (!repository.canManage) return null;
  return `#${repositoryPath(ownerKind, owner, name, "/settings")}`;
}
