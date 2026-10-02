import type { RepositorySummary } from "./repository-api";
import { commitsHref } from "./repository-links";

export interface CommitCountLinkProps {
  repository: RepositorySummary;
  /** The branch whose commit count is shown. */
  branch: string;
  /** The number of commits of that branch. */
  count: number;
}

/**
 * The history entry above the file list of the Code page (REQ-4-2-1): the
 * visible label carries the commit count of the branch, while the history link
 * named "Commits" stays the single navigation entry of the repository header,
 * so no second control matches that name.
 */
export function CommitCountLink({ repository, branch, count }: CommitCountLinkProps) {
  if (count <= 0) return null;
  return (
    <p className="repository-history-link">
      <span aria-hidden="true">🕘</span>
      <a className="repository-history-link__count" href={commitsHref(repository, branch)}>
        {`${count} commit${count === 1 ? "" : "s"}`}
      </a>
    </p>
  );
}
