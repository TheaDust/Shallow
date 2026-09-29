import { useEffect, useRef, useState } from "react";

import { navigate } from "../../lib/hash-route";
import { Button, Dialog } from "../../ui";
import { signOut, type AccountInfo } from "./api";
import { useSession } from "./session";

export function AccountMenu({ account }: { account: AccountInfo }) {
  const { refreshSession } = useSession();
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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

  const confirmSignOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await signOut();
      setDialogOpen(false);
      setOpen(false);
      await refreshSession();
      navigate("/");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ui-button account-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "account-menu" : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        Account menu
      </button>
      {open ? (
        <div id="account-menu" role="menu" aria-label="Account menu" className="account-menu__panel">
          <div className="account-menu__identity">
            <span className="account-menu__username">{account.username}</span>
            <span className="account-menu__email">{account.email}</span>
          </div>
          <a
            href="#/organizations"
            className="account-menu__organizations"
            onClick={(event) => {
              event.preventDefault();
              setOpen(false);
              navigate("/organizations");
            }}
          >
            Your organizations
          </a>
          <a
            href="#/settings"
            className="account-menu__settings"
            onClick={(event) => {
              event.preventDefault();
              setOpen(false);
              navigate("/settings");
            }}
          >
            Settings
          </a>
          <a
            href="#/signout"
            className="account-menu__signout"
            onClick={(event) => {
              event.preventDefault();
              setOpen(false);
              setDialogOpen(true);
            }}
          >
            Sign out
          </a>
        </div>
      ) : null}
      <Dialog
        open={dialogOpen}
        title="Sign out"
        description="Signing out affects only the current browser session."
        onOpenChange={setDialogOpen}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void confirmSignOut()}>
              Confirm sign out
            </Button>
          </>
        }
      >
        <p>End the current browser session. Your account and other sessions are not affected.</p>
      </Dialog>
    </div>
  );
}
