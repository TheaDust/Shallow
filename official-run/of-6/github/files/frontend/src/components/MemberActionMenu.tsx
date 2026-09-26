import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

export interface RemoveOutcome {
  ok: boolean;
  message?: string;
}

interface MemberActionMenuProps {
  username: string;
  /**
   * Performs the removal; resolves with ok=true after the member list has
   * been refreshed, or ok=false with a message when the server rejected it.
   */
  onRemove: () => Promise<RemoveOutcome>;
}

/**
 * REQ-2-2-4 per-member action menu on the People page. The trigger button is
 * named "Member menu <username>" and keeps aria-haspopup="menu" plus
 * aria-expanded; it opens a menu (role="menu") containing the single menuitem
 * "Remove from organization". Activating the menuitem opens a confirmation
 * dialog named "Remove member" whose "Remove" button performs the removal and
 * "Cancel" (or Escape) dismisses it. The menu supports ArrowDown to open,
 * Enter/Space to activate the menuitem, Escape to close, and Tab to leave; the
 * dialog traps Tab, closes on Escape, and restores focus to the trigger.
 */
export default function MemberActionMenu({ username, onRemove }: MemberActionMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuItemRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Focus the menuitem when the menu opens; close the menu on an outside
  // pointer-down so the trigger can be opened again cleanly.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    menuItemRef.current?.focus();
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      const menu = menuItemRef.current?.parentElement;
      if (
        menu &&
        !menu.contains(target) &&
        !(triggerRef.current && triggerRef.current.contains(target))
      ) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  // Focus the first actionable control when the dialog opens so the modal is
  // reachable; restore focus to the trigger when it closes.
  useEffect(() => {
    if (dialogOpen) {
      cancelButtonRef.current?.focus();
    }
  }, [dialogOpen]);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    triggerRef.current?.focus();
  }, []);

  function openDialog() {
    setError(undefined);
    setMenuOpen(false);
    setDialogOpen(true);
  }

  async function confirmRemove() {
    if (removing) {
      return;
    }
    setRemoving(true);
    setError(undefined);
    try {
      const result = await onRemove();
      if (result.ok) {
        // The parent refreshed the member list; this row (and menu) is gone.
        setDialogOpen(false);
      } else {
        setError(result.message ?? 'The member could not be removed.');
      }
    } finally {
      setRemoving(false);
    }
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setMenuOpen(true);
    }
  }

  function handleMenuItemKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openDialog();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === 'Tab') {
      // Leaving the menu with Tab closes it; focus moves naturally.
      setMenuOpen(false);
    }
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusables = [cancelButtonRef.current, confirmButtonRef.current].filter(
      (el): el is HTMLButtonElement => el !== null
    );
    if (focusables.length === 0) {
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="member-action-menu">
      <button
        ref={triggerRef}
        type="button"
        className="member-menu-button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
      >
        Member menu {username}
      </button>
      {menuOpen ? (
        <div
          className="member-menu-dropdown"
          role="menu"
          aria-label={`Actions for ${username}`}
        >
          <div
            ref={menuItemRef}
            role="menuitem"
            tabIndex={0}
            className="member-menu-item"
            onClick={openDialog}
            onKeyDown={handleMenuItemKeyDown}
          >
            Remove from organization
          </div>
        </div>
      ) : null}
      {dialogOpen ? (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closeDialog();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-member-dialog-title"
            className="remove-member-dialog"
            onKeyDown={handleDialogKeyDown}
          >
            <h2 id="remove-member-dialog-title">Remove member</h2>
            <p className="remove-member-dialog-text">
              Remove {username} from this organization? Their organization
              membership, team memberships, and direct repository grants are
              removed; the account, personal repositories, and other
              organizations are unaffected.
            </p>
            {error ? (
              <p role="alert" className="form-error">
                {error}
              </p>
            ) : null}
            <div className="sign-out-dialog-actions">
              <button
                ref={cancelButtonRef}
                type="button"
                className="secondary-button"
                onClick={closeDialog}
                disabled={removing}
              >
                Cancel
              </button>
              <button
                ref={confirmButtonRef}
                type="button"
                className="primary-button"
                onClick={() => void confirmRemove()}
                disabled={removing}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
