import { useEffect, useId, useRef, useState } from "react";

import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { useSession } from "../session/SessionProvider";
import { navigate } from "../lib/hash-route";

/**
 * REQ-1 / REQ-1-2: the upper-right account menu. The trigger is named “Account
 * menu” and its visible text is exactly the current username — no avatar initial
 * or other decoration, so the account shown by the control is unambiguous — and
 * the menu offers the sign-out entry, which opens a confirmation dialog.
 */
export function AccountMenu() {
  const { account, endSession } = useSession();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  if (!account) return null;

  const confirmSignOut = async () => {
    setSigningOut(true);
    try {
      await endSession();
    } finally {
      setSigningOut(false);
      setConfirmOpen(false);
      navigate("/");
    }
  };

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="account-menu__trigger"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="account-menu__username">{account.username}</span>
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label="Account menu" className="account-menu__content">
          <a className="account-menu__item" href="#/organizations" onClick={() => setOpen(false)}>
            Your organizations
          </a>
          <a className="account-menu__item" href="#/settings" onClick={() => setOpen(false)}>
            Settings
          </a>
          <a
            className="account-menu__item"
            href="#/sign-out"
            onClick={(event) => {
              event.preventDefault();
              setOpen(false);
              setConfirmOpen(true);
            }}
          >
            Sign out
          </a>
        </div>
      ) : null}
      {confirmOpen ? (
        <Dialog
          open
          title="Sign out"
          closeButton={false}
          description="Signing out ends only the current browser session. Other browser sessions stay signed in."
          onOpenChange={(next) => setConfirmOpen(next)}
          actions={
            <>
              <Button variant="primary" disabled={signingOut} onClick={() => void confirmSignOut()}>
                Confirm sign out
              </Button>
              <Button disabled={signingOut} onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
            </>
          }
        >
          <p>You can sign in again at any time.</p>
        </Dialog>
      ) : null}
    </div>
  );
}
