import { useEffect, useRef, useState } from "react";

import { navigate } from "../../lib/hash-route";
import { Button, Dialog } from "../../ui";
import { useAccountSession } from "./AccountSession";

export interface AccountMenuProps {
  username: string;
}

/**
 * Upper-right control that displays the current signed-in account. Its
 * accessible name stays "Account menu" while the visible label shows the
 * signed-in username.
 */
export function AccountMenu({ username }: AccountMenuProps) {
  const { signOut } = useAccountSession();
  const [open, setOpen] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function closeSignOutDialog() {
    setConfirmingSignOut(false);
    triggerRef.current?.focus();
  }

  async function confirmSignOut() {
    if (busy) return;
    setBusy(true);
    try {
      // Only this confirmation ends the current browser session.
      await signOut();
      setConfirmingSignOut(false);
      setOpen(false);
      navigate("/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="account-menu__trigger"
        aria-label="Account menu"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="account-menu__avatar" aria-hidden="true">
          {username.slice(0, 1).toUpperCase()}
        </span>
        <span className="account-menu__username">{username}</span>
      </button>
      {open ? (
        <div className="account-menu__panel">
          <p className="account-menu__user">{`Signed in as ${username}`}</p>
          <ul className="account-menu__list">
            <li>
              <a href="#/organizations">Your organizations</a>
            </li>
            <li>
              <a href="#/settings">Settings</a>
            </li>
            <li>
              <a
                href="#/signout"
                onClick={(event) => {
                  event.preventDefault();
                  setOpen(false);
                  setConfirmingSignOut(true);
                }}
              >
                Sign out
              </a>
            </li>
          </ul>
        </div>
      ) : null}
      <Dialog
        open={confirmingSignOut}
        title="Sign out"
        description="Signing out affects only the current browser session."
        onOpenChange={(next) => {
          if (!next) closeSignOutDialog();
        }}
        actions={
          <>
            <Button variant="primary" disabled={busy} onClick={() => void confirmSignOut()}>
              Confirm sign out
            </Button>
            <Button disabled={busy} onClick={closeSignOutDialog}>
              Cancel
            </Button>
          </>
        }
      >
        <p>{`You are signed in as ${username}.`}</p>
      </Dialog>
    </div>
  );
}
