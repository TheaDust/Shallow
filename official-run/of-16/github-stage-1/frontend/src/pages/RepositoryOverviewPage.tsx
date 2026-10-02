import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { fetchRepository } from "../organizations/api";
import { formatUpdatedAt, visibilityLabel } from "../organizations/format";
import type { RepositoryOverview } from "../organizations/types";

export interface RepositoryOverviewPageProps {
  slug: string;
  name: string;
}

type LoadFailure = "notFound" | "denied" | "failed";

/**
 * Repository overview. The heading combines the owning organization and the
 * repository name; the organization link returns to the organization overview.
 * Unreadable repositories never render a heading: a visitor is told nothing
 * about a private repository, while a signed-in account sees "Access denied".
 */
export function RepositoryOverviewPage({ slug, name }: RepositoryOverviewPageProps) {
  const [repository, setRepository] = useState<RepositoryOverview | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRepository(null);
    setFailure(null);
    fetchRepository(slug, name)
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
  }, [slug, name]);

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

  const { organization } = repository;

  return (
    <section className="page">
      <p className="repository-breadcrumb">
        <a className="repository-breadcrumb__organization" href={`#/organizations/${organization.slug}`}>
          {organization.name}
        </a>
      </p>
      <h1>
        {organization.name}/{repository.name}
      </h1>
      <p className="repository-overview__description">{repository.description}</p>
      <p className="repository-overview__meta">
        <span className="repository-overview__visibility">{visibilityLabel(repository.visibility)}</span>
        <span aria-hidden="true"> · </span>
        <span className="repository-overview__updated">Updated {formatUpdatedAt(repository.updatedAt)}</span>
      </p>
      {repository.canManageAccess ? (
        <nav className="org-tabs" aria-label="Repository">
          <a
            className="org-tabs__entry"
            href={`#/organizations/${organization.slug}/repositories/${repository.name}/settings`}
          >
            Settings
          </a>
        </nav>
      ) : null}
    </section>
  );
}
