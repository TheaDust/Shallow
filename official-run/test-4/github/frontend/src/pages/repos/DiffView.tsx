import { DiffFile } from "../../lib/repo-api";

interface DiffViewProps {
  files: DiffFile[];
}

/**
 * Line-by-line diff of one or more files: each changed file shows its path,
 * status, and numeric additions/deletions, followed by the diff lines with
 * explicit +/− prefixes.
 */
export function DiffView({ files }: DiffViewProps) {
  if (files.length === 0) {
    return <p>No changes.</p>;
  }
  return (
    <div className="diff-view">
      {files.map((file) => (
        <section key={file.path} className="diff-file" aria-label={file.path}>
          <h3 className="diff-file__path">{file.path}</h3>
          <p className="diff-file__summary">
            <span className="diff-file__status">{file.status}</span>
            <span className="diff-file__counts">
              +{file.additions} −{file.deletions}
            </span>
          </p>
          <div className="diff-lines" role="group" aria-label={`Diff for ${file.path}`}>
            {file.lines.map((line, index) => (
              <div
                key={index}
                className={`diff-line diff-line--${line.type}`}
                data-testid="diff-line"
              >
                <span className="diff-line__marker" aria-hidden="true">
                  {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                </span>
                <span className="diff-line__text">{line.text}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
