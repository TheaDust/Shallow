import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { SessionUser } from '../types';

interface AccountMenuProps {
  user: SessionUser;
  onSignOut: () => void;
}

/**
 * Upper-right account menu. The button visually displays the current signed-in
 * account ("the account menu displays the username") while keeping the
 * accessible name "Account menu" via aria-label; its dropdown shows the
 * account, a "Settings" entry (REQ-1-3 entry into account Settings), and the
 * "Sign out" entry. Activating "Sign out" opens a modal
 * dialog named "Sign out" whose "Confirm sign out" button ends the current
 * browser session; "Cancel" or closing the dialog keeps the session and page.
 */
export default function AccountMenu({ user, onSignOut }: AccountMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the first actionable control when the dialog opens so the modal is
  // reachable; restore focus to the menu button when it closes.
  useEffect(() => {
    if (dialogOpen) {
      cancelButtonRef.current?.focus();
    }
  }, [dialogOpen]);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  const handleCancel = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  const handleConfirm = useCallback(() => {
    closeDialog();
    onSignOut();
  }, [closeDialog, onSignOut]);

  const handleDialogKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
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
    },
    [closeDialog]
  );

  return (
    <div className="account-menu">
      <button
        ref={menuButtonRef}
        type="button"
        className="account-menu-button"
        aria-label="Account menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {user.username}
      </button>
      {menuOpen ? (
        <div className="account-menu-dropdown">
          <div className="account-menu-user">{user.username}</div>
          <a
            className="account-menu-organizations"
            href="#/organizations"
            onClick={() => setMenuOpen(false)}
          >
            Your organizations
          </a>
          <a
            className="account-menu-settings"
            href="#/settings"
            onClick={() => setMenuOpen(false)}
          >
            Settings
          </a>
          <a
            className="account-menu-sign-out"
            href="#/"
            onClick={(e) => {
              e.preventDefault();
              setMenuOpen(false);
              setDialogOpen(true);
            }}
          >
            Sign out
          </a>
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
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sign-out-dialog-title"
            className="sign-out-dialog"
            onKeyDown={handleDialogKeyDown}
          >
            <h2 id="sign-out-dialog-title">Sign out</h2>
            <p className="sign-out-dialog-text">
              Signing out affects only the current browser session.
            </p>
            <div className="sign-out-dialog-actions">
              <button
                ref={cancelButtonRef}
                type="button"
                className="secondary-button"
                onClick={handleCancel}
              >
                Cancel
              </button>
              <button
                ref={confirmButtonRef}
                type="button"
                className="primary-button"
                onClick={handleConfirm}
              >
                Confirm sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
