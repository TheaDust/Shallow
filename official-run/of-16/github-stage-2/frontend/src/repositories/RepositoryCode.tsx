import { type ReactNode } from "react";

import { Button } from "../ui";
import { AddFileMenu } from "./AddFileMenu";
import { CodeClonePopover } from "./CodeClonePopover";
import { RepositoryFileList } from "./RepositoryFileList";
import { countLabel } from "./format";
import { repositoryCommitSuffix, repositoryPath } from "./routes";
import type {
  RepositoryCommitSummary,
  RepositoryDirectoryEntry,
  RepositoryOwnerKind,
} from "./types";

export interface RepositoryCodeProps {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  branch: string;
  files: readonly RepositoryDirectoryEntry[];
  latestCommit: RepositoryCommitSummary | null;
  commitCount: number;
  /** Branch selector of the Code page, rendered at the top of the toolbar. */
  branchSelector?: ReactNode;
  /** True when the viewer may add files, i.e. the "Add file" entry is offered. */
  canWrite?: boolean;
  /** True while another branch snapshot is being read. */
  busy?: boolean;
  onFork?(): void;
}

/**
 * The "Code" area of the repository overview: the branch selector, the "Add
 * file" menu of a writable repository, the Code clone button, the Fork button,
 * the file and directory links of the current branch and the latest commit. A
 * directory entry opens the listing of the path it identifies, a file entry
 * opens the read-only file page, and the latest commit message opens the
 * comparison page of that immutable commit.
 */
export function RepositoryCode({
  ownerKind,
  owner,
  name,
  branch,
  files,
  latestCommit,
  commitCount,
  branchSelector,
  canWrite = false,
  busy = false,
  onFork,
}: RepositoryCodeProps) {
  const latestCommitHref = latestCommit?.id
    ? `#${repositoryPath(ownerKind, owner, name, repositoryCommitSuffix(latestCommit.id))}`
    : null;

  return (
    <section className="repository-code" aria-label="Repository files" aria-busy={busy || undefined}>
      <div className="repository-code__toolbar">
        {branchSelector}
        {canWrite ? (
          <AddFileMenu ownerKind={ownerKind} owner={owner} name={name} branch={branch} />
        ) : null}
        <CodeClonePopover owner={owner} name={name} />
        {onFork ? <Button variant="secondary" onClick={onFork}>Fork</Button> : null}
      </div>
      <RepositoryFileList
        ownerKind={ownerKind}
        owner={owner}
        name={name}
        branch={branch}
        entries={files}
      />
      {latestCommit ? (
        <p className="repository-commit">
          {latestCommitHref ? (
            <a className="repository-commit__message" href={latestCommitHref}>
              {latestCommit.message}
            </a>
          ) : (
            <span className="repository-commit__message">{latestCommit.message}</span>
          )}
          <span className="repository-commit__meta">
            {latestCommit.authorName ? `${latestCommit.authorName} · ` : ""}
            {countLabel(commitCount, "commit")}
          </span>
        </p>
      ) : null}
    </section>
  );
}
