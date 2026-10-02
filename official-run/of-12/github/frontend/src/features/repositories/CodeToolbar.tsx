import { Menu } from "../../ui";
import { navigateHref } from "../../lib/hash-route";
import { BranchSelector, type BranchCreationResult } from "./BranchSelector";
import type { RepositoryOverview } from "./repository-api";
import { codeHref, editFileHref, newFileHref } from "./repository-links";

export interface CodeToolbarProps {
  repository: RepositoryOverview;
  /** The branch the current Code page reads. */
  branch: string;
  /** The file the page shows, when it shows one instead of a directory. */
  filePath?: string;
  /** Switches the branch; the Code page root by default, the page path when given. */
  onSelectBranch?(branch: string): void;
  /** Creates a branch at the current head for a user with Write permission (REQ-4-3-2). */
  onCreateBranch?(name: string): Promise<BranchCreationResult>;
}

/**
 * Toolbar of the Code page family (REQ-4-1, REQ-4-4): the current branch
 * selector on the left, and — for an account with Write permission or higher —
 * the "Add file" menu with its "Create new file" entry next to the "Edit"
 * entry of the displayed file. Read and Triage only ever get the selector.
 *
 * The selector is also where a writer creates a branch (REQ-4-3-2): the
 * creation entry appears for a valid unused name and switches to the new
 * branch once it is stored.
 */
export function CodeToolbar({ repository, branch, filePath, onSelectBranch, onCreateBranch }: CodeToolbarProps) {
  const writable = repository.canWrite === true;
  return (
    <div className="code-toolbar">
      {repository.branches.length > 0 ? (
        <BranchSelector
          branch={branch}
          branches={repository.branches}
          canCreate={writable}
          onCreate={writable ? onCreateBranch : undefined}
          onSelect={onSelectBranch ?? ((name) => navigateHref(codeHref(repository, name)))}
        />
      ) : null}
      {writable ? (
        <div className="code-toolbar__actions">
          <Menu
            triggerLabel="Add file"
            items={[
              {
                id: "create-new-file",
                label: "Create new file",
                onSelect: () => navigateHref(newFileHref(repository, branch)),
              },
            ]}
          />
          {filePath ? (
            <a className="code-toolbar__edit" href={editFileHref(repository, branch, filePath)}>
              Edit
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
