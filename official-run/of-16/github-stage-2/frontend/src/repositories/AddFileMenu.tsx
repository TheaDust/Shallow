import { Menu } from "../ui";
import { repositoryNewFileSuffix, repositoryPath } from "./routes";
import type { RepositoryOwnerKind } from "./types";

export interface AddFileMenuProps {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  /** Branch the added file belongs to; the editor writes to this reference. */
  branch: string;
}

/**
 * "Add file" menu of a writable Code page. The trigger is a button carrying the
 * exact accessible name "Add file" and its only entry is the "Create new file"
 * link of the current branch: the entry navigates to the editor, where the name,
 * the content and the commit message are submitted together. A reader without
 * write permission never receives this entry.
 */
export function AddFileMenu({ ownerKind, owner, name, branch }: AddFileMenuProps) {
  return (
    <Menu
      triggerLabel="Add file"
      menuLabel="Add file"
      items={[
        {
          id: "create-new-file",
          label: "Create new file",
          href: `#${repositoryPath(ownerKind, owner, name, repositoryNewFileSuffix(branch))}`,
        },
      ]}
    />
  );
}
