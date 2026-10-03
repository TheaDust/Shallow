import type { ReactNode } from "react";

import { makeHash } from "../lib/hash-route";
import { commitsPath, repositoryPath } from "../lib/repository-paths";

export interface RepositoryNavProps {
  ownerLogin: string;
  repositoryName: string;
  /** The branch the history link reads; usually the branch of the page. */
  branch: string;
  active: "code" | "commits";
  /**
   * The file path of the page. The “Commits” link of a file page then opens that
   * file’s history (REQ-4-4: the created file’s “Commits” link exposes the
   * submitted commit message); a page without a path keeps the branch history.
   */
  path?: string;
  /** Extra section links, e.g. Settings for a repository Admin. */
  children?: ReactNode;
}

/**
 * The repository section links. “Code” and “Commits” are the two sections of
 * REQ-4; the commit count is never part of the link text so one link named
 * “Commits” stays the only match on the page.
 */
export function RepositoryNav({
  ownerLogin,
  repositoryName,
  branch,
  active,
  path = "",
  children,
}: RepositoryNavProps) {
  return (
    <nav className="repository-nav" aria-label="Repository">
      <a
        className="repository-nav__link"
        href={makeHash(repositoryPath(ownerLogin, repositoryName))}
        aria-current={active === "code" ? "page" : undefined}
      >
        Code
      </a>
      <a
        className="repository-nav__link"
        href={makeHash(commitsPath(ownerLogin, repositoryName, branch, path))}
        aria-current={active === "commits" ? "page" : undefined}
      >
        Commits
      </a>
      {children}
    </nav>
  );
}
