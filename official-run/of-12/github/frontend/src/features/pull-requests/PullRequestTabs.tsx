import { pullHref } from "../repositories/repository-links";
import type { RepositorySummary } from "../repositories/repository-api";

/** The four sections of a pull request detail page (REQ-6). */
export type PullRequestTab = "conversation" | "commits" | "files" | "checks";

export const PULL_REQUEST_TABS: ReadonlyArray<{ id: PullRequestTab; label: string }> = [
  { id: "conversation", label: "Conversation" },
  { id: "commits", label: "Commits" },
  { id: "files", label: "Files changed" },
  { id: "checks", label: "Checks" },
];

/** The section the address asks for; Conversation is the one shown on arrival. */
export function parsePullRequestTab(value: string | null): PullRequestTab {
  const candidate = String(value ?? "").toLowerCase();
  return PULL_REQUEST_TABS.some((tab) => tab.id === candidate) ? (candidate as PullRequestTab) : "conversation";
}

export interface PullRequestTabsProps {
  repository: RepositorySummary;
  number: number | string;
  active: PullRequestTab;
}

/**
 * Conversation, Commits, Files changed and Checks are navigation links, so the
 * address of the section is active immediately and a reload reopens it.
 */
export function PullRequestTabs({ repository, number, active }: PullRequestTabsProps) {
  return (
    <nav className="pull-request__tabs" aria-label="Pull request">
      {PULL_REQUEST_TABS.map((tab) => (
        <a
          key={tab.id}
          className="pull-request__tab"
          href={pullHref(repository, number, tab.id)}
          aria-current={tab.id === active ? "page" : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
