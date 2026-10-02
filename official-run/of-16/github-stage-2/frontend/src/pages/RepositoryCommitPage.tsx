import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { fetchCommitDetail } from "../repositories/api";
import { countLabel, formatRelativeTime } from "../repositories/format";
import { repositoryBlobSuffix, repositoryPath } from "../repositories/routes";
import type { RepositoryCommitDetail, RepositoryOwnerKind } from "../repositories/types";

export interface RepositoryCommitPageProps {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  commitId: string;
}

type LoadFailure = "notFound" | "denied" | "failed";

function lineSign(type: "add" | "remove" | "context"): string {
  if (type === "add") return "+";
  if (type === "remove") return "-";
  return " ";
}

/**
 * Read-only comparison page of one commit: the commit message, its author, its
 * age, its identifier, the branch it belongs to, the changed files and the
 * line-by-line difference between the parent revision (base) and the commit
 * (compare). Nothing here creates a review, a comment, a commit or a branch
 * change.
 */
export function RepositoryCommitPage({ ownerKind, owner, name, commitId }: RepositoryCommitPageProps) {
  const [commit, setCommit] = useState<RepositoryCommitDetail | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCommit(null);
    setFailure(null);
    fetchCommitDetail(ownerKind, owner, name, commitId)
      .then((next) => {
        if (!cancelled) setCommit(next);
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
  }, [ownerKind, owner, name, commitId]);

  if (failure === "notFound") {
    return (
      <section className="page page--narrow">
        <h1>Commit not found</h1>
        <p className="page__lead">The address does not match a commit of this repository.</p>
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
        <p role="alert">We could not load this commit. Try again.</p>
      </section>
    );
  }

  if (!commit) {
    return (
      <section className="page">
        <p role="status">Loading commit…</p>
      </section>
    );
  }

  return (
    <section className="page">
      <nav className="repository-breadcrumb" aria-label="Repository">
        <a className="repository-breadcrumb__repository" href={`#${repositoryPath(ownerKind, owner, name)}`}>
          {commit.owner.name}/{commit.repository}
        </a>
      </nav>
      <h1 className="commit-title">{commit.message}</h1>
      <p className="commit-meta">
        <span className="commit-meta__author">{commit.authorName}</span>
        <span aria-hidden="true"> · </span>
        <time className="commit-meta__time" dateTime={commit.committedAt}>
          {formatRelativeTime(commit.committedAt)}
        </time>
        <span aria-hidden="true"> · </span>
        <span className="commit-meta__sha">{commit.shortId}</span>
        <span aria-hidden="true"> · </span>
        <span className="commit-meta__branch">Branch {commit.branch}</span>
      </p>
      <h2>Changed files</h2>
      <p className="commit-summary">
        <span className="commit-summary__files">{countLabel(commit.files.length, "changed file")}</span>
        <span aria-hidden="true"> · </span>
        <span className="commit-summary__counts">
          {countLabel(commit.additions, "addition")} and {countLabel(commit.deletions, "deletion")}
        </span>
        <span aria-hidden="true"> · </span>
        <span className="commit-stat commit-stat--additions">{`+${commit.additions}`}</span>
        <span className="commit-stat commit-stat--deletions">{`-${commit.deletions}`}</span>
      </p>
      {commit.files.map((file) => (
        <article className="diff-file" key={file.path}>
          <h3 className="diff-file__path">
            <a
              className="diff-file__link"
              href={`#${repositoryPath(ownerKind, owner, name, repositoryBlobSuffix(commit.branch, file.path))}`}
            >
              {file.path}
            </a>
          </h3>
          <table className="diff-table" aria-label={`Diff of ${file.path}`}>
            <tbody>
              {file.lines.map((line, index) => (
                <tr
                  className={`diff-line diff-line--${line.type}`}
                  key={`${index}-${line.type}`}
                >
                  <td className="diff-line__sign" aria-hidden="true">{lineSign(line.type)}</td>
                  <td className="diff-line__text">{line.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      ))}
    </section>
  );
}
