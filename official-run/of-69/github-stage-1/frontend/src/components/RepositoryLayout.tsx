import type { ReactNode } from "react";

import { organizationUrl } from "../lib/routes";
import type { Account } from "../lib/session-api";
import { AppHeader } from "./AppHeader";

export type RepositorySection = "overview" | "settings" | "access";

export interface RepositoryLayoutProps {
  organizationName: string;
  repositoryName: string;
  organizationDisplayName?: string;
  heading: ReactNode;
  activeSection: RepositorySection;
  /** Only a repository Admin sees the Settings and Manage access entries. */
  canManage: boolean;
  account: Account | null;
  children: ReactNode;
}

/**
 * Shared repository frame: the organization/repository breadcrumb, the page
 * heading and — for a repository Admin — the “Settings” and “Manage access”
 * navigation entries. Those entries are links, not tabs.
 */
export function RepositoryLayout({
  organizationName,
  repositoryName,
  organizationDisplayName,
  heading,
  activeSection,
  canManage,
  account,
  children,
}: RepositoryLayoutProps) {
  return (
    <div className="app-shell">
      {account ? <AppHeader username={account.username} /> : null}
      <main>
        <p className="organization-context">
          <a href={organizationUrl(organizationName)}>{organizationDisplayName ?? organizationName}</a>
          <span aria-hidden="true"> / </span>
          <a href={organizationUrl(organizationName, "repositories", repositoryName)}>{repositoryName}</a>
        </p>
        <h1 className="repository-heading">{heading}</h1>
        {canManage ? (
          <nav className="organization-tabs" aria-label="Repository settings">
            <a
              href={organizationUrl(organizationName, "repositories", repositoryName, "settings")}
              data-active={activeSection === "settings" || undefined}
            >
              Settings
            </a>
            <a
              href={organizationUrl(organizationName, "repositories", repositoryName, "settings", "access")}
              data-active={activeSection === "access" || undefined}
            >
              Manage access
            </a>
          </nav>
        ) : null}
        {children}
      </main>
    </div>
  );
}
