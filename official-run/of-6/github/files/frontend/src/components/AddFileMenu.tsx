import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { navigate } from '../router';

interface AddFileMenuProps {
  owner: string;
  name: string;
  branch: string;
}

/**
 * REQ-4-4: the unique "Add file" button on the writable Code page. Clicking
 * it opens a menu containing the single "Create new file" menuitem, which
 * opens the web file editor for a new file on the current branch. The menu
 * implements the menuitem keyboard contract: Enter/Space activates, Escape
 * (and an outside click) closes, and focus returns to the trigger. The parent
 * page only renders it for Write/Maintain/Admin/organization Owner accounts;
 * the server enforces the same permission on submission.
 */
export default function AddFileMenu({ owner, name, branch }: AddFileMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLDivElement>(null);

  // Close the menu when the user clicks outside of it.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onMouseDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Focus the Create new file menuitem as soon as the menu opens.
  useEffect(() => {
    if (open) {
      itemRef.current?.focus();
    }
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const openCreateNewFile = () => {
    setOpen(false);
    navigate(
      `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(
        name
      )}/new/${encodeURIComponent(branch)}`
    );
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      itemRef.current?.focus();
    }
  };

  return (
    <div ref={containerRef} className="add-file-menu">
      <button
        ref={triggerRef}
        type="button"
        className="add-file-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        Add file
        <span aria-hidden="true" className="add-file-caret">
          ▾
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Add file"
          className="add-file-menu-popover"
          onKeyDown={handleMenuKeyDown}
        >
          <div
            ref={itemRef}
            role="menuitem"
            tabIndex={-1}
            className="add-file-menu-item"
            onClick={openCreateNewFile}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openCreateNewFile();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                close();
              }
            }}
          >
            Create new file
          </div>
        </div>
      ) : null}
    </div>
  );
}
