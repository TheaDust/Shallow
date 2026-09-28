import { ReactNode } from "react";

import { AppHeader } from "../../components/AppHeader";
import { RepoOwnerType, repoOwnerBase } from "../../lib/repo-api";
import { useSession } from "../../session";

export type RepoNavSection = "code" | "issues" | "pulls";

interface RepoNavTabsProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  section: RepoNavSection;
}

/**
 * The Code/Issues/Pull requests navigation shared by every repository page.
 * The Code link remains a single link per page; it is distinct from the
 * clone-menu Code button rendered on the code page.
 */
export function RepoNavTabs({ ownerType, ownerName, repoName, section }: RepoNavTabsProps) {
  const { status } = useSession();
  const base = `${repoOwnerBase(ownerType, ownerName)}/repos/${encodeURIComponent(repoName)}`;
  return (
    <nav className="org-tabs" aria-label="Repository">
      <a className="org-tabs__link" href={`#${base}`} aria-current={section === "code" ? "page" : undefined}>
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
      {status === "authenticated" && (
        <a className="org-tabs__link" href={`#${base}/settings`}>
          Settings
        </a>
      )}
    </nav>
  );
}

interface RepoPageChromeProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  children: ReactNode;
  notFound?: ReactNode;
  section?: RepoNavSection;
}

/**
 * Shared chrome for read-only repository pages (history, commit detail,
 * comparison, issues): the repository heading and the Code/Issues/Pull
 * requests tabs around the page content. Access-denied and not-found states
 * keep the heading visible.
 */
export function RepoPageChrome({ ownerType, ownerName, repoName, children, notFound, section = "code" }: RepoPageChromeProps) {
  return (
    <AppHeader>
      <main>
        <h1>{ownerName}/{repoName}</h1>
        <RepoNavTabs ownerType={ownerType} ownerName={ownerName} repoName={repoName} section={section} />
        {notFound ? <p>{notFound}</p> : children}
      </main>
    </AppHeader>
  );
}
