import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { fetchRepositoryView } from "../repositories/api";
import { repositoryPath } from "../repositories/routes";
import { REPOSITORY_SECTIONS, type RepositorySectionName } from "../repositories/routes";
import type { RepositoryOwnerKind, RepositoryView } from "../repositories/types";

export interface RepositorySectionPageProps {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  section: RepositorySectionName;
}

const SECTION_TITLES: Record<RepositorySectionName, string> = {
  issues: "Issues",
  "pull-requests": "Pull requests",
};

const SECTION_EMPTY: Record<RepositorySectionName, string> = {
  issues: "No issues yet.",
  "pull-requests": "No pull requests yet.",
};

export function isRepositorySection(value: string): value is RepositorySectionName {
  return (REPOSITORY_SECTIONS as readonly string[]).includes(value);
}

/**
 * Read-only section of one repository. The section entries of the repository
 * overview are real links, so they can be opened and refreshed directly; the
 * repository access rule is the same one the overview uses, and the page never
 * changes repository data.
 */
export function RepositorySectionPage({ ownerKind, owner, name, section }: RepositorySectionPageProps) {
  const [repository, setRepository] = useState<RepositoryView | null>(null);
  const [failure, setFailure] = useState<"notFound" | "denied" | "failed" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRepository(null);
    setFailure(null);
    fetchRepositoryView(ownerKind, owner, name)
      .then((next) => {
        if (!cancelled) setRepository(next);
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
  }, [ownerKind, owner, name]);

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

  return (
    <section className="page">
      <p className="repository-breadcrumb">
        <a className="repository-breadcrumb__repository" href={`#${repositoryPath(ownerKind, owner, name)}`}>
          {repository.owner.name}/{repository.name}
        </a>
      </p>
      <h1>{SECTION_TITLES[section]}</h1>
      <p className="page__lead">{SECTION_EMPTY[section]}</p>
    </section>
  );
}
