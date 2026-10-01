import {
  createRepositoryBranch,
  repositoryFileEditorHref,
  repositoryHref,
  repositoryIssuesHref,
  repositoryPullRequestsHref,
  repositorySettingsHref,
} from "../../lib/repository-code-api";
import type { RepositoryVisibility } from "../../lib/organizations-api";
import type { RepositorySource } from "../../lib/repositories-api";
import { Menu } from "../../ui/Menu";
import { useAccountSession } from "../account/AccountSession";
import { visibilityLabel } from "../organizations/format";
import { ClonePopover } from "./ClonePopover";
import { ForkRepositoryButton } from "./ForkRepositoryDialog";
import { RepositoryBranchSelector } from "./RepositoryBranchSelector";

export type RepositoryNavSection = "code" | "issues" | "pulls" | "settings";

/** The branch selector of one Code page. */
export interface RepositoryHeaderBranch {
  branch: string;
  branches: string[];
  hrefForBranch: (branch: string) => string;
  /** True when the viewer may create branches and commit file changes. */
  canWrite?: boolean;
}

/** The one history link named `Commits` with its commit count. */
export interface RepositoryHeaderHistory {
  href: string;
  count: number;
}

export interface RepositoryHeaderProps {
  owner: string;
  name: string;
  visibility: RepositoryVisibility;
  description: string;
  defaultBranch: string | null;
  /** The Settings entry is only offered to a signed-in reader. */
  showSettings: boolean;
  active: RepositoryNavSection;
  /** The `Public`/`Private` marker; the settings panel states it itself. */
  showVisibilityMarker?: boolean;
  /** Present only for a fork: the frontend shows the source link from it. */
  source?: RepositorySource | null;
  /** The branch selector at the top of the Code page. */
  branch?: RepositoryHeaderBranch;
  /** The `Commits` history link of this page. */
  history?: RepositoryHeaderHistory;
  /** The `Edit` entry of a writable file page. */
  editHref?: string;
  /** The primary navigation; hidden where a results-type link is the only `Code`. */
  showNav?: boolean;
}

/**
 * Identity block shared by every repository page: the `owner/name` heading,
 * the visibility marker, the description, the default branch, the read-only
 * clone popover (button `Code`), the `Fork` action for a signed-in reader and
 * the primary navigation entries (link `Code` among them).
 */
export function RepositoryHeader({
  owner,
  name,
  visibility,
  description,
  defaultBranch,
  showSettings,
  active,
  showVisibilityMarker = true,
  source,
  branch,
  history,
  editHref,
  showNav = true,
}: RepositoryHeaderProps) {
  const { account } = useAccountSession();

  // Creating a branch stores a new reference at the current branch head; the
  // server re-checks the Write permission, so this handler is only offered for
  // a viewer the stored role already allows.
  const createBranch =
    branch?.canWrite === true
      ? async (branchName: string) => {
          await createRepositoryBranch(owner, name, {
            name: branchName,
            base: branch.branch,
          });
          window.location.hash = branch.hrefForBranch(branchName);
        }
      : undefined;

  return (
    <header className="repository-header">
      <div className="repository-header__identity">
        <h1 className="repository-header__title">{`${owner}/${name}`}</h1>
        <div className="repository-header__actions">
          {branch?.canWrite ? (
            <Menu
              triggerLabel="Add file"
              items={[
                {
                  id: "create-new-file",
                  label: "Create new file",
                  onSelect: () => {
                    window.location.hash = repositoryFileEditorHref(owner, name, branch.branch);
                  },
                },
              ]}
            />
          ) : null}
          {editHref ? (
            <a className="repository-header__edit" href={editHref}>
              Edit
            </a>
          ) : null}
          <ClonePopover owner={owner} name={name} />
          <ForkRepositoryButton
            source={{ owner, name, visibility }}
            signedIn={Boolean(account)}
          />
        </div>
      </div>
      <p className="repository-header__meta">
        {showVisibilityMarker ? (
          <span className="repository-visibility">{visibilityLabel(visibility)}</span>
        ) : null}
        {defaultBranch ? (
          <span className="repository-branch">{`Default branch: ${defaultBranch}`}</span>
        ) : null}
        {history ? (
          <span className="repository-header__history">
            <a className="repository-header__history-link" href={history.href}>
              Commits
            </a>
            <span className="repository-header__history-count">{`${history.count} ${
              history.count === 1 ? "commit" : "commits"
            }`}</span>
          </span>
        ) : null}
      </p>
      {branch ? (
        <RepositoryBranchSelector
          branch={branch.branch}
          branches={branch.branches}
          hrefForBranch={branch.hrefForBranch}
          createBranch={createBranch}
        />
      ) : null}
      {description ? <p className="repository-header__description">{description}</p> : null}
      {source ? (
        <p className="repository-header__source">
          Forked from <a href={repositoryHref(source.owner, source.name)}>{source.name}</a>
        </p>
      ) : null}
      {showNav ? (
        <nav className="repository-header__nav" aria-label="Repository">
          <a
            href={repositoryHref(owner, name)}
            aria-current={active === "code" ? "page" : undefined}
          >
            Code
          </a>
          <a
            href={repositoryIssuesHref(owner, name)}
            aria-current={active === "issues" ? "page" : undefined}
          >
            Issues
          </a>
          <a
            href={repositoryPullRequestsHref(owner, name)}
            aria-current={active === "pulls" ? "page" : undefined}
          >
            Pull requests
          </a>
          {showSettings ? (
            <a
              href={repositorySettingsHref(owner, name)}
              aria-current={active === "settings" ? "page" : undefined}
            >
              Settings
            </a>
          ) : null}
        </nav>
      ) : null}
    </header>
  );
}
