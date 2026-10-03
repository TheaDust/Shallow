import type { ReactNode } from "react";

import { organizationUrl } from "../lib/routes";
import type { Account } from "../lib/session-api";
import { AppHeader } from "./AppHeader";

export type TeamSection = "overview" | "members" | "settings";

export interface TeamLayoutProps {
  organizationName: string;
  teamName: string;
  organizationDisplayName?: string;
  heading: ReactNode;
  activeSection: TeamSection;
  account: Account | null;
  children: ReactNode;
}

/**
 * Shared team frame. The team name is the heading and “Members” and “Settings”
 * are links, so the team page and its two views are all reachable by URL.
 */
export function TeamLayout({
  organizationName,
  teamName,
  organizationDisplayName,
  heading,
  activeSection,
  account,
  children,
}: TeamLayoutProps) {
  return (
    <div className="app-shell">
      <AppHeader username={account?.username} />
      <main>
        <p className="organization-context">
          <a href={organizationUrl(organizationName)}>{organizationDisplayName ?? organizationName}</a>
          <span aria-hidden="true"> / </span>
          <a href={organizationUrl(organizationName, "teams", teamName)}>{teamName}</a>
        </p>
        <h1>{heading}</h1>
        <nav className="organization-tabs" aria-label="Team">
          <a
            href={organizationUrl(organizationName, "teams", teamName, "members")}
            data-active={activeSection === "members" || undefined}
          >
            Members
          </a>
          <a
            href={organizationUrl(organizationName, "teams", teamName, "settings")}
            data-active={activeSection === "settings" || undefined}
          >
            Settings
          </a>
        </nav>
        {children}
      </main>
    </div>
  );
}
