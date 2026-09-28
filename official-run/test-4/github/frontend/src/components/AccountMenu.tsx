import { useEffect, useRef, useState } from "react";

import { Account } from "../lib/account-api";
import { useSession } from "../session";

interface AccountMenuProps {
  account: Account;
  onSignOutRequest: () => void;
}

/**
 * Upper-right account menu: the current account is exposed as an avatar button
 * named with the username, plus a button named “Account menu” (exactly one per
 * page); the shared panel shows the signed-in account, “Your organizations”,
 * “Settings” and a single “Sign out” link.
 */
export function AccountMenu({ account, onSignOutRequest }: AccountMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function toggleMenu() {
    setMenuOpen((open) => !open);
  }

  return (
    <div className="account-menu">
      <button
        type="button"
        className="account-menu__avatar"
        aria-label={account.username}
        aria-haspopup="true"
        aria-expanded={menuOpen}
        onClick={toggleMenu}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
          <path d="M8 8a3.25 3.25 0 1 0 0-6.5A3.25 3.25 0 0 0 8 8Zm0 1.5c-2.9 0-5.25 1.6-5.25 3.75 0 .5.1.75.25.75h10c.15 0 .25-.25.25-.75C13.25 11.1 10.9 9.5 8 9.5Z" />
        </svg>
      </button>
      <button
        ref={buttonRef}
        type="button"
        className="account-menu__trigger"
        aria-haspopup="true"
        aria-expanded={menuOpen}
        onClick={toggleMenu}
      >
        Account menu
      </button>
      {menuOpen && (
        <div className="account-menu__panel" data-testid="account-menu-panel">
          <div className="account-menu__identity" data-testid="account-menu-account">
            {account.username}
          </div>
          <a
            className="account-menu__item"
            href="#/orgs"
            onClick={() => setMenuOpen(false)}
          >
            Your organizations
          </a>
          <a
            className="account-menu__item"
            href="#/settings"
            onClick={() => setMenuOpen(false)}
          >
            Settings
          </a>
          <a
            className="account-menu__item account-menu__signout"
            href="#/signout"
            onClick={(event) => {
              event.preventDefault();
              setMenuOpen(false);
              onSignOutRequest();
            }}
          >
            Sign out
          </a>
        </div>
      )}
    </div>
  );
}

interface SignOutDialogProps {
  onClose: () => void;
}

/**
 * Modal “Sign out” confirmation. Only “Confirm sign out” invalidates the
 * session; Cancel or Escape retains it.
 */
export function SignOutDialog({ onClose }: SignOutDialogProps) {
  const { signOut } = useSession();
  const [confirming, setConfirming] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        previousFocus?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleConfirm() {
    setConfirming(true);
    try {
      await signOut();
    } finally {
      setConfirming(false);
      onClose();
    }
  }

  function handleCancel() {
    onClose();
  }

  return (
    <div className="sign-out-dialog" role="dialog" aria-modal="true" aria-labelledby="sign-out-title" tabIndex={-1} data-testid="sign-out-dialog">
      <h2 id="sign-out-title">Sign out</h2>
      <p>Signing out affects only the current browser session.</p>
      <div className="sign-out-dialog__actions">
        <button type="button" className="button button--primary" onClick={() => void handleConfirm()} disabled={confirming}>
          Confirm sign out
        </button>
        <button type="button" className="button" onClick={handleCancel} disabled={confirming}>
          Cancel
        </button>
      </div>
    </div>
  );
}
