import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { fetchRepositoryDirectory } from "../repositories/api";
import { RepositoryFileList } from "../repositories/RepositoryFileList";
import { repositoryPath } from "../repositories/routes";
import type { RepositoryDirectory, RepositoryOwnerKind } from "../repositories/types";

export interface RepositoryTreePageProps {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  branch: string;
  path: string;
}

type LoadFailure = "notFound" | "denied" | "failed";

/**
 * Directory page of one path on one branch. The page identifies the current
 * path, shows the repository and the branch it belongs to and lists the files
 * and directories below it as links, so a directory is browsable without any
 * write action and a direct link or a reload restores the same listing.
 */
export function RepositoryTreePage({ ownerKind, owner, name, branch, path }: RepositoryTreePageProps) {
  const [directory, setDirectory] = useState<RepositoryDirectory | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDirectory(null);
    setFailure(null);
    fetchRepositoryDirectory(ownerKind, owner, name, branch, path)
      .then((next) => {
        if (!cancelled) setDirectory(next);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setFailure("denied");
        else if (error instanceof ApiError && error.status === 404) setFailure("notFound");
        else setFailure("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [ownerKind, owner, name, branch, path]);

  if (failure === "notFound") {
    return (
      <section className="page page--narrow">
        <h1>Directory not found</h1>
        <p className="page__lead">The address does not match a directory of this repository.</p>
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
        <p role="alert">We could not load this directory. Try again.</p>
      </section>
    );
  }

  if (!directory) {
    return (
      <section className="page">
        <p role="status">Loading directory…</p>
      </section>
    );
  }

  const repositoryLabel = `${directory.owner.name}/${directory.repository}`;

  return (
    <section className="page">
      <nav className="repository-breadcrumb" aria-label="Repository">
        <a className="repository-breadcrumb__repository" href={`#${repositoryPath(ownerKind, owner, name)}`}>
          {repositoryLabel}
        </a>
      </nav>
      <h1 className="repository-tree__path">
        {directory.path.length > 0 ? directory.path : repositoryLabel}
      </h1>
      <p className="repository-overview__meta">
        <span className="repository-tree__branch">Branch {directory.branch}</span>
      </p>
      <RepositoryFileList
        ownerKind={ownerKind}
        owner={owner}
        name={name}
        branch={directory.branch}
        entries={directory.entries}
        emptyLabel="This directory is empty."
      />
    </section>
  );
}
