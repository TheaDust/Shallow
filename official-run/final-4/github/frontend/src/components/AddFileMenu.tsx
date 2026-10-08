import { navigate } from "../lib/hash-route";
import { Menu } from "../ui/Menu";

/**
 * "Add file" menu of a writable repository page. It opens the "Create new file"
 * entry, which is the web editor for one new file on the current branch; the
 * server re-checks the write permission before any commit is written, so the
 * menu is only rendered for an account that may actually write.
 */
export function AddFileMenu({ owner, name, branch }: { owner: string; name: string; branch?: string }) {
  return (
    <Menu
      triggerLabel="Add file"
      items={[
        {
          id: "create-new-file",
          label: "Create new file",
          onSelect: () => {
            const search = new URLSearchParams();
            if (branch) search.set("branch", branch);
            navigate(
              `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/new`,
              search,
            );
          },
        },
      ]}
    />
  );
}
