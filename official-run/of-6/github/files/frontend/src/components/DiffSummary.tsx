import type { RepositoryDiffFile } from '../types';

interface DiffSummaryProps {
  /** Only changed files (unchanged files never appear). */
  files: RepositoryDiffFile[];
  additions: number;
  deletions: number;
  /** Builds the href of one changed file's line-by-line diff. */
  fileHref: (path: string) => string;
  /**
   * REQ-6-3-2: the pull-request Files changed view renders the aggregate
   * statistics as the PR's changed-file count plus the line counts in the
   * exact format "<addition count> additions, <deletion count> deletions".
   * Other diff pages keep the REQ-4-2-2 sentence "N files changed, X
   * additions and Y deletions" (the default).
   */
  aggregateFormat?: 'and' | 'comma';
  /** When false the file paths are plain text instead of links (used where
   * no per-file diff page exists, e.g. the PR Files changed view). */
  links?: boolean;
}

/**
 * REQ-4-2-2: the "Changed files" summary of a diff page. Displays the numeric
 * additions/deletions summary and the list of changed files (each path is an
 * exact text value, with its per-file added/deleted line counts). Unchanged
 * files are not part of the list.
 *
 * REQ-6-3-2: on the pull-request Files changed view the aggregate shows the
 * current PR's number of changed files and the line counts in the format
 * "<addition count> additions, <deletion count> deletions"; file paths are
 * shown verbatim as plain text (selecting/expanding a diff block happens on
 * the same page, so no per-file link is needed).
 */
export default function DiffSummary({
  files,
  additions,
  deletions,
  fileHref,
  aggregateFormat = 'and',
  links = true,
}: DiffSummaryProps) {
  return (
    <section className="diff-summary-section" aria-label="Changed files">
      <h3>Changed files</h3>
      {aggregateFormat === 'comma' ? (
        <>
          <p className="diff-summary-count">
            {files.length} files changed
          </p>
          <p className="diff-summary-lines">
            {additions} additions, {deletions} deletions
          </p>
        </>
      ) : (
        <p className="diff-summary-count">
          {files.length} files changed, {additions} additions and {deletions} deletions
        </p>
      )}
      <ul className="commit-file-list">
        {files.map((file) => (
          <li key={file.path} className="commit-file-item">
            {links ? (
              <a className="diff-file-link" href={fileHref(file.path)}>
                {file.path}
              </a>
            ) : (
              <span className="diff-file-path-text">{file.path}</span>
            )}
            <span className="diff-file-stats">
              +{file.additions ?? 0} -{file.deletions ?? 0}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
