import { navigate } from "../lib/hash-route";
import { repositoryEditorPath } from "../lib/repository-routes";
import { Menu } from "../ui/Menu";

export interface AddFileMenuProps {
  owner: string;
  name: string;
  branch: string;
}

/**
 * The `Add file` entry of a writable Code page (REQ-4-4). It is a button opening
 * a menu whose only item, `Create new file`, opens the file editor for a new
 * path on the current branch. It is rendered only while the viewer may write;
 * the server refuses the commit for anybody else even when it is reached
 * directly.
 */
export function AddFileMenu({ owner, name, branch }: AddFileMenuProps) {
  return (
    <Menu
      triggerLabel="Add file"
      buttonVariant="primary"
      items={[
        {
          id: "create-file",
          label: "Create new file",
          onSelect: () => navigate(repositoryEditorPath(owner, name, branch)),
        },
      ]}
    />
  );
}
