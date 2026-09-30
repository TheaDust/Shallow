import { repositoryPullRequestHref } from "../lib/repository-routes";

export type PullRequestTab = "conversation" | "commits" | "files" | "checks";

const TABS: ReadonlyArray<{ id: PullRequestTab; label: string }> = [
  { id: "conversation", label: "Conversation" },
  { id: "commits", label: "Commits" },
  { id: "files", label: "Files changed" },
  { id: "checks", label: "Checks" },
];

const TAB_IDS = new Set<string>(TABS.map((tab) => tab.id));

export function readPullRequestTab(value: string | null | undefined): PullRequestTab {
  return value && TAB_IDS.has(value) ? (value as PullRequestTab) : "conversation";
}

export interface PullRequestTabsProps {
  owner: string;
  name: string;
  number: number;
  current: PullRequestTab;
}

/**
 * The navigation of one pull request (REQ-6). Conversation, Commits, Files
 * changed and Checks are links, not tabs: each one addresses the same detail
 * page with that section selected, so opening or refreshing the address shows
 * the same section on the stored record.
 */
export function PullRequestTabs({ owner, name, number, current }: PullRequestTabsProps) {
  return (
    <nav className="pull-tabs" aria-label="Pull request">
      <ul className="pull-tabs__list">
        {TABS.map((tab) => (
          <li key={tab.id} className="pull-tabs__item">
            <a
              className="pull-tabs__link"
              href={repositoryPullRequestHref(owner, name, number, tab.id)}
              aria-current={tab.id === current ? "page" : undefined}
            >
              {tab.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
