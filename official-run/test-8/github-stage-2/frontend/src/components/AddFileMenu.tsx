import { useEffect, useRef, useState } from "react";

import { navigate } from "../lib/hash-route";
import { newFilePath } from "../lib/repository-paths";
import { Button } from "../ui";

export interface AddFileMenuProps {
  ownerLogin: string;
  repositoryName: string;
  /** The branch the new file is committed on. */
  branch: string;
}

/**
 * The writable code page entry of REQ-4-4: “Add file” opens a small panel whose
 * “Create new file” item lands on the editor of the current branch. It is only
 * rendered for Write and above; the server refuses a submission anyway.
 */
export function AddFileMenu({ ownerLogin, repositoryName, branch }: AddFileMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return (
    <div
      className="add-file"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        setOpen(false);
        triggerRef.current?.focus();
      }}
    >
      <Button
        ref={triggerRef}
        className="add-file__trigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Add file
      </Button>
      {open ? (
        <div className="add-file__panel">
          <Button
            className="add-file__item"
            onClick={() => {
              setOpen(false);
              navigate(newFilePath(ownerLogin, repositoryName, branch));
            }}
          >
            Create new file
          </Button>
        </div>
      ) : null}
    </div>
  );
}
