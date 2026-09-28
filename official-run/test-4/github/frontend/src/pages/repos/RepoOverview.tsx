import { useEffect, useRef, useState } from "react";

import { formatUpdateTime } from "../../lib/org-api";
import { navigate } from "../../lib/hash-route";
import {
  createRepositoryBranch,
  fileHref,
  repoHref,
  repoOwnerBase,
  RepoBranch,
  RepoDetail,
  RepoOwnerType,
  treeHref,
} from "../../lib/repo-api";
import { useSession } from "../../session";
import { BranchSelector } from "./BranchSelector";

export type RepoSection = "code" | "issues" | "pulls";

interface RepoOverviewProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  repository: RepoDetail;
  section: RepoSection;
  branch?: string;
  path?: string;
}

/**
 * Repository code page: the heading “owner/repository name”, visibility
 * marker, description, default branch, the Code/Issues/Pull requests entries
 * (plus Settings and Fork for signed-in users), the clone-menu Code button,
 * the branch selector, breadcrumbs for the current directory, the history
 * link, the writable “Add file” menu, and the file/directory list of the
 * current branch and path. Directory and file entries are links whose exact
 * accessible names are their names.
 */
export function RepoOverview({
  ownerType,
  ownerName,
  repoName,
  repository,
  section,
  branch,
  path,
}: RepoOverviewProps) {
  const { status } = useSession();
  const authenticated = status === "authenticated";
  const [cloneOpen, setCloneOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [protocol, setProtocol] = useState<"https" | "ssh">("https");
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    if (cloneOpen) {
      content.setAttribute("inert", "");
    } else {
      content.removeAttribute("inert");
    }
  }, [cloneOpen]);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCloneOpen(false);
        setAddMenuOpen(false);
      }
    }
    if (cloneOpen || addMenuOpen) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cloneOpen, addMenuOpen]);

  const name = repository.name || repoName;
  const visibility = repository.visibility === "public" ? "public" : "private";
  const description = repository.description ?? "";
  const defaultBranch = repository.defaultBranch || "main";
  const currentBranch = branch || repository.currentBranch || defaultBranch;
  const files = repository.files ?? [];
  const branches: RepoBranch[] = repository.branches ?? [];
  const commitCount = repository.commitCount ?? 0;
  const source = repository.source ?? null;
  const base = `${repoOwnerBase(ownerType, ownerName)}/repos/${encodeURIComponent(name)}`;
  const host = typeof window !== "undefined" ? window.location.host : "";
  const cloneValues: Record<"https" | "ssh", string> = {
    https: `https://${host}/${ownerName}/${name}.git`,
    ssh: `git@${host}:${ownerName}/${name}.git`,
  };
  const canWrite = authenticated && ["write", "maintain", "admin"].includes(repository.currentRole ?? "");

  async function createBranch(branchName: string): Promise<string | null> {
    const outcome = await createRepositoryBranch(
      ownerType,
      ownerName,
      name,
      branchName,
      currentBranch,
    );
    if (outcome.ok) {
      navigate(treeHref(ownerType, ownerName, name, branchName, path).slice(1), undefined);
      return null;
    }
    return outcome.errors.name ?? "Branch creation failed";
  }

  async function copyCloneValue() {
    try {
      await navigator.clipboard?.writeText(cloneValues[protocol]);
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable: leave the previous feedback state unchanged.
    }
  }

  function switchProtocol(next: "https" | "ssh") {
    setProtocol(next);
    setCopied(false);
  }

  function selectBranch(next: string) {
    navigate(treeHref(ownerType, ownerName, name, next, path).slice(1), undefined);
  }

  // Entries visible at `path` on the current branch: directories (paths with
  // more segments below this directory) and files directly inside it.
  const currentDir = (path ?? "").split("/").filter(Boolean);
  const prefix = currentDir.length > 0 ? `${currentDir.join("/")}/` : "";
  const entries = files
    .filter((file) => (prefix ? file.path.startsWith(prefix) : true))
    .map((file) => {
      const rest = file.path.slice(prefix.length);
      const segment = rest.split("/")[0];
      const isDirectory = rest.includes("/");
      return { name: segment, isDirectory, path: `${prefix}${segment}` };
    })
    .filter(
      (entry, index, all) =>
        all.findIndex(
          (candidate) => candidate.name === entry.name && candidate.isDirectory === entry.isDirectory,
        ) === index,
    )
    .sort((a, b) =>
      a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1,
    );

  return (
    <>
      <div ref={contentRef}>
        <main>
          <h1>{ownerName}/{name}</h1>
          {source && (
            <p className="repo-overview__forked">
              Forked from{" "}
              <a href={repoHref(source)}>{source.name}</a>
            </p>
          )}
          <nav className="org-tabs" aria-label="Repository">
            <a
              className="org-tabs__link"
              href={`#${base}`}
              aria-current={section === "code" ? "page" : undefined}
            >
              Code
            </a>
            <a
              className="org-tabs__link"
              href={`#${base}/issues`}
              aria-current={section === "issues" ? "page" : undefined}
            >
              Issues
            </a>
            <a
              className="org-tabs__link"
              href={`#${base}/pulls`}
              aria-current={section === "pulls" ? "page" : undefined}
            >
              Pull requests
            </a>
            {authenticated && (
              <a className="org-tabs__link" href={`#${base}/settings`}>
                Settings
              </a>
            )}
          </nav>
          <div className="repo-overview__actions">
            {authenticated && (
              <button
                type="button"
                className="button"
                onClick={() => navigate(`${base}/fork`, undefined)}
              >
                Fork
              </button>
            )}
            {canWrite && section === "code" && (
              <div className="add-file-menu">
                <button
                  type="button"
                  className="button"
                  aria-haspopup="menu"
                  aria-expanded={addMenuOpen}
                  onClick={() => setAddMenuOpen((open) => !open)}
                >
                  Add file
                </button>
                {addMenuOpen && (
                  <div className="add-file-menu__menu" role="menu" aria-label="Add file">
                    <div
                      role="menuitem"
                      tabIndex={0}
                      className="add-file-menu__item"
                      onClick={() => {
                        setAddMenuOpen(false);
                        navigate(`${base}/new?branch=${encodeURIComponent(currentBranch)}`, undefined);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setAddMenuOpen(false);
                          navigate(`${base}/new?branch=${encodeURIComponent(currentBranch)}`, undefined);
                        }
                      }}
                    >
                      Create new file
                    </div>
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              className="button"
              aria-haspopup="dialog"
              aria-expanded={cloneOpen}
              onClick={() => setCloneOpen((open) => !open)}
            >
              Code
            </button>
          </div>
          <p>
            <span className="repo-list__visibility">
              {visibility === "public" ? "Public" : "Private"}
            </span>
            {description && <span className="repo-overview__description"> {description}</span>}
          </p>
          <p className="repo-list__meta">
            <span>
              Default branch: <span className="repo-overview__branch">{defaultBranch}</span>
            </span>
            <span>{formatUpdateTime(repository.updatedAt)}</span>
          </p>
          {section === "code" && (
            <section aria-label="Files">
              <div className="repo-tree__toolbar">
                <BranchSelector
                  branches={branches}
                  currentBranch={currentBranch}
                  canCreate={canWrite}
                  onSelect={selectBranch}
                  onCreate={createBranch}
                />
                <a className="repo-tree__commits" href={`#${base}/commits?branch=${encodeURIComponent(currentBranch)}`}>
                  Commits <span aria-hidden="true">{commitCount}</span>
                </a>
              </div>
              <nav className="repo-breadcrumbs" aria-label="Breadcrumb">
                <a href={treeHref(ownerType, ownerName, name, currentBranch)}>root</a>
                {currentDir.map((segment, index) => {
                  const dirPath = currentDir.slice(0, index + 1).join("/");
                  const isLast = index === currentDir.length - 1;
                  return (
                    <span key={dirPath} className="repo-breadcrumbs__segment">
                      <span aria-hidden="true">/</span>
                      {isLast ? (
                        <span aria-current="page">{segment}</span>
                      ) : (
                        <a href={treeHref(ownerType, ownerName, name, currentBranch, dirPath)}>{segment}</a>
                      )}
                    </span>
                  );
                })}
              </nav>
              <ul className="repo-files">
                {entries.map((entry) => (
                  <li key={`${entry.isDirectory ? "dir" : "file"}-${entry.path}`} className="repo-files__item">
                    {entry.isDirectory ? (
                      <a href={treeHref(ownerType, ownerName, name, currentBranch, entry.path)}>
                        {entry.name}
                        <span aria-hidden="true">/</span>
                      </a>
                    ) : (
                      <a href={fileHref(ownerType, ownerName, name, currentBranch, entry.path)}>
                        {entry.name}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              {entries.length === 0 && <p>No files.</p>}
            </section>
          )}
          {section === "issues" && <p>No issues found.</p>}
          {section === "pulls" && <p>No pull requests found.</p>}
        </main>
      </div>
      {cloneOpen && (
        <div className="clone-popover" role="dialog" aria-label="Clone">
          <h2>Clone</h2>
          <p className="clone-popover__intro">Copy the read-only clone address.</p>
          <div
            className="clone-popover__tabs"
            role="tablist"
            aria-label="Clone protocol"
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                switchProtocol(protocol === "https" ? "ssh" : "https");
              }
            }}
          >
            <button
              type="button"
              role="tab"
              id="clone-tab-https"
              aria-selected={protocol === "https"}
              onClick={() => switchProtocol("https")}
            >
              HTTPS
            </button>
            <button
              type="button"
              role="tab"
              id="clone-tab-ssh"
              aria-selected={protocol === "ssh"}
              onClick={() => switchProtocol("ssh")}
            >
              SSH
            </button>
          </div>
          <div
            className="clone-popover__value"
            role="tabpanel"
            aria-labelledby={protocol === "https" ? "clone-tab-https" : "clone-tab-ssh"}
          >
            <label className="clone-popover__value-label" htmlFor="clone-address">
              Clone address
            </label>
            <div className="clone-popover__value-row">
              <input
                id="clone-address"
                type="text"
                readOnly
                value={cloneValues[protocol]}
              />
              <button
                type="button"
                className="clone-popover__copy"
                aria-label="Copy clone value"
                onClick={() => {
                  void copyCloneValue();
                }}
              >
                <span aria-hidden="true">⧉</span>
              </button>
            </div>
            {copied && (
              <span role="status" aria-label="Copied" className="clone-popover__copied">
                Copied
              </span>
            )}
          </div>
          <div className="clone-popover__actions">
            <button type="button" className="button" onClick={() => setCloneOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
