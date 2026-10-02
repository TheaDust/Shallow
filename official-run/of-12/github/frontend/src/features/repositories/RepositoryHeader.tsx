import type { ReactNode } from "react";

import { CloneMenu } from "./CloneMenu";
import type { RepositoryCloneUrls, RepositoryOverview } from "./repository-api";
import { codeHref, commitsHref } from "./repository-links";

export type RepositoryTab = "code" | "commits" | "issues" | "pulls" | "settings";

export interface RepositoryHeaderProps {
  repository: RepositoryOverview;
  /** Clone values of the repository; derived from the full name when omitted. */
  cloneUrls?: RepositoryCloneUrls;
  /** The navigation entry the current page belongs to. */
  active: RepositoryTab;
  /** The branch the page reads, so Code and Commits keep it (REQ-4). */
  branch?: string | null;
  /**
   * The repository entries this page offers, in the order given. A page that
   * already spells one of the names (the pull-request sections) leaves that
   * name to its own navigation, so every link name stays unique on the page.
   */
  tabs?: RepositoryTab[];
  /** Optional extra content rendered next to the clone menu. */
  actions?: ReactNode;
}

function ownerHref(repository: RepositoryOverview): string {
  return repository.ownerType === "organization"
    ? `#/organizations/${repository.owner}`
    : `#/${repository.owner}`;
}

function cloneValues(repository: RepositoryOverview, cloneUrls?: RepositoryCloneUrls): RepositoryCloneUrls {
  return cloneUrls ?? {
    https: `https://github.local/${repository.fullName}.git`,
    ssh: `git@github.local:${repository.fullName}.git`,
  };
}

/**
 * Identity block of a repository page (REQ-3-3): the heading spells the
 * repository as "owner/repository name", next to a visible Public/Private
 * marker, the description, the owner, the default branch and the Code, Issues,
 * Pull requests and Settings entries. The heading text itself links to the
 * repository address, so the page carries the repository's "owner/repository
 * name" as an address as well as a title.
 */
export function RepositoryHeader({ repository, cloneUrls, active, branch, tabs: visibleTabs, actions }: RepositoryHeaderProps) {
  const base = `/${repository.owner}/${repository.name}`;
  const allTabs: Array<{ id: RepositoryTab; label: string; href: string }> = [
    { id: "code", label: "Code", href: codeHref(repository, branch) },
    { id: "commits", label: "Commits", href: commitsHref(repository, branch) },
    { id: "issues", label: "Issues", href: `#${base}/issues` },
    { id: "pulls", label: "Pull requests", href: `#${base}/pulls` },
    { id: "settings", label: "Settings", href: `#${base}/settings` },
  ];
  const tabs = visibleTabs
    ? visibleTabs.map((id) => allTabs.find((tab) => tab.id === id)).filter((tab) => tab !== undefined) as typeof allTabs
    : allTabs;

  return (
    <header className="repository-header">
      <div className="repository-header__title">
        <h1 className="repository-header__name">
          <a className="repository-header__name-link" href={`#${base}`}>
            {repository.fullName}
          </a>
        </h1>
        <span className="repository-header__visibility">
          {repository.visibility === "public" ? "Public" : "Private"}
        </span>
      </div>
      {repository.forkedFrom ? (
        <p className="repository-header__fork">
          Forked from{" "}
          <a href={`#/${repository.forkedFrom.owner}/${repository.forkedFrom.name}`}>
            {repository.forkedFrom.name}
          </a>
        </p>
      ) : null}
      {repository.description ? (
        <p className="repository-header__description">{repository.description}</p>
      ) : null}
      <div className="repository-header__meta">
        <p className="repository-header__owner">
          Owned by{" "}
          <a href={ownerHref(repository)}>{repository.ownerDisplayName ?? repository.owner}</a>
        </p>
        <p className="repository-header__branch">
          <span className="repository-header__branch-label">Default branch</span>
          <span className="repository-header__branch-value">{repository.defaultBranch ?? "main"}</span>
        </p>
      </div>
      <div className="repository-header__toolbar">
        <CloneMenu repositoryName={repository.name} cloneUrls={cloneValues(repository, cloneUrls)} />
        {actions}
      </div>
      <nav className="repository-header__tabs" aria-label="Repository">
        {tabs.map((tab) => (
          <a
            key={tab.id}
            className="repository-header__tab"
            href={tab.href}
            aria-current={tab.id === active ? "page" : undefined}
          >
            {tab.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
