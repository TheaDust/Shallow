import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { fetchCommitHistory } from "../repositories/api";
import { countLabel, formatRelativeTime } from "../repositories/format";
import { repositoryCommitSuffix, repositoryPath } from "../repositories/routes";
import type { RepositoryCommitHistory, RepositoryOwnerKind } from "../repositories/types";

export interface RepositoryCommitsPageProps {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  branch: string;
  path: string;
}

type LoadFailure = "notFound" | "denied" | "failed";

/**
 * Commit history of one branch (or of one file path on that branch). The
 * records are shown newest first and stay read-only: opening the page never
 * creates a commit, never edits a file and never moves a branch. Every record
 * links to its own comparison page.
 */
export function RepositoryCommitsPage({ ownerKind, owner, name, branch, path }: RepositoryCommitsPageProps) {
  const [history, setHistory] = useState<RepositoryCommitHistory | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setFailure(null);
    fetchCommitHistory(ownerKind, owner, name, branch, path)
      .then((next) => {
        if (!cancelled) setHistory(next);
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
        <h1>Commit history not found</h1>
        <p className="page__lead">The address does not match a branch of this repository.</p>
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
        <p role="alert">We could not load this commit history. Try again.</p>
      </section>
    );
  }

  if (!history) {
    return (
      <section className="page">
        <p role="status">Loading commit history…</p>
      </section>
    );
  }

  return (
    <section className="page">
      <nav className="repository-breadcrumb" aria-label="Repository">
        <a className="repository-breadcrumb__repository" href={`#${repositoryPath(ownerKind, owner, name)}`}>
          {history.owner.name}/{history.repository}
        </a>
      </nav>
      <h1>Commit history</h1>
      <p className="repository-overview__meta">
        <span className="repository-commits__branch">Branch {history.branch}</span>
        {history.path.length > 0 ? (
          <>
            <span aria-hidden="true"> · </span>
            <span className="repository-commits__path">{history.path}</span>
          </>
        ) : null}
      </p>
      {history.commits.length === 0 ? (
        <p className="repository-commits__empty">No commits yet.</p>
      ) : (
        <ol className="commit-list">
          {history.commits.map((commit) => (
            <li className="commit-item" key={commit.id}>
              <a
                className="commit-item__message"
                href={`#${repositoryPath(ownerKind, owner, name, repositoryCommitSuffix(commit.id))}`}
              >
                {commit.message}
              </a>
              <p className="commit-item__meta">
                <span className="commit-item__author">{commit.authorName}</span>
                <span aria-hidden="true"> · </span>
                <time className="commit-item__time" dateTime={commit.committedAt}>
                  {formatRelativeTime(commit.committedAt)}
                </time>
                <span aria-hidden="true"> · </span>
                <span className="commit-item__changes">
                  {countLabel(commit.changedFiles.length, "changed file")}
                </span>
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
