import type { RepositoryFileDiff } from "./repository-api";

export interface CommitDiffViewProps {
  file: RepositoryFileDiff;
}

const PREFIX: Record<string, string> = { added: "+", removed: "-", context: " " };

/**
 * The line-by-line diff of one changed file (REQ-4-2-2).
 *
 * Added and deleted lines are readable as their own text values next to the
 * unchanged context, and the file path and its numeric counts are spelled out,
 * so a comparison can be read without opening an editor.
 */
export function CommitDiffView({ file }: CommitDiffViewProps) {
  return (
    <section className="commit-diff" aria-label={`Diff of ${file.path}`}>
      <h3 className="commit-diff__path">{file.path}</h3>
      <p className="commit-diff__counts">
        <span className="commit-diff__additions">{`+${file.additions} additions`}</span>
        <span className="commit-diff__deletions">{`-${file.deletions} deletions`}</span>
      </p>
      <pre className="commit-diff__lines">
        {file.lines.map((line, index) => (
          <span
            key={`${index}-${line.type}`}
            className={`commit-diff__line commit-diff__line--${line.type}`}
            data-line-type={line.type}
          >
            {`${PREFIX[line.type] ?? " "}${line.text}\n`}
          </span>
        ))}
      </pre>
    </section>
  );
}
