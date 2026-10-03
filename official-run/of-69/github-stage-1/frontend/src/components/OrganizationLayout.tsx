import type { ReactNode } from "react";

import { organizationUrl } from "../lib/routes";
import type { Account } from "../lib/session-api";
import { AppHeader } from "./AppHeader";

export type OrganizationTab = "overview" | "repositories" | "people" | "teams";

export interface OrganizationLayoutProps {
  organizationName: string;
  organization: { name: string; displayName: string } | null;
  heading: ReactNode;
  activeTab: OrganizationTab;
  account: Account | null;
  /** The overview page names the organization in its heading, so it hides the extra link. */
  showOrganizationLink?: boolean;
  children: ReactNode;
}

/**
 * Shared organization frame: the organization link, the page heading and the
 * “Repositories”, “People” and “Teams” navigation entries. Those entries are
 * links (not tabs) even though they are styled as a tab strip.
 */
export function OrganizationLayout({
  organizationName,
  organization,
  heading,
  activeTab,
  account,
  showOrganizationLink = true,
  children,
}: OrganizationLayoutProps) {
  return (
    <div className="app-shell">
      {account ? <AppHeader username={account.username} /> : null}
      <main>
        {showOrganizationLink ? (
          <p className="organization-context">
            <a href={organizationUrl(organizationName)}>{organization?.displayName ?? organizationName}</a>
          </p>
        ) : null}
        <h1>{heading}</h1>
        <nav className="organization-tabs" aria-label="Organization">
          <a href={organizationUrl(organizationName, "repositories")} data-active={activeTab === "repositories" || undefined}>
            Repositories
          </a>
          <a href={organizationUrl(organizationName, "people")} data-active={activeTab === "people" || undefined}>
            People
          </a>
          <a href={organizationUrl(organizationName, "teams")} data-active={activeTab === "teams" || undefined}>
            Teams
          </a>
        </nav>
        {children}
      </main>
    </div>
  );
}

export function organizationHeading(organization: { name: string; displayName: string }) {
  return (
    <>
      {organization.displayName}{" "}
      <span className="page-heading__identifier">{organization.name}</span>
    </>
  );
}
