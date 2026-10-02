import { useEffect, useState } from "react";

import { fetchOrganization } from "../organizations/api";
import { OrganizationPeople } from "../organizations/OrganizationPeople";
import { OrganizationTeams } from "../organizations/OrganizationLists";
import { OrganizationRepositories } from "../organizations/OrganizationRepositories";
import type { OrganizationOverview } from "../organizations/types";

export type OrganizationSection = "repositories" | "people" | "teams";

export const ORGANIZATION_SECTIONS: readonly OrganizationSection[] = ["repositories", "people", "teams"];

export function isOrganizationSection(value: string): value is OrganizationSection {
  return (ORGANIZATION_SECTIONS as readonly string[]).includes(value);
}

const NAV_ENTRIES: readonly { id: OrganizationSection; label: string }[] = [
  { id: "repositories", label: "Repositories" },
  { id: "people", label: "People" },
  { id: "teams", label: "Teams" },
];

export interface OrganizationOverviewPageProps {
  slug: string;
  /** Active entry; defaults to Repositories. */
  section?: OrganizationSection;
}

/**
 * Public organization overview. The organization name is the heading and the
 * Repositories, People and Teams entries are real links styled like tabs, so
 * each entry can be opened, refreshed and linked directly.
 */
export function OrganizationOverviewPage({ slug, section = "repositories" }: OrganizationOverviewPageProps) {
  const [overview, setOverview] = useState<OrganizationOverview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOverview(null);
    setFailed(false);
    fetchOrganization(slug)
      .then((next) => {
        if (!cancelled) setOverview(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (failed) {
    return (
      <section className="page page--narrow">
        <h1>Organization not found</h1>
        <p className="page__lead">The address does not match a visible organization.</p>
        <p className="page__links">
          <a href="#/organizations">Your organizations</a>
        </p>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="page">
        <p role="status">Loading organization…</p>
      </section>
    );
  }

  const { organization } = overview;

  return (
    <section className="page">
      <p className="org-breadcrumb">
        <a className="org-breadcrumb__organization" href={`#/organizations/${slug}`}>
          {organization.name}
        </a>
      </p>
      <h1>{organization.name}</h1>
      {organization.displayName !== organization.name ? (
        <p className="org-overview__display-name">{organization.displayName}</p>
      ) : null}
      <nav className="org-tabs" aria-label="Organization">
        {NAV_ENTRIES.map((entry) => (
          <a
            key={entry.id}
            className="org-tabs__entry"
            href={`#/organizations/${slug}/${entry.id}`}
            aria-current={entry.id === section ? "page" : undefined}
          >
            {entry.label}
          </a>
        ))}
      </nav>
      {section === "repositories" ? <OrganizationRepositories slug={slug} /> : null}
      {section === "people" ? <OrganizationPeople slug={slug} canManage={overview.role === "owner"} /> : null}
      {section === "teams" ? <OrganizationTeams slug={slug} /> : null}
    </section>
  );
}
