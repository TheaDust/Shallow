import type { ReactNode } from "react";

import {
  organizationUrl,
  repositoryCommitsUrl,
  repositoryUrl,
  type RepositoryOwnerRef,
} from "../lib/routes";
import type { Account } from "../lib/session-api";
import { AppHeader } from "./AppHeader";

export type RepositorySection = "overview" | "commits" | "settings" | "access";

export interface RepositoryLayoutProps {
  /** The owning organization or account of the repository. */
  owner: RepositoryOwnerRef & { displayName?: string };
  repositoryName: string;
  heading: ReactNode;
  activeSection: RepositorySection;
  /** Only a repository Admin sees the Settings and Manage access entries. */
  canManage: boolean;
  /**
   * The revision the “Commits” link opens: the branch the page reads and, when
   * a file is open, that file's own history.
   */
  commitsParams?: { branch?: string; path?: string };
  /** When present, the Public/Private marker is rendered next to the heading. */
  visibility?: "public" | "private" | null;
  account: Account | null;
  children: ReactNode;
}

/**
 * Shared repository frame: the owner/repository breadcrumb, the page heading
 * with its Public/Private marker, and the repository navigation entries.
 * “Code” is a link — distinct from the clone-menu Code button of the
 * repository page — “Commits” opens the read-only commit history, and
 * “Settings”/“Manage access” appear for an organization repository Admin only
 * (personal repositories expose no administration pages).
 */
export function RepositoryLayout({
  owner,
  repositoryName,
  heading,
  activeSection,
  canManage,
  commitsParams,
  visibility,
  account,
  children,
}: RepositoryLayoutProps) {
  const ownerName = owner.displayName ?? owner.name;
  const ownerType = owner.type === "user" ? "user" : "organization";
  const commitsHref = repositoryCommitsUrl(ownerType, owner.name, repositoryName, commitsParams ?? {});
  return (
    <div className="app-shell">
      <AppHeader username={account?.username} />
      <main>
        <p className="organization-context">
          {owner.type === "user" ? (
            <span>{ownerName}</span>
          ) : (
            <a href={organizationUrl(owner.name)}>{ownerName}</a>
          )}
          <span aria-hidden="true"> / </span>
          <a href={repositoryUrl(owner, repositoryName)}>{repositoryName}</a>
        </p>
        <div className="repository-heading-row">
          <h1 className="repository-heading">{heading}</h1>
          {visibility ? (
            <span className="repository-visibility" data-visibility={visibility}>
              {visibility === "public" ? "Public" : "Private"}
            </span>
          ) : null}
        </div>
        <nav className="organization-tabs" aria-label="Repository">
          <a
            href={repositoryUrl(owner, repositoryName)}
            data-active={activeSection === "overview" || undefined}
          >
            Code
          </a>
          <a
            href={commitsHref}
            data-active={activeSection === "commits" || undefined}
          >
            Commits
          </a>
          {canManage && owner.type !== "user" ? (
            <>
              <a
                href={repositoryUrl(owner, repositoryName, "settings")}
                data-active={activeSection === "settings" || undefined}
              >
                Settings
              </a>
              <a
                href={repositoryUrl(owner, repositoryName, "settings", "access")}
                data-active={activeSection === "access" || undefined}
              >
                Manage access
              </a>
            </>
          ) : null}
        </nav>
        {children}
      </main>
    </div>
  );
}
