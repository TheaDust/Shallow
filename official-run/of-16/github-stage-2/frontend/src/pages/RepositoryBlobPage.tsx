import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { fetchRepositoryFile } from "../repositories/api";
import { repositoryBlobSuffix, repositoryCommitsSuffix, repositoryPath } from "../repositories/routes";
import type { RepositoryFileContent, RepositoryOwnerKind } from "../repositories/types";

export interface RepositoryBlobPageProps {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  branch: string;
  path: string;
}

/**
 * Read-only file page. The title carries the stored file name as its exact
 * accessible name plus the stored path of the file, the page names the
 * repository it belongs to and the branch (revision) it was read from, and the
 * readable content follows. A "Commits" link opens the history of this very
 * file. The page never changes repository data, so a reload and a direct link
 * read exactly the same stored content.
 */
export function RepositoryBlobPage({ ownerKind, owner, name, branch, path }: RepositoryBlobPageProps) {
  const [file, setFile] = useState<RepositoryFileContent | null>(null);
  const [failure, setFailure] = useState<"notFound" | "denied" | "failed" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFile(null);
    setFailure(null);
    fetchRepositoryFile(ownerKind, owner, name, branch, path)
      .then((next) => {
        if (!cancelled) setFile(next);
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
        <h1>File not found</h1>
        <p className="page__lead">The address does not match a file of this repository.</p>
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
        <p role="alert">We could not load this file. Try again.</p>
      </section>
    );
  }

  if (!file) {
    return (
      <section className="page">
        <p role="status">Loading file…</p>
      </section>
    );
  }

  // The stored path of the file: for a nested file the directory part stays in
  // the title, so the whole path reads exactly as it was stored, while the
  // accessible name of the link is the file name itself.
  const directory = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";

  return (
    <section className="page">
      <nav className="repository-breadcrumb" aria-label="Repository">
        <a className="repository-breadcrumb__repository" href={`#${repositoryPath(ownerKind, owner, name)}`}>
          {file.owner.name}/{file.repository}
        </a>
      </nav>
      <h1 className="repository-file__title">
        {directory.length > 0 ? (
          <span className="repository-file__directory" aria-hidden="true">{directory}/</span>
        ) : null}
        <a
          className="repository-file__name"
          href={`#${repositoryPath(ownerKind, owner, name, repositoryBlobSuffix(file.branch, file.path))}`}
        >
          {file.name}
        </a>
      </h1>
      <p className="repository-file__toolbar">
        <span className="repository-file__branch">Branch {file.branch}</span>
        <a
          className="repository-file__commits"
          href={`#${repositoryPath(ownerKind, owner, name, repositoryCommitsSuffix(file.branch, file.path))}`}
        >
          Commits
        </a>
      </p>
      <pre className="repository-file__content">{file.content}</pre>
    </section>
  );
}
