import { Fragment } from "react";

import type { ChangedFile, DiffLine } from "../lib/repositories-api";

export interface ChangedFilesProps {
  changedFiles: ChangedFile[];
  filesChanged: number;
  additions: number;
  deletions: number;
  /** Address of one changed file's own diff. */
  fileHref(path: string): string;
  /** The changed file the current address selected, when the view offers one. */
  selectedPath?: string;
}

function marker(kind: DiffLine["kind"]): string {
  if (kind === "add") return "+";
  if (kind === "remove") return "-";
  return " ";
}

/**
 * Changed files of a commit or comparison: the path of every changed file as a
 * link to that file's diff, the aggregate `Changed files` and line counts and
 * the line-by-line additions and deletions of every file. Unchanged files never
 * reach this list (REQ-4-2-2, REQ-6-3-2).
 */
export function ChangedFiles({
  changedFiles,
  filesChanged,
  additions,
  deletions,
  fileHref,
  selectedPath,
}: ChangedFilesProps) {
  return (
    <section className="changed-files" aria-labelledby="changed-files-heading">
      <h2 id="changed-files-heading">Changed files</h2>
      <p className="changed-files__summary">
        <span className="changed-files__count">{filesChanged} changed files</span>
        <span className="changed-files__totals">
          {additions} additions, {deletions} deletions
        </span>
      </p>
      {changedFiles.length === 0 ? (
        <p className="changed-files__empty">No changed files.</p>
      ) : (
        <ul className="changed-files__list">
          {changedFiles.map((file) => {
            const selected = selectedPath === file.path;
            return (
              <li
                key={file.path}
                className="changed-file"
                data-selected={selected ? "true" : undefined}
              >
                <p className="changed-file__header">
                  <a
                    className="changed-file__path"
                    href={fileHref(file.path)}
                    aria-current={selected ? "true" : undefined}
                  >
                    {file.path}
                  </a>
                  <span className="changed-file__stats">
                    <span className="changed-file__additions">+{file.additions}</span>
                    <span className="changed-file__deletions">-{file.deletions}</span>
                  </span>
                </p>
                <pre className="changed-file__diff">
                  {file.diff.map((line, index) => (
                    <Fragment key={`${line.kind}-${index}`}>
                      <span className={`diff-line diff-line--${line.kind}`} data-kind={line.kind}>
                        {marker(line.kind)}
                        {line.text}
                      </span>
                      {"\n"}
                    </Fragment>
                  ))}
                </pre>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
