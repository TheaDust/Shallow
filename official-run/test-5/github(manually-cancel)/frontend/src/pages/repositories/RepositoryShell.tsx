import type { ReactNode } from "react";

import { repositorySettingsHash } from "../../org/org-api";
import {
  repositoryCodeHash,
  repositoryIssuesHash,
  repositoryPullRequestsHash,
} from "../../repo/repo-api";
import type { RepositoryDetail } from "../../repo/types";

export type RepositorySection = "code" | "issues" | "pulls" | "settings";

export interface RepositoryShellProps {
  repository: RepositoryDetail;
  active?: RepositorySection;
  children: ReactNode;
}

/**
 * REQ-3-3: the shared frame of every repository page. The heading is
 * “owner/repository name”, the visibility marker is visible on each page, and
 * “Code”, “Issues”, “Pull requests” and “Settings” are navigation links. The
 * “Code” link is a link — the clone-menu trigger of the overview is a button.
 */
export function RepositoryShell({ repository, active, children }: RepositoryShellProps) {
  const ownerName = repository.ownerName;
  const repositoryName = repository.name;
  const tab = (id: RepositorySection, label: string, href: string) => (
    <a href={href} aria-current={active === id ? "page" : undefined}>
      {label}
    </a>
  );

  return (
    <main>
      <h1>{repository.fullName}</h1>
      <p className="repository-visibility" data-visibility={repository.visibility}>
        {repository.visibility === "private" ? "Private" : "Public"}
      </p>
      <nav className="repository-nav" aria-label="Repository">
        {tab("code", "Code", repositoryCodeHash(ownerName, repositoryName))}
        {tab("issues", "Issues", repositoryIssuesHash(ownerName, repositoryName))}
        {tab("pulls", "Pull requests", repositoryPullRequestsHash(ownerName, repositoryName))}
        {tab("settings", "Settings", repositorySettingsHash(ownerName, repositoryName))}
      </nav>
      {children}
    </main>
  );
}
