import {
  repositoryCommitHref,
  type DiffLine,
  type RepositoryComparison,
} from "../../lib/repository-code-api";

const MARKERS: Record<DiffLine["type"], string> = {
  add: "+",
  remove: "-",
  context: " ",
};

/** The whole diff block of a comparison: identifiers, summary and file diffs. */
export interface CommitDiffViewProps {
  owner: string;
  name: string;
  comparison: RepositoryComparison;
  /** Revision the changed-file links keep, i.e. the compared commit. */
  revision: string;
  /** The file diff currently open, when the view is scoped to one file. */
  openPath?: string;
  /** Title context shown above the summary. */
  heading?: string;
  headingId?: string;
}

/**
 * Read-only view of one comparison: the base and compare identifiers, the
 * `Changed files` summary with its numeric additions and deletions, and the
 * line-by-line diff of every changed file. Unchanged files are not part of the
 * payload, so they can never appear here.
 */
export function CommitDiffView({
  owner,
  name,
  comparison,
  revision,
  openPath = "",
  heading,
  headingId,
}: CommitDiffViewProps) {
  const { base, compare, files } = comparison;

  return (
    <section className="commit-diff" aria-label="Diff">
      {heading ? (
        <h2 className="commit-diff__heading" id={headingId}>
          {heading}
        </h2>
      ) : null}
      <p className="commit-diff__identifiers">
        <span className="commit-diff__base">{`Base: ${base ? base.shortSha ?? base.sha : "none"}`}</span>
        <span className="commit-diff__compare">{`Compare: ${compare.shortSha ?? compare.sha}`}</span>
      </p>
      <p className="commit-diff__summary">
        <span className="commit-diff__summary-label">Changed files</span>
        <span className="commit-diff__summary-count">{comparison.changedFileCount}</span>
        <span className="commit-diff__summary-additions">{`+${comparison.additions}`}</span>
        <span className="commit-diff__summary-deletions">{`-${comparison.deletions}`}</span>
      </p>
      {files.length === 0 ? <p role="status">No changed files.</p> : null}
      <ul className="commit-diff__files">
        {files.map((file) => (
          <li key={file.path} className="commit-diff__file">
            <h3 className="commit-diff__file-name">
              <a href={repositoryCommitHref(owner, name, revision, { path: file.path })}>
                {file.path}
              </a>
            </h3>
            <p className="commit-diff__file-meta">
              <span className="commit-diff__file-status">{file.status}</span>
              <span className="commit-diff__file-counts">{`+${file.additions} -${file.deletions}`}</span>
            </p>
            <pre
              className="commit-diff__lines"
              data-open={file.path === openPath ? "true" : undefined}
            >
              {file.lines.map((line, index) => (
                <span key={index} className={`diff-line diff-line--${line.type}`}>
                  <span className="diff-line__marker">{MARKERS[line.type]}</span>
                  <span className="diff-line__text">{line.text}</span>
                </span>
              ))}
            </pre>
          </li>
        ))}
      </ul>
    </section>
  );
}
