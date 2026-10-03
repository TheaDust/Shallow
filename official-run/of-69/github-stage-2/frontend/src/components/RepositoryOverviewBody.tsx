import { useState } from "react";

import { navigate } from "../lib/hash-route";
import type { RepositoryCodeModel } from "../lib/repository-code";
import { repositoryNewFilePath, type RepositoryOwnerRef } from "../lib/routes";
import { RepositoryCodeBrowser } from "./RepositoryCodeBrowser";
import { Button, Tabs } from "../ui";

export interface CloneUrls {
  https: string;
  ssh: string;
}

export interface RepositoryOverviewBodyProps {
  description: string;
  defaultBranch?: string;
  updatedAt?: string;
  /** The owner the code page belongs to (used for its links). */
  owner: RepositoryOwnerRef;
  repositoryName: string;
  /** The branch selector, the entries of the current path and the opened file. */
  code: RepositoryCodeModel;
  forkedFrom: { name: string; href: string } | null;
  cloneUrls: CloneUrls;
  canFork: boolean;
  /** A writer may add a file to the branch the Code page reads. */
  canWrite: boolean;
  onFork(): void;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

/**
 * The clone popover behind the “Code” button. HTTPS and SSH are tabs; each tab
 * shows its read-only clone value behind a button that copies it and answers
 * with brief “Copied” feedback.
 */function ClonePopover({ cloneUrls }: { cloneUrls: CloneUrls }) {
  const [open, setOpen] = useState(false);
  const [protocol, setProtocol] = useState<"https" | "ssh">("https");
  const [copied, setCopied] = useState(false);

  async function copy(value: string) {
    try {
      await navigator.clipboard?.writeText(value);
    } catch {
      // A clipboard refusal still shows the feedback; nothing is modified.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  function value(selected: "https" | "ssh") {
    return selected === "https" ? cloneUrls.https : cloneUrls.ssh;
  }

  const panel = (selected: "https" | "ssh") => (
    <div className="clone-menu__value">
      <input readOnly value={value(selected)} aria-label={`${selected.toUpperCase()} clone address`} />
      <Button aria-label="Copy to clipboard" onClick={() => void copy(value(selected))}>
        Copy
      </Button>
      {copied ? (
        <span role="status" className="clone-menu__copied">
          Copied
        </span>
      ) : null}
    </div>
  );

  return (
    <div className="clone-menu">
      <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        Code
      </Button>
      {open ? (
        <div className="clone-menu__popover">
          <Tabs
            label="Clone"
            activeId={protocol}
            onChange={(id) => setProtocol(id === "ssh" ? "ssh" : "https")}
            items={[
              { id: "https", label: "HTTPS", panel: panel("https") },
              { id: "ssh", label: "SSH", panel: panel("ssh") },
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The “Add file” entry of a writable Code page. “Create new file” opens the
 * editor for the branch the page reads; the editor itself repeats the branch
 * it commits to.
 */
function AddFileMenu({
  owner,
  repositoryName,
  branch,
  defaultBranch,
}: {
  owner: RepositoryOwnerRef;
  repositoryName: string;
  branch: string;
  defaultBranch: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="add-file">
      <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Add file
      </Button>
      {open ? (
        <div
          className="add-file__popover"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
        >
          <button
            type="button"
            className="add-file__item"
            onClick={() => {
              // Navigate before closing: the popover unmounts with the menu.
              navigate(
                repositoryNewFilePath(owner, repositoryName, {
                  branch: branch === defaultBranch ? undefined : branch,
                }),
              );
              setOpen(false);
            }}
          >
            Create new file
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The body of a repository page shared by organization and personal
 * repositories: the clone surface, the Fork entry, the Code page (branch
 * selector, directory entries and the opened file), the description and
 * default branch, and the commit history.
 */
export function RepositoryOverviewBody({
  description,
  defaultBranch = "main",
  updatedAt,
  owner,
  repositoryName,
  code,
  forkedFrom,
  cloneUrls,
  canFork,
  canWrite,
  onFork,
}: RepositoryOverviewBodyProps) {
  return (
    <>
      {forkedFrom ? (
        <p className="repository-fork-source">
          Forked from <a href={forkedFrom.href}>{forkedFrom.name}</a>
        </p>
      ) : null}
      <div className="repository-actions">
        <ClonePopover cloneUrls={cloneUrls} />
        {canWrite ? (
          <AddFileMenu
            owner={owner}
            repositoryName={repositoryName}
            branch={code.branch}
            defaultBranch={defaultBranch}
          />
        ) : null}
        {canFork ? (
          <Button variant="secondary" onClick={onFork}>
            Fork
          </Button>
        ) : null}
      </div>
      <RepositoryCodeBrowser
        owner={owner}
        repository={repositoryName}
        code={code}
        defaultBranch={defaultBranch}
        canWrite={canWrite}
      />
      <dl className="repository-detail">
        <dt>Description</dt>
        <dd>{description}</dd>
        <dt>Default branch</dt>
        <dd>{defaultBranch}</dd>
        {updatedAt ? (
          <>
            <dt>Updated</dt>
            <dd>{formatDate(updatedAt)}</dd>
          </>
        ) : null}
      </dl>
    </>
  );
}
