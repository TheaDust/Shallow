import { useEffect, useRef, useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import {
  createRepositoryBranch,
  fileHref,
  repoOwnerBase,
  RepoOwnerType,
  treeHref,
} from "../../lib/repo-api";
import { useSession } from "../../session";
import { BranchSelector } from "./BranchSelector";
import { RepoNavTabs } from "./RepoPageChrome";
import { useRepoDetail } from "./useRepoDetail";

interface RepoFileViewProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  filePath: string;
  branch?: string;
}

/**
 * Read-only file page: the repository heading, the file's full path, the
 * current branch, breadcrumbs back to parent directories, the Commits link
 * for the file-scoped history, and the stored content for that branch and
 * path. Reloading retains the same branch, path, and content.
 */
export function RepoFileView({ ownerType, ownerName, repoName, filePath, branch }: RepoFileViewProps) {
  const { status } = useSession();
  const { status: detailStatus, repository } = useRepoDetail(ownerType, ownerName, repoName, branch);
  const authenticated = status === "authenticated";
  const base = `${repoOwnerBase(ownerType, ownerName)}/repos/${encodeURIComponent(repoName)}`;
  const contentRef = useRef<HTMLPreElement>(null);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);

  useEffect(() => {
    const match = window.location.hash.match(/#L(\d+)$/);
    if (!match) return;
    const line = Number(match[1]);
    setHighlightedLine(line);
    const target = contentRef.current?.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "center" });
    }
  }, [detailStatus, filePath, branch]);

  if (detailStatus === "notfound") {
    return (
      <AppHeader>
        <main>
          <h1>{ownerName}/{repoName}</h1>
          <p>Repository not found.</p>
        </main>
      </AppHeader>
    );
  }

  if (detailStatus === "denied") {
    return (
      <AppHeader>
        <main>
          <h1>{ownerName}/{repoName}</h1>
          <p>Access denied</p>
          {!authenticated && (
            <p>
              <a href="#/signin">Sign in</a>
            </p>
          )}
        </main>
      </AppHeader>
    );
  }

  if (detailStatus !== "ready" || !repository) {
    return (
      <AppHeader>
        <main>
          <h1>{ownerName}/{repoName}</h1>
          <p>Loading…</p>
        </main>
      </AppHeader>
    );
  }

  const currentBranch = branch || repository.currentBranch || repository.defaultBranch || "main";
  const resolvedRepoName = repository.name || repoName;
  const file = (repository.files ?? []).find((candidate) => candidate.path === filePath);
  const segments = filePath.split("/");
  const canWrite = authenticated && ["write", "maintain", "admin"].includes(repository.currentRole ?? "");

  function selectBranch(next: string) {
    const href = fileHref(ownerType, ownerName, repoName, next, filePath);
    window.location.hash = href;
  }

  async function createBranch(branchName: string): Promise<string | null> {
    const outcome = await createRepositoryBranch(
      ownerType,
      ownerName,
      resolvedRepoName,
      branchName,
      currentBranch,
    );
    if (outcome.ok) {
      window.location.hash = fileHref(ownerType, ownerName, resolvedRepoName, branchName, filePath);
      return null;
    }
    return outcome.errors.name ?? "Branch creation failed";
  }

  return (
    <AppHeader>
      <main>
        <h1>{ownerName}/{repository.name || repoName}</h1>
        <RepoNavTabs ownerType={ownerType} ownerName={ownerName} repoName={repoName} section="code" />
        <div className="repo-file__toolbar">
          <BranchSelector
            branches={repository.branches ?? []}
            currentBranch={currentBranch}
            canCreate={canWrite}
            onSelect={selectBranch}
            onCreate={createBranch}
          />
          <a
            className="repo-tree__commits"
            href={`#${base}/commits?branch=${encodeURIComponent(currentBranch)}&path=${encodeURIComponent(filePath)}`}
          >
            Commits <span aria-hidden="true">{repository.commitCount ?? 0}</span>
          </a>
          {canWrite && (
            <button
              type="button"
              className="button"
              onClick={() => {
                const params = new URLSearchParams({ branch: currentBranch, path: filePath });
                window.location.hash = `${base}/edit?${params.toString()}`;
              }}
            >
              Edit
            </button>
          )}
        </div>
        <nav className="repo-breadcrumbs" aria-label="Breadcrumb">
          <a href={treeHref(ownerType, ownerName, repoName, currentBranch)}>root</a>
          {segments.map((segment, index) => {
            const dirPath = segments.slice(0, index + 1).join("/");
            const isLast = index === segments.length - 1;
            return (
              <span key={dirPath} className="repo-breadcrumbs__segment">
                <span aria-hidden="true">/</span>
                {isLast ? (
                  <span aria-current="page">{segment}</span>
                ) : (
                  <a href={treeHref(ownerType, ownerName, repoName, currentBranch, dirPath)}>{segment}</a>
                )}
              </span>
            );
          })}
        </nav>
        <h2 className="repo-file__name">{filePath}</h2>
        {file ? (
          <pre ref={contentRef} className="repo-file__content">
            {file.content.split("\n").map((line, index) => (
              <span
                key={index}
                data-line={index + 1}
                className={
                  "repo-file__line" +
                  (highlightedLine === index + 1 ? " repo-file__line--highlight" : "")
                }
              >
                {line}
              </span>
            ))}
          </pre>
        ) : (
          <p>File not found.</p>
        )}
      </main>
    </AppHeader>
  );
}
