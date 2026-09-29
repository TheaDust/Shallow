import type { ReactNode } from "react";

import type { OrganizationDetail } from "../../org/types";

export type OrganizationTab = "repositories" | "people" | "teams";

const TABS: ReadonlyArray<{ id: OrganizationTab; label: string }> = [
  { id: "repositories", label: "Repositories" },
  { id: "people", label: "People" },
  { id: "teams", label: "Teams" },
];

export interface OrganizationShellProps {
  organization: OrganizationDetail;
  activeTab: OrganizationTab;
  children: ReactNode;
}

/**
 * REQ-2-1 / REQ-2-1-1: the organization overview. The organization name is the
 * page heading and “Repositories”, “People” and “Teams” are navigation links
 * (styled as tabs) so that every tab is directly openable and refreshable.
 */
export function OrganizationShell({ organization, activeTab, children }: OrganizationShellProps) {
  const base = `#/organizations/${encodeURIComponent(organization.name)}`;
  return (
    <main>
      <h1>{organization.name}</h1>
      {organization.displayName && organization.displayName !== organization.name ? (
        <p className="org-overview__display-name">{organization.displayName}</p>
      ) : null}
      {organization.role ? (
        <p className="org-overview__role">
          {organization.role === "owner"
            ? "You are an Owner of this organization."
            : "You are a member of this organization."}
        </p>
      ) : null}
      <nav className="org-tabs" aria-label="Organization">
        {TABS.map((tab) => (
          <a
            key={tab.id}
            className="org-tabs__link"
            href={`${base}/${tab.id}`}
            aria-current={tab.id === activeTab ? "page" : undefined}
          >
            {tab.label}
          </a>
        ))}
      </nav>
      {children}
    </main>
  );
}
